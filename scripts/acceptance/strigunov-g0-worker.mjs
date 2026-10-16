// Disposable integration acceptance; no connection target supplied by a caller is accepted.
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import pg from 'pg';
import bcrypt from 'bcryptjs';
assert.equal(process.env.CI,'true');assert.equal(process.env.STRIGUNOV_SYNTHETIC_ONLY,'YES');
const network=process.env.LAB_NETWORK;assert.match(network||'',/^strigfin-[0-9]+-1$/);
const source=process.env.REVIEWED_SOURCE_SHA;
const options={host:network+'-pg',user:'postgres',password:process.env.LAB_ADMIN_PASSWORD,database:'task32',connectionTimeoutMillis:3000};
const db=new pg.Client(options), db2=new pg.Client(options), apps=new Map(),results=[];
const A={account:'29300000-0000-4000-8000-000000000002',property:'29300000-0000-4000-8000-000000000003',user:'32000000-0000-4000-8000-000000000001',email:'operator@example.invalid'};
const B={account:'29300000-0000-4000-8000-000000000012',property:'29300000-0000-4000-8000-000000000013',user:'32000000-0000-4000-8000-000000000011',email:'operator-b@example.invalid'};
const O={account:A.account,property:A.property,user:'32000000-0000-4000-8000-000000000021',email:'owner-a@example.invalid'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const token=()=>{const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),s=b({alg:'HS256',typ:'JWT'})+'.'+b({role:'service_role',exp:Math.floor(Date.now()/1000)+1800});return s+'.'+createHmac('sha256',process.env.LAB_JWT_SECRET).update(s).digest('base64url');};
const request=(path,{port=33100,cookie,method='GET',body}={})=>fetch('http://127.0.0.1:'+port+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
const check=async(gate,id,fn)=>{try{await fn();results.push({gate,id,status:'PASS'});}catch(e){results.push({gate,id,status:'FAIL',error:String(e.message).slice(0,350)});}writeFileSync('finishline-results/progress.json',JSON.stringify({source,results},null,2));};
const block=(gate,id,reason)=>results.push({gate,id,status:'BLOCK',reason});
let killAfterResource=null,crashWitness=null,leaseBarrier=null;const workerChildren=new Set();
let proxy,barrier=null,loseAck=false,ackWitness=null,barrierWitness=[],rowsAfterCleanup=null,setup=false,canonical;
const rest='http://'+network+'-rest:33000';
async function stop(port){const p=apps.get(port);if(p&&p.exitCode===null&&p.signalCode===null){const end=once(p,'exit');p.kill('SIGKILL');await end;}apps.delete(port);}
async function start(port){const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',String(port)],{env:{PATH:process.env.PATH,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',SESSION_SECRET:process.env.LAB_SESSION_SECRET,CI:'true',STRIGUNOV_SYNTHETIC_ONLY:'YES',ASI_SYNTHETIC_NO_SEND:'YES',CRM_OPERATOR_EMAILS:A.email,OPS_ADMIN_EMAILS:A.email,SUPABASE_URL:'http://127.0.0.1:33001',SUPABASE_SERVICE_ROLE_KEY:token(),NODE_OPTIONS:'--require=/work/scripts/acceptance/strigunov-g0-network.cjs'},stdio:'ignore'});apps.set(port,app);for(let i=0;i<90;i++){try{if((await request('/api/dashboard/crm/queue',{port})).status===401)return;}catch{}if(app.exitCode!==null)throw Error('NEXT_EXIT_'+port);await delay(500);}throw Error('NEXT_NOT_READY_'+port);}
const intakeBody=(owner,ref)=>({source:'admin',action:'process',guestName:'G0 same guest name',guestEmail:ref+'@example.invalid',guestCount:1,propertyId:owner.property,propertyLabel:'G0 same property name',checkInAt:'2026-11-16T14:00:00Z',checkOutAt:'2026-11-18T11:00:00Z',bookingReference:ref});
const intake=(owner,ref,extra={})=>request('/api/dashboard/booking-ops/intake/process',{cookie:owner.cookie,method:'POST',body:{...intakeBody(owner,ref),...extra.body},port:extra.port||33100});
const denied=async r=>{assert.ok([400,401,403,404,409].includes(r.status),'unexpected authorization status '+r.status);const text=await r.text();assert.ok(!text.includes('g0-owner-b@example.invalid')&&!text.includes('G0_PRIVATE_B'),'private response leaked');};
const json=async r=>{assert.equal(r.status,200);return r.json();};
try{
 await db.connect();await db2.connect();
 const identity=(await db.query("SELECT current_database() db,current_setting('server_version_num')::int version,pg_backend_pid() pid")).rows[0];assert.equal(identity.db,'task32');assert.ok(identity.version>=170000&&identity.version<180000);assert.notEqual(identity.pid,(await db2.query('SELECT pg_backend_pid() pid')).rows[0].pid);setup=true;
 await db.query(readFileSync('supabase/migrations/20261016090000_g0_operator_revision_takeover.sql','utf8'));
 await db.query("NOTIFY pgrst, 'reload schema'");await delay(1500);
 const password=randomBytes(24).toString('hex'),hash=await bcrypt.hash(password,10);
 await db.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,A.user]);
 for(const o of [B,O])await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[o.user,o.email,hash]);
 await db.query("INSERT INTO account_members(account_id,user_id,role) VALUES($1,$2,'owner')",[O.account,O.user]);
 await db.query('INSERT INTO accounts(id,name) VALUES($1,$2)',[B.account,'G0 same owner name']);
 await db.query('INSERT INTO properties(id,account_id,name) VALUES($1,$2,$3)',[B.property,B.account,'G0 same property name']);
 await db.query('UPDATE properties SET name=$1 WHERE id=$2',['G0 same property name',A.property]);
 await db.query('INSERT INTO account_members(account_id,user_id,role) VALUES($1,$2,$3)',[B.account,B.user,'owner']);
 // Capture real PostgREST SQL writer backend identities, not only client sockets.
 await db.query('CREATE TABLE public.g0_writer_receipts(pid integer,booking_id uuid); CREATE FUNCTION public.g0_write_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.g0_writer_receipts VALUES(pg_backend_pid(),NEW.id); RETURN NEW; END $$; GRANT INSERT ON public.g0_writer_receipts TO service_role; CREATE TRIGGER g0_writer AFTER INSERT ON public.booking_ops_records FOR EACH ROW EXECUTE FUNCTION public.g0_write_receipt()');
 proxy=http.createServer((req,res)=>{
  if(!req.url?.startsWith('/rest/v1/')){res.writeHead(404);res.end();return;}
  const path=req.url.slice('/rest/v1'.length);
  const forward=()=>{const upstream=http.request(rest+path,{method:req.method,headers:{...req.headers,host:network+'-rest:33000'}},up=>{
   if(leaseBarrier&&req.method==='POST'&&path==='/rpc/g0_begin_automation'&&(up.statusCode||500)<300){let body='';up.on('data',c=>body+=c);up.on('end',()=>{leaseBarrier.releases.push(()=>{res.writeHead(up.statusCode,up.headers);res.end(body);});});return;}
   if(killAfterResource&&req.method==='POST'&&path.split('?')[0]===killAfterResource&&(up.statusCode||500)<300){const resource=killAfterResource;killAfterResource=null;up.resume();up.on('end',async()=>{crashWitness={resource,status:up.statusCode};await stop(33100);res.destroy();});return;}
   if(loseAck&&req.method==='POST'&&path.startsWith('/booking_inbound_intake_events')&&path.includes('on_conflict=')&&(up.statusCode||500)<300){loseAck=false;ackWitness={status:up.statusCode,resource:path.split('?')[0]};up.resume();up.on('end',()=>res.destroy());return;}
   if(barrier&&req.method==='GET'&&path.startsWith('/booking_inbound_intake_events')&&barrier.responses.length<2){const chunks=[];up.on('data',c=>chunks.push(c));up.on('end',()=>{barrierWitness.push({status:up.statusCode,body:Buffer.concat(chunks).toString('utf8')});barrier.responses.push(()=>{res.writeHead(up.statusCode||502,up.headers);res.end(Buffer.concat(chunks));});if(barrier.responses.length===2){const b=barrier;barrier=null;clearTimeout(b.timer);b.responses.forEach(f=>f());}});return;}
   res.writeHead(up.statusCode||502,up.headers);up.pipe(res);
  });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end();});req.pipe(upstream);};forward();
 });proxy.listen(33001,'127.0.0.1');await once(proxy,'listening');
 for(let i=0;i<30;i++){try{if((await fetch(rest+'/users?select=id',{headers:{Authorization:'Bearer '+token()}})).ok)break;}catch{}await delay(500);}
 await Promise.all([start(33100),start(33101)]);
 await check('G0-1','three-real-password-logins-separate-owner-staff',async()=>{for(const o of [A,B,O]){const r=await request('/api/auth/login',{method:'POST',body:{email:o.email,password}});assert.equal(r.status,200);o.cookie=r.headers.get('set-cookie')?.split(';')[0];assert.match(o.cookie||'',/^asi_session=/);}assert.notEqual(A.cookie,B.cookie);});
 if(!A.cookie||!B.cookie)throw Error('LOGIN_PREREQUISITE_FAILED');
 await check('G0-1','explicit-staff-intake-owner-denied',async()=>{const b=await json(await intake(A,'g0-staff-a'));A.booking=b.result.bookingId;assert.ok(A.booking);for(const owner of [B,O])assert.equal((await intake(owner,'g0-denied')).status,403);});
 await check('G0-1','owners-denied-global-crm-all-entrypoints',async()=>{
  const id=(await db.query("INSERT INTO crm_contacts(name,email,source,notes) VALUES('G0 foreign private contact','g0-foreign-private@example.invalid','manual','G0_PRIVATE_B') RETURNING id")).rows[0].id;
  const paths=[['/api/dashboard/crm','GET'],['/api/dashboard/crm','POST'],['/api/dashboard/crm/queue','GET'],['/api/dashboard/crm/'+id,'DELETE'],['/api/dashboard/crm/'+id,'PATCH'],['/api/dashboard/crm/queue/archive','POST'],['/api/dashboard/crm/queue/archive-test-guests','POST'],['/api/dashboard/crm/pilot-summary','GET']];
  for(const owner of [B,O])for(const [path,method] of paths)assert.equal((await request(path,{cookie:owner.cookie,method,...(method==='GET'?{}:{body:{contactId:id,ids:[id],name:'forbidden'}})})).status,403,path);
  const staff=await request('/api/dashboard/crm/queue?includeTest=1',{cookie:A.cookie});assert.equal(staff.status,200);assert.ok((await staff.text()).includes('G0 foreign private contact'));
  assert.equal((await db.query('SELECT name FROM crm_contacts WHERE id=$1',[id])).rows[0].name,'G0 foreign private contact');
 });
 await check('G0-1','owner-portal-operational-routes-remain-staff-only',async()=>{for(const owner of [B,O])for(const path of ['/api/dashboard/booking-ops','/api/dashboard/booking-ops/'+A.booking,'/api/dashboard/booking-ops/'+A.booking+'/events','/api/dashboard/property-knowledge?property_id='+A.property])assert.equal((await request(path,{cookie:owner.cookie})).status,403,path);});
 await check('G0-1','revoked-membership-stale-staff-session',async()=>{await db.query('DELETE FROM account_members WHERE user_id=$1',[A.user]);try{await denied(await request('/api/dashboard/booking-ops/'+A.booking+'/events',{cookie:A.cookie}));}finally{await db.query("INSERT INTO account_members(account_id,user_id,role) VALUES($1,$2,'owner')",[A.account,A.user]);}});
 await check('G0-2','simultaneous-first-submissions-two-api-processes',async()=>{
  const before=Number((await db.query('SELECT count(*) FROM booking_ops_records WHERE account_id=$1',[A.account])).rows[0].count);
  barrier={responses:[],timer:setTimeout(()=>{const b=barrier;barrier=null;b?.responses.forEach(f=>f());},10000)};
  const responses=await Promise.all([intake(A,'g0-first-race'),intake(A,'g0-first-race',{port:33101})]);
  const bodies=await Promise.all(responses.map(async r=>({status:r.status,body:await r.json()})));
  const after=Number((await db.query('SELECT count(*) FROM booking_ops_records WHERE account_id=$1',[A.account])).rows[0].count);
  const ids=bodies.map(r=>r.body.result?.bookingId).filter(Boolean);canonical=ids[0];
  writeFileSync('finishline-results/first-race.json',JSON.stringify({source,before,after,responses:bodies.map(x=>({status:x.status,bookingId:x.body.result?.bookingId,intakeStatus:x.body.result?.intakeStatus})),writerBackends:(await db.query('SELECT * FROM g0_writer_receipts')).rows},null,2));
  assert.equal(barrierWitness.length,2,'barrier did not witness two first reads');assert.ok(barrierWitness.every(w=>w.status===200&&['[]','null',''].includes(w.body)),'first reads were not absent');assert.equal(after-before,1,'first intake created more than one canonical reservation');assert.equal(new Set(ids).size,1);assert.ok(bodies.every(r=>r.status===200||[409,503].includes(r.status)));
 });
 await check('G0-2','conflicting-payload-rejected',async()=>{const r=await intake(A,'g0-first-race',{body:{checkOutAt:'2026-11-25T11:00:00Z'}});assert.ok([409,422,503].includes(r.status),'conflicting reference payload returned '+r.status);});
 await check('G0-2','lost-postcommit-ack-restart-retry',async()=>{loseAck=true;try{await intake(A,'g0-lost-ack');}catch{}loseAck=false;await stop(33100);await start(33100);const r=await intake(A,'g0-lost-ack');assert.ok(ackWitness,'no successful postcommit response was lost');assert.ok([200,409,503].includes(r.status));const rows=(await db.query("SELECT id FROM booking_ops_records WHERE account_id=$1 AND booking_id='g0-lost-ack'",[A.account])).rows;assert.equal(rows.length,1);if(r.status===200)assert.equal((await r.json()).result.bookingId,rows[0].id);});
 await check('G0-2','force-and-operator-action-cannot-steal-claim',async()=>{for(const body of [{force:true},{action:'attach_guest',attachGuestEmail:'replacement@example.invalid'}]){const r=await intake(A,'g0-lost-ack',{body});assert.equal(r.status,503);}const rows=(await db.query("SELECT id FROM booking_ops_records WHERE account_id=$1 AND booking_id='g0-lost-ack'",[A.account])).rows;assert.equal(rows.length,1);});
 for(const [suffix,resource] of [['booking','/booking_ops_records'],['intent','/booking_ops_communication_intents']])await check('G0-2','crash-after-committed-'+suffix+'-durable-hold',async()=>{
  const ref='g0-crash-'+suffix;crashWitness=null;killAfterResource=resource;
  try{await intake(A,ref);}catch{}killAfterResource=null;assert.ok(crashWitness,'requested committed crash window not reached');
  const receipt=(await db.query("SELECT e.* FROM booking_inbound_intake_events e JOIN booking_ops_records b ON b.id::text=e.automation_result->>'reservedBookingId' WHERE e.account_id=$1 AND b.booking_id=$2",[A.account,ref])).rows[0];
  const reserved=receipt.automation_result.reservedBookingId;assert.ok(reserved);
  const booking=(await db.query('SELECT id,account_id,property_id FROM booking_ops_records WHERE id=$1',[reserved])).rows[0];assert.equal(booking.account_id,A.account);assert.equal(booking.property_id,A.property);
  const snapshot=async()=>{const result={};for(const [table,key] of [['booking_ops_records','id'],['booking_ops_events','booking_ops_record_id'],['booking_ops_domain_events','booking_id'],['booking_ops_communication_intents','booking_ops_record_id']])result[table]=(await db.query('SELECT count(*)::int n FROM '+table+' WHERE '+key+'=$1',[reserved])).rows[0].n;return result;};
  if(suffix==='intent'){const leases=(await db.query('SELECT token FROM booking_ops_automation_executions WHERE booking_id=$1',[reserved])).rows;assert.ok(leases.length>0,'crashed worker lost durable execution hold');}
  const before=await snapshot();await start(33100);const status=await json(await request('/api/dashboard/booking-ops/intake/status?intakeId='+receipt.id,{cookie:A.cookie}));assert.equal(status.result.bookingId,reserved);assert.deepEqual(status.result.nextRequiredActions,['manual_reconciliation']);for(const port of [33100,33101])assert.equal((await intake(A,ref,{port})).status,503);assert.deepEqual(await snapshot(),before);
  const after=(await db.query('SELECT * FROM booking_inbound_intake_events WHERE id=$1',[receipt.id])).rows[0];assert.equal(after.automation_result.executionState,'running');assert.equal(after.automation_result.reservedBookingId,reserved);
  writeFileSync('finishline-results/crash-'+suffix+'.json',JSON.stringify({source,crashWitness,receiptId:receipt.id,reservedBookingId:reserved,confirmedLink:after.booking_id,before,after:await snapshot(),recovery:'manual HOLD; no side effects replayed'},null,2));
 });
 await check('G0-3','emergency-stop-api-persists-restart',async()=>{const r=await json(await request('/api/dashboard/booking-ops/communications/auto-send/emergency-stop',{cookie:A.cookie,method:'POST',body:{enabled:true,reason:'G0 synthetic stop'}}));assert.equal(r.emergencyStop,true);await stop(33100);await start(33100);const rows=(await db.query("SELECT emergency_stop,actual_send_enabled FROM booking_ops_communication_auto_send_scopes WHERE scope_type='global'")).rows;assert.equal(rows.length,1);assert.equal(rows[0].emergency_stop,true);assert.equal(rows[0].actual_send_enabled,false);});
 await check('G0-4','dry-run-operator-after-stop',async()=>{assert.equal(Number((await db.query('SELECT count(*) FROM booking_ops_automation_executions WHERE booking_id=$1',[A.booking])).rows[0].count),0,'fixture must be quiescent before dry-run');const r=await request('/api/dashboard/booking-ops/communications/auto-send/dry-run',{cookie:A.cookie,method:'POST',body:{maxBatchSize:1}});assert.equal(r.status,200);const body=await r.json();assert.equal(body.failed,0);assert.ok(body.blocked>=1);assert.equal(Number((await db.query('SELECT count(*) FROM booking_ops_automation_executions WHERE booking_id=$1',[A.booking])).rows[0].count),0,'positively blocked dry-run must release execution lease');});
 if(A.booking){writeFileSync('finishline-results/reservation.json',JSON.stringify({id:A.booking,source}));await check('G0-3','delta-service-role-instrumentation-and-alert-fixture',async()=>{
  const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','scripts/acceptance/strigunov-g0-service.ts'],{env:{PATH:process.env.PATH,CI:'true',STRIGUNOV_SYNTHETIC_ONLY:'YES',ASI_SYNTHETIC_NO_SEND:'YES',LAB_NETWORK:network,REVIEWED_SOURCE_SHA:source,NODE_ENV:'production',SUPABASE_URL:'http://127.0.0.1:33001',SUPABASE_SERVICE_ROLE_KEY:token(),NODE_OPTIONS:'--require=/work/scripts/acceptance/strigunov-g0-network.cjs'},stdio:'ignore'});const timer=setTimeout(()=>child.kill('SIGKILL'),120000);try{const [code]=await once(child,'exit');const receipt=JSON.parse(readFileSync('finishline-results/service.json','utf8'));results.push(...receipt.results);assert.equal(code,0);}finally{clearTimeout(timer);}
 });}
 await check('G0-3','crashed-worker-keeps-takeover-on-hold-after-restart',async()=>{
  const b=(await db.query("SELECT id FROM booking_ops_records WHERE account_id=$1 AND booking_id='g0-crash-intent'",[A.account])).rows[0].id;const id=randomUUID();
  await db.query("INSERT INTO booking_ops_alerts(id,account_id,booking_id,property_id,alert_code,source_gate,severity,status,title,description,dedupe_key,incident_family,source_domain,recommended_action) VALUES($1,$2,$3,$4,'g0_uncertain','provider_uncertain','critical','open','G0 uncertain','Worker crashed','g0-uncertain','g0_uncertain','g0','Manual reconciliation')",[id,A.account,b,A.property]);
  await stop(33100);await start(33100);
  await assert.rejects(db2.query('SELECT g0_acknowledge_operator_alert($1,$2,$3,1)',[A.account,id,A.user]),/booking_automation_inflight_hold/);
  assert.ok(Number((await db.query('SELECT count(*) FROM booking_ops_automation_executions WHERE booking_id=$1',[b])).rows[0].count)>0);
 });
 await check('G0-3','two-real-workers-quiescence-before-ack',async()=>{
  const id=JSON.parse(readFileSync('finishline-results/alerts.json','utf8')).ids[1];
  const alert=(await json(await request('/api/dashboard/booking-ops/alerts/'+id,{cookie:A.cookie}))).alert;
  const ack=()=>request('/api/dashboard/booking-ops/alerts/'+id,{cookie:A.cookie,method:'PATCH',body:{action:'acknowledge',expectedRevision:alert.revision,idempotencyKey:'quiescence'}});
  leaseBarrier={releases:[]};const children=[];
  for(const n of ['one','two']){const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','scripts/acceptance/strigunov-g0-service.ts','--inflight',n],{env:{PATH:process.env.PATH,CI:'true',STRIGUNOV_SYNTHETIC_ONLY:'YES',ASI_SYNTHETIC_NO_SEND:'YES',LAB_NETWORK:network,REVIEWED_SOURCE_SHA:source,NODE_ENV:'production',SUPABASE_URL:'http://127.0.0.1:33001',SUPABASE_SERVICE_ROLE_KEY:token(),NODE_OPTIONS:'--require=/work/scripts/acceptance/strigunov-g0-network.cjs'},stdio:'ignore'});workerChildren.add(child);children.push({child,end:once(child,'exit')});}
  try{
   for(let i=0;i<500&&leaseBarrier.releases.length<2;i++)await delay(20);
   assert.equal(leaseBarrier.releases.length,2,'actual workers did not reach committed admission barrier');
   const releases=leaseBarrier.releases;leaseBarrier=null;
   assert.equal(Number((await db2.query('SELECT count(*) FROM booking_ops_automation_executions WHERE booking_id=$1',[A.booking])).rows[0].count),2);
   assert.equal((await ack()).status,409);
   assert.equal((await db2.query('SELECT g0_end_automation($1,$2) ok',[A.booking,randomUUID()])).rows[0].ok,false);
   releases[0]();for(let i=0;i<500;i++){if(Number((await db2.query('SELECT count(*) FROM booking_ops_automation_executions WHERE booking_id=$1',[A.booking])).rows[0].count)===1)break;await delay(20);}
   assert.equal(Number((await db2.query('SELECT count(*) FROM booking_ops_automation_executions WHERE booking_id=$1',[A.booking])).rows[0].count),1,'exactly one worker must remain');
   assert.equal((await ack()).status,409,'remaining worker must prevent takeover');
   releases[1]();for(const c of children)assert.equal((await c.end)[0],0);
   assert.equal(Number((await db2.query('SELECT count(*) FROM booking_ops_automation_executions WHERE booking_id=$1',[A.booking])).rows[0].count),0);
   const r=await ack();assert.equal(r.status,200,await r.text());
   await assert.rejects(db2.query('SELECT g0_begin_automation($1,$2)',[A.booking,randomUUID()]),/booking_automation_manually_paused/);
   writeFileSync('finishline-results/quiescence.json',JSON.stringify({source,actualWorkers:2,busyWithTwo:true,busyWithOne:true,acceptedAfterZero:true,wrongTokenDenied:true,postAckAdmissionDenied:true}));
  }finally{leaseBarrier=null;for(const c of children)if(c.child.exitCode===null&&c.child.signalCode===null)c.child.kill('SIGKILL');}
 });
 await check('G0-3','stale-alert-revision-cas-and-revoked-operator',async()=>{
  const ids=JSON.parse(readFileSync('finishline-results/alerts.json','utf8')).ids;const id=ids[0];
  const old=(await json(await request('/api/dashboard/booking-ops/alerts/'+id,{cookie:A.cookie}))).alert;
  await db2.query("UPDATE booking_ops_alerts SET description='changed incident' WHERE id=$1",[id]);
  const ack=(revision,key='g0-ack')=>request('/api/dashboard/booking-ops/alerts/'+id,{cookie:A.cookie,method:'PATCH',body:{action:'acknowledge',expectedRevision:revision,idempotencyKey:key}});
  assert.equal((await ack(old.revision)).status,409);let current=(await json(await request('/api/dashboard/booking-ops/alerts/'+id,{cookie:A.cookie}))).alert;
  await db.query('DELETE FROM account_members WHERE user_id=$1',[A.user]);try{await denied(await ack(current.revision));await assert.rejects(db2.query('SELECT g0_acknowledge_operator_alert($1,$2,$3,$4)',[A.account,id,A.user,current.revision]),/operator_membership_revoked/);}finally{await db.query("INSERT INTO account_members(account_id,user_id,role) VALUES($1,$2,'owner')",[A.account,A.user]);}
  const acknowledged=await ack(current.revision);assert.equal(acknowledged.status,200,await acknowledged.text());assert.equal((await ack(current.revision)).status,409);
  await stop(33100);await start(33100);assert.equal((await db.query('SELECT automation_paused FROM booking_ops_records WHERE id=$1',[A.booking])).rows[0].automation_paused,true);
  await db.query("UPDATE booking_ops_alerts SET description='newly escalated incident' WHERE id=$1",[id]);const reopened=(await db.query('SELECT status,revision FROM booking_ops_alerts WHERE id=$1',[id])).rows[0];assert.equal(reopened.status,'open');assert.ok(Number(reopened.revision)>current.revision);
  assert.equal((await ack(current.revision)).status,409);
  assert.equal((await ack(Number(reopened.revision))).status,200);
  assert.equal((await db.query('SELECT status FROM booking_ops_alerts WHERE id=$1',[id])).rows[0].status,'acknowledged');
 });
 await check('G0-3','manual-takeover-restart-blocks-real-worker-entrypoints',async()=>{
  const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','scripts/acceptance/strigunov-g0-service.ts','--paused'],{env:{PATH:process.env.PATH,CI:'true',STRIGUNOV_SYNTHETIC_ONLY:'YES',ASI_SYNTHETIC_NO_SEND:'YES',LAB_NETWORK:network,REVIEWED_SOURCE_SHA:source,NODE_ENV:'production',SUPABASE_URL:'http://127.0.0.1:33001',SUPABASE_SERVICE_ROLE_KEY:token(),NODE_OPTIONS:'--require=/work/scripts/acceptance/strigunov-g0-network.cjs'},stdio:'ignore'});const [code]=await once(child,'exit');const r=JSON.parse(readFileSync('finishline-results/paused.json','utf8'));results.push(...r.results);assert.equal(code,0);
 });
 await check('G0-4','no-sent-or-sending-intents',async()=>{assert.equal(Number((await db.query("SELECT count(*) FROM booking_ops_communication_intents WHERE status IN ('sent','sending')")).rows[0].count),0);});
 await check('G0-4','external-send-payment-network-counter-zero',async()=>{const attempts=existsSync('finishline-results/outbound-attempts.ndjson')?readFileSync('finishline-results/outbound-attempts.ndjson','utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];const external=attempts.filter(a=>a.target!=='unix-socket');assert.equal(external.length,0);writeFileSync('finishline-results/network-counts.json',JSON.stringify({source,deniedExternalAttempts:external.length,deniedLocalIpcAttempts:attempts.length-external.length,allowedExternalConnections:0,providerFunctionCalls:existsSync('finishline-results/effect-attempts.ndjson')?readFileSync('finishline-results/effect-attempts.ndjson','utf8').trim().split('\n').filter(Boolean).length:0}));});
 await check('G0-4','direct-sender-payment-entry-counters-zero',async()=>{const attempts=existsSync('finishline-results/effect-attempts.ndjson')?readFileSync('finishline-results/effect-attempts.ndjson','utf8').trim():'';assert.equal(attempts,'');const canary=JSON.parse(readFileSync('finishline-results/canary.json','utf8'));assert.equal(canary.verifiedBoundaries,7);});
}catch(e){results.push({gate:'SETUP',id:'setup',status:'FAIL',error:String(e.message).slice(0,300)});}
finally{
 for(const child of workerChildren)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
 await Promise.all([...apps.keys()].map(stop));if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
 if(setup)try{const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r=>r.tablename);assert.ok(tables.every(t=>/^[a-z0-9_]+$/.test(t)));await db.query('TRUNCATE '+tables.map(t=>'public."'+t+'"').join(',')+' RESTART IDENTITY CASCADE');rowsAfterCleanup=0;for(const t of tables)rowsAfterCleanup+=Number((await db.query('SELECT count(*) FROM public."'+t+'"')).rows[0].count);assert.equal(rowsAfterCleanup,0);}catch(e){results.push({gate:'CLEANUP',id:'zero-fixtures',status:'FAIL',error:String(e.message).slice(0,200)});}
 await Promise.all([db.end(),db2.end()]);const gates=Object.fromEntries(['G0-1','G0-2','G0-3','G0-4'].map(g=>{const rs=results.filter(r=>r.gate===g);return[g,rs.some(r=>r.status==='FAIL')?'FAIL':!rs.length||rs.some(r=>r.status==='BLOCK')?'BLOCK':'PASS'];}));const failures=results.filter(r=>r.status==='FAIL').length;const status=failures?'FAIL':Object.values(gates).every(s=>s==='PASS')?'PASS':'BLOCK';writeFileSync('finishline-results/native.json',JSON.stringify({source,run:network,completed:true,status,unexpectedFailures:failures,gates,results,rowsAfterCleanup,limits:['Owner portal operational routes remain staff-only; two owner identities have no global CRM privileges','service-role bypass RLS; separate database permission denial is not tenant RLS proof','no actual owner/provider/host acceptance','atomic live-send quota not integrated: HOLD']},null,2));console.log(JSON.stringify({status,gates,checks:results.length,rowsAfterCleanup}));if(status!=='PASS')process.exitCode=1;
}
