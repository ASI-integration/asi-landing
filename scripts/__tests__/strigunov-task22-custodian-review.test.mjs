import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HISTORICAL_NATIVE,REQUIRED_OPERATIONS,inspectCustodianPlan,
 inspectRevocationProof,authorizePhase2} from '../acceptance/strigunov-task22-custodian-review.mjs';
const SHA='9bc8175aa772e92366c7a2363e26900a042fc3ce',NOW=1791997200000;
const sid=n=>'S-1-5-21-111-222-333-'+n;
const plan=()=>({
 sourceSha:SHA,notBeforeMs:NOW-1000,expiresMs:NOW+300000,
 ownerSid:sid(1001),agentSid:sid(1002),custodianSid:sid(1003),
 binarySha:'a'.repeat(64),configSha:'b'.repeat(64),reviewSha:'c'.repeat(64),
 target:{host:'127.0.0.1',port:55442,database:'strigunov_task11_isolated_lab',syntheticOnly:true},
 origin:'OWNER_CONTROLLED_EXTERNAL',agentMayModify:false,agentMayReadVault:false,
 ownerControlsActivation:true,fixedOperations:[...REQUIRED_OPERATIONS],
 phase1:{runId:HISTORICAL_NATIVE.phase1Run,sha:HISTORICAL_NATIVE.phase1Sha,status:'TECHNICAL_PHASE1_PASS'},
 p13:{runId:HISTORICAL_NATIVE.wireRun,sha:HISTORICAL_NATIVE.wireSha,status:'P13_NATIVE_TECHNICAL_PASS'},
 provisionerRetired:true,noActiveProvisionerSessions:true,
 oneUseLedgerProtected:true,denyOnUnknownCommit:true,
 guestSend:false,productionAccess:false,realData:false,phase2Authorization:false
});
const checkBlocked=p=>{
 const v=inspectCustodianPlan(p,SHA,NOW);
 assert.equal(v.status,'HOLD');
 assert.equal(v.canIssueReceipt,false);
 assert.equal(v.canSend,false);
};
test('a complete self-reported plan remains non-authorizing',()=>{
 const v=inspectCustodianPlan(plan(),SHA,NOW);
 assert.equal(v.status,'CANDIDATE_SHAPE_ONLY');
 assert.equal(v.phase2,'BLOCK');
 assert.equal(v.authorized,false);
 assert.equal(v.canIssueReceipt,false);
 assert.equal(authorizePhase2(plan()).status,'BLOCK');
});
test('untrusted, missing and different-SHA observations fail closed',()=>{
 for(const p of [null,undefined,{},[],false])checkBlocked(p);
 const p=plan();p.sourceSha='f'.repeat(40);checkBlocked(p);
 assert.equal(inspectCustodianPlan(plan(),'f'.repeat(40),NOW).status,'HOLD');
});
test('expired and broad windows fail closed',()=>{
 for(const edit of [
  p=>p.notBeforeMs=NOW+1,p=>p.expiresMs=NOW,p=>p.expiresMs=NOW+3600000
 ]){const p=plan();edit(p);checkBlocked(p);}
});
test('separate owner, agent, custodian identity is required',()=>{
 for(const edit of [
  p=>p.agentSid=p.ownerSid,p=>p.custodianSid=p.agentSid,
  p=>p.ownerSid='',p=>p.custodianSid='not-a-sid'
 ]){const p=plan();edit(p);checkBlocked(p);}
});
test('hash, locked source, isolated target and issuer custody are required',()=>{
 const edits=[
  p=>p.binarySha='bad',p=>p.configSha='',p=>p.reviewSha='f'.repeat(40),
  p=>p.target.port=5432,p=>p.target.host='wrong',p=>p.target.syntheticOnly=false,
  p=>p.origin='SOURCE_ONLY',p=>p.agentMayModify=true,
  p=>p.agentMayReadVault=true,p=>p.ownerControlsActivation=false
 ];
 for(const edit of edits){const p=plan();edit(p);checkBlocked(p);}
});
test('fixed operations, old native evidence and retirement are required',()=>{
 const edits=[
  p=>p.fixedOperations.push('unexpected'),p=>p.fixedOperations.pop(),
  p=>p.phase1.runId=1,p=>p.phase1.sha='a'.repeat(40),
  p=>p.p13.status='SOURCE_ONLY',p=>p.p13.sha='b'.repeat(40),
  p=>p.provisionerRetired=false,p=>p.noActiveProvisionerSessions=false,
  p=>p.oneUseLedgerProtected=false,p=>p.denyOnUnknownCommit=false
 ];
 for(const edit of edits){const p=plan();edit(p);checkBlocked(p);}
});
test('live scopes never pass a source-only readiness inspection',()=>{
 for(const edit of [
  p=>p.guestSend=true,p=>p.productionAccess=true,
  p=>p.realData=true,p=>p.phase2Authorization=true
 ]){const p=plan();edit(p);checkBlocked(p);}
});
const rev=()=>({
 beforeEpoch:'1',afterEpoch:'2',beforeActor:sid(1002),afterActor:sid(1002),
 beforeAccount:'synthetic',afterAccount:'synthetic',revoked:true,
 oldSessionAccepted:false,newRequestAccepted:false,canSend:false,
 authoritativePostgresReadback:true,operatorCredentialExposed:false,
 ownerControlledSourceVerified:true
});
test('correctly shaped revocation evidence is still not an authorization',()=>{
 const v=inspectRevocationProof(rev());
 assert.equal(v.status,'REVOCATION_OBSERVATION_ONLY');
 assert.equal(v.phase2,'BLOCK');assert.equal(v.canSend,false);
});
test('stale, forged, or ineffective revocation is denied',()=>{
 const edits=[
  p=>p.afterEpoch='1',p=>p.afterEpoch='0',
  p=>p.afterActor=sid(1003),p=>p.afterAccount='other',
  p=>p.revoked=false,p=>p.oldSessionAccepted=true,
  p=>p.newRequestAccepted=true,p=>p.canSend=true,
  p=>p.authoritativePostgresReadback=false,
  p=>p.operatorCredentialExposed=true,
  p=>p.ownerControlledSourceVerified=false
 ];
 for(const edit of edits){
  const p=rev();edit(p);
  assert.equal(inspectRevocationProof(p).status,'HOLD');
 }
});
test('module cannot grant authorization or mutate host',()=>{
 const src=readFileSync('scripts/acceptance/strigunov-task22-custodian-review.mjs','utf8');
 assert.doesNotMatch(src,/\bimport\s|process\.env|\.query\s*\(|execFileSync|spawn\s*\(|fetch\s*\(/);
 assert.equal(authorizePhase2().canInstall,false);
 const cr=readFileSync('.coderabbit.yaml','utf8');
 assert.match(cr,/enabled: false/);
});
