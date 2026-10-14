// Task23: pure data validation for a FUTURE owner-controlled Hetzner Cloud custodian.
// This module has no network access, credentials, cloud SDK, SQL, guest messages or authority.
export const TASK23_BASE_SHA='9bc8175aa772e92366c7a2363e26900a042fc3ce';
export const HISTORICAL_PROOFS=Object.freeze({
 phase1:{runId:38573727019,source:'02e81db54e69d87978872151c40af3b9ec17825c',status:'TECHNICAL_PHASE1_PASS'},
 p13:{runId:38582427316,source:'9bc8175aa772e92366c7a2363e26900a042fc3ce',status:'P13_NATIVE_TECHNICAL_PASS'}
});
export const FIXED_BROKER_ACTIONS=Object.freeze([
 'inspect-owned-host','verify-immutable-release','read-technical-phase1',
 'verify-operator-revocation','consume-one-use-test-grant',
 'run-isolated-phase2-probes','read-only-reconcile','stop-owned-lab'
]);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const sha40=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const sha256=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const uid=x=>Number.isSafeInteger(x)&&x>0;
const emit=(status,issues)=>Object.freeze({
 status,issues:Object.freeze([...issues]),verification:'UNTRUSTED_INPUT_SHAPE_ONLY',
 authorized:false,canInstall:false,canProvision:false,canIssueReceipt:false,
 canApprove:false,canSend:false,canAccessProduction:false,
 phase2:'BLOCK',custodian:'NOT_INSTALLED',nextGate:'OWNER_CONTROLLED_CLOUD_IDENTITY_AND_PHYSICAL_ATTESTATION'
});
/**
 * Inspect a proposed cloud design, never a real host state.
 * Valid-looking owner assertions are not independently verified and never grant authority.
 */
export function inspectCloudCandidate(x,{reviewedSha=TASK23_BASE_SHA,nowMs}={}){
 if(!object(x))return emit('HOLD',['NO_PLAN']);
 const problems=[];
 if(!sha40(reviewedSha)||x.sourceSha!==reviewedSha)problems.push('REVIEW_SHA');
 if(!Number.isSafeInteger(nowMs)||nowMs<=0||
    !Number.isSafeInteger(x.window?.startMs)||!Number.isSafeInteger(x.window?.endMs)||
    x.window.startMs>nowMs||x.window.endMs<=nowMs||
    x.window.endMs-x.window.startMs>900000)
  problems.push('APPROVAL_WINDOW');
 const cloud=x.cloud,network=x.network,control=x.control,broker=x.broker,history=x.history;
 if(!object(cloud)||cloud.provider!=='hetzner-cloud'||!uid(cloud.projectId)||
    !uid(cloud.productionProjectId)||cloud.projectId===cloud.productionProjectId||
    !uid(cloud.serverId)||!uid(cloud.productionServerId)||
    cloud.serverId===cloud.productionServerId||cloud.projectOwnerRole!=='Owner'||
    cloud.newDedicatedProject!==true||cloud.serverCreatedByOwner!==true)
  problems.push('PROJECT_AND_SERVER_ISOLATION');
 // A Tailscale link is a connection; it does not confer broker trust or owner identity.
 if(!object(network)||network.publicInboundCount!==0||
    network.prodNetworkAttached!==false||network.allowProductionEndpoints!==false||
    network.tailscaleEnabled!==true||network.ownerReviewedTailnetAcl!==true||
    network.apiOnlyOverTailnet!==true||network.outboundExplicitlyRestricted!==true)
  problems.push('NETWORK_BOUNDARY');
 if(!object(control)||control.ownerRetainsProviderAdmin!==true||
    control.ownerCanRevokeAccess!==true||control.agentHasCloudApiToken!==false||
    control.agentHasSshRoot!==false||control.agentHasConsoleAccess!==false||
    control.agentCanModifyBinary!==false||control.sharedProductionSecrets!==false||
    control.cloudApiTokenInArtifact!==false||control.providerKeysInGitHub!==false)
  problems.push('OWNER_CONTROL');
 if(!object(broker)||!sha256(broker.binarySha256)||!sha256(broker.configSha256)||
    !sha256(broker.ownerApprovedManifestSha256)||broker.nonRootService!==true||
    broker.noArbitrarySqlOrShell!==true||broker.noSecretsExport!==true||
    broker.immutableArtifactVerifiedExternally!==true||broker.onceOnlyPersistentLedger!==true||
    broker.denyReplayAcrossRestart!==true||broker.unknownCommitMeansHold!==true||
    broker.hasGuestSendCapability!==false||
    !Array.isArray(broker.allowedOperations)||
    broker.allowedOperations.length!==FIXED_BROKER_ACTIONS.length||
    new Set(broker.allowedOperations).size!==FIXED_BROKER_ACTIONS.length||
    broker.allowedOperations.some(op=>!FIXED_BROKER_ACTIONS.includes(op)))
  problems.push('TRUSTED_BROKER_REQUIREMENTS');
 if(!object(history)||!object(history.phase1)||!object(history.p13)||
    ['phase1','p13'].some(key=>Object.entries(HISTORICAL_PROOFS[key])
      .some(([field,value])=>history[key][field]!==value)))
  problems.push('NATIVE_HISTORICAL_EVIDENCE');
 if(x.syntheticOnly!==true||x.customerDataPresent===true||
    x.productionDeploy===true||x.realGuestConsentClaimed===true||
    x.phase2Enabled===true||x.guestSendEnabled===true||
    x.localWindowsInstallerExecuted===true)
  problems.push('FORBIDDEN_LIVE_SCOPE');
 return emit(problems.length?'HOLD':'PLAN_SHAPE_ONLY',problems);
}
/**
 * Even a perfectly shaped cloud proposal cannot attest the provider account,
 * a running binary, real effective ACLs, human approval or live operator consent.
 */
export function authorizeCloudCustodian(){
 return emit('BLOCK',['EXTERNAL_OWNER_PROVISIONING_NOT_RUN',
  'INDEPENDENT_SERVICE_ATTESTATION_NOT_PROVEN',
  'PROTECTED_OPERATOR_REVOCATION_NOT_PROVEN','REAL_GUEST_CONSENT_NOT_PROVEN']);
}
