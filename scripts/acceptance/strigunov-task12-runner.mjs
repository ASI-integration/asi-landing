// Task12 isolated acceptance runner; native access is closed at the imported custody boundary.
import {pathToFileURL} from 'node:url';
import {RUN,DOMAINS,acquireProtectedRun,admissionStatus,verifyPeers,classifyCommit} from './strigunov-task12-contract.mjs';
export const SQL=Object.freeze({
 peer:"SELECT session_user::text AS session_user,current_user::text AS current_user,pg_backend_pid() AS pid,current_database() AS database,inet_server_addr()::text AS host,inet_server_port() AS port,current_setting('transaction_isolation') AS isolation,(SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication FROM pg_roles WHERE rolname=session_user) AS privileged",
 prepare:'SELECT task12_fixture.prepare($1::integer) AS v',
 snapshot:'SELECT task12_fixture.snapshot($1::integer) AS v',
 decide:'SELECT asi_task11_private.decide($1::uuid,$2::uuid,$3::bigint,$4::uuid) AS v',
 blocked:'SELECT pg_blocking_pids($1::integer) AS blockers',
 begin:'BEGIN ISOLATION LEVEL SERIALIZABLE',
});
const mutations={
 booking:{domain:'booking',sql:"UPDATE public.booking_ops_records SET is_blocked=true WHERE id=$1::uuid",key:'booking'},
 cancel:{domain:'booking',sql:"UPDATE public.tg_guest_reservations SET status='cancelled' WHERE id=$1",key:'source'},
 shift:{domain:'booking',sql:"UPDATE public.tg_guest_reservations SET check_in=check_in+interval '1 hour' WHERE id=$1",key:'source'},
 projection_lag:{domain:'booking',sql:"UPDATE public.tg_guest_reservations SET check_out=check_out+interval '1 hour' WHERE id=$1",key:'source'},
 physical:{domain:'physical',sql:"UPDATE public.booking_physical_readiness SET final_ready=false,status='blocked' WHERE booking_id=$1::uuid",key:'booking'},
 maintenance:{domain:'physical',sql:"UPDATE public.booking_maintenance_tickets SET status='open',is_blocking=true WHERE booking_id=$1::uuid",key:'booking'},
 cleaning:{domain:'cleaning',sql:"UPDATE public.booking_cleaning_tasks SET status='blocked' WHERE booking_id=$1::uuid",key:'booking'},
 policy:{domain:'policy',sql:"UPDATE public.tg_property_knowledge SET early_checkin_policy='SYNTHETIC CHANGED' WHERE property_id=$1",key:'property'},
 legal:{domain:'legal',sql:"UPDATE public.booking_guest_documents SET status='rejected' WHERE booking_id=$1::uuid",key:'booking'},
 account_consent:{domain:'legal',sql:"DELETE FROM public.ru_legal_acceptances WHERE account_id=$1::uuid AND document_type='personal_data_consent'",key:'account'},
 checkout:{domain:'checkout',sql:"UPDATE public.booking_instay_checkout SET inspection_status='failed' WHERE booking_id=$1::uuid",key:'predecessor'},
 late_departure:{domain:'checkout',sql:"UPDATE public.booking_instay_checkout SET actual_checkout_at=clock_timestamp()+interval '2 days' WHERE booking_id=$1::uuid",key:'predecessor'},
 missing_predecessor:{domain:'checkout',sql:"DELETE FROM public.booking_instay_checkout WHERE booking_id=$1::uuid",key:'predecessor'},
 session:{domain:null,sql:"SELECT asi_task11_private.revoke_session($1::uuid,$2::uuid)",key:'session'},
 member:{domain:null,sql:"UPDATE public.account_members SET role='operator' WHERE account_id=$1::uuid",key:'account'},
};
export const MUTATIONS=Object.freeze(Object.fromEntries(Object.entries(mutations).map(([k,v])=>[k,Object.freeze(v)])));
export const MATRIX=Object.freeze([
 ...DOMAINS.flatMap(domain=>['before','after','rollback','while'].map(phase=>Object.freeze({id:domain+'_'+phase,kind:'fence',mutation:domain,phase}))),
 ...['cancel','shift','projection_lag','maintenance','account_consent','late_departure','missing_predecessor','session','member'].map(mutation=>Object.freeze({id:mutation,kind:'fence',mutation,phase:'before'})),
 ...['cleaning_aba','member_aba','duplicate','rls','truncate','cascade','trigger_disabled','trigger_missing','trigger_args','policy_release','guest_consent','principal_aba','ambiguous_predecessor','stale_actor','deadlock','unknown_commit','P13_wire'].map(id=>Object.freeze({id,kind:'special'}))
]);
const fail=c=>{throw Object.assign(Error(c),{code:c});};
const state=e=>/^[0-9A-Z]{5}$/.test(e?.code||'')?e.code:null;
async function transaction(c,body){
 let committing=false;
 try{
  await c.query(SQL.begin);const value=await body();
  committing=true;const ack=await c.query('COMMIT');
  if(ack.command!=='COMMIT')return {ok:false,...classifyCommit('UNKNOWN'),uncertain:true};
  return {ok:true,value,ack:'COMMIT',canSend:false};
 }catch(e){
  if(committing)return {ok:false,...classifyCommit('UNKNOWN',e),uncertain:true};
  try{await c.query('ROLLBACK');}catch{return {ok:false,status:'HOLD',sqlstate:state(e),uncertain:true,canSend:false};}
  return {ok:false,status:'HOLD',sqlstate:state(e),uncertain:false,canSend:false};
 }
}
function validateSnapshot(v,slot,binding){
 const keys=['account','property','booking','predecessor','request','decision','session','source'];
 if(!v||v.slot!==slot||v.canSend!==false||keys.some(k=>typeof v[k]!=='string'||!v[k]||(binding&&v[k]!==binding[k]))||
 !Array.isArray(v.vector)||v.vector.length!==6||v.vector.some(x=>typeof x!=='string'||!/^[1-9][0-9]*$/.test(x)||BigInt(x)>9223372036854775806n))fail('SNAPSHOT_BINDING');
 return v;
}
async function snapshot(c,slot,binding){const r=await c.query(SQL.snapshot,[slot]);if(r.rowCount!==1||!r.rows[0]?.v)fail('SNAPSHOT');return validateSnapshot(r.rows[0].v,slot,binding);}
async function decide(c,s){return transaction(c,async()=>{const r=await c.query(SQL.decide,[s.request,s.session,'1',s.decision]);
 const v=r.rows?.[0]?.v;if(v?.status!=='SOURCE_REVIEWED'||v.requestId!==s.request||v.version!=='2'||v.canSend!==false)fail('DECISION_RECEIPT');return v;});}
