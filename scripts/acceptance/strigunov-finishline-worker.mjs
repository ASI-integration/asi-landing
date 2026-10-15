import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {once} from 'node:events';
import pg from 'pg';
import {sealData} from 'iron-session';
assert.equal(process.env.CI,'true');assert.equal(process.env.STRIGUNOV_SYNTHETIC_ONLY,'YES');
const network=process.env.LAB_NETWORK;assert.match(network||'',/^strigfin-[0-9]+-1$/);
const options=({host:network+'-pg',port:5432,user:'postgres',password:process.env.LAB_ADMIN_PASSWORD,database:'task32',connectionTimeoutMillis:2000});
let client=new pg.Client(options);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(){for(let i=0;i<30;i++){try{await client.connect();return;}catch{await client.end().catch(()=>{});if(i===29)throw Error('PG_NOT_READY');await delay(1000);client=new pg.Client(options);}}}
const sign=()=>{const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const s=b({alg:'HS256',typ:'JWT'})+'.'+b({role:'service_role',exp:Math.floor(Date.now()/1000)+600});return s+'.'+createHmac('sha256',process.env.LAB_JWT_SECRET).update(s).digest('base64url');};
const fetch=(url,options={})=>globalThis.fetch(url,{...options,signal:AbortSignal.timeout(10000)});
let app,proxy;const results=[],restErrors=[];let stage='bootstrap';let failures=0;let rowsAfterCleanup=null;let originalId;let cleanupStage='not-started';let cleanupFailure=null;
const source=process.env.REVIEWED_SOURCE_SHA;
async function check(id,fn){stage=id;try{await fn();results.push({id,status:'PASS'});}catch{failures++;results.push({id,status:'FAIL'});throw Error('CASE_FAILED');}}
const stop=async()=>{if(app&&app.exitCode===null&&app.signalCode===null){const exited=once(app,'exit');app.kill('SIGTERM');await Promise.race([exited,delay(5000)]);if(app.exitCode===null&&app.signalCode===null){app.kill('SIGKILL');await Promise.race([exited,delay(5000)]);}assert.ok(app.exitCode!==null||app.signalCode!==null);}app=undefined;};
async function start(){
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port','33100'],{env:{PATH:process.env.PATH,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',SESSION_SECRET:process.env.LAB_SESSION_SECRET,CRM_OPERATOR_EMAILS:'operator@example.invalid',OPS_ADMIN_EMAILS:'operator@example.invalid',SUPABASE_URL:'http://127.0.0.1:33001',SUPABASE_SERVICE_ROLE_KEY:sign(),COMMUNICATION_AUTO_SEND_ENABLED:'false'},stdio:'ignore'});
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
 assert.equal(identity.db,'task32');assert.ok(identity.version>=170000&&identity.version<180000);
 if(process.argv.includes('--bootstrap')){
  assert.equal((await client.query("SELECT to_regclass('public.crm_contacts') AS t")).rows[0].t,null);
  await client.query('CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$');
  for(const file of ['20260619000001_crm_early_access_v1.sql','20260622000001_crm_queue_archive.sql'])await client.query(readFileSync('supabase/migrations/'+file,'utf8'));
  assert.match(process.env.LAB_AUTH_PASSWORD||'',/^[a-f0-9]{64}$/);
  await client.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE ROLE task32_authenticator LOGIN NOINHERIT PASSWORD '"+process.env.LAB_AUTH_PASSWORD+"'; GRANT service_role TO task32_authenticator; GRANT USAGE ON SCHEMA public,auth TO service_role; GRANT EXECUTE ON FUNCTION auth.role() TO service_role; GRANT SELECT,INSERT,UPDATE,DELETE ON public.crm_contacts TO service_role;");
  await client.query(readFileSync('supabase/migrations/20261015000001_public_pilot_lead_receipts.sql','utf8'));
  await client.query('ALTER ROLE service_role BYPASSRLS');
  const bookingMigrations=["001_initial_schema.sql","20260327000003_property_onboarding_columns.sql","20260408000001_multitenant_account_layer_v1.sql","20260602000001_object_knowledge_ssot_v1.sql","20260627000001_booking_ops_v1.sql","20260627211102_booking_ops_property_knowledge_v1.sql","20260628000001_booking_ops_telegram_drafts_v1.sql","20260628000002_booking_ops_intake_readiness_v1.sql","20260628000003_booking_ops_tasks_v1.sql","20260628202122_booking_ops_timeline_v1.sql","20260629000001_booking_ops_turnover_v1.sql","20260629000003_booking_ops_communication_orchestrator_v1.sql","20260629000004_booking_ops_guest_intake_autopilot_v1.sql","20260629000005_booking_ops_inbound_guest_intake_v1.sql","20260629235959_booking_legal_payment_autopilot_v1.sql","20260630000001_booking_lifecycle_gates_v1.sql","20260630000002_booking_checkin_execution_v1.sql","20260630000003_booking_instay_checkout_v1.sql","20260630190555_booking_ops_communication_auto_send_guardrails_v1.sql","20260701110000_owner_object_setup_autopilot_v1.sql","20260701111403_channel_manager_access_import_v1.sql","20260701150000_booking_inbound_intake_events_v1.sql","20260702110134_availability_overbooking_protection_v1.sql","20260702180000_guest_legal_deposit_mvd_execution_pack_v1.sql","20260702200000_booking_physical_readiness_execution_pack_v1.sql","20260703051519_guest_telegram_intake_checkin_release_pack_v1.sql","20260703090000_booking_lifecycle_sla_orchestrator_v1.sql","20260711230000_ops_v16_event_driven_lifecycle.sql","20260712090000_ops_v17_zero_touch_onboarding.sql","20260712160000_ops_v17_3_lifecycle_state_convergence.sql","20260712170000_ops_v17_1_canonical_reservation_ledger.sql","20260810280000_booking_ops_communication_purpose_constraint_repair.sql","20261003141500_booking_inbound_intake_account_scope_v1.sql","20261003150000_booking_availability_account_scope_v1.sql"];

  bookingMigrations.push('20260701043157_booking_ops_controlled_actual_auto_send_v1.sql','20261015103000_booking_knowledge_read_contract.sql','20260701045402_booking_ops_auto_send_operational_activation_v1.sql','20260701170000_channel_publishing_preparation_v1.sql','20260701180000_pricing_intelligence_tariff_grid_v1.sql','20260702170000_pilot_autorun_end_to_end_v1.sql','20260711115140_ops_v15_alert_sla_orchestrator.sql','20260917000001_guestautopilot_billing_lifecycle_v1.sql','20261003124500_booking_ops_auto_send_account_scope_v1.sql','20260713044418_operator_alert_v1_foundation.sql'); bookingMigrations.sort();
  for(const file of bookingMigrations){stage='migration:'+file;await client.query(readFileSync('supabase/migrations/'+file,'utf8'));}
  await client.query("GRANT SELECT ON public.properties,public.accounts,public.object_knowledge_entries,public.tg_property_knowledge TO service_role; INSERT INTO public.accounts(id,name) VALUES('29300000-0000-4000-8000-000000000002','Synthetic Task2930 owner'); INSERT INTO public.properties(id,account_id,name) VALUES('29300000-0000-4000-8000-000000000003','29300000-0000-4000-8000-000000000002','Synthetic Task2930 object')");
    await client.query("GRANT SELECT ON account_members,users,subscriptions TO service_role; GRANT SELECT,INSERT,UPDATE,DELETE ON booking_inbound_intake_events TO service_role; INSERT INTO users(id,email,password_hash) VALUES('32000000-0000-4000-8000-000000000001','operator@example.invalid','NOT_A_LOGIN_PASSWORD'); INSERT INTO account_members(account_id,user_id,role) VALUES('29300000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','owner')");
 }else{
  const token=sign();
  const rest='http://'+network+'-rest:33000';
  let ready=false;
  for(let i=0;i<30;i++){try{const r=await fetch(rest+'/crm_contacts?select=id',{headers:{Authorization:'Bearer '+token}});if(r.ok){ready=true;break;}}catch{}await delay(500);}assert.equal(ready,true);
  proxy=http.createServer((req,res)=>{
   if(!req.url?.startsWith('/rest/v1/')){res.writeHead(404);res.end();return;}
   const path=req.url.slice('/rest/v1'.length);
   const upstream=http.request(rest+path,{method:req.method,headers:{...req.headers,host:network+'-rest:33000'}},up=>{
    if((up.statusCode||500)>=400){
      const entry={resource:path.split('?')[0],status:up.statusCode};restErrors.push(entry);
      let diagnostic='';up.on('data',chunk=>{if(diagnostic.length<4096)diagnostic+=chunk.toString('utf8').slice(0,4096-diagnostic.length);});
      up.on('end',()=>{try{const body=JSON.parse(diagnostic);if(/^[A-Z0-9]{5,12}$/.test(body.code||''))entry.code=body.code;entry.identifiers=[...String(body.message||'').matchAll(/['"]([a-z_][a-z0-9_]*)['"]/g)].map(m=>m[1]).slice(0,5);}catch{}});
    }
    res.writeHead(up.statusCode||502,up.headers);up.pipe(res);
   });
   upstream.setTimeout(8000,()=>upstream.destroy());
   upstream.on('error',()=>{res.writeHead(503);res.end();});req.pipe(upstream);
  });proxy.listen(33001,'127.0.0.1');await once(proxy,'listening');
  await start();

  const operator=await sealData({userId:'32000000-0000-4000-8000-000000000001',email:'operator@example.invalid'},{password:process.env.LAB_SESSION_SECRET,ttl:900});
  const outsider=await sealData({userId:randomUUID(),email:'outside@example.invalid'},{password:process.env.LAB_SESSION_SECRET,ttl:900});
  const intake=(body,cookie=operator)=>fetch('http://127.0.0.1:33100/api/dashboard/booking-ops/intake/process',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:'asi_session='+cookie}:{})},body:JSON.stringify(body)});
  const request={source:'admin',action:'process',guestName:'Synthetic Task32',guestEmail:'task32@example.invalid',guestCount:1,propertyId:'29300000-0000-4000-8000-000000000003',propertyLabel:'Synthetic object',checkInAt:'2026-10-16T14:00:00Z',checkOutAt:'2026-10-18T11:00:00Z',bookingReference:'task32-main'};
  await check('N01-missing-session',async()=>assert.equal((await intake(request,null)).status,401));
  await check('N02-outsider',async()=>assert.equal((await intake(request,outsider)).status,403));
  await check('N03-null-object',async()=>assert.equal((await intake(null)).status,400));
  await check('N04-invalid-action',async()=>assert.equal((await intake({...request,action:'send_real_messages'})).status,400));
  await check('N05-foreign-property',async()=>assert.equal((await intake({...request,propertyId:'32000000-0000-4000-8000-000000000099'})).status,403));
  await check('N06-real-reservation-intake',async()=>{const response=await intake(request);assert.equal(response.status,200);const body=await response.json();assert.equal(body.ok,true);assert.notEqual(body.result.intakeStatus,'failed');assert.ok(body.result.bookingId);originalId=body.result.bookingId;const rows=await client.query('SELECT id,account_id,property_id FROM booking_ops_records WHERE id=$1',[originalId]);assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].account_id,request.propertyId.replace(/3$/,'2'));writeFileSync('finishline-results/reservation.json',JSON.stringify({id:originalId,intakeId:body.result.intakeId,layer:'native-api',source}));});
  const readBooking=()=>fetch('http://127.0.0.1:33100/api/dashboard/booking-ops/'+originalId+'/events',{headers:{Cookie:'asi_session='+operator}});
  await check('N07-session-authorized-readback',async()=>assert.equal((await readBooking()).status,200));
  await check('N08-revoked-membership-denied',async()=>{await client.query("DELETE FROM account_members WHERE user_id='32000000-0000-4000-8000-000000000001'");assert.equal((await readBooking()).status,403);await client.query("INSERT INTO account_members(account_id,user_id,role) VALUES('29300000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','owner')");});
  await stop();await start();
  await check('N09-restart-operator-recovery',async()=>assert.equal((await readBooking()).status,200));
  await check('N10-replay-same-reservation',async()=>{const response=await intake(request);assert.equal(response.status,200);assert.equal((await response.json()).result.bookingId,originalId);});
  await check('N11-anonymous-intake-table-denied',async()=>assert.ok([401,403].includes((await fetch(rest+'/booking_inbound_intake_events')).status)));
  await check('N12-public-authoritative-field-denied',async()=>{const response=await fetch('http://127.0.0.1:33100/api/booking-ops/intake/web',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});assert.equal(response.status,400);});
  await check('N13-oversized-intake-rejected',async()=>assert.equal((await intake({...request,rawMessageText:'x'.repeat(17000)})).status,400));
  await check('N14-concurrent-replay-same-reservation',async()=>{const responses=await Promise.all(Array.from({length:3},()=>intake(request)));for(const response of responses){assert.equal(response.status,200);assert.equal((await response.json()).result.bookingId,originalId);}});
  await check('N15-public-null-and-quota',async()=>{const statuses=[];for(let i=0;i<11;i++){statuses.push((await fetch('http://127.0.0.1:33100/api/booking-ops/intake/web',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'})).status);}assert.equal(statuses[0],400);assert.equal(statuses.at(-1),429);});
  try { await check('B01-real-browser-journey',async()=>{
    writeFileSync('finishline-results/browser-ready.json',JSON.stringify({source}));
    let receipt;for(let i=0;i<480;i++){try{receipt=JSON.parse(readFileSync('finishline-results/browser.json','utf8'));break;}catch{}await delay(500);}
    assert.equal(receipt?.source,source);assert.equal(receipt?.status,'PASS');
  }); } catch { /* Keep browser failure recorded while completing independent service evidence. */ }
  await check('T30-durable-service-cycle',async()=>{
    let phaseFailed=false;
    for(const phase of ['cycle','recover','variants']){
      const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','scripts/acceptance/strigunov-finishline-booking.ts',...(phase==='cycle'?[]:['--'+phase])],{env:{PATH:process.env.PATH,CI:'true',STRIGUNOV_SYNTHETIC_ONLY:'YES',LAB_NETWORK:network,REVIEWED_SOURCE_SHA:source,NODE_ENV:'production',SUPABASE_URL:'http://127.0.0.1:33001',SUPABASE_SERVICE_ROLE_KEY:sign(),TASK32_OPERATOR_COOKIE:operator,COMMUNICATION_AUTO_SEND_ENABLED:'false'},stdio:'ignore'});
      const timer=setTimeout(()=>child.kill('SIGKILL'),300000);
      try{const [code]=await once(child,'exit');assert.equal(code,0);const receipt=JSON.parse(readFileSync('finishline-results/booking-'+phase+'.json','utf8'));assert.equal(receipt.source,source);assert.equal(receipt.status,'PASS');}catch{phaseFailed=true;}finally{clearTimeout(timer);}
    }
    assert.equal(phaseFailed,false);
    const count=await client.query("SELECT count(*) FROM public.booking_ops_lifecycle_decisions WHERE booking_id=$1",[originalId]);assert.ok(Number(count.rows[0].count)>=20);
  });

  await check('AUX-no-unexpected-rest-errors',async()=>{
    const duplicateConstraints={'/booking_ops_events':'idx_booking_ops_events_dedupe','/booking_ops_domain_events':'booking_ops_domain_events_pkey'};
    const expected=restErrors.filter(e=>e.status===409&&e.code==='23505'&&e.identifiers?.includes(duplicateConstraints[e.resource]));
    writeFileSync('finishline-results/rest-errors.json',JSON.stringify({source,total:restErrors.length,expectedDuplicateConflicts:expected.length,unexpected:restErrors.filter(e=>!expected.includes(e))},null,2));
    assert.equal(restErrors.length,expected.length);
  });

 }
}catch{if(!results.some(r=>r.id===stage&&r.status==='FAIL')){failures++;results.push({id:stage,status:'FAIL'});}process.exitCode=1;}
finally{
 await stop();if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
 if(!process.argv.includes('--bootstrap')){
  try{cleanupStage='lifecycle';for(const table of ['booking_lifecycle_gates','booking_lifecycle_exceptions']){cleanupStage=table;await client.query("DELETE FROM "+table+" WHERE booking_id IN (SELECT id::text FROM booking_ops_records WHERE account_id='29300000-0000-4000-8000-000000000002' AND property_id='29300000-0000-4000-8000-000000000003')");assert.equal(Number((await client.query("SELECT count(*) FROM "+table)).rows[0].count),0);}cleanupStage='intake-events';await client.query("DELETE FROM booking_inbound_intake_events WHERE account_id='29300000-0000-4000-8000-000000000002'");for(const [table,column] of [['booking_ops_telegram_drafts','booking_ops_record_id'],['booking_ops_checkin_release_drafts','booking_id']]){cleanupStage=table;await client.query("DELETE FROM "+table+" WHERE "+column+" IN (SELECT id FROM booking_ops_records WHERE account_id='29300000-0000-4000-8000-000000000002' AND property_id='29300000-0000-4000-8000-000000000003')");assert.equal(Number((await client.query("SELECT count(*) FROM "+table)).rows[0].count),0);}
  for(const table of ['booking_overbooking_conflict_checks','booking_availability_holds']){cleanupStage=table;writeFileSync('finishline-results/cleanup-'+table+'.json',JSON.stringify((await client.query('SELECT account_id,property_id,count(*)::int AS count FROM '+table+' GROUP BY account_id,property_id')).rows));await client.query("DELETE FROM "+table+" WHERE (account_id='29300000-0000-4000-8000-000000000002' OR account_id IS NULL) AND property_id='29300000-0000-4000-8000-000000000003'");assert.equal(Number((await client.query("SELECT count(*) FROM "+table)).rows[0].count),0);}
  cleanupStage='booking-records';await client.query("DELETE FROM public.booking_ops_records WHERE account_id='29300000-0000-4000-8000-000000000002' AND property_id='29300000-0000-4000-8000-000000000003'");assert.equal(Number((await client.query('SELECT count(*) FROM public.booking_ops_records')).rows[0].count),0);cleanupStage='account';await client.query("DELETE FROM public.accounts WHERE id='29300000-0000-4000-8000-000000000002'");assert.equal(Number((await client.query('SELECT count(*) FROM public.properties')).rows[0].count),0);cleanupStage='user';await client.query("DELETE FROM users WHERE id='32000000-0000-4000-8000-000000000001'");cleanupStage='crm';await client.query("DELETE FROM public.crm_contacts WHERE email IN ('owner@example.invalid','outage@example.invalid','atomic@example.invalid','rollback@example.invalid')");rowsAfterCleanup=Number((await client.query('SELECT count(*) FROM public.crm_contacts')).rows[0].count);assert.equal(rowsAfterCleanup,0);assert.equal(Number((await client.query('SELECT count(*) FROM public.public_pilot_lead_receipts')).rows[0].count),0);}catch(error){cleanupFailure={stage:cleanupStage,code:/^[A-Z0-9_]{5,40}$/.test(error?.code||'')?error.code:'UNKNOWN',constraint:/^[a-z_][a-z0-9_]*$/.test(error?.constraint||'')?error.constraint:null};failures++;process.exitCode=1;}
  writeFileSync('finishline-results/native.json',JSON.stringify({source,run:network,completed:true,status:failures?'FAIL':results.some(r=>r.status==='BLOCK')?'PARTIAL':'PASS',unexpectedFailures:failures,results,rowsAfterCleanup,cleanupStage,cleanupFailure,optionalQueueBoundaries:restErrors,limits:['sealed test cookies exercise real decoding/allowlist, not login issuance or durable revoke','optional queue helpers may suppress absent Booking Ops schemas','no production/live owner authority','Task30 component tests are separate evidence'],noExternalSend:true},null,2));
 }
 if(process.argv.includes('--bootstrap'))writeFileSync('finishline-results/bootstrap.json',JSON.stringify({source,status:failures?'FAIL':'PASS',stage}));
 await client.end().catch(()=>{process.exitCode=1;});
}
