import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCHEMA_VERSION = 'asi.strigunov-crm-local-acceptance.v3';
const NEXT_ACTION = 'Связаться с заявителем, уточнить объект и согласовать подключение.';

type GateStatus = 'PASS' | 'BLOCKED' | 'NOT_RUN';

type GateResult = { status: GateStatus; reasons: string[] };

type EvidenceState = {
  unitContracts: GateStatus;
  realIsolatedPersistence: 'NOT_RUN';
  authenticatedOperatorHttp: 'NOT_RUN';
  cleanup: GateStatus;
};

type SideEffects = {
  databaseWrites: false;
  networkRequests: false;
  secretsRead: false;
  cleanupDeletes: false;
  inMemoryRowsCreated: number;
  inMemoryRowsDeleted: number;
};

export type FixtureIdentity = {
  runId: string;
  name: string;
  telegramUsername: string;
  referral: 'strigunov';
  nextAction: string;
  source: 'form';
  status: 'new';
  communicationStatus: 'needs_manual_reaction';
  objectsCount: 2;
};

type MemoryRow = FixtureIdentity & {
  id: string;
  ownerInvocationId: string;
};

export const UNIT_SCENARIOS = [
  'success',
  'preexisting_same_run',
  'preexisting_other_run',
  'concurrent_attempt',
  'insert_before_lost_response',
  'readback_mismatch',
  'delete_failure',
  'delete_zero_count',
  'absence_read_failure',
] as const;

export type UnitScenario = (typeof UNIT_SCENARIOS)[number];

type UnitAcceptanceInput = {
  evidenceKind?: unknown;
  runId?: unknown;
  scenario?: unknown;
  [key: string]: unknown;
};

type UnitAcceptanceResult = {
  schemaVersion: typeof SCHEMA_VERSION;
  mode: 'unit-model';
  verdict: 'CONTRACT_PASS' | 'BLOCKED';
  safeToExecute: false;
  runId: string | null;
  fixtureId: string | null;
  scenario: UnitScenario | null;
  gates: {
    unitOnlyBoundary: GateResult;
    fixtureOwnership: GateResult;
    strictPersistenceModel: GateResult;
    queueProjection: GateResult;
  };
  ownership: {
    createdThisInvocation: boolean;
    preexistingRowsUntouched: boolean;
    unknownWrite: boolean;
  };
  cleanup: GateResult;
  evidence: EvidenceState;
  blockers: string[];
  model: { rowsRemaining: number };
  sideEffects: SideEffects;
};

function blocked(...reasons: string[]): GateResult {
  return { status: 'BLOCKED', reasons };
}

function passed(): GateResult {
  return { status: 'PASS', reasons: [] };
}

function notRun(reason: string): GateResult {
  return { status: 'NOT_RUN', reasons: [reason] };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRunId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{12}$/.test(value);
}

function isUnitScenario(value: unknown): value is UnitScenario {
  return typeof value === 'string' && UNIT_SCENARIOS.includes(value as UnitScenario);
}

export function buildFixtureIdentity(
  runId = randomUUID().replaceAll('-', '').slice(0, 12),
): FixtureIdentity {
  if (!isRunId(runId)) {
    throw new Error('acceptance_run_id_must_be_12_lowercase_hex_characters');
  }
  return {
    runId,
    name: `ASI CRM ACCEPT ${runId}`,
    telegramUsername: `asi_acc_${runId}`,
    referral: 'strigunov',
    nextAction: NEXT_ACTION,
    source: 'form',
    status: 'new',
    communicationStatus: 'needs_manual_reaction',
    objectsCount: 2,
  };
}

function validateMemoryReadback(
  row: MemoryRow | null,
  fixtureId: string,
  fixture: FixtureIdentity,
  invocationId: string,
): GateResult {
  if (!row) return blocked('unit_readback_missing');
  if (row.ownerInvocationId !== invocationId) return blocked('unit_fixture_not_owned_by_invocation');
  if (
    row.id !== fixtureId
    || row.runId !== fixture.runId
    || row.name !== fixture.name
    || row.telegramUsername !== fixture.telegramUsername
  ) {
    return blocked('unit_readback_ownership_mismatch');
  }
  if (
    row.referral !== fixture.referral
    || row.nextAction !== fixture.nextAction
    || row.source !== fixture.source
    || row.status !== fixture.status
    || row.communicationStatus !== fixture.communicationStatus
    || row.objectsCount !== fixture.objectsCount
  ) {
    return blocked('unit_readback_contract_mismatch');
  }
  return passed();
}

function validateUnitQueueProjection(row: MemoryRow | null, fixture: FixtureIdentity): GateResult {
  if (!row) return blocked('unit_queue_projection_missing');
  const projection = { id: row.id, referral: row.referral, nextAction: row.nextAction };
  return projection.referral === fixture.referral && projection.nextAction === fixture.nextAction
    ? passed()
    : blocked('unit_queue_projection_mismatch');
}

function externalSideEffects(inMemoryRowsCreated = 0, inMemoryRowsDeleted = 0): SideEffects {
  return {
    databaseWrites: false,
    networkRequests: false,
    secretsRead: false,
    cleanupDeletes: false,
    inMemoryRowsCreated,
    inMemoryRowsDeleted,
  };
}

