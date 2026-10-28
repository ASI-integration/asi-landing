import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {digest} from './state.mjs';
import {createRequestBudget} from './host-runtime.mjs';

const runtime=new URL('./host-runtime.mjs',import.meta.url).href;
async function setup(t,budget={maxRequests:3,maxMutations:1}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-host-budget-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'state'),{mode:0o700});
  const payload={budget},file=path.join(root,'state/api-budget.json'),lock=path.join(root,'state/api-budget.lock');
  await fs.writeFile(file,JSON.stringify({policySha256:digest(JSON.stringify(payload)),requests:0,mutations:0}),{mode:0o600});
  return {root,payload,file,lock,read:async()=>JSON.parse(await fs.readFile(file))};
}
function child(t,f,options={}){
  const code=`import fs from 'node:fs/promises';import {once} from 'node:events';
    import {createRequestBudget} from ${JSON.stringify(runtime)};
    const {root,payload,options}=JSON.parse(process.argv[1]);
    const revalidate=async()=>{if(options.hold){process.send({held:true});await once(process,'message');}};
    if(options.failAfterRename){const rename=fs.rename;fs.rename=async(...args)=>{await rename(...args);throw Error('SIMULATED_AMBIGUOUS_WRITE');};}
    try{await createRequestBudget({root,payload,revalidate})({mutation:options.mutation===true});process.send({result:'RESERVED'});}
    catch(e){process.send({result:e.message});}
    process.disconnect();`;
  const proc=spawn(process.execPath,['--input-type=module','-e',code,JSON.stringify({root:f.root,payload:f.payload,options})],
    {stdio:['ignore','ignore','pipe','ipc']});
  const messages=[];let errors='';
  proc.on('message',m=>messages.push(m));proc.stderr.on('data',v=>{errors+=v;});
  const done=once(proc,'exit').then(([status,signal])=>({status,signal,messages,errors}));
  t.after(()=>{if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL');});
  return {proc,done};
}
async function run(t,f,options={}){
  const out=await child(t,f,options).done;
  assert.equal(out.status,0,out.errors);assert.equal(out.signal,null);
  return out.messages.at(-1).result;
}

test('separate processes cannot reserve the same budget slot concurrently',async t=>{
  const f=await setup(t),first=child(t,f,{hold:true,mutation:true});
  assert.deepEqual((await once(first.proc,'message'))[0],{held:true});
  assert.equal(await run(t,f,{mutation:true}),'API_BUDGET_LOCKED_OR_CRASHED');
  assert.equal((await f.read()).requests,0);
  first.proc.send({continue:true});const out=await first.done;
  assert.equal(out.status,0,out.errors);assert.equal(out.messages.at(-1).result,'RESERVED');
  assert.deepEqual(await f.read(),{policySha256:digest(JSON.stringify(f.payload)),requests:1,mutations:1});
  assert.equal(await run(t,f),'RESERVED');assert.equal((await f.read()).requests,2);
  await assert.rejects(()=>fs.stat(f.lock),{code:'ENOENT'});
});

test('SIGKILL while the directory lock is held blocks a fresh process without automatic cleanup',async t=>{
  const f=await setup(t),first=child(t,f,{hold:true});
  await once(first.proc,'message');first.proc.kill('SIGKILL');
  assert.equal((await first.done).signal,'SIGKILL');
  assert.equal(await run(t,f),'API_BUDGET_LOCKED_OR_CRASHED');
  assert.equal((await f.read()).requests,0);assert.ok((await fs.stat(f.lock)).isDirectory());
});

test('ambiguous write after rename never releases a request or deletes the lock',async t=>{
  const f=await setup(t);
  assert.equal(await run(t,f,{failAfterRename:true,mutation:true}),'SIMULATED_AMBIGUOUS_WRITE');
  assert.equal((await f.read()).requests,1);assert.equal((await f.read()).mutations,1);
  assert.equal(await run(t,f),'API_BUDGET_LOCKED_OR_CRASHED');
  assert.ok((await fs.stat(f.lock)).isDirectory());
});

test('request and mutation caps survive independent processes and failed external work',async t=>{
  const f=await setup(t,{maxRequests:2,maxMutations:1});
  // A reserved request is spent even if the subsequent external request fails.
  assert.equal(await run(t,f,{mutation:true}),'RESERVED');
  assert.equal(await run(t,f,{mutation:true}),'API_BUDGET_EXHAUSTED_OR_CHANGED');
  assert.equal(await run(t,f),'RESERVED');
  assert.equal(await run(t,f),'API_BUDGET_EXHAUSTED_OR_CHANGED');
  assert.deepEqual(await f.read(),{policySha256:digest(JSON.stringify(f.payload)),requests:2,mutations:1});
  await assert.rejects(()=>fs.stat(f.lock),{code:'ENOENT'});
});

test('revalidation and policy failures happen before reservation without resetting counters',async t=>{
  const f=await setup(t),before=await fs.readFile(f.file,'utf8');
  await assert.rejects(()=>createRequestBudget({...f,revalidate:async()=>{throw Error('REVOKED');}})(),/REVOKED/);
  assert.equal(await fs.readFile(f.file,'utf8'),before);
  assert.equal(await run(t,{...f,payload:{budget:{maxRequests:4,maxMutations:1}}}),'API_BUDGET_EXHAUSTED_OR_CHANGED');
  assert.equal(await fs.readFile(f.file,'utf8'),before);
  await assert.rejects(()=>fs.stat(f.lock),{code:'ENOENT'});
});

test('state-directory symlink is rejected before lock or budget writes',async t=>{
  const f=await setup(t),real=path.join(f.root,'original-state');
  await fs.rename(path.join(f.root,'state'),real);await fs.symlink(real,path.join(f.root,'state'));
  assert.equal(await run(t,f),'API_BUDGET_DIRECTORY');
  assert.equal((await f.read()).requests,0);
  await assert.rejects(()=>fs.stat(path.join(real,'api-budget.lock')),{code:'ENOENT'});
});
