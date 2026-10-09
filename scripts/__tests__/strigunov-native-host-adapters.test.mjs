import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import p from '../acceptance/strigunov-lab-controller/protocol.ts';
import snapshot from '../acceptance/strigunov-lab-controller/native-windows/snapshot.ts';
import ipc from '../acceptance/strigunov-lab-controller/native-windows/ipc.ts';
import store from '../acceptance/strigunov-lab-controller/protected-store/adapter.ts';
import journal from '../acceptance/strigunov-lab-controller/protected-store/journal-model.ts';
import harness from '../acceptance/strigunov-public-lead-postgres-harness.ts';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const BASE='scripts/acceptance/strigunov-lab-controller/';
const C=x=>p.canonicalizeModelJson(JSON.stringify(x)), H=n=>n.toString(16).padStart(64,'0');
const ID=n=>'10000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
function wire(op='CLAIM') {
  return {schemaVersion:'asi.lab.native-request.v1',requestId:ID(1),op,leaseDigest:H(1),nonce:H(2),
    scopeDigest:H(3),journalIdentity:H(4),ownerRootRef:H(5),custodianRootRef:H(6)};
}
function observed() {
  return {schemaVersion:'asi.windows.diagnostic.v1',state:'DIAGNOSTIC_ONLY',reason:'HOST_NOT_PROVISIONED',
    executionAuthorized:false,tokenObserved:true,identityStable:true,pid:101,parentPid:100,sessionId:1,
    userSid:'S-1-5-21-1',integritySid:'S-1-16-12288',authenticationId:'1234',elevated:true,
    startFileTime:'134000000000000000',uptimeMilliseconds:'123456',bootIdentityStatus:'UNAVAILABLE',
    bootTimeFileTime:'133999999000000000',bootTimeStable:true,matchingServiceCount:0,
    serviceStatus:'NOT_INSTALLED',pipeStatus:'NOT_INSTALLED',
    executable:{status:'DIAGNOSTIC_ONLY',reason:'EFFECTIVE_ACCESS_UNPROVEN',handlesObserved:5,
      fileId:'a'.repeat(24),pathDigest:H(1),executableSha256:H(2),aclDigest:H(3),
      identitiesStable:true,conservativeAclSafe:true,effectiveAccessProven:false,executionAuthorized:false}};
}
function expected(o=observed()) {
  return {...Object.fromEntries(['pid','parentPid','sessionId','userSid','integritySid','authenticationId','startFileTime'].map(k=>[k,o[k]])),
    ...Object.fromEntries(['fileId','pathDigest','executableSha256','aclDigest'].map(k=>[k,o.executable[k]]))};
}
const compare=o=>snapshot.compareSnapshotModel(C(expected()),C(o));
function scope() {
  return {nonce:H(1),envelopeDigest:H(2),hostDigest:H(3),targetDigest:H(4),appSha:'a'.repeat(40),
    sqlSha256:H(5),rootIdentity:H(6),bootDigest:H(7),notBeforeMs:1000,expiresAtMs:100000,
    maxDurationMs:99000,maxQueries:100,maxWrites:100,maxRows:10,scenarios:['rollback'],roles:['service-a']};
}
const E=(op,extra={})=>({op,atMs:1010,elapsedMs:10,bootDigest:H(7),...extra});
function transcript(events=[E('CLAIM')],patch={}) {
  const s={...scope(),...patch},records=[];let previous='0'.repeat(64);
  for(const event of events) {
    const body={sequence:records.length+1,previous,scopeDigest:p.digest(C(s)),event};
    const hash=p.digest(C(body));records.push({...body,hash,ack:hash});previous=hash;
  }
  return {j:{authorityClass:'UNIT_ONLY',scope:s,records},a:{authorityClass:'UNIT_ONLY',scopeDigest:p.digest(C(s)),
    rootIdentity:s.rootIdentity,sequence:records.length,head:previous,nonceConsumed:true,revoked:false,
    recoveryLatched:false,durability:'MODEL_ONLY'}};
}
const inspect=({j,a})=>journal.inspectAnchoredJournalModel(C(j),C(a));
const prefix=()=>[E('CLAIM'),E('START'),E('INTENT',{operationId:ID(2),scenario:'rollback',role:'service-a'})];
const resolved=()=>[...prefix(),E('ROLLBACK_ACK',{operationId:ID(2)}),
  E('EVIDENCE',{operationId:ID(2),scenario:'rollback',observationDigest:H(8)}),E('FINALIZE')];

