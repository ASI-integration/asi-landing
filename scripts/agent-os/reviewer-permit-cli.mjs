/**
 * Workflow entry for the no-spend reviewer gate.
 * The expected owner fingerprint is the source constant, never the fingerprint
 * of ASI_REVIEWER_OWNER_PUBLIC_KEY. Exit 0 and ADMIT are unreachable.
 * Issue comments are not read or written.
 */
import {OWNER_TRUST_ROOT, admitReviewerCall} from './reviewer-permit.mjs';

const finish = code => {
  const safe = code === 'ADMIT' || code === 'LOCAL_OK' ? 'NO_SPEND' : code;
  console.log(safe);
  process.exit(2);
};

if (Object.hasOwn(process.env, 'CLOUDRU_API_KEY')) finish('NO_SPEND');

let permit = null;
let budget = null;
if (process.env.ASI_REVIEWER_PERMIT || process.env.ASI_REVIEWER_BUDGET) {
  try {
    permit = JSON.parse(process.env.ASI_REVIEWER_PERMIT || 'null');
    budget = JSON.parse(process.env.ASI_REVIEWER_BUDGET || 'null');
  } catch {
    finish('NO_SIGNED_REVIEWER_PERMIT');
  }
}

const decision = await admitReviewerCall({
  permit,
  budget,
  ownerPublicKey: process.env.ASI_REVIEWER_OWNER_PUBLIC_KEY || '',
  expected: {headSha: process.env.HEAD_SHA || '', ownerKeySha256: OWNER_TRUST_ROOT},
  now: Number(process.env.ASI_REVIEWER_NOW_MS || Date.now()),
});
if (!decision || decision.admit === true || decision.code === 'ADMIT' || decision.code === 'LOCAL_OK') finish('NO_SPEND');
finish(decision.code);
