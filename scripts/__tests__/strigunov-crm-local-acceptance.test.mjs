import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import acceptanceContract from '../strigunov-crm-local-acceptance.ts';

const {
  buildFixtureIdentity,
  runAcceptanceContract,
  validateAuthenticatedQueueProof,
  validateDisposableStoreIdentity,
  validateServiceCredentialProof,
} = acceptanceContract;

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = fileURLToPath(new URL('../strigunov-crm-local-acceptance.ts', import.meta.url));
const RUN_ID = 'a1b2c3d4e5f6';

function attempt(args, override = {}) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    ASI_LOCAL_CRM_ACCEPTANCE: '1',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'test-placeholder-not-a-real-key',
    ...override,
  };
  const result = spawnSync(process.execPath, ['--import', 'tsx', runner, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

function authoritativeIdentity(runId = RUN_ID) {
  return {
    authority: 'trusted_local_runtime_probe',
    proofKind: 'docker_daemon_socket_owner_and_database_identity',
    runId,
    instanceId: `local-${runId}`,
    apiOrigin: 'http://127.0.0.1:54321',
    apiBindingHost: '127.0.0.1',
    databaseBindingHost: '127.0.0.1',
    apiContainerId: 'a'.repeat(64),
    databaseContainerId: 'b'.repeat(64),
    disposable: true,
    harnessOwned: true,
    remoteEgressDenied: true,
    tunnelDetected: false,
    proxyDetected: false,
  };
}

function credentialProof(identity = authoritativeIdentity()) {
  return {
    authority: 'identified_local_auth_api',
    accepted: true,
    instanceId: identity.instanceId,
    runId: identity.runId,
  };
}

function queueProof(fixture, overrides = {}) {
  return {
    route: '/api/dashboard/crm/queue?includeTest=1',
    unauthenticatedStatus: 401,
    forbiddenStatus: 403,
    operatorStatus: 200,
    item: {
      id: 'row-owned-1',
      referral: 'strigunov',
      nextAction: fixture.nextAction,
    },
    ...overrides,
  };
}

function memoryAdapter(options = {}) {
  const rows = new Map();
  const deletedIds = [];
  let reads = 0;
  return {
    rows,
    deletedIds,
    async insertFixture(fixture) {
      if (options.insertError) throw options.insertError;
      const row = { id: options.id ?? 'row-owned-1', ...fixture };
      rows.set(row.id, options.persistedRow ? { ...row, ...options.persistedRow } : row);
      return { id: row.id };
    },
    async readFixtureByIdStrict(id) {
      reads += 1;
      if (options.readErrorAt === reads) throw new Error('strict read failed');
      return rows.get(id) ?? null;
    },
    async deleteOwnedFixture(id, fixture) {
      if (options.cleanupError) throw new Error('cleanup failed');
      const row = rows.get(id);
      if (!row || row.runId !== fixture.runId || row.name !== fixture.name || row.telegramUsername !== fixture.telegramUsername) {
        return { deleted: false, ownershipMatched: false, deletedId: null };
      }
      rows.delete(id);
      deletedIds.push(id);
      return { deleted: true, ownershipMatched: true, deletedId: id };
    },
  };
}

test('plan is machine-readable, read-only, and never reports a security pass', () => {
  const result = attempt(['--plan'], {
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://invalid.example',
    SUPABASE_SERVICE_ROLE_KEY: '',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.mode, 'plan');
  assert.equal(result.json.verdict, 'PLAN_ONLY');
  assert.equal(result.json.safeToExecute, false);
  assert.equal(result.json.evidence.realIsolatedPersistence, 'NOT_RUN');
  assert.deepEqual(result.json.sideEffects, {
    databaseWrites: false,
    networkRequests: false,
    secretsRead: false,
    cleanupDeletes: false,
  });
});

test('dry-run policy blocks execution without treating local flags, URL, or a key string as proof', () => {
  const result = attempt(['--dry-run']);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.json.mode, 'dry-run');
  assert.equal(result.json.verdict, 'BLOCKED');
  assert.equal(result.json.safeToExecute, false);
  assert.match(result.json.blockers.join(' '), /authoritative_disposable_store_identity_unavailable/);
  assert.match(result.json.blockers.join(' '), /service_key_not_verified/);
  assert.match(result.json.blockers.join(' '), /authenticated_operator_http_proof_unavailable/);
  assert.equal(result.json.evidence.unitContracts, 'NOT_RUN');
  assert.equal(result.json.evidence.realIsolatedPersistence, 'BLOCKED');
});

test('execute mode is prohibited until real identity, HTTP attribution, and cleanup adapters exist', () => {
  const result = attempt(['--execute']);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.json.mode, 'execute');
  assert.equal(result.json.verdict, 'BLOCKED');
  assert.equal(result.json.safeToExecute, false);
  assert.equal(result.json.gates.disposableStoreIdentity.status, 'BLOCKED');
  assert.equal(result.json.gates.authenticatedOperatorHttp.status, 'BLOCKED');
  assert.equal(result.json.gates.cleanup.status, 'BLOCKED');
  assert.deepEqual(result.json.sideEffects, {
    databaseWrites: false,
    networkRequests: false,
    secretsRead: false,
    cleanupDeletes: false,
  });
});

test('disposable identity rejects missing, self-attested, remote, tunnel, proxy, ambiguous, and cross-run evidence', () => {
  const cases = [
    null,
    { ...authoritativeIdentity(), authority: 'caller_self_attestation' },
    { ...authoritativeIdentity(), apiOrigin: 'https://remote.example' },
    { ...authoritativeIdentity(), tunnelDetected: true },
    { ...authoritativeIdentity(), proxyDetected: true },
    { ...authoritativeIdentity(), apiBindingHost: '0.0.0.0' },
    { ...authoritativeIdentity(), runId: 'ffffffffffff' },
  ];
  for (const evidence of cases) {
    assert.equal(validateDisposableStoreIdentity(evidence, RUN_ID).status, 'BLOCKED');
  }
  assert.equal(validateDisposableStoreIdentity(authoritativeIdentity(), RUN_ID).status, 'PASS');
});

test('a nonempty or fake service key is not credential proof', () => {
  const identity = authoritativeIdentity();
  assert.equal(validateServiceCredentialProof('fake-key', null, identity).status, 'BLOCKED');
  assert.equal(validateServiceCredentialProof('', credentialProof(identity), identity).status, 'BLOCKED');
  assert.equal(validateServiceCredentialProof('present-but-never-logged', {
    ...credentialProof(identity),
    instanceId: 'different-instance',
  }, identity).status, 'BLOCKED');
  assert.equal(validateServiceCredentialProof('present-but-never-logged', credentialProof(identity), identity).status, 'PASS');
});

test('authenticated queue proof requires genuine 401, 403, 200 and owner-visible attribution', () => {
  const fixture = buildFixtureIdentity(RUN_ID);
  assert.equal(validateAuthenticatedQueueProof(null, 'row-owned-1', fixture).status, 'BLOCKED');
  assert.equal(validateAuthenticatedQueueProof(queueProof(fixture, { unauthenticatedStatus: 200 }), 'row-owned-1', fixture).status, 'BLOCKED');
  assert.equal(validateAuthenticatedQueueProof(queueProof(fixture, { forbiddenStatus: 200 }), 'row-owned-1', fixture).status, 'BLOCKED');
  assert.equal(validateAuthenticatedQueueProof(queueProof(fixture, { operatorStatus: 401 }), 'row-owned-1', fixture).status, 'BLOCKED');
  assert.equal(validateAuthenticatedQueueProof(queueProof(fixture, { item: { id: 'row-owned-1' } }), 'row-owned-1', fixture).status, 'BLOCKED');
  assert.equal(validateAuthenticatedQueueProof(queueProof(fixture), 'row-owned-1', fixture).status, 'PASS');
});

test('unit contract tracks the inserted ID, uses strict readback, and passes only after exact cleanup', async () => {
  const identity = authoritativeIdentity();
  const fixture = buildFixtureIdentity(RUN_ID);
  const adapter = memoryAdapter();
  const result = await runAcceptanceContract({
    evidenceKind: 'unit_contract',
    runId: RUN_ID,
    identityEvidence: identity,
    serviceKey: 'present-but-never-logged',
    credentialEvidence: credentialProof(identity),
    adapter,
    getQueueProof: async () => queueProof(fixture),
  });
  assert.equal(result.verdict, 'CONTRACT_PASS');
  assert.equal(result.evidence.unitContracts, 'PASS');
  assert.equal(result.evidence.realIsolatedPersistence, 'NOT_RUN');
  assert.deepEqual(adapter.deletedIds, ['row-owned-1']);
  assert.equal(adapter.rows.size, 0);
  assert.equal(result.cleanup.status, 'PASS');
});

test('partial write without an owned ID fails closed and never broad-deletes', async () => {
  const identity = authoritativeIdentity();
  const adapter = memoryAdapter({ insertError: new Error('write outcome unknown') });
  const result = await runAcceptanceContract({
    evidenceKind: 'unit_contract', runId: RUN_ID, identityEvidence: identity,
    serviceKey: 'present', credentialEvidence: credentialProof(identity), adapter,
    getQueueProof: async () => { throw new Error('must not run'); },
  });
  assert.equal(result.verdict, 'BLOCKED');
  assert.match(result.blockers.join(' '), /write_outcome_missing_owned_id/);
  assert.deepEqual(adapter.deletedIds, []);
});

test('failure after an insert receipt cleans only the immediately tracked ID', async () => {
  const identity = authoritativeIdentity();
  const adapter = memoryAdapter({ readErrorAt: 1 });
  const result = await runAcceptanceContract({
    evidenceKind: 'unit_contract', runId: RUN_ID, identityEvidence: identity,
    serviceKey: 'present', credentialEvidence: credentialProof(identity), adapter,
    getQueueProof: async () => { throw new Error('must not run'); },
  });
  assert.equal(result.verdict, 'BLOCKED');
  assert.deepEqual(adapter.deletedIds, ['row-owned-1']);
  assert.equal(adapter.rows.size, 0);
});

test('cleanup failure prevents every success verdict', async () => {
  const identity = authoritativeIdentity();
  const fixture = buildFixtureIdentity(RUN_ID);
  const adapter = memoryAdapter({ cleanupError: true });
  const result = await runAcceptanceContract({
    evidenceKind: 'unit_contract', runId: RUN_ID, identityEvidence: identity,
    serviceKey: 'present', credentialEvidence: credentialProof(identity), adapter,
    getQueueProof: async () => queueProof(fixture),
  });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.cleanup.status, 'BLOCKED');
  assert.match(result.blockers.join(' '), /cleanup_failed/);
});

test('fixture mismatch and concurrent-run identity mismatch do not delete another run row', async () => {
  const identity = authoritativeIdentity();
  const other = buildFixtureIdentity('ffffffffffff');
  const adapter = memoryAdapter({ persistedRow: other });
  const result = await runAcceptanceContract({
    evidenceKind: 'unit_contract', runId: RUN_ID, identityEvidence: identity,
    serviceKey: 'present', credentialEvidence: credentialProof(identity), adapter,
    getQueueProof: async () => { throw new Error('must not run'); },
  });
  assert.equal(result.verdict, 'BLOCKED');
  assert.match(result.blockers.join(' '), /fixture_ownership_mismatch/);
  assert.deepEqual(adapter.deletedIds, []);
  assert.equal(adapter.rows.size, 1);
  assert.equal(adapter.rows.get('row-owned-1').runId, 'ffffffffffff');
});
