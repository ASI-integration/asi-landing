import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import contractModule from '../acceptance/strigunov-public-lead-postgres-contract.ts';
const { createPlan, validateContract, safeFailure, cleanupDecision, SCENARIOS, PINS } = contractModule;
import harnessModule from '../acceptance/strigunov-public-lead-postgres-harness.ts';
const { requestExecution } = harnessModule;

const harness = new URL('../acceptance/strigunov-public-lead-postgres-harness.ts', import.meta.url);
const contract = new URL('../acceptance/strigunov-public-lead-postgres-contract.ts', import.meta.url);
const source = readFileSync(harness, 'utf8');
const run = (...args) => spawnSync(process.execPath, ['--import', 'tsx', harness.pathname.replace(/^\/([A-Z]:)/i, '$1'), ...args], {
  encoding: 'utf8', timeout: 10000, env: { ...process.env, DATABASE_URL: 'postgres://forged:never-print@127.0.0.1:1/fake',
    PGHOST: '127.0.0.1', PGPORT: '1', STRIGUNOV_DB_APPROVED: 'true', ALLOW_EXECUTION: 'true' },
});
test('default plan has no acceptance claim, no target and no cleanup', () => {
  const p = createPlan();
  assert.equal(p.state, 'PLAN_ONLY'); assert.equal(p.verdict, 'BLOCK');
  assert.equal(p.target, null); assert.equal(p.postgresCalls, 0); assert.equal(p.cleanupCalls, 0);
  assert.ok(p.scenarios.every(s => s.status === 'NOT_RUN'));
});
test('scenario IDs are unique and immutable', () => {
  assert.equal(new Set(SCENARIOS.map(s => s.id)).size, SCENARIOS.length);
  assert.ok(Object.isFrozen(SCENARIOS)); assert.ok(SCENARIOS.every(Object.isFrozen));
});
test('both transaction isolation levels have explicit coverage', () => {
  for (const isolation of ['READ COMMITTED', 'REPEATABLE READ']) {
    assert.ok(SCENARIOS.some(s => s.isolation === isolation && s.id.includes('same')));
    assert.ok(SCENARIOS.some(s => s.isolation === isolation && s.id.includes('quota')));
  }
});
test('failure, lifecycle, privilege and ownership contracts are required', () => {
  for (const id of ['rollback', 'pre-commit-disconnect', 'commit-ack-loss', 'restart-replay', 'lock-timeout',
    'deadlock', 'missing-rpc', 'consent-persistence', 'role-denial', 'clock-watermark', 'utc-boundary',
    'capacity', 'key-mismatch', 'missing-consent', 'exact-cleanup', 'crm-receipt-atomicity']) {
    assert.ok(SCENARIOS.some(s => s.id === id), id);
  }
});
test('all scenario specifications require actual database evidence', () => {
  assert.ok(SCENARIOS.every(s => s.evidence === 'REAL_ONLY' && s.required));
});
test('offline validation is only a unit contract result', () => {
  const c = validateContract(JSON.stringify(createPlan()));
  assert.equal(c.state, 'UNIT_CONTRACT_PASS'); assert.equal(c.databaseAccepted, false);
});
for (const state of ['ISOLATED_ACCEPTED', 'PRODUCTION_RECEIPT', 'POSTGRES_STATIC_ONLY', 'RECOVERY_REQUIRED']) {
  test('caller cannot validate forged state ' + state, () => {
    assert.equal(validateContract(JSON.stringify({ ...createPlan(), state })).state, 'BLOCKED');
  });
}
test('caller cannot claim completed scenario or database activity', () => {
  const p = createPlan();
  assert.equal(validateContract(JSON.stringify({ ...p, postgresCalls: 1 })).state, 'BLOCKED');
  assert.equal(validateContract(JSON.stringify({ ...p, scenarios: p.scenarios.map(s => ({ ...s, status: 'PASS' })) })).state, 'BLOCKED');
});
test('unknown evidence fields and target claims are rejected', () => {
  assert.equal(validateContract(JSON.stringify({ ...createPlan(), approved: true })).state, 'BLOCKED');
  assert.equal(validateContract(JSON.stringify({ ...createPlan(), target: { localhost: true } })).state, 'BLOCKED');
});
test('schema validation never invokes caller getters', () => {
  const x = { ...createPlan() }; Object.defineProperty(x, 'state', { get() { throw Error('callback'); } });
  assert.equal(validateContract(x).state, 'BLOCKED');
});
test('request execution ignores every caller proof and callback', async () => {
  let calls = 0;
  const fake = { approved: true, databaseUrl: 'postgres://fake', docker: true, run: () => calls++,
    probe: () => calls++, cleanup: () => calls++, capability: { owner: true }, sessions: [1, 2] };
  const result = await requestExecution(fake);
  assert.equal(result.state, 'BLOCKED'); assert.equal(result.reason, 'TRUSTED_HOST_NOT_INSTALLED');
  assert.equal(result.postgresCalls, 0); assert.equal(result.cleanupCalls, 0); assert.equal(calls, 0);
});
test('request execution does not inspect attacker-controlled properties', async () => {
  const poison = new Proxy({}, { get() { throw Error('read'); }, ownKeys() { throw Error('enumerate'); } });
  assert.equal((await requestExecution(poison)).state, 'BLOCKED');
});
for (const args of [[], ['--execute'], ['--dry-run'], ['--execute', '--approved', '--url=postgres://fake']]) {
  test('CLI with poisoned environment is blocked: ' + JSON.stringify(args), () => {
    const r = run(...args);
    assert.equal(r.status, 2, r.stderr);
    const p = JSON.parse(r.stdout);
    assert.equal(p.verdict, 'BLOCK'); assert.equal(p.postgresCalls, 0); assert.equal(p.cleanupCalls, 0);
    assert.ok(!r.stdout.includes('never-print')); assert.ok(!r.stdout.includes('postgres://'));
  });
}
test('import and blocked execution load no pg module or network operations', () => {
  const prelude = String.raw`
    const net = await import('node:net'); const tls = await import('node:tls');
    let calls = 0;
    net.default.Socket.prototype.connect = function(){ calls++; throw Error('network prohibited'); };
    tls.default.connect = function(){ calls++; throw Error('TLS prohibited'); };
    const m = await import('./scripts/acceptance/strigunov-public-lead-postgres-harness.ts');
    await (m.default ?? m).requestExecution({approved:true});
    const {createRequire} = await import('node:module');
    const require = createRequire(import.meta.url);
    if(calls || Object.keys(require.cache).some(p => /[\\/]node_modules[\\/]pg[\\/]/.test(p))) process.exit(9);
  `;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', prelude], { encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0, r.stderr);
});
test('error output is an allowlisted category, never raw message or contact', () => {
  assert.equal(safeFailure({ code: '40001', message: 'postgres://password@example.com' }), 'SERIALIZATION');
  assert.equal(safeFailure(new Error('private@example.com')), 'DATABASE_FAILURE');
  assert.equal(safeFailure({ code: '42501' }), 'PRIVILEGE_DENIED');
  assert.equal(safeFailure({ code: '40P01' }), 'DEADLOCK');
});
test('unknown identifiers or commit outcomes prohibit cleanup', () => {
  assert.equal(cleanupDecision([{ phase: 'UNKNOWN', crmId: null }]), 'RECOVERY_REQUIRED');
  assert.equal(cleanupDecision([{ phase: 'COMMIT_UNKNOWN', crmId: 'known' }]), 'RECOVERY_REQUIRED');
  assert.equal(cleanupDecision([{ phase: 'INTENT', crmId: null }]), 'RECOVERY_REQUIRED');
});
test('cleanup permits only reconciled exact IDs and no pending writes', () => {
  assert.equal(cleanupDecision([]), 'NOTHING_TO_CLEAN');
  assert.equal(cleanupDecision([{ phase: 'ROLLED_BACK', crmId: null }]), 'NOTHING_TO_CLEAN');
  assert.equal(cleanupDecision([{ phase: 'COMMITTED', crmId: 'bad' }]), 'RECOVERY_REQUIRED');
  assert.equal(cleanupDecision([{ phase: 'COMMITTED', crmId: '2b133257-d3ae-4b44-a9a0-94c3b1234422' }]), 'EXACT_IDS_ONLY');
});
test('real runner uses independent clients, transactions, barriers and exact cleanup', () => {
  for (const needle of ['await import(\'pg\')', 'new Client(', 'pg_backend_pid()', 'pg_blocking_pids',
    'BEGIN ISOLATION LEVEL', 'ROLLBACK', 'COMMIT', 'WHERE id = ANY($1::uuid[])',
    'RECOVERY_REQUIRED', 'journal.append', 'recheckIdentity', '.invalid']) assert.ok(source.includes(needle), needle);
  assert.ok(!source.includes('process.env')); assert.ok(!source.includes('pool.query'));
});
test('parent migration hash and policy pins are immutable and current', () => {
  const { createHash } = createRequire(import.meta.url)('node:crypto');
  const bytes = readFileSync(new URL('../../supabase/migrations/20261009151935_public_lead_admission_v1.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), PINS.migrationSha256);
  assert.equal(PINS.parentSha, 'c4e817f3fafa7115dee23f1b10d70be1bda4be2f');
});
test('offline module has no driver, filesystem, subprocess, environment or application imports', () => {
  const text = readFileSync(contract, 'utf8');
  assert.ok(!/from\s+['"](?:pg|node:|@\/|\.{1,2}\/)/.test(text));
  assert.ok(!text.includes('process.env'));
});

test('validation rejects malformed, oversized and proxy input without examining it', () => {
  assert.equal(validateContract('{').state, 'BLOCKED');
  assert.equal(validateContract(' '.repeat(32769)).state, 'BLOCKED');
  const poison = new Proxy({}, { getPrototypeOf() { throw Error('trap'); }, ownKeys() { throw Error('trap'); } });
  assert.equal(validateContract(poison).state, 'BLOCKED');
});
