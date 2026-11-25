/**
 * Workflow entry. Refuses before any model call.
 * --phase local: signature, exact HEAD, expiry, task, cap, signed budget. No network.
 * --phase commit: repeats local checks, then live HOLD/budget observation and one-time claim.
 * Neither phase reads a successful path that contacts Cloud.ru.
 */
import {appendFileSync} from 'node:fs';
import {createPublicKey} from 'node:crypto';
import {admitReviewerCall, reviewLocalPermit, reviewerKeyFingerprint, observeReviewerTask, claimPermitDigest} from './reviewer-permit.mjs';

const finish = (code, digest) => {
  if (process.env.GITHUB_OUTPUT && code === 'LOCAL_OK' && digest) {
    appendFileSync(process.env.GITHUB_OUTPUT, `code=LOCAL_OK\ndigest=${digest}\ntask=${process.env.ASI_REVIEWER_TASK_OUT || ''}\n`);
  }
  if (process.env.GITHUB_OUTPUT && code === 'ADMIT' && digest) {
    appendFileSync(process.env.GITHUB_OUTPUT, `code=ADMIT\ndigest=${digest}\n`);
  }
  console.log(code);
  process.exit(code === 'LOCAL_OK' || code === 'ADMIT' ? 0 : 2);
};

if (Object.hasOwn(process.env, 'CLOUDRU_API_KEY')) finish('NO_SIGNED_REVIEWER_PERMIT');

const phase = process.argv.includes('--phase') ? process.argv[process.argv.indexOf('--phase') + 1] : '';
if (phase !== 'local' && phase !== 'commit') finish('NO_SIGNED_REVIEWER_PERMIT');

let permit;
let budget;
try {
  permit = JSON.parse(process.env.ASI_REVIEWER_PERMIT || '');
  budget = JSON.parse(process.env.ASI_REVIEWER_BUDGET || '');
} catch {
  finish('NO_SIGNED_REVIEWER_PERMIT');
}

const ownerPublicKey = process.env.ASI_REVIEWER_OWNER_PUBLIC_KEY || '';
const ownerKeySha256 = reviewerKeyFingerprint(ownerPublicKey);
if (!ownerKeySha256) finish('NO_SIGNED_REVIEWER_PERMIT');
try {
  if (createPublicKey(ownerPublicKey).asymmetricKeyType !== 'ed25519') finish('NO_SIGNED_REVIEWER_PERMIT');
} catch {
  finish('NO_SIGNED_REVIEWER_PERMIT');
}

const expected = {headSha:process.env.HEAD_SHA || '', ownerKeySha256};
const now = Number(process.env.ASI_REVIEWER_NOW_MS || Date.now());
const local = reviewLocalPermit({permit, budget, ownerPublicKey, expected, now});
if (!local.ok) finish(local.code);
if (phase === 'commit' && process.env.EXPECTED_DIGEST !== local.digest) finish('NO_SIGNED_REVIEWER_PERMIT');
if (phase === 'local') {
  process.env.ASI_REVIEWER_TASK_OUT = local.taskId;
  finish('LOCAL_OK', local.digest);
}

const token = process.env.BOT_TOKEN || '';
let observed;
try {
  observed = await observeReviewerTask({taskId:local.taskId, token, fetchImpl:globalThis.fetch});
} catch {
  observed = {verified:false};
}
const decision = await admitReviewerCall({
  permit, budget, ownerPublicKey, expected, now,
  liveTask: observed.verified === true
    ? {verified:true, taskId:observed.taskId, hold:observed.hold === true}
    : {verified:false, taskId:local.taskId, hold:true},
  replayLedger: observed.verified === true
    ? {trusted:true, digests:[...observed.digests].sort()}
    : {trusted:false, digests:[]},
  claim: digest => claimPermitDigest({taskId:local.taskId, digest, token, fetchImpl:globalThis.fetch}),
});
if (!decision.admit) finish(decision.code);
finish('ADMIT', decision.digest);
