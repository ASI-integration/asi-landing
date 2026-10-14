import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync,statSync,mkdirSync,rmSync,renameSync,symlinkSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createTask25Root,initializeTask25,observeTask25,recordTask25,
 inspectTask25Lock,TASK25_ACTIONS,TASK25_SOURCE_BASE}
 from '../acceptance/strigunov-task25-local-ledger.mjs';
import {startTask25FixtureIpc,sendTask25FixtureRequest}
 from '../acceptance/strigunov-task25-local-ipc.mjs';
const RUN='strig-t25-123456789abc',HASH='a'.repeat(64);
const request=(seq,changes={})=>JSON.stringify({
 kind:'TASK25_LOCAL_FIXTURE_V1',runId:RUN,manifestSha256:HASH,
 sourceSha:TASK25_SOURCE_BASE,seq,requestId:seq.toString(16).padStart(32,'0'),
 command:TASK25_ACTIONS[seq-1]||TASK25_ACTIONS[0],observation:'OBSERVED',...changes
});
const fixture=()=>{
 const root=createTask25Root();
 assert.equal(initializeTask25(root,{runId:RUN,manifestSha256:HASH}).status,'INITIALIZED');
 return root;
};
const clean=root=>rmSync(root,{recursive:true,force:true}); // Test-created random OS-temp directory ONLY.
const hold=r=>{
 assert.equal(r.status,'HOLD');
 for(const key of ['authorized','canInstall','canIssueReceipt','canApprove','canSend','canRetryUnknownCommit'])
  assert.equal(r[key],false,key);
};
test('fresh disposable journal starts with no authority',()=>{
 const root=fixture();try{
  const x=observeTask25(root);assert.equal(x.status,'READBACK');
  assert.equal(x.sequence,0);assert.equal(x.state,'OPEN');
  if(process.platform!=='win32')assert.equal(statSync(root).mode&0o077,0);
 }finally{clean(root);}
});
test('six fixed commands persist with chained hashes and close',()=>{
 const root=fixture();try{
  for(let i=1;i<=TASK25_ACTIONS.length;i++){
   const v=recordTask25(root,request(i));
   assert.equal(v.status,'RECORDED_LOCAL_ONLY');assert.equal(v.canSend,false);
  }
  const x=observeTask25(root);assert.equal(x.sequence,6);assert.equal(x.state,'CLOSED');
  assert.notEqual(x.lastHash,'0'.repeat(64));hold(recordTask25(root,request(6)));
 }finally{clean(root);}
});
test('state survives fresh file reopening and denies duplicate ID',()=>{
 const root=fixture();try{
  recordTask25(root,request(1));assert.equal(observeTask25(root).sequence,1);
  hold(recordTask25(root,request(2,{requestId:'1'.padStart(32,'0') })));
  assert.equal(recordTask25(root,request(2)).status,'RECORDED_LOCAL_ONLY');
  hold(recordTask25(root,request(1)));
 }finally{clean(root);}
});
test('child exits after fsync without a reply, readback still has exactly one',()=>{
 const root=fixture(),url=pathToFileURL(resolve('scripts/acceptance/strigunov-task25-local-ledger.mjs')).href;
 try{
  const code='const x=await import(process.argv[3]);x.recordTask25(process.argv[1],process.argv[2]);process.exit(73)';
  const res=spawnSync(process.execPath,['--input-type=module','-e',code,root,request(1),url],
   {encoding:'utf8',timeout:10000});
  assert.equal(res.status,73,JSON.stringify(res.stderr));assert.equal(res.stdout,'');
  assert.equal(observeTask25(root).sequence,1);hold(recordTask25(root,request(1)));
 }finally{clean(root);}
});
test('uncertain COMMIT and denied operations persist HOLD without replay',()=>{
 for(const observation of ['COMMIT_UNCERTAIN','DENIED']){
  const root=fixture();try{
   hold(recordTask25(root,request(1,{observation})));
   const x=observeTask25(root);assert.equal(x.state,'HOLD');assert.equal(x.sequence,1);
   hold(recordTask25(root,request(2)));
  }finally{clean(root);}
 }
});
test('exclusive writer lock blocks all concurrent mutations',()=>{
 const root=fixture();try{
  mkdirSync(join(root,'writer.lock'));
  assert.equal(inspectTask25Lock(root).status,'HOLD');
  hold(recordTask25(root,request(1)));assert.equal(observeTask25(root).sequence,0);
 }finally{clean(root);}
});
test('torn append and damaged hash chain cause persistent HOLD',()=>{
 const root=fixture();try{
  appendFileSync(join(root,'events.ndjson'),'{"partial":');
  assert.equal(observeTask25(root).status,'HOLD');
  hold(recordTask25(root,request(1)));
 }finally{clean(root);}
 const root2=fixture();try{
  recordTask25(root2,request(1));
  const file=join(root2,'events.ndjson'),event=JSON.parse(readFileSync(file,'utf8'));
  event.observation='DENIED';writeFileSync(file,JSON.stringify(event)+'\n');
  assert.equal(observeTask25(root2).status,'HOLD');hold(recordTask25(root2,request(2)));
 }finally{clean(root2);}
});
test('wrong command, sequence gap and malformed payload are denied',()=>{
 const root=fixture();try{
  hold(recordTask25(root,request(3)));
  hold(recordTask25(root,request(1,{command:'stop-owned-lab'})));
  for(const raw of ['not-json','[]','{}',request(1,{canSend:true}),
    request(1,{command:'shell'}),request(1,{runId:[RUN]}),
    request(1,{requestId:['1'.padStart(32,'0')]}),
    request(1,{manifestSha256:[HASH]})])hold(recordTask25(root,raw));
  assert.equal(observeTask25(root).sequence,0);
 }finally{clean(root);}
});
test('cannot initialize over existing source data',()=>{
 const root=fixture();try{
  assert.throws(()=>initializeTask25(root,{runId:RUN,manifestSha256:HASH}),/NOT_FRESH/);
 }finally{clean(root);}
});
test('journal symlink is refused', {skip:process.platform==='win32'},()=>{
 const root=fixture();try{
  const file=join(root,'events.ndjson'),target=join(root,'other');
  writeFileSync(target,'');renameSync(file,join(root,'original'));
  symlinkSync(target,file);
  assert.equal(observeTask25(root).status,'HOLD');hold(recordTask25(root,request(1)));
 }finally{clean(root);}
});
test('two independent processes cannot commit the same request twice',async()=>{
 const root=fixture(),url=pathToFileURL(resolve('scripts/acceptance/strigunov-task25-local-ledger.mjs')).href;
 const code='const m=await import(process.argv[3]);process.stdout.write(m.recordTask25(process.argv[1],process.argv[2]).status)';
 const invoke=()=>new Promise((done,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',code,root,request(1),url]);
  let out='';child.stdout.on('data',b=>out+=b.toString());
  child.on('error',reject);child.on('close',()=>done(out));
 });
 try{
  const results=await Promise.all([invoke(),invoke()]);
  assert.equal(results.filter(x=>x==='RECORDED_LOCAL_ONLY').length,1,JSON.stringify(results));
  assert.equal(results.filter(x=>x==='HOLD').length,1,JSON.stringify(results));
  assert.equal(observeTask25(root).sequence,1);
 }finally{clean(root);}
});
test('Unix local IPC accepts one synthetic request and rejects replay',
 {skip:process.platform!=='linux'},async()=>{
 const root=fixture();let server=null;
 try{
  server=await startTask25FixtureIpc(root);
  assert.equal(statSync(server.path).mode&0o777,0o600);
  const bad=await sendTask25FixtureRequest(server.path,request(1,{command:'issue-operator'}));
  assert.equal(bad.status,'HOLD');
  const good=await sendTask25FixtureRequest(server.path,request(1));
  assert.equal(good.status,'RECORDED_LOCAL_ONLY');assert.equal(good.canSend,false);
  const dup=await sendTask25FixtureRequest(server.path,request(1));
  assert.equal(dup.status,'HOLD');assert.equal(dup.canIssueReceipt,false);
  assert.equal(observeTask25(root).sequence,1);
 }finally{if(server)await server.close();clean(root);}
});
test('Unix socket denies excess bytes and chained frames',
 {skip:process.platform!=='linux'},async()=>{
 const root=fixture();let server=null;
 try{
  server=await startTask25FixtureIpc(root);
  const huge=await sendTask25FixtureRequest(server.path,'x'.repeat(1700));
  assert.equal(huge.status,'HOLD');
  const many=await sendTask25FixtureRequest(server.path,request(1)+'\n'+request(1));
  assert.equal(many.status,'HOLD');
  assert.equal(observeTask25(root).sequence,0);
 }finally{if(server)await server.close();clean(root);}
});
test('Unix IPC refuses an uninitialized fixture', {skip:process.platform!=='linux'},async()=>{
 const root=createTask25Root();
 try{await assert.rejects(()=>startTask25FixtureIpc(root),/FIXTURE_NOT_READY/);}
 finally{clean(root);}
});
test('no production credentials, host authority or guest-sending functions',()=>{
 for(const file of ['scripts/acceptance/strigunov-task25-local-ledger.mjs',
   'scripts/acceptance/strigunov-task25-local-ipc.mjs']){
  const s=readFileSync(file,'utf8');
  assert.doesNotMatch(s,/sendTelegram|sendGuest|productionDb|POSTGRES_PASSWORD|process\.env\.HETZNER|https?:\/\//);
 }
 const doc=JSON.parse(readFileSync('docs/ops/strigunov-task25-host-boundary.json','utf8'));
 assert.equal(doc.guestSend,false);assert.equal(doc.phase2,'BLOCK');
 assert.equal(doc.ownerServiceInstalled,false);
});
