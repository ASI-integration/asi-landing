import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import acceptanceContract from '../strigunov-crm-local-acceptance.ts';
import queueModule from '../../src/lib/crm/queue.ts';

const {
  buildFixtureIdentity,
  runAcceptanceContract,
  runUnitAcceptanceModel,
} = acceptanceContract;
const { buildQueueItem, resolveCrmQueueReferral } = queueModule;

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = fileURLToPath(new URL('../strigunov-crm-local-acceptance.ts', import.meta.url));
const RUN_ID = 'a1b2c3d4e5f6';

function attempt(args, override = {}) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    ASI_LOCAL_CRM_ACCEPTANCE: '1',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'fabricated-key-that-must-never-be-read',
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

function unitInput(scenario = 'success') {
  return { evidenceKind: 'unit_model', runId: RUN_ID, scenario };
}

function assertNoExternalSideEffects(result) {
  assert.equal(result.sideEffects.databaseWrites, false);
  assert.equal(result.sideEffects.networkRequests, false);
  assert.equal(result.sideEffects.secretsRead, false);
  assert.equal(result.sideEffects.cleanupDeletes, false);
}

const baseContact = {
  id: 'contact-1',
  name: 'Test Owner',
  phone: '',
  telegramUsername: 'test_owner',
  email: null,
  role: 'owner',
  source: 'form',
  objectsCount: 2,
  city: '',
  note: '',
  status: 'new',
  communicationStatus: 'needs_manual_reaction',
  lastContactAt: null,
  nextStep: '',
  nextActionAt: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  updatedAt: '2026-10-09T10:00:00.000Z',
};

test('plan is machine-readable and never reports acceptance', () => {
  const result = attempt(['--plan'], {
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://remote.example',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.mode, 'plan');
  assert.equal(result.json.verdict, 'PLAN_ONLY');
  assert.equal(result.json.safeToExecute, false);
  assert.equal(result.json.evidence.realIsolatedPersistence, 'NOT_RUN');
  assertNoExternalSideEffects(result.json);
});

test('dry-run remains hard-blocked despite fabricated local flags and credentials', () => {
  const result = attempt(['--dry-run']);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.json.mode, 'dry-run');
  assert.equal(result.json.verdict, 'BLOCKED');
  assert.equal(result.json.safeToExecute, false);
  assert.match(result.json.blockers.join(' '), /runtime_execution_hard_blocked/);
  assert.equal(result.json.evidence.realIsolatedPersistence, 'NOT_RUN');
  assertNoExternalSideEffects(result.json);
});

test('execute remains hard-blocked with no real adapter path', () => {
  const result = attempt(['--execute']);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.json.mode, 'execute');
  assert.equal(result.json.verdict, 'BLOCKED');
  assert.equal(result.json.gates.realIsolatedPersistence.status, 'BLOCKED');
  assert.equal(result.json.gates.authenticatedOperatorHttp.status, 'BLOCKED');
  assert.equal(result.json.gates.cleanup.status, 'BLOCKED');
  assertNoExternalSideEffects(result.json);
});

test('invalid CLI modes fail with a stable bounded code', () => {
  const result = attempt(['--execute', '--dry-run']);
  assert.equal(result.status, 2, result.stderr);
  assert.deepEqual(result.json.blockers, ['exactly_one_mode_required:--plan|--dry-run|--execute']);
});

test('the former fabricated authority shape cannot invoke injected callbacks', async () => {
  let calls = 0;
  const callback = async () => {
    calls += 1;
    throw new Error('must never execute');
  };
  const result = await runAcceptanceContract({
    evidenceKind: 'unit_contract',
    runId: RUN_ID,
    identityEvidence: {
      authority: 'trusted_local_runtime_probe',
      proofKind: 'docker_daemon_socket_owner_and_database_identity',
    },
    serviceKey: 'fabricated',
    credentialEvidence: { authority: 'identified_local_auth_api', accepted: true },
    adapter: {
      insertFixture: callback,
      readFixtureByIdStrict: callback,
      deleteOwnedFixture: callback,
    },
    getQueueProof: callback,
  });
  assert.equal(result.verdict, 'BLOCKED');
  assert.deepEqual(result.blockers, ['unit_model_evidence_kind_required']);
  assert.equal(calls, 0);
  assertNoExternalSideEffects(result);
});

