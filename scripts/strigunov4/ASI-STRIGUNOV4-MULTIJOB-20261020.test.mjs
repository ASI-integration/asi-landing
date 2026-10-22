import test from 'node:test';
import assert from 'node:assert/strict';
import {decideQueue,validateWorkOrders,verifyRelease,WORK_ORDERS} from './ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';
const SHA='a'.repeat(40);
const stageFiles=['scripts/strigunov4/protected_c4_unit_apply.py',
  '.github/workflows/strigunov4-c4-unit-apply.yml',
  'scripts/strigunov4/test_protected_c4_unit_apply.py'];
function contract(){
 return {schemaVersion:'asi.demo-release.v1',releaseId:'STRIGUNOV4-READY-FOR-DEMO',
  state:'FROZEN_ON_OWNER_MERGE',
  stages:[1,2,3,4,5,6].map(i=>({id:'S4-G'+i,
    status:i===1?'IN_PROGRESS':'NOT_STARTED',proof:[],files:i===1?stageFiles:[],
    plannedFiles:i===1?stageFiles:[]}))};
}
function snapshot(){
 return {contract:contract(),issues:Object.fromEntries([1,2,3,4,5,6].map(i=>
  [510+i,{number:510+i,state:'open',labels:i===1?['agent-source-ready']:[]}])),
  project:{511:'PREPARATION_ONLY'},prs:{
   509:{number:509,head:'b3c8ff2e4904b0b503197d29aa217773918831bc',state:'open',merged:false},
   508:{number:508,head:'8ac8e8ac11e39ac070ccc058218e3b73190cb43f',state:'open',merged:false},
   520:{number:520,head:'6693312b0a94b8afcee3a34907055ce301a5fb3e',state:'open',merged:false}
  },checks:{},reviews:{},ledger:{}};
}
function goodReview(s,num){
 const head=s.prs[num].head;
 s.checks[num]={head,validate:'success',release_governance:'success'};
 s.reviews[num]={head,completed:true,actionable:false};
}
test('all six stages are ordered with a single active stage',()=>{
 assert.equal(verifyRelease(contract()),0);
 const c=contract();c.stages[0].status='ACCEPTED';c.stages[1].status='IN_PROGRESS';
 assert.equal(verifyRelease(c),1);
 c.stages[0].status='IN_PROGRESS';c.stages[1].status='ACCEPTED';
 assert.throws(()=>verifyRelease(c),/RELEASE_SKIP_STAGE/);
});
test('cannot forge release, status, or add arbitrary source paths',()=>{
 let c=contract();c.releaseId='other';assert.throws(()=>verifyRelease(c),/RELEASE_NOT_TRUSTED/);
 c=contract();
 const tickets=WORK_ORDERS.map(x=>({...x}));
 tickets[3].paths=['supabase/migrations/prod.sql'];
 assert.throws(()=>validateWorkOrders(tickets,c),/SOURCE_PATH_NOT_IN_CONTRACT/);
});
test('cannot duplicate tickets or use untrusted SHA for existing PR',()=>{
 const t=WORK_ORDERS.map(x=>({...x}));t[1].id=t[0].id;
 assert.throws(()=>validateWorkOrders(t,contract()),/WORK_ORDER_ID/);
 const other=WORK_ORDERS.map(x=>({...x}));other[1].head=SHA.slice(1);
 assert.throws(()=>validateWorkOrders(other,contract()),/PR_PIN_REQUIRED/);
});
test('existing 508 509 520 never cause duplicate PR or Codex execution',()=>{
 const s=snapshot(),r=decideQueue(s);
 assert.equal(r.stage,'S4-G1');
 assert.equal(r.jobs.filter(x=>x.kind==='review-pr').length,3);
 assert.ok(!r.jobs.some(x=>x.status==='CREATE_PR'||x.status==='RUN_CODEX'));
 assert.ok(r.jobs.some(x=>x.status==='WAIT_CI'));
});
test('PR must have CI and CodeRabbit for exact head',()=>{
 const s=snapshot();goodReview(s,509);
 assert.equal(decideQueue(s).jobs[0].status,'WAIT_OWNER_MERGE');
 s.checks[509].head=SHA;
 assert.equal(decideQueue(s).jobs[0].status,'WAIT_CI');
 goodReview(s,509);s.reviews[509].head=SHA;
 assert.equal(decideQueue(s).jobs[0].status,'WAIT_REVIEW');
});
test('merged PR 509 with reviewed exact updated head unlocks only source preparation',()=>{
 const s=snapshot();
 s.prs[509]={number:509,head:'b3c8ff2e4904b0b503197d29aa217773918831bc',state:'closed',merged:true};
 const r=decideQueue(s);
 assert.equal(WORK_ORDERS.find(x=>x.pr===509).head,s.prs[509].head);
 assert.equal(r.jobs[0].status,'MERGED');
 assert.equal(r.jobs[3].status,'SOURCE_PREPARATION_READY');
 assert.equal(r.jobs[4].status,'WAIT_PROTECTED_APPROVAL');
 assert.ok(!r.jobs.some(x=>x.status==='MERGE'||x.status==='EXECUTE'));
});
test('stale or replaced PR 509 blocks source preparation',()=>{
 const s=snapshot();s.prs[509].head=SHA;
 const r=decideQueue(s);
 assert.equal(r.jobs[0].status,'BLOCKED');
 assert.equal(r.jobs[3].status,'WAIT_DEPENDENCY');
 assert.equal(r.decision,'BLOCKED_NEEDS_RECONCILIATION');
});
test('open reviewed PR is owner decision, not an automatic merge',()=>{
 const s=snapshot();[508,509,520].forEach(n=>goodReview(s,n));
 const r=decideQueue(s);
 assert.equal(r.jobs[0].status,'WAIT_OWNER_MERGE');
 assert.equal(r.jobs[1].status,'WAIT_OWNER_MERGE');
 assert.equal(r.jobs[3].status,'SOURCE_PREPARATION_READY');
 assert.equal(r.jobs[4].status,'WAIT_PROTECTED_APPROVAL');
});
test('no Projects gate means no source preparation even with good CI',()=>{
 const s=snapshot();goodReview(s,509);
 delete s.project[511];
 assert.equal(decideQueue(s).jobs[3].status,'WAIT_PROJECT');
});
test('uncertain historical job is not replayed',()=>{
 const s=snapshot();goodReview(s,509);
 s.ledger['g1-unit-apply-source']={status:'UNKNOWN'};
 assert.equal(decideQueue(s).jobs[3].status,'BLOCKED');
});
test('failed ledger record without trusted PR blocks replay',()=>{
 const s=snapshot();goodReview(s,509);
 s.ledger['g1-unit-apply-source']={status:'FAILED'};
 const decision=decideQueue(s);
 assert.equal(decision.jobs[3].status,'BLOCKED');
 assert.equal(decision.jobs[3].reason,'JOB_LEDGER_RECONCILIATION');
 assert.ok(!decision.actions.some(x=>x.job==='g1-unit-apply-source'));
});
test('already-published work is observed, not reissued',()=>{
 const s=snapshot();goodReview(s,509);
 s.ledger['g1-unit-apply-source']={publishedPr:521,head:SHA};
 assert.equal(decideQueue(s).jobs[3].status,'EXISTING_PR');
});
test('red physical actions cannot be made source-ready',()=>{
 const s=snapshot();[508,509,520].forEach(n=>goodReview(s,n));
 assert.equal(decideQueue(s).jobs[4].status,'WAIT_PROTECTED_APPROVAL');
});
test('accepted G1 activates G2, not G3-G6',()=>{
 const s=snapshot();s.contract.stages[0].status='ACCEPTED';
 s.contract.stages[1].status='IN_PROGRESS';
 const r=decideQueue(s);
 assert.equal(r.stage,'S4-G2');assert.equal(r.issue,512);
 assert.equal(r.jobs.length,1);
 assert.equal(r.jobs[0].status,'WAIT_PROTECTED_APPROVAL');
});
test('all accepted ends roadmap without a new release',()=>{
 const s=snapshot();s.contract.stages.forEach(x=>{x.status='ACCEPTED';x.proof=['physical'];});
 const r=decideQueue(s);
 assert.equal(r.decision,'AWAIT_FINAL_OWNER_ACCEPTANCE');
 assert.deepEqual(r.actions,[]);
});
test('issue metadata must be trusted, not issue text',()=>{
 const s=snapshot();s.issues[511].number=999;
 assert.throws(()=>decideQueue(s),/ACTIVE_ISSUE_UNVERIFIED/);
});
test('blocked intake must not give source permission',()=>{
 const s=snapshot();goodReview(s,509);
 s.issues[511].labels.push('agent-intake-blocked');
 assert.equal(decideQueue(s).jobs[3].status,'WAIT_INTAKE');
});
test('optional failed PR remains visible without blocking a mandatory source job',()=>{
 const s=snapshot();goodReview(s,509);s.prs[520].state='closed';
 const q=decideQueue(s);
 assert.equal(q.jobs.find(j=>j.job==='g1-pr520-receipt-test').status,'BLOCKED');
 assert.equal(q.decision,'SOURCE_PLAN_AVAILABLE');
});
test('mandatory failed dependency still blocks despite optional PR being ignorable',()=>{
 const s=snapshot();s.prs[509].state='closed';s.prs[520].state='closed';
 const q=decideQueue(s);
 assert.equal(q.decision,'BLOCKED_NEEDS_RECONCILIATION');
 assert.equal(q.jobs.find(j=>j.job==='g1-unit-apply-source').status,'WAIT_DEPENDENCY');
});
test('restart does not forget an uncertain source record',()=>{
 const s=snapshot();goodReview(s,509);s.ledger['g1-unit-apply-source']={status:'FAILED'};
 assert.deepEqual(decideQueue(JSON.parse(JSON.stringify(s))),decideQueue(s));
 assert.equal(decideQueue(s).decision,'BLOCKED_NEEDS_RECONCILIATION');
});
test('pilot requires host opt-in and does not open G2',()=>{
 const s=snapshot();goodReview(s,509);
 s.contract.stages[0].files=[...stageFiles,'scripts/strigunov4/test_c4_unit_readonly.py'];
 assert.ok(!decideQueue(s).jobs.some(j=>j.job==='g1-engine-receipt-replay-test'));
 const q=decideQueue(s,{enginePilot:true});assert.equal(q.stage,'S4-G1');
 assert.equal(q.jobs.find(j=>j.job==='g1-engine-receipt-replay-test').status,'SOURCE_PREPARATION_READY');
 s.contract.stages[1].status='IN_PROGRESS';
 assert.throws(()=>decideQueue(s,{enginePilot:true}),/RELEASE_SKIP_STAGE/);
});
