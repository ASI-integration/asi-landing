import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Row = Record<string, any>;
const {
  processInboundBookingRequest,
  canAutoSendCommunicationIntent,
  updateBookingOpsRecord,
  cancelReservation,
  getUnifiedAvailability,
  supabaseRpc,
  supabaseFrom,
} = vi.hoisted(() => ({
  processInboundBookingRequest: vi.fn(),
  canAutoSendCommunicationIntent: vi.fn(),
  updateBookingOpsRecord: vi.fn(),
  cancelReservation: vi.fn(),
  getUnifiedAvailability: vi.fn(),
  supabaseRpc: vi.fn(),
  supabaseFrom: vi.fn(),
}));
const tables: Record<string, Row[]> = {};

function rows(table: string): Row[] { return tables[table] ?? (tables[table] = []); }

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
    if (table === 'booking_channel_import_runs' && candidate.import_type === 'initial_sync' && candidate.status === 'running') {
      const exists = rows(table).some((row) => (
        row.connection_id === candidate.connection_id
        && row.import_type === 'initial_sync'
        && row.status === 'running'
      ));
      if (exists) {
        return {
          select: () => ({
            single: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint "booking_channel_import_runs_one_running_initial_sync"' },
            }),
            maybeSingle: async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            }),
          }),
        };
      }
    }
  }
  rows(table).push(...incoming);
  const query = new Query(table);
  (query as any).filtered = incoming;
  return query;
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
vi.mock('@/lib/reservations/ledger', () => ({ cancelReservation, getUnifiedAvailability }));
vi.mock('../availability-overbooking-protection', () => ({
  auditChannelImportAvailability: vi.fn(async () => []),
}));

import { initializeChannelManagerConnection, registerManualChannelSnapshot } from '../channel-manager-access-import';
import {
  STALE_INITIAL_SYNC_TIMEOUT_MS,
  acquireChannelLiveSyncGuard,
  clearChannelLiveCoreSchemaStateCache,
  createChannelLiveCoreAdapter,
  getChannelLiveCoreStatus,
  probeChannelLiveCoreSchema,
  recoverStaleInitialSyncRuns,
  resolveChannelLiveSyncFinalStatus,
  runChannelManagerInitialSync,
  setChannelLiveCoreSchemaReadyOverride,
  setChannelLiveCoreSchemaStateOverride,
} from '../channel-manager-live-core';
import { ASI_PRODUCT_ROADMAP } from '@/lib/roadmap/asi-product-roadmap';
import { allRoadmapStages } from '@/lib/roadmap/summary';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROPERTY_ID = '20000000-0000-4000-8000-000000000002';
const BOOKING_OPS_ID = '30000000-0000-4000-8000-000000000003';
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
  canAutoSendCommunicationIntent.mockReset();
  processInboundBookingRequest.mockReset();
  updateBookingOpsRecord.mockReset();
  cancelReservation.mockReset();
  getUnifiedAvailability.mockReset();
  supabaseRpc.mockReset();
  supabaseFrom.mockReset();
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
  supabaseRpc.mockResolvedValue({
    data: {
      schemaVersion: 1,
      initialSyncTypeReady: true,
      atomicRunningGuardReady: true,
      ready: true,
    },
    error: null,
  });

  canAutoSendCommunicationIntent.mockResolvedValue({ eligible: false, reason: 'global_off' });
  processInboundBookingRequest.mockResolvedValue({ bookingId: BOOKING_OPS_ID, intakeStatus: 'processed' });
  updateBookingOpsRecord.mockResolvedValue({ ok: true });
  cancelReservation.mockImplementation(async (input: { reservationId: string; accountId: string }) => {
    const booking = rows('booking_ops_records').find((row) => row.id === input.reservationId && row.account_id === input.accountId);
    if (!booking) throw new Error('not_found');
    if (booking.normalized_status === 'cancelled') return { changed: false };
    booking.normalized_status = 'cancelled';
    booking.cancelled_at = new Date().toISOString();
    for (const hold of rows('booking_availability_holds').filter((row) => row.booking_id === input.reservationId)) {
      hold.status = 'released';
    }
    rows('reservation_ledger_audit').push({
      action: 'reservation_cancelled',
      account_id: input.accountId,
      booking_ops_record_id: input.reservationId,
    });
    return { changed: true };
  });
  getUnifiedAvailability.mockResolvedValue({ available: true, conflicts: [] });
  setChannelLiveCoreSchemaReadyOverride(true);
});

