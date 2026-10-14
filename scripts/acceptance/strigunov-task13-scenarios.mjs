// Task13 fixed SQL scenario engine. No socket, secrets, pg, env or provider imports.
import {isDeepStrictEqual} from 'node:util';
import {SQL as LEGACY_SQL,MUTATIONS} from './strigunov-task12-runner.mjs';
import {DOMAINS} from './strigunov-task12-contract.mjs';
export const IDS=Object.freeze(['trigger_disabled','trigger_missing','trigger_args','policy_release','guest_consent','principal_aba','ambiguous_predecessor','stale_actor','deadlock','cleaning_aba','member_aba','rls','cascade']);
export const SQL=Object.freeze({...LEGACY_SQL,observe:'SELECT task13_fixture.observe($1::integer) AS v',
 prepare:'SELECT task13_fixture.prepare($1::integer) AS v',decide:'SELECT task13_fixture.decide($1::uuid,$2::uuid,$3::bigint,$4::uuid) AS v',
 coverage:'SELECT task13_fixture.coverage($1::integer)',negative:'SELECT task13_fixture.negative($1::integer)',
 stale:'SELECT task13_fixture.stale_actor($1::integer)',gate:'SELECT task13_fixture.gate($1::integer)',
 catalog:"SELECT t.tgname,t.tgenabled,t.tgfoid::text,encode(t.tgargs,'hex') AS args,t.tgtype FROM pg_trigger t WHERE t.tgrelid='public.booking_cleaning_tasks'::regclass AND t.tgname='task11_capture'",
 foreign:"SELECT id FROM public.properties WHERE id='12000000-0000-4000-8000-000000009902'::uuid",
 foreignWrite:"UPDATE public.properties SET name='FORBIDDEN' WHERE id='12000000-0000-4000-8000-000000009902'::uuid",
 lock:'UPDATE task13_fixture.lock_rows SET v=v+1 WHERE id=$1 RETURNING id',
 locks:'SELECT id,v FROM task13_fixture.lock_rows ORDER BY id'
});
export const TAMPER=Object.freeze({
 trigger_disabled:["ALTER TABLE public.booking_cleaning_tasks DISABLE TRIGGER task11_capture"],
 trigger_missing:["DROP TRIGGER task11_capture ON public.booking_cleaning_tasks"],
 trigger_args:["DROP TRIGGER task11_capture ON public.booking_cleaning_tasks","CREATE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_cleaning_tasks FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','legal')","ALTER TABLE public.booking_cleaning_tasks ENABLE ALWAYS TRIGGER task11_capture"]
});
export const RESTORE=Object.freeze(["DROP TRIGGER IF EXISTS task11_capture ON public.booking_cleaning_tasks","CREATE TRIGGER task11_capture BEFORE INSERT OR UPDATE OR DELETE ON public.booking_cleaning_tasks FOR EACH ROW EXECUTE FUNCTION asi_task11_private.capture_change('booking_ref','cleaning,physical')","ALTER TABLE public.booking_cleaning_tasks ENABLE ALWAYS TRIGGER task11_capture"]);
const fail=code=>{throw Object.assign(Error(code),{code});};
const CHILDREN=["booking_cleaning_tasks","booking_linen_tasks","booking_supplies_tasks","booking_maintenance_tickets","booking_physical_readiness","booking_guest_documents","booking_contracts","booking_deposits","booking_mvd_reports","booking_guest_legal_readiness","booking_instay_checkout","booking_guest_stay_issues"];
// Task17: PostgreSQL jsonb object-key order is not snapshot identity.
export const snapshotEqual=isDeepStrictEqual;
const equal=snapshotEqual;
const safeError=e=>({code:/^[0-9A-Z]{5}$/.test(e?.code||'')?e.code:null,message:/^task(?:11|13)_[a-z_]+$/.test(e?.message||'')?e.message:null});
async function ack(c,sql,command){const r=await c.query(sql);if(r.command!==command)fail('TX_ACK');return r;}
export async function transaction(c,body){
 let commit=false;
 try{await ack(c,SQL.begin,'BEGIN');const value=await body();commit=true;await ack(c,'COMMIT','COMMIT');return {ok:true,value,ack:'COMMIT'};}
 catch(e){if(commit)return {ok:false,status:'HOLD',uncertain:true,...safeError(e)};
 try{await ack(c,'ROLLBACK','ROLLBACK');}catch{return {ok:false,status:'HOLD',uncertain:true,...safeError(e)};}
 return {ok:false,status:'HOLD',uncertain:false,...safeError(e)};}
}
async function one(c,sql,args=[]){const r=await c.query(sql,args);if(r.rowCount!==1||!r.rows?.[0])fail('ROW_COUNT');return r.rows[0];}
async function changed(c,sql,args=[]){const r=await c.query(sql,args);if(r.rowCount!==1)fail('MUTATION_CARDINALITY');return r;}
async function observe(c,slot){const v=(await one(c,SQL.observe,[slot])).v;if(!v||v.slot!==slot||v.canSend!==false||v.canApprove!==false)fail('SNAPSHOT_SCOPE');return v;}
async function deny(c,sql,args,code,message){const r=await transaction(c,()=>c.query(sql,args));if(r.ok||r.uncertain||r.code!==code||(message&&r.message!==message))fail('EXACT_DENIAL');return r;}
async function barrier(c,waiter,holder){for(let n=0;n<128;n++){const r=await c.query(SQL.blocked,[waiter]);if(r.rows?.[0]?.blockers?.includes(holder))return n+1;}fail('BARRIER_UNPROVEN');}
function requireAck(r){if(!r.ok)fail(r.uncertain?'COMMIT_UNKNOWN':'TRANSACTION_FAILED');}
const badActor='task11_actor_mismatch',nativeMissing='task11_native_acceptance_missing';
const expectedError={policy_release:'task11_policy_missing',guest_consent:'task11_guest_consent_or_expiry_invalid',principal_aba:'task11_binding_stale',ambiguous_predecessor:'task11_predecessor_ambiguous',cleaning_aba:'task11_generation_changed',member_aba:'task11_binding_stale'};
async function negative(pair,id,slot,s,phase){
 if(phase===1)return deny(pair.a,SQL.negative,[slot],'P0001',nativeMissing);
 if(id==='stale_actor')return deny(pair.a,SQL.stale,[slot],'P0001',badActor);
 return deny(pair.a,SQL.decide,[s.request,s.session,'1',s.decision],'P0001',expectedError[id]);
}
async function aba(pair,id,s,slot){
 const c=id==='principal_aba'?pair.admin:pair.b;
 const table=id==='cleaning_aba'?'public.booking_cleaning_tasks':id==='member_aba'?'public.account_members':'asi_task11_private.principals';
 const where=id==='cleaning_aba'?'booking_id=$1::uuid':id==='member_aba'?'account_id=$1::uuid AND user_id=$2::uuid':"account_id=$1::uuid AND login_role='task12_login_b'";
 const args=id==='cleaning_aba'?[s.booking]:id==='member_aba'?[s.account,s.actor]:[s.account];
 let mid;
 const r=await transaction(c,async()=>{
  const saved=await one(c,'DELETE FROM '+table+' WHERE '+where+' RETURNING to_jsonb('+table.split('.')[1]+'.*) AS saved',args);
  mid=await observe(c,slot);
  await changed(c,'INSERT INTO '+table+' SELECT (jsonb_populate_record(NULL::'+table+',$1::jsonb)).*',[JSON.stringify(saved.saved)]);
 });
 requireAck(r);return {mid,writer:r};
}
async function tamper(pair,id,slot){
 const prior=(await one(pair.admin,SQL.catalog)),proof={prior};
 try{
  requireAck(await transaction(pair.admin,async()=>{for(const sql of TAMPER[id])await pair.admin.query(sql);}));
  proof.denial=await deny(pair.a,SQL.coverage,[slot],'P0001','task11_fence_disabled_or_replaced');
 }finally{
  const restored=await transaction(pair.admin,async()=>{for(const sql of RESTORE)await pair.admin.query(sql);});
  if(!restored.ok)fail('CATALOG_RESTORE_HOLD');
  proof.restored=await one(pair.admin,SQL.catalog);
  if(!equal(proof.prior,proof.restored))fail('CATALOG_RESTORE_MISMATCH');
 }
 return proof;
}
async function deadlock(pair){
 const {a,b}=pair;const initial=(await a.query(SQL.locks)).rows;
 if(!equal(initial,[{id:1,v:0},{id:2,v:0}]))fail('LOCK_FIXTURE_DIRTY');
 await ack(a,SQL.begin,'BEGIN');await ack(b,SQL.begin,'BEGIN');
 try{
  await changed(a,SQL.lock,[1]);await changed(b,SQL.lock,[2]);
  const wait=c=>async e=>{await ack(c,'ROLLBACK','ROLLBACK');return {ok:false,...safeError(e)};};
  const pa=changed(a,SQL.lock,[2]).then(()=>({ok:true}),wait(a));
  const polls=await barrier(b,pair.peers[0].pid,pair.peers[1].pid);
  const pb=changed(b,SQL.lock,[1]).then(()=>({ok:true}),wait(b));
  const outcomes=await Promise.all([pa,pb]);await ack(a,'ROLLBACK','ROLLBACK');await ack(b,'ROLLBACK','ROLLBACK');
  const persisted=(await a.query(SQL.locks)).rows;
  if(outcomes.filter(x=>!x.ok&&x.code==='40P01').length!==1||outcomes.filter(x=>x.ok).length!==1||!equal(initial,persisted))fail('DEADLOCK_PROOF');
  return {outcomes,polls,persisted};
 }catch(e){for(const c of [a,b])try{await ack(c,'ROLLBACK','ROLLBACK');}catch{ /* outer native finally closes clients; no PASS */ }throw e;}
}
export function assertProof(p){
 if(!p||!IDS.includes(p.id)||![1,2].includes(p.phase))fail('PROOF_ID');
 const b=p.before,a=p.after;
 const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
 const require=(ok,c)=>{if(!ok)fail(c);};
 const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 const epoch=x=>typeof x==='string'&&/^[1-9][0-9]{0,18}$/.test(x)&&BigInt(x)<=9223372036854775806n;
 for(const s of [b,a]){
  require(s&&Number.isSafeInteger(s.slot)&&s.slot>0&&s.slot<=64&&typeof s.source==='string'&&s.source.length>0&&['account','property','actor','booking','predecessor','request','decision'].every(k=>uuid(s[k]))&&(p.phase===1?s.session===null:uuid(s.session)),'SNAPSHOT_IDENTITY');
  require(s&&s.canApprove===false&&s.canSend===false,'PROOF_AUTHORITY');
  require(Array.isArray(s.vector)&&s.vector.length===6&&s.vector.every(epoch)&&epoch(s.memberEpoch),'PROOF_EPOCH');
  require(s.nativeMarker===(p.phase===2),'PROOF_MARKER');
  require(s.foreignCount===1&&hash(s.foreignHash),'FOREIGN_EXISTENCE');
  if(p.phase===1)require(equal(s.totals,{requests:0,bindings:0,decisions:0,sessions:0})&&s.requestStatus===null&&s.requestVersion===null,'BOOTSTRAP_AUTHORITY');
 }
 for(const k of ['slot','account','property','actor','booking','predecessor','request','decision','session','source'])require(equal(b[k],a[k]),'PROOF_SCOPE');
 require(b.foreignHash===a.foreignHash,'FOREIGN_MUTATION');
 for(let i=0;i<6;i++)require(BigInt(a.vector[i])>=BigInt(b.vector[i]),'EPOCH_REWIND');
 const up=i=>require(BigInt(a.vector[i])>BigInt(b.vector[i]),'EPOCH_UNCHANGED');
 const sameRequest=()=>{for(const k of ['requestVersion','requestStatus','totals'])require(equal(b[k],a[k]),'REQUEST_MUTATION');};
 const denied=(d,code,message)=>require(d&&d.ok===false&&d.uncertain===false&&d.code===code&&(!message||d.message===message),'DENIAL_MISMATCH');
 if(p.id.startsWith('trigger_')){
  const d=p.details,c=d?.prior;require(c&&equal(c,d.restored)&&c.tgname==='task11_capture'&&c.tgenabled==='A'&&c.tgtype===31&&/^[1-9][0-9]*$/.test(c.tgfoid)&&c.args==='626f6f6b696e675f72656600636c65616e696e672c706879736963616c00','CATALOG_RESTORE');
  denied(d.denial,'P0001','task11_fence_disabled_or_replaced');sameRequest();
 }else if(p.id==='rls'){
  require(p.visible===0&&p.written===0,'RLS_LEAK');denied(p.deniedRead,'42501');denied(p.deniedWrite,'42501');sameRequest();
 }else if(p.id==='cascade'){
  require(p.writer?.ok===true&&p.writer.ack==='COMMIT','WRITER_ACK');
  require(b.parentCount===1&&a.parentCount===0&&a.childCount===0&&a.tombstone===true,'CASCADE_ORPHAN');
  require(a.children&&equal(Object.keys(a.children).sort(),[...CHILDREN].sort())&&Object.values(a.children).every(x=>x===0),'CASCADE_CHILDREN');
  require(b.children&&CHILDREN.slice(0,10).every(k=>b.children[k]===1),'CASCADE_BASELINE');
  for(const i of [0,1,2,4,5])up(i);
  if(p.phase===2)require(p.approved?.requestStatus==='APPROVED'&&p.approved.requestVersion==='2'&&a.requestStatus==='REVOKED'&&a.requestVersion==='3'&&a.totals.decisions===b.totals.decisions+1,'CASCADE_REVOCATION');
 }else{
  denied(p.denial,'P0001',p.id==='stale_actor'?badActor:p.phase===1?nativeMissing:expectedError[p.id]);sameRequest();
  if(p.id==='stale_actor')require(equal(b.vector,a.vector),'STALE_MUTATION');
  else require(p.writer?.ok===true&&p.writer.ack==='COMMIT','WRITER_ACK');
  if(['cleaning_aba','member_aba','principal_aba'].includes(p.id)){
   const m=p.mid;require(m&&['slot','account','property','actor','booking','predecessor','request','decision','session','source'].every(k=>equal(m[k],b[k])),'ABA_MID_SCOPE');
   const k=p.id==='cleaning_aba'?'cleaningHash':p.id==='member_aba'?'memberHash':'principalHash';
   require(hash(b[k])&&hash(m[k])&&hash(a[k])&&b[k]===a[k]&&m[k]!==b[k],'ABA_BYTES');
   if(p.id==='cleaning_aba'){
    require(b.childCount===1&&m.childCount===0&&a.childCount===1,'ABA_DELETE');
    for(const i of [1,2])require(epoch(m.vector[i])&&BigInt(b.vector[i])<BigInt(m.vector[i])&&BigInt(m.vector[i])<BigInt(a.vector[i]),'ABA_EPOCH');
   }else require(epoch(m.memberEpoch)&&BigInt(b.memberEpoch)<BigInt(m.memberEpoch)&&BigInt(m.memberEpoch)<BigInt(a.memberEpoch),'ABA_MEMBER_EPOCH');
  }
  if(p.id==='policy_release'){require(a.policyHash==='f'.repeat(64)&&b.policyHash!==a.policyHash,'POLICY_BYTES');up(3);}
  if(p.id==='guest_consent'){require(b.guestRevoked===false&&a.guestRevoked===true,'CONSENT_NOT_REVOKED');up(4);}
  if(p.id==='ambiguous_predecessor'){require(b.predecessorCount===1&&a.predecessorCount===2,'PREDECESSOR_COUNT');up(0);up(5);}
 }
 return {status:'SOURCE_OBSERVATIONS_MATCH',authorized:false,canSend:false};
}
export async function executeScenario(pair,id,slot,phase=1){
 if(!IDS.includes(id)||![1,2].includes(phase))fail('SCENARIO');
 if(id==='stale_actor'&&phase===1)return {id,status:'WAITING_PHASE2',canSend:false};
 if(id==='deadlock')return {id,phase,details:await deadlock(pair),status:'TECHNICAL_OBSERVATIONS',canSend:false};
 if(phase===2&&!id.startsWith('trigger_')&&id!=='rls'){
  requireAck(await transaction(pair.a,()=>one(pair.a,SQL.prepare,[slot])));
 }
 const before=await observe(pair.a,slot),proof={id,phase,before,canSend:false};
 if(id.startsWith('trigger_'))proof.details=await tamper(pair,id,slot);
 else if(['cleaning_aba','member_aba','principal_aba'].includes(id)){Object.assign(proof,await aba(pair,id,before,slot));proof.denial=await negative(pair,id,slot,before,phase);}
 else if(id==='rls'){
  proof.visible=(await pair.b.query(SQL.foreign)).rowCount;
  await ack(pair.b,SQL.begin,'BEGIN');
  try{proof.written=(await pair.b.query(SQL.foreignWrite)).rowCount;}finally{await ack(pair.b,'ROLLBACK','ROLLBACK');}
  proof.deniedRead=await deny(pair.denied,SQL.foreign,[],'42501');
  proof.deniedWrite=await deny(pair.denied,SQL.foreignWrite,[],'42501');
 }else if(id==='stale_actor')proof.denial=await negative(pair,id,slot,before,phase);
 else if(id==='cascade'){
  if(phase===2){const accepted=await transaction(pair.a,()=>one(pair.a,SQL.decide,[before.request,before.session,'1',before.decision]));requireAck(accepted);
   proof.approved=await observe(pair.a,slot);}
  const r=await transaction(pair.b,()=>changed(pair.b,'DELETE FROM public.booking_ops_records WHERE id=$1::uuid',[before.booking]));requireAck(r);proof.writer=r;
 }else{
  const admin=id==='ambiguous_predecessor'?pair.b:pair.admin;
  const sql=id==='policy_release'?"UPDATE asi_task11_private.policy_release SET manifest_sha256=repeat('f',64) WHERE account_id=$1::uuid AND property_id=$2::uuid":
   id==='guest_consent'?"UPDATE asi_task11_private.guest_consent SET revoked=true WHERE booking_id=$1::uuid":
   "INSERT INTO public.booking_ops_records SELECT (jsonb_populate_record(NULL::public.booking_ops_records,to_jsonb(x)||jsonb_build_object('id',$2::uuid))).* FROM public.booking_ops_records x WHERE id=$1::uuid";
  const args=id==='policy_release'?[before.account,before.property]:id==='guest_consent'?[before.booking]:[before.predecessor,'13000000-0000-4000-8000-'+String(slot).padStart(12,'0')];
  const r=await transaction(admin,()=>changed(admin,sql,args));requireAck(r);proof.writer=r;proof.denial=await negative(pair,id,slot,before,phase);
 }
 proof.after=await observe(pair.a,slot);proof.verdict=assertProof(proof);return proof;
}
export async function bootstrapFence(pair,domain,phase,slot){
 const m=MUTATIONS[domain];if(!DOMAINS.includes(domain)||!['commit','rollback','race'].includes(phase))fail('BOOTSTRAP_CASE');
 const before=await observe(pair.a,slot);let barrierPolls=null;
 const args=[before[m.key]];
 if(phase==='race'){
  await ack(pair.a,SQL.begin,'BEGIN');await observe(pair.a,slot);
  await ack(pair.b,SQL.begin,'BEGIN');await changed(pair.b,m.sql,args);
  const pending=pair.a.query(SQL.gate,[slot]).then(()=>({ok:true}),e=>({ok:false,...safeError(e)}));
  barrierPolls=await barrier(pair.b,pair.peers[0].pid,pair.peers[1].pid);await ack(pair.b,'COMMIT','COMMIT');
  const result=await pending;await ack(pair.a,'ROLLBACK','ROLLBACK');
  if(result.ok||result.code!=='40001')fail('SERIALIZABLE_CONFLICT');
 }else if(phase==='rollback'){await ack(pair.b,SQL.begin,'BEGIN');await changed(pair.b,m.sql,args);await ack(pair.b,'ROLLBACK','ROLLBACK');}
 else requireAck(await transaction(pair.b,()=>changed(pair.b,m.sql,args)));
 const after=await observe(pair.a,slot),i=DOMAINS.indexOf(domain);
 const epoch=x=>typeof x==='string'&&/^[1-9][0-9]{0,18}$/.test(x)&&BigInt(x)<=9223372036854775806n;
 if(!['slot','account','property','actor','booking','predecessor','request','decision','session','source'].every(k=>equal(before[k],after[k]))||![before,after].every(s=>Array.isArray(s.vector)&&s.vector.length===6&&s.vector.every(epoch))||after.vector.some((x,n)=>BigInt(x)<BigInt(before.vector[n])))fail('BOOTSTRAP_SCOPE');
 if(phase==='rollback'&&!equal(before,after))fail('ROLLBACK_BYTES');
 if(before.nativeMarker!==false||after.nativeMarker!==false||!equal(before.totals,{requests:0,bindings:0,decisions:0,sessions:0})||
 !equal(before.totals,after.totals)|| (phase==='rollback'?!equal(before.vector,after.vector):BigInt(after.vector[i])<=BigInt(before.vector[i])))fail('BOOTSTRAP_PROOF');
 const denial=await deny(pair.a,SQL.negative,[slot],'P0001',nativeMissing);
 return {domain,phase,before,after,barrierPolls,denial,scope:'TECHNICAL_ONLY',canApprove:false,canSend:false};
}
