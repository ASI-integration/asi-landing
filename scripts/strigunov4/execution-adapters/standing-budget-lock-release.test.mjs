import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initializeState} from './state.mjs';

async function withState(run) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'p0wb-lock-release-'));
  try { const store=await initializeState(root); await run(store); }
  finally { await fs.rm(root,{recursive:true,force:true}); }
}
async function replaceLockedDirectory(store) {
  const lock=store.file('execution.lock');
  const old=store.file('execution.lock.original');
  const original=await fs.lstat(lock,{bigint:true});
  await fs.rename(lock,old);
  await fs.mkdir(lock,{mode:0o700});
  const replacement=await fs.lstat(lock,{bigint:true});
  assert.notEqual(replacement.ino,original.ino);
  return {lock,old};
}
async function assertNotCleared(store,result) {
  assert.equal(result.mode,'FAILED_LOCKED');
  assert.equal(result.reason,'LOCK_RELEASE_FAILED');
  const replacement=await fs.lstat(store.file('execution.lock'));
  assert.ok(replacement.isDirectory());
  const retry=await store.execute('github-publisher',null,{},async()=>({status:'PASS'}));
  assert.equal(retry.mode,'BLOCKED');
}
test('cannot unlink replacement lock directory when admission returns WAITING',async()=>{
  await withState(async store=>{
    const outcome=await store.execute('github-publisher',async()=>{
      await replaceLockedDirectory(store);
      return null;
    },{},async()=>({status:'PASS'}));
    await assertNotCleared(store,outcome);
  });
});
test('cannot unlink replacement lock directory after STARTED task reports PASS',async()=>{
  await withState(async store=>{
    const task={id:'lock-release-test',sha:'a'.repeat(40),repo:'ASI-integration/asi-landing',
      stage:'S4-G2',branch:'isolated-p0wb-test',pr:null};
    const outcome=await store.execute('github-publisher',task,{
      verifyTask:async()=>({observed:true})
    },async()=>{
      await replaceLockedDirectory(store);
      return {status:'PASS'};
    });
    await assertNotCleared(store,outcome);
  });
});
