import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import protocol from '../acceptance/strigunov-lab-controller/protocol.ts';
import store from '../acceptance/strigunov-lab-controller/unit-file-store.ts';
import adapters from '../acceptance/strigunov-lab-controller/adapters.ts';
import service from '../acceptance/strigunov-lab-controller/controller-service.ts';
import cli from '../acceptance/strigunov-lab-controller/cli.ts';
import parent from '../acceptance/strigunov-public-lead-postgres-contract.ts';
const { canonicalizeModelJson: canonical, verifyEnvelopeModel, verifyReceiptModel, digest, MODEL_DOMAIN } = protocol;
const C = value => canonical(JSON.stringify(value));
const NOW = Date.now(), H = n => n.toString(16).padStart(64, '0');
const ID = n => '10000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = '../acceptance/strigunov-lab-controller/';
const MODULE = './scripts/acceptance/strigunov-lab-controller/unit-file-store.ts';
// Private keys exist only in this test process. No production authority/persistent key files.
const pairs = ['owner','custodian'].map(() => generateKeyPairSync('ed25519'));
const roots = pairs.map((pair, i) => {
  const der = pair.publicKey.export({ type: 'spki', format: 'der' });
  return { role: i ? 'custodian' : 'owner', principalId: i ? 'unit-custodian' : 'unit-owner',
    publicKeyDer: der.toString('base64url'), keyId: createHash('sha256').update(der).digest('hex') };
});
const rootsText = C({ authorityClass: 'UNIT_ONLY', keys: roots });
function claims() {
  return { schemaVersion: 'asi.lab.capability.v1', authorityClass: 'UNIT_ONLY', repo: 'ASI-integration/asi-landing',
    harnessSha: protocol.PARENT_SHA, appSha: parent.PINS.parentSha, migrationSha256: parent.PINS.migrationSha256,
    policySourceSha256: parent.PINS.policySourceSha256, policyContentSha256: H(1), policyVersion: parent.PINS.policyVersion,
    ownerPrincipal: 'unit-owner', custodianPrincipal: 'unit-custodian', ownerArtifactDigest: H(2), custodianArtifactDigest: H(3),
    nonce: H(4), runId: ID(1), fixtureNamespace: ID(2), scenarios: ['rollback'], roles: ['observer','service-a','service-b'],
    issuedAtMs: NOW, notBeforeMs: NOW, expiresAtMs: NOW + 300000, maxDurationMs: 300000,
    maxQueries: 100, maxWrites: 100, maxRows: 10, cleanupMaxRows: 10, cleanupMode: 'EXACT_JOURNALED_UUIDS',
    targetAlias: 'unit-lab', targetClass: 'DISPOSABLE_ISOLATED', machineDigest: H(5),
    clusterSystemId: '1234567890123456789', databaseOid: 16384, databaseNameDigest: H(6),
    serverBootDigest: H(7), containerDigest: H(8), networkNamespaceDigest: H(9), endpointDigest: H(10),
    schemaSha256: H(11), schemaVersionId: 'admission-v1', serviceSid: 'S-1-5-80-100',
    serviceAccountSid: 'S-1-5-80-200', hostBootDigest: H(12), processStartDigest: H(13),
    executablePathDigest: H(14), executableSha256: H(15), ancestorAclDigest: H(16), pipePeerDigest: H(17),
    egressPolicyDigest: H(18), pristine: true, exclusive: true, noSend: true, noEgress: true,
    noProduction: true, noStaging: true, noMigrations: true };
}
function signatures(payload, domain = MODEL_DOMAIN) {
  return roots.map((r, i) => ({ role: r.role, principalId: r.principalId, keyId: r.keyId, algorithm: 'Ed25519',
    signature: sign(null, Buffer.from(domain + C(payload)), pairs[i].privateKey).toString('base64url') }));
}
const envelope = (c = claims()) => C({ claims: c, signatures: signatures(c) });
const verify = (text, rootText = rootsText, now = NOW) => verifyEnvelopeModel(text, rootText, now);
const event = (op, extra = {}, tick = 10) => C({ op, atMs: NOW + tick, elapsedMs: tick, bootDigest: H(12), ...extra });
function fixture(t, c = claims()) {
  const created = store.createUnitStore(ROOT, C(c), NOW);
  t.after(() => fs.rmSync(created.directory, { recursive: true, force: true }));
  return created.directory;
}
function start(dir) {
  assert.equal(store.applyUnitTransition(dir, event('CLAIM')).leasePhase, 'CLAIMED');
  assert.equal(store.applyUnitTransition(dir, event('START')).leasePhase, 'RUNNING');
}
function intent(dir) {
  return store.applyUnitTransition(dir, event('INTENT', { operationId: ID(10), scenario: 'rollback',
    role: 'service-a', queries: 1, writes: 1, rows: 1 }));
}
function child(code, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--import','tsx','--input-type=module','-e',code, ...args],
      { cwd: ROOT, shell: false, stdio: ['ignore','pipe','pipe'] });
    let out = '', err = ''; const timer = setTimeout(() => { p.kill(); reject(Error('owned test child timeout')); }, 10000);
    p.stdout.on('data', x => { out += x; }); p.stderr.on('data', x => { err += x; });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err, pid: p.pid }); });
  });
}
test('dual independent Ed25519 verification is a UNIT_ONLY model, never authority', () => {
  const result = verify(envelope()); assert.equal(result.state, 'UNIT_ONLY');
  assert.equal(result.modelValid, true); assert.equal(result.executionAuthorized, false);
  assert.equal(adapters.verifyOwnerAuthorization(result).reason, 'ISSUER_NOT_PROVISIONED');
});
test('invalid signature, unknown alternate key, wrong algorithm and key pin all fail', () => {
  const e = JSON.parse(envelope());
  for (const patch of [{ signature: 'a'.repeat(86) }, { algorithm: 'HS256' }, { keyId: H(90) },
    { principalId: 'unknown-owner' }]) {
    const bad = structuredClone(e); Object.assign(bad.signatures[0], patch); assert.equal(verify(C(bad)).state, 'BLOCKED');
  }
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' });
  const badRoots = structuredClone(roots); badRoots[0].publicKeyDer = other.toString('base64url');
  badRoots[0].keyId = createHash('sha256').update(other).digest('hex');
  assert.equal(verify(envelope(), C({ authorityClass: 'UNIT_ONLY', keys: badRoots })).state, 'BLOCKED');
});
test('missing custodian, same identity and same public key cannot satisfy two principals', () => {
  const e = JSON.parse(envelope()); e.signatures.pop(); assert.equal(verify(C(e)).state, 'BLOCKED');
  const c = claims(); c.custodianPrincipal = c.ownerPrincipal; assert.equal(verify(envelope(c)).state, 'BLOCKED');
  const bad = structuredClone(roots); bad[1].keyId = bad[0].keyId; bad[1].publicKeyDer = bad[0].publicKeyDer;
  assert.equal(verify(envelope(), C({ authorityClass: 'UNIT_ONLY', keys: bad })).state, 'BLOCKED');
});
test('canonical exact bytes reject duplicate keys, whitespace, alternate numbers, escapes and oversized input', () => {
  const raw = envelope();
  for (const value of [raw + ' ', raw.replace('"claims":', '"claims":{},"claims":'),
    raw.replace('"databaseOid":16384', '"databaseOid":16384.0'),
    raw.replace('"unit-owner"', '"unit-\\u006fwner"'), raw.replace('"maxRows":10', '"maxRows":1e1'),
    ' '.repeat(32769), '{']) assert.equal(verify(value).state, 'BLOCKED');
});
test('signatures bind every claim, exact parent/migration/policy pins and limits', () => {
  const original = JSON.parse(envelope());
  for (const patch of [{ nonce: H(99) }, { appSha: '0'.repeat(40) }, { harnessSha: '0'.repeat(40) },
    { migrationSha256: H(99) }, { policyContentSha256: H(99) }, { endpointDigest: H(99) },
    { maxWrites: 101 }, { fixtureNamespace: ID(99) }]) {
    const e = structuredClone(original); Object.assign(e.claims, patch); assert.equal(verify(C(e)).state, 'BLOCKED');
  }
  for (const patch of [{ appSha: '0'.repeat(40) }, { migrationSha256: H(99) }, { noSend: false },
    { scenarios: ['*'] }, { roles: ['superuser'] }, { maxRows: 1001 }, { unknown: true },
    { scenarios: ['rollback','rollback'] }]) assert.equal(verify(envelope({ ...claims(), ...patch })).state, 'BLOCKED');
});
test('stale/future/not-yet-valid/expired authorization is blocked', () => {
  assert.equal(verify(envelope(), rootsText, NOW - 1).state, 'BLOCKED');
  assert.equal(verify(envelope(), rootsText, NOW + 300000).state, 'BLOCKED');
  const c = claims(); c.notBeforeMs += 100; c.maxDurationMs -= 100;
  assert.equal(verify(envelope(c)).state, 'BLOCKED');
});
test('objects, callbacks, getters and proxies are never consumed by untrusted entry points', () => {
  let invoked = 0;
  const poison = new Proxy({}, { get() { invoked++; throw Error('get'); }, ownKeys() { invoked++; throw Error('keys'); } });
  const getter = {}; Object.defineProperty(getter, 'approved', { get() { invoked++; return true; } });
  for (const input of [poison, getter, () => invoked++]) {
    assert.equal(verify(input).state, 'BLOCKED');
    assert.equal(service.handleUntrustedRequest(input).state, 'BLOCKED');
    assert.equal(cli.planControllerRequest(input).verdict, 'BLOCK');
    for (const fn of [adapters.verifyOwnerAuthorization, adapters.attestNativeHost, adapters.attestLabTarget,
      adapters.claimProtectedLease, adapters.controlOwnedFault, adapters.issueAuthenticatedReceipt]) {
      const r = fn(input); assert.equal(r.state, 'BLOCKED'); assert.equal(r.sqlCalls + r.databaseCalls + r.realMessageCalls, 0);
    }
  }
  assert.equal(invoked, 0);
});
function hostObservation(c) {
  const fields = ['serviceSid','serviceAccountSid','hostBootDigest','processStartDigest','executablePathDigest',
    'executableSha256','ancestorAclDigest','pipePeerDigest'];
  return { authorityClass: 'UNIT_ONLY', ...Object.fromEntries(fields.map(k => [k,c[k]])),
    tokenVerified: true, immutableBinary: true, ancestorsProtected: true, replaceRightsDenied: true,
    reparseDenied: true, pipePeerTokenVerified: true, serviceConfigProtected: true };
}
test('host observation model rejects weak ACL/reparse/replace rights and wrong SID/start/boot/binary', () => {
  const c = claims(), p = hostObservation(c);
  assert.equal(adapters.compareHostObservationModel(C(c), C(p)).hostAuthenticated, false);
  for (const [key,value] of Object.entries(p).filter(([k]) => k !== 'authorityClass')) {
    const bad = { ...p, [key]: typeof value === 'boolean' ? false : key.includes('Sid') ? 'S-1-5-99' : H(99) };
    assert.equal(adapters.compareHostObservationModel(C(c), C(bad)).state, 'BLOCKED', key);
  }
  assert.equal(adapters.attestNativeHost(C(p)).reason, 'HOST_AUTHENTICATOR_NOT_INSTALLED');
});
function targetObservation(c) {
  const fields = ['targetAlias','machineDigest','clusterSystemId','databaseOid','databaseNameDigest',
    'serverBootDigest','containerDigest','networkNamespaceDigest','endpointDigest','schemaSha256','schemaVersionId',
    'migrationSha256','egressPolicyDigest'];
  const flags = ['exclusive','pristine','actualPrivilegesVerified','forcedRlsVerified','physicalEgressDenied',
    'providerPathsDenied','productionDenied','stagingDenied','allAddressesNonPublic','dnsRebindDenied','proxyDenied',
    'tunnelDenied','protectedAllowlistMatched'];
  return { authorityClass: 'UNIT_ONLY', ...Object.fromEntries(fields.map(k => [k,c[k]])),
    ...Object.fromEntries(flags.map(k => [k,true])) };
}
test('target mismatch/public address/rebind/proxy/missing egress proof all fail without probing', () => {
  const c = claims(), p = targetObservation(c);
  assert.equal(adapters.compareTargetObservationModel(C(c), C(p)).targetAuthenticated, false);
  for (const [key,value] of Object.entries(p).filter(([k]) => k !== 'authorityClass')) {
    const bad = { ...p, [key]: typeof value === 'boolean' ? false : typeof value === 'number' ? value + 1 : 'wrong' };
    assert.equal(adapters.compareTargetObservationModel(C(c), C(bad)).state, 'BLOCKED', key);
  }
  assert.equal(adapters.attestLabTarget({ localhost: true, dockerId: 'fake' }).reason, 'TARGET_NOT_VERIFIED');
});
test('single-use nonce claim persists and cannot replay after reload', t => {
  const dir = fixture(t);
  assert.equal(store.applyUnitTransition(dir, event('CLAIM')).leasePhase, 'CLAIMED');
  assert.equal(store.inspectUnitStore(dir).lease.phase, 'CLAIMED');
  assert.equal(store.applyUnitTransition(dir, event('CLAIM')).state, 'BLOCKED');
});
test('two actual OS processes contend for one durable claim: exactly one wins', async t => {
  const dir = fixture(t), code = "import m from '" + MODULE + "';console.log(JSON.stringify(m.applyUnitTransition(process.argv[1],process.argv[2])));";
  const results = await Promise.all([child(code,[dir,event('CLAIM')]), child(code,[dir,event('CLAIM')])]);
  assert.notEqual(results[0].pid, results[1].pid);
  for (const r of results) assert.equal(r.code, 0, r.err);
  assert.equal(results.map(r => JSON.parse(r.out)).filter(r => r.leasePhase === 'CLAIMED').length, 1);
  assert.equal(store.inspectUnitStore(dir).lease.phase, 'CLAIMED');
});
test('lost caller ACK after fsync does not permit owner approval replay in a restarted process', async t => {
  const dir = fixture(t);
  const r = await child("import m from '" + MODULE + "';m.applyUnitTransition(process.argv[1],process.argv[2]);process.exit(19);", [dir,event('CLAIM')]);
  assert.equal(r.code, 19); assert.equal(store.inspectUnitStore(dir).lease.phase, 'CLAIMED');
  assert.equal(store.applyUnitTransition(dir, event('CLAIM')).state, 'BLOCKED');
});
test('crashed process leaves lock and partial journal: never steal or reset it', async t => {
  const dir = fixture(t);
  const r = await child("import fs from 'node:fs';import path from 'node:path';fs.mkdirSync(path.join(process.argv[1],'lease.lock'));const f=fs.openSync(path.join(process.argv[1],'journal.jsonl'),'a');fs.writeSync(f,'PARTIAL');fs.fsyncSync(f);process.exit(20);", [dir]);
  assert.equal(r.code, 20); assert.equal(store.inspectUnitStore(dir).state, 'RECOVERY_REQUIRED');
  assert.equal(store.applyUnitTransition(dir, event('CLAIM')).state, 'RECOVERY_REQUIRED');
  assert.ok(fs.existsSync(path.join(dir,'lease.lock')));
});
test('journal partial write, corruption, missing ACK and truncated complete record are detected', t => {
  for (const mode of ['partial','corrupt','ack','truncate']) {
    const dir = fixture(t); store.applyUnitTransition(dir, event('CLAIM'));
    const journal = path.join(dir,'journal.jsonl'), text = fs.readFileSync(journal,'utf8');
    if (mode === 'partial') fs.appendFileSync(journal, '{"partial":');
    if (mode === 'corrupt') fs.writeFileSync(journal, text.replace('UNIT_ONLY','UNIT_FAIL'));
    if (mode === 'ack') fs.unlinkSync(path.join(dir,'acks','00000002.ack'));
    if (mode === 'truncate') fs.writeFileSync(journal, text.slice(0,text.lastIndexOf('\n',text.length-2)+1));
    assert.equal(store.inspectUnitStore(dir).state, 'RECOVERY_REQUIRED', mode);
  }
});
test('directory junction/symlink and replacement identity fail closed', t => {
  const dir = fixture(t), alias = path.join(ROOT,'.strigunov-lab-unit-alias-' + process.pid);
  fs.symlinkSync(dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.equal(store.inspectUnitStore(alias).state, 'RECOVERY_REQUIRED'); } finally { fs.unlinkSync(alias); }
  const other = fixture(t);
  fs.copyFileSync(path.join(dir,'unit-only.json'),path.join(other,'unit-only.json'));
  assert.equal(store.inspectUnitStore(other).state, 'RECOVERY_REQUIRED');
});
test('expired or revoked lease is never reset to ISSUED', t => {
  const dir = fixture(t); start(dir);
  assert.equal(store.applyUnitTransition(dir,event('START',{},300001)).leasePhase,'BLOCKED');
  assert.equal(store.applyUnitTransition(dir,event('CLAIM')).state,'BLOCKED');
  const other = fixture(t); start(other);
  assert.equal(store.applyUnitTransition(other,event('REVOKE')).leasePhase,'BLOCKED');
  assert.equal(store.applyUnitTransition(other,event('CLAIM')).state,'BLOCKED');
});
test('clock reversal or changed boot after claim requires recovery', t => {
  for (const patch of [{ atMs: NOW - 1 }, { elapsedMs: 0 }, { bootDigest: H(99) }]) {
    const dir = fixture(t); start(dir);
    assert.equal(store.applyUnitTransition(dir,event('START',patch)).leasePhase,'RECOVERY_REQUIRED');
  }
});
test('scenario, role, row/query/write and duration budgets are checked before INTENT', t => {
  const base = { operationId: ID(10), scenario: 'rollback', role: 'service-a', queries: 1, writes: 1, rows: 1 };
  for (const patch of [{ scenario: 'same-rc' }, { role: 'anon' }, { queries: 101 }, { writes: 101 }, { rows: 2 }]) {
    const dir = fixture(t); start(dir);
    assert.equal(store.applyUnitTransition(dir,event('INTENT',{ ...base,...patch })).state,'BLOCKED');
    assert.equal(store.inspectUnitStore(dir).lease.operations.length,0);
  }
});
test('cleanup count discrepancy is latched as recovery, not corrected by a later fake ACK', t => {
  const dir=fixture(t);start(dir);intent(dir);
  for(const [op,fields] of [['IDENTIFIED',{operationId:ID(10),crmId:ID(11),receiptDigest:H(50)}],
    ['COMMIT_UNKNOWN',{operationId:ID(10)}],['COMMIT_ACK',{operationId:ID(10)}],['FINALIZE',{}],
    ['CLEANUP_INTENT',{crmIds:[ID(11)]}]]) store.applyUnitTransition(dir,event(op,fields));
  assert.equal(store.applyUnitTransition(dir,event('CLEANUP_ACK',{crmIds:[ID(11)],deleted:0,remaining:1})).leasePhase,'RECOVERY_REQUIRED');
  assert.equal(store.applyUnitTransition(dir,event('CLEANUP_ACK',{crmIds:[ID(11)],deleted:1,remaining:0})).state,'BLOCKED');
});
test('duration and cumulative budgets remain consumed across individual operations', t => {
  const short=fixture(t,{...claims(),maxDurationMs:20});start(short);
  assert.equal(store.applyUnitTransition(short,event('INTENT',{operationId:ID(10),scenario:'rollback',role:'service-a',queries:1,writes:1,rows:1},100)).leasePhase,'BLOCKED');
  const one=fixture(t,{...claims(),maxQueries:1,maxRows:1,cleanupMaxRows:1});start(one);intent(one);
  assert.equal(store.applyUnitTransition(one,event('INTENT',{operationId:ID(12),scenario:'rollback',role:'service-a',queries:1,writes:1,rows:1})).state,'BLOCKED');
  assert.equal(store.inspectUnitStore(one).lease.operations.length,1);
});
test('INTENT precedes identification/commit and is durable across fresh reads', t => {
  const dir = fixture(t); start(dir);
  assert.equal(store.applyUnitTransition(dir,event('IDENTIFIED',{ operationId: ID(10),crmId: ID(11),receiptDigest:H(50) })).state,'BLOCKED');
  assert.equal(intent(dir).leasePhase,'RUNNING');
  assert.equal(store.inspectUnitStore(dir).lease.operations[0].phase,'INTENT');
});
test('COMMIT_UNKNOWN without owned UUID or unknown outcome refuses cleanup', t => {
  for (const op of ['COMMIT_UNKNOWN','UNKNOWN']) {
    const dir = fixture(t); start(dir); intent(dir);
    assert.equal(store.applyUnitTransition(dir,event(op,{operationId:ID(10)})).leasePhase,'RECOVERY_REQUIRED');
    assert.equal(store.applyUnitTransition(dir,event('CLEANUP_INTENT',{crmIds:[ID(11)]})).state,'BLOCKED');
  }
});
test('two-stage STOP prohibits new work; unresolved drain requires recovery', t => {
  const dir = fixture(t); start(dir); intent(dir);
  assert.equal(store.applyUnitTransition(dir,event('STOP')).leasePhase,'STOPPING');
  assert.equal(intent(dir).state,'BLOCKED');
  assert.equal(store.applyUnitTransition(dir,event('DRAIN')).leasePhase,'RECOVERY_REQUIRED');
  const empty = fixture(t); start(empty);
  assert.equal(store.applyUnitTransition(empty,event('STOP')).leasePhase,'STOPPING');
  assert.equal(store.applyUnitTransition(empty,event('DRAIN')).leasePhase,'FINALIZING');
});
test('exact cleanup counts and IDs gate VERIFIED, which remains UNIT_ONLY', t => {
  const dir = fixture(t); start(dir); intent(dir);
  for (const [op,fields] of [
    ['IDENTIFIED',{operationId:ID(10),crmId:ID(11),receiptDigest:H(50)}],
    ['COMMIT_UNKNOWN',{operationId:ID(10)}],['COMMIT_ACK',{operationId:ID(10)}],
    ['SCENARIO_DONE',{scenario:'rollback'}],['FINALIZE',{}]]) assert.equal(store.applyUnitTransition(dir,event(op,fields)).state,'UNIT_ONLY');
  assert.equal(store.applyUnitTransition(dir,event('VERIFY')).state,'BLOCKED');
  assert.equal(store.applyUnitTransition(dir,event('CLEANUP_INTENT',{crmIds:[ID(99)]})).state,'BLOCKED');
  assert.equal(store.applyUnitTransition(dir,event('CLEANUP_INTENT',{crmIds:[ID(11)]})).state,'UNIT_ONLY');
  assert.equal(store.applyUnitTransition(dir,event('CLEANUP_ACK',{crmIds:[ID(11)],deleted:1,remaining:0})).state,'UNIT_ONLY');
  const r = store.applyUnitTransition(dir,event('VERIFY'));
  assert.equal(r.leasePhase,'VERIFIED'); assert.equal(r.executionAuthorized,false);
  assert.equal(adapters.issueAuthenticatedReceipt(r).state,'BLOCKED');
});
test('rollback resolves only pre-commit intent, never a lost commit', t => {
  const dir = fixture(t); start(dir); intent(dir);
  store.applyUnitTransition(dir,event('IDENTIFIED',{operationId:ID(10),crmId:ID(11),receiptDigest:H(50)}));
  store.applyUnitTransition(dir,event('COMMIT_UNKNOWN',{operationId:ID(10)}));
  assert.equal(store.applyUnitTransition(dir,event('ROLLBACK_ACK',{operationId:ID(10)})).leasePhase,'RECOVERY_REQUIRED');
});
function receipt(c) {
  return { schemaVersion:'asi.lab.receipt.v1',authorityClass:'UNIT_ONLY',state:'UNIT_ONLY',
    ownerPrincipal:c.ownerPrincipal,custodianPrincipal:c.custodianPrincipal,claimsDigest:digest(C(c)),
    nonce:c.nonce,runId:c.runId,appSha:c.appSha,migrationSha256:c.migrationSha256,targetDigest:digest(C(c)),
    policySourceSha256:c.policySourceSha256,policyContentSha256:c.policyContentSha256,policyVersion:c.policyVersion,
    noSendDigest:c.egressPolicyDigest,journalHead:H(51),startedAtMs:NOW,finishedAtMs:NOW,queryCount:2,writeCount:2,scenarios:c.scenarios,
    workers:[{pid:100,startDigest:H(52),bootDigest:c.hostBootDigest},{pid:101,startDigest:H(53),bootDigest:c.hostBootDigest}],
    backendPids:[200,201],fixtures:[{crmId:ID(11),submissionDigest:H(54),consentDigest:H(55),cleanup:'VERIFIED'}],
    created:1,deleted:1,remaining:0,errorCategories:[] };
}
test('signed receipt MODEL binds provenance, cleanup and pins but cannot mint accepted/production evidence', () => {
  const c=claims(), good=receipt(c);
  const signed=p=>C({receipt:p,signatures:signatures(p,MODEL_DOMAIN+'RECEIPT\n')});
  assert.equal(verifyReceiptModel(signed(good),rootsText,envelope(c),NOW).state,'UNIT_ONLY');
  for(const patch of [{state:'ISOLATED_ACCEPTED'},{state:'PRODUCTION_RECEIPT'},{backendPids:[200,200]},
    {deleted:0},{queryCount:101},{finishedAtMs:NOW+300001},{appSha:'0'.repeat(40)},{nonce:H(99)},{errorCategories:['postgres://secret']},
    {workers:[good.workers[0],good.workers[0]]},{noSendDigest:H(99)}]) {
    assert.equal(verifyReceiptModel(signed({...good,...patch}),rootsText,envelope(c),NOW).state,'BLOCKED');
  }
});
test('controller and CLI stay blocked with flags, fake roots and poisoned environment', () => {
  for(const name of ['cli.ts','controller-service.ts']) {
    const r=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL(DIR+name,import.meta.url)),
      '--execute','--approved','--roots=fake','--url=postgres://fake'],{cwd:ROOT,encoding:'utf8',timeout:10000,
      env:{DATABASE_URL:'postgres://not-a-secret@127.0.0.1:1/fake',ALLOW_EXECUTION:'true'}});
    assert.equal(r.status,2,r.stderr); const value=JSON.parse(r.stdout);
    assert.equal(value.executionAuthorized,false); assert.equal(value.databaseCalls+value.sqlCalls+value.realMessageCalls,0);
    assert.ok(!r.stdout.includes('postgres://'));
  }
});
test('fresh import canaries prove no pg load, networking, process launch or journal I/O from service/import', () => {
  const code=String.raw`
    import net from 'node:net';import tls from 'node:tls';import cp from 'node:child_process';import fs from 'node:fs';
    import {createRequire} from 'node:module';
    let calls=0;const no=()=>{calls++;throw Error('SIDE_EFFECT');};
    net.Socket.prototype.connect=no;tls.connect=no;cp.spawn=no;cp.exec=no;cp.execFile=no;
    const service=await import('./scripts/acceptance/strigunov-lab-controller/controller-service.ts');
    const adapters=await import('./scripts/acceptance/strigunov-lab-controller/adapters.ts');
    const s=service.default??service,a=adapters.default??adapters;
    fs.writeFileSync=no;fs.appendFileSync=no;fs.mkdirSync=no;fs.openSync=no;fs.readFileSync=no;
    s.handleUntrustedRequest({approved:true,run:no});a.verifyOwnerAuthorization({roots:'fake'});
    a.attestNativeHost();a.attestLabTarget();a.claimProtectedLease();a.controlOwnedFault();a.issueAuthenticatedReceipt();
    const require=createRequire(import.meta.url);
    if(calls||Object.keys(require.cache).some(p=>/[\\/]node_modules[\\/]pg[\\/]/.test(p)))process.exit(9);
  `;
  const r=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:ROOT,encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);
});
test('parent harness gate is unchanged and no controller imports database/process/provider libraries', () => {
  const parentSource=fs.readFileSync(new URL('../acceptance/strigunov-public-lead-postgres-harness.ts',import.meta.url),'utf8');
  assert.ok(parentSource.includes("throw new Error('TRUSTED_HOST_NOT_INSTALLED')"));
  for(const name of ['protocol.ts','state.ts','adapters.ts','controller-service.ts','cli.ts','unit-file-store.ts']) {
    const source=fs.readFileSync(new URL(DIR+name,import.meta.url),'utf8');
    assert.ok(!/from\s+['"](?:pg|node:(?:net|tls|http|https|child_process))/.test(source),name);
    assert.ok(!source.includes('process.env'),name);
    assert.ok(!source.includes('generateKeyPair') && !source.includes('createPrivateKey'),name);
  }
});
