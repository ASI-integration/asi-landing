// Task12 source-only contracts. No filesystem, process, environment, pg or socket imports.
export const RUN = Object.freeze({
 id:'strigunov-task12-20261014-a1',root:'C:/tmp/asi-strigunov-task12-pg-lab-20261014-a1',
 dataRoot:'C:/tmp/asi-strigunov-task12-pg-lab-20261014-a1/data',
 credentialRoot:'C:/ProgramData/ASI-Task12-Custodian/strigunov-task12-20261014-a1',
 host:'127.0.0.1',port:55442,database:'strigunov_task11_isolated_lab',version:170011,
 roles:['task12_login_a','task12_login_b'],deniedRole:'task12_denied',
 ownerRole:'strigunov_task11_owner',provisionerRole:'task12_provisioner',
 approval:'UNAPPROVED',notBefore:null,notAfter:null,maxDurationMs:900000
});
export const DOMAINS=Object.freeze(['booking','physical','cleaning','policy','legal','checkout']);
export const DEPENDENCIES=Object.freeze(['protected-host','fixture','task08','task11','overlay','catalog','two-logins','scenarios','owned-cleanup']);
const fail=c=>{throw Object.assign(Error(c),{code:c});};
export function verifyOrder(order){
 if(JSON.stringify(order)!==JSON.stringify(DEPENDENCIES))fail('DEPENDENCY_ORDER');
 return {scope:'SOURCE_ONLY',authorized:false};
}
// Observation validation never grants host authority or proves SCRAM by itself.
export function verifyPeers(a,b){
 for(const [i,p] of [a,b].entries()){
  if(!p||p.session_user!==RUN.roles[i]||p.current_user!==p.session_user||
   !Number.isSafeInteger(p.pid)||p.pid<=0||p.database!==RUN.database||
   p.host!==RUN.host||p.port!==RUN.port||p.isolation!=='serializable'||p.privileged!==false)
   fail('PEER_IDENTITY');
 }
 if(a.pid===b.pid)fail('PEER_IDENTITY');
 return {scope:'SOURCE_ONLY',authorized:false,canSend:false};
}
export function classifyCommit(ack,error){
 if(ack!=='COMMIT')return {status:'HOLD',retry:false,canSend:false,sqlstate:/^[0-9A-Z]{5}$/.test(error?.code||'')?error.code:null};
 return {status:'ACK_OBSERVED',retry:false,canSend:false,sqlstate:null};
}
export function verifyCleanup(expected,observed){
 if(!expected||!observed||JSON.stringify(expected)!==JSON.stringify(observed))fail('CLEANUP_IDENTITY');
 if(expected.runId!==RUN.id||expected.root!==RUN.root||expected.port!==RUN.port||
 expected.reparse!==false||expected.foreignSessions?.length!==0||expected.unknownFiles?.length!==0||
 !Number.isInteger(expected.databaseOid)||expected.databaseOid<=0||
 !Array.isArray(expected.roleOids)||expected.roleOids.length!==8||new Set(expected.roleOids).size!==8||
 !expected.roleOids.every(x=>Number.isInteger(x)&&x>0)||!Number.isInteger(expected.pid)||expected.pid<=0||
 !Number.isSafeInteger(expected.startedAt)||!expected.systemId||!expected.ownerSid||
 !/^[a-f0-9]{64}$/.test(expected.catalogSha||''))fail('CLEANUP_UNPROVEN');
 return {status:'PLAN_ONLY',authorized:false,canExecute:false,database:RUN.database,root:RUN.root};
}
export function admissionStatus(){
 return Object.freeze({status:'BLOCK',reason:'PROTECTED_OS_CUSTODIAN_NOT_INSTALLED',secretRead:false,socketOpened:false,sqlExecuted:false,canSend:false});
}
/**
 * Future internal provider ABI (not installed):
 * ProtectedRun {runId, immutableSourceSha, systemId, databaseOid, ownerSid, expiresAt,
 *  hbaScramAttestation, processIdentity, credentialHandles, ownedCatalog}.
 * Custodian must authenticate OS peer and owner approval out of process, pin exact bytes,
 * and own protected credentials. No JS callback / JSON / env registration is accepted.
 * This function must never read caller data or fabricate a capability.
 */
export async function acquireProtectedRun(){throw Object.assign(Error('PROTECTED_OS_CUSTODIAN_NOT_INSTALLED'),{code:'CUSTODY_BLOCK'});}
