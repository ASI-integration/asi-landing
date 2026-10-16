// Disposable integration acceptance; no connection target supplied by a caller is accepted.
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
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
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const token=()=>{const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),s=b({alg:'HS256',typ:'JWT'})+'.'+b({role:'service_role',exp:Math.floor(Date.now()/1000)+1800});return s+'.'+createHmac('sha256',process.env.LAB_JWT_SECRET).update(s).digest('base64url');};
const request=(path,{port=33100,cookie,method='GET',body}={})=>fetch('http://127.0.0.1:'+port+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
const check=async(gate,id,fn)=>{try{await fn();results.push({gate,id,status:'PASS'});}catch(e){results.push({gate,id,status:'FAIL',error:String(e.message).slice(0,350)});}writeFileSync('finishline-results/progress.json',JSON.stringify({source,results},null,2));};
const block=(gate,id,reason)=>results.push({gate,id,status:'BLOCK',reason});
let proxy,barrier=null,loseAck=false,ackWitness=null,barrierWitness=[],rowsAfterCleanup=null,setup=false,canonical;
const rest='http://'+network+'-rest:33000';
async function stop(port){const p=apps.get(port);if(p&&p.exitCode===null&&p.signalCode===null){const end=once(p,'exit');p.kill('SIGKILL');await end;}apps.delete(port);}
async function start(port){const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',String(port)],{env:{PATH:process.env.PATH,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',SESSION_SECRET:process.env.LAB_SESSION_SECRET,CRM_OPERATOR_EMAILS:A.email+','+B.email,OPS_ADMIN_EMAILS:A.email+','+B.email,SUPABASE_URL:'http://127.0.0.1:33001',SUPABASE_SERVICE_ROLE_KEY:token(),NODE_OPTIONS:'--require=/work/scripts/acceptance/strigunov-g0-network.cjs'},stdio:'ignore'});apps.set(port,app);for(let i=0;i<90;i++){try{if((await request('/api/dashboard/crm/queue',{port})).status===401)return;}catch{}if(app.exitCode!==null)throw Error('NEXT_EXIT_'+port);await delay(500);}throw Error('NEXT_NOT_READY_'+port);}
const intakeBody=(owner,ref)=>({source:'admin',action:'process',guestName:'G0 same guest name',guestEmail:ref+'@example.invalid',guestCount:1,propertyId:owner.property,propertyLabel:'G0 same property name',checkInAt:'2026-11-16T14:00:00Z',checkOutAt:'2026-11-18T11:00:00Z',bookingReference:ref});
const intake=(owner,ref,extra={})=>request('/api/dashboard/booking-ops/intake/process',{cookie:owner.cookie,method:'POST',body:{...intakeBody(owner,ref),...extra.body},port:extra.port||33100});
const denied=async r=>{assert.ok([400,401,403,404,409].includes(r.status),'unexpected authorization status '+r.status);const text=await r.text();assert.ok(!text.includes('g0-owner-b@example.invalid')&&!text.includes('G0_PRIVATE_B'),'private response leaked');};
const json=async r=>{assert.equal(r.status,200);return r.json();};
try{
 await db.connect();await db2.connect();
 const identity=(await db.query("SELECT current_database() db,current_setting('server_version_num')::int version,pg_backend_pid() pid")).rows[0];assert.equal(identity.db,'task32');assert.ok(identity.version>=170000&&identity.version<180000);assert.notEqual(identity.pid,(await db2.query('SELECT pg_backend_pid() pid')).rows[0].pid);setup=true;
 const password=randomBytes(24).toString('hex'),hash=await bcrypt.hash(password,10);
 await db.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,A.user]);
 await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[B.user,B.email,hash]);
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
   if(loseAck&&req.method==='POST'&&path.startsWith('/booking_inbound_intake_events')&&(up.statusCode||500)<300){loseAck=false;ackWitness={status:up.statusCode,resource:path.split('?')[0]};up.resume();up.on('end',()=>res.destroy());return;}
   if(barrier&&req.method==='GET'&&path.startsWith('/booking_inbound_intake_events')&&barrier.responses.length<2){const chunks=[];up.on('data',c=>chunks.push(c));up.on('end',()=>{barrierWitness.push({status:up.statusCode,body:Buffer.concat(chunks).toString('utf8')});barrier.responses.push(()=>{res.writeHead(up.statusCode||502,up.headers);res.end(Buffer.concat(chunks));});if(barrier.responses.length===2){const b=barrier;barrier=null;clearTimeout(b.timer);b.responses.forEach(f=>f());}});return;}
   res.writeHead(up.statusCode||502,up.headers);up.pipe(res);
  });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end();});req.pipe(upstream);};forward();
 });proxy.listen(33001,'127.0.0.1');await once(proxy,'listening');
 for(let i=0;i<30;i++){try{if((await fetch(rest+'/users?select=id',{headers:{Authorization:'Bearer '+token()}})).ok)break;}catch{}await delay(500);}
 await Promise.all([start(33100),start(33101)]);
 await check('G0-1','two-real-password-logins',async()=>{for(const o of [A,B]){const r=await request('/api/auth/login',{method:'POST',body:{email:o.email,password}});assert.equal(r.status,200);o.cookie=r.headers.get('set-cookie')?.split(';')[0];assert.match(o.cookie||'',/^asi_session=/);}assert.notEqual(A.cookie,B.cookie);});
 if(!A.cookie||!B.cookie)throw Error('LOGIN_PREREQUISITE_FAILED');
 await check('G0-1','two-owned-api-reservations',async()=>{for(const [o,ref] of [[A,'g0-owner-a'],[B,'g0-owner-b']]){const b=await json(await intake(o,ref));assert.equal(b.result.intakeStatus,'processed');o.booking=b.result.bookingId;assert.ok(o.booking);}});
 for(const [id,path,method,body] of [
  ['direct-booking','', 'GET'],['events','/events','GET'],['lifecycle-read','/lifecycle','GET'],['foreign-mutation','','PATCH',{guestName:'unauthorized'}],['foreign-lifecycle','/lifecycle','PATCH',{gateKey:'deposit',status:'passed',reason:'forbidden'}]]){
  await check('G0-1',id,async()=>{assert.ok(B.booking);await denied(await request('/api/dashboard/booking-ops/'+B.booking+path,{cookie:A.cookie,method,body}));});
 }
 await check('G0-1','foreign-property-intake',async()=>await denied(await intake(A,'g0-foreign',{body:{propertyId:B.property}})));
 await check('G0-1','booking-list-no-foreign-row',async()=>{const r=await request('/api/dashboard/booking-ops',{cookie:A.cookie});assert.equal(r.status,200);assert.ok(!(await r.text()).includes(B.booking));});
 await check('G0-1','crm-queue-owner-boundary',async()=>{await db.query("INSERT INTO crm_contacts(name,email,source,notes) VALUES('G0 foreign private contact','g0-foreign-private@example.invalid','g0','G0_PRIVATE_B')");const r=await request('/api/dashboard/crm/queue?includeTest=1',{cookie:A.cookie});assert.equal(r.status,200);const t=await r.text();assert.ok(!t.includes('g0-foreign-private@example.invalid')&&!t.includes('G0_PRIVATE_B'),'global staff queue exposes unrelated private CRM contact to owner-scoped operator');});
 await check('G0-1','revoked-membership-stale-session',async()=>{await db.query('DELETE FROM account_members WHERE user_id=$1',[A.user]);try{await denied(await request('/api/dashboard/booking-ops/'+A.booking+'/events',{cookie:A.cookie}));}finally{await db.query("INSERT INTO account_members(account_id,user_id,role) VALUES($1,$2,'owner')",[A.account,A.user]);}});
 await check('G0-1','nonprivileged-db-denied-not-service-role-rls',async()=>{await db2.query('SET ROLE task32_authenticator');try{await assert.rejects(db2.query('SELECT * FROM booking_ops_records'),e=>e.code==='42501');}finally{await db2.query('RESET ROLE');}assert.equal((await db.query("SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'")).rows[0].rolbypassrls,true);});
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
 await check('G0-2','duplicate-callback-replay-lineage',async()=>{assert.ok(canonical);const replies=await Promise.all([intake(A,'g0-first-race'),intake(A,'g0-first-race',{port:33101})]);for(const r of replies){assert.equal(r.status,200);assert.equal((await r.json()).result.bookingId,canonical);}});
 await check('G0-3','emergency-stop-api-persists-restart',async()=>{const r=await json(await request('/api/dashboard/booking-ops/communications/auto-send/emergency-stop',{cookie:A.cookie,method:'POST',body:{enabled:true,reason:'G0 synthetic stop'}}));assert.equal(r.emergencyStop,true);await stop(33100);await start(33100);const rows=(await db.query("SELECT emergency_stop,actual_send_enabled FROM booking_ops_communication_auto_send_scopes WHERE scope_type='global'")).rows;assert.equal(rows.length,1);assert.equal(rows[0].emergency_stop,true);assert.equal(rows[0].actual_send_enabled,false);});
 await check('G0-4','dry-run-operator-after-stop',async()=>{const r=await request('/api/dashboard/booking-ops/communications/auto-send/dry-run',{cookie:A.cookie,method:'POST',body:{maxBatchSize:1}});assert.equal(r.status,200);});
 if(A.booking){writeFileSync('finishline-results/reservation.json',JSON.stringify({id:A.booking,source}));await check('G0-3','integrated-service-prerequisites-and-closeout',async()=>{
  const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','scripts/acceptance/strigunov-g0-service.ts'],{env:{PATH:process.env.PATH,CI:'true',STRIGUNOV_SYNTHETIC_ONLY:'YES',LAB_NETWORK:network,REVIEWED_SOURCE_SHA:source,NODE_ENV:'production',SUPABASE_URL:'http://127.0.0.1:33001',SUPABASE_SERVICE_ROLE_KEY:token(),NODE_OPTIONS:'--require=/work/scripts/acceptance/strigunov-g0-network.cjs'},stdio:'ignore'});const timer=setTimeout(()=>child.kill('SIGKILL'),120000);try{const [code]=await once(child,'exit');const receipt=JSON.parse(readFileSync('finishline-results/service.json','utf8'));results.push(...receipt.results);assert.equal(code,0);}finally{clearTimeout(timer);}
 });}
 await check('G0-4','no-sent-or-sending-intents',async()=>{assert.equal(Number((await db.query("SELECT count(*) FROM booking_ops_communication_intents WHERE status IN ('sent','sending')")).rows[0].count),0);});
 await check('G0-4','external-send-payment-network-counter-zero',async()=>{const attempts=existsSync('finishline-results/outbound-attempts.ndjson')?readFileSync('finishline-results/outbound-attempts.ndjson','utf8').trim().split('\n').filter(Boolean):[];assert.equal(attempts.length,0);});
 block('G0-4','sender-payment-call-instrumentation','Internal network deny and network-attempt counter exercised; direct sender/payment entry counters and current-main scheduler execution not yet integrated.');
 block('G0-1','property-knowledge-and-alert-cross-tenant','Not yet exercised by this integrated runner; prior single-owner evidence is insufficient.');
 block('G0-3','stale-alert-ack-and-provider-uncertainty','Independent baseline review identifies missing revision CAS and durable manual takeover; no PASS inferred from audit-only events.');
}catch(e){results.push({gate:'SETUP',id:'setup',status:'FAIL',error:String(e.message).slice(0,300)});}
finally{
 await Promise.all([...apps.keys()].map(stop));if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
 if(setup)try{const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r=>r.tablename);assert.ok(tables.every(t=>/^[a-z0-9_]+$/.test(t)));await db.query('TRUNCATE '+tables.map(t=>'public."'+t+'"').join(',')+' RESTART IDENTITY CASCADE');rowsAfterCleanup=0;for(const t of tables)rowsAfterCleanup+=Number((await db.query('SELECT count(*) FROM public."'+t+'"')).rows[0].count);assert.equal(rowsAfterCleanup,0);}catch(e){results.push({gate:'CLEANUP',id:'zero-fixtures',status:'FAIL',error:String(e.message).slice(0,200)});}
 await Promise.all([db.end(),db2.end()]);const gates=Object.fromEntries(['G0-1','G0-2','G0-3','G0-4'].map(g=>{const rs=results.filter(r=>r.gate===g);return[g,rs.some(r=>r.status==='FAIL')?'FAIL':!rs.length||rs.some(r=>r.status==='BLOCK')?'BLOCK':'PASS'];}));const failures=results.filter(r=>r.status==='FAIL').length;const status=failures?'FAIL':Object.values(gates).every(s=>s==='PASS')?'PASS':'BLOCK';writeFileSync('finishline-results/native.json',JSON.stringify({source,run:network,completed:true,status,unexpectedFailures:failures,gates,results,rowsAfterCleanup,limits:['CRM operator is staff-global in baseline','service-role bypass RLS; separate database permission denial is not tenant RLS proof','no actual owner/provider/host acceptance','atomic live-send quota not integrated: HOLD']},null,2));console.log(JSON.stringify({status,gates,checks:results.length,rowsAfterCleanup}));if(status!=='PASS')process.exitCode=1;
}
