import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inventoryPath, normalizeProposedContent, validateScratchGitConfig } from './change-preparer.mjs';
import { inspectCodeRabbit } from './coderabbit-analyzer.mjs';
import { BOT_ID, verifyPinnedReviewPr } from './github-readonly.mjs';
import { initializeState } from './state.mjs';
import { inspectCI } from './ci-reader.mjs';
import { createOrchestrator } from '../ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.mjs';

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
test('newer unmarked bot acknowledgement cannot reuse an older clean review',async()=>{
  const unmarked=clean({id:81,updated_at:'2026-10-21T06:00:06Z',body:'Full review finished.'});
  const result=await inspectCodeRabbit(github({comments:[clean(),unmarked]}),task);
  assert.equal(result.status,'FAILED');
  assert.equal(result.completed,false);
});
test('newer bot concern, ambiguous timestamp or missing timestamp blocks summary fallback',async()=>{
  for(const change of [
    {updated_at:'2026-10-21T06:00:06Z',body:'Actionable comments posted: 1'},
    {updated_at:'2026-10-21T06:00:00Z',body:'Review in progress'},
    {updated_at:undefined,body:'Review in progress'}
  ])assert.equal((await inspectCodeRabbit(github({comments:[clean(),clean({id:81,...change})]}),task)).status,'FAILED');
});
test('older unmarked acknowledgement does not supersede a newer exact-head summary',async()=>{
  const old=clean({id:79,updated_at:'2026-10-21T05:59:59Z',body:'Review requested'});
  assert.equal((await inspectCodeRabbit(github({comments:[old,clean()]}),task)).status,'PASS');
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
test('outdated formal review requires current-head summary instead',async()=>{
  const h=github({reviews:[{id:88,user:{id:BOT_ID},commit_id:'b'.repeat(40),state:'COMMENTED',
    body:'**Actionable comments posted: 0**'}]});
  const r=await inspectCodeRabbit(h,task);
  assert.equal(r.status,'PASS');
  assert.equal(r.evidence.summaryId,80);
});
test('outdated formal review plus wrong-head summary stays blocked',async()=>{
  const h=github({comments:[clean({body:recent('b'.repeat(40))})],
    reviews:[{id:88,user:{id:BOT_ID},commit_id:'b'.repeat(40),state:'COMMENTED',
      body:'**Actionable comments posted: 0**'}]});
  assert.equal((await inspectCodeRabbit(h,task)).status,'FAILED');
});
test('outdated CHANGES_REQUESTED review remains a hard block',async()=>{
  const h=github({reviews:[{id:88,user:{id:BOT_ID},commit_id:'b'.repeat(40),state:'CHANGES_REQUESTED',
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

test('source proposals keep .json round-trip and reject invalid JSON',()=>{
  assert.equal(normalizeProposedContent('config.json','{"safe":true}'),'{\n  "safe": true\n}\n');
  assert.throws(()=>normalizeProposedContent('config.json','safe: true'),SyntaxError);
  assert.equal(normalizeProposedContent('handler.py','print("safe")\n'),'print("safe")\n');
});
test('source proposals reject YAML before any write, even JSON-shaped YAML',()=>{
  for(const extension of ['yml','yaml']) {
    for(const proposal of ['name: test\n','{"name":"test"}'])
      assert.throws(()=>normalizeProposedContent('workflow.'+extension,proposal),/NO_APPROVED_SYNTAX_CHECKER/);
  }
});

test('detached clone may retain safe branch metadata with only remote and merge keys',()=>{
  const config='[core]\n\trepositoryformatversion = 0\n\tbare = false\n' +
    '[remote "origin"]\n\turl = https://example.invalid/repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n' +
    '[branch "feature/source-v1"]\n\tremote = origin\n\tmerge = refs/heads/feature/source-v1\n';
  assert.doesNotThrow(()=>validateScratchGitConfig(config));
  for(const bad of [
    config+'[branch "bad..ref"]\nremote = origin\n',
    config+'[branch "feature/source-v1"]\nrebase = true\n',
    config+'[branch "feature/source-v1"]\nremote = attacker\n',
    config+'[branch "feature/source-v1"]\nmerge = refs/tags/v1\n',
    config+'[include]\npath = /tmp/evil\n',
    config+'[core]\nhooksPath = /tmp/hooks\n'
  ]) assert.throws(()=>validateScratchGitConfig(bad),/UNTRUSTED_GIT_CONFIG/);
});
test('exact-SHA read-only review accepts merged dependency but rejects lifecycle ambiguity',()=>{
  const pinned={repo:'ASI-integration/asi-landing',stage:'S4-G1',id:'g1-pr509-reload-preflight',
    sha:SHA,pr:509,branch:'asi/review-509'};
  const p={number:509,head:{sha:SHA,ref:pinned.branch,repo:{full_name:pinned.repo}},
    base:{sha:'b'.repeat(40),ref:'main',repo:{full_name:pinned.repo}},
    state:'closed',merged:true};
  assert.deepEqual(verifyPinnedReviewPr(p,pinned),{
    number:509,head:SHA,branch:pinned.branch,base:p.base.sha,state:'closed',merged:true
  });
  assert.equal(verifyPinnedReviewPr({...p,state:'open',merged:false},pinned).merged,false);
  for(const invalid of [
    {...p,state:'closed',merged:false},
    {...p,state:'open',merged:true},
    {...p,head:{...p.head,sha:'f'.repeat(40)}},
    {...p,base:{...p.base,ref:'staging'}}
  ]) assert.throws(()=>verifyPinnedReviewPr(invalid,pinned),/PR_SHA_OR_LIFECYCLE_CHANGED/);
});

test('CI evidence accepts empty GitHub PR list only for exact workflow, branch and origin',async()=>{
  const task={id:'g1-pr509-reload-preflight',sha:SHA,pr:509,
    branch:'asi/review-509',repo:'ASI-integration/asi-landing',stage:'S4-G1'};
  const base={id:91,workflow_id:15,head_sha:SHA,head_branch:task.branch,
    repository:{full_name:task.repo},head_repository:{full_name:task.repo},
    event:'pull_request',pull_requests:[],run_attempt:1,status:'completed',conclusion:'success'};
  const policy=[{name:'validate',workflowId:15}];
  const port=run=>({
    pages:async route=>route.startsWith('actions/runs?')?[structuredClone(run)]:
      [{id:92,run_id:91,head_sha:SHA,name:'validate',status:'completed',conclusion:'success',
        steps:[{number:1,status:'completed',conclusion:'success'}]}],
    get:async()=>structuredClone(run)
  });
  assert.equal((await inspectCI(port(base),task,policy)).status,'PASS');
  assert.equal((await inspectCI(port({...base,pull_requests:[{number:509}]}),task,policy)).status,'PASS');
  for(const bad of [
    {...base,head_branch:'asi/another'},
    {...base,repository:{full_name:'foreign/repo'}},
    {...base,head_repository:{full_name:'foreign/repo'}},
    {...base,pull_requests:[{number:522}]},
    {...base,pull_requests:'not array'}
  ])assert.equal((await inspectCI(port(bad),task,policy)).status,'WAITING');
});
test('orchestrator cleanup failure preserves original read-only decision and lock',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'asi-orch-cleanup-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const lock=path.join(dir,'orchestrator-iteration.lock');
  await fs.writeFile(path.join(dir,'heartbeat.json'),JSON.stringify({mode:'BLOCKED'}));
  const orig=fs.unlink;
  fs.unlink=async (...args)=>args[0]===lock?
    Promise.reject(Object.assign(Error('injected cleanup failure'),{code:'EIO'})):orig(...args);
  try{
    const x=createOrchestrator({stateDir:dir,fetchSnapshot:async()=>{throw Error('unreachable');},
      authorize:async()=>({approved:false}),dispatch:async()=>{throw Error('forbidden');},
      verifyPublication:async()=>false});
    const result=await x.iteration({execute:true});
    assert.equal(result.mode,'WAIT_RECONCILIATION');
    assert.equal(result.reason,'HEARTBEAT_RECONCILIATION');
    assert.ok((await fs.stat(lock)).isFile());
  }finally{fs.unlink=orig;}
});