describe('Channel Manager Live Core repairs', () => {
  it('allows exactly one of two concurrent initial sync acquisitions', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const [first, second] = await Promise.all([
      acquireChannelLiveSyncGuard(connection.id),
      acquireChannelLiveSyncGuard(connection.id),
    ]);
    const successes = [first, second].filter((item) => item.ok);
    const failures = [first, second].filter((item) => !item.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (!failures[0]!.ok) expect(failures[0].code).toBe('execution_guard');
    expect(rows('booking_channel_import_runs').filter((row) => row.status === 'running')).toHaveLength(1);
  });

  it('recovers a stale running run before allowing a replacement', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const staleStarted = new Date(Date.now() - STALE_INITIAL_SYNC_TIMEOUT_MS - 1000).toISOString();
    rows('booking_channel_import_runs').push({
      id: '50000000-0000-4000-8000-000000000005',
      connection_id: connection.id,
      provider: 'manual',
      status: 'running',
      import_type: 'initial_sync',
      started_at: staleStarted,
      created_at: staleStarted,
      updated_at: staleStarted,
      warnings: [],
      errors: [],
      metadata: { liveCoreStage: 'import_bookings', liveCoreCounters: { imported: 1, failed: 0 } },
      imported_objects_count: 1,
      imported_bookings_count: 1,
      imported_calendar_days_count: 0,
      imported_prices_count: 0,
    });
    const recovered = await recoverStaleInitialSyncRuns(connection.id);
    expect(recovered).toEqual(['50000000-0000-4000-8000-000000000005']);
    const stale = rows('booking_channel_import_runs')[0];
    expect(stale.status).toBe('failed');
    expect(stale.metadata.staleRecovered).toBe(true);
    expect(stale.metadata.liveCoreCounters.imported).toBe(1);
    const next = await acquireChannelLiveSyncGuard(connection.id);
    expect(next.ok).toBe(true);
  });

  it('does not update last_success_at when blocker warnings force failed status', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const priorSuccess = '2026-07-01T00:00:00.000Z';
    rows('booking_channel_manager_connections')[0].last_success_at = priorSuccess;
    processInboundBookingRequest.mockRejectedValue(new Error('intake boom'));
    const result = await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    expect(result.status).toBe('failed');
    expect(resolveChannelLiveSyncFinalStatus(result.counters, result.warnings)).toBe('failed');
    expect(rows('booking_channel_manager_connections')[0].last_success_at).toBe(priorSuccess);
    expect(rows('booking_channel_manager_connections')[0].metadata.lastSuccessfulInitialSyncAt).toBeUndefined();
    expect(rows('booking_channel_manager_connections')[0].status).toBe('import_failed');
    const status = await getChannelLiveCoreStatus(connection.id);
    expect(status.blocker).toBeTruthy();
    expect(status.warning).toBeNull();
  });

  it('marks overall status failed when booking processing has counters.failed > 0', async () => {
    expect(resolveChannelLiveSyncFinalStatus(
      { imported: 0, updated: 0, cancelled: 0, skipped: 1, failed: 1, objects: 1, calendarDays: 0, prices: 0 },
      [{ type: 'booking_sync_failed', severity: 'blocker', message: 'x' }],
    )).toBe('failed');
    expect(resolveChannelLiveSyncFinalStatus(
      { imported: 1, updated: 0, cancelled: 0, skipped: 0, failed: 0, objects: 1, calendarDays: 0, prices: 0 },
      [{ type: 'object_not_confirmed', severity: 'warning', message: 'x' }],
    )).toBe('completed_with_warnings');
    expect(resolveChannelLiveSyncFinalStatus(
      { imported: 1, updated: 0, cancelled: 0, skipped: 0, failed: 0, objects: 1, calendarDays: 0, prices: 0 },
      [],
    )).toBe('completed');
  });

  it('prevents date mutation when availability has a confirmed conflict', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    rows('booking_ops_records').push({
      id: BOOKING_OPS_ID,
      account_id: ACCOUNT_ID,
      property_id: 'prop-a',
      unit_id: null,
      guest_name: 'Анна',
      check_in_at: '2026-07-10T00:00:00.000Z',
      check_out_at: '2026-07-12T00:00:00.000Z',
      normalized_status: 'confirmed',
    });
    getUnifiedAvailability.mockResolvedValueOnce({
      available: false,
      conflicts: [{ kind: 'reservation', id: 'other', reference: 'ASI', dateFrom: '2026-07-11', dateTo: '2026-07-13' }],
    });
    updateBookingOpsRecord.mockClear();
    const result = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: baseSnapshot({ booking: { checkin_date: '2026-07-11', checkout_date: '2026-07-13', status: 'modified' } }),
    });
    expect(result.status).toBe('failed');
    expect(result.counters.failed).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((item) => item.type === 'availability_conflict' && item.severity === 'blocker')).toBe(true);
    expect(updateBookingOpsRecord).not.toHaveBeenCalled();
    expect(rows('booking_ops_records')[0].check_in_at).toBe('2026-07-10T00:00:00.000Z');
  });

  it('uses canonical cancellation that releases holds and writes audit', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    rows('booking_ops_records').push({
      id: BOOKING_OPS_ID,
      account_id: ACCOUNT_ID,
      property_id: 'prop-a',
      guest_name: 'Анна',
      check_in_at: '2026-07-10T00:00:00.000Z',
      check_out_at: '2026-07-12T00:00:00.000Z',
      normalized_status: 'confirmed',
    });
    rows('booking_availability_holds').push({
      id: 'hold-1',
      booking_id: BOOKING_OPS_ID,
      account_id: ACCOUNT_ID,
      status: 'active',
    });
    const result = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: baseSnapshot({ booking: { status: 'cancelled' } }),
    });
    expect(result.counters.cancelled).toBe(1);
    expect(cancelReservation).toHaveBeenCalledWith(expect.objectContaining({
      accountId: ACCOUNT_ID,
      reservationId: BOOKING_OPS_ID,
    }));
    expect(rows('booking_availability_holds')[0].status).toBe('released');
    expect(rows('reservation_ledger_audit')[0].action).toBe('reservation_cancelled');
  });

  it('fails closed when account_id is missing for cancellation', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    rows('booking_ops_records').push({
      id: BOOKING_OPS_ID,
      account_id: null,
      property_id: 'prop-a',
      guest_name: 'Анна',
      check_in_at: '2026-07-10T00:00:00.000Z',
      check_out_at: '2026-07-12T00:00:00.000Z',
      normalized_status: 'confirmed',
    });
    const result = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: baseSnapshot({ booking: { status: 'cancelled' } }),
    });
    expect(result.status).toBe('failed');
    expect(result.warnings.some((item) => item.type === 'cancel_missing_account' && item.severity === 'blocker')).toBe(true);
    expect(cancelReservation).not.toHaveBeenCalled();
    expect(rows('booking_ops_records')[0].normalized_status).toBe('confirmed');
  });

  it('does not store the full manual snapshot in connection metadata', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    await registerManualChannelSnapshot(connection.id, baseSnapshot());
    const meta = rows('booking_channel_manager_connections')[0].metadata;
    expect(meta.lastManualSnapshot).toBeUndefined();
    expect(meta.lastManualSnapshotReceipt?.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(meta.lastManualSnapshotReceipt?.rowCounts?.bookings).toBe(1);

    await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    const after = rows('booking_channel_manager_connections')[0].metadata;
    expect(after.lastManualSnapshot).toBeUndefined();
    expect(JSON.stringify(after)).not.toMatch(/guest_safe_name|Анна/);
  });

  it('requires snapshot payload again or explicit reuseImportedRows', async () => {
    expect(() => createChannelLiveCoreAdapter('manual')).toThrow(/снимок|reuseImportedRows/i);
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const missing = await runChannelManagerInitialSync({ connectionId: connection.id });
    expect(missing.status).toBe('failed');
    expect(missing.safeError?.message).toMatch(/снимок|reuseImportedRows/i);
  });

  it('exposes a clear blocker when Live Core migration is missing', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    setChannelLiveCoreSchemaReadyOverride(false);
    const probe = await probeChannelLiveCoreSchema(connection.id);
    expect(probe.ready).toBe(false);
    const status = await getChannelLiveCoreStatus(connection.id);
    expect(status.schemaReady).toBe(false);
    expect(status.initialSyncEnabled).toBe(false);
    expect(status.blocker).toMatch(/миграц/i);
    const guard = await acquireChannelLiveSyncGuard(connection.id);
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.code).toBe('migration_missing');
  });

  it('probes schema readiness without insert/delete side effects', async () => {
    setChannelLiveCoreSchemaStateOverride(null);
    clearChannelLiveCoreSchemaStateCache();
    supabaseFrom.mockClear();
    supabaseRpc.mockReset();
    supabaseRpc.mockResolvedValueOnce({
      data: { schemaVersion: 1, initialSyncTypeReady: true, atomicRunningGuardReady: true, ready: true },
      error: null,
    });
    const before = rows('booking_channel_import_runs').length;
    const probe = await probeChannelLiveCoreSchema();
    expect(probe.ready).toBe(true);
    expect(supabaseRpc).toHaveBeenCalledWith('channel_manager_live_core_schema_state');
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(rows('booking_channel_import_runs')).toHaveLength(before);
  });

  it('is not ready when only the initial_sync constraint is present', async () => {
    setChannelLiveCoreSchemaStateOverride(null);
    clearChannelLiveCoreSchemaStateCache();
    supabaseRpc.mockResolvedValueOnce({
      data: { schemaVersion: 1, initialSyncTypeReady: true, atomicRunningGuardReady: false, ready: false },
      error: null,
    });
    const probe = await probeChannelLiveCoreSchema();
    expect(probe.ready).toBe(false);
    expect(probe.initialSyncTypeReady).toBe(true);
    expect(probe.atomicRunningGuardReady).toBe(false);
    expect(probe.blocker).toMatch(/guard index/i);
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const status = await getChannelLiveCoreStatus(connection.id);
    expect(status.initialSyncEnabled).toBe(false);
    expect(status.liveCoreEnabled).toBe(false);
  });

  it('is not ready when only the unique running-run index is present', async () => {
    setChannelLiveCoreSchemaStateOverride(null);
    clearChannelLiveCoreSchemaStateCache();
    supabaseRpc.mockResolvedValueOnce({
      data: { schemaVersion: 1, initialSyncTypeReady: false, atomicRunningGuardReady: true, ready: false },
      error: null,
    });
    const probe = await probeChannelLiveCoreSchema();
    expect(probe.ready).toBe(false);
    expect(probe.initialSyncTypeReady).toBe(false);
    expect(probe.atomicRunningGuardReady).toBe(true);
    expect(probe.blocker).toMatch(/initial_sync/i);
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    expect((await getChannelLiveCoreStatus(connection.id)).initialSyncEnabled).toBe(false);
  });

  it('is ready only when both schema components are present', async () => {
    setChannelLiveCoreSchemaStateOverride(null);
    clearChannelLiveCoreSchemaStateCache();
    supabaseRpc.mockResolvedValueOnce({
      data: { schemaVersion: 1, initialSyncTypeReady: true, atomicRunningGuardReady: true, ready: true },
      error: null,
    });
    const probe = await probeChannelLiveCoreSchema();
    expect(probe).toMatchObject({
      ready: true,
      initialSyncTypeReady: true,
      atomicRunningGuardReady: true,
      blocker: null,
    });
  });

  it('fails closed when the schema RPC is missing or failing', async () => {
    setChannelLiveCoreSchemaStateOverride(null);
    clearChannelLiveCoreSchemaStateCache();
    supabaseRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42883', message: 'function channel_manager_live_core_schema_state() does not exist' },
    });
    const probe = await probeChannelLiveCoreSchema();
    expect(probe.ready).toBe(false);
    expect(probe.blocker).toMatch(/миграц/i);
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const status = await getChannelLiveCoreStatus(connection.id);
    expect(status.initialSyncEnabled).toBe(false);
    expect(status.blocker).toMatch(/миграц/i);
  });

  it('shows the concrete blocker warning before the generic safeError', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const now = new Date().toISOString();
    rows('booking_channel_import_runs').push({
      id: '60000000-0000-4000-8000-000000000006',
      connection_id: connection.id,
      provider: 'manual',
      status: 'failed',
      import_type: 'initial_sync',
      started_at: now,
      finished_at: now,
      created_at: now,
      updated_at: now,
      warnings: [{ type: 'availability_conflict', severity: 'blocker', message: 'Подтверждённый конфликт доступности — даты не изменены.' }],
      errors: [],
      metadata: {
        liveCoreStage: 'failed',
        safeError: { stage: 'process_bookings', code: 'sync_failed', message: 'Initial sync завершён с blocker/ошибками обработки.', retryable: true },
      },
      imported_objects_count: 0,
      imported_bookings_count: 0,
      imported_calendar_days_count: 0,
      imported_prices_count: 0,
    });
    const status = await getChannelLiveCoreStatus(connection.id);
    expect(status.blocker).toBe('Подтверждённый конфликт доступности — даты не изменены.');
    expect(status.blocker).not.toMatch(/Initial sync завершён с blocker/i);
  });

  it('keeps roadmap honest: Live Core in progress until activation', () => {
    const byId = Object.fromEntries(allRoadmapStages(ASI_PRODUCT_ROADMAP).map((stage) => [stage.id, stage]));
    expect(byId['ch-live-core']?.status).toBe('in_progress');
    expect(byId['ch-live-core']?.currentState).toMatch(/production activation is still pending/i);
    expect(byId['ch-initial-incremental-sync']?.status).toBe('in_progress');
    expect(byId['ch-first-real-adapter']?.status).toBe('blocked');
    const panel = readFileSync(resolve(process.cwd(), 'src/components/booking-ops/ChannelManagerImportPanel.tsx'), 'utf8');
    expect(panel).toContain('channel-live-core-status');
  });

  it('still imports a new booking and retries without duplicates', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    const first = await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    expect(first.status).not.toBe('failed');
    expect(first.counters.imported).toBe(1);
    processInboundBookingRequest.mockClear();
    const second = await runChannelManagerInitialSync({ connectionId: connection.id, snapshot: baseSnapshot() });
    expect(second.status).not.toBe('failed');
    expect(second.counters.imported).toBe(0);
    expect(rows('booking_channel_imported_bookings')).toHaveLength(1);
  });
});