function invalidUnitResult(reason: string, runId: string | null): UnitAcceptanceResult {
  const inputGate = blocked(reason);
  const cleanup = notRun('unit_write_not_started');
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: 'unit-model',
    verdict: 'BLOCKED',
    safeToExecute: false,
    runId,
    fixtureId: null,
    scenario: null,
    gates: {
      unitOnlyBoundary: inputGate,
      fixtureOwnership: notRun('unit_input_rejected'),
      strictPersistenceModel: notRun('unit_input_rejected'),
      queueProjection: notRun('unit_input_rejected'),
    },
    ownership: {
      createdThisInvocation: false,
      preexistingRowsUntouched: true,
      unknownWrite: false,
    },
    cleanup,
    evidence: {
      unitContracts: 'BLOCKED',
      realIsolatedPersistence: 'NOT_RUN',
      authenticatedOperatorHttp: 'NOT_RUN',
      cleanup: cleanup.status,
    },
    blockers: inputGate.reasons,
    model: { rowsRemaining: 0 },
    sideEffects: externalSideEffects(),
  };
}

/**
 * Executes a closed deterministic model. Extra caller properties are ignored and never invoked.
 * It cannot establish real target, credential, database, authentication, or HTTP evidence.
 */
export async function runUnitAcceptanceModel(
  input: UnitAcceptanceInput,
): Promise<UnitAcceptanceResult> {
  const runId = isRunId(input.runId) ? input.runId : null;
  if (input.evidenceKind !== 'unit_model') {
    return invalidUnitResult('unit_model_evidence_kind_required', runId);
  }
  if (!runId) return invalidUnitResult('unit_run_id_invalid', null);
  const scenario = input.scenario ?? 'success';
  if (!isUnitScenario(scenario)) return invalidUnitResult('unit_scenario_unknown', runId);

  const fixture = buildFixtureIdentity(runId);
  const fixtureId = `unit-row-${runId}`;
  const invocationId = `unit-invocation-${runId}`;
  const rows = new Map<string, MemoryRow>();
  let inMemoryRowsCreated = 0;
  let inMemoryRowsDeleted = 0;
  let createdThisInvocation = false;
  let unknownWrite = false;
  let reportedFixtureId: string | null = fixtureId;
  let ownership = passed();
  let strictPersistenceModel = notRun('unit_write_not_started');
  let queueProjection = notRun('unit_persistence_not_proven');
  let cleanup = notRun('unit_write_not_started');

  if (scenario === 'preexisting_same_run' || scenario === 'concurrent_attempt') {
    rows.set(fixtureId, {
      id: fixtureId,
      ...fixture,
      ownerInvocationId: scenario === 'concurrent_attempt'
        ? 'concurrent-unit-invocation'
        : 'prior-unit-invocation',
    });
    ownership = blocked(
      scenario === 'concurrent_attempt'
        ? 'unit_concurrent_ownership_conflict'
        : 'unit_preexisting_same_run_row',
    );
    cleanup = blocked('unit_cleanup_not_authorized_for_preexisting_row');
  } else if (scenario === 'preexisting_other_run') {
    const otherFixture = buildFixtureIdentity('ffffffffffff');
    rows.set(fixtureId, {
      id: fixtureId,
      ...otherFixture,
      ownerInvocationId: 'foreign-unit-invocation',
    });
    ownership = blocked('unit_preexisting_foreign_row');
    cleanup = blocked('unit_cleanup_not_authorized_for_preexisting_row');
  } else {
    const row: MemoryRow = { id: fixtureId, ...fixture, ownerInvocationId: invocationId };
    rows.set(fixtureId, row);
    inMemoryRowsCreated += 1;
    createdThisInvocation = true;

    if (scenario === 'insert_before_lost_response') {
      reportedFixtureId = null;
      unknownWrite = true;
      ownership = blocked('unit_insert_response_lost');
      strictPersistenceModel = blocked('unit_insert_receipt_missing_owned_id');
      cleanup = blocked('unit_cleanup_unproven_without_owned_id');
    } else {
      if (scenario === 'readback_mismatch') {
        rows.set(fixtureId, { ...row, telegramUsername: 'mismatched_owner' });
      }
      strictPersistenceModel = validateMemoryReadback(
        rows.get(fixtureId) ?? null,
        fixtureId,
        fixture,
        invocationId,
      );
      if (strictPersistenceModel.status === 'PASS') {
        queueProjection = validateUnitQueueProjection(rows.get(fixtureId) ?? null, fixture);
      }

      if (strictPersistenceModel.status !== 'PASS') {
        unknownWrite = true;
        cleanup = blocked('unit_cleanup_not_authorized_after_readback_mismatch');
      } else if (scenario === 'delete_failure') {
        cleanup = blocked('unit_cleanup_delete_failed');
      } else if (scenario === 'delete_zero_count') {
        cleanup = blocked('unit_cleanup_deleted_zero_rows');
      } else {
        const deleted = rows.delete(fixtureId);
        if (deleted) inMemoryRowsDeleted += 1;
        if (!deleted) {
          cleanup = blocked('unit_cleanup_deleted_zero_rows');
        } else if (scenario === 'absence_read_failure') {
          cleanup = blocked('unit_cleanup_absence_read_failed');
        } else {
          cleanup = rows.has(fixtureId)
            ? blocked('unit_cleanup_readback_still_present')
            : passed();
        }
      }
    }
  }

  const unitOnlyBoundary = passed();
  const blockers = unique([
    ...unitOnlyBoundary.reasons,
    ...ownership.reasons,
    ...strictPersistenceModel.reasons,
    ...queueProjection.reasons,
    ...cleanup.reasons,
  ]);
  const contractPassed = blockers.length === 0
    && createdThisInvocation
    && ownership.status === 'PASS'
    && strictPersistenceModel.status === 'PASS'
    && queueProjection.status === 'PASS'
    && cleanup.status === 'PASS'
    && rows.size === 0;

  return {
    schemaVersion: SCHEMA_VERSION,
    mode: 'unit-model',
    verdict: contractPassed ? 'CONTRACT_PASS' : 'BLOCKED',
    safeToExecute: false,
    runId,
    fixtureId: reportedFixtureId,
    scenario,
    gates: {
      unitOnlyBoundary,
      fixtureOwnership: ownership,
      strictPersistenceModel,
      queueProjection,
    },
    ownership: {
      createdThisInvocation,
      preexistingRowsUntouched: !createdThisInvocation && rows.size > 0,
      unknownWrite,
    },
    cleanup,
    evidence: {
      unitContracts: contractPassed ? 'PASS' : 'BLOCKED',
      realIsolatedPersistence: 'NOT_RUN',
      authenticatedOperatorHttp: 'NOT_RUN',
      cleanup: cleanup.status,
    },
    blockers,
    model: { rowsRemaining: rows.size },
    sideEffects: externalSideEffects(inMemoryRowsCreated, inMemoryRowsDeleted),
  };
}

