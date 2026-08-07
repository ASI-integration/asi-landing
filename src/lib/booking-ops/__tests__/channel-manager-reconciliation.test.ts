import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

type Row = Record<string, any>;

const {
  processInboundBookingRequest,
  canAutoSendCommunicationIntent,
  updateBookingOpsRecord,
  cancelReservation,
  getUnifiedAvailability,
  restoreReservation,
  supabaseRpc,
  supabaseFrom,
} = vi.hoisted(() => ({
  processInboundBookingRequest: vi.fn(),
  canAutoSendCommunicationIntent: vi.fn(),
  updateBookingOpsRecord: vi.fn(),
  cancelReservation: vi.fn(),
  getUnifiedAvailability: vi.fn(),
  restoreReservation: vi.fn(),
  supabaseRpc: vi.fn(),
  supabaseFrom: vi.fn(),
}));

const tables: Record<string, Row[]> = {};
function rows(table: string): Row[] { return tables[table] ?? (tables[table] = []); }

/** Injected during reconciliation_recovery guard insert to simulate post-preview Incremental Sync race. */
let raceAfterGuardAcquire: null | (() => void) = null;
/** When > 0, finalize RPC fails and decrements (forces compensation after N failures). */
let finalizeRpcFailRemaining = 0;
let finalizeRpcFailCount = 0;
/** When > 0, reconciliation item inserts fail once per decrement. */
let previewItemsInsertFailRemaining = 0;

class Query {
  private filtered: Row[];
  private deleteMode = false;
  constructor(private table: string, private options: { patch?: Row; count?: boolean; head?: boolean; deleteMode?: boolean } = {}) {
    this.filtered = [...rows(table)];
    this.deleteMode = options.deleteMode === true;
  }
  eq(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => row[column] === value); return this; }
  neq(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => row[column] !== value); return this; }
  gte(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') >= String(value)); return this; }
  lte(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') <= String(value)); return this; }
  lt(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') < String(value)); return this; }
  gt(column: string, value: unknown) { this.filtered = this.filtered.filter((row) => String(row[column] ?? '') > String(value)); return this; }
  in(column: string, values: unknown[]) { this.filtered = this.filtered.filter((row) => values.includes(row[column])); return this; }
  or() { return this; }
  order() { return this; }
  limit(value: number) { this.filtered = this.filtered.slice(0, value); return this; }
  select(_columns = '*', options?: { count?: string; head?: boolean }) {
    if (options) this.options = { ...this.options, count: Boolean(options.count), head: options.head };
    return this;
  }
  private execute() {
    if (this.deleteMode) {
      const remaining = rows(this.table).filter((row) => !this.filtered.some((item) => item.id === row.id));
      tables[this.table] = remaining;
      return { data: this.filtered, error: null, count: this.filtered.length };
    }
    if (this.options.patch) for (const row of this.filtered) Object.assign(row, this.options.patch);
    return { data: this.options.head ? null : this.filtered, error: null, count: this.options.count ? this.filtered.length : null };
  }
  async single() {
    const result = this.execute();
    return { data: result.data?.[0] ?? null, error: result.data?.[0] ? null : { message: 'not found' } };
  }
  async maybeSingle() {
    const result = this.execute();
    return { data: result.data?.[0] ?? null, error: null };
  }
  then(resolve: (value: ReturnType<Query['execute']>) => void) { resolve(this.execute()); }
}

function insertWithGuard(table: string, input: Row | Row[]) {
  const incoming = (Array.isArray(input) ? input : [input]).map((row) => ({ ...row }));
  for (const candidate of incoming) {
    const liveType = candidate.import_type === 'initial_sync'
      || candidate.import_type === 'incremental_sync'
      || candidate.import_type === 'reconciliation_recovery';
    if (table === 'booking_channel_import_runs' && liveType && candidate.status === 'running') {
      const exists = rows(table).some((row) => (
        row.connection_id === candidate.connection_id
        && (
          row.import_type === 'initial_sync'
          || row.import_type === 'incremental_sync'
          || row.import_type === 'reconciliation_recovery'
        )
        && row.status === 'running'
      ));
      if (exists) {
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint "booking_channel_import_runs_one_running_live_sync"' },
            }),
            maybeSingle: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            }),
          }),
        };
      }
    }
    if (
      table === 'booking_channel_reconciliation_runs'
      && candidate.mode === 'preview'
      && candidate.report_hash
    ) {
      const exists = rows(table).some((row) => (
        row.connection_id === candidate.connection_id
        && row.report_hash === candidate.report_hash
        && row.mode === 'preview'
      ));
      if (exists) {
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_booking_channel_reconciliation_runs_report_hash"' },
            }),
            maybeSingle: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            }),
          }),
          then: (resolve: (value: { data: null; error: { code: string; message: string } }) => void) => {
            resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            });
          },
        };
      }
    }
    if (table === 'booking_channel_reconciliation_items' && candidate.deterministic_action_key) {
      if (previewItemsInsertFailRemaining > 0) {
        previewItemsInsertFailRemaining -= 1;
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: { message: 'injected items insert failure' },
            }),
            maybeSingle: async () => ({
              data: null,
              error: { message: 'injected items insert failure' },
            }),
          }),
          then: (resolve: (value: { data: null; error: { message: string } }) => void) => {
            resolve({
              data: null,
              error: { message: 'injected items insert failure' },
            });
          },
        };
      }
      const exists = rows(table).some((row) => row.deterministic_action_key === candidate.deterministic_action_key);
      if (exists) {
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_booking_channel_reconciliation_items_action_key"' },
            }),
            maybeSingle: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            }),
          }),
          then: (resolve: (value: { data: null; error: { code: string; message: string } }) => void) => {
            resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            });
          },
        };
      }
    }
  }
  rows(table).push(...incoming);
  if (table === 'booking_channel_import_runs') {
    for (const candidate of incoming) {
      if (
        candidate.import_type === 'reconciliation_recovery'
        && candidate.status === 'running'
        && raceAfterGuardAcquire
      ) {
        raceAfterGuardAcquire();
      }
    }
  }
  const query = new Query(table);
  (query as any).filtered = incoming;
  return query;
}

const SCHEMA_READY_PAYLOAD = {
  schemaVersion: 3,
  initialSyncTypeReady: true,
  incrementalSyncTypeReady: true,
  atomicRunningGuardReady: true,
  atomicLiveSyncGuardReady: true,
  cursorStorageReady: true,
  atomicCommitRpcReady: true,
  replayFinalizeRpcReady: true,
  ready: true,
  reconciliationTypeReady: true,
  reconciliationTablesReady: true,
  reconciliationGuardReady: true,
  reconciliationFinalizeRpcReady: true,
  reconciliationReady: true,
};

function hashCheckpoint(checkpoint: string): string {
  return createHash('sha256').update(checkpoint).digest('hex').slice(0, 16);
}

function setLiveSyncLeaseInMemory(args: Record<string, unknown> = {}) {
  const connectionId = String(args.p_connection_id ?? '');
  const connection = rows('booking_channel_manager_connections').find((row) => row.id === connectionId);
  if (!connection) {
    return { data: { success: false, code: 'connection_not_found', message: 'connection not found' }, error: null };
  }
  const lease = args.p_lease && typeof args.p_lease === 'object' ? args.p_lease as Row : {};
  connection.metadata = {
    ...(connection.metadata ?? {}),
    liveSyncLease: lease,
  };
  if (args.p_updated_at) connection.updated_at = args.p_updated_at;
  return { data: { success: true }, error: null };
}

function finalizeReconciliationInMemory(args: Record<string, unknown> = {}) {
  if (finalizeRpcFailRemaining > 0) {
    finalizeRpcFailRemaining -= 1;
    finalizeRpcFailCount += 1;
    return { data: null, error: { message: 'injected finalize rpc failure' } };
  }
  const connectionId = String(args.p_connection_id ?? '');
  const importRunId = String(args.p_import_run_id ?? '');
  const reconRunId = String(args.p_reconciliation_run_id ?? '');
  const connection = rows('booking_channel_manager_connections').find((row) => row.id === connectionId);
  const importRun = rows('booking_channel_import_runs').find((row) => row.id === importRunId);
  const recon = rows('booking_channel_reconciliation_runs').find((row) => row.id === reconRunId);
  if (!connection || !importRun || !recon) {
    return { data: { success: false, code: 'not_found', message: 'missing row' }, error: null };
  }
  if (recon.report_hash !== String(args.p_expected_report_hash ?? '')) {
    return { data: { success: false, code: 'report_hash_mismatch', message: 'hash mismatch' }, error: null };
  }
  if (importRun.import_type !== 'reconciliation_recovery') {
    return { data: { success: false, code: 'invalid_import_type', message: 'wrong type' }, error: null };
  }
  if (importRun.status !== 'running') {
    return { data: { success: false, code: 'invalid_run_status', message: 'not running' }, error: null };
  }
  const finishedAt = String(args.p_finished_at ?? new Date().toISOString());
  const status = String(args.p_status ?? 'completed');
  const prevCursor = connection.metadata?.incrementalCursor
    ? { ...connection.metadata.incrementalCursor }
    : null;

  recon.status = status;
  recon.finished_at = finishedAt;
  recon.counts = args.p_counts ?? recon.counts;
  recon.safe_summary = args.p_safe_summary ?? recon.safe_summary;
  recon.safe_error = args.p_safe_error ?? recon.safe_error;
  recon.updated_at = finishedAt;

  importRun.status = status === 'failed'
    ? 'failed'
    : status === 'completed_with_blockers'
      ? 'completed_with_warnings'
      : 'completed';
  importRun.finished_at = finishedAt;
  importRun.safe_summary = args.p_safe_summary ?? importRun.safe_summary;
  importRun.updated_at = finishedAt;
  importRun.metadata = {
    ...(importRun.metadata ?? {}),
    ...((args.p_safe_run_metadata as Row) ?? {}),
    liveCore: true,
    liveCoreStage: status === 'failed' ? 'failed' : 'completed',
    reconciliationRecovery: true,
  };

  const lease = connection.metadata?.liveSyncLease as Row | undefined;
  const leaseRunId = lease ? String(lease.runId ?? '') : '';
  let leaseReleased = false;
  if (leaseRunId && leaseRunId === importRunId) {
    connection.metadata = {
      ...(connection.metadata ?? {}),
      liveSyncLease: {
        runId: importRunId,
        status: 'released',
        releasedAt: finishedAt,
        importType: 'reconciliation_recovery',
      },
    };
    leaseReleased = true;
  }
  // Never touch incrementalCursor
  if (prevCursor) {
    connection.metadata = {
      ...(connection.metadata ?? {}),
      incrementalCursor: prevCursor,
    };
  }
  connection.updated_at = finishedAt;

  return {
    data: {
      success: true,
      status,
      reconciliationRunId: reconRunId,
      importRunId,
      cursorUnchanged: true,
      leaseReleased,
      finishedAt,
    },
    error: null,
  };
}

