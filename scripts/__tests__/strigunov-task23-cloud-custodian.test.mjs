import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TASK23_BASE_SHA,HISTORICAL_PROOFS,FIXED_BROKER_ACTIONS,
 inspectCloudCandidate,authorizeCloudCustodian} from '../acceptance/strigunov-task23-cloud-custodian.mjs';

const NOW=1791997200000; // Synthetic clock; not evidence of a real owner session.
const complete=()=>({
 sourceSha:TASK23_BASE_SHA,
 window:{startMs:NOW-1000,endMs:NOW+300000},
 cloud:{provider:'hetzner-cloud',projectId:90001,productionProjectId:90002,
  serverId:90003,productionServerId:90004,projectOwnerRole:'Owner',
  newDedicatedProject:true,serverCreatedByOwner:true},
 network:{publicInboundCount:0,prodNetworkAttached:false,allowProductionEndpoints:false,
  tailscaleEnabled:true,ownerReviewedTailnetAcl:true,apiOnlyOverTailnet:true,
  outboundExplicitlyRestricted:true},
 control:{ownerRetainsProviderAdmin:true,ownerCanRevokeAccess:true,
  agentHasCloudApiToken:false,agentHasSshRoot:false,agentHasConsoleAccess:false,
  agentCanModifyBinary:false,sharedProductionSecrets:false,
  cloudApiTokenInArtifact:false,providerKeysInGitHub:false},
 broker:{binarySha256:'a'.repeat(64),configSha256:'b'.repeat(64),
  ownerApprovedManifestSha256:'c'.repeat(64),nonRootService:true,
  noArbitrarySqlOrShell:true,noSecretsExport:true,
  immutableArtifactVerifiedExternally:true,onceOnlyPersistentLedger:true,
  denyReplayAcrossRestart:true,unknownCommitMeansHold:true,
  hasGuestSendCapability:false,allowedOperations:[...FIXED_BROKER_ACTIONS]},
 history:structuredClone(HISTORICAL_PROOFS),syntheticOnly:true,
 customerDataPresent:false,productionDeploy:false,realGuestConsentClaimed:false,
 phase2Enabled:false,guestSendEnabled:false,localWindowsInstallerExecuted:false
});
const inspect=v=>inspectCloudCandidate(v,{reviewedSha:TASK23_BASE_SHA,nowMs:NOW});
const guard=v=>{const r=inspect(v);assert.equal(r.status,'HOLD');assert.equal(r.authorized,false);
 assert.equal(r.canInstall,false);assert.equal(r.canIssueReceipt,false);
 assert.equal(r.canSend,false);assert.equal(r.phase2,'BLOCK');return r;};
