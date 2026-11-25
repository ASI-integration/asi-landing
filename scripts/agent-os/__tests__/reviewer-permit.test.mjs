import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  admitReviewerCall, claimPermitDigest, observeReviewerTask, reviewLocalPermit, reviewerKeyFingerprint,
} from '../reviewer-permit.mjs';

const NOW = 1_800_000_000_000;
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const owner = generateKeyPairSync('ed25519');
const forger = generateKeyPairSync('ed25519');
const pem = owner.publicKey.export({type:'spki', format:'pem'});
const ownerKeySha256 = reviewerKeyFingerprint(pem);
const seal = (value, key = owner.privateKey) => {
  const payload = JSON.stringify(value);
  return {payload, signature:sign(null, Buffer.from(payload), key).toString('base64')};
};
const permitBody = (over = {}) => ({
  schema:'asi.reviewer-permit.v1', repo:'ASI-integration/asi-landing', headSha:HEAD, taskId:'686',
  purpose:'p1-adversarial-review', capRub:100, notBefore:NOW - 1000, expiresAt:NOW + 60 * 60 * 1000,
  permitId:'ab'.repeat(32), ...over,
});
const budgetBody = (digest, over = {}) => ({
  schema:'asi.reviewer-budget.v1', repo:'ASI-integration/asi-landing', taskId:'686', taskState:'RELEASED',
  capRub:100, remainingRub:100, paidCallsEnabled:'YES', asOf:NOW - 1000, consumedPermitDigests:[],
  authorizedPermitDigest:digest, ...over,
});
function pack(permitOver = {}, budgetOver = {}, key = owner.privateKey) {
  const permit = seal(permitBody(permitOver), key);
  const digest = createHash('sha256').update(permit.payload).digest('hex');
  const budget = seal(budgetBody(digest, budgetOver), key);
  return {permit, budget, digest};
}
const expected = {headSha:HEAD, ownerKeySha256};
const calls = () => {
  const seen = [];
  return {seen, claim: async digest => { seen.push(digest); return true; }};
};
function admit(packOver = {}, extra = {}) {
  const material = pack();
  const claim = calls();
  const input = {
    ...material, ownerPublicKey:pem, expected, now:NOW,
    liveTask:{verified:true, taskId:'686', hold:false},
    replayLedger:{trusted:true, digests:[]},
    claim:claim.claim,
    ...packOver,
    ...extra,
  };
  return {material, claim, result:admitReviewerCall(input)};
}

test('forged signer is refused before any claim', async () => {
  const material = pack({}, {}, forger.privateKey);
  const claim = calls();
  const result = await admitReviewerCall({
    ...material, ownerPublicKey:forger.publicKey.export({type:'spki', format:'pem'}),
    expected, now:NOW, liveTask:{verified:true, taskId:'686', hold:false},
    replayLedger:{trusted:true, digests:[]}, claim:claim.claim,
  });
  assert.equal(result.code, 'NO_SIGNED_REVIEWER_PERMIT');
  assert.equal(result.reason, 'PERMIT_SIGNATURE');
  assert.equal(result.admit, false);
  assert.deepEqual(claim.seen, []);
});

test('tampered payload, expired permit and changed HEAD stay unsigned', async () => {
  const material = pack();
  const tampered = {...material.permit, payload:material.permit.payload.replace('686', '687')};
  const tamperedResult = await admitReviewerCall({
    permit:tampered, budget:material.budget, ownerPublicKey:pem, expected, now:NOW,
    liveTask:{verified:true, taskId:'686', hold:false}, replayLedger:{trusted:true, digests:[]},
    claim:async () => { throw Error('CLAIMED'); },
  });
  assert.equal(tamperedResult.reason, 'PERMIT_SIGNATURE');
  const expired = pack({expiresAt:NOW - 1, notBefore:NOW - 1000});
  const expiredResult = await admitReviewerCall({
    ...expired, ownerPublicKey:pem, expected, now:NOW,
    liveTask:{verified:true, taskId:'686', hold:false}, replayLedger:{trusted:true, digests:[]},
    claim:async () => true,
  });
  assert.equal(expiredResult.code, 'NO_SIGNED_REVIEWER_PERMIT');
  assert.equal(expiredResult.reason, 'PERMIT_EXPIRED');
  const moved = await admitReviewerCall({
    ...material, ownerPublicKey:pem, expected:{headSha:OTHER, ownerKeySha256}, now:NOW,
    liveTask:{verified:true, taskId:'686', hold:false}, replayLedger:{trusted:true, digests:[]},
    claim:async () => true,
  });
  assert.equal(moved.reason, 'PERMIT_HEAD');
});

