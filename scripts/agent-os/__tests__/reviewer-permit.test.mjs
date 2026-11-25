import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  OWNER_TRUST_ROOT, admitReviewerCall, decideSpend, inspectPermitConstraints, reviewLocalPermit,
  reviewerKeyFingerprint,
} from '../reviewer-permit.mjs';

const NOW = 1_800_000_000_000;
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const owner = generateKeyPairSync('ed25519');
const forger = generateKeyPairSync('ed25519');
const pem = owner.publicKey.export({type:'spki', format:'pem'});
const fingerprint = reviewerKeyFingerprint(pem);
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
const derivedExpected = {headSha:HEAD, ownerKeySha256:fingerprint};
const pinnedExpected = {headSha:HEAD, ownerKeySha256:OWNER_TRUST_ROOT};

test('production root is the owner constant, not the key under test', () => {
  assert.equal(OWNER_TRUST_ROOT, '179cf786e1448ff1a3fccbe426d59aa3a3482050d98f5a8c82fd2f6a8a0b6a4d');
  assert.notEqual(fingerprint, OWNER_TRUST_ROOT);
  const material = pack();
  const derived = reviewLocalPermit({
    ...material, ownerPublicKey:pem, expected:derivedExpected, now:NOW,
  });
  assert.equal(derived.reason, 'TRUST_ROOT');
  assert.equal(derived.admit, false);
  const swapped = reviewLocalPermit({
    ...material, ownerPublicKey:pem, expected:pinnedExpected, now:NOW,
  });
  assert.equal(swapped.reason, 'TRUST_ROOT');
  const cli = readFileSync(new URL('../reviewer-permit-cli.mjs', import.meta.url), 'utf8');
  assert.match(cli, /ownerKeySha256:\s*OWNER_TRUST_ROOT/);
  assert.equal(cli.includes('reviewerKeyFingerprint'), false);
});

test('a valid attacker signature and a substituted pin do not open the paid path', async () => {
  const material = pack({}, {}, forger.privateKey);
  const forgerPem = forger.publicKey.export({type:'spki', format:'pem'});
  let claims = 0;
  const result = await admitReviewerCall({
    ...material,
    ownerPublicKey:forgerPem,
    expected:{headSha:HEAD, ownerKeySha256:reviewerKeyFingerprint(forgerPem)},
    now:NOW,
    replayLedger:{trusted:true, digests:[]},
    liveTask:{verified:true, taskId:'686', hold:false},
    claim: async () => { claims += 1; return true; },
  });
  assert.equal(result.code, 'NO_SIGNED_REVIEWER_PERMIT');
  assert.equal(result.reason, 'TRUST_ROOT');
  assert.equal(result.admit, false);
  assert.equal(claims, 0);
});

test('constraint checks still reject tamper, expiry, rebound HEAD, replay and zero budget', async () => {
  const material = pack();
  const base = {...material, ownerPublicKey:pem, expected:derivedExpected, now:NOW};
  const tampered = inspectPermitConstraints({
    ...base, permit:{...material.permit, payload:material.permit.payload.replace('686', '687')},
  });
  assert.equal(tampered.reason, 'PERMIT_SIGNATURE');
  const expired = pack({notBefore:NOW - 1000, expiresAt:NOW - 1});
  assert.equal(inspectPermitConstraints({
    ...expired, ownerPublicKey:pem, expected:derivedExpected, now:NOW,
  }).reason, 'PERMIT_EXPIRED');
  assert.equal(inspectPermitConstraints({
    ...material, ownerPublicKey:pem, expected:{headSha:OTHER, ownerKeySha256:fingerprint}, now:NOW,
  }).reason, 'PERMIT_HEAD');
  const consumed = pack({}, {consumedPermitDigests:[material.digest], authorizedPermitDigest:material.digest});
  assert.equal(inspectPermitConstraints({
    permit:material.permit, budget:consumed.budget, ownerPublicKey:pem, expected:derivedExpected, now:NOW,
  }).reason, 'PERMIT_REPLAY');
  assert.equal(inspectPermitConstraints({
    permit:material.permit,
    budget:seal(budgetBody(material.digest, {capRub:0, remainingRub:0})),
    ownerPublicKey:pem, expected:derivedExpected, now:NOW,
  }).code, 'BUDGET_CAP_ZERO');
  assert.equal(inspectPermitConstraints({
    permit:material.permit,
    budget:seal(budgetBody(material.digest, {taskState:'HOLD'})),
    ownerPublicKey:pem, expected:derivedExpected, now:NOW,
  }).code, 'BUDGET_HOLD');
  const fresh = inspectPermitConstraints(base);
  assert.equal(fresh.code, 'LOCAL_OK');
  assert.equal(fresh.admit, false);
  assert.equal(decideSpend(fresh).code, 'NO_SPEND');
  assert.equal(decideSpend(fresh).reason, 'ESCROW_RESERVATION_UNAVAILABLE');
  assert.equal(decideSpend({ok:true, admit:true, code:'ADMIT'}).code, 'NO_SPEND');
});

