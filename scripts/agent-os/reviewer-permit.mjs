/**
 * One-time admission for a paid AI reviewer call.
 * This module never reads CLOUDRU_API_KEY and never calls a model provider.
 * LOCAL_OK is not permission to spend. Only admit:true / code ADMIT is.
 */
import {createHash, createPublicKey, verify} from 'node:crypto';

export const PERMIT_SCHEMA = 'asi.reviewer-permit.v1';
export const BUDGET_SCHEMA = 'asi.reviewer-budget.v1';
const REPO = 'ASI-integration/asi-landing';
const PURPOSE = 'p1-adversarial-review';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const TASK = /^[1-9][0-9]{0,6}$/;
const MAX_PERMIT_MS = 2 * 60 * 60 * 1000;
const MAX_BUDGET_AGE_MS = 60 * 60 * 1000;
const MAX_RUB = 1_000_000;
const permitFields = ['schema','repo','headSha','taskId','purpose','capRub','notBefore','expiresAt','permitId'];
const budgetFields = ['schema','repo','taskId','taskState','capRub','remainingRub','paidCallsEnabled','asOf','consumedPermitDigests','authorizedPermitDigest'];

const deny = (code, reason) => Object.freeze({ok:false, admit:false, code, reason});

function plain(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== fields.length ||
      fields.some(key => !descriptors[key] || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.fromEntries(fields.map(key => [key, descriptors[key].value]));
}

function digestList(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 64) return null;
  const out = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' ||
        !SHA64.test(descriptor.value) || (i && descriptor.value <= out[i - 1])) return null;
    out.push(descriptor.value);
  }
  return out;
}

function canonical(value, fields) {
  return JSON.stringify(Object.fromEntries(fields.map(key => [key, value[key]])));
}

export function reviewerKeyFingerprint(pem) {
  if (typeof pem !== 'string' || pem.length < 80 || pem.length > 10000) return null;
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') return null;
  return createHash('sha256').update(key.export({type:'spki', format:'der'})).digest('hex');
}

function openEnvelope(envelope, pem) {
  if (!envelope || typeof envelope.payload !== 'string' || envelope.payload.length < 2 ||
      envelope.payload.length > 20000 || typeof envelope.signature !== 'string' ||
      !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) return null;
  const fingerprint = reviewerKeyFingerprint(pem);
  if (!fingerprint) return null;
  const signature = Buffer.from(envelope.signature, 'base64');
  if (signature.length !== 64 || !verify(null, Buffer.from(envelope.payload, 'utf8'), createPublicKey(pem), signature)) return null;
  let parsed;
  try { parsed = JSON.parse(envelope.payload); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || JSON.stringify(parsed) !== envelope.payload) return null;
  return {parsed, digest:createHash('sha256').update(envelope.payload, 'utf8').digest('hex'), fingerprint};
}