test('extra executable properties are ignored by the closed unit model', async () => {
  let calls = 0;
  const callback = () => { calls += 1; };
  const result = await runUnitAcceptanceModel({
    ...unitInput(),
    insertFixture: callback,
    readFixtureByIdStrict: callback,
    deleteOwnedFixture: callback,
    getQueueProof: callback,
    networkRequest: callback,
  });
  assert.equal(result.verdict, 'CONTRACT_PASS');
  assert.equal(calls, 0);
  assertNoExternalSideEffects(result);
});

test('unit contract passes only after exact in-memory cleanup', async () => {
  const result = await runUnitAcceptanceModel(unitInput());
  assert.equal(result.verdict, 'CONTRACT_PASS');
  assert.equal(result.mode, 'unit-model');
  assert.equal(result.evidence.unitContracts, 'PASS');
  assert.equal(result.evidence.realIsolatedPersistence, 'NOT_RUN');
  assert.equal(result.evidence.authenticatedOperatorHttp, 'NOT_RUN');
  assert.equal(result.cleanup.status, 'PASS');
  assert.equal(result.model.rowsRemaining, 0);
  assert.equal(result.sideEffects.inMemoryRowsCreated, 1);
  assert.equal(result.sideEffects.inMemoryRowsDeleted, 1);
});

test('fabricated 401, 403, and 200 claims remain ignored UNIT_ONLY data', async () => {
  const result = await runUnitAcceptanceModel({
    ...unitInput(),
    unauthenticatedStatus: 401,
    forbiddenStatus: 403,
    operatorStatus: 200,
  });
  assert.equal(result.verdict, 'CONTRACT_PASS');
  assert.equal(result.evidence.unitContracts, 'PASS');
  assert.equal(result.evidence.authenticatedOperatorHttp, 'NOT_RUN');
  assert.equal(result.evidence.realIsolatedPersistence, 'NOT_RUN');
});

test('preexisting same-run and foreign rows remain untouched and blocked', async () => {
  for (const scenario of ['preexisting_same_run', 'preexisting_other_run']) {
    const result = await runUnitAcceptanceModel(unitInput(scenario));
    assert.equal(result.verdict, 'BLOCKED');
    assert.equal(result.ownership.createdThisInvocation, false);
    assert.equal(result.ownership.preexistingRowsUntouched, true);
    assert.equal(result.cleanup.status, 'BLOCKED');
    assert.equal(result.model.rowsRemaining, 1);
    assert.equal(result.sideEffects.inMemoryRowsDeleted, 0);
  }
});

test('concurrent logical ownership conflicts fail closed without cleanup', async () => {
  const result = await runUnitAcceptanceModel(unitInput('concurrent_attempt'));
  assert.equal(result.verdict, 'BLOCKED');
  assert.match(result.blockers.join(' '), /unit_concurrent_ownership_conflict/);
  assert.equal(result.ownership.preexistingRowsUntouched, true);
  assert.equal(result.sideEffects.inMemoryRowsDeleted, 0);
});

test('insert-before-lost-response records an unknown write and never broad-deletes', async () => {
  const result = await runUnitAcceptanceModel(unitInput('insert_before_lost_response'));
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.fixtureId, null);
  assert.equal(result.ownership.unknownWrite, true);
  assert.match(result.blockers.join(' '), /unit_cleanup_unproven_without_owned_id/);
  assert.equal(result.model.rowsRemaining, 1);
  assert.equal(result.sideEffects.inMemoryRowsDeleted, 0);
});