test('consumed permit and ledger replay do not claim again', async () => {
  const material = pack();
  const consumed = pack({}, {consumedPermitDigests:[material.digest], authorizedPermitDigest:material.digest});
  const consumedResult = await admitReviewerCall({
    permit:material.permit, budget:consumed.budget, ownerPublicKey:pem, expected, now:NOW,
    liveTask:{verified:true, taskId:'686', hold:false}, replayLedger:{trusted:true, digests:[]},
    claim:async () => { throw Error('CLAIMED'); },
  });
  assert.equal(consumedResult.reason, 'PERMIT_REPLAY');
  const ledger = calls();
  const replay = await admitReviewerCall({
    ...material, ownerPublicKey:pem, expected, now:NOW,
    liveTask:{verified:true, taskId:'686', hold:false},
    replayLedger:{trusted:true, digests:[material.digest]}, claim:ledger.claim,
  });
  assert.equal(replay.reason, 'PERMIT_REPLAY');
  assert.deepEqual(ledger.seen, []);
});

test('a claimed digest cannot be admitted a second time', async () => {
  const material = pack();
  const used = [];
  const first = await admitReviewerCall({
    ...material, ownerPublicKey:pem, expected, now:NOW,
    liveTask:{verified:true, taskId:'686', hold:false}, replayLedger:{trusted:true, digests:[]},
    claim:async digest => { used.push(digest); return true; },
  });
  assert.equal(first.code, 'ADMIT');
  assert.equal(first.admit, true);
  const second = await admitReviewerCall({
    ...material, ownerPublicKey:pem, expected, now:NOW,
    liveTask:{verified:true, taskId:'686', hold:false},
    replayLedger:{trusted:true, digests:used}, claim:async () => true,
  });
  assert.equal(second.reason, 'PERMIT_REPLAY');
  assert.equal(second.admit, false);
});

test('zero budget, HOLD and disabled paid calls refuse before claim', async () => {
  const material = pack();
  const run = async budgetOver => admitReviewerCall({
    permit:material.permit,
    budget:seal(budgetBody(material.digest, budgetOver)),
    ownerPublicKey:pem, expected, now:NOW,
    liveTask:{verified:true, taskId:'686', hold:false}, replayLedger:{trusted:true, digests:[]},
    claim:async () => { throw Error('CLAIMED'); },
  });
  assert.deepEqual(await run({capRub:0, remainingRub:0}), {ok:false, admit:false, code:'BUDGET_CAP_ZERO', reason:'CAP_ZERO'});
  assert.equal((await run({taskState:'HOLD', capRub:100, remainingRub:100})).code, 'BUDGET_HOLD');
  assert.equal((await run({paidCallsEnabled:'NO'})).reason, 'PAID_CALLS_DISABLED');
  assert.equal((await run({asOf:NOW - 2 * 60 * 60 * 1000})).reason, 'BUDGET_STALE');
  const missing = await admitReviewerCall({
    permit:material.permit, budget:null, ownerPublicKey:pem, expected, now:NOW,
    liveTask:{verified:true, taskId:'686', hold:false}, replayLedger:{trusted:true, digests:[]},
    claim:async () => true,
  });
  assert.equal(missing.code, 'BUDGET_UNVERIFIED');
});

test('live HOLD, unverified budget read and a failed claim do not admit', async () => {
  const material = pack();
  const base = {...material, ownerPublicKey:pem, expected, now:NOW};
  const held = await admitReviewerCall({
    ...base, liveTask:{verified:true, taskId:'686', hold:true},
    replayLedger:{trusted:true, digests:[]}, claim:async () => { throw Error('CLAIMED'); },
  });
  assert.equal(held.code, 'BUDGET_HOLD');
  const blind = await admitReviewerCall({
    ...base, liveTask:{verified:false, taskId:'686', hold:false},
    replayLedger:{trusted:false, digests:[]}, claim:async () => true,
  });
  assert.equal(blind.reason, 'LIVE_TASK_UNVERIFIED');
  const unclaimed = await admitReviewerCall({
    ...base, liveTask:{verified:true, taskId:'686', hold:false},
    replayLedger:{trusted:true, digests:[]}, claim:async () => false,
  });
  assert.equal(unclaimed.reason, 'CLAIM_FAILED');
  const keyed = await admitReviewerCall({...base, cloudRuApiKey:'present', claim:async () => true});
  assert.equal(keyed.reason, 'KEY_PRESENT');
  assert.equal(keyed.admit, false);
});

test('one fresh permit admits exactly once and local success is not spend authority', async () => {
  const {claim, result} = await admit();
  const decision = await result;
  assert.equal(decision.code, 'ADMIT');
  assert.deepEqual(claim.seen, [decision.digest]);
  const local = reviewLocalPermit({...pack(), ownerPublicKey:pem, expected, now:NOW});
  assert.equal(local.code, 'LOCAL_OK');
  assert.equal(local.admit, false);
});