export function reviewLocalPermit({permit, budget, ownerPublicKey, expected, now} = {}) {
  if (!Number.isSafeInteger(now) || now < 0) return deny('BUDGET_UNVERIFIED', 'CLOCK');
  const pinned = plain(expected, ['headSha', 'ownerKeySha256']);
  if (!pinned || !SHA40.test(pinned.headSha) || !SHA64.test(pinned.ownerKeySha256))
    return deny('NO_SIGNED_REVIEWER_PERMIT', 'CONTEXT');
  const openedPermit = openEnvelope(permit, ownerPublicKey);
  if (!openedPermit || openedPermit.fingerprint !== pinned.ownerKeySha256)
    return deny('NO_SIGNED_REVIEWER_PERMIT', 'PERMIT_SIGNATURE');
  const body = plain(openedPermit.parsed, permitFields);
  if (!body || canonical(body, permitFields) !== permit.payload)
    return deny('NO_SIGNED_REVIEWER_PERMIT', 'PERMIT_SIGNATURE');
  if (body.schema !== PERMIT_SCHEMA || body.repo !== REPO || body.purpose !== PURPOSE ||
      !SHA40.test(body.headSha) || !TASK.test(body.taskId) || !SHA64.test(body.permitId))
    return deny('NO_SIGNED_REVIEWER_PERMIT', 'PERMIT_SCOPE');
  if (body.headSha !== pinned.headSha) return deny('NO_SIGNED_REVIEWER_PERMIT', 'PERMIT_HEAD');
  if (!Number.isSafeInteger(body.notBefore) || !Number.isSafeInteger(body.expiresAt) ||
      body.notBefore < 0 || body.expiresAt <= body.notBefore || body.expiresAt - body.notBefore > MAX_PERMIT_MS ||
      now < body.notBefore || now >= body.expiresAt)
    return deny('NO_SIGNED_REVIEWER_PERMIT', 'PERMIT_EXPIRED');
  if (!Number.isSafeInteger(body.capRub) || body.capRub <= 0 || body.capRub > MAX_RUB)
    return deny('NO_SIGNED_REVIEWER_PERMIT', 'PERMIT_CAP');
  const openedBudget = openEnvelope(budget, ownerPublicKey);
  if (!openedBudget || openedBudget.fingerprint !== pinned.ownerKeySha256)
    return deny('BUDGET_UNVERIFIED', 'BUDGET_SIGNATURE');
  const money = plain(openedBudget.parsed, budgetFields);
  if (!money || canonical(money, budgetFields) !== budget.payload)
    return deny('BUDGET_UNVERIFIED', 'BUDGET_SIGNATURE');
  const consumed = digestList(money.consumedPermitDigests);
  if (money.schema !== BUDGET_SCHEMA || money.repo !== REPO || money.taskId !== body.taskId || !consumed ||
      !SHA64.test(money.authorizedPermitDigest) ||
      (money.taskState !== 'HOLD' && money.taskState !== 'RELEASED') ||
      !Number.isSafeInteger(money.capRub) || !Number.isSafeInteger(money.remainingRub) ||
      money.capRub < 0 || money.capRub > MAX_RUB || money.remainingRub < 0 || money.remainingRub > money.capRub ||
      (money.paidCallsEnabled !== 'YES' && money.paidCallsEnabled !== 'NO') ||
      !Number.isSafeInteger(money.asOf))
    return deny('BUDGET_UNVERIFIED', 'BUDGET_SHAPE');
  if (money.taskState === 'HOLD') return deny('BUDGET_HOLD', 'TASK_HOLD');
  if (money.capRub === 0 || money.remainingRub === 0) return deny('BUDGET_CAP_ZERO', 'CAP_ZERO');
  if (money.paidCallsEnabled !== 'YES') return deny('BUDGET_UNVERIFIED', 'PAID_CALLS_DISABLED');
  if (money.asOf > now || now - money.asOf > MAX_BUDGET_AGE_MS) return deny('BUDGET_UNVERIFIED', 'BUDGET_STALE');
  if (money.authorizedPermitDigest !== openedPermit.digest || body.capRub > money.remainingRub)
    return deny('NO_SIGNED_REVIEWER_PERMIT', 'PERMIT_NOT_IN_BUDGET');
  if (consumed.includes(openedPermit.digest)) return deny('NO_SIGNED_REVIEWER_PERMIT', 'PERMIT_REPLAY');
  return Object.freeze({
    ok:true, admit:false, code:'LOCAL_OK', reason:'LOCAL_OK',
    digest:openedPermit.digest, taskId:body.taskId,
  });
}

function ledgerOf(value) {
  const ledger = plain(value, ['trusted', 'digests']);
  if (!ledger || ledger.trusted !== true) return null;
  const digests = digestList(ledger.digests);
  if (!digests) return null;
  return {trusted:true, digests};
}

function liveOf(value) {
  const live = plain(value, ['verified', 'taskId', 'hold']);
  if (!live || live.verified !== true || live.hold !== false && live.hold !== true || !TASK.test(live.taskId)) return null;
  return live;
}