test('native: consistent snapshot never authenticates a host',()=>{
  const r=compare(observed());assert.equal(r.contentConsistent,true);assert.equal(r.hostAuthenticated,false);
  assert.equal(snapshot.authenticateNativeHost(r).state,'BLOCKED');
});
test('native: SID/user spoof, PID reuse, changed start/session and non-admin caller fail',()=>{
  for(const patch of [{userSid:'S-1-5-18'},{pid:0},{pid:102},{parentPid:99},{sessionId:2},
    {startFileTime:'1'},{authenticationId:'999'},{elevated:false},{USERNAME:'Admin'}])
    assert.equal(compare({...observed(),...patch}).contentConsistent,false);
});
test('native: weak inherited ACL, replace rights, path swap, binary hash and reparse fail',()=>{
  for(const patch of [{conservativeAclSafe:false},{identitiesStable:false},{aclDigest:H(99)},
    {fileId:'b'.repeat(24)},{pathDigest:H(99)},{executableSha256:H(99)},
    {status:'HOST_AUTHN_UNAVAILABLE'},{reason:'REPARSE_REJECTED'},{effectiveAccessProven:true}]) {
    const o=observed();Object.assign(o.executable,patch);assert.equal(compare(o).state,'BLOCKED');
  }
});
test('native: changed boot, unsupported APIs and denied evidence never produce authority',()=>{
  for(const patch of [{bootIdentityStatus:'VERIFIED'},{bootTimeStable:false},{tokenObserved:false},{identityStable:false},
    {reason:'HOST_AUTHN_UNAVAILABLE'},{serviceStatus:'VERIFIED'},{pipeStatus:'VERIFIED'}])
    assert.equal(compare({...observed(),...patch}).state,'BLOCKED');
  assert.equal(compare({...observed(),executionAuthorized:true}).state,'BLOCKED');
});
test('native: actual fixed Windows probe uses OS token; unsigned helper remains diagnostic', {skip:process.platform!=='win32'},t=>{
  const temp=fs.mkdtempSync(path.join(ROOT,'.native-probe-unit-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const compiler='C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  const exe=path.join(temp,'native-diagnostic.exe');
  const env={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',TEMP:temp,TMP:temp,USERNAME:'FORGED_USER',USERDOMAIN:'FORGED_DOMAIN'};
  const build=spawnSync(compiler,['/nologo','/warnaserror','/target:exe','/out:'+exe,
    '/reference:System.Web.Extensions.dll','/reference:System.Management.dll',
    path.join(ROOT,BASE,'native-windows/Observer.cs'),path.join(ROOT,BASE,'native-windows/NativeDiagnostic.cs')],
    {cwd:temp,encoding:'utf8',timeout:45000,maxBuffer:16384,env});
  assert.equal(build.status,0,build.stdout+build.stderr);
  const run=spawnSync(exe,[],
    {cwd:ROOT,encoding:'utf8',timeout:45000,maxBuffer:16384,
      env});
  assert.equal(run.status,2,run.stderr);const o=JSON.parse(run.stdout.replace(/^\uFEFF/,'').trim());
  assert.equal(o.schemaVersion,'asi.windows.diagnostic.v1',run.stdout);
  assert.equal(o.tokenObserved,true);assert.match(o.userSid,/^S-1-/);assert.match(o.integritySid,/^S-1-16-/);
  assert.notEqual(o.userSid,'FORGED_USER');assert.equal(o.identityStable,true);
  assert.ok(o.pid>0 && o.parentPid>0);assert.match(o.startFileTime,/^[0-9]+$/);
  assert.equal(o.executionAuthorized,false);assert.equal(o.pipeStatus,'NOT_INSTALLED');
  assert.equal(o.bootTimeStable,true);assert.match(o.bootTimeFileTime,/^[0-9]+$/);
  fs.mkdirSync(path.join(temp,'actual'));fs.writeFileSync(path.join(temp,'actual','sample.txt'),'unit fixture',{flag:'wx'});
  fs.symlinkSync(path.join(temp,'actual'),path.join(temp,'alias'),'junction');
  const fixture=spawnSync(exe,['--unit-fixtures',temp],{cwd:temp,encoding:'utf8',timeout:10000,maxBuffer:16384,env});
  assert.equal(fixture.status,2,fixture.stderr);const paths=JSON.parse(fixture.stdout);
  assert.equal(paths.executionAuthorized,false);
  for(const k of ['junction','ads','absent']) assert.equal(paths[k].status,'HOST_AUTHN_UNAVAILABLE',k);
  assert.equal(paths.ordinary.executionAuthorized,false);
  // No host-positive assertion: ACL/handle access may be denied on this unprivileged machine.
  assert.ok(['DIAGNOSTIC_ONLY','HOST_AUTHN_UNAVAILABLE'].includes(o.executable.status));
  t.diagnostic(JSON.stringify({nativeTokenObserved:o.tokenObserved,identityStable:o.identityStable,
    handleCount:o.executable.handlesObserved,pathStatus:o.executable.status,pathReason:o.executable.reason,
    effectiveAccessProven:o.executable.effectiveAccessProven,bootIdentity:o.bootIdentityStatus,bootTimeStable:o.bootTimeStable,
    nativeFixture:paths.ordinary.status,nativeJunction:paths.junction.status}));
});
test('native: collector uses held handles, no write APIs or path-only authority',()=>{
  const cs=fs.readFileSync(path.join(ROOT,BASE,'native-windows/Observer.cs'),'utf8');
  for(const api of ['OpenProcessToken','GetTokenInformation','GetSecurityInfo','GetFinalPathNameByHandle',
    'GetFileInformationByHandle','CreateToolhelp32Snapshot','QueryFullProcessImageName','LocalFree'])
    assert.ok(cs.includes(api),api);
  assert.ok(cs.includes('0x02200000u'));assert.ok(cs.includes('info.Links==1'));
  assert.ok(!/SetSecurity|WriteFile|CreateService|AdjustTokenPrivileges|Process.Start|Environment.GetEnvironmentVariable/.test(cs));
});
test('native: pipe JSON and callback/getter injection are ignored across production boundaries',()=>{
  let calls=0;const poison=new Proxy({}, {get(){calls++;throw Error('get');},ownKeys(){calls++;throw Error('keys');}});
  for(const x of [poison,()=>calls++,{approved:true,peer:{pid:process.pid,userSid:'S-1-5-18'},roots:'fake'}]) {
    assert.equal(ipc.handleNativeRequest(x,x).executionAuthorized,false);
    assert.equal(snapshot.authenticatePipePeer(x).reason,'PIPE_AUTHENTICATOR_NOT_INSTALLED');
    for(const fn of [store.claimLease,store.commitIntent,store.requestCleanup,store.requestStop,store.recoverLease])
      assert.equal(fn(x).executionAuthorized,false);
  }
  assert.equal(calls,0);
});
test('native: strict IPC validates references only and rejects clocks, approval, target and raw claims',()=>{
  assert.equal(ipc.validateRequestSyntax(C(wire())).syntaxValid,true);
  for(const patch of [{approved:true},{now:1},{elapsedMs:1},{rows:0},{peer:{pid:1}},
    {target:'localhost'},{databaseUrl:'postgres://fake'},{claims:{}},{op:'VERIFY'},{op:'SCENARIO_DONE'},
    {ownerRootRef:H(6)},{privateKey:'never'},{query:'SELECT 1'}])
    assert.equal(ipc.validateRequestSyntax(C({...wire(),...patch})).syntaxValid,false);
});
test('native: four typed faults require complete run/process/backend identity; never execute',()=>{
  for(const fault of ['commit-ack-loss','restart-replay','utc-boundary','crm-receipt-atomicity']) {
    const r={...wire('REQUEST_FAULT'),fault,runId:ID(2),fixtureNamespace:ID(3),
      ownedPid:123,startDigest:H(7),bootDigest:H(8),executableSha256:H(9),backendPid:321};
    assert.equal(ipc.validateRequestSyntax(C(r)).syntaxValid,true);
    assert.equal(ipc.handleNativeRequest(C(r)).ipcCalls,0);
    for(const patch of [{ownedPid:0},{backendPid:-1},{startDigest:''},{fault:'kill'},
      {executable:'cmd.exe'},{args:['/c']},{sql:'DROP'},{url:'postgres://fake'}])
      assert.equal(ipc.validateRequestSyntax(C({...r,...patch})).syntaxValid,false);
  }
});
test('native: canonical IPC bounds, duplicate fields and accepted replies rejected',()=>{
  const r=C(wire());for(const bad of [r+' ',r.replace('"op":','"op":"START","op":'),' '.repeat(4097),{},'{'])
    assert.equal(ipc.validateRequestSyntax(bad).syntaxValid,false);
  const good=ipc.handleNativeRequest();assert.equal(ipc.validateDeniedResponse(C(good)),true);
  for(const patch of [{state:'ISOLATED_ACCEPTED'},{executionAuthorized:true},{storeWrites:1},{reason:'OK'}])
    assert.equal(ipc.validateDeniedResponse(C({...good,...patch})),false);
});
test('native: protected claim and journal never fall back to test store or acknowledge dispatch',()=>{
  for(const fn of [store.claimLease,store.commitIntent,store.requestCleanup,store.requestStop]) {
    const r=fn({UNIT_ONLY:true,anchor:'fake',lease:'signed',approved:true});
    assert.equal(r.state,'BLOCKED');assert.equal(r.durableAck,false);assert.equal(r.storeWrites,0);
  }
  assert.equal(store.recoverLease().state,'RECOVERY_REQUIRED');
});
test('native: anchored unit journal retains claim and duplicate nonce is rejected',()=>{
  assert.equal(inspect(transcript()).phase,'CLAIMED');
  assert.equal(inspect(transcript([E('CLAIM'),E('CLAIM')])).state,'RECOVERY_REQUIRED');
  assert.equal(store.claimLease(inspect(transcript())).leaseClaimed,false);
});
test('native: coordinated journal AND ACK suffix rollback fails against independent anchor',()=>{
  const t=transcript([E('CLAIM'),E('START')]);t.j.records.pop();
  assert.equal(inspect(t).state,'RECOVERY_REQUIRED');
  const r=transcript();r.a.rootIdentity=H(90);assert.equal(inspect(r).state,'RECOVERY_REQUIRED');
  r.a.rootIdentity=r.j.scope.rootIdentity;r.a.head=H(90);assert.equal(inspect(r).state,'RECOVERY_REQUIRED');
});
test('native: crash/partial append, missing ACK and durable head ambiguity fail closed',()=>{
  for(const mode of ['ack','head','sequence','partial','latch','power']) {
    const t=transcript();
    if(mode==='ack') t.j.records[0].ack=H(99);
    if(mode==='head') t.a.head=H(99);
    if(mode==='sequence') t.a.sequence++;
    if(mode==='latch') t.a.recoveryLatched=true;
    if(mode==='power') t.a.durability='UNKNOWN';
    const r=mode==='partial'?journal.inspectAnchoredJournalModel(C(t.j).slice(0,-1),C(t.a)):inspect(t);
    assert.equal(r.state,'RECOVERY_REQUIRED',mode);
  }
});
test('native: reversed time, expiry, boot change and persistent revoke never reset nonce',()=>{
  for(const patch of [{atMs:999},{elapsedMs:0},{atMs:100000,elapsedMs:99000},{bootDigest:H(99)}])
    assert.equal(inspect(transcript([E('CLAIM'),E('START',patch)])).state,'RECOVERY_REQUIRED');
  const r=transcript();r.a.revoked=true;assert.equal(inspect(r).state,'RECOVERY_REQUIRED');
  assert.equal(inspect(transcript([E('CLAIM'),E('REVOKE')])).state,'RECOVERY_REQUIRED');
});
test('native: reviewer P1 zero-operation and caller-only scenario completion cannot succeed',()=>{
  for(const events of [[E('CLAIM'),E('START'),E('FINALIZE')],
    [E('CLAIM'),E('START'),E('EVIDENCE',{operationId:ID(2),scenario:'rollback',observationDigest:H(8)})],
    [E('CLAIM'),E('START'),E('SCENARIO_DONE',{scenario:'rollback'})]])
    assert.equal(inspect(transcript(events)).state,'RECOVERY_REQUIRED');
  const r=inspect(transcript(resolved()));assert.equal(r.phase,'EVIDENCE_REVIEW_REQUIRED');
  assert.equal(r.realEvidenceAccepted,false);assert.equal(r.executionAuthorized,false);
});
test('native: reviewer P1 zero-row and client budget assertions rejected; reservations conservative',()=>{
  const events=prefix();events[2].rows=0;assert.equal(inspect(transcript(events)).state,'RECOVERY_REQUIRED');
  assert.equal(inspect(transcript(resolved(),{maxRows:0})).state,'RECOVERY_REQUIRED');
  assert.equal(inspect(transcript(resolved(),{maxQueries:3})).state,'RECOVERY_REQUIRED');
  const r=inspect(transcript(resolved()));assert.equal(r.rows,1);assert.equal(r.queries,4);assert.equal(r.writes,2);
});
test('native: unknown commit cannot rollback, cleanup or retry',()=>{
  const x=[...prefix(),E('IDENTIFIED',{operationId:ID(2),crmId:ID(3),consentDigest:H(8)}),
    E('COMMIT_UNKNOWN',{operationId:ID(2)})];
  for(const end of [[],[E('ROLLBACK_ACK',{operationId:ID(2)})],
    [E('CLEANUP_INTENT',{crmId:ID(3),consentDigest:H(8)})]])
    assert.equal(inspect(transcript([...x,...end])).state,'RECOVERY_REQUIRED');
});
test('native: STOP blocks new work and exact consent/UUID cleanup disputes require recovery',()=>{
  assert.equal(inspect(transcript([...prefix().slice(0,2),E('STOP'),prefix()[2]])).state,'RECOVERY_REQUIRED');
  const x=[...prefix(),E('IDENTIFIED',{operationId:ID(2),crmId:ID(3),consentDigest:H(8)}),
    E('COMMIT_UNKNOWN',{operationId:ID(2)}),E('COMMIT_ACK',{operationId:ID(2)})];
  for(const fields of [{crmId:ID(99),consentDigest:H(8)},{crmId:ID(3),consentDigest:H(99)}])
    assert.equal(inspect(transcript([...x,E('CLEANUP_INTENT',fields)])).state,'RECOVERY_REQUIRED');
  const cleanup=E('CLEANUP_INTENT',{crmId:ID(3),consentDigest:H(8)});
  const bad=E('CLEANUP_ACK',{crmId:ID(3),consentDigest:H(8),deleted:0,remaining:1});
  assert.equal(inspect(transcript([...x,cleanup,bad,{...bad,deleted:1,remaining:0}])).state,'RECOVERY_REQUIRED');
});
test('native: independent model keys and fake target cannot unlock parent runner',async()=>{
  const r=await harness.requestExecution({approved:true,target:'localhost',roots:{owner:'fake',custodian:'fake'},
    now:1,UNIT_ONLY:true,host:snapshot.authenticateNativeHost(),connection:'postgres://fake'});
  assert.equal(r.reason,'TRUSTED_HOST_NOT_INSTALLED');assert.equal(r.postgresCalls,0);
});
test('native: fresh import and poisoned CLI canaries show zero network, pg, store and workers',()=>{
  const code=String.raw`
    import net from 'node:net';import tls from 'node:tls';import cp from 'node:child_process';import fs from 'node:fs';
    import {createRequire} from 'node:module';
    let calls=0;const no=()=>{calls++;throw Error('SIDE_EFFECT');};
    net.Socket.prototype.connect=no;tls.connect=no;cp.spawn=no;cp.exec=no;cp.execFile=no;
    const b='./scripts/acceptance/strigunov-lab-controller/';
    const i=(await import(b+'native-windows/ipc.ts')).default;
    const s=(await import(b+'protected-store/adapter.ts')).default;
    const h=(await import('./scripts/acceptance/strigunov-public-lead-postgres-harness.ts')).default;
    fs.writeFileSync=no;fs.openSync=no;fs.mkdirSync=no;fs.readFileSync=no;
    i.handleNativeRequest({approved:true});s.claimLease({roots:'fake'});s.commitIntent();s.requestStop();s.recoverLease();
    await h.requestExecution({approved:true});
    if(calls||Object.keys(createRequire(import.meta.url).cache).some(p=>/[\\/]node_modules[\\/]pg[\\/]/.test(p)))process.exit(9);
  `;
  const r=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:ROOT,encoding:'utf8',timeout:10000,env:{}});
  assert.equal(r.status,0,r.stderr);
  const cli=spawnSync(process.execPath,['--import','tsx',path.join(ROOT,BASE,'native-windows/ipc.ts'),
    '--execute','--approved','--url=postgres://fake'],{cwd:ROOT,encoding:'utf8',timeout:10000,
      env:{DATABASE_URL:'postgres://fake',ALLOW_EXECUTION:'true',USERNAME:'SYSTEM'}});
  assert.equal(cli.status,2,cli.stderr);assert.equal(ipc.validateDeniedResponse(C(JSON.parse(cli.stdout))),true);
  assert.ok(!cli.stdout.includes('postgres://'));
});
test('native: production modules have no injectable factory or model/store/DB/process bridge',()=>{
  for(const name of ['native-windows/ipc.ts','native-windows/snapshot.ts','protected-store/adapter.ts']) {
    const text=fs.readFileSync(path.join(ROOT,BASE,name),'utf8');
    assert.ok(!/from\s+['"](?:pg|node:(?:fs|net|tls|http|https|child_process))/.test(text));
    assert.ok(!/process.env|from.*unit-file-store|generateKeyPair|createPrivateKey|setAdapter|registerHost/.test(text));
  }
  const parent=fs.readFileSync(path.join(ROOT,'scripts/acceptance/strigunov-public-lead-postgres-harness.ts'),'utf8');
  assert.ok(parent.includes("throw new Error('TRUSTED_HOST_NOT_INSTALLED')"));
});