async function mutate(c,m,s){const r=await c.query(m.sql,m.key==='session'?[s.session,s.account]:[s[m.key]]);if(r.rowCount!==1)fail('MUTATION_CARDINALITY');return r;}
async function waitBlocked(observer,waiterPid,holderPid){
 for(let n=0;n<128;n++){
  const r=await observer.query(SQL.blocked,[waiterPid]);
  if(r.rows?.[0]?.blockers?.includes(holderPid))return {observed:true,polls:n+1};
 }
 fail('BLOCKING_RELATION_NOT_OBSERVED');
}
async function fenceScenario(pair,entry,slot){
 const {a,b,peers}=pair,m=MUTATIONS[entry.mutation];
 const prep=await transaction(a,async()=>{const r=await a.query(SQL.prepare,[slot]);return r.rows[0].v;});
 if(!prep.ok)return {id:entry.id,status:'BLOCK',stage:'PREPARE',sqlstate:prep.sqlstate,canSend:false};
 const s=validateSnapshot(prep.value,slot),before=await snapshot(a,slot,s);let writer,decision,barrier=null;
 if(entry.phase==='while'){
  await b.query(SQL.begin);await mutate(b,m,s);
  const pending=decide(a,s); // catches/reports errors immediately, never retries
  let committing=false;
  try{barrier=await waitBlocked(b,peers[0].pid,peers[1].pid);committing=true;const ack=await b.query('COMMIT');writer={ok:ack.command==='COMMIT',ack:ack.command,uncertain:ack.command!=='COMMIT'};}
  catch(e){if(!committing)await b.query('ROLLBACK');else writer={ok:false,uncertain:true,sqlstate:state(e)};if(!committing){await pending;throw e;}}
  decision=await pending;
 }else if(entry.phase==='after'){
  decision=await decide(a,s);if(!decision.ok)return {id:entry.id,status:'BLOCK',stage:'DECIDE',...decision};
  writer=await transaction(b,()=>mutate(b,m,s));
 }else if(entry.phase==='rollback'){
  await b.query(SQL.begin);await mutate(b,m,s);const ack=await b.query('ROLLBACK');
  writer={ok:ack.command==='ROLLBACK',ack:ack.command};decision=await decide(a,s);
 }else{
  writer=await transaction(b,()=>mutate(b,m,s));if(!writer.ok)return {id:entry.id,status:'HOLD',stage:'WRITER',...writer};
  decision=await decide(a,s);
 }
 if(writer.uncertain||decision.uncertain)return {id:entry.id,status:'HOLD',uncertain:true,canSend:false};
 const after=await snapshot(a,slot,s),index=DOMAINS.indexOf(m.domain);
 const bumped=index<0?true:BigInt(after.vector[index])>BigInt(before.vector[index]);
 const unchanged=JSON.stringify(after.vector)===JSON.stringify(before.vector);
 const pass=writer.ok&&(entry.phase==='rollback'?unchanged&&decision.ok&&after.status==='APPROVED'&&after.version==='2':
  entry.phase==='after'?bumped&&after.status==='REVOKED'&&after.version==='3':
  entry.phase==='while'?bumped&&!decision.ok&&decision.sqlstate==='40001'&&after.status==='REVIEW_REQUIRED'&&after.version==='1':
  bumped&&!decision.ok&&decision.sqlstate==='P0001'&&after.status==='REVIEW_REQUIRED'&&after.version==='1');
 return {id:entry.id,status:pass?'OBSERVED_PASS':'FAIL',scope:pair.scope,before,after,writer,decision,barrier,canSend:false};
}
async function specialScenario(pair,id,slot){
 const {a,b}=pair;
 if(['P13_wire','unknown_commit'].includes(id))return {id,status:'BLOCK',reason:id==='P13_wire'?'P13_WIRE_PROHIBITED':'NO_AUTHORIZED_NATIVE_FAULT_PRIMITIVE',canSend:false};
 if(['trigger_disabled','trigger_missing','trigger_args','policy_release','guest_consent','principal_aba','ambiguous_predecessor','stale_actor','deadlock'].includes(id))
  return {id,status:'BLOCK',reason:'EXACT_PROVISIONER_FAULT_STEP_NOT_WIRED',canSend:false};
 const prep=await transaction(a,async()=>{const r=await a.query(SQL.prepare,[slot]);return r.rows[0].v;});
 if(!prep.ok)return {id,status:'BLOCK',stage:'PREPARE',sqlstate:prep.sqlstate,canSend:false};
 const s=validateSnapshot(prep.value,slot);
 if(id==='duplicate'){const first=await decide(a,s),second=await decide(b,s);const saved=await snapshot(a,slot,s);
  return {id,status:first.ok&&second.ok&&saved.version==='2'&&saved.status==='APPROVED'?'OBSERVED_PASS':'FAIL',scope:pair.scope,first,second,saved,canSend:false};}
 if(id==='rls'){const r=await b.query("SELECT id FROM public.properties WHERE id='12000000-0000-4000-8000-000000009902'::uuid");
  return {id,status:r.rowCount===0?'BLOCK':'FAIL',reason:'TRUSTED_FOREIGN_ROW_EXISTENCE_AND_DENIED_LOGIN_REQUIRED',scope:pair.scope,canSend:false};}
 if(id==='truncate'){const r=await transaction(b,()=>b.query('TRUNCATE public.booking_cleaning_tasks'));
  return {id,status:!r.ok&&r.sqlstate==='42501'?'OBSERVED_PASS':'FAIL',scope:pair.scope,sqlstate:r.sqlstate,canSend:false};}
 if(id==='cascade'){const r=await transaction(b,()=>b.query('DELETE FROM public.booking_ops_records WHERE id=$1::uuid',[s.booking]));
  const child=await b.query('SELECT id FROM public.booking_cleaning_tasks WHERE booking_id=$1::uuid',[s.booking]);
  return {id,status:r.ok&&child.rowCount===0?'BLOCK':'FAIL',reason:'TRUSTED_CHILD_COUNT_REQUIRED_RLS_MAY_HIDE_ORPHANS',scope:pair.scope,canSend:false};}
 if(id==='cleaning_aba'||id==='member_aba'){
  const before=await snapshot(a,slot,s);
  const r=await transaction(b,async()=>{
   if(id==='cleaning_aba'){const saved=await b.query('DELETE FROM public.booking_cleaning_tasks WHERE booking_id=$1::uuid RETURNING id,booking_id,property_id,status,verified_at,updated_at',[s.booking]);
    const x=saved.rows[0];if(!x)fail('ABA_ROW_MISSING');
    await b.query('INSERT INTO public.booking_cleaning_tasks(id,booking_id,property_id,status,verified_at,updated_at) VALUES($1,$2,$3,$4,$5,$6)',Object.values(x));
   }else{await b.query("UPDATE public.account_members SET role='operator' WHERE account_id=$1::uuid",[s.account]);
    await b.query("UPDATE public.account_members SET role='owner' WHERE account_id=$1::uuid",[s.account]);}
  });const decision=await decide(a,s),after=await snapshot(a,slot,s);
  return {id,status:r.ok&&!decision.ok&&decision.sqlstate==='P0001'?'BLOCK':'FAIL',reason:'AUTHORITATIVE_ABA_EPOCH_READBACK_REQUIRED',scope:pair.scope,before,after,decision,canSend:false};
 }
 fail('UNKNOWN_SCENARIO');
}
async function execute(pair,entry,slot){return entry.kind==='fence'?fenceScenario(pair,entry,slot):specialScenario(pair,entry.id,slot);}
/** Native gate takes no parameters. No caller callback/config/JSON/env can open it. */
export async function runNative(){
 let capability;
 try{capability=await acquireProtectedRun();}catch{return admissionStatus();}
 // Unreachable until an independently installed and reviewed protected provider exists.
 // Its ABI must return verified credentials in process-private memory, never env/argv/files selected by caller.
 const {Client}=await import('pg');const clients=[];let outcome;
 try{
  if(capability.runId!==RUN.id)fail('RUN_IDENTITY');
  for(const role of RUN.roles){
   const secret=capability.credentials[role];
   const c=new Client({host:RUN.host,port:RUN.port,database:RUN.database,user:role,password:secret,
    ssl:false,connectionTimeoutMillis:1500,query_timeout:3000,statement_timeout:2500,
    options:'-c default_transaction_isolation=serializable'});
   clients.push(c);await c.connect();
  }
  const peers=[];for(const c of clients)peers.push((await c.query(SQL.peer)).rows[0]);
  verifyPeers(...peers);
  const results=[];
  for(let i=0;i<MATRIX.length;i++){
   if(Date.now()>=capability.expiresAt)fail('WINDOW_EXPIRED');
   const result=await execute({a:clients[0],b:clients[1],peers,scope:'NATIVE_SYNTHETIC'},MATRIX[i],i+1);results.push(result);
   if(result.status!=='OBSERVED_PASS')break; // fail closed; no scenario relabeling
  }
  return outcome={status:results.length===MATRIX.length&&results.every(r=>r.status==='OBSERVED_PASS')?'PASS':'BLOCK',results,canSend:false};
 }catch(e){return outcome={status:'BLOCK',reason:'NATIVE_ACCEPTANCE_FAILED',sqlstate:state(e),canSend:false};}
 finally{for(const c of clients)try{await c.end();}catch{if(outcome){outcome.status='BLOCK';outcome.cleanup='HOLD_CLIENT_CLOSE_UNPROVEN';}}}
}
/** Fixed in-memory scripted clients ONLY. Data scripts cannot supply query callbacks or sockets. */
export async function exerciseSourceScenario(id,script){
 const entry=MATRIX.find(x=>x.id===id);if(!entry)fail('UNKNOWN_SCENARIO');
 const safe=JSON.parse(JSON.stringify(script));const transcript=[];
 const make=label=>({async query(sql,args=[]){
  transcript.push({label,sql,args});const next=safe[label]?.shift();if(!next)fail('SCRIPT_EXHAUSTED');
  if(next.error)throw Object.assign(Error('SCRIPTED_ONLY'),{code:next.error});
  return next;
 }});
 const result=await execute({a:make('a'),b:make('b'),peers:[{pid:101},{pid:202}],scope:'SOURCE_ONLY'},entry,1);
 return {result,transcript,nativeProven:false,canSend:false};
}

// Direct CLI remains closed before dynamic driver loading; importing for node:test has no launch.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const result = await runNative();
 process.stdout.write(JSON.stringify(result) + '\n');
 process.exitCode = result.status === 'PASS' ? 0 : 2;
}
