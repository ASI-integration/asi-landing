import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {once} from 'node:events';
import pg from 'pg';
import {sealData} from 'iron-session';
assert.equal(process.env.CI,'true');assert.equal(process.env.STRIGUNOV_SYNTHETIC_ONLY,'YES');
const network=process.env.LAB_NETWORK;assert.match(network||'',/^strig2930-[0-9]+-1$/);
const options=({host:network+'-pg',port:5432,user:'postgres',password:process.env.LAB_ADMIN_PASSWORD,database:'task2930',connectionTimeoutMillis:2000});
let client=new pg.Client(options);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(){for(let i=0;i<30;i++){try{await client.connect();return;}catch{await client.end().catch(()=>{});if(i===29)throw Error('PG_NOT_READY');await delay(1000);client=new pg.Client(options);}}}
const sign=()=>{const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const s=b({alg:'HS256',typ:'JWT'})+'.'+b({role:'service_role',exp:Math.floor(Date.now()/1000)+600});return s+'.'+createHmac('sha256',process.env.LAB_JWT_SECRET).update(s).digest('base64url');};
const fetch=(url,options={})=>globalThis.fetch(url,{...options,signal:AbortSignal.timeout(10000)});
let app,proxy;const results=[],restErrors=[];let stage='bootstrap';let failures=0;let rowsAfterCleanup=null;let originalId;
const source=process.env.REVIEWED_SOURCE_SHA;
async function check(id,fn){stage=id;try{await fn();results.push({id,status:'PASS'});}catch{failures++;results.push({id,status:'FAIL'});throw Error('CASE_FAILED');}}
const stop=async()=>{if(app&&app.exitCode===null&&app.signalCode===null){const exited=once(app,'exit');app.kill('SIGTERM');await Promise.race([exited,delay(5000)]);if(app.exitCode===null&&app.signalCode===null){app.kill('SIGKILL');await Promise.race([exited,delay(5000)]);}assert.ok(app.exitCode!==null||app.signalCode!==null);}app=undefined;};
async function start(){
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','33100'],{env:{PATH:process.env.PATH,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',SESSION_SECRET:process.env.LAB_SESSION_SECRET,CRM_OPERATOR_EMAILS:'operator@example.invalid',SUPABASE_URL:'http://127.0.0.1:33001',SUPABASE_SERVICE_ROLE_KEY:sign(),COMMUNICATION_AUTO_SEND_ENABLED:'false'},stdio:'ignore'});
 for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:33100/api/dashboard/crm/queue');if(r.status===401)return;}catch{}if(app.exitCode!==null)throw Error('NEXT_EXIT');await delay(500);}throw Error('NEXT_NOT_READY');
}
const payload={name:'ASI_TEST_TASK2930',contact:'owner@example.invalid',objectsCount:'1 объект',referral:'strigunov',consent:true,website:''};
const post=(body=payload)=>fetch('http://127.0.0.1:33100/api/early-access/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const queue=cookie=>fetch('http://127.0.0.1:33100/api/dashboard/crm/queue?includeTest=1',{headers:cookie?{Cookie:'asi_session='+cookie}:{}});
const rows=async()=> (await client.query('SELECT id,name,email,property_count,source,notes FROM public.crm_contacts WHERE email=$1',['owner@example.invalid'])).rows;
try{
 // A new client per readiness attempt is necessary after a failed connect.
 await connect();
 const identity=(await client.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS version")).rows[0];
 assert.equal(identity.db,'task2930');assert.ok(identity.version>=170000&&identity.version<180000);
 if(process.argv.includes('--bootstrap')){
  assert.equal((await client.query("SELECT to_regclass('public.crm_contacts') AS t")).rows[0].t,null);
  await client.query('CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$');
  for(const file of ['20260619000001_crm_early_access_v1.sql','20260622000001_crm_queue_archive.sql'])await client.query(readFileSync('supabase/migrations/'+file,'utf8'));
  assert.match(process.env.LAB_AUTH_PASSWORD||'',/^[a-f0-9]{64}$/);
  await client.query("CREATE ROLE service_role NOLOGIN; CREATE ROLE task2930_authenticator LOGIN NOINHERIT PASSWORD '"+process.env.LAB_AUTH_PASSWORD+"'; GRANT service_role TO task2930_authenticator; GRANT USAGE ON SCHEMA public,auth TO service_role; GRANT EXECUTE ON FUNCTION auth.role() TO service_role; GRANT SELECT,INSERT,UPDATE,DELETE ON public.crm_contacts TO service_role;");
 }else{
  const token=sign();
  const rest='http://'+network+'-rest:33000';
  let ready=false;
  for(let i=0;i<30;i++){try{const r=await fetch(rest+'/crm_contacts?select=id',{headers:{Authorization:'Bearer '+token}});if(r.ok){ready=true;break;}}catch{}await delay(500);}assert.equal(ready,true);
  await check('T29-01-postgrest-anonymous-denied',async()=>{const r=await fetch(rest+'/crm_contacts?select=id');assert.ok([401,403].includes(r.status));});
  await check('T29-02-postgrest-invalid-jwt-denied',async()=>{const r=await fetch(rest+'/crm_contacts?select=id',{headers:{Authorization:'Bearer invalid'}});assert.equal(r.status,401);});
  // Transparent URL-prefix adapter only. The real Supabase SDK adds /rest/v1;
  // standalone PostgREST serves the same resource at /. No response is fabricated.

  proxy=http.createServer((req,res)=>{
   if(!req.url?.startsWith('/rest/v1/')){res.writeHead(404);res.end();return;}
   const path=req.url.slice('/rest/v1'.length);
   const upstream=http.request(rest+path,{method:req.method,headers:{...req.headers,host:network+'-rest:33000'}},up=>{
    if((up.statusCode||500)>=400)restErrors.push({resource:path.split('?')[0],status:up.statusCode});
    res.writeHead(up.statusCode||502,up.headers);up.pipe(res);
   });
   upstream.setTimeout(8000,()=>upstream.destroy());
   upstream.on('error',()=>{res.writeHead(503);res.end();});req.pipe(upstream);
  });proxy.listen(33001,'127.0.0.1');await once(proxy,'listening');
  await start();
  const operator=await sealData({userId:randomUUID(),email:'operator@example.invalid'},{password:process.env.LAB_SESSION_SECRET,ttl:300});
  const outsider=await sealData({userId:randomUUID(),email:'outside@example.invalid'},{password:process.env.LAB_SESSION_SECRET,ttl:300});
  await check('T29-03-missing-session-401',async()=>assert.equal((await queue()).status,401));
  await check('T29-04-tampered-session-401',async()=>assert.equal((await queue(operator.slice(0,-8)+'tampered')).status,401));
  await check('T29-05-valid-outsider-session-403',async()=>assert.equal((await queue(outsider)).status,403));
  await check('T29-06-no-consent-no-write',async()=>{assert.equal((await post({...payload,consent:false})).status,400);assert.equal((await rows()).length,0);});
  await check('T29-07-invalid-contact-no-write',async()=>{assert.equal((await post({...payload,contact:'bad'})).status,400);assert.equal((await rows()).length,0);});
  await check('T29-08-real-route-persisted',async()=>{const concurrent=await Promise.all([post(),post(),post()]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,200,201]);for(const r of concurrent)assert.deepEqual(await r.json(),{ok:true});const data=await rows();assert.equal(data.length,1);assert.equal(data[0].property_count,1);assert.match(data[0].notes,/Стригунов/);originalId=data[0].id;});
  await check('T29-09-operator-real-queue-same-id',async()=>{const r=await queue(operator);assert.equal(r.status,200);const body=await r.json();assert.equal(body.ok,true);assert.ok(body.items.some(x=>x.id===originalId));});
  await check('T29-10-concurrent-replay-one-row',async()=>{const rs=await Promise.all([post(),post(),post()]);assert.deepEqual(rs.map(r=>r.status),[200,200,200]);assert.equal((await rows()).length,1);});
  await stop();await start();
  await check('T29-11-restart-durable-readback',async()=>{const r=await queue(operator);assert.equal(r.status,200);assert.ok((await r.json()).items.some(x=>x.id===originalId));});
  // Record the unsatisfied product requirement, never relabel it as native PASS.
  const replay=await post();const restartedRows=await rows();
  results.push({id:'T29-12-restart-dedup',status:restartedRows.length===1?'PASS':'BLOCK',observedRows:restartedRows.length,httpStatus:replay.status,reason:restartedRows.length===1?undefined:'process-local dedup disappears on restart'});
  await client.query('ALTER ROLE task2930_authenticator NOLOGIN');
  await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='task2930_authenticator'");
  await check('T29-13-database-outage-503-sanitized',async()=>{const r=await post({...payload,contact:'outage@example.invalid'});assert.equal(r.status,503);const b=await r.json();assert.equal(b.ok,false);assert.equal(typeof b.message,'string');assert.equal(JSON.stringify(b).includes('postgres'),false);});
  await client.query('ALTER ROLE task2930_authenticator LOGIN');
  let restored=false;for(let i=0;i<40;i++){const r=await fetch(rest+'/crm_contacts?select=id',{headers:{Authorization:'Bearer '+token}});if(r.ok){restored=true;break;}await delay(500);}assert.equal(restored,true);
  await check('T29-14-failed-write-retry-persists',async()=>assert.equal((await post({...payload,contact:'outage@example.invalid'})).status,201));
  await check('T29-15-contact-rate-limit',async()=>{await post({...payload,name:payload.name+' changed'});assert.equal((await post({...payload,name:payload.name+' changed again'})).status,201);const r=await post({...payload,name:payload.name+' excess'});assert.equal(r.status,429);assert.ok(Number(r.headers.get('retry-after'))>0);});
 }
}catch{failures++;if(!results.some(r=>r.id===stage&&r.status==='FAIL'))results.push({id:stage,status:'FAIL'});process.exitCode=1;}
finally{
 await stop();if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
 if(!process.argv.includes('--bootstrap')){
  try{await client.query("DELETE FROM public.crm_contacts WHERE email IN ('owner@example.invalid','outage@example.invalid')");rowsAfterCleanup=Number((await client.query('SELECT count(*) FROM public.crm_contacts')).rows[0].count);assert.equal(rowsAfterCleanup,0);}catch{failures++;process.exitCode=1;}
  writeFileSync('task2930-results/native.json',JSON.stringify({source,run:network,completed:true,status:failures?'FAIL':results.some(r=>r.status==='BLOCK')?'PARTIAL':'PASS',unexpectedFailures:failures,results,rowsAfterCleanup,optionalQueueBoundaries:restErrors,limits:['sealed test cookies exercise real decoding/allowlist, not login issuance or durable revoke','optional queue helpers may suppress absent Booking Ops schemas','no production/live owner authority','Task30 component tests are separate evidence'],noExternalSend:true},null,2));
 }
 await client.end().catch(()=>{process.exitCode=1;});
}
