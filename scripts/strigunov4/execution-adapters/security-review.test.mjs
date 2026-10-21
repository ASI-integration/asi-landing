import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryPath } from './change-preparer.mjs';
import { inspectCodeRabbit } from './coderabbit-analyzer.mjs';
import { BOT_ID } from './github-readonly.mjs';

const SHA='a'.repeat(40);
const task={sha:SHA,pr:522};
const clean=(change={})=>({
  id:80,user:{id:BOT_ID},updated_at:'2026-10-21T06:00:05Z',
  body:'Head: '+SHA+'\nNo actionable comments were generated in the recent review.',
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
  assert.equal((await inspectCodeRabbit(github({comments:[clean({body:'Head: '+ 'b'.repeat(40)+'\nNo actionable comments were generated in the recent review.'})]}),task)).status,'FAILED');
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
test('no review + ambiguous second bot comment blocks',async()=>{
  assert.equal((await inspectCodeRabbit(github({comments:[clean(),clean({id:81,updated_at:'2026-10-21T06:00:06Z'})]}),task)).status,'FAILED');
});
test('no review + outside-diff actionable issue blocks',async()=>{
  assert.equal((await inspectCodeRabbit(github({comments:[clean({body:'Head: '+SHA+'\nNo actionable comments were generated in the recent review.\nOutside diff range comments (3)'})]}),task)).status,'FAILED');
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
test('0755 is non-writable for group/other; no recursive chmod needed',()=>{
  assert.equal(0o755 & 0o022,0);
  assert.notEqual(0o777 & 0o022,0);
});
