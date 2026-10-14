// Task21. Execute ONLY in guarded manual ephemeral GitHub-hosted job; never on laptop/production.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createServer,connect as tcpConnect} from 'node:net';
import {pathToFileURL} from 'node:url';
import {BackendFrames,FrontendObserver,CommitReplyFilter,inspectClientUnknown} from './strigunov-task21-wire.mjs';
const SHA=/^[a-f0-9]{40}$/,PORT=55443;
const IMAGE='postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
const SOURCES=Object.freeze([
 '.github/workflows/strigunov-task21-pg-wire-manual.yml',
 'scripts/acceptance/strigunov-task21-wire.mjs',
 'scripts/acceptance/strigunov-task21-wire-lab.mjs',
 'scripts/__tests__/strigunov-task21-wire.test.mjs',
 'docs/ops/strigunov-task21-wire-contract.md',
 'package.json','package-lock.json'
]);
const die=code=>{throw Object.assign(Error(code),{code});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function admission(e){
 if(process.platform!=='linux'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_ENVIRONMENT!=='github-hosted'||e.RUNNER_OS!=='Linux')die('HOST_NOT_TRUSTED');
 if(e.GITHUB_REPOSITORY!=='ASI-integration/asi-landing'||e.GITHUB_EVENT_NAME!=='workflow_dispatch'||e.GITHUB_REF!=='refs/heads/main')die('EVENT_NOT_TRUSTED');
 if(e.GITHUB_ACTOR!=='ASI-integration'||e.GITHUB_ACTOR_ID!=='207600140'||e.GITHUB_TRIGGERING_ACTOR!=='ASI-integration'||e.GITHUB_RUN_ATTEMPT!=='1')die('ACTOR_NOT_TRUSTED');
 if(!SHA.test(e.REVIEWED_SHA||'')||e.REVIEWED_SHA!==e.GITHUB_SHA||e.REVIEWED_SHA!==e.GITHUB_WORKFLOW_SHA)die('SOURCE_SHA');
 if(e.CONFIRM!=='TASK21_SYNTHETIC_LOST_COMMIT_NO_GUEST_SEND'||e.PG_IMAGE!==IMAGE)die('SYNTHETIC_SCOPE');
 if(!/^[1-9][0-9]{5,}$/.test(e.GITHUB_RUN_ID||''))die('RUN_ID');
 return 'strig-t21-'+e.GITHUB_RUN_ID+'-1';
}
function sourcePreflight(e){
 const name=admission(e);
 if(git(['rev-parse','HEAD'])!==e.REVIEWED_SHA)die('CHECKOUT_SHA');
 for(const path of SOURCES){
  const physical=readFileSync(path);
  const committed=execFileSync('git',['show',e.REVIEWED_SHA+':'+path],{maxBuffer:30000000,stdio:['ignore','pipe','pipe']});
  if(hash(physical)!==hash(committed)||git(['status','--porcelain','--',path]))die('SOURCE_BYTES');
 }
 return name;
}
function docker(args,extra={}){
 return execFileSync('docker',args,{encoding:'utf8',maxBuffer:1024*1024,timeout:120000,
  env:{PATH:process.env.PATH,...extra},stdio:['ignore','pipe','pipe']}).trim();
}
function getIdentity(name){
 const x=JSON.parse(docker(['inspect','--format','{{json .}}',name]));
 // Never serialize Docker Config: it contains a generated password.
 return {id:x.Id,name:x.Name.slice(1),label:x.Config.Labels['asi.strigunov.task21'],image:x.Config.Image};
}
function owned(expected,actual){
 if(!expected||!actual||!(/^[a-f0-9]{64}$/.test(expected.id))||
  !Object.keys(expected).every(k=>actual[k]===expected[k]))die('FOREIGN_CONTAINER');
}
function cleanup(expected){
 owned(expected,getIdentity(expected.name));
 docker(['rm','--force','--volumes',expected.id]);
 if(docker(['ps','-aq','--filter','id='+expected.id]))die('CLEANUP_FAILED');
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function withDeadline(p,ms,code){
 let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(code),{code})),ms);})]);}
 finally{clearTimeout(timer);}
}
async function makeProxy(){
 let socketCount=0,done=false,settle;
 const evidence=new Promise((resolve,reject)=>{settle={resolve,reject};});
 const sockets=new Set();
 const server=createServer(client=>{
  socketCount++;
  if(socketCount!==1){client.destroy();settle.reject(Error('PROXY_MULTIPLE_CLIENTS'));return;}
  sockets.add(client);
  const remote=tcpConnect({host:'127.0.0.1',port:PORT});
  sockets.add(remote);
  const frontend=new FrontendObserver(),backend=new BackendFrames(),filter=new CommitReplyFilter();
  const abort=()=>{if(!done){done=true;settle.reject(Error('WIRE_ABORT'));}client.destroy();remote.destroy();};
  client.on('data',bytes=>{try{
   frontend.feed(bytes);
   remote.write(bytes);
  }catch{abort();}});
  remote.on('data',bytes=>{try{
   for(const frame of backend.feed(bytes)){
    const r=filter.inspect(frame,frontend.commitCount===1);
    if(r.forward)client.write(frame.raw);
    if(r.finished){
     if(done)throw Error('WIRE_DOUBLE_READY');
     done=true;
     settle.resolve({commitCount:frontend.commitCount,serverCommitTag:filter.commandComplete,
      serverReady:filter.serverReady,ackForwarded:filter.forwardedCommitReply});
     client.destroy();remote.destroy();break;
    }
   }
  }catch{abort();}});
  client.on('error',abort);remote.on('error',abort);
  remote.on('end',()=>{if(!done)abort();});
  client.on('close',()=>{remote.destroy();sockets.delete(client);});
  remote.on('close',()=>sockets.delete(remote));
 });
 server.on('error',e=>{if(!done){done=true;settle.reject(Error('PROXY_LISTEN'));}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 return {port:server.address().port,evidence,close:async()=>{
  for(const s of sockets)s.destroy();
  await new Promise(resolve=>server.close(()=>resolve()));
 }};
}
export async function run(){
 const name=sourcePreflight(process.env);
 if(process.argv.includes('--preflight'))return;
 const {Client}=await import('pg');
 const creds={postgres:randomBytes(32).toString('hex'),
  task21_writer:randomBytes(32).toString('hex'),task21_reader:randomBytes(32).toString('hex')};
 let expected=null,proxy=null,stage='container',clients=[];
 const result={schema:1,run:name,source:process.env.REVIEWED_SHA,status:'HOLD',
  nativeExecuted:false,cleanup:'NOT_RUN',phase2:'BLOCK',realAuthority:'BLOCK',
  guestConsent:'NOT_TESTED',canSend:false,p13Wire:'NOT_RUN',cases:[]};
 async function pg(user='postgres',port=PORT){
  const c=new Client({host:'127.0.0.1',port,database:'postgres',user,password:creds[user],
   ssl:false,connectionTimeoutMillis:5000,query_timeout:12000,
   application_name:name,options:'-c statement_timeout=10000 -c lock_timeout=7000'});
  c.on('error',()=>{if(result.status==='P13_NATIVE_TECHNICAL_PASS')result.status='HOLD';});
  clients.push(c);await c.connect();return c;
 }
 const readCount=async(reader,key)=>{
  const r=await reader.query('SELECT count(*)::int AS n FROM public.task21_wire_events WHERE id=$1',[key]);
  if(r.rows.length!==1||!Number.isSafeInteger(r.rows[0].n))die('READBACK_INVALID');
  return r.rows[0].n;
 };
 try{
  if(docker(['ps','-aq','--filter','name=^/'+name+'$']))die('CONTAINER_NOT_FRESH');
  const id=docker(['run','--detach','--name',name,'--label','asi.strigunov.task21='+name,
   '--publish','127.0.0.1:'+PORT+':'+PORT,
   '--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=512m',
   '--env','POSTGRES_PASSWORD','--env','POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256',
   '--env','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',process.env.PG_IMAGE,
   'postgres','-p',String(PORT),'-c','log_statement=none','-c','log_min_error_statement=panic'],
   {POSTGRES_PASSWORD:creds.postgres});
  expected={id,name,label:name,image:process.env.PG_IMAGE};owned(expected,getIdentity(name));
  stage='readiness';
  let ready=false;for(let i=0;i<120;i++){
   try{docker(['exec',id,'pg_isready','-h','127.0.0.1','-p',String(PORT),'-U','postgres']);ready=true;break;}
   catch{await pause(500);}
  }
  if(!ready)die('PG_STARTUP_TIMEOUT');
  stage='setup';
  const root=await pg();
  const meta=(await root.query("SELECT current_setting('server_version_num')::int version,system_identifier::text system_id FROM pg_control_system()")).rows[0];
  if(meta.version<170000||meta.version>=180000||!/^[0-9]+$/.test(meta.system_id))die('PG_VERSION');
  result.instance=meta;result.nativeExecuted=true;
  for(const r of ['task21_writer','task21_reader'])
   await root.query("CREATE ROLE "+r+" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '"+creds[r]+"'");
  const auth=(await root.query("SELECT count(*)::int n FROM pg_authid WHERE rolname IN ('task21_writer','task21_reader') AND rolpassword LIKE 'SCRAM-SHA-256$%'")).rows[0].n;
  const hba=(await root.query("SELECT auth_method,error FROM pg_hba_file_rules WHERE type LIKE 'host%'")).rows;
  if(auth!==2||!hba.length||hba.some(x=>x.error||x.auth_method!=='scram-sha-256'))die('SCRAM_REQUIRED');
  await root.query('CREATE TABLE public.task21_wire_events(id text PRIMARY KEY, marker int NOT NULL CHECK(marker=1))');
  await root.query('REVOKE ALL ON public.task21_wire_events FROM PUBLIC');
  await root.query('GRANT SELECT,INSERT ON public.task21_wire_events TO task21_writer');
  await root.query('GRANT SELECT ON public.task21_wire_events TO task21_reader');
  await root.query('ALTER TABLE public.task21_wire_events ENABLE ROW LEVEL SECURITY');
  await root.query('ALTER TABLE public.task21_wire_events FORCE ROW LEVEL SECURITY');
  await root.query('CREATE POLICY t21_writer_insert ON public.task21_wire_events FOR INSERT TO task21_writer WITH CHECK(true)');
  await root.query('CREATE POLICY t21_writer_read ON public.task21_wire_events FOR SELECT TO task21_writer USING(true)');
  await root.query('CREATE POLICY t21_reader_read ON public.task21_wire_events FOR SELECT TO task21_reader USING(true)');
  const writer=await pg('task21_writer'),reader=await pg('task21_reader');
  stage='least-privilege';
  let denied=false;try{await reader.query("INSERT INTO public.task21_wire_events VALUES('forbidden',1)");}catch(e){denied=e.code==='42501';}
  if(!denied)die('READER_CAN_WRITE');
  const ackKey=randomUUID(),abortKey=randomUUID(),lostKey=randomUUID();
  stage='normal-ack-control';
  await writer.query('BEGIN');
  await writer.query('INSERT INTO public.task21_wire_events VALUES($1,1)',[ackKey]);
  const committed=await writer.query('COMMIT');
  if(committed.command!=='COMMIT'||await readCount(reader,ackKey)!==1)die('CONTROL_COMMIT');
  result.cases.push({case:'normal_ack_persisted',status:'PASS',clientAck:true,readback:1});
  stage='disconnect-before-commit-control';
  const abortClient=await pg('task21_writer');
  await abortClient.query('BEGIN');
  await abortClient.query('INSERT INTO public.task21_wire_events VALUES($1,1)',[abortKey]);
  await abortClient.end(); // clean client disconnection rolls back the uncommitted transaction
  if(await readCount(reader,abortKey)!==0)die('EARLY_DISCONNECT_COMMITTED');
  result.cases.push({case:'disconnect_before_commit_rollback',status:'PASS',commitSubmitted:false,readback:0});
  stage='lost-commit-server-confirmed';
  proxy=await makeProxy();
  const lost=await pg('task21_writer',proxy.port);
  await lost.query('BEGIN');
  await lost.query('INSERT INTO public.task21_wire_events VALUES($1,1)',[lostKey]);
  const pending=lost.query('COMMIT').then(()=>({ack:true}),()=>({ack:false}));
  const observed=await withDeadline(proxy.evidence,11000,'WIRE_RESPONSE_TIMEOUT');
  const client=await withDeadline(pending,11000,'CLIENT_CLOSE_TIMEOUT');
  const preReconciliation={commitCount:observed.commitCount,serverCommitTag:observed.serverCommitTag,
   serverReady:observed.serverReady,ackForwarded:observed.ackForwarded,clientObservedSuccess:client.ack};
  if(client.ack||observed.commitCount!==1||observed.ackForwarded!==false||
     observed.serverCommitTag!==true||observed.serverReady!==true)die('REPLY_NOT_LOST');
  const initial=inspectClientUnknown(preReconciliation,null);
  if(initial.status!=='HOLD'||initial.canRetry!==false)die('UNKNOWN_NOT_HELD');
  stage='readonly-post-commit-reconciliation';
  const count=await readCount(reader,lostKey);
  const reconciled=inspectClientUnknown(preReconciliation,count);
  if(reconciled.status!=='TECHNICAL_WIRE_RECONCILED'||reconciled.persisted!=='EXACTLY_ONE'||reconciled.canRetry!==false)die('RECONCILIATION_FAILED');
  result.cases.push({case:'server_commit_reply_dropped',status:'PASS',
   serverCommitCompleteSeenByProxy:true,serverReadyForQuerySeenByProxy:true,
   commitReplyForwardedToClient:false,clientAck:false,commitSubmissions:1,
   initialClient:'HOLD',authoritativeReadback:1,replayed:false,canRetry:false});
  result.closed={ack:await readCount(reader,ackKey),beforeCommit:await readCount(reader,abortKey),
   lostReply:await readCount(reader,lostKey)};
  if(result.cases.length!==3||result.closed.ack!==1||result.closed.beforeCommit!==0||result.closed.lostReply!==1)die('CASE_COUNT');
  result.p13Wire='TECHNICAL_WIRE_PASS';
 }catch(e){result.status='HOLD';result.failedStage=stage;result.error=/^[A-Z0-9_]{3,60}$/.test(e?.code||'')?e.code:'WIRE_LAB_FAILED';}
 finally{
  if(proxy){try{await withDeadline(proxy.close(),5000,'PROXY_CLEANUP_TIMEOUT');}catch{result.status='HOLD';result.error='PROXY_CLEANUP';}}
  const closed=await Promise.allSettled(clients.map(c=>withDeadline(c.end(),3000,'PG_CLIENT_CLOSE')));
  if(closed.some(x=>x.status==='rejected')){result.status='HOLD';result.error='CLIENT_CLEANUP';}
  if(expected){try{cleanup(expected);result.cleanup='PASS';}catch{result.cleanup='HOLD';result.status='HOLD';result.error='DOCKER_CLEANUP';}}
  for(const name of Object.keys(creds))creds[name]='';
  if(result.p13Wire==='TECHNICAL_WIRE_PASS'&&result.cleanup==='PASS'&&result.status!=='HOLD')
   result.status='P13_NATIVE_TECHNICAL_PASS';
  // Success is set only after all validations and owned cleanup, not before.
  if(result.p13Wire==='TECHNICAL_WIRE_PASS'&&result.cleanup==='PASS'&&!result.error)
   result.status='P13_NATIVE_TECHNICAL_PASS';
  writeFileSync('strigunov-task21-result.json',JSON.stringify(result,null,2)+'\n');
 }
 if(result.status!=='P13_NATIVE_TECHNICAL_PASS')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--cleanup')){
  try{
   const name=admission(process.env),actual=getIdentity(name);
   owned({id:actual.id,name,label:name,image:process.env.PG_IMAGE},actual);
   cleanup(actual);
  }catch{process.exitCode=1;}
 }else run().catch(()=>{console.error('TASK21_ADMISSION_HOLD');process.exitCode=1;});
}
