// Task22: PURE PRE-INSTALL REVIEW of a proposed externally owned Phase2 custodian.
// Caller-controlled JSON and signed-looking fields NEVER confer operator authority.
// No IO, no private key, no SQL, no service installation, no grant and no guest send.
export const HISTORICAL_NATIVE=Object.freeze({
 phase1Run:38573727019,phase1Sha:'02e81db54e69d87978872151c40af3b9ec17825c',
 wireRun:38582427316,wireSha:'9bc8175aa772e92366c7a2363e26900a042fc3ce'
});
export const REQUIRED_OPERATIONS=Object.freeze([
 'preflight-metadata','verify-source-digest','verify-phase1-native',
 'retire-bootstrap','consume-one-use-receipt','run-synthetic-phase2',
 'readonly-reconcile','stop-owned-lab'
]);
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/;
const sid=x=>typeof x==='string'&&/^S-1-5-21-(?:[0-9]+-){3}[0-9]+$/.test(x);
const result=(stage,reasons,more={})=>Object.freeze({
 status:stage,scope:'SOURCE_ONLY_UNTRUSTED_OBSERVATION',authorized:false,
 canApprove:false,canSend:false,canIssueReceipt:false,canInstall:false,
 reasons:Object.freeze([...reasons]),...more
});
/**
 * Validate the candidate host *schema*, not the identity of its producer.
 * The actual custodian must be an independently owner-installed service with
 * non-agent-owned protected source, vault, IPC and externally checked identity.
 */
export function inspectCustodianPlan(candidate,expectedSourceSha,nowMs){
 const errors=[];
 if(!isObj(candidate))return result('HOLD',['CANDIDATE_ABSENT']);
 if(!SHA40.test(expectedSourceSha||'')||candidate.sourceSha!==expectedSourceSha)
  errors.push('SOURCE_NOT_PINNED');
 if(!Number.isSafeInteger(nowMs)||nowMs<=0||
    !Number.isSafeInteger(candidate.notBeforeMs)||!Number.isSafeInteger(candidate.expiresMs)||
    candidate.notBeforeMs>nowMs||candidate.expiresMs<=nowMs||
    candidate.expiresMs-candidate.notBeforeMs>15*60*1000)
  errors.push('INVALID_FRESH_WINDOW');
 if(!sid(candidate.ownerSid)||!sid(candidate.agentSid)||!sid(candidate.custodianSid)||
    new Set([candidate.ownerSid,candidate.agentSid,candidate.custodianSid]).size!==3)
  errors.push('NOT_INDEPENDENT_SID');
 if(!SHA64.test(candidate.binarySha||'')||!SHA64.test(candidate.configSha||'')||
    !SHA64.test(candidate.reviewSha||''))
  errors.push('BINARY_OR_REVIEW_UNPINNED');
 if(candidate.target?.host!=='127.0.0.1'||candidate.target?.port!==55442||
    candidate.target?.database!=='strigunov_task11_isolated_lab'||
    candidate.target?.syntheticOnly!==true)
  errors.push('TARGET_NOT_ISOLATED');
 if(candidate.origin!=='OWNER_CONTROLLED_EXTERNAL'||candidate.agentMayModify!==false||
    candidate.agentMayReadVault!==false||candidate.ownerControlsActivation!==true)
  errors.push('CUSTODY_NOT_SEPARATED');
 const ops=candidate.fixedOperations;
 if(!Array.isArray(ops)||ops.length!==REQUIRED_OPERATIONS.length||
    new Set(ops).size!==REQUIRED_OPERATIONS.length||
    ops.some(op=>!REQUIRED_OPERATIONS.includes(op)))
  errors.push('OPERATIONS_NOT_FIXED');
 if(candidate.phase1?.runId!==HISTORICAL_NATIVE.phase1Run||
    candidate.phase1?.sha!==HISTORICAL_NATIVE.phase1Sha||
    candidate.phase1?.status!=='TECHNICAL_PHASE1_PASS'||
    candidate.p13?.runId!==HISTORICAL_NATIVE.wireRun||
    candidate.p13?.sha!==HISTORICAL_NATIVE.wireSha||
    candidate.p13?.status!=='P13_NATIVE_TECHNICAL_PASS')
  errors.push('HISTORICAL_PROOFS_NOT_BOUND');
 if(candidate.provisionerRetired!==true||candidate.noActiveProvisionerSessions!==true||
    candidate.oneUseLedgerProtected!==true||candidate.denyOnUnknownCommit!==true)
  errors.push('BOOTSTRAP_OR_REPLAY_NOT_CLOSED');
 if(candidate.guestSend===true||candidate.productionAccess===true||candidate.realData===true||
    candidate.phase2Authorization===true)
  errors.push('FORBIDDEN_LIVE_SCOPE');
 // Even perfect-looking data is not independently verified. Never return PASS.
 return result(errors.length?'HOLD':'CANDIDATE_SHAPE_ONLY',errors,{
  nextGate:'INDEPENDENT_PHYSICAL_HOST_PROOF_REQUIRED',phase2:'BLOCK'
 });
}
/**
 * Read-only semantic verification of a hypothetical revocation proof.
 * Cannot issue a session or validate the caller's authority to supply proof.
 */
export function inspectRevocationProof(p){
 const errors=[];
 if(!isObj(p))return result('HOLD',['REVOCATION_ABSENT']);
 const integer=x=>typeof x==='string'&&/^[1-9][0-9]{0,18}$/.test(x)&&
   BigInt(x)<=9223372036854775806n;
 if(!integer(p.beforeEpoch)||!integer(p.afterEpoch)||
    (integer(p.beforeEpoch)&&integer(p.afterEpoch)&&BigInt(p.afterEpoch)<=BigInt(p.beforeEpoch)))
  errors.push('REVOCATION_EPOCH_NOT_ADVANCED');
 if(p.beforeActor!==p.afterActor||!sid(p.beforeActor)||p.beforeAccount!==p.afterAccount||
    typeof p.beforeAccount!=='string'||p.beforeAccount.length===0)
  errors.push('REVOCATION_SCOPE_CHANGED');
 if(p.revoked!==true||p.oldSessionAccepted!==false||
    p.newRequestAccepted!==false||p.canSend!==false)
  errors.push('REVOKED_SESSION_NOT_DENIED');
 if(p.authoritativePostgresReadback!==true||p.operatorCredentialExposed===true||
    p.ownerControlledSourceVerified!==true)
  errors.push('READBACK_OR_CUSTODY_MISSING');
 return result(errors.length?'HOLD':'REVOCATION_OBSERVATION_ONLY',errors,{
  phase2:'BLOCK',nextGate:'NATIVE_RESTRICTED_ROLE_DENIAL_AND_EXTERNAL_REVIEW'
 });
}
/** Only host-verified proof from a separately controlled service may ever
 * be considered for a future grant. This source library has no such service. */
export function authorizePhase2(){
 return result('BLOCK',['TRUSTED_CUSTODIAN_NOT_INSTALLED','REAL_CONSENT_NOT_VERIFIED',
  'INDEPENDENT_OPERATOR_REVOCATION_NOT_NATIVE_PROVEN'],{phase2:'NOT_RUN'});
}
