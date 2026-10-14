// Task20 source-only evidence classification. No imports, sockets, SQL, credentials or authority issuance.
// Untrusted JSON must NEVER become an operator grant, phase2 receipt, or permission to message a guest.
export const PHASE1_DOMAINS=Object.freeze(['booking','physical','cleaning','policy','legal','checkout']);
export const PHASE1_SCENARIOS=Object.freeze([
 'trigger_disabled','trigger_missing','trigger_args','policy_release','guest_consent',
 'principal_aba','ambiguous_predecessor','deadlock','cleaning_aba','member_aba','rls','cascade'
]);
const EXPECTED_CASES=Object.freeze([
 ...PHASE1_DOMAINS.flatMap(domain=>['commit','rollback','race'].map(kind=>domain+':'+kind)),
 ...PHASE1_SCENARIOS
]);
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
function scoped(status,reasons,more={}){
 return Object.freeze({status,scope:'SOURCE_ONLY_NON_AUTHORIZING',canApprove:false,canSend:false,
  reasons:Object.freeze([...reasons]),...more});
}
/**
 * Checks the structural shape of the *untrusted* synthetic Phase1 report.
 * This is not a cryptographic artifact authentication, independent host proof,
 * operator authorization, guest consent, or a database readback.
 */
export function inspectPhase1Evidence(e,expectedSha){
 const reasons=[];
 if(!sha(expectedSha)||!isObject(e)||e.source!==expectedSha)reasons.push('SOURCE_MISMATCH');
 if(!isObject(e)||e.schema!==1||e.status!=='TECHNICAL_PHASE1_PASS'||e.nativeExecuted!==true)
  reasons.push('NATIVE_NOT_CONFIRMED');
 if(!isObject(e)||e.cleanup!=='PASS')reasons.push('CLEANUP_NOT_PROVEN');
 if(!isObject(e)||e.canSend!==false||e.phase2!=='BLOCK'||e.p13Wire!=='BLOCK'||e.realAuthority!=='BLOCK')
  reasons.push('AUTHORITY_BOUNDARY_CHANGED');
 if(!isObject(e?.closed)||e.closed.sessions!==0||e.closed.requests!==0||e.closed.markers!==0)
  reasons.push('NOT_CLOSED');
 if(!Number.isInteger(e?.instance?.version)||e.instance.version<170000||e.instance.version>=180000)
  reasons.push('POSTGRES_17_UNVERIFIED');
 if(!Array.isArray(e?.cases)||e.cases.length!==EXPECTED_CASES.length)reasons.push('CASE_COUNT');
 const cases=Array.isArray(e?.cases)?e.cases:[];
 const ids=cases.map(c=>c?.case);
 if(new Set(ids).size!==EXPECTED_CASES.length||
    EXPECTED_CASES.some(id=>!ids.includes(id))||
    cases.some(c=>!isObject(c)||c.status!=='PASS'))
  reasons.push('CASES_NOT_EXACT');
 const peers=Array.isArray(e?.peers)?e.peers:[];
 const a=peers.find(p=>p?.session_user==='task12_login_a');
 const b=peers.find(p=>p?.session_user==='task12_login_b');
 const valid=p=>isObject(p)&&p.privileged===false&&p.current_user===p.session_user&&
  p.port===55442&&p.isolation==='serializable'&&Number.isSafeInteger(p.pid)&&p.pid>0;
 if(!valid(a)||!valid(b)||a.pid===b.pid)reasons.push('TWO_LOGIN_NOT_PROVEN');
 return scoped(reasons.length?'HOLD':'STRUCTURE_MATCH_ONLY',reasons);
}
/**
 * The Phase2 authority decision is intentionally closed until independently
 * installed and verified host custody, real revocation and consent evidence exist.
 * Caller-supplied receipts never satisfy these prerequisites.
 */
export function assessPhase2Gate(e,expectedSha,proposedReceipt=null){
 const inspection=inspectPhase1Evidence(e,expectedSha);
 const reasons=inspection.status==='HOLD'?['PHASE1_EVIDENCE_UNVERIFIED',...inspection.reasons]:[];
 reasons.push('INDEPENDENT_HOST_CUSTODY_NOT_INSTALLED','OPERATOR_PROVENANCE_NOT_VERIFIED',
  'REVOCATION_NOT_VERIFIED','REAL_GUEST_CONSENT_NOT_VERIFIED','P13_WIRE_NOT_PROVEN');
 if(proposedReceipt!==null)reasons.push('CALLER_RECEIPT_IS_NOT_AUTHORITY');
 return scoped('BLOCK',reasons,{phase2:'NOT_RUN',operatorAuthority:'UNVERIFIED'});
}
/**
 * A conservative observer of one transaction's *reported* COMMIT sequence.
 * It sends no COMMIT, never retries, performs no readback and cannot release
 * Phase2 or guest send. Even a clean ACK is only a technical observation.
 */
export function inspectCommitTrace(events){
 if(!Array.isArray(events)||events.length===0||events.length>8)
  return scoped('HOLD',['EMPTY_OR_INVALID_TRACE'],{commit:'UNKNOWN',attempts:0,canRetry:false});
 let state='READY',attempts=0,reason=null;
 for(const event of events){
  if(state==='READY'&&event==='COMMIT_SUBMITTED'){state='IN_FLIGHT';attempts=1;continue;}
  if(state==='IN_FLIGHT'&&event==='COMMIT_ACKED'){state='ACK_OBSERVED';continue;}
  if(state==='IN_FLIGHT'&&['TRANSPORT_LOST','TIMEOUT','UNKNOWN_REPLY','ROLLBACK_REPLY'].includes(event)){
   state='HOLD';reason='AMBIGUOUS_AFTER_COMMIT';continue;
  }
  reason='INVALID_OR_REPLAYED_TRANSITION';state='HOLD';
 }
 if(state==='ACK_OBSERVED')
  return scoped('TECHNICAL_ACK_ONLY',[],{commit:'ACK_OBSERVED_NOT_READBACK',attempts,canRetry:false});
 return scoped('HOLD',[reason|| (state==='IN_FLIGHT'?'COMMIT_REPLY_MISSING':'COMMIT_NOT_SENT')],
  {commit:'UNKNOWN',attempts,canRetry:false});
}