export async function admitReviewerCall(input = {}) {
  if (input && Object.hasOwn(input, 'cloudRuApiKey')) return deny('NO_SIGNED_REVIEWER_PERMIT', 'KEY_PRESENT');
  const local = reviewLocalPermit(input);
  if (!local.ok) return local;
  const live = liveOf(input.liveTask);
  if (!live) return deny('BUDGET_UNVERIFIED', 'LIVE_TASK_UNVERIFIED');
  if (live.taskId !== local.taskId) return deny('BUDGET_UNVERIFIED', 'LIVE_TASK_MISMATCH');
  if (live.hold === true) return deny('BUDGET_HOLD', 'LIVE_HOLD');
  const ledger = ledgerOf(input.replayLedger);
  if (!ledger) return deny('NO_SIGNED_REVIEWER_PERMIT', 'REPLAY_UNVERIFIED');
  if (ledger.digests.includes(local.digest)) return deny('NO_SIGNED_REVIEWER_PERMIT', 'PERMIT_REPLAY');
  if (typeof input.claim !== 'function') return deny('NO_SIGNED_REVIEWER_PERMIT', 'CLAIM_UNVERIFIED');
  let claimed = false;
  try { claimed = await input.claim(local.digest); } catch { claimed = false; }
  if (claimed !== true) return deny('NO_SIGNED_REVIEWER_PERMIT', 'CLAIM_FAILED');
  return Object.freeze({admit:true, code:'ADMIT', reason:'ADMIT', digest:local.digest, taskId:local.taskId});
}

export async function observeReviewerTask({taskId, token, fetchImpl} = {}) {
  const fail = () => ({verified:false, taskId:null, hold:true, digests:[]});
  if (!TASK.test(String(taskId || '')) || typeof token !== 'string' || token.length < 8 ||
      token.length > 4096 || typeof fetchImpl !== 'function') return fail();
  const headers = {
    Authorization:`Bearer ${token}`,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'asi-reviewer-permit',
  };
  const base = `https://api.github.com/repos/${REPO}/issues/${taskId}`;
  let issueRes;
  try { issueRes = await fetchImpl(base, {headers, signal:AbortSignal.timeout(20000)}); }
  catch { return fail(); }
  if (!issueRes?.ok || typeof issueRes.json !== 'function') return fail();
  const issue = await issueRes.json();
  if (!issue || Number(issue.number) !== Number(taskId)) return fail();
  const labels = Array.isArray(issue.labels) ? issue.labels : [];
  const names = labels.map(label => typeof label === 'string' ? label : label?.name).filter(name => typeof name === 'string');
  const hold = issue.state !== 'open' || names.some(name => name.toUpperCase() === 'HOLD') ||
    /(^|\s)HOLD(\s|$)/.test(String(issue.title || ''));
  const digests = [];
  for (let page = 1; page <= 5; page++) {
    let commentsRes;
    try {
      commentsRes = await fetchImpl(`${base}/comments?per_page=100&page=${page}`, {headers, signal:AbortSignal.timeout(20000)});
    } catch { return fail(); }
    if (!commentsRes?.ok || typeof commentsRes.json !== 'function') return fail();
    const comments = await commentsRes.json();
    if (!Array.isArray(comments)) return fail();
    for (const comment of comments) {
      const match = typeof comment?.body === 'string' &&
        comment.body.trim().match(/^ASI-REVIEWER-PERMIT-CONSUMED:([a-f0-9]{64})$/);
      if (match) digests.push(match[1]);
    }
    if (comments.length < 100) return {verified:true, taskId:String(issue.number), hold, digests};
  }
  return fail();
}

export async function claimPermitDigest({taskId, digest, token, fetchImpl} = {}) {
  if (!TASK.test(String(taskId || '')) || !SHA64.test(String(digest || '')) ||
      typeof token !== 'string' || token.length < 8 || typeof fetchImpl !== 'function') return false;
  const headers = {
    Authorization:`Bearer ${token}`,
    Accept:'application/vnd.github+json',
    'Content-Type':'application/json',
    'X-GitHub-Api-Version':'2022-11-28',
    'User-Agent':'asi-reviewer-permit',
  };
  const body = `ASI-REVIEWER-PERMIT-CONSUMED:${digest}`;
  let posted;
  try {
    posted = await fetchImpl(`https://api.github.com/repos/${REPO}/issues/${taskId}/comments`, {
      method:'POST', headers, body:JSON.stringify({body}), signal:AbortSignal.timeout(20000),
    });
  } catch { return false; }
  if (!posted?.ok) return false;
  const seen = await observeReviewerTask({taskId, token, fetchImpl});
  return seen.verified === true && seen.digests.filter(item => item === digest).length === 1;
}