test('perfectly shaped candidate is never authenticated or authorized',()=>{
 const r=inspect(complete());assert.equal(r.status,'PLAN_SHAPE_ONLY');
 assert.equal(r.verification,'UNTRUSTED_INPUT_SHAPE_ONLY');
 assert.equal(r.custodian,'NOT_INSTALLED');assert.equal(r.phase2,'BLOCK');
 for(const field of ['authorized','canProvision','canInstall','canIssueReceipt','canApprove','canSend'])
  assert.equal(r[field],false);
});
test('a forged green report cannot authorize a cloud custodian',()=>{
 for(const v of [null,{authorized:true,phase2:'PASS'},complete()])
  assert.equal(authorizeCloudCustodian(v).status,'BLOCK');
});
test('missing or fake plans are HOLD',()=>{for(const v of [null,undefined,false,[],{},'PASS'])guard(v);});
test('wrong expected SHA is HOLD',()=>{
 assert.equal(inspectCloudCandidate(complete(),{reviewedSha:'f'.repeat(40),nowMs:NOW}).status,'HOLD');
});
test('invalid time inputs are HOLD',()=>{
 for(const nowMs of [null,undefined,NaN,-1,'now'])
  assert.equal(inspectCloudCandidate(complete(),{reviewedSha:TASK23_BASE_SHA,nowMs}).status,'HOLD');
});
const negatives=[
 ['source drift',p=>p.sourceSha='f'.repeat(40)],
 ['expired approval',p=>p.window.endMs=NOW],
 ['not yet approved',p=>p.window.startMs=NOW+1],
 ['approval exceeds 15 minutes',p=>p.window.endMs=NOW+3600000],
 ['not Hetzner Cloud',p=>p.cloud.provider='generic'],
 ['production project reused',p=>p.cloud.projectId=p.cloud.productionProjectId],
 ['production server reused',p=>p.cloud.serverId=p.cloud.productionServerId],
 ['owner role missing',p=>p.cloud.projectOwnerRole='Restricted'],
 ['project not isolated',p=>p.cloud.newDedicatedProject=false],
 ['public inbound open',p=>p.network.publicInboundCount=1],
 ['production network linked',p=>p.network.prodNetworkAttached=true],
 ['production endpoint reachable',p=>p.network.allowProductionEndpoints=true],
 ['tailscale not access controlled',p=>p.network.ownerReviewedTailnetAcl=false],
 ['server API publicly exposed',p=>p.network.apiOnlyOverTailnet=false],
 ['egress not explicitly restricted',p=>p.network.outboundExplicitlyRestricted=false],
 ['agent has cloud API token',p=>p.control.agentHasCloudApiToken=true],
 ['agent has root access',p=>p.control.agentHasSshRoot=true],
 ['agent can alter binary',p=>p.control.agentCanModifyBinary=true],
 ['owner cannot revoke',p=>p.control.ownerCanRevokeAccess=false],
 ['production secrets reused',p=>p.control.sharedProductionSecrets=true],
 ['provider token in GitHub',p=>p.control.providerKeysInGitHub=true],
 ['binary hash absent',p=>p.broker.binarySha256=''],
 ['arbitrary SQL allowed',p=>p.broker.noArbitrarySqlOrShell=false],
 ['secrets exportable',p=>p.broker.noSecretsExport=false],
 ['one-use ledger absent',p=>p.broker.onceOnlyPersistentLedger=false],
 ['replay possible after restart',p=>p.broker.denyReplayAcrossRestart=false],
 ['unknown COMMIT silently accepted',p=>p.broker.unknownCommitMeansHold=false],
 ['operator can send guests',p=>p.broker.hasGuestSendCapability=true],
 ['arbitrary broker command',p=>p.broker.allowedOperations.push('exec-shell')],
 ['phase1 evidence wrong',p=>p.history.phase1.runId=1],
 ['P13 evidence wrong',p=>p.history.p13.status='SOURCE_ONLY'],
 ['live production deploy claimed',p=>p.productionDeploy=true],
 ['live guest consent claimed',p=>p.realGuestConsentClaimed=true],
 ['local Windows installer triggered',p=>p.localWindowsInstallerExecuted=true]
];
for(const [name,mutate] of negatives)test('reject '+name,()=>{
 const p=complete();mutate(p);guard(p);
});
test('source-only code contains no provider or side-effect capability',()=>{
 const src=readFileSync('scripts/acceptance/strigunov-task23-cloud-custodian.mjs','utf8');
 assert.doesNotMatch(src,/\bimport\s|process\.env|fetch\s*\(|execFileSync|spawn\s*\(|\.query\s*\(|require\s*\(/);
 assert.doesNotMatch(src,/\.writeFile|createServer|\.listen\s*\(|\.ssh\b/);
});
test('existing production path and credentials are not referenced',()=>{
 const src=readFileSync('scripts/acceptance/strigunov-task23-cloud-custodian.mjs','utf8');
 assert.doesNotMatch(src,/STAGING_SSH_PRIVATE_KEY|POSTGRES_PASSWORD|sendGuest|sendTelegram|\.env\b/);
});
