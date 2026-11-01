import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSourceIntake,proposeSourceWork,SOURCE_LANES} from './source-work-intake.mjs';

const SHA='a'.repeat(40), HEX='b'.repeat(64);
const task=(override={})=>({
  id:'test-authorized-code-1',laneId:'engine',repo:'ASI-integration/asi-landing',
  branch:'asi/beget-one-engine-20261028',baseSha:SHA,stage:'S4-G2',
  kind:'source-proposal',files:[{path:'docs/test-task.py',beforeSha256:null}],...override
});
const generate=async()=>({status:'PROPOSED',changes:[{
  path:'docs/test-task.py',beforeSha256:null,content:'def verify():\n    return True\n'
}]});
const run=(params={})=>proposeSourceWork({
  task:task(),admittedTasks:[task()],produce:generate,...params
});

test('five exact named lanes, no invented sixth, no live authority',()=>{
  assert.equal(SOURCE_LANES.length,5);
  assert.equal(new Set(SOURCE_LANES.map(x=>x.id)).size,5);
  assert(SOURCE_LANES.every(x=>Object.isFrozen(x)));
  const result=inspectSourceIntake({task:task(),admittedTasks:[task()]});
  assert.equal(result.status,'SOURCE_CANDIDATE');
  assert.equal(result.authorized,false);
  assert.equal(result.reason,'REQUIRES_NATIVE_SIGNED_ADMISSION');
  assert.match(result.taskBinding,/^[a-f0-9]{64}$/);
});
test('one source-code producer receives only bounded readonly task view',async()=>{
  let received,called=0;
  const p=await run({produce:async input=>{
    received=input;called++;
    assert(Object.isFrozen(input));
    assert(Object.isFrozen(input.paths));
    assert.deepEqual(Object.keys(input).sort(),[
      'baseSha','branch','id','laneId','paths','repository'].sort());
    return generate();
  }});
  assert.equal(called,1);
  assert.equal(received.id,task().id);
  assert.equal(p.status,'PROPOSAL_PREPARED');
  assert.equal(p.authorized,false);
  assert.match(p.candidate.changeDigest,/^[a-f0-9]{64}$/);
  assert.equal(p.candidate.changes.length,1);
  assert.equal(p.candidate.changes[0].path,'docs/test-task.py');
  assert(Object.isFrozen(p.candidate.changes[0]));
});
test('producing identical source yields deterministic digest but no publication',async()=>{
  const a=await run(), b=await run();
  assert.equal(a.status,'PROPOSAL_PREPARED');
  assert.deepEqual(a.candidate,b.candidate);
  assert.equal(a.authorized,false);
  assert.equal(a.candidate.changes[0].content,'def verify():\n    return True\n');
  assert.equal(Object.hasOwn(a,'publication'),false);
  assert.equal(Object.hasOwn(a,'grant'),false);
});
test('unsigned task text, absent catalog or mismatch cannot obtain a producer call',async()=>{
  for(const adm of [[],[task({baseSha:'f'.repeat(40)})],
    [task(),task()], [{...task(),branch:'asi/different'}]]){
    let calls=0;
    const outcome=await run({admittedTasks:adm,produce:async()=>{calls++;return generate()}});
    assert.equal(outcome.status,'BLOCKED');
    assert.equal(outcome.authorized,false);
    assert.equal(calls,0);
  }
});
test('protected changes, moved branch, missing SHA or arbitrary stage are not admitted',()=>{
  for(const changed of [
    task({laneId:'other'}),task({branch:'asi/other'}),
    task({baseSha:'nope'}),task({stage:'S4-G3'}),
    task({kind:'deploy'}),task({files:[]}),task({id:'../unsafe'}),
    task({repo:'someone/other'})
  ]){
    const outcome=inspectSourceIntake({task:changed,admittedTasks:[task()]});
    assert.equal(outcome.status,'BLOCKED');
  }
});
test('reject path traversal, hidden git entry, shell characters and incompatible extension',()=>{
  for(const p of ['../config.py','docs/../secret.py','.git/config.py',
    'docs/.GiT/hooks.py','docs/task;touch.py','docs/task.sh',
    '/tmp/unsafe.js','docs/./weird.ts','docs/a\u0000b.py']){
    const source=task({files:[{path:p,beforeSha256:null}]});
    assert.equal(inspectSourceIntake({task:source,admittedTasks:[source]}).status,'BLOCKED',p);
  }
});
test('reject duplicate paths, partial proposal and inconsistent before hashes',async()=>{
  const source=task({files:[{path:'docs/a.py',beforeSha256:null},{path:'docs/a.py',beforeSha256:null}]});
  assert.equal(inspectSourceIntake({task:source,admittedTasks:[source]}).status,'BLOCKED');
  const bad=await run({produce:async()=>({status:'PROPOSED',changes:[{
    path:'docs/test-task.py',beforeSha256:HEX,content:'pass\n'}]})});
  assert.equal(bad.reason,'PRODUCER_ESCAPED_TASK_SCOPE');
  const missing=await run({produce:async()=>({status:'PROPOSED',changes:[]})});
  assert.equal(missing.reason,'PRODUCER_OUTPUT_NOT_VERIFIED');
});
test('reject candidate over-size, binary and producer failures',async()=>{
  for(const content of ['', 'a'.repeat(128*1024+1),'hello\u0000danger']){
    const result=await run({produce:async()=>({status:'PROPOSED',changes:[{
      path:'docs/test-task.py',beforeSha256:null,content}]})});
    assert.equal(result.reason,'PRODUCER_BYTES_OUT_OF_BOUNDS');
  }
  assert.equal((await run({produce:async()=>{throw Error('do not leak secrets')}})).reason,
    'PRODUCER_FAILED_OR_UNKNOWN');
  assert.equal((await run({produce:null})).reason,'SOURCE_PRODUCER_NOT_CONFIGURED');
});
test('producer may not insert out-of-scope or extra code paths',async()=>{
  for(const output of [
    {status:'PROPOSED',changes:[{path:'src/app/api/admin/route.ts',beforeSha256:null,content:'write()'}]},
    {status:'READY',changes:[{path:'docs/test-task.py',beforeSha256:null,content:'pass'}]},
    {status:'PROPOSED',changes:[{path:'docs/test-task.py',beforeSha256:null,content:'pass'},
      {path:'docs/extra.py',beforeSha256:null,content:'pass'}]}
  ]){
    const result=await run({produce:async()=>output});
    assert.equal(result.status,'BLOCKED');
  }
});
test('reject foreign prototypes, getters, symbols and sparse catalog arrays',async()=>{
  const legitimate=task();
  const bad=Object.create(legitimate);
  assert.equal(inspectSourceIntake({task:bad,admittedTasks:[legitimate]}).status,'BLOCKED');
  const copied={...legitimate};
  Object.defineProperty(copied,'baseSha',{get(){throw Error('hostile getter')}});
  assert.equal(inspectSourceIntake({task:copied,admittedTasks:[legitimate]}).status,'BLOCKED');
  const sparse=[legitimate,legitimate];delete sparse[1];
  assert.equal(inspectSourceIntake({task:legitimate,admittedTasks:sparse}).status,'BLOCKED');
  const withSymbol={...legitimate};withSymbol[Symbol('secret')]='ignored';
  assert.equal(inspectSourceIntake({task:withSymbol,admittedTasks:[legitimate]}).status,'BLOCKED');
  const forged={status:'PROPOSED',changes:[{path:'docs/test-task.py',
    beforeSha256:null,content:'pass'}]};
  Object.defineProperty(forged,'status',{get(){throw Error('getter')}});
  assert.equal((await run({produce:async()=>forged})).status,'BLOCKED');
});
test('multiple exact paths retain ordered per-file hashes, no automatic writes',async()=>{
  const source=task({files:[
    {path:'docs/a.py',beforeSha256:null},{path:'src/lib/example.ts',beforeSha256:HEX}
  ]});
  const result=await proposeSourceWork({task:source,admittedTasks:[source],produce:async()=>({
    status:'PROPOSED',changes:[
      {path:'docs/a.py',beforeSha256:null,content:'print(1)\n'},
      {path:'src/lib/example.ts',beforeSha256:HEX,content:'export const value = 2;\n'}
    ]})});
  assert.equal(result.status,'PROPOSAL_PREPARED');
  assert.equal(result.candidate.changes.length,2);
  assert.equal(result.candidate.changes[1].beforeSha256,HEX);
  assert.equal(result.authorized,false);
});
test('producer cannot alter task scope while asynchronous code generation is running',async()=>{
  const original=task();
  const catalog=[task()];
  const outcome=await proposeSourceWork({task:original,admittedTasks:catalog,
    produce:async input=>{
      assert.equal(input.id,original.id);
      original.files[0].path='src/lib/secret.ts';
      original.branch='asi/unauthorized';
      return generate();
    }});
  assert.equal(outcome.status,'BLOCKED');
  assert.equal(outcome.reason,'TASK_OR_CATALOG_CHANGED_DURING_PRODUCTION');
  assert.equal(outcome.authorized,false);
});
test('producer cannot silently substitute catalog bytes after task was accepted',async()=>{
  const original=task();
  const catalog=[task()];
  const outcome=await proposeSourceWork({task:original,admittedTasks:catalog,
    produce:async ()=>{
      catalog[0].baseSha='f'.repeat(40);
      return generate();
    }});
  assert.equal(outcome.reason,'TASK_OR_CATALOG_CHANGED_DURING_PRODUCTION');
  assert.equal(outcome.candidate,null);
});
test('producer receives pinned task view, not caller-owned mutable file objects',async()=>{
  const original=task();
  const catalog=[task()];
  const outcome=await proposeSourceWork({task:original,admittedTasks:catalog,
    produce:async input=>{
      assert.equal(input.paths[0],'docs/test-task.py');
      assert.equal(Object.isFrozen(input.paths),true);
      assert.throws(()=>{input.paths.push('src/evil.ts')},TypeError);
      return generate();
    }});
  assert.equal(outcome.status,'PROPOSAL_PREPARED');
  assert.equal(outcome.candidate.changes[0].path,'docs/test-task.py');
});
test('signed objective is included in task binding and producer input',async()=>{
  const scoped=task({objective:'Fix the authorized Python return value.'});
  const expected={...scoped,objective:'Do something else.'};
  const a=inspectSourceIntake({task:scoped,admittedTasks:[scoped]});
  const b=inspectSourceIntake({task:expected,admittedTasks:[expected]});
  assert.notEqual(a.taskBinding,b.taskBinding);
  assert.equal(inspectSourceIntake({task:scoped,admittedTasks:[expected]}).status,'BLOCKED');
  const response=await proposeSourceWork({task:scoped,admittedTasks:[scoped],
    produce:async input=>{
      assert.equal(input.objective,scoped.objective);
      return generate();
    }});
  assert.equal(response.status,'PROPOSAL_PREPARED');
});
test('malformed task objective cannot control model generation',async()=>{
  for(const objective of ['', ' '.repeat(2),'a'.repeat(2401),17]){
    let called=0;
    const scoped=task({objective});
    const r=await proposeSourceWork({task:scoped,admittedTasks:[scoped],
      produce:async()=>{called++;return generate()}});
    assert.equal(r.status,'BLOCKED');assert.equal(called,0);
  }
});
