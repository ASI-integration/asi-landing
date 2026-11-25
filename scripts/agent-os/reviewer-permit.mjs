/**
 * Paid-reviewer admission.
 * The owner fingerprint is a source constant. It is never taken from the key
 * that is about to be checked. A signed budget snapshot is not spend authority.
 * GitHub issue comments are not a ledger. No model client lives here.
 * P1 SQLite escrow on one.com is not wired into this GitHub-hosted gate, so
 * decideSpend refuses every call.
 */
import {createHash, createPublicKey, verify} from 'node:crypto';

export const OWNER_TRUST_ROOT = '179cf786e1448ff1a3fccbe426d59aa3a3482050d98f5a8c82fd2f6a8a0b6a4d';
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
  let key;
  try { key = createPublicKey(pem); } catch { return null; }
  if (key.asymmetricKeyType !== 'ed25519') return null;
  return createHash('sha256').update(key.export({type:'spki', format:'der'})).digest('hex');
}

function openEnvelope(envelope, pem) {
  if (!envelope || typeof envelope.payload !== 'string' || envelope.payload.length < 2 ||
      envelope.payload.length > 20000 || typeof envelope.signature !== 'string' ||
      !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) return null;
  const fingerprint = reviewerKeyFingerprint(pem);
  if (!fingerprint) return null;
  let key;
  try { key = createPublicKey(pem); } catch { return null; }
  const signature = Buffer.from(envelope.signature, 'base64');
  if (signature.length !== 64 || !verify(null, Buffer.from(envelope.payload, 'utf8'), key, signature)) return null;
  let parsed;
  try { parsed = JSON.parse(envelope.payload); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || JSON.stringify(parsed) !== envelope.payload) return null;
  return {parsed, digest:createHash('sha256').update(envelope.payload, 'utf8').digest('hex'), fingerprint};
}

function reviewPermit(input, enforceOwnerRoot) {
  const {permit, budget, ownerPublicKey, expected, now} = input || {};
  if (!Number.isSafeInteger(now) || now < 0) return deny('BUDGET_UNVERIFIED', 'CLOCK');
  const pinned = plain(expected, ['headSha', 'ownerKeySha256']);
  if (!pinned || !SHA40.test(pinned.headSha) || !SHA64.test(pinned.ownerKeySha256))
    return deny('NO_SIGNED_REVIEWER_PERMIT', 'CONTEXT');
  const fingerprint = reviewerKeyFingerprint(ownerPublicKey);
  if (!fingerprint) return deny('NO_SIGNED_REVIEWER_PERMIT', 'TRUST_ROOT');
  if (enforceOwnerRoot) {
    if (pinned.ownerKeySha256 !== OWNER_TRUST_ROOT || fingerprint !== OWNER_TRUST_ROOT)
      return deny('NO_SIGNED_REVIEWER_PERMIT', 'TRUST_ROOT');
  } else if (pinned.ownerKeySha256 !== fingerprint) {
    return deny('NO_SIGNED_REVIEWER_PERMIT', 'TRUST_ROOT');
  }
  const openedPermit = openEnvelope(permit, ownerPublicKey);
  if (!openedPermit || openedPermit.fingerprint !== fingerprint)
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
  if (!openedBudget || openedBudget.fingerprint !== fingerprint)
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

export function reviewLocalPermit(input = {}) {
  return reviewPermit(input, true);
}

/** Constraint checks for fixtures. This does not establish the owner root and cannot spend. */
export function inspectPermitConstraints(input = {}) {
  return reviewPermit(input, false);
}

export function decideSpend(local) {
  if (local && local.ok === false && local.admit === false && typeof local.code === 'string' && local.code !== 'ADMIT')
    return local;
  return deny('NO_SPEND', 'ESCROW_RESERVATION_UNAVAILABLE');
}

export async function admitReviewerCall(input = {}) {
  if (input && (Object.hasOwn(input, 'cloudRuApiKey') || Object.hasOwn(input, 'modelCall')))
    return deny('NO_SPEND', 'KEY_PRESENT');
  const local = reviewLocalPermit(input);
  return decideSpend(local);
}
