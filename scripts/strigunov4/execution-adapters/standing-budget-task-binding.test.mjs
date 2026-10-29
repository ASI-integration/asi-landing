import test from 'node:test';
import assert from 'node:assert/strict';
import {assessStartedPublisherBudgetTask as bind} from './standing-budget-task-binding.mjs';

const sha='a'.repeat(40), candidate='b'.repeat(40);
const task=()=>({id:'source-task',sha,kind:'github-publisher',stage:'S4-G1',repo:'ASI-integration/asi-landing',pr:null});
const effect=(patch={})=>({taskId:'source-task',taskSha:sha,headSha:candidate,kind:'github-read',...patch});
const ledger=()=>({schemaVersion:'asi.execution-adapters.v1',mode:'FAILED_LOCKED',reason:'IN_FLIGHT_OR_CRASHED',
  jobs:{'completed':{mode:'PUBLISHED',kind:'github-publisher',sha,pr:null},
    'source-task':{mode:'STARTED',kind:'github-publisher',sha,pr:null}}});
const check=(l=ledger(),t=task(),e=effect())=>bind({ledger:l,task:t,effect:e});

test('single exact STARTED task, read or mutation, yields non-authorizing binding',()=>{
  for(const kind of ['github-read','create-tree','create-commit','create-branch','create-draft-pr']){
    const r=check(ledger(),task(),effect({kind}));
    assert.deepEqual(r,{status:'TASK_BOUND',authorized:false,taskId:'source-task',taskSha:sha});
  }
});
test('no STARTED task denies rather than trusting lock-directory presence',()=>{
  const l=ledger();delete l.jobs['source-task'];
  assert.equal(check(l).reason,'BUDGET_ACTIVE_JOB_NOT_UNIQUE');
});
test('wrong trusted task ID and wrong original SHA deny',()=>{
  assert.equal(check(ledger(),task(),effect({taskId:'another'})).reason,'BUDGET_TASK_BINDING_CHANGED');
  assert.equal(check(ledger(),task(),effect({taskSha:candidate})).reason,'BUDGET_TASK_BINDING_CHANGED');
});
test('candidate commit HEAD can differ while immutable original task SHA remains bound',()=>{
  assert.equal(check(ledger(),task(),effect({headSha:'c'.repeat(40)})).status,'TASK_BOUND');
});
test('job SHA/ID changed after a prior async wait denies at final check',()=>{
  const l=ledger();assert.equal(check(l).status,'TASK_BOUND');
  l.jobs['source-task'].sha=candidate;
  assert.equal(check(l).reason,'BUDGET_TASK_BINDING_CHANGED');
});
test('two simultaneous STARTED jobs deny even when one matches',()=>{
  const l=ledger();l.jobs.other={mode:'STARTED',kind:'github-publisher',sha,pr:null};
  assert.equal(check(l).reason,'BUDGET_ACTIVE_JOB_NOT_UNIQUE');
});
test('foreign job kind or unexpected PR denies',()=>{
  const a=ledger();a.jobs['source-task'].kind='engine';
  assert.equal(check(a).reason,'BUDGET_TASK_BINDING_CHANGED');
  const b=ledger();b.jobs['source-task'].pr=23;
  assert.equal(check(b).reason,'BUDGET_TASK_BINDING_CHANGED');
});
test('unarmed, terminal or idle ledger never qualifies',()=>{
  for(const patch of [{mode:'IDLE'},{reason:'UNHANDLED_OR_UNKNOWN_RESULT'},{schemaVersion:'unknown'}])
    assert.equal(check({...ledger(),...patch}).reason,'BUDGET_LEDGER_NOT_ARMED');
});
test('accessor, proxy and inherited host context cannot impersonate a task',()=>{
  const t=task();Object.defineProperty(t,'sha',{get(){return sha;}});
  assert.equal(check(ledger(),t).reason,'BUDGET_TASK_CONTEXT_INVALID');
  assert.equal(check(ledger(),Object.create(task())).reason,'BUDGET_TASK_CONTEXT_INVALID');
  const l=ledger();Object.defineProperty(l.jobs,'source-task',{get(){throw Error('unexpected getter');}});
  assert.equal(check(l).reason,'BUDGET_TASK_CONTEXT_INVALID');
});
test('unsupported effects and boxed/invalid SHA deny',()=>{
  assert.equal(check(ledger(),task(),effect({kind:'merge-main'})).reason,'BUDGET_EFFECT_UNSUPPORTED');
  assert.equal(check(ledger(),task(),effect({taskSha:new String(sha)})).reason,'BUDGET_EFFECT_UNSUPPORTED');
  assert.equal(check(ledger(),task(),effect({headSha:'invalid'})).reason,'BUDGET_EFFECT_UNSUPPORTED');
});
test('malformed historical jobs deny rather than ignoring traps',()=>{
  const l=ledger();l.jobs.completed={mode:2};
  assert.equal(check(l).reason,'BUDGET_TASK_CONTEXT_INVALID');
});
