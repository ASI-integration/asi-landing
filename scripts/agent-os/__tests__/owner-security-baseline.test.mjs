import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateOwnerSecurityBaseline,verifyOwnerSecurityFiles,
  verifyOwnerBootstrapSource,OWNER_SECURITY_BASELINE}
  from '../verify-owner-security-baseline.mjs';
import {GOVERNANCE,OWNER_BASELINE_PATHS,requiredApproval,checkPr,CONTRACT}
  from '../check-demo-release.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const baseline=JSON.parse(fs.readFileSync(path.join(root,OWNER_SECURITY_BASELINE),'utf8'));
const contract=JSON.parse(fs.readFileSync(path.join(root,CONTRACT),'utf8'));
const HEAD='a'.repeat(40),NUMBER=567;
const clone=()=>structuredClone(baseline);
const exactChanged=['docs/agent-os/owner-security-baseline.json'];
test('normal security owner baseline is exact, machine checked, not live grant',()=>{
  const r=verifyOwnerSecurityFiles(root);
  assert.equal(r.status,'NORMAL_OWNER_CONTROLLED_SOURCE_VERIFIED');
  assert.equal(r.secondHumanReviewerMandatory,false);
  assert.equal(r.liveEngineAuthority,false);
  assert.equal(r.effectiveOnProtectedMain,false);
});
test('silent second reviewer, extra approval and shorter parent/child period all fail',()=>{
  const attempts=[
    x=>x.bootstrap.secondHumanReviewerMandatory=true,
    x=>x.bootstrap.permittedReviewMode='INDEPENDENT_HUMAN',
    x=>x.bootstrap.ownerApprovalMode='TWO_HUMAN_APPROVALS',
    x=>x.bootstrap.reapproveEveryIntermediateCommit=true,
    x=>x.standingDelegation.parentMaxDays=14,
    x=>x.standingDelegation.childMaxDays=7,
    x=>x.standingDelegation.repeatOwnerApprovalsForInScopeChildren=true,
    x=>x.changeControl.automaticSecurityEscalationAllowed=true,
    x=>x.changeControl.appOrBotMayApprove=true,
    x=>x.bootstrap.g2WitnessJobs=0,
    x=>x.retainedSafeguards.signedPrivilegedInstallation=false,
    x=>{x.newApprovalGate='everthingNeedsNewCommittee'},
  ];
  for(const change of attempts){
    const value=clone();change(value);
    assert.throws(()=>validateOwnerSecurityBaseline(value),
      /OWNER_SECURITY_LEVEL_CHANGED_REQUIRES_EXACT_HEAD_OWNER_APPROVAL/);
  }
});
test('source explicitly retains owner-verified CI option without claiming second-human proof',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/strigunov4/execution-adapters/beget-install.py'),'utf8');
  assert.equal(verifyOwnerBootstrapSource(source),true);
  assert.throws(()=>verifyOwnerBootstrapSource(source.replace(
    "if review.get('mode')=='OWNER_VERIFIED_CI':",'if False:')),
    /OWNER_VERIFIED_CI_PATH_REMOVED_OR_CHANGED/);
});
test('security policy and verifier files are protected governance paths',()=>{
  for(const name of OWNER_BASELINE_PATHS){
    assert.equal(GOVERNANCE.has(name),true,name);
  }
});
test('one exact-head owner attestation is required for a baseline-only change',()=>{
  assert.equal(requiredApproval({contract,changed:exactChanged,prNumber:NUMBER,
    prBody:'',headSha:HEAD}),'SECURITY-BASELINE-CHANGE');
  assert.throws(()=>checkPr({contract,changed:exactChanged,prNumber:NUMBER,
    prBody:'',headSha:HEAD,baseHasContract:true,ownerApproval:false}),
    /GOVERNANCE_CHANGE_NEEDS_VERIFIED_OWNER_ATTESTATION/);
  assert.equal(checkPr({contract,changed:exactChanged,prNumber:NUMBER,
    prBody:'',headSha:HEAD,baseHasContract:true,ownerApproval:true}).status,
    'OWNER_ATTESTED_GOVERNANCE_CHANGE');
});
test('bootstrap with protected gate changed uses one existing CONTRACT-CHANGE comment',()=>{
  const changed=[...exactChanged,'scripts/agent-os/check-demo-release.mjs'];
  assert.equal(requiredApproval({contract,changed,prNumber:NUMBER,
    prBody:'',headSha:HEAD}),'CONTRACT-CHANGE');
  assert.equal(requiredApproval({contract,changed:exactChanged,prNumber:NUMBER,
    prBody:'',headSha:HEAD}),'SECURITY-BASELINE-CHANGE');
});
