import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeSourceWork} from './source-work-intake.mjs';
import {compileSourcePublisherHandoff} from './source-publisher-handoff.mjs';
const SHA='a'.repeat(40),HEX='b'.repeat(64);
const task=(overrides={})=>({id:'source-hello',laneId:'engine',
  repo:'ASI-integration/asi-landing',branch:'asi/beget-one-engine-20261028',
  baseSha:SHA,stage:'S4-G2',kind:'source-proposal',
  files:[{path:'scripts/strigunov4/example.py',beforeSha256:HEX}],...overrides});
const prepare=async(t=task())=>proposeSourceWork({task:t,admittedTasks:[t],produce:async()=>({
  status:'PROPOSED',changes:[{path:t.files[0].path,beforeSha256:t.files[0].beforeSha256,
    content:'def hello():\n    return True\n'}]})});
test('verified new source proposal becomes inert exact Publisher-shaped candidate',async()=>{
  const t=task(),proposal=await prepare(t);
  const result=compileSourcePublisherHandoff({task:t,admittedTasks:[t],proposal});
  assert.equal(result.status,'SOURCE_PREPARER_CANDIDATE');
  assert.equal(result.authorized,false);
  assert.equal(result.task.kind,'github-publisher');
  assert.equal(result.task.repo,t.repo);
  assert.equal(result.task.sha,t.baseSha);
  assert.equal(result.task.branch,'asi/engine-task/source-hello');
  assert.equal(result.task.laneId,'engine');
  assert.equal(result.task.changes.length,1);
  assert.equal(Object.hasOwn(result,'grant'),false);
  assert.equal(Object.hasOwn(result.task,'workOrderId'),false);
  assert(Object.isFrozen(result.task));
});
test('cannot change task or catalog after producer completed',async()=>{
  const t=task(),proposal=await prepare(t);
  const other=task({branch:'asi/unauthorized'});
  assert.equal(compileSourcePublisherHandoff({task:other,admittedTasks:[t],proposal}).status,'BLOCKED');
  assert.equal(compileSourcePublisherHandoff({task:t,admittedTasks:[other],proposal}).status,'BLOCKED');
});
test('cannot swap proposed bytes while preserving old content hash',async()=>{
  const t=task(),proposal=await prepare(t);
  const bad={...proposal,candidate:{...proposal.candidate,changes:[{
    ...proposal.candidate.changes[0],content:'import os; os.system("false")\n'
  }]}};
  assert.equal(compileSourcePublisherHandoff({task:t,admittedTasks:[t],proposal:bad}).reason,
    'SOURCE_BYTES_OR_PRECONDITION_CHANGED');
});
test('cannot replace task digest or change originally admitted path',async()=>{
  const t=task(),proposal=await prepare(t);
  for(const candidate of [
    {...proposal.candidate,changeDigest:'0'.repeat(64)},
    {...proposal.candidate,id:'source-other'},
    {...proposal.candidate,branch:'asi/not-authorized'}
  ]){
    assert.equal(compileSourcePublisherHandoff({task:t,admittedTasks:[t],
      proposal:{...proposal,candidate}}).status,'BLOCKED');
  }
});
test('unsupported TS/TSX proposals require approved syntax checker before Publisher',async()=>{
  const t=task({files:[{path:'src/test.ts',beforeSha256:HEX}]});
  const proposal=await prepare(t);
  assert.equal(compileSourcePublisherHandoff({task:t,admittedTasks:[t],proposal}).reason,
    'NO_EXISTING_PREPARER_SYNTAX_FOR_PATH');
});
test('noncanonical JSON is denied rather than hashing bytes preparer would rewrite',async()=>{
  const t=task({files:[{path:'src/test.json',beforeSha256:HEX}]});
  const p=await proposeSourceWork({task:t,admittedTasks:[t],
    produce:async()=>({status:'PROPOSED',changes:[{path:'src/test.json',
      beforeSha256:HEX,content:'{"ok":true}'}]})});
  assert.equal(compileSourcePublisherHandoff({task:t,admittedTasks:[t],proposal:p}).reason,
    'JSON_BYTES_REQUIRE_CANONICALIZATION');
});
test('canonical JSON passes with no authority',async()=>{
  const t=task({files:[{path:'src/test.json',beforeSha256:HEX}]});
  const p=await proposeSourceWork({task:t,admittedTasks:[t],
    produce:async()=>({status:'PROPOSED',changes:[{path:'src/test.json',
      beforeSha256:HEX,content:'{\n  "ok": true\n}\n'}]})});
  const x=compileSourcePublisherHandoff({task:t,admittedTasks:[t],proposal:p});
  assert.equal(x.status,'SOURCE_PREPARER_CANDIDATE');
  assert.equal(x.authorized,false);
});
test('malformed external producer object cannot supply a publishing grant',()=>{
  const t=task();
  for(const proposal of [null,{status:'PASS',authorized:true},
    {schema:'asi.source-intake-result.v1',status:'PROPOSAL_PREPARED',authorized:true,
      taskBinding:'x',candidate:{}}]){
    assert.equal(compileSourcePublisherHandoff({task:t,admittedTasks:[t],proposal}).status,'BLOCKED');
  }
});