function failReconciliationCompensationInMemory(args: Record<string, unknown> = {}) {
  const connectionId = String(args.p_connection_id ?? '');
  const importRunId = String(args.p_import_run_id ?? '');
  const reconRunId = String(args.p_reconciliation_run_id ?? '');
  const connection = rows('booking_channel_manager_connections').find((row) => row.id === connectionId);
  const importRun = rows('booking_channel_import_runs').find((row) => row.id === importRunId);
  const recon = rows('booking_channel_reconciliation_runs').find((row) => row.id === reconRunId);
  if (!connection || !importRun || !recon) {
    return { data: { success: false, code: 'not_found', message: 'missing row' }, error: null };
  }
  if (recon.report_hash !== String(args.p_expected_report_hash ?? '')) {
    return { data: { success: false, code: 'report_hash_mismatch', message: 'hash mismatch' }, error: null };
  }
  if (importRun.import_type !== 'reconciliation_recovery') {
    return { data: { success: false, code: 'invalid_import_type', message: 'wrong type' }, error: null };
  }
  const finishedAt = String(args.p_finished_at ?? new Date().toISOString());
  const prevCursor = connection.metadata?.incrementalCursor
    ? { ...connection.metadata.incrementalCursor }
    : null;
  const otherLease = connection.metadata?.liveSyncLease as Row | undefined;
  const otherLeaseSnapshot = otherLease ? { ...otherLease } : null;
  const importTerminalSuccess = importRun.status === 'completed' || importRun.status === 'completed_with_warnings';
  const reconTerminalSuccess = recon.status === 'completed' || recon.status === 'completed_with_blockers';
  const bothFailed = importRun.status === 'failed' && recon.status === 'failed';

  const releaseMatchingLease = (extra: Row = {}) => {
    const lease = connection.metadata?.liveSyncLease as Row | undefined;
    const leaseRunId = lease ? String(lease.runId ?? '') : '';
    if (leaseRunId && leaseRunId === importRunId) {
      connection.metadata = {
        ...(connection.metadata ?? {}),
        liveSyncLease: {
          runId: importRunId,
          status: 'released',
          releasedAt: finishedAt,
          importType: 'reconciliation_recovery',
          ...extra,
        },
      };
      return true;
    }
    if (otherLeaseSnapshot) {
      connection.metadata = {
        ...(connection.metadata ?? {}),
        liveSyncLease: otherLeaseSnapshot,
      };
    }
    return false;
  };

  if (importTerminalSuccess && reconTerminalSuccess) {
    const leaseReleased = releaseMatchingLease({ alreadyFinalized: true });
    if (prevCursor) {
      connection.metadata = {
        ...(connection.metadata ?? {}),
        incrementalCursor: prevCursor,
      };
    }
    return {
      data: {
        success: true,
        status: recon.status,
        alreadyFinalized: true,
        reconciliationRunId: reconRunId,
        importRunId,
        cursorUnchanged: true,
        leaseReleased,
        finishedAt: importRun.finished_at ?? recon.finished_at ?? finishedAt,
      },
      error: null,
    };
  }

  if (bothFailed) {
    const leaseReleased = releaseMatchingLease({ failCompensation: true, alreadyFailed: true });
    if (prevCursor) {
      connection.metadata = {
        ...(connection.metadata ?? {}),
        incrementalCursor: prevCursor,
      };
    }
    return {
      data: {
        success: true,
        status: 'failed',
        alreadyFailed: true,
        reconciliationRunId: reconRunId,
        importRunId,
        cursorUnchanged: true,
        leaseReleased,
        finishedAt: importRun.finished_at ?? recon.finished_at ?? finishedAt,
      },
      error: null,
    };
  }

  if (
    importTerminalSuccess
    || reconTerminalSuccess
    || importRun.status === 'failed'
    || recon.status === 'failed'
  ) {
    return {
      data: {
        success: false,
        code: 'inconsistent_terminal_state',
        message: 'import and reconciliation terminal states are inconsistent; refusing compensation rewrite',
        importStatus: importRun.status,
        reconciliationStatus: recon.status,
        cursorUnchanged: true,
      },
      error: null,
    };
  }

  if (!(importRun.status === 'running' && recon.status === 'applying')) {
    return {
      data: {
        success: false,
        code: 'invalid_compensation_state',
        message: 'compensation requires running reconciliation_recovery import and applying reconciliation run',
        importStatus: importRun.status,
        reconciliationStatus: recon.status,
        cursorUnchanged: true,
      },
      error: null,
    };
  }

  recon.status = 'failed';
  recon.finished_at = finishedAt;
  recon.safe_summary = args.p_safe_summary ?? recon.safe_summary;
  recon.safe_error = args.p_safe_error ?? recon.safe_error;
  recon.metadata = {
    ...(recon.metadata ?? {}),
    ...(args.p_safe_run_metadata as Row ?? {}),
    failCompensation: true,
  };
  recon.updated_at = finishedAt;

  importRun.status = 'failed';
  importRun.finished_at = finishedAt;
  importRun.safe_summary = args.p_safe_summary ?? importRun.safe_summary;
  importRun.updated_at = finishedAt;
  importRun.metadata = {
    ...(importRun.metadata ?? {}),
    ...(args.p_safe_run_metadata as Row ?? {}),
    liveCore: true,
    liveCoreStage: 'failed',
    failCompensation: true,
  };

  const leaseReleased = releaseMatchingLease({ failCompensation: true });
  if (prevCursor) {
    connection.metadata = {
      ...(connection.metadata ?? {}),
      incrementalCursor: prevCursor,
    };
  }
  connection.updated_at = finishedAt;
  return {
    data: {
      success: true,
      status: 'failed',
      reconciliationRunId: reconRunId,
      importRunId,
      cursorUnchanged: true,
      leaseReleased,
      finishedAt,
    },
    error: null,
  };
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => supabaseFrom(...args),
    rpc: (...args: unknown[]) => supabaseRpc(...args),
  },
}));
vi.mock('../communication-auto-send-policy', () => ({
  canAutoSendCommunicationIntent,
  attachAutoSendDecisionMetadata: (metadata: Row, decision: unknown) => ({ ...metadata, auto_send_decision: decision }),
}));
vi.mock('../real-booking-intake-autopilot', () => ({ processInboundBookingRequest }));
vi.mock('../repository', () => ({ updateBookingOpsRecord }));
vi.mock('@/lib/reservations/ledger', () => ({ cancelReservation, getUnifiedAvailability, restoreReservation }));
vi.mock('../availability-overbooking-protection', () => ({
  auditChannelImportAvailability: vi.fn(async () => []),
}));

import { initializeChannelManagerConnection } from '../channel-manager-access-import';
import {
  STALE_LIVE_SYNC_TIMEOUT_MS,
  acquireChannelLiveSyncGuard,
  clearChannelLiveCoreSchemaStateCache,
  hashCursorCheckpoint,
  recoverStaleLiveSyncRuns,
  runChannelManagerIncrementalSync,
  runChannelManagerInitialSync,
  setChannelLiveCoreSchemaReadyOverride,
  setChannelLiveCoreSchemaStateOverride,
  type ChannelLiveCommittedCursor,
  type ChannelLiveExternalBooking,
} from '../channel-manager-live-core';
import {
  APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
  analyzeChannelReconciliationDrift,
  computeReconciliationReportHash,
  computeReconciliationSnapshotHash,
  hashExternalIdentity,
  runChannelManagerReconciliationPreview,
  runChannelManagerReconciliationRecovery,
  validateChannelReconciliationSnapshot,
  type ChannelReconciliationSnapshot,
} from '../channel-manager-reconciliation';
import type { ChannelImportRun } from '../channel-manager-access-import';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROPERTY_ID = '20000000-0000-4000-8000-000000000002';
const PROPERTY_ID_B = '20000000-0000-4000-8000-000000000022';
const BOOKING_OPS_ID = '30000000-0000-4000-8000-000000000003';
const BOOKING_OPS_ID_B = '30000000-0000-4000-8000-000000000033';
const BOOKING_OPS_ID_NEW = '30000000-0000-4000-8000-000000000044';
const ACCOUNT_ID = 'account-live-core';

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    objects: [{
      external_object_id: 'ext-1',
      title: 'Лесной дом',
      city: 'Тверь',
      capacity: 4,
      property_setup_id: PROPERTY_ID,
      ...(overrides.object as Row | undefined),
    }],
    bookings: [{
      external_booking_id: 'book-1',
      external_object_id: 'ext-1',
      guest_safe_name: 'Анна',
      checkin_date: '2026-07-10',
      checkout_date: '2026-07-12',
      status: 'confirmed',
      ...(overrides.booking as Row | undefined),
    }],
    calendar: [{ external_object_id: 'ext-1', date: '2026-07-10', availability_status: 'booked' }],
    pricing: [{ external_object_id: 'ext-1', date: '2026-07-11', price_amount: 5000, currency: 'RUB' }],
  };
}

function seedBookingOps(id = BOOKING_OPS_ID, patch: Row = {}) {
  const existing = rows('booking_ops_records').find((row) => row.id === id);
  const defaults = {
    id,
    account_id: ACCOUNT_ID,
    property_id: 'prop-a',
    unit_id: null,
    guest_name: 'Анна',
    guest_count: 2,
    check_in_at: '2026-07-10T00:00:00.000Z',
    check_out_at: '2026-07-12T00:00:00.000Z',
    normalized_status: 'confirmed',
    booking_id: 'book-1',
    ...patch,
  };
  if (existing) {
    Object.assign(existing, defaults);
    return existing;
  }
  rows('booking_ops_records').push(defaults);
  return defaults;
}

async function seedInitialSync(metadata?: Record<string, unknown>) {
  const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', {
    accountId: ACCOUNT_ID,
    ...(metadata ?? {}),
  });
  const initial = await runChannelManagerInitialSync({
    connectionId: connection.id,
    snapshot: baseSnapshot(),
  });
  expect(initial.status).not.toBe('failed');
  seedBookingOps();
  const conn = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
  conn.metadata = {
    ...(conn.metadata ?? {}),
    incrementalCursor: {
      stream: 'incremental',
      checkpoint: 'cursor-seed',
      batchHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      updatedAt: '2026-08-01T10:00:00.000Z',
      sourceRunId: initial.run.id,
    },
  };
  return connection;
}