test('issue observation fails closed and a single claim comment is accepted once', async () => {
  const denied = await observeReviewerTask({taskId:'686', token:'token-token', fetchImpl:async () => ({ok:false})});
  assert.equal(denied.verified, false);
  const held = await observeReviewerTask({
    taskId:'686', token:'token-token',
    fetchImpl:async url => url.endsWith('/comments?per_page=100&page=1')
      ? {ok:true, json:async () => []}
      : {ok:true, json:async () => ({number:686, state:'open', title:'task', labels:[{name:'HOLD'}]})},
  });
  assert.equal(held.hold, true);
  const digest = 'cd'.repeat(32);
  let posted = 0;
  const claimed = await claimPermitDigest({
    taskId:'686', digest, token:'token-token',
    fetchImpl:async (url, options = {}) => {
      if (options.method === 'POST') { posted += 1; return {ok:true, json:async () => ({})}; }
      if (String(url).includes('/comments')) {
        return {ok:true, json:async () => [{body:`ASI-REVIEWER-PERMIT-CONSUMED:${digest}`}]};
      }
      return {ok:true, json:async () => ({number:686, state:'open', title:'task', labels:[]})};
    },
  });
  assert.equal(posted, 1);
  assert.equal(claimed, true);
  const full = await observeReviewerTask({
    taskId:'686', token:'token-token',
    fetchImpl:async url => String(url).includes('/comments')
      ? {ok:true, json:async () => Array.from({length:100}, () => ({body:'note'}))}
      : {ok:true, json:async () => ({number:686, state:'open', title:'task', labels:[]})},
  });
  assert.equal(full.verified, false);
});

test('cli refuses an empty permit and a present Cloud.ru key without printing it', () => {
  const cli = fileURLToPath(new URL('../reviewer-permit-cli.mjs', import.meta.url));
  const empty = spawnSync(process.execPath, [cli, '--phase', 'local'], {encoding:'utf8'});
  assert.equal(empty.status, 2);
  assert.equal(empty.stdout.trim(), 'NO_SIGNED_REVIEWER_PERMIT');
  const secret = 'super-secret-cloud-key';
  const leaked = spawnSync(process.execPath, [cli, '--phase', 'commit'], {
    encoding:'utf8', env:{...process.env, CLOUDRU_API_KEY:secret},
  });
  assert.equal(leaked.status, 2);
  assert.equal(leaked.stdout.trim(), 'NO_SIGNED_REVIEWER_PERMIT');
  assert.equal(`${leaked.stdout}${leaked.stderr}`.includes(secret), false);
});

test('cli local phase can succeed offline and commit phase still does not admit', () => {
  const cli = fileURLToPath(new URL('../reviewer-permit-cli.mjs', import.meta.url));
  const material = pack();
  const env = {
    ...process.env,
    ASI_REVIEWER_PERMIT:JSON.stringify(material.permit),
    ASI_REVIEWER_BUDGET:JSON.stringify(material.budget),
    ASI_REVIEWER_OWNER_PUBLIC_KEY:pem,
    HEAD_SHA:HEAD,
    ASI_REVIEWER_NOW_MS:String(NOW),
  };
  delete env.CLOUDRU_API_KEY;
  const local = spawnSync(process.execPath, [cli, '--phase', 'local'], {encoding:'utf8', env});
  assert.equal(local.status, 0, local.stderr);
  assert.equal(local.stdout.trim(), 'LOCAL_OK');
  const commit = spawnSync(process.execPath, [cli, '--phase', 'commit'], {
    encoding:'utf8', env:{...env, EXPECTED_DIGEST:material.digest},
  });
  assert.equal(commit.status, 2);
  assert.equal(commit.stdout.trim(), 'BUDGET_UNVERIFIED');
  assert.equal(commit.stdout.includes('ADMIT'), false);
});

test('workflow injects the Cloud.ru key only after ADMIT and has no paid fallback', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ai-reviewer.yml', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
  const admitAt = workflow.indexOf('- name: Admit reviewer permit and budget');
  const claimAt = workflow.indexOf('- name: Claim one-time reviewer permit');
  const paidAt = workflow.indexOf('- name: Run Adversarial Model Review & Submit Verdict');
  const keyAt = workflow.indexOf('CLOUDRU_API_KEY:');
  assert.ok(admitAt > 0 && claimAt > admitAt && paidAt > claimAt && keyAt > paidAt);
  assert.equal(workflow.slice(0, paidAt).includes('CLOUDRU_API_KEY'), false);
  assert.equal(workflow.slice(0, paidAt).includes('foundation-models.api.cloud.ru'), false);
  assert.equal((workflow.match(/foundation-models\.api\.cloud\.ru/g) || []).length, 1);
  assert.equal((workflow.match(/CLOUDRU_API_KEY:/g) || []).length, 1);
  assert.match(workflow, /if: \$\{\{ success\(\) && steps\.commit\.outputs\.code == 'ADMIT' \}\}/);
  assert.match(workflow, /ASI_REVIEWER_ADMIT !== "ADMIT"/);
  assert.match(workflow, /console\.error\("NO_SIGNED_REVIEWER_PERMIT"\)/);
  assert.doesNotMatch(workflow, /continue-on-error/);
  const source = readFileSync(new URL('../reviewer-permit.mjs', import.meta.url), 'utf8');
  const cli = readFileSync(new URL('../reviewer-permit-cli.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('foundation-models') || cli.includes('foundation-models'), false);
  assert.equal(source.includes('api.cloud.ru') || cli.includes('api.cloud.ru'), false);
});
