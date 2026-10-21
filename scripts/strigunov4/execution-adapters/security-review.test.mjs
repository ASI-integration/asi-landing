import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inventoryPath } from './change-preparer.mjs';
import { inspectCodeRabbit } from './coderabbit-analyzer.mjs';
import { BOT_ID } from './github-readonly.mjs';
import { initializeState } from './state.mjs';

const SHA='a'.repeat(40);
const task={sha:SHA,pr:522};
const recent=(head=SHA,append='')=>
  '<!-- recent_review_start -->\n' +
  'No actionable comments were generated in the recent review. 🎉\n' +
  'Reviewing files that changed from the base of the PR and between ' +
  'b'.repeat(40) + ' and ' + head + '.\n' + append +
  '<!-- recent_review_end -->';
const clean=(change={})=>({
  id:80,user:{id:BOT_ID},updated_at:'2026-10-21T06:00:00Z',
  body:recent(),
  ...change
});
function github({comments=[clean()],reviews=[],threads=[],status={}}={}) {
  return {
    pages:async name=>name.endsWith('/statuses')?
      [{id:77,context:'CodeRabbit',creator:{id:BOT_ID},state:'success',
      description:'Review completed',created_at:'2026-10-21T06:00:01Z',...status}]:
      name.endsWith('/reviews')?reviews:
      name.endsWith('/comments')?comments:[],
    threads:async()=>threads
  };
}
test('inventory accepts legitimate brackets/spaces only for read-only scanning',()=>{
  for(const p of ['design-reference/a[1].png','folder/with space.txt','book (v2).md'])
    assert.doesNotThrow(()=>inventoryPath(p));
});
test('inventory denies navigation, symlinks by later lstat, NUL and absolute paths',()=>{
  for(const p of ['../escape','folder/../file','folder//file','.git/config',
    '/etc/passwd','C:\\secret','file\0name','./bad'])
    assert.throws(()=>inventoryPath(p),/INVENTORY_PATH_NOT_ALLOWED/);
});
test('strict current-head clean CodeRabbit summary can replace absent PR review',async()=>{
  const x=await inspectCodeRabbit(github(),task);
  assert.equal(x.status,'PASS');
  assert.equal(x.evidence.reviewId,null);
  assert.equal(x.evidence.summaryId,80);
});
test('no review + clean summary with different SHA blocks',async()=>{
  assert.equal((await inspectCodeRabbit(github({comments:[clean({body:recent('b'.repeat(40))})]}),task)).status,'FAILED');
});
test('no review + ambiguous equal timestamp blocks',async()=>{
  assert.equal((await inspectCodeRabbit(github({comments:[clean({updated_at:'2026-10-21T06:00:01Z'})]}),task)).status,'FAILED');
});
test('no review + stale summary blocks',async()=>{
  assert.equal((await inspectCodeRabbit(github({comments:[clean({updated_at:'2026-10-21T05:00:00Z'})]}),task)).status,'FAILED');
});
test('no review + missing timestamp blocks',async()=>{
  assert.equal((await inspectCodeRabbit(github({comments:[clean({updated_at:undefined})]}),task)).status,'FAILED');
});
test('one marked review plus an unmarked bot acknowledgement may pass',async()=>{
  const unmarked=clean({id:81,updated_at:'2026-10-21T06:00:06Z',body:'Full review finished.'});
  const result=await inspectCodeRabbit(github({comments:[clean(),unmarked]}),task);
  assert.equal(result.status,'PASS');
  assert.equal(result.evidence.summaryId,80);
});
test('two marked CodeRabbit summaries remain ambiguous and blocked',async()=>{
  const result=await inspectCodeRabbit(github({comments:[clean(),clean({id:81,updated_at:'2026-10-21T06:00:06Z'})]}),task);
  assert.equal(result.status,'FAILED');
});
test('no review + outside-diff actionable issue blocks',async()=>{
  assert.equal((await inspectCodeRabbit(github({comments:[clean({body:recent(SHA,'Outside diff range comments (3)\n')})]}),task)).status,'FAILED');
});
test('no review + review range missing but SHA elsewhere blocks',async()=>{
  assert.equal((await inspectCodeRabbit(github({comments:[clean({
    body:'<!-- recent_review_start -->\nNo actionable comments were generated in the recent review. 🎉\nHead: '+SHA+'\n<!-- recent_review_end -->'
  })]}),task)).status,'FAILED');
});
test('no review + actionable count blocks even if clean text exists',async()=>{
  assert.equal((await inspectCodeRabbit(github({comments:[clean({
    body:recent(SHA,'Actionable comments posted: 1\n')
  })]}),task)).status,'FAILED');
});
test('no review + status and clean summary within 5 minutes, either ordering allowed',async()=>{
  const x=await inspectCodeRabbit(github({comments:[clean({updated_at:'2026-10-21T06:00:02Z'})]}),task);
  assert.equal(x.status,'PASS');
});
test('no review + summary outside 5-minute window blocks',async()=>{
  assert.equal((await inspectCodeRabbit(github({comments:[clean({
    updated_at:'2026-10-21T06:08:00Z'
  })]}),task)).status,'FAILED');
});
test('no review + unresolved thread blocks',async()=>{
  const r=await inspectCodeRabbit(github({threads:[{isResolved:false}]}),task);
  assert.equal(r.status,'FAILED'); assert.equal(r.actionable,true);
});
test('no review + skipped status blocks',async()=>{
  assert.equal((await inspectCodeRabbit(github({status:{description:'Review skipped'}}),task)).status,'FAILED');
});
test('existing formal review keeps exact-SHA PASS logic',async()=>{
  const h=github({comments:[],reviews:[{id:88,user:{id:BOT_ID},commit_id:SHA,state:'COMMENTED',
    body:'**Actionable comments posted: 0**'}]});
  assert.equal((await inspectCodeRabbit(h,task)).status,'PASS');
});
test('wrong-head formal review blocks even if a clean summary exists',async()=>{
  const h=github({reviews:[{id:88,user:{id:BOT_ID},commit_id:'b'.repeat(40),state:'COMMENTED',
    body:'**Actionable comments posted: 0**'}]});
  assert.equal((await inspectCodeRabbit(h,task)).status,'FAILED');
});
test('state adapter creates private directories and receipt artifacts', {skip:process.platform!=='linux'},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-adapter-mode-'));
  try{
    await initializeState(root);
    for(const relative of ['state','reports','scratchpads','state/receipts.json','state/autopilot-ledger.json']){
      const artifact=await fs.stat(path.join(root,relative));
      assert.equal(artifact.mode & 0o022,0,`${relative} must not be group/other writable`);
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