function makeBooking(overrides: Partial<ChannelLiveExternalBooking> = {}): ChannelLiveExternalBooking {
  return {
    externalBookingId: 'book-1',
    externalObjectId: 'ext-1',
    guestSafeName: 'Анна',
    checkInDate: '2026-07-10',
    checkOutDate: '2026-07-12',
    guestCount: 2,
    status: 'confirmed',
    changeKind: 'unchanged',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<ChannelReconciliationSnapshot> = {}): ChannelReconciliationSnapshot {
  return {
    snapshotKind: 'complete',
    asOf: '2026-08-07T12:00:00.000Z',
    providerCursor: null,
    bookings: [makeBooking()],
    calendar: [],
    pricing: [],
    ...overrides,
  };
}

function makeImportRun(overrides: Partial<ChannelImportRun> & { id: string }): ChannelImportRun {
  return {
    connectionId: 'conn-1',
    provider: 'manual',
    status: 'completed',
    importType: 'incremental_sync',
    startedAt: '2026-08-07T10:00:00.000Z',
    finishedAt: '2026-08-07T10:01:00.000Z',
    importedObjectsCount: 0,
    importedBookingsCount: 0,
    importedCalendarDaysCount: 0,
    importedPricesCount: 0,
    warnings: [],
    errors: [],
    safeSummary: null,
    metadata: {},
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:01:00.000Z',
    ...overrides,
  };
}

function analyze(input: Partial<Parameters<typeof analyzeChannelReconciliationDrift>[0]> & {
  snapshot: ChannelReconciliationSnapshot;
}) {
  const snapshotHash = computeReconciliationSnapshotHash(input.snapshot);
  return analyzeChannelReconciliationDrift({
    connectionId: 'conn-1',
    importedBookings: [],
    bookingOpsRecords: [],
    calendarRows: [],
    recentImportRuns: [],
    liveSyncLease: null,
    committedCursor: null,
    scope: { accountId: ACCOUNT_ID, propertyId: 'prop-a' },
    nowMs: Date.parse('2026-08-07T12:00:00.000Z'),
    snapshotHash,
    cursorHashAtPreview: null,
    ...input,
  });
}

function committedCheckpoint(connectionId?: string): string | null {
  const conn = connectionId
    ? rows('booking_channel_manager_connections').find((row) => row.id === connectionId)
    : rows('booking_channel_manager_connections')[0];
  return conn?.metadata?.incrementalCursor?.checkpoint ?? null;
}

function reconSnapshotFromState(overrides: Record<string, unknown> = {}) {
  return {
    snapshotKind: 'complete',
    asOf: '2026-08-07T12:00:00.000Z',
    bookings: [{
      external_booking_id: 'book-1',
      external_object_id: 'ext-1',
      guest_safe_name: 'Анна',
      checkin_date: '2026-07-10',
      checkout_date: '2026-07-12',
      guest_count: 2,
      status: 'confirmed',
      ...(overrides.booking as Row | undefined),
    }],
    calendar: overrides.calendar ?? [{
      external_object_id: 'ext-1',
      date: '2026-07-10',
      availability_status: 'booked',
    }],
    pricing: overrides.pricing ?? [{
      external_object_id: 'ext-1',
      date: '2026-07-11',
      price_amount: 5000,
      currency: 'RUB',
    }],
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  rows('booking_owner_setup_profiles').push({ id: OWNER_ID });
  rows('booking_property_setup_profiles').push({
    id: PROPERTY_ID,
    owner_setup_id: OWNER_ID,
    property_id: 'prop-a',
    title: 'Лесной дом',
    address_city: 'Тверь',
    guest_capacity: 4,
    channel_access_status: 'not_requested',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  rows('booking_property_setup_profiles').push({
    id: PROPERTY_ID_B,
    owner_setup_id: OWNER_ID,
    property_id: 'prop-b',
    title: 'Речной дом',
    address_city: 'Тверь',
    guest_capacity: 2,
    channel_access_status: 'not_requested',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  canAutoSendCommunicationIntent.mockReset();
  processInboundBookingRequest.mockReset();
  updateBookingOpsRecord.mockReset();
  cancelReservation.mockReset();
  getUnifiedAvailability.mockReset();
  restoreReservation.mockReset();
  supabaseRpc.mockReset();
  supabaseFrom.mockReset();
  raceAfterGuardAcquire = null;
  finalizeRpcFailRemaining = 0;
  finalizeRpcFailCount = 0;
  previewItemsInsertFailRemaining = 0;
  clearChannelLiveCoreSchemaStateCache();
  setChannelLiveCoreSchemaStateOverride(null);

  supabaseFrom.mockImplementation((table: string) => ({
    select: vi.fn((_columns = '*', options?: { count?: string; head?: boolean }) => new Query(table, { count: Boolean(options?.count), head: options?.head })),
    insert: vi.fn((input: Row | Row[]) => insertWithGuard(table, input)),
    upsert: vi.fn((input: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      const incoming = Array.isArray(input) ? input : [input];
      const affected: Row[] = [];
      for (const candidate of incoming) {
        const keys = options?.onConflict?.split(',') ?? ['id'];
        const existing = rows(table).find((row) => keys.every((key) => row[key] === candidate[key]));
        if (existing) {
          if (!options?.ignoreDuplicates) Object.assign(existing, candidate);
          affected.push(existing);
        } else {
          const stored = { ...candidate };
          rows(table).push(stored);
          affected.push(stored);
        }
      }
      const query = new Query(table);
      (query as any).filtered = affected;
      return query;
    }),
    update: vi.fn((patch: Row) => new Query(table, { patch })),
    delete: vi.fn(() => new Query(table, { deleteMode: true })),
  }));

  supabaseRpc.mockImplementation(async (fnName: string, args?: Record<string, unknown>) => {
    if (fnName === 'channel_manager_live_core_schema_state') {
      return { data: { ...SCHEMA_READY_PAYLOAD }, error: null };
    }
    if (fnName === 'channel_manager_set_live_sync_lease_v1') {
      return setLiveSyncLeaseInMemory(args ?? {});
    }
    if (fnName === 'channel_manager_finalize_reconciliation_recovery_v1') {
      return finalizeReconciliationInMemory(args ?? {});
    }
    if (fnName === 'channel_manager_fail_reconciliation_recovery_v1') {
      return failReconciliationCompensationInMemory(args ?? {});
    }
    if (fnName === 'channel_manager_commit_incremental_sync_v1') {
      // Minimal stub for incremental sync in guard tests
      const connectionId = String(args?.p_connection_id ?? '');
      const runId = String(args?.p_run_id ?? '');
      const connection = rows('booking_channel_manager_connections').find((row) => row.id === connectionId);
      const run = rows('booking_channel_import_runs').find((row) => row.id === runId);
      if (!connection || !run) return { data: { success: false }, error: null };
      const finishedAt = String(args?.p_finished_at ?? new Date().toISOString());
      const newCheckpoint = String(args?.p_new_checkpoint ?? 'cursor-new');
      connection.metadata = {
        ...(connection.metadata ?? {}),
        incrementalCursor: {
          stream: 'incremental',
          checkpoint: newCheckpoint,
          batchHash: String(args?.p_new_batch_hash ?? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
          updatedAt: finishedAt,
          sourceRunId: runId,
        },
        liveSyncLease: { runId, status: 'released', releasedAt: finishedAt, importType: 'incremental_sync' },
      };
      run.status = 'completed';
      run.finished_at = finishedAt;
      return { data: { success: true, checkpointHash: hashCheckpoint(newCheckpoint) }, error: null };
    }
    if (fnName === 'channel_manager_complete_incremental_replay_v1') {
      return { data: { success: true, replayed: true }, error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${fnName}` } };
  });

  canAutoSendCommunicationIntent.mockResolvedValue({ eligible: false, reason: 'global_off' });
  processInboundBookingRequest.mockImplementation(async (
    input: Row,
    _source?: string,
    options?: { channelManagerScope?: { accountId: string; propertyId: string } },
  ) => {
    const bookingRef = String(input.bookingReference ?? input.externalSourceId ?? '');
    const scopeAccountId = options?.channelManagerScope?.accountId || ACCOUNT_ID;
    const scopePropertyId = options?.channelManagerScope?.propertyId || String(input.propertyId ?? 'prop-a');
    const scopedExisting = rows('booking_ops_records').find((row) => (
      row.booking_id === bookingRef
      && (row.account_id === scopeAccountId || row.account_id == null)
      && (row.property_id === scopePropertyId || row.property_id == null)
    ));
    let id = scopedExisting?.id as string | undefined;
    if (!id) {
      if (bookingRef === 'book-1' || !bookingRef) id = BOOKING_OPS_ID;
      else if (bookingRef === 'book-new') id = BOOKING_OPS_ID_B;
      else id = BOOKING_OPS_ID_NEW;
    }
    const existing = rows('booking_ops_records').find((row) => row.id === id);
    let created = false;
    if (!existing) {
      created = true;
      rows('booking_ops_records').push({
        id,
        account_id: scopeAccountId,
        property_id: scopePropertyId,
        booking_id: bookingRef || null,
        guest_name: input.guestName,
        guest_count: input.guestCount ?? 2,
        check_in_at: input.checkInAt ? `${String(input.checkInAt).slice(0, 10)}T00:00:00.000Z` : null,
        check_out_at: input.checkOutAt ? `${String(input.checkOutAt).slice(0, 10)}T00:00:00.000Z` : null,
        normalized_status: 'confirmed',
        unit_id: null,
      });
    }
    return { bookingId: id, intakeStatus: created ? 'processed' : 'processed' };
  });
  updateBookingOpsRecord.mockResolvedValue({ ok: true });
  cancelReservation.mockImplementation(async (input: { reservationId: string; accountId: string }) => {
    const booking = rows('booking_ops_records').find((row) => row.id === input.reservationId && row.account_id === input.accountId);
    if (!booking) throw new Error('not_found');
    if (booking.normalized_status === 'cancelled') return { changed: false };
    booking.normalized_status = 'cancelled';
    booking.cancelled_at = new Date().toISOString();
    rows('reservation_ledger_audit').push({
      action: 'reservation_cancelled',
      account_id: input.accountId,
      booking_ops_record_id: input.reservationId,
    });
    return { changed: true };
  });
  restoreReservation.mockImplementation(async (input: { reservationId: string; accountId: string }) => {
    const booking = rows('booking_ops_records').find((row) => row.id === input.reservationId && row.account_id === input.accountId);
    if (!booking) throw new Error('not_found');
    if (booking.normalized_status !== 'cancelled') return { changed: false, blocked: false, conflicts: [] };
    booking.normalized_status = 'confirmed';
    booking.cancelled_at = null;
    rows('reservation_ledger_audit').push({
      action: 'reservation_restored',
      account_id: input.accountId,
      booking_ops_record_id: input.reservationId,
    });
    return { changed: true, blocked: false, conflicts: [] };
  });
  getUnifiedAvailability.mockResolvedValue({ available: true, conflicts: [] });
  setChannelLiveCoreSchemaReadyOverride(true);
});

describe('Channel Manager Reconciliation & Recovery v1', () => {
  describe('snapshot validation + hashes', () => {
    it('validates a complete snapshot', () => {
      const snap = validateChannelReconciliationSnapshot(reconSnapshotFromState());
      expect(snap.snapshotKind).toBe('complete');
      expect(snap.bookings).toHaveLength(1);
      expect(snap.asOf).toMatch(/2026-08-07/);
    });

    it('validates a bounded snapshot', () => {
      const snap = validateChannelReconciliationSnapshot({
        ...reconSnapshotFromState(),
        snapshotKind: 'bounded',
      });
      expect(snap.snapshotKind).toBe('bounded');
    });

    it('fails on conflicting duplicate natural keys', () => {
      expect(() => validateChannelReconciliationSnapshot({
        ...reconSnapshotFromState(),
        bookings: [
          { external_booking_id: 'book-1', status: 'confirmed', checkin_date: '2026-07-10', checkout_date: '2026-07-12' },
          { external_booking_id: 'book-1', status: 'cancelled', checkin_date: '2026-07-10', checkout_date: '2026-07-12' },
        ],
      })).toThrow(/Конфликт дубликатов|bookings/i);
    });

    it('computes deterministic snapshot and report hashes', () => {
      const a = makeSnapshot();
      const b = makeSnapshot();
      const hashA = computeReconciliationSnapshotHash(a);
      const hashB = computeReconciliationSnapshotHash(b);
      expect(hashA).toBe(hashB);
      expect(hashA).toHaveLength(64);

      const items = analyze({ snapshot: a }).map((item) => ({
        category: item.category,
        severity: item.severity,
        repairability: item.repairability,
        entityIdentity: item.entityIdentity,
        safeIntendedState: item.safeIntendedState,
      }));
      const reportA = computeReconciliationReportHash({ snapshotHash: hashA, cursorHash: null, items });
      const reportB = computeReconciliationReportHash({ snapshotHash: hashB, cursorHash: null, items: [...items].reverse() });
      expect(reportA).toBe(reportB);
    });
  });

  describe('analyzer (pure)', () => {
    it('detects missing internal booking', () => {
      const items = analyze({ snapshot: makeSnapshot() });
      expect(items.some((i) => i.category === 'booking_missing_internal')).toBe(true);
    });

    it('detects booking field drift', () => {
      const items = analyze({
        snapshot: makeSnapshot({
          bookings: [makeBooking({ checkInDate: '2026-07-11', checkOutDate: '2026-07-13', guestCount: 3 })],
        }),
        bookingOpsRecords: [{
          id: BOOKING_OPS_ID,
          booking_id: 'book-1',
          account_id: ACCOUNT_ID,
          property_id: 'prop-a',
          normalized_status: 'confirmed',
          check_in_at: '2026-07-10T00:00:00.000Z',
          check_out_at: '2026-07-12T00:00:00.000Z',
          guest_count: 2,
        }],
        importedBookings: [{
          id: 'imp-1',
          external_booking_id: 'book-1',
          matched_booking_id: BOOKING_OPS_ID,
          match_status: 'matched',
        }],
      });
      expect(items.some((i) => i.category === 'booking_field_drift')).toBe(true);
    });

    it('detects missed cancellation', () => {
      const items = analyze({
        snapshot: makeSnapshot({ bookings: [makeBooking({ status: 'cancelled', changeKind: 'cancelled' })] }),
        bookingOpsRecords: [{
          id: BOOKING_OPS_ID,
          booking_id: 'book-1',
          account_id: ACCOUNT_ID,
          property_id: 'prop-a',
          normalized_status: 'confirmed',
          check_in_at: '2026-07-10T00:00:00.000Z',
          check_out_at: '2026-07-12T00:00:00.000Z',
          guest_count: 2,
        }],
        importedBookings: [{
          id: 'imp-1',
          external_booking_id: 'book-1',
          matched_booking_id: BOOKING_OPS_ID,
          match_status: 'matched',
        }],
      });
      expect(items.some((i) => i.category === 'booking_cancel_missed')).toBe(true);
    });

    it('detects missed restoration', () => {
      const items = analyze({
        snapshot: makeSnapshot({ bookings: [makeBooking({ status: 'restored', changeKind: 'restored' })] }),
        bookingOpsRecords: [{
          id: BOOKING_OPS_ID,
          booking_id: 'book-1',
          account_id: ACCOUNT_ID,
          property_id: 'prop-a',
          normalized_status: 'cancelled',
          check_in_at: '2026-07-10T00:00:00.000Z',
          check_out_at: '2026-07-12T00:00:00.000Z',
          guest_count: 2,
        }],
        importedBookings: [{
          id: 'imp-1',
          external_booking_id: 'book-1',
          matched_booking_id: BOOKING_OPS_ID,
          match_status: 'matched',
        }],
      });
      expect(items.some((i) => i.category === 'booking_restore_missed')).toBe(true);
    });

    it('marks unchanged booking', () => {
      const items = analyze({
        snapshot: makeSnapshot(),
        bookingOpsRecords: [{
          id: BOOKING_OPS_ID,
          booking_id: 'book-1',
          account_id: ACCOUNT_ID,
          property_id: 'prop-a',
          normalized_status: 'confirmed',
          check_in_at: '2026-07-10T00:00:00.000Z',
          check_out_at: '2026-07-12T00:00:00.000Z',
          guest_count: 2,
        }],
        importedBookings: [{
          id: 'imp-1',
          external_booking_id: 'book-1',
          matched_booking_id: BOOKING_OPS_ID,
          match_status: 'matched',
        }],
      });
      expect(items.some((i) => i.category === 'booking_unchanged')).toBe(true);
    });

    it('detects calendar and pricing drift', () => {
      const items = analyze({
        snapshot: makeSnapshot({
          bookings: [],
          calendar: [{ externalObjectId: 'ext-1', date: '2026-07-10', availabilityStatus: 'available' }],
          pricing: [{ externalObjectId: 'ext-1', date: '2026-07-11', priceAmount: 7000, currency: 'RUB' }],
        }),
        calendarRows: [
          { external_object_id: 'ext-1', date: '2026-07-10', availability_status: 'booked', raw_snapshot: {} },
          {
            external_object_id: 'ext-1',
            date: '2026-07-11',
            availability_status: 'unknown',
            price_amount: 5000,
            currency: 'RUB',
            raw_snapshot: { snapshot_kind: 'pricing' },
          },
        ],
      });
      expect(items.some((i) => i.category === 'calendar_availability_drift')).toBe(true);
      expect(items.some((i) => i.category === 'pricing_value_drift')).toBe(true);
    });

    it('reports missing external only for complete snapshots', () => {
      const ops = [{
        id: BOOKING_OPS_ID,
        booking_id: 'book-ghost',
        account_id: ACCOUNT_ID,
        property_id: 'prop-a',
        normalized_status: 'confirmed',
        check_in_at: '2026-07-10T00:00:00.000Z',
        check_out_at: '2026-07-12T00:00:00.000Z',
        guest_count: 2,
      }];
      const imported = [{
        id: 'imp-ghost',
        external_booking_id: 'book-ghost',
        matched_booking_id: BOOKING_OPS_ID,
        match_status: 'matched',
      }];
      const complete = analyze({
        snapshot: makeSnapshot({ bookings: [] }),
        bookingOpsRecords: ops,
        importedBookings: imported,
      });
      const bounded = analyze({
        snapshot: makeSnapshot({ snapshotKind: 'bounded', bookings: [] }),
        bookingOpsRecords: ops,
        importedBookings: imported,
      });
      expect(complete.some((i) => i.category === 'booking_missing_external')).toBe(true);
      expect(bounded.some((i) => i.category === 'booking_missing_external')).toBe(false);
      expect(complete.find((i) => i.category === 'booking_missing_external')?.repairability).toBe('unsupported');
    });

    it('flags invalid cross-account match', () => {
      const items = analyze({
        snapshot: makeSnapshot(),
        importedBookings: [{
          id: 'imp-1',
          external_booking_id: 'book-1',
          matched_booking_id: 'outside-scope-id',
          match_status: 'matched',
        }],
        bookingOpsRecords: [],
      });
      expect(items.some((i) => i.category === 'invalid_booking_match')).toBe(true);
    });

    it('flags duplicate internal booking', () => {
      const items = analyze({
        snapshot: makeSnapshot(),
        bookingOpsRecords: [
          {
            id: BOOKING_OPS_ID,
            booking_id: 'book-1',
            account_id: ACCOUNT_ID,
            property_id: 'prop-a',
            normalized_status: 'confirmed',
            check_in_at: '2026-07-10T00:00:00.000Z',
            check_out_at: '2026-07-12T00:00:00.000Z',
            guest_count: 2,
          },
          {
            id: BOOKING_OPS_ID_B,
            booking_id: 'book-1',
            account_id: ACCOUNT_ID,
            property_id: 'prop-a',
            normalized_status: 'confirmed',
            check_in_at: '2026-07-10T00:00:00.000Z',
            check_out_at: '2026-07-12T00:00:00.000Z',
            guest_count: 2,
          },
        ],
      });
      expect(items.some((i) => i.category === 'duplicate_internal_booking')).toBe(true);
    });

    it('detects stale run, lease mismatch, and cursor source-run mismatch', () => {
      const nowMs = Date.parse('2026-08-07T12:00:00.000Z');
      const staleStarted = new Date(nowMs - STALE_LIVE_SYNC_TIMEOUT_MS - 1).toISOString();
      const items = analyze({
        snapshot: makeSnapshot({ bookings: [] }),
        nowMs,
        recentImportRuns: [
          makeImportRun({
            id: 'run-stale',
            status: 'running',
            importType: 'incremental_sync',
            startedAt: staleStarted,
            createdAt: staleStarted,
          }),
          makeImportRun({
            id: 'run-cursor',
            status: 'failed',
            importType: 'incremental_sync',
          }),
        ],
        liveSyncLease: { runId: 'missing-run', status: 'held' },
        committedCursor: {
          stream: 'incremental',
          checkpoint: 'cursor-x',
          batchHash: 'hash',
          updatedAt: '2026-08-07T11:00:00.000Z',
          sourceRunId: 'run-cursor',
        } satisfies ChannelLiveCommittedCursor,
      });
      expect(items.some((i) => i.category === 'stale_running_sync')).toBe(true);
      expect(items.some((i) => i.category === 'lease_run_mismatch')).toBe(true);
      expect(items.find((i) => i.category === 'lease_run_mismatch')?.repairability).toBe('operator_review');
      expect(items.some((i) => i.category === 'cursor_run_status_mismatch')).toBe(true);
    });

    it('keeps no raw checkpoint or PII in safe_* / report hash inputs', () => {
      const phone = '+79991234567';
      const email = 'guest@example.com';
      const items = analyze({
        snapshot: makeSnapshot({
          providerCursor: { stream: 'incremental', checkpoint: 'raw-secret-checkpoint' },
          bookings: [makeBooking({ guestSafeName: 'Анна' })],
        }),
        bookingOpsRecords: [{
          id: BOOKING_OPS_ID,
          booking_id: 'book-1',
          account_id: ACCOUNT_ID,
          property_id: 'prop-a',
          normalized_status: 'confirmed',
          check_in_at: '2026-07-10T00:00:00.000Z',
          check_out_at: '2026-07-12T00:00:00.000Z',
          guest_count: 2,
          guest_phone: phone,
          guest_email: email,
          guest_name: 'Иван Иванов',
        }],
        importedBookings: [{
          id: 'imp-1',
          external_booking_id: 'book-1',
          matched_booking_id: BOOKING_OPS_ID,
          match_status: 'matched',
        }],
        committedCursor: {
          stream: 'incremental',
          checkpoint: 'raw-secret-checkpoint',
          batchHash: 'x',
          updatedAt: '2026-08-07T11:00:00.000Z',
          sourceRunId: 'run-ok',
        },
        recentImportRuns: [makeImportRun({ id: 'run-ok', status: 'completed' })],
      });
      const serialized = JSON.stringify(items);
      expect(serialized).not.toContain('raw-secret-checkpoint');
      expect(serialized).not.toContain(phone);
      expect(serialized).not.toContain(email);
      expect(serialized).not.toContain('Иван Иванов');
      // When cursors differ, only hashed checkpoint appears in safe_* — never raw.
      const withDiff = analyze({
        snapshot: makeSnapshot({
          providerCursor: { stream: 'incremental', checkpoint: 'raw-secret-checkpoint' },
          bookings: [],
        }),
        committedCursor: {
          stream: 'incremental',
          checkpoint: 'other-checkpoint',
          batchHash: 'x',
          updatedAt: '2026-08-07T11:00:00.000Z',
          sourceRunId: 'run-ok',
        },
        recentImportRuns: [makeImportRun({ id: 'run-ok', status: 'completed' })],
      });
      const diffSerialized = JSON.stringify(withDiff);
      expect(diffSerialized).not.toContain('raw-secret-checkpoint');
      expect(diffSerialized).not.toContain('other-checkpoint');
      expect(diffSerialized).toContain(hashCursorCheckpoint('raw-secret-checkpoint'));
      expect(diffSerialized).toContain(hashCursorCheckpoint('other-checkpoint'));
      const reportHash = computeReconciliationReportHash({
        snapshotHash: computeReconciliationSnapshotHash(makeSnapshot()),
        cursorHash: hashCursorCheckpoint('raw-secret-checkpoint'),
        items: items.map((item) => ({
          category: item.category,
          severity: item.severity,
          repairability: item.repairability,
          entityIdentity: item.entityIdentity,
          safeIntendedState: item.safeIntendedState,
        })),
      });
      expect(reportHash).not.toContain('raw-secret-checkpoint');
      expect(hashExternalIdentity('book-1')).toHaveLength(32);
    });
  });

  describe('preview engine', () => {
    it('is idempotent for repeated preview (same report hash, no duplicate items)', async () => {
      const connection = await seedInitialSync();
      const snapshot = reconSnapshotFromState();
      const first = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      const second = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      expect(second.reportHash).toBe(first.reportHash);
      expect(second.runId).toBe(first.runId);
      const itemRows = rows('booking_channel_reconciliation_items').filter(
        (row) => row.reconciliation_run_id === first.runId,
      );
      const keys = itemRows.map((row) => row.deterministic_action_key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(rows('booking_channel_reconciliation_runs').filter((row) => (
        row.connection_id === connection.id && row.mode === 'preview' && row.report_hash === first.reportHash
      ))).toHaveLength(1);
    });

    it('makes no business mutations', async () => {
      const connection = await seedInitialSync();
      cancelReservation.mockClear();
      updateBookingOpsRecord.mockClear();
      processInboundBookingRequest.mockClear();
      restoreReservation.mockClear();
      await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot: reconSnapshotFromState({
          booking: { status: 'cancelled', checkin_date: '2026-07-10', checkout_date: '2026-07-12' },
        }),
      });
      expect(cancelReservation).not.toHaveBeenCalled();
      expect(updateBookingOpsRecord).not.toHaveBeenCalled();
      expect(processInboundBookingRequest).not.toHaveBeenCalled();
      expect(restoreReservation).not.toHaveBeenCalled();
    });
  });

  describe('apply engine', () => {
    async function previewThenApply(
      connectionId: string,
      snapshot: Record<string, unknown>,
      phrase = APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
    ) {
      const preview = await runChannelManagerReconciliationPreview({ connectionId, snapshot });
      const report = await runChannelManagerReconciliationRecovery({
        connectionId,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: phrase,
        snapshot,
      });
      return { preview, report };
    }

    it('requires confirmation phrase', async () => {
      const connection = await seedInitialSync();
      const snapshot = reconSnapshotFromState();
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      await expect(runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: 'WRONG',
        snapshot,
      })).rejects.toMatchObject({ code: 'confirmation_mismatch' });
    });

    it('safe booking create', async () => {
      const connection = await seedInitialSync();
      // Remove matched ops so create path triggers
      tables.booking_ops_records = [];
      for (const imp of rows('booking_channel_imported_bookings')) {
        imp.matched_booking_id = null;
        imp.match_status = 'unmatched';
      }
      processInboundBookingRequest.mockClear();
      const { report } = await previewThenApply(connection.id, reconSnapshotFromState({
        booking: { external_booking_id: 'book-new', status: 'confirmed' },
      }));
      expect(['completed', 'completed_with_blockers']).toContain(report.status);
      expect(report.items.some((i) => (
        i.category === 'booking_missing_internal' && (i.status === 'applied' || i.status === 'skipped')
      ))).toBe(true);
      expect(processInboundBookingRequest).toHaveBeenCalled();
      expect(committedCheckpoint(connection.id)).toBe('cursor-seed');
    });

    it('safe booking update', async () => {
      const connection = await seedInitialSync();
      updateBookingOpsRecord.mockClear();
      const { report } = await previewThenApply(connection.id, reconSnapshotFromState({
        booking: {
          checkin_date: '2026-07-11',
          checkout_date: '2026-07-13',
          guest_count: 4,
        },
      }));
      expect(['completed', 'completed_with_blockers']).toContain(report.status);
      expect(updateBookingOpsRecord).toHaveBeenCalled();
      expect(committedCheckpoint(connection.id)).toBe('cursor-seed');
    });

    it('missed cancellation', async () => {
      const connection = await seedInitialSync();
      cancelReservation.mockClear();
      const { report } = await previewThenApply(connection.id, reconSnapshotFromState({
        booking: { status: 'cancelled' },
      }));
      expect(cancelReservation).toHaveBeenCalled();
      expect(report.items.some((i) => i.category === 'booking_cancel_missed' && i.status === 'applied')).toBe(true);
      expect(rows('reservation_ledger_audit').filter((r) => r.action === 'reservation_cancelled')).toHaveLength(1);
    });

    it('missed restoration', async () => {
      const connection = await seedInitialSync();
      seedBookingOps(BOOKING_OPS_ID, { normalized_status: 'cancelled' });
      restoreReservation.mockClear();
      const { report } = await previewThenApply(connection.id, reconSnapshotFromState({
        booking: { status: 'restored' },
      }));
      expect(restoreReservation).toHaveBeenCalled();
      expect(report.items.some((i) => i.category === 'booking_restore_missed' && i.status === 'applied')).toBe(true);
    });

    it('overbooking-blocked restoration', async () => {
      const connection = await seedInitialSync();
      seedBookingOps(BOOKING_OPS_ID, { normalized_status: 'cancelled' });
      restoreReservation.mockResolvedValueOnce({
        changed: false,
        blocked: true,
        conflicts: [{ id: 'other' }],
      });
      const { report } = await previewThenApply(connection.id, reconSnapshotFromState({
        booking: { status: 'restored' },
      }));
      expect(report.items.some((i) => i.category === 'booking_restore_missed' && i.status === 'blocked')).toBe(true);
      expect(report.status).toBe('completed_with_blockers');
    });

    it('calendar repair / pricing repair', async () => {
      const connection = await seedInitialSync();
      // Clear calendar so missing_internal paths fire
      tables.booking_channel_calendar_snapshots = [];
      const { report } = await previewThenApply(connection.id, reconSnapshotFromState({
        calendar: [{ external_object_id: 'ext-1', date: '2026-08-01', availability_status: 'available' }],
        pricing: [{ external_object_id: 'ext-1', date: '2026-08-02', price_amount: 9000, currency: 'RUB' }],
      }));
      expect(report.items.some((i) => (
        (i.category === 'calendar_day_missing_internal' || i.category === 'pricing_missing_internal')
        && i.status === 'applied'
      ))).toBe(true);
      expect(committedCheckpoint(connection.id)).toBe('cursor-seed');
    });

    it('missing external never auto-cancelled', async () => {
      const connection = await seedInitialSync();
      seedBookingOps(BOOKING_OPS_ID_B, {
        booking_id: 'book-ghost',
        normalized_status: 'confirmed',
      });
      rows('booking_channel_imported_bookings').push({
        id: 'imp-ghost',
        connection_id: connection.id,
        external_booking_id: 'book-ghost',
        matched_booking_id: BOOKING_OPS_ID_B,
        match_status: 'matched',
      });
      cancelReservation.mockClear();
      const { report } = await previewThenApply(connection.id, reconSnapshotFromState({
        // complete snapshot without book-ghost
        bookings: [{
          external_booking_id: 'book-1',
          external_object_id: 'ext-1',
          checkin_date: '2026-07-10',
          checkout_date: '2026-07-12',
          guest_count: 2,
          status: 'confirmed',
        }],
      }));
      const missing = report.items.filter((i) => i.category === 'booking_missing_external');
      expect(missing.length).toBeGreaterThan(0);
      expect(missing.every((i) => i.status === 'skipped' || i.status === 'detected')).toBe(true);
      // cancel may run for other categories; ensure ghost booking was not cancelled
      const ghost = rows('booking_ops_records').find((row) => row.id === BOOKING_OPS_ID_B);
      expect(ghost?.normalized_status).toBe('confirmed');
    });

    it('rejects stale report when cursor changes', async () => {
      const connection = await seedInitialSync();
      const snapshot = reconSnapshotFromState();
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      const conn = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
      conn.metadata = {
        ...(conn.metadata ?? {}),
        incrementalCursor: {
          ...(conn.metadata.incrementalCursor ?? {}),
          checkpoint: 'cursor-changed',
        },
      };
      await expect(runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      })).rejects.toMatchObject({ code: 'report_stale_cursor' });
    });

    it('rejects stale report after newer live-sync success', async () => {
      const connection = await seedInitialSync();
      const snapshot = reconSnapshotFromState();
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      const newerFinished = new Date(Date.parse(preview.startedAt!) + 60_000).toISOString();
      rows('booking_channel_import_runs').push({
        id: '90000000-0000-4000-8000-000000000099',
        connection_id: connection.id,
        provider: 'manual',
        status: 'completed',
        import_type: 'incremental_sync',
        started_at: newerFinished,
        finished_at: newerFinished,
        created_at: newerFinished,
        updated_at: newerFinished,
        imported_objects_count: 0,
        imported_bookings_count: 0,
        imported_calendar_days_count: 0,
        imported_prices_count: 0,
        warnings: [],
        errors: [],
        metadata: {},
      });
      await expect(runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      })).rejects.toMatchObject({ code: 'report_stale_sync' });
    });

    it('concurrent Incremental Sync blocks recovery', async () => {
      const connection = await seedInitialSync();
      const guard = await acquireChannelLiveSyncGuard(connection.id, { importType: 'incremental_sync' });
      expect(guard.ok).toBe(true);
      const snapshot = reconSnapshotFromState();
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      await expect(runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      })).rejects.toMatchObject({ code: 'execution_guard' });
    });

    it('recovery blocks Initial/Incremental Sync', async () => {
      const connection = await seedInitialSync();
      const acquired = await acquireChannelLiveSyncGuard(connection.id, {
        importType: 'reconciliation_recovery',
      });
      expect(acquired.ok).toBe(true);
      const blocked = await acquireChannelLiveSyncGuard(connection.id, {
        importType: 'incremental_sync',
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.code).toBe('execution_guard');
    });

    it('different connections remain independent', async () => {
      const a = await seedInitialSync();
      const b = await initializeChannelManagerConnection(PROPERTY_ID_B, 'manual', { accountId: ACCOUNT_ID });
      await runChannelManagerInitialSync({
        connectionId: b.id,
        snapshot: {
          ...baseSnapshot(),
          objects: [{
            external_object_id: 'ext-2',
            title: 'Речной дом',
            city: 'Тверь',
            capacity: 2,
            property_setup_id: PROPERTY_ID_B,
          }],
          bookings: [],
        },
      });
      const guardA = await acquireChannelLiveSyncGuard(a.id, { importType: 'reconciliation_recovery' });
      const guardB = await acquireChannelLiveSyncGuard(b.id, { importType: 'incremental_sync' });
      expect(guardA.ok).toBe(true);
      expect(guardB.ok).toBe(true);
    });

    it('partial failure result and action-key idempotency / no duplicate ledger', async () => {
      const connection = await seedInitialSync();
      // Force cancel path + a second repair that fails
      let updateCalls = 0;
      updateBookingOpsRecord.mockImplementation(async () => {
        updateCalls += 1;
        return { ok: false, error: 'forced update failure' };
      });

      // Two drifts: cancel book-1, and field drift won't apply via update if we only cancel...
      // Use cancel + a calendar repair that we can fail by emptying snapshot day after preview — instead:
      // apply cancel successfully, and make restore path not present; inject failed update via field drift booking.
      seedBookingOps(BOOKING_OPS_ID, { normalized_status: 'confirmed', guest_count: 2 });
      const snapshot = reconSnapshotFromState({
        booking: {
          status: 'cancelled',
          checkin_date: '2026-07-10',
          checkout_date: '2026-07-12',
          guest_count: 2,
        },
      });
      // Also add a second booking needing create that will fail processInbound
      const snap2 = {
        ...snapshot,
        bookings: [
          ...(snapshot.bookings as Row[]),
          {
            external_booking_id: 'book-fail',
            external_object_id: 'ext-1',
            checkin_date: '2026-08-01',
            checkout_date: '2026-08-03',
            guest_count: 1,
            status: 'confirmed',
          },
        ],
      };
      processInboundBookingRequest.mockImplementation(async (input: Row) => {
        const ref = String(input.bookingReference ?? input.externalSourceId ?? '');
        if (ref === 'book-fail') throw new Error('forced create failure');
        return {
          bookingId: BOOKING_OPS_ID,
          intakeStatus: 'processed',
        };
      });

      const { preview, report } = await previewThenApply(connection.id, snap2);
      expect(['completed_with_blockers', 'failed', 'completed']).toContain(report.status);
      expect(rows('reservation_ledger_audit').filter((r) => r.action === 'reservation_cancelled').length).toBeLessThanOrEqual(1);

      // Reset run for retry: keep applied items, re-plan failed
      const run = rows('booking_channel_reconciliation_runs').find((row) => row.id === preview.runId)!;
      run.status = 'preview_ready';
      run.mode = 'preview';
      for (const item of rows('booking_channel_reconciliation_items').filter((row) => row.reconciliation_run_id === preview.runId)) {
        if (item.status === 'applied') continue;
        if (item.status === 'failed') item.status = 'planned';
      }
      // Finish any lingering running import runs
      for (const r of rows('booking_channel_import_runs')) {
        if (r.status === 'running') {
          r.status = 'failed';
          r.finished_at = new Date().toISOString();
        }
      }

      cancelReservation.mockClear();
      const ledgerBefore = rows('reservation_ledger_audit').length;
      const retry = await runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot: snap2,
      });
      // Applied cancel should not duplicate ledger
      expect(rows('reservation_ledger_audit').filter((r) => r.action === 'reservation_cancelled')).toHaveLength(1);
      expect(rows('reservation_ledger_audit').length).toBe(ledgerBefore);
      expect(retry).toBeTruthy();
      void updateCalls;
    });

    it('always releases live-sync guard and never changes incremental cursor', async () => {
      const connection = await seedInitialSync();
      const before = committedCheckpoint(connection.id);
      const { report } = await previewThenApply(connection.id, reconSnapshotFromState({
        booking: { status: 'cancelled' },
      }));
      expect(report.status).not.toBe('failed');
      expect(committedCheckpoint(connection.id)).toBe(before);
      const running = rows('booking_channel_import_runs').filter((row) => (
        row.connection_id === connection.id
        && row.import_type === 'reconciliation_recovery'
        && row.status === 'running'
      ));
      expect(running).toHaveLength(0);
      const conn = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
      expect(conn.metadata?.liveSyncLease?.status).toBe('released');
    });

    it('post-guard cursor race rejects with zero business mutations', async () => {
      const connection = await seedInitialSync();
      const snapshot = reconSnapshotFromState({ booking: { status: 'cancelled' } });
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      expect(preview.status).toBe('preview_ready');
      const beforeCursor = committedCheckpoint(connection.id);
      cancelReservation.mockClear();
      updateBookingOpsRecord.mockClear();
      processInboundBookingRequest.mockClear();
      restoreReservation.mockClear();
      const ledgerBefore = rows('reservation_ledger_audit').length;
      const tasksBefore = rows('booking_ops_tasks')?.length ?? 0;
      const communicationsBefore = rows('booking_ops_communications')?.length ?? 0;
      const calendarBefore = rows('booking_channel_calendar_snapshots').length;
      const pricingBefore = rows('booking_channel_calendar_snapshots').filter((r) => (
        r.raw_snapshot?.snapshot_kind === 'pricing'
      )).length;

      raceAfterGuardAcquire = () => {
        const conn = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
        conn.metadata = {
          ...(conn.metadata ?? {}),
          incrementalCursor: {
            ...(conn.metadata.incrementalCursor ?? {}),
            checkpoint: 'cursor-B-after-preview',
            updatedAt: new Date().toISOString(),
          },
        };
        const finishedAt = new Date(Date.parse(preview.startedAt!) + 120_000).toISOString();
        rows('booking_channel_import_runs').push({
          id: '91000000-0000-4000-8000-000000000001',
          connection_id: connection.id,
          provider: 'manual',
          status: 'completed',
          import_type: 'incremental_sync',
          started_at: finishedAt,
          finished_at: finishedAt,
          created_at: finishedAt,
          updated_at: finishedAt,
          imported_objects_count: 0,
          imported_bookings_count: 0,
          imported_calendar_days_count: 0,
          imported_prices_count: 0,
          warnings: [],
          errors: [],
          metadata: {},
        });
      };

      await expect(runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      })).rejects.toMatchObject({ code: 'report_stale_after_guard' });

      expect(cancelReservation).not.toHaveBeenCalled();
      expect(updateBookingOpsRecord).not.toHaveBeenCalled();
      expect(processInboundBookingRequest).not.toHaveBeenCalled();
      expect(restoreReservation).not.toHaveBeenCalled();
      expect(rows('reservation_ledger_audit').length).toBe(ledgerBefore);
      expect(rows('booking_ops_tasks')?.length ?? 0).toBe(tasksBefore);
      expect(rows('booking_ops_communications')?.length ?? 0).toBe(communicationsBefore);
      expect(rows('booking_channel_calendar_snapshots').length).toBe(calendarBefore);
      expect(rows('booking_channel_calendar_snapshots').filter((r) => (
        r.raw_snapshot?.snapshot_kind === 'pricing'
      )).length).toBe(pricingBefore);
      expect(committedCheckpoint(connection.id)).toBe('cursor-B-after-preview');
      expect(beforeCursor).toBe('cursor-seed');
      const recon = rows('booking_channel_reconciliation_runs').find((row) => row.id === preview.runId)!;
      expect(recon.status).toBe('preview_ready');
      const runningRecon = rows('booking_channel_import_runs').filter((row) => (
        row.connection_id === connection.id
        && row.import_type === 'reconciliation_recovery'
        && row.status === 'running'
      ));
      expect(runningRecon).toHaveLength(0);
      const failedReconImports = rows('booking_channel_import_runs').filter((row) => (
        row.connection_id === connection.id
        && row.import_type === 'reconciliation_recovery'
        && row.status === 'failed'
      ));
      expect(failedReconImports.length).toBeGreaterThan(0);
    });

    it('post-guard newer-success race rejects even when cursor hash unchanged', async () => {
      const connection = await seedInitialSync();
      const snapshot = reconSnapshotFromState({ booking: { status: 'cancelled' } });
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      cancelReservation.mockClear();
      updateBookingOpsRecord.mockClear();

      raceAfterGuardAcquire = () => {
        // Same cursor hash, but a newer successful incremental sync finished after preview.
        const finishedAt = new Date(Date.parse(preview.startedAt!) + 90_000).toISOString();
        rows('booking_channel_import_runs').push({
          id: '91000000-0000-4000-8000-000000000002',
          connection_id: connection.id,
          provider: 'manual',
          status: 'completed',
          import_type: 'incremental_sync',
          started_at: finishedAt,
          finished_at: finishedAt,
          created_at: finishedAt,
          updated_at: finishedAt,
          imported_objects_count: 0,
          imported_bookings_count: 0,
          imported_calendar_days_count: 0,
          imported_prices_count: 0,
          warnings: [],
          errors: [],
          metadata: {},
        });
      };

      await expect(runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      })).rejects.toMatchObject({ code: 'report_stale_after_guard' });

      expect(cancelReservation).not.toHaveBeenCalled();
      expect(updateBookingOpsRecord).not.toHaveBeenCalled();
      expect(committedCheckpoint(connection.id)).toBe('cursor-seed');
      const recon = rows('booking_channel_reconciliation_runs').find((row) => row.id === preview.runId)!;
      expect(recon.status).toBe('preview_ready');
      expect(rows('booking_channel_import_runs').filter((row) => (
        row.import_type === 'reconciliation_recovery' && row.status === 'running'
      ))).toHaveLength(0);
    });

    async function seedUnmatchedMatchRepair(connectionId: string) {
      for (const imp of rows('booking_channel_imported_bookings').filter((row) => row.connection_id === connectionId)) {
        if (imp.external_booking_id === 'book-1') {
          imp.matched_booking_id = null;
          imp.match_status = 'unmatched';
        }
      }
      seedBookingOps(BOOKING_OPS_ID, {
        booking_id: 'book-1',
        account_id: ACCOUNT_ID,
        property_id: 'prop-a',
        normalized_status: 'confirmed',
      });
    }

    it('match repair blocks when target moves cross-account after preview', async () => {
      const connection = await seedInitialSync();
      await seedUnmatchedMatchRepair(connection.id);
      const snapshot = reconSnapshotFromState();
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      expect(preview.items.some((i) => (
        i.category === 'booking_field_drift' && i.safeAfter?.matchStatus === 'matched'
      ))).toBe(true);
      seedBookingOps(BOOKING_OPS_ID, { account_id: 'other-account', property_id: 'prop-a' });
      const report = await runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      });
      expect(report.items.some((i) => (
        i.status === 'blocked' && String(i.safeMessage ?? '').includes('аккаунт')
      ))).toBe(true);
      const imported = rows('booking_channel_imported_bookings').find((row) => row.external_booking_id === 'book-1');
      expect(imported?.matched_booking_id).toBeNull();
    });

    it('match repair blocks when target moves cross-property after preview', async () => {
      const connection = await seedInitialSync();
      await seedUnmatchedMatchRepair(connection.id);
      const snapshot = reconSnapshotFromState();
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      seedBookingOps(BOOKING_OPS_ID, { account_id: ACCOUNT_ID, property_id: 'prop-b' });
      const report = await runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      });
      expect(report.items.some((i) => i.status === 'blocked')).toBe(true);
      const imported = rows('booking_channel_imported_bookings').find((row) => row.external_booking_id === 'book-1');
      expect(imported?.matched_booking_id).toBeNull();
      expect(committedCheckpoint(connection.id)).toBe('cursor-seed');
    });

    it('match repair blocks when canonical duplicate appears after preview', async () => {
      const connection = await seedInitialSync();
      await seedUnmatchedMatchRepair(connection.id);
      const snapshot = reconSnapshotFromState();
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      seedBookingOps(BOOKING_OPS_ID_B, {
        booking_id: 'book-1',
        account_id: ACCOUNT_ID,
        property_id: 'prop-a',
        normalized_status: 'confirmed',
      });
      const report = await runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      });
      expect(report.items.some((i) => i.status === 'blocked' && String(i.safeMessage ?? '').includes('дубликат'))).toBe(true);
      const imported = rows('booking_channel_imported_bookings').find((row) => row.external_booking_id === 'book-1');
      expect(imported?.matched_booking_id).toBeNull();
    });

    it('match repair blocks when target disappears after preview', async () => {
      const connection = await seedInitialSync();
      await seedUnmatchedMatchRepair(connection.id);
      const snapshot = reconSnapshotFromState();
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      tables.booking_ops_records = rows('booking_ops_records').filter((row) => row.id !== BOOKING_OPS_ID);
      const report = await runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      });
      expect(report.items.some((i) => i.status === 'blocked' && String(i.safeMessage ?? '').includes('исчезла'))).toBe(true);
      const imported = rows('booking_channel_imported_bookings').find((row) => row.external_booking_id === 'book-1');
      expect(imported?.matched_booking_id).toBeNull();
    });

    it('genuine status drift cancel persists via ledger and verifies state', async () => {
      const connection = await seedInitialSync();
      seedBookingOps(BOOKING_OPS_ID, { normalized_status: 'confirmed' });
      const snapshot = reconSnapshotFromState({ booking: { status: 'cancelled' } });
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      const cancelItem = rows('booking_channel_reconciliation_items').find((row) => (
        row.reconciliation_run_id === preview.runId && row.category === 'booking_cancel_missed'
      ));
      expect(cancelItem).toBeTruthy();
      // Force status_drift path while keeping cancel intended state.
      cancelItem!.category = 'booking_status_drift';
      cancelItem!.safe_after = {
        ...(cancelItem!.safe_after ?? {}),
        status: 'cancelled',
        safeIntendedState: 'status:cancelled',
        entityIdentity: cancelItem!.safe_after?.entityIdentity ?? `booking:${hashExternalIdentity('book-1')}`,
      };
      cancelReservation.mockClear();
      const report = await runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      });
      expect(cancelReservation).toHaveBeenCalledWith(expect.objectContaining({
        accountId: ACCOUNT_ID,
        reservationId: BOOKING_OPS_ID,
      }));
      expect(report.items.some((i) => i.category === 'booking_status_drift' && i.status === 'applied')).toBe(true);
      expect(rows('booking_ops_records').find((row) => row.id === BOOKING_OPS_ID)?.normalized_status).toBe('cancelled');
      expect(rows('reservation_ledger_audit').some((r) => r.action === 'reservation_cancelled')).toBe(true);
    });

    it('unsupported status drift is not falsely marked applied', async () => {
      const connection = await seedInitialSync();
      seedBookingOps(BOOKING_OPS_ID, { normalized_status: 'confirmed' });
      const snapshot = reconSnapshotFromState();
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      const unchanged = rows('booking_channel_reconciliation_items').find((row) => (
        row.reconciliation_run_id === preview.runId && row.category === 'booking_unchanged'
      ));
      expect(unchanged).toBeTruthy();
      unchanged!.category = 'booking_status_drift';
      unchanged!.repairability = 'safe_auto';
      unchanged!.status = 'planned';
      unchanged!.booking_ops_record_id = BOOKING_OPS_ID;
      unchanged!.safe_before = { ...(unchanged!.safe_before ?? {}), status: 'confirmed' };
      unchanged!.safe_after = {
        ...(unchanged!.safe_after ?? {}),
        status: 'modified',
        safeIntendedState: 'status:modified',
        entityIdentity: unchanged!.safe_after?.entityIdentity ?? `booking:${hashExternalIdentity('book-1')}`,
      };
      cancelReservation.mockClear();
      restoreReservation.mockClear();
      updateBookingOpsRecord.mockClear();
      const report = await runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      });
      expect(report.items.some((i) => i.category === 'booking_status_drift' && i.status === 'blocked')).toBe(true);
      expect(report.items.some((i) => i.category === 'booking_status_drift' && i.status === 'applied')).toBe(false);
      expect(cancelReservation).not.toHaveBeenCalled();
      expect(restoreReservation).not.toHaveBeenCalled();
      expect(rows('booking_ops_records').find((row) => row.id === BOOKING_OPS_ID)?.normalized_status).toBe('confirmed');
    });

    it('status drift never mutates cross-account or cross-property bookings', async () => {
      const connection = await seedInitialSync();
      seedBookingOps(BOOKING_OPS_ID, {
        normalized_status: 'confirmed',
        account_id: 'foreign-account',
        property_id: 'prop-a',
      });
      const snapshot = reconSnapshotFromState({ booking: { status: 'cancelled' } });
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      // Manually plan a status drift targeting the foreign-account row id still stored in item.
      const item = rows('booking_channel_reconciliation_items').find((row) => row.reconciliation_run_id === preview.runId);
      if (item) {
        item.category = 'booking_status_drift';
        item.repairability = 'safe_auto';
        item.status = 'planned';
        item.booking_ops_record_id = BOOKING_OPS_ID;
        item.safe_after = {
          ...(item.safe_after ?? {}),
          status: 'cancelled',
          safeIntendedState: 'status:cancelled',
        };
      }
      cancelReservation.mockClear();
      const report = await runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      });
      expect(cancelReservation).not.toHaveBeenCalled();
      expect(rows('booking_ops_records').find((row) => row.id === BOOKING_OPS_ID)?.normalized_status).toBe('confirmed');
      expect(report.items.some((i) => i.category === 'booking_status_drift' && i.status === 'blocked')).toBe(true);
    });

    it('finalization RPC failure uses compensation without orphan running guard', async () => {
      const connection = await seedInitialSync();
      const beforeCursor = committedCheckpoint(connection.id);
      const snapshot = reconSnapshotFromState({ booking: { status: 'cancelled' } });
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      // Fail success finalize + failure finalize so compensation RPC must run.
      finalizeRpcFailRemaining = 2;
      await expect(runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      })).rejects.toThrow(/injected finalize rpc failure/);

      expect(finalizeRpcFailCount).toBe(2);
      expect(committedCheckpoint(connection.id)).toBe(beforeCursor);
      expect(rows('booking_channel_import_runs').filter((row) => (
        row.connection_id === connection.id
        && row.import_type === 'reconciliation_recovery'
        && row.status === 'running'
      ))).toHaveLength(0);
      const recon = rows('booking_channel_reconciliation_runs').find((row) => row.id === preview.runId)!;
      expect(recon.status).toBe('failed');
      expect(recon.metadata?.failCompensation).toBe(true);
    });

    it('finalization failure compensation leaves cursor unchanged and surfaces failure', async () => {
      const connection = await seedInitialSync();
      const snapshot = reconSnapshotFromState({ booking: { status: 'cancelled' } });
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      const beforeCursor = committedCheckpoint(connection.id);
      const otherRunId = '94000000-0000-4000-8000-000000000044';
      rows('booking_channel_import_runs').push({
        id: otherRunId,
        connection_id: connection.id,
        provider: 'manual',
        status: 'completed',
        import_type: 'incremental_sync',
        started_at: '2026-08-01T00:00:00.000Z',
        finished_at: '2026-08-01T00:01:00.000Z',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:01:00.000Z',
        imported_objects_count: 0,
        imported_bookings_count: 0,
        imported_calendar_days_count: 0,
        imported_prices_count: 0,
        warnings: [],
        errors: [],
        metadata: { keep: true },
      });

      finalizeRpcFailRemaining = 2;
      await expect(runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      })).rejects.toThrow(/injected finalize rpc failure/);

      expect(committedCheckpoint(connection.id)).toBe(beforeCursor);
      expect(rows('booking_channel_import_runs').find((row) => row.id === otherRunId)?.status).toBe('completed');
      expect(rows('booking_channel_import_runs').find((row) => row.id === otherRunId)?.metadata?.keep).toBe(true);
      expect(rows('booking_channel_import_runs').filter((row) => (
        row.import_type === 'reconciliation_recovery' && row.status === 'running'
      ))).toHaveLength(0);
      expect(finalizeRpcFailCount).toBe(2);
      const recon = rows('booking_channel_reconciliation_runs').find((row) => row.id === preview.runId)!;
      expect(recon.status).toBe('failed');
    });
  });

  describe('stale recovery boundaries', () => {
    it('just under STALE_LIVE_SYNC_TIMEOUT_MS is not recovered; at/over is recovered', async () => {
      const connection = await seedInitialSync();
      const nowMs = Date.now();
      const freshId = '51000000-0000-4000-8000-000000000001';
      const staleId = '51000000-0000-4000-8000-000000000002';
      rows('booking_channel_import_runs').push({
        id: freshId,
        connection_id: connection.id,
        provider: 'manual',
        status: 'running',
        import_type: 'incremental_sync',
        started_at: new Date(nowMs - STALE_LIVE_SYNC_TIMEOUT_MS + 1000).toISOString(),
        created_at: new Date(nowMs - STALE_LIVE_SYNC_TIMEOUT_MS + 1000).toISOString(),
        imported_objects_count: 0,
        imported_bookings_count: 0,
        imported_calendar_days_count: 0,
        imported_prices_count: 0,
        warnings: [],
        errors: [],
        metadata: {},
      });
      const recoveredFresh = await recoverStaleLiveSyncRuns(connection.id, nowMs);
      expect(recoveredFresh).not.toContain(freshId);

      rows('booking_channel_import_runs').push({
        id: staleId,
        connection_id: connection.id,
        provider: 'manual',
        status: 'running',
        import_type: 'reconciliation_recovery',
        started_at: new Date(nowMs - STALE_LIVE_SYNC_TIMEOUT_MS).toISOString(),
        created_at: new Date(nowMs - STALE_LIVE_SYNC_TIMEOUT_MS).toISOString(),
        imported_objects_count: 0,
        imported_bookings_count: 0,
        imported_calendar_days_count: 0,
        imported_prices_count: 0,
        warnings: [],
        errors: [],
        metadata: {},
      });
      const recoveredStale = await recoverStaleLiveSyncRuns(connection.id, nowMs);
      expect(recoveredStale).toContain(staleId);
      expect(rows('booking_channel_import_runs').find((r) => r.id === staleId)?.status).toBe('failed');
      // Fresh still running
      expect(rows('booking_channel_import_runs').find((r) => r.id === freshId)?.status).toBe('running');
    });

    it('wrong lease runId does not release lease', async () => {
      const connection = await seedInitialSync();
      const nowMs = Date.now();
      const staleId = '52000000-0000-4000-8000-000000000001';
      const otherLeaseRunId = '52000000-0000-4000-8000-000000000099';
      const conn = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
      conn.metadata = {
        ...(conn.metadata ?? {}),
        liveSyncLease: {
          runId: otherLeaseRunId,
          status: 'held',
          importType: 'incremental_sync',
        },
      };
      rows('booking_channel_import_runs').push({
        id: staleId,
        connection_id: connection.id,
        provider: 'manual',
        status: 'running',
        import_type: 'incremental_sync',
        started_at: new Date(nowMs - STALE_LIVE_SYNC_TIMEOUT_MS - 5).toISOString(),
        created_at: new Date(nowMs - STALE_LIVE_SYNC_TIMEOUT_MS - 5).toISOString(),
        imported_objects_count: 0,
        imported_bookings_count: 0,
        imported_calendar_days_count: 0,
        imported_prices_count: 0,
        warnings: [],
        errors: [],
        metadata: {},
      });
      const recovered = await recoverStaleLiveSyncRuns(connection.id, nowMs);
      expect(recovered).toContain(staleId);
      expect(conn.metadata.liveSyncLease).toMatchObject({
        runId: otherLeaseRunId,
        status: 'held',
      });
    });
  });

  describe('data-integrity hardening', () => {
    it('never persists raw booking/object IDs, raw cursor checkpoints, or guest PII in recon rows', async () => {
      const connection = await seedInitialSync();
      const phone = '+79991234567';
      const email = 'guest@example.com';
      const rawObjectId = 'ext-raw-object-999';
      const rawBookingId = 'book-raw-secret-777';
      const rawCheckpoint = 'raw-secret-checkpoint-xyz';
      seedBookingOps(BOOKING_OPS_ID, {
        booking_id: rawBookingId,
        guest_name: 'Иван Секретный',
        guest_phone: phone,
        guest_email: email,
        guest_count: 4,
      });
      const snapshot = validateChannelReconciliationSnapshot({
        snapshotKind: 'complete',
        asOf: '2026-08-07T12:00:00.000Z',
        providerCursor: { stream: 'incremental', checkpoint: rawCheckpoint },
        bookings: [{
          externalBookingId: rawBookingId,
          externalObjectId: rawObjectId,
          guestSafeName: 'Анна',
          checkInDate: '2026-07-10',
          checkOutDate: '2026-07-12',
          guestCount: 4,
          status: 'confirmed',
          changeKind: 'updated',
        }],
        calendar: [{
          externalObjectId: rawObjectId,
          date: '2026-07-10',
          availabilityStatus: 'available',
        }],
        pricing: [{
          externalObjectId: rawObjectId,
          date: '2026-07-11',
          priceAmount: 9000,
          currency: 'RUB',
        }],
      });
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      const run = rows('booking_channel_reconciliation_runs').find((row) => row.id === preview.runId)!;
      const items = rows('booking_channel_reconciliation_items').filter((row) => (
        row.reconciliation_run_id === preview.runId
      ));
      const serialized = JSON.stringify({ run, items, api: preview });
      expect(serialized).not.toContain(rawBookingId);
      expect(serialized).not.toContain(rawObjectId);
      expect(serialized).not.toContain(rawCheckpoint);
      expect(serialized).not.toContain(phone);
      expect(serialized).not.toContain(email);
      expect(serialized).not.toContain('Иван Секретный');
      expect(serialized).toContain(hashExternalIdentity(rawBookingId));
      expect(serialized).toContain(hashExternalIdentity(rawObjectId));
      const calendarItem = items.find((row) => String(row.category).startsWith('calendar_'));
      const pricingItem = items.find((row) => String(row.category).startsWith('pricing_'));
      expect(calendarItem?.external_identity_hash).toBe(hashExternalIdentity(rawObjectId));
      expect(pricingItem?.external_identity_hash).toBe(hashExternalIdentity(rawObjectId));
      expect(String(calendarItem?.safe_after?.entityIdentity ?? '')).toMatch(
        new RegExp(`^calendar:${hashExternalIdentity(rawObjectId)}:\\d{4}-\\d{2}-\\d{2}$`),
      );
      expect(String(pricingItem?.safe_after?.entityIdentity ?? '')).toMatch(
        new RegExp(`^pricing:${hashExternalIdentity(rawObjectId)}:\\d{4}-\\d{2}-\\d{2}$`),
      );
    });

    it('item insert failure leaves no incomplete preview_ready; retry rebuilds exact report', async () => {
      const connection = await seedInitialSync();
      const snapshot = reconSnapshotFromState({
        booking: { guest_count: 5 },
        calendar: [{ external_object_id: 'ext-1', date: '2026-08-01', availability_status: 'available' }],
        pricing: [{ external_object_id: 'ext-1', date: '2026-08-02', price_amount: 9000, currency: 'RUB' }],
      });
      previewItemsInsertFailRemaining = 1;
      await expect(runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      })).rejects.toThrow(/injected items insert failure/);

      const incomplete = rows('booking_channel_reconciliation_runs').filter((row) => (
        row.connection_id === connection.id
        && row.mode === 'preview'
      ));
      expect(incomplete.every((row) => row.status !== 'preview_ready')).toBe(true);
      expect(incomplete.some((row) => row.status === 'failed' || row.status === 'analyzing')).toBe(true);

      const retry = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      expect(retry.status).toBe('preview_ready');
      expect(Number(retry.counts.total)).toBe(retry.items.length);
      const persisted = rows('booking_channel_reconciliation_items').filter((row) => (
        row.reconciliation_run_id === retry.runId
      ));
      expect(persisted).toHaveLength(retry.items.length);
      const keys = persisted.map((row) => row.deterministic_action_key).sort();
      expect(new Set(keys).size).toBe(keys.length);
      expect(rows('booking_channel_reconciliation_runs').filter((row) => (
        row.connection_id === connection.id
        && row.mode === 'preview'
        && row.status === 'preview_ready'
      ))).toHaveLength(1);
    });

    it('concurrent identical previews converge to one complete report', async () => {
      const connection = await seedInitialSync();
      const snapshot = reconSnapshotFromState({ booking: { guest_count: 3 } });
      const [a, b] = await Promise.all([
        runChannelManagerReconciliationPreview({ connectionId: connection.id, snapshot }),
        runChannelManagerReconciliationPreview({ connectionId: connection.id, snapshot }),
      ]);
      expect(a.runId).toBe(b.runId);
      expect(a.reportHash).toBe(b.reportHash);
      expect(a.status).toBe('preview_ready');
      expect(b.status).toBe('preview_ready');
      expect(a.items.length).toBe(Number(a.counts.total));
      expect(b.items.length).toBe(Number(b.counts.total));
      expect(rows('booking_channel_reconciliation_runs').filter((row) => (
        row.connection_id === connection.id
        && row.mode === 'preview'
        && row.report_hash === a.reportHash
      ))).toHaveLength(1);
      const itemRows = rows('booking_channel_reconciliation_items').filter((row) => (
        row.reconciliation_run_id === a.runId
      ));
      expect(itemRows).toHaveLength(a.items.length);
      expect(new Set(itemRows.map((row) => row.deterministic_action_key)).size).toBe(itemRows.length);
    });

    it('scoped field-update TOCTOU blocks mutation and skips Booking Ops side effects', async () => {
      const connection = await seedInitialSync();
      seedBookingOps(BOOKING_OPS_ID, {
        account_id: ACCOUNT_ID,
        property_id: 'prop-a',
        guest_count: 2,
        booking_id: 'book-1',
      });
      const foreign = seedBookingOps(BOOKING_OPS_ID_B, {
        account_id: 'other-account',
        property_id: 'prop-foreign',
        guest_count: 9,
        booking_id: 'book-foreign',
        check_in_at: '2026-09-01T00:00:00.000Z',
        check_out_at: '2026-09-03T00:00:00.000Z',
      });
      const snapshot = reconSnapshotFromState({ booking: { guest_count: 5 } });
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      updateBookingOpsRecord.mockImplementation(async (id: string, _patch: Row, options?: Row) => {
        const booking = rows('booking_ops_records').find((row) => row.id === id);
        if (booking) {
          booking.account_id = 'moved-account';
          booking.property_id = 'moved-property';
        }
        const scope = options?.expectedScope as { accountId?: string; propertyId?: string } | undefined;
        expect(scope?.accountId).toBe(ACCOUNT_ID);
        expect(scope?.propertyId).toBe('prop-a');
        return { ok: false, error: 'scope_mismatch' };
      });
      const report = await runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      });
      expect(report.items.some((item) => (
        item.category === 'booking_field_drift' && item.status === 'blocked'
      ))).toBe(true);
      expect(updateBookingOpsRecord).toHaveBeenCalled();
      expect(foreign.guest_count).toBe(9);
      expect(foreign.account_id).toBe('other-account');
      expect(foreign.property_id).toBe('prop-foreign');
    });

    it('compensation after already-successful finalize does not downgrade terminal rows', async () => {
      const connection = await seedInitialSync();
      const importRunId = '61000000-0000-4000-8000-000000000001';
      const reconRunId = '61000000-0000-4000-8000-000000000002';
      const reportHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      rows('booking_channel_import_runs').push({
        id: importRunId,
        connection_id: connection.id,
        provider: 'manual',
        status: 'completed',
        import_type: 'reconciliation_recovery',
        started_at: '2026-08-07T10:00:00.000Z',
        finished_at: '2026-08-07T10:01:00.000Z',
        metadata: { liveCoreStage: 'completed' },
        errors: [],
      });
      rows('booking_channel_reconciliation_runs').push({
        id: reconRunId,
        connection_id: connection.id,
        provider: 'manual',
        mode: 'apply',
        status: 'completed',
        snapshot_kind: 'complete',
        snapshot_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        report_hash: reportHash,
        metadata: { keep: true },
      });
      const result = await supabaseRpc('channel_manager_fail_reconciliation_recovery_v1', {
        p_connection_id: connection.id,
        p_import_run_id: importRunId,
        p_reconciliation_run_id: reconRunId,
        p_expected_report_hash: reportHash,
        p_finished_at: new Date().toISOString(),
        p_safe_summary: 'should not rewrite',
        p_safe_error: {},
        p_safe_run_metadata: { failCompensation: true },
      });
      expect(result.data?.success).toBe(true);
      expect(result.data?.alreadyFinalized).toBe(true);
      expect(rows('booking_channel_import_runs').find((row) => row.id === importRunId)?.status).toBe('completed');
      expect(rows('booking_channel_reconciliation_runs').find((row) => row.id === reconRunId)?.status).toBe('completed');
      expect(rows('booking_channel_reconciliation_runs').find((row) => row.id === reconRunId)?.metadata?.keep).toBe(true);
    });

    it('compensation after already-failed finalize is idempotent', async () => {
      const connection = await seedInitialSync();
      const importRunId = '62000000-0000-4000-8000-000000000001';
      const reconRunId = '62000000-0000-4000-8000-000000000002';
      const reportHash = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
      rows('booking_channel_import_runs').push({
        id: importRunId,
        connection_id: connection.id,
        provider: 'manual',
        status: 'failed',
        import_type: 'reconciliation_recovery',
        started_at: '2026-08-07T10:00:00.000Z',
        finished_at: '2026-08-07T10:01:00.000Z',
        metadata: { liveCoreStage: 'failed', original: true },
        errors: [{ code: 'first' }],
      });
      rows('booking_channel_reconciliation_runs').push({
        id: reconRunId,
        connection_id: connection.id,
        provider: 'manual',
        mode: 'apply',
        status: 'failed',
        snapshot_kind: 'complete',
        snapshot_hash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        report_hash: reportHash,
        metadata: { original: true },
      });
      const first = await supabaseRpc('channel_manager_fail_reconciliation_recovery_v1', {
        p_connection_id: connection.id,
        p_import_run_id: importRunId,
        p_reconciliation_run_id: reconRunId,
        p_expected_report_hash: reportHash,
        p_finished_at: new Date().toISOString(),
        p_safe_summary: 'retry',
        p_safe_error: { code: 'second' },
        p_safe_run_metadata: { failCompensation: true },
      });
      const second = await supabaseRpc('channel_manager_fail_reconciliation_recovery_v1', {
        p_connection_id: connection.id,
        p_import_run_id: importRunId,
        p_reconciliation_run_id: reconRunId,
        p_expected_report_hash: reportHash,
        p_finished_at: new Date().toISOString(),
        p_safe_summary: 'retry-again',
        p_safe_error: { code: 'third' },
        p_safe_run_metadata: { failCompensation: true },
      });
      expect(first.data?.success).toBe(true);
      expect(first.data?.alreadyFailed).toBe(true);
      expect(second.data?.success).toBe(true);
      expect(second.data?.alreadyFailed).toBe(true);
      const importRun = rows('booking_channel_import_runs').find((row) => row.id === importRunId)!;
      const recon = rows('booking_channel_reconciliation_runs').find((row) => row.id === reconRunId)!;
      expect(importRun.status).toBe('failed');
      expect(importRun.metadata?.original).toBe(true);
      expect(importRun.errors).toEqual([{ code: 'first' }]);
      expect(recon.status).toBe('failed');
      expect(recon.metadata?.original).toBe(true);
    });

    it('standalone lease_run_mismatch is operator_review and is not auto-applied', async () => {
      const connection = await seedInitialSync();
      const conn = rows('booking_channel_manager_connections').find((row) => row.id === connection.id)!;
      const foreignLeaseRunId = '63000000-0000-4000-8000-000000000099';
      conn.metadata = {
        ...(conn.metadata ?? {}),
        liveSyncLease: {
          runId: foreignLeaseRunId,
          status: 'held',
          importType: 'incremental_sync',
        },
      };
      const snapshot = reconSnapshotFromState({ bookings: [] });
      const preview = await runChannelManagerReconciliationPreview({
        connectionId: connection.id,
        snapshot,
      });
      const leaseItem = preview.items.find((item) => item.category === 'lease_run_mismatch');
      expect(leaseItem?.repairability).toBe('operator_review');
      const persistedLease = rows('booking_channel_reconciliation_items').find((row) => (
        row.reconciliation_run_id === preview.runId
        && row.category === 'lease_run_mismatch'
      ));
      expect(String(persistedLease?.safe_after?.safeIntendedState ?? '')).toMatch(/^review_lease:/);
      const report = await runChannelManagerReconciliationRecovery({
        connectionId: connection.id,
        reconciliationRunId: preview.runId,
        reportHash: preview.reportHash,
        confirmationPhrase: APPLY_CHANNEL_MANAGER_RECONCILIATION_SAFE_REPAIRS,
        snapshot,
      });
      expect(report.items.find((item) => item.category === 'lease_run_mismatch')?.status).not.toBe('applied');
      // Recovery may replace/release its own acquired lease; the mismatch item itself must not auto-apply.
    });
  });
});
