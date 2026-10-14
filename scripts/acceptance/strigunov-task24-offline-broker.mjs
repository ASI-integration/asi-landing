// Task24: pure, test-only cloud custodian command protocol and replay model.
// NOT a network broker, not durable storage, not a trusted issuer or authorization.
// No credentials, files, sockets, cloud access, SQL or guest messaging.
export const SOURCE_SHA='9bc8175aa772e92366c7a2363e26900a042fc3ce';
export const PREVIEW_COMMANDS=Object.freeze([
 'inspect-owned-host','verify-immutable-release','read-technical-phase1',
 'verify-operator-revocation','readonly-reconcile','stop-owned-lab'
]);
const FIELDS=Object.freeze([
 'kind','runId','sourceSha','manifestSha256','sequence','requestId',
 'command','scope','issuedAtMs','expiresAtMs','observation'
]);
const HEX64=/^[a-f0-9]{64}$/;
const RUN=/^strig-t24-[a-f0-9]{12}$/;
const REQUEST=/^[a-f0-9]{32}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keysMatch=(x,expected)=>object(x)&&
 Object.keys(x).length===expected.length&&expected.every(k=>Object.hasOwn(x,k));
const freezeLedger=x=>Object.freeze({...x,processed:Object.freeze([...x.processed])});
const verdict=(status,reason,ledger)=>Object.freeze({
 status,reason,ledger,scope:'UNTRUSTED_SIMULATION_ONLY',
 authorized:false,canIssueReceipt:false,canInstall:false,canApprove:false,
 canSend:false,canAccessProduction:false,canRetryUnknownCommit:false
});
const error=code=>{throw Object.assign(new Error(code),{code});};
export function newPreviewLedger({runId,manifestSha256,sourceSha=SOURCE_SHA}={}){
 if(!RUN.test(runId||'')||!HEX64.test(manifestSha256||'')||
    sourceSha!==SOURCE_SHA)error('PREVIEW_SCOPE');
 return freezeLedger({schema:1,runId,sourceSha,manifestSha256,
  sequence:0,index:0,state:'OPEN',processed:[]});
}
// This only verifies the structure of caller-supplied data. A forged checkpoint
// is never trusted or usable to authorize host access, receipts or real sends.
export function inspectPreviewCheckpoint(x){
 const required=['schema','runId','sourceSha','manifestSha256','sequence','index','state','processed'];
 if(!keysMatch(x,required)||x.schema!==1||!RUN.test(x.runId||'')||
    x.sourceSha!==SOURCE_SHA||!HEX64.test(x.manifestSha256||'')||
    !Number.isSafeInteger(x.sequence)||x.sequence<0||x.sequence>8||
    !Number.isSafeInteger(x.index)||x.index<0||x.index>PREVIEW_COMMANDS.length||
    !['OPEN','HOLD','CLOSED'].includes(x.state)||
    !Array.isArray(x.processed)||x.processed.length!==x.sequence||
    x.processed.length>8||x.processed.some(id=>!REQUEST.test(id))||
    new Set(x.processed).size!==x.processed.length||
    (x.state==='CLOSED'&&x.index!==PREVIEW_COMMANDS.length)||
    (x.state==='OPEN'&&x.index===PREVIEW_COMMANDS.length))
  return Object.freeze({status:'HOLD',reason:'CHECKPOINT_SHAPE',trusted:false});
 return Object.freeze({status:'SHAPE_ONLY',reason:'NOT_ATTESTED',trusted:false});
}
function parseEnvelope(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>2048||raw.length<2)error('REQUEST_BYTES');
 let x;try{x=JSON.parse(raw);}catch{error('REQUEST_JSON');}
 if(!keysMatch(x,FIELDS))error('REQUEST_FIELDS');
 if(x.kind!=='ASI_TASK24_PREVIEW_V1'||!RUN.test(x.runId||'')||
    x.sourceSha!==SOURCE_SHA||!HEX64.test(x.manifestSha256||'')||
    !Number.isSafeInteger(x.sequence)||x.sequence<1||x.sequence>8||
    !REQUEST.test(x.requestId||'')||!PREVIEW_COMMANDS.includes(x.command)||
    x.scope!=='SYNTHETIC_ONLY'||!['OBSERVED','DENIED','COMMIT_UNCERTAIN'].includes(x.observation)||
    !Number.isSafeInteger(x.issuedAtMs)||!Number.isSafeInteger(x.expiresAtMs)||
    x.issuedAtMs<=0||x.expiresAtMs<=x.issuedAtMs||
    x.expiresAtMs-x.issuedAtMs>300000)
   error('REQUEST_CONTRACT');
 return x;
}
export function inspectPreviewRequest(raw){
 try{const x=parseEnvelope(raw);return Object.freeze({status:'SHAPE_ONLY',
  command:x.command,trusted:false,authorized:false,canSend:false});}
 catch(e){return Object.freeze({status:'HOLD',reason:e.code||'INVALID',trusted:false,
  authorized:false,canSend:false});}
}
export function stepPreviewLedger(checkpoint,raw,nowMs){
 if(inspectPreviewCheckpoint(checkpoint).status!=='SHAPE_ONLY')
  return verdict('HOLD','CHECKPOINT_INVALID',checkpoint);
 let req;
 try{req=parseEnvelope(raw);}catch(e){return verdict('HOLD',e.code||'INVALID_REQUEST',checkpoint);}
 if(!Number.isSafeInteger(nowMs)||nowMs<req.issuedAtMs||nowMs>=req.expiresAtMs)
  return verdict('HOLD','EXPIRED_OR_FUTURE',checkpoint);
 if(checkpoint.state==='CLOSED')return verdict('HOLD','CLOSED',checkpoint);
 if(req.runId!==checkpoint.runId||req.sourceSha!==checkpoint.sourceSha||
    req.manifestSha256!==checkpoint.manifestSha256)
  return verdict('HOLD','IDENTITY_MISMATCH',checkpoint);
 if(req.sequence!==checkpoint.sequence+1||checkpoint.processed.includes(req.requestId))
  return verdict('HOLD','REPLAY_OR_GAP',checkpoint);
 if(checkpoint.state==='HOLD'&&
    !['readonly-reconcile','stop-owned-lab'].includes(req.command))
  return verdict('HOLD','UNCERTAIN_OUTCOME_LOCKED',checkpoint);
 if(checkpoint.state==='OPEN'&&req.command!==PREVIEW_COMMANDS[checkpoint.index])
  return verdict('HOLD','OUT_OF_ORDER_OR_FORBIDDEN_COMMAND',checkpoint);
 let state=checkpoint.state,index=checkpoint.index;
 if(req.observation!=='OBSERVED')state='HOLD';
 else if(state==='OPEN'){
  index++;
  if(index===PREVIEW_COMMANDS.length)state='CLOSED';
 }
 // HOLD remains HOLD after alleged reconciliation, even if a forged
 // caller supplies OBSERVED. Only independent host attestation can resolve it.
 const ledger=freezeLedger({...checkpoint,sequence:req.sequence,index,state,
  processed:[...checkpoint.processed,req.requestId]});
 return verdict(state==='HOLD'?'HOLD':'PREVIEW_ADVANCED',
  state==='HOLD'?'NO_AUTO_RETRY_OR_RELEASE':'SIMULATION_NOT_AUTHORITY',ledger);
}
export function restorePreviewCheckpoint(json){
 if(typeof json!=='string'||Buffer.byteLength(json,'utf8')>4096)
  return verdict('HOLD','CHECKPOINT_BYTES',null);
 let x;try{x=JSON.parse(json);}catch{return verdict('HOLD','CHECKPOINT_JSON',null);}
 if(inspectPreviewCheckpoint(x).status!=='SHAPE_ONLY')
  return verdict('HOLD','CHECKPOINT_SHAPE',null);
 // Restored data may be forged or rolled back. It is never a durable receipt.
 return verdict('SHAPE_ONLY','REQUIRES_OWNER_CONTROLLED_DURABLE_LEDGER',
  freezeLedger(x));
}