// Compatibility export: the former callback-based input shape is rejected by the evidenceKind gate.
export const runAcceptanceContract = runUnitAcceptanceModel;

function buildPlanReport() {
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: 'plan',
    verdict: 'PLAN_ONLY',
    safeToExecute: false,
    gates: {
      unitOnlyBoundary: notRun('unit_model_not_run'),
      realIsolatedPersistence: notRun('real_store_not_accessed'),
      authenticatedOperatorHttp: notRun('real_http_route_not_accessed'),
      cleanup: notRun('no_fixture_created'),
    },
    evidence: {
      unitContracts: 'NOT_RUN',
      realIsolatedPersistence: 'NOT_RUN',
      authenticatedOperatorHttp: 'NOT_RUN',
      cleanup: 'NOT_RUN',
    } satisfies EvidenceState,
    blockers: [
      'plan_only_is_not_security_or_acceptance_evidence',
      'real_adapter_is_not_implemented',
      'real_database_auth_http_and_cleanup_require_separate_owner_approval',
    ],
    sideEffects: externalSideEffects(),
  };
}

function buildBlockedRuntimeReport(mode: 'dry-run' | 'execute') {
  return {
    schemaVersion: SCHEMA_VERSION,
    mode,
    verdict: 'BLOCKED',
    safeToExecute: false,
    gates: {
      unitOnlyBoundary: passed(),
      realIsolatedPersistence: blocked('runtime_execution_hard_blocked'),
      authenticatedOperatorHttp: blocked('runtime_execution_hard_blocked'),
      cleanup: blocked('runtime_execution_hard_blocked'),
    },
    evidence: {
      unitContracts: 'NOT_RUN',
      realIsolatedPersistence: 'NOT_RUN',
      authenticatedOperatorHttp: 'NOT_RUN',
      cleanup: 'NOT_RUN',
    } satisfies EvidenceState,
    blockers: [
      'runtime_execution_hard_blocked',
      'unit_model_has_no_real_adapter',
      'caller_claims_cannot_authorize_persistence_or_http',
      'real_database_auth_http_and_cleanup_not_run',
    ],
    sideEffects: externalSideEffects(),
  };
}

function printReport(report: unknown): void {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function invokedAsMain(): boolean {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

function main(): void {
  const modes = process.argv.slice(2).filter((arg) => ['--plan', '--dry-run', '--execute'].includes(arg));
  if (modes.length !== 1 || process.argv.slice(2).some((arg) => !modes.includes(arg))) {
    printReport({
      schemaVersion: SCHEMA_VERSION,
      mode: 'invalid',
      verdict: 'BLOCKED',
      safeToExecute: false,
      blockers: ['exactly_one_mode_required:--plan|--dry-run|--execute'],
      sideEffects: externalSideEffects(),
    });
    process.exitCode = 2;
    return;
  }
  if (modes[0] === '--plan') {
    printReport(buildPlanReport());
    return;
  }
  const mode = modes[0] === '--execute' ? 'execute' : 'dry-run';
  printReport(buildBlockedRuntimeReport(mode));
  process.exitCode = 2;
}

if (invokedAsMain()) main();