test('readback mismatch cannot authorize destructive cleanup', async () => {
  const result = await runUnitAcceptanceModel(unitInput('readback_mismatch'));
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.ownership.unknownWrite, true);
  assert.equal(result.gates.strictPersistenceModel.status, 'BLOCKED');
  assert.match(result.blockers.join(' '), /unit_cleanup_not_authorized_after_readback_mismatch/);
  assert.equal(result.model.rowsRemaining, 1);
  assert.equal(result.sideEffects.inMemoryRowsDeleted, 0);
});

test('delete failure and zero deleted rows prevent contract success', async () => {
  for (const scenario of ['delete_failure', 'delete_zero_count']) {
    const result = await runUnitAcceptanceModel(unitInput(scenario));
    assert.equal(result.verdict, 'BLOCKED');
    assert.equal(result.cleanup.status, 'BLOCKED');
    assert.equal(result.model.rowsRemaining, 1);
    assert.equal(result.sideEffects.inMemoryRowsDeleted, 0);
  }
});

test('unknown absence read prevents success even after modeled deletion', async () => {
  const result = await runUnitAcceptanceModel(unitInput('absence_read_failure'));
  assert.equal(result.verdict, 'BLOCKED');
  assert.deepEqual(result.cleanup.reasons, ['unit_cleanup_absence_read_failed']);
  assert.equal(result.model.rowsRemaining, 0);
  assert.equal(result.sideEffects.inMemoryRowsDeleted, 1);
});

test('malformed unit inputs return stable codes without exception text', async () => {
  const badRun = await runUnitAcceptanceModel({ evidenceKind: 'unit_model', runId: 'not-valid' });
  const badScenario = await runUnitAcceptanceModel({
    evidenceKind: 'unit_model',
    runId: RUN_ID,
    scenario: 'unknown-and-very-long-arbitrary-caller-text',
  });
  assert.deepEqual(badRun.blockers, ['unit_run_id_invalid']);
  assert.deepEqual(badScenario.blockers, ['unit_scenario_unknown']);
  assert.throws(
    () => buildFixtureIdentity('not-valid'),
    /acceptance_run_id_must_be_12_lowercase_hex_characters/,
  );
});

test('queue referral projection is exact, conservative, and neutral for history', () => {
  assert.equal(
    resolveCrmQueueReferral('Заявка\nИсточник заявки: Стригунов (переход по ссылке).\nДалее'),
    'strigunov',
  );
  assert.equal(resolveCrmQueueReferral('Источник заявки: сайт ASI.'), 'site');
  assert.equal(resolveCrmQueueReferral('Источник заявки: главная страница ASI.'), 'site');
  assert.equal(resolveCrmQueueReferral('Историческая заявка от Стригунова'), 'unknown');
  assert.equal(resolveCrmQueueReferral('prefix Источник заявки: Стригунов (переход по ссылке).'), 'unknown');
  assert.equal(resolveCrmQueueReferral(''), 'unknown');
});

test('guarded queue item serializes sanitized referral and next action without raw notes', () => {
  const rawNote = [
    'private-note-sentinel',
    'Источник заявки: Стригунов (переход по ссылке).',
  ].join('\n');
  const item = buildQueueItem({
    ...baseContact,
    note: rawNote,
    nextStep: '  [photo] Связаться   с заявителем  ',
  });
  assert.equal(item.referral, 'strigunov');
  assert.equal(item.nextAction, 'Связаться с заявителем');
  assert.equal(item.lastMessagePreview, 'Связаться с заявителем');
  assert.equal(item.nextBestStep, item.channelManagerNextStep);
  assert.doesNotMatch(JSON.stringify(item), /private-note-sentinel/);
  assert.equal(Object.hasOwn(item, 'assignedOperator'), false);
});

test('empty stored next action remains explicitly null and does not alter compatibility fields', () => {
  const item = buildQueueItem({ ...baseContact, note: 'Источник заявки: сайт ASI.' });
  assert.equal(item.referral, 'site');
  assert.equal(item.nextAction, null);
  assert.equal(item.lastMessagePreview, null);
  assert.equal(Object.hasOwn(item, 'nextBestStep'), true);
});
