import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createPinnedSourceReader} from './source-git-context.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const REPO='ASI-integration/asi-landing';
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-source-git-'));
  await fs.chmod(root,0o700);
  const git=(args)=>execFileSync('/usr/bin/git',args,{cwd:root,
    encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  git(['init','-q']);
  await fs.mkdir(path.join(root,'docs'),{mode:0o700});
  const content='def existing():\n    return 1\n';
  await fs.writeFile(path.join(root,'docs','existing.py'),content);
  git(['add','docs/existing.py']);git(['-c','user.name=ASI test','-c','user.email=test@example.invalid','commit','-qm','fixture']);git(['checkout','--detach','-q']);
  const baseSha=git(['rev-parse','HEAD']).trim();
  const task={id:'test-code-task',laneId:'engine',repo:REPO,
    branch:'asi/beget-one-engine-20261028',baseSha,
    stage:'S4-G2',kind:'source-proposal',objective:'Change the existing function.',
    files:[{path:'docs/existing.py',beforeSha256:sha(content)}]};
  return {root,task,baseSha,content,close:async()=>fs.rm(root,{recursive:true,force:true})};
}
test('native detached checkout with exact file content and before SHA',async()=>{
  const f=await fixture();try{
    const read=createPinnedSourceReader({checkout:f.root,admittedTasks:[f.task]});
    const v=await read({id:f.task.id,baseSha:f.baseSha,paths:['docs/existing.py']});
    assert.equal(v.length,1);
    assert.equal(v[0].content,f.content);
    assert.equal(v[0].beforeSha256,sha(f.content));
    assert(Object.isFrozen(v));
  }finally{await f.close()}
});
test('authorized missing file is represented as absent and never invented',async()=>{
  const f=await fixture();try{
    const t={...f.task,files:[{path:'docs/new.py',beforeSha256:null}]};
    const read=createPinnedSourceReader({checkout:f.root,admittedTasks:[t]});
    const v=await read({id:t.id,baseSha:f.baseSha,paths:['docs/new.py']});
    assert.equal(v[0].content,'');
    assert.equal(v[0].beforeSha256,null);
  }finally{await f.close()}
});
test('dirty source or wrong baseline is blocked before any provider egress',async()=>{
  const f=await fixture();try{
    const read=createPinnedSourceReader({checkout:f.root,admittedTasks:[f.task]});
    await fs.writeFile(path.join(f.root,'docs','existing.py'),'changed');
    await assert.rejects(read({id:f.task.id,baseSha:f.baseSha,
      paths:['docs/existing.py']}),/GIT_BASE_OR_SCRATCH_UNVERIFIED/);
    await assert.rejects(read({id:f.task.id,baseSha:'f'.repeat(40),
      paths:['docs/existing.py']}),/PINNED_TASK_MISMATCH/);
  }finally{await f.close()}
});
test('cannot read unauthorized path or unapproved catalog mutation',async()=>{
  const f=await fixture();try{
    const read=createPinnedSourceReader({checkout:f.root,admittedTasks:[f.task]});
    await assert.rejects(read({id:f.task.id,baseSha:f.baseSha,
      paths:['docs/../../etc/passwd']}),/PINNED_SOURCE_SCOPE_INVALID/);
    await assert.rejects(read({id:f.task.id,baseSha:f.baseSha,
      paths:['docs/unadmitted.py']}),/PINNED_TASK_MISMATCH/);
  }finally{await f.close()}
});
test('symlink/linked path cannot escape allowed source checkout',async()=>{
  const f=await fixture();try{
    await fs.rm(path.join(f.root,'docs','existing.py'));
    await fs.symlink('/etc/passwd',path.join(f.root,'docs','existing.py'));
    const read=createPinnedSourceReader({checkout:f.root,admittedTasks:[f.task]});
    await assert.rejects(read({id:f.task.id,baseSha:f.baseSha,
      paths:['docs/existing.py']}),/GIT_BASE_OR_SCRATCH_UNVERIFIED|SOURCE_ENTRY_UNVERIFIED/);
  }finally{await f.close()}
});
test('non-detached checkout cannot provide code context to model',async()=>{
  const f=await fixture();try{
    execFileSync('/usr/bin/git',['checkout','-q','master'],{cwd:f.root});
    const read=createPinnedSourceReader({checkout:f.root,admittedTasks:[f.task]});
    await assert.rejects(read({id:f.task.id,baseSha:f.baseSha,
      paths:['docs/existing.py']}),/GIT_BASE_OR_SCRATCH_UNVERIFIED/);
  }finally{await f.close()}
});
test('mismatching before-file hash is never sent to provider',async()=>{
  const f=await fixture();try{
    const t={...f.task,files:[{path:'docs/existing.py',beforeSha256:'f'.repeat(64)}]};
    const read=createPinnedSourceReader({checkout:f.root,admittedTasks:[t]});
    await assert.rejects(read({id:t.id,baseSha:f.baseSha,
      paths:['docs/existing.py']}),/SOURCE_CONTENT_UNVERIFIED/);
  }finally{await f.close()}
});

test('unapproved local Git filter config blocks source context before git invocation',async()=>{
  const f=await fixture();try{
    await fs.appendFile(path.join(f.root,'.git','config'),
      '\n[filter "danger"]\n  process = /bin/false\n');
    const read=createPinnedSourceReader({checkout:f.root,admittedTasks:[f.task]});
    await assert.rejects(read({id:f.task.id,baseSha:f.baseSha,
      paths:['docs/existing.py']}),/UNTRUSTED_GIT_CONFIG/);
  }finally{await f.close()}
});
