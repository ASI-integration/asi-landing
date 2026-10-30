import test from 'node:test';
import assert from 'node:assert/strict';
import {captureParentTaskLeaseProposal as capture} from './standing-parent-task-lease-proposal.mjs';
const h='a'.repeat(64),s='a'.repeat(40),tx='12345678-1234-1234-1234-123456789012';
function fixture(phase='started',kind='create-commit'){
  const parent={digest:h,repo:'ASI-integration/asi-landing',environment:'beget-staging',target:'pqukibofpo',
    action:'source',stage:'S4-G2',approvedRoutineClasses:['stage4-source-maintenance','stage4-source-test']};
  const child={...parent,digest:'b'.repeat(64),parentDigest:h,approvedRoutineClasses:['stage4-source-maintenance']};
  const ledger={mode:'FAILED_LOCKED',reason:'IN_FLIGHT_OR_CRASHED'};
  const selectedTask=phase==='admission'?null:{id:'task-1',sha:s,stage:'S4-G2',repo:parent.repo};
  const lease={transactionId:tx,phase,kind:'github-publisher',root:'/isolated/worker',ledger,
    taskId:selectedTask?.id??null,taskSha:selectedTask?.sha??null};
  const effect={taskId:selectedTask?.id??`admission-${tx}`,taskSha:s,transactionId:tx,
    stage:'S4-G2',phase,kind,routineClass:'stage4-source-maintenance',requestSha256:h};
  return {parent,child,effect,lease,selectedTask,baseSha:s};
}
function check(f){const r=capture(f);return r.assessAfter?.({lease:f.lease,selectedTask:f.selectedTask,effect:f.effect})??r;}
test('selected started write is source-eligible but never authorized',()=>{
  const r=check(fixture());assert.equal(r.status,'PARENT_TASK_SOURCE_ELIGIBLE');assert.equal(r.authorized,false);
});
test('admission bootstrap read before any task selection counts in source contract',()=>{
  const r=check(fixture('admission','github-read'));assert.equal(r.status,'PARENT_TASK_SOURCE_ELIGIBLE');
});
test('pre-STARTED verify read with native selected task counts',()=>{
  const r=check(fixture('preflight','github-read'));assert.equal(r.status,'PARENT_TASK_SOURCE_ELIGIBLE');
});
test('postflight read is source-eligible, never a second write',()=>{
  const r=check(fixture('postflight','github-read'));assert.equal(r.status,'PARENT_TASK_SOURCE_ELIGIBLE');
});
test('preflight and unselected admission write always denied',()=>{
  assert.equal(check(fixture('preflight','create-tree')).reason,'WRITE_BEFORE_STARTED');
  assert.equal(check(fixture('admission','create-commit')).reason,'WRITE_BEFORE_STARTED');
});
test('conflicting child stage and effect stage denied',()=>{
  const f=fixture();f.child.stage='S4-G1';assert.equal(check(f).reason,'PARENT_CHILD_STAGE_OR_CLASS_SCOPE');
  const q=fixture();q.effect.stage='S4-G1';assert.equal(check(q).reason,'PARENT_CHILD_STAGE_OR_CLASS_SCOPE');
});
test('child cannot widen parent routine classes or claim unapproved class',()=>{
  const f=fixture();f.child.approvedRoutineClasses=['stage4-source-test','unknown'];
  assert.equal(check(f).reason,'PARENT_CHILD_STAGE_OR_CLASS_SCOPE');
  const q=fixture();q.effect.routineClass='stage4-source-test';
  assert.equal(check(q).reason,'PARENT_CHILD_STAGE_OR_CLASS_SCOPE');
});
test('changed task between capture and reserve denied',()=>{
  const f=fixture();const snap=capture(f);assert.equal(snap.status,'PARENT_TASK_SOURCE_SNAPSHOT');
  const other={...f.selectedTask,id:'task-2'};
  const result=snap.assessAfter({lease:f.lease,selectedTask:other,effect:f.effect});
  assert.equal(result.reason,'POST_AWAIT_LEASE_OR_TASK_CHANGED');
});
test('phase and transaction switch after asynchronous boundary denied',()=>{
  const f=fixture();const snap=capture(f);
  assert.equal(snap.assessAfter({lease:{...f.lease,phase:'postflight'},selectedTask:f.selectedTask,effect:f.effect}).reason,
    'POST_AWAIT_LEASE_OR_TASK_CHANGED');
  assert.equal(snap.assessAfter({lease:{...f.lease,transactionId:'another-transaction'},selectedTask:f.selectedTask,effect:f.effect}).reason,
    'POST_AWAIT_LEASE_OR_TASK_CHANGED');
});
test('selected task never synthesized during pre-task admission',()=>{
  const f=fixture('admission','github-read');f.selectedTask={id:'task-1',sha:s,stage:'S4-G2',repo:f.parent.repo};
  assert.equal(check(f).reason,'PRETASK_ADMISSION_NOT_BOUND');
});
test('bootstrap base SHA and original wire fingerprint pinned across await',()=>{
  const f=fixture('admission','github-read');f.baseSha='b'.repeat(40);
  assert.equal(check(f).reason,'PRETASK_ADMISSION_NOT_BOUND');
  const q=fixture('admission','github-read');const snap=capture(q);
  assert.equal(snap.assessAfter({lease:q.lease,selectedTask:null,effect:{...q.effect,requestSha256:'b'.repeat(64)}}).reason,
    'POST_AWAIT_LEASE_OR_TASK_CHANGED');
});
test('lost or wrong native lock-owned ledger context denied',()=>{
  const f=fixture();f.lease.ledger.mode='IDLE';
  assert.equal(check(f).reason,'NATIVE_LEASE_CONTEXT_MISMATCH');
  const q=fixture();const snap=capture(q);q.lease.ledger.mode='IDLE';
  assert.equal(snap.assessAfter({lease:q.lease,selectedTask:q.selectedTask,effect:q.effect}).reason,
    'POST_AWAIT_LEASE_OR_TASK_CHANGED');
});
test('getter and unexpected non-data inputs fail closed without invoking getter',()=>{
  const f=fixture();Object.defineProperty(f.effect,'kind',{get(){throw Error('getter invoked');}});
  assert.equal(check(f).reason,'INPUT_NOT_PLAIN_DATA');
  const q=fixture();const snap=capture(q);
  Object.defineProperty(q.lease,'phase',{get(){throw Error('getter invoked');}});
  assert.equal(snap.assessAfter({lease:q.lease,selectedTask:q.selectedTask,effect:q.effect}).reason,
    'POST_AWAIT_INPUT_INVALID');
});
test('changing original effect after capture does not change snapshot',()=>{
  const f=fixture();const snap=capture(f);f.effect.taskId='other-task';
  assert.equal(snap.assessAfter({lease:f.lease,selectedTask:f.selectedTask,effect:f.effect}).reason,
    'POST_AWAIT_LEASE_OR_TASK_CHANGED');
});
test('hostile proxy traps are denied without proceeding to eligibility',()=>{
  const f=fixture();f.parent=new Proxy(f.parent,{getPrototypeOf(){throw Error('proxy trap');}});
  assert.equal(check(f).reason,'INPUT_NOT_PLAIN_DATA');
  const q=fixture();q.child.approvedRoutineClasses=new Proxy(q.child.approvedRoutineClasses,
    {get(_target,key){if(key==='length')throw Error('array trap');return Reflect.get(_target,key);}});
  assert.equal(check(q).reason,'PARENT_CHILD_STAGE_OR_CLASS_SCOPE');
});
