// Source-only preparation. Invoke only from the reviewed manual GitHub hosted job.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {admission,peers,owned,ORDER,DATABASE,DOMAINS,fail} from './strigunov-task17-contract.mjs';
import {PINS,SOURCES} from './strigunov-task17-manifest.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export async function preflight(e=process.env){
 const name=admission(e,process.platform);
 if(git(['rev-parse','HEAD'])!==e.REVIEWED_SHA)fail('CHECKOUT_SHA');
 for(const p of SOURCES){
  const bytes=readFileSync(p);
  const committed=execFileSync('git',['show',e.REVIEWED_SHA+':'+p],{maxBuffer:20000000,stdio:['ignore','pipe','pipe']});
  if(hash(bytes)!==hash(committed)||PINS[p]&&hash(bytes)!==PINS[p])fail('SOURCE_BYTES');
  if(git(['status','--porcelain','--',p]))fail('SOURCE_DIRTY');
 }
 // Owner manual dispatch is enforced by trusted workflow and admission; no admin API or environment.
 return name;
}
function docker(args,extra={}){
 return execFileSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:1024*1024,
 env:{PATH:process.env.PATH,...extra},stdio:['ignore','pipe','pipe']}).trim();
}
function identity(name){
 const x=JSON.parse(docker(['inspect','--format','{{json .}}',name]));
 // Never serialize the inspect result: Config.Env contains the ephemeral password.
 return {id:x.Id,name:x.Name.slice(1),label:x.Config.Labels['asi.strigunov.task17'],image:x.Config.Image};
}
export function cleanup(name,expected){
 const observed=identity(name);owned(expected,observed);
 docker(['rm','--force','--volumes',expected.id]);
 if(docker(['ps','-aq','--filter','id='+expected.id]))fail('CLEANUP_REMAINS');
}
export async function run(){
 const name=await preflight();
 if(process.argv.includes('--preflight'))return;
 const {Client}=await import('pg');
 const {SQL,IDS,bootstrapFence,executeScenario}=await import('./strigunov-task13-scenarios.mjs');
 const credentials=Object.fromEntries(['postgres','task12_provisioner','task12_login_a','task12_login_b','task12_denied'].map(r=>[r,randomBytes(32).toString('hex')]));
 const clients=[];let expected=null;let stage='container';
 const result={schema:1,run:name,source:process.env.REVIEWED_SHA,status:'HOLD',nativeExecuted:false,cleanup:'NOT_RUN',cases:[],phase2:'BLOCK',p13Wire:'BLOCK',realAuthority:'BLOCK',canSend:false};
 async function connect(user,database=DATABASE,password=credentials[user]){
  const c=new Client({host:'127.0.0.1',port:55442,database,user,password,connectionTimeoutMillis:5000,
   query_timeout:20000,application_name:name,options:'-c default_transaction_isolation=serializable -c statement_timeout=15000 -c lock_timeout=10000'});
  c.on('error',()=>{result.status='HOLD';result.connectionFault=true;});
  clients.push(c);await c.connect();return c;
 }
 try{
  if(docker(['ps','-aq','--filter','name=^/'+name+'$']))fail('NOT_FRESH');
  const id=docker(['run','--detach','--name',name,'--label','asi.strigunov.task17='+name,
   '--publish','127.0.0.1:55442:55442','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=512m',
   '--env','POSTGRES_PASSWORD','--env','POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256',
   '--env','POSTGRES_HOST_AUTH_METHOD=scram-sha-256',process.env.PG_IMAGE,
   'postgres','-p','55442','-c','log_statement=none','-c','log_min_error_statement=panic'],
   {POSTGRES_PASSWORD:credentials.postgres});
  expected={id,name,label:name,image:process.env.PG_IMAGE};owned(expected,identity(name));
  // Bounded startup polling only; transactional barriers use pg_blocking_pids, never timers.
  const deadline=Date.now()+60000;let ready=false;
  while(Date.now()<deadline){try{docker(['exec',id,'pg_isready','-h','127.0.0.1','-p','55442','-U','postgres']);ready=true;break;}
   catch{await new Promise(resolve=>setTimeout(resolve,500));}}
  if(!ready)fail('STARTUP_TIMEOUT');
  const setup=await connect('postgres','postgres');
  const meta=(await setup.query("SELECT current_setting('server_version_num')::int version,system_identifier::text system_id,inet_server_addr()::text host FROM pg_control_system()")).rows[0];
  if(meta.version<170000||meta.version>=180000||!/^\d+$/.test(meta.system_id)||!meta.host)fail('PG17_IDENTITY');
  result.instance=meta;result.nativeExecuted=true;stage='roles';
  if((await setup.query("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[DATABASE])).rows[0].n!==0)fail('DATABASE_EXISTS');
  await setup.query("CREATE ROLE strigunov_task11_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION");
  for(const r of ['anon','authenticated','service_role'])await setup.query('CREATE ROLE '+r+' NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION');
  for(const r of ['task12_provisioner','task12_login_a','task12_login_b','task12_denied']){
   // Fixed identifiers and cryptographic hex values only, never caller SQL or reusable credentials.
   await setup.query("CREATE ROLE "+r+" LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '"+credentials[r]+"'");
  }
  await setup.query('GRANT strigunov_task11_owner TO task12_provisioner');
  await setup.query('CREATE DATABASE '+DATABASE+' OWNER strigunov_task11_owner');
  await setup.query('REVOKE ALL ON DATABASE '+DATABASE+' FROM PUBLIC');
  await setup.query('GRANT CONNECT ON DATABASE '+DATABASE+' TO task12_provisioner,task12_login_a,task12_login_b,task12_denied');
  const auth=(await setup.query("SELECT count(*)::int n FROM pg_authid WHERE rolname IN ('task12_provisioner','task12_login_a','task12_login_b','task12_denied') AND rolpassword LIKE 'SCRAM-SHA-256$%'")).rows[0];
  const hba=await setup.query("SELECT auth_method,error FROM pg_hba_file_rules WHERE type LIKE 'host%'");
  if(auth.n!==4||!hba.rows.length||hba.rows.some(r=>r.error||r.auth_method!=='scram-sha-256'))fail('PASSWORD_AUTH');
  await setup.end();
  const admin=await connect('task12_provisioner');
  await admin.query('SET ROLE strigunov_task11_owner');
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  for(const p of ORDER){stage=p;await admin.query(readFileSync(p,'utf8'));}
  for(const r of ['task12_login_a','task12_login_b']){
   let denied=false;try{await connect(r,DATABASE,randomBytes(32).toString('hex'));}catch(e){denied=e.code==='28P01';}
   if(!denied)fail('WRONG_PASSWORD_ACCEPTED');
  }
  stage='two-login';
  const a=await connect('task12_login_a'),b=await connect('task12_login_b'),denied=await connect('task12_denied');
  const observations=await Promise.all([a,b,admin,denied].map(async c=>(await c.query(SQL.peer)).rows[0]));
  peers(observations[0],observations[1],meta.host);
  if(observations[2].session_user!=='task12_provisioner'||observations[2].current_user!=='strigunov_task11_owner'||observations[3].session_user!=='task12_denied'||new Set(observations.map(p=>p.pid)).size!==4)fail('ROLE_SPLIT');
  result.peers=observations;
  const tables=(await admin.query("SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('public','asi_task08_private','asi_task11_private','task13_fixture')")).rows;
  if(!tables.length||tables.some(t=>!t.relrowsecurity||!t.relforcerowsecurity))fail('FORCE_RLS');
  const pair={a,b,admin,denied,peers:observations};
  let slot=14;
  for(const domain of DOMAINS)for(const timing of ['commit','rollback','race']){
   stage=domain+':'+timing;
   const proof=await bootstrapFence(pair,domain,timing,slot++);
   result.cases.push({case:domain+':'+timing,status:'PASS',proof});
  }
  for(const [i,id] of IDS.entries())if(id!=='stale_actor'){
   stage=id;
   const proof=await executeScenario(pair,id,i+1,1);
   result.cases.push({case:id,status:'PASS',proof});
  }
  const closed=(await admin.query("SELECT (SELECT count(*) FROM public.sessions)::int sessions,(SELECT count(*) FROM asi_task08_private.requests)::int requests,(SELECT count(*) FROM asi_task11_private.installation WHERE native_acceptance_sha256 IS NOT NULL)::int markers")).rows[0];
  if(closed.sessions||closed.requests||closed.markers||result.cases.length!==30||result.connectionFault)fail('PHASE1_NOT_CLOSED');
  result.closed=closed;result.status='TECHNICAL_PHASE1_PASS';
 }catch(e){result.status='HOLD';result.failedStage=stage;result.error=/^[A-Z0-9_]{3,60}$/.test(e.code||'')?e.code:'LAB_FAILED';}
 finally{
  await Promise.allSettled(clients.map(c=>c.end()));
  if(expected){try{cleanup(name,expected);result.cleanup='PASS';}catch{result.cleanup='HOLD';result.status='HOLD';}}
  for(const r of Object.keys(credentials))credentials[r]='';
  writeFileSync('strigunov-task17-result.json',JSON.stringify(result,null,2)+'\n');
 }
 if(result.status!=='TECHNICAL_PHASE1_PASS')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--cleanup')){
  // Cancellation fallback: exact run label/name/image only. Never prune unrelated resources.
  try{const name=admission(process.env,process.platform);const c=identity(name);owned({id:c.id,name,label:name,image:process.env.PG_IMAGE},c);cleanup(name,c);}
  catch{process.exitCode=1;}
 }else await run().catch(()=>{console.error('TASK17_PREFLIGHT_BLOCK');process.exitCode=1;});
}
