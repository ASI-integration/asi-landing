/**
 * Owner security ceiling — source-only, not an installation permit.
 * Do not tighten mandatory review/approval policy unless the owner changes
 * the protected security-baseline contract via an authenticated exact-head PR.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

export const OWNER_SECURITY_BASELINE = 'docs/agent-os/owner-security-baseline.json';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const pinned=Object.freeze({
  schema:'asi.owner-security-baseline.v1',
  policyVersion:1,owner:'ASI-integration',level:'NORMAL_OWNER_CONTROLLED',
  bootstrap:{
    target:'pqukibofpo',existingEngineOnly:true,g2WitnessJobs:2,
    permittedReviewMode:'OWNER_VERIFIED_CI',
    secondHumanReviewerMandatory:false,
    ownerApprovalMode:'ONE_AUTHENTICATED_EXACT_HEAD',
    reapproveEveryIntermediateCommit:false
  },
  standingDelegation:{
    parentMaxDays:365,childMaxDays:14,
    repeatOwnerApprovalsForInScopeChildren:false,
    effectiveOnlyAfterNativeSignedVerifierAndRevocation:true
  },
  retainedSafeguards:{
    signedPrivilegedInstallation:true,exactScopeAndBudget:true,
    revocablePermission:true,existingLocksAndNoReplay:true,
    statePreservingRollback:true,noUnauthorizedProductionEffects:true,
    noOwnerImpersonation:true
  },
  changeControl:{
    changeRequiresAuthenticatedOwnerExactPrHead:true,
    changeApprovalKind:'SECURITY-BASELINE-CHANGE',
    automaticSecurityEscalationAllowed:false,
    appOrBotMayApprove:false
  }
});
const requirePolicy=(condition,reason)=>{if(!condition)throw Error(reason);};
export function validateOwnerSecurityBaseline(value) {
  requirePolicy(isDeepStrictEqual(value,pinned),
    'OWNER_SECURITY_LEVEL_CHANGED_REQUIRES_EXACT_HEAD_OWNER_APPROVAL');
  return Object.freeze({
    status:'NORMAL_OWNER_CONTROLLED_SOURCE_VERIFIED',
    secondHumanReviewerMandatory:false,
    authenticatedOwnerApprovalForPolicyChange:true,
    effectiveOnProtectedMain:false,
    liveEngineAuthority:false
  });
}
export function verifyOwnerBootstrapSource(source) {
  requirePolicy(typeof source==='string' &&
    source.includes("if review.get('mode')=='OWNER_VERIFIED_CI':") &&
    source.includes("review.get('independent') is False") &&
    source.includes('verified_owner_ci_run('),
    'OWNER_VERIFIED_CI_PATH_REMOVED_OR_CHANGED');
  return true;
}
export function verifyOwnerRepairSource(source) {
  requirePolicy(typeof source==='string' &&
    source.includes("if repairReview.get('mode')=='OWNER_VERIFIED_CI':") &&
    source.includes("repairReview.get('independent') is False") &&
    source.includes('i.verified_owner_ci_run('),
    'REPAIR_OWNER_VERIFIED_CI_REMOVED_OR_SECOND_REVIEWER_FORCED');
  return true;
}
export function verifyOwnerSecurityFiles(repoRoot=ROOT) {
  const value=JSON.parse(fs.readFileSync(path.join(repoRoot,OWNER_SECURITY_BASELINE),'utf8'));
  const source=fs.readFileSync(path.join(repoRoot,'scripts/strigunov4/execution-adapters/beget-install.py'),'utf8');
  const result=validateOwnerSecurityBaseline(value);
  verifyOwnerBootstrapSource(source);
  const repair=path.join(repoRoot,'scripts/strigunov4/execution-adapters/beget-staged-repair.py');
  if(fs.existsSync(repair))
    verifyOwnerRepairSource(fs.readFileSync(repair,'utf8'));
  return result;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(verifyOwnerSecurityFiles())+'\n');}
  catch(err){
    process.stderr.write(JSON.stringify({status:'OWNER_SECURITY_BASELINE_BLOCK',reason:err.message})+'\n');
    process.exitCode=1;
  }
}
