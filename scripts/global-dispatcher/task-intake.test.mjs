import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTaskIntake} from './task-intake.mjs';
const plan={
  planHash:'a'.repeat(64),
  goal:{criteria:['real-host-upgrade']},
  nodes:[
    {id:'fix-engine-upgrade',covers:['real-host-upgrade']},
    {id:'duplicate-new-id',covers:['real-host-upgrade']},
    {id:'separate-task',covers:['real-host-upgrade']}
  ]
};
const task=(id='fix-engine-upgrade')=>({id,paths:['scripts/engine.mjs']});
const assessment=(id='fix-engine-upgrade',outcome='Deploy working engine on existing Beget host')=>({
 schema:'asi.task-value-assessment.v1',taskId:id,goalPlanHash:plan.planHash,
 decision:'ACCEPTED',outcome,expectedBenefit:'Live task publication and durable receipt',
 acceptanceEvidence:['real-host-upgrade'],
 reason:'Closes the observable host deployment blocker',
 alternative:'Use one existing engine, never start a second service.',
 possibleDuplicates:[]
});
const inspect=(t,a,history=[])=>inspectTaskIntake({product:'asi-engine',task:t,
 goalGraph:plan,assessment:a,history});
test('useful measurable task is accepted as candidate only, never auth',()=>{
 const r=inspect(task(),assessment());
 assert.equal(r.status,'ACCEPTED');assert.equal(r.authorized,false);
 assert.equal(r.executable,false);assert.equal(r.admitted,false);
 assert.match(r.intentKey,/^[0-9a-f]{64}$/);
});
test('same semantic outcome under new ID and cosmetic whitespace is duplicate',()=>{
 const a=inspect(task(),assessment());
 const x=inspect(task('duplicate-new-id'),
   assessment('duplicate-new-id','  deploy  working engine on existing beget host  '.trim()),[
    {id:'fix-engine-upgrade',intentKey:a.intentKey,status:'ACCEPTED'}
 ]);
 assert.equal(x.status,'DUPLICATE');
 assert.equal(x.authorized,false);
});
test('same ID cannot bypass prior verdict with different words',()=>{
 const a=inspect(task(),assessment());
 const x=inspect(task(),assessment('fix-engine-upgrade','Entirely new request with same task ID'),[
  {id:'fix-engine-upgrade',intentKey:a.intentKey,status:'ACCEPTED'}
 ]);
 assert.equal(x.status,'DUPLICATE');
});
test('explicit rejection preserves meaningful diagnosis',()=>{
 for(const v of ['NO_VALUE','ILL_LOGICAL','OUT_OF_SCOPE','BLOCKED_DEPENDENCY','NEEDS_OWNER_DECISION']){
  const a=assessment();a.decision=v;a.reason='Does not deliver the current product goal';
  const x=inspect(task(),a);
  assert.equal(x.status,v);assert.equal(x.reason,a.reason);
  assert.equal(x.authorized,false);assert(x.alternative.length>0);
 }
});
test('missing meaningful benefit or exact acceptance evidence refuses nonsense',()=>{
 const a=assessment();a.expectedBenefit='ok';
 assert.equal(inspect(task(),a).status,'NO_VALUE');
 const b=assessment();b.acceptanceEvidence=['a collection of green unit tests'];
 assert.equal(inspect(task(),b).status,'NO_VALUE');
});
test('unverified evaluator, mutated goal/hash or suspicious duplicate refuses',()=>{
 assert.equal(inspect(task(),null).status,'NEEDS_OWNER_DECISION');
 const a=assessment();a.goalPlanHash='b'.repeat(64);
 assert.equal(inspect(task(),a).status,'NEEDS_OWNER_DECISION');
 const b=assessment();b.possibleDuplicates=['separate-task'];
 assert.equal(inspect(task(),b).reason,'POSSIBLE_SEMANTIC_DUPLICATE');
});
test('unbounded hostile assessments and out-of-scope tasks fail closed',()=>{
 const a=assessment();Object.defineProperty(a,'reason',{get(){throw Error('untrusted getter')}});
 assert.equal(inspect(task(),a).status,'NEEDS_OWNER_DECISION');
 assert.equal(inspect({id:'unknown',paths:['docs/file.mjs']},assessment()).status,'OUT_OF_SCOPE');
});