test('parallel admissions reserve nothing and ignore comment ledgers', async () => {
  const material = pack();
  const comments = [];
  const results = await Promise.all(Array.from({length:24}, () => admitReviewerCall({
    ...material,
    ownerPublicKey:pem,
    expected:pinnedExpected,
    now:NOW,
    replayLedger:{trusted:true, digests:comments.slice()},
    claim: async digest => { comments.push(digest); return true; },
  })));
  assert.equal(comments.length, 0);
  assert.ok(results.every(result => result.admit === false && result.code !== 'ADMIT'));
  const spends = await Promise.all(Array.from({length:24}, () => decideSpend({
    ok:true, admit:false, code:'LOCAL_OK', reason:'LOCAL_OK',
  })));
  assert.ok(spends.every(result => result.code === 'NO_SPEND' && result.admit === false));
});

test('cli and workflow have no model client and cannot admit from two processes', async () => {
  const cli = fileURLToPath(new URL('../reviewer-permit-cli.mjs', import.meta.url));
  const moduleSource = readFileSync(new URL('../reviewer-permit.mjs', import.meta.url), 'utf8');
  const cliSource = readFileSync(cli, 'utf8');
  const workflow = readFileSync(new URL('../../../.github/workflows/ai-reviewer.yml', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
  for (const source of [moduleSource, cliSource, workflow]) {
    assert.equal(source.includes('foundation-models'), false);
    assert.equal(source.includes('api.cloud.ru'), false);
    assert.equal(source.includes('api.github.com'), false);
    assert.equal(source.includes('CLOUDRU_API_KEY'), source === cliSource);
  }
  assert.equal(workflow.includes('CLOUDRU_API_KEY'), false);
  assert.equal(moduleSource.includes('admit:true'), false);
  assert.match(workflow, /ESCROW|escrow|NO-SPEND/);
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
  const run = phase => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, '--phase', phase], {env});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({code, stdout, stderr}));
  });
  const [left, right] = await Promise.all([run('local'), run('commit')]);
  for (const result of [left, right]) {
    assert.equal(result.code, 2, result.stderr);
    assert.equal(result.stdout.trim(), 'NO_SIGNED_REVIEWER_PERMIT');
    assert.equal(result.stdout.includes('ADMIT'), false);
  }
  const secret = 'super-secret-cloud-key';
  const leaked = await new Promise(resolve => {
    const child = spawn(process.execPath, [cli], {env:{...env, CLOUDRU_API_KEY:secret}});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({code, stdout, stderr}));
  });
  assert.equal(leaked.code, 2);
  assert.equal(leaked.stdout.trim(), 'NO_SPEND');
  assert.equal(`${leaked.stdout}${leaked.stderr}`.includes(secret), false);
});
