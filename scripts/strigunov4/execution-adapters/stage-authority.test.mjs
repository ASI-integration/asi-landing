import test from 'node:test';
import assert from 'node:assert/strict';
import {stagePolicyHash,validateStagePolicy,verifyOwnerStageDecision,authorizeStageTask} from './stage-authority.mjs';
const now=1792860000000,base='a'.repeat(40);
const operations=['create-tree','create-commit','create-branch','create-draft-pr'];
const first={id:'g1-rehost-acceptance-20261024',workOrderId:'g1-rehost-acceptance-source',
 branch:'asi/engine-task/g1-rehost-acceptance-20261024',baseSha:base,
 paths:['scripts/strigunov4/c4_unit_repair_phase_contract.py','scripts/strigunov4/test_c4_unit_repair_phase_contract.py'],
 operations};
const second={id:'g1-safe-phase-verification-20261024',workOrderId:'g1-safe-phase-verification',
 branch:'asi/engine-task/g1-safe-phase-verification-20261024',baseSha:base,
 paths:['scripts/strigunov4/c4_unit_readonly.py'],operations};
const policy=()=>({schema:'asi.stage-authority.v1',repository:'ASI-integration/asi-landing',
 stage:'S4-G1',issue:511,baseSha:base,notBefore:now-60000,expiresAt:now+86400000,
 tasks:[structuredClone(first),structuredClone(second)]});
const comment=p=>({body:'ASI-OWNER-STAGE-APPROVE:S4-G1:511:'+stagePolicyHash(p),
 user:{id:207600140},created_at:new Date(now-30000).toISOString(),updated_at:new Date(now-30000).toISOString()});
test('one owner attestation covers two exact tasks, no signature per task',async()=>{
 const p=policy(),grant=await verifyOwnerStageDecision(p,{now,readTrustedComments:async()=>[comment(p)]});
 assert.equal(authorizeStageTask(p,grant,p.tasks[0],{now}).admitted,true);
 assert.equal(authorizeStageTask(p,grant,p.tasks[1],{now,completedIds:[p.tasks[0].id]}).executionAllowed,false);
 assert.throws(()=>authorizeStageTask(p,grant,p.tasks[0],{now,completedIds:[p.tasks[0].id]}),/ALREADY_COMPLETED/);
});
test('missing, forged, changed, duplicate or edited owner comment rejected',async()=>{
 const p=policy(),c=comment(p);
 for(const comments of [[],[{...c,user:{id:42}}],[{...c,body:c.body+'x'}],
  [{...c,updated_at:new Date(now).toISOString()}],[c,c]]){
  await assert.rejects(verifyOwnerStageDecision(p,{now,readTrustedComments:async()=>comments}),/OWNER_STAGE_DECISION_NOT_VERIFIED/);
 }
});
test('arbitrary task/paths/branch/operations rejected after approval',async()=>{
 const p=policy(),grant=await verifyOwnerStageDecision(p,{now,readTrustedComments:async()=>[comment(p)]});
 for(const changed of [{...first,paths:['scripts/strigunov4/other.py']},
  {...first,branch:'asi/engine-task/other-20261024'},
  {...first,baseSha:'b'.repeat(40)},
  {...first,operations:[...operations,'merge']}])
  assert.throws(()=>authorizeStageTask(p,grant,changed,{now}),/NOT_APPROVED/);
 assert.throws(()=>authorizeStageTask(p,{},first,{now}),/GRANT_INVALID/);
});
test('expiry, wrong repository, stage, issue and excessive lifetime denied',()=>{
 for(const change of [{expiresAt:now},{notBefore:now+1},{expiresAt:now+15*86400000},
  {stage:'S4-G2'},{issue:512},{repository:'unauthorized/repo'}])
   assert.throws(()=>validateStagePolicy({...policy(),...change},now),/SCOPE_OR_EXPIRY/);
});
test('no YAML, workflows, paths outside allowlist or identity reuse',()=>{
 for(const jobs of [[{...first,paths:['.github/workflows/x.yml']},second],
  [{...first,paths:['scripts/strigunov4/other.js']},second],
  [first,{...second,workOrderId:first.workOrderId}],
  [first,{...second,branch:first.branch}],
  [first,{...second,operations:[...operations,'delete-branch']}],
  [first,{...second,paths:['scripts/strigunov4/../other.py']}]]){
  assert.throws(()=>validateStagePolicy({...policy(),tasks:jobs},now),/STAGE_TASK_SCOPE|STAGE_TASK_REPLAY/);
 }
});
test('post-approval modifications and expired capability denied',async()=>{
 const p=policy(),grant=await verifyOwnerStageDecision(p,{now,readTrustedComments:async()=>[comment(p)]});
 p.tasks[1].paths=['scripts/strigunov4/c4_unit_contract.py'];
 assert.throws(()=>authorizeStageTask(p,grant,p.tasks[0],{now}),/GRANT_INVALID/);
 const clean=policy();
 assert.throws(()=>authorizeStageTask(clean,grant,clean.tasks[0],{now:now+2*86400000}),/GRANT_INVALID|SCOPE_OR_EXPIRY/);
});
