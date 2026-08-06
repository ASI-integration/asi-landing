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
    const liveType = candidate.import_type === 'initial_sync' || candidate.import_type === 'incremental_sync';
    if (table === 'booking_channel_import_runs' && liveType && candidate.status === 'running') {
      const exists = rows(table).some((row) => (
        row.connection_id === candidate.connection_id
        && (row.import_type === 'initial_sync' || row.import_type === 'incremental_sync')
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
vi.mock('@/lib/reservations/ledger', () => ({ cancelReservation, getUnifiedAvailability, restoreReservation }));
vi.mock('../availability-overbooking-protection', () => ({
  auditChannelImportAvailability: vi.fn(async () => []),
}));

import { initializeChannelManagerConnection } from '../channel-manager-access-import';
import {
  MANUAL_INCREMENTAL_LIVE_CAPABILITIES,
  MAX_INCREMENTAL_BATCH_ROWS,
  acquireChannelLiveSyncGuard,
  clearChannelLiveCoreSchemaStateCache,
  createChannelLiveCoreAdapter,
  getChannelLiveCoreStatus,
  probeChannelLiveCoreSchema,
  runChannelManagerIncrementalSync,
  runChannelManagerInitialSync,
  setChannelLiveCoreSchemaReadyOverride,
  setChannelLiveCoreSchemaStateOverride,
  validateManualChannelIncrementalDelta,
  type ManualChannelIncrementalDelta,
} from '../channel-manager-live-core';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROPERTY_ID = '20000000-0000-4000-8000-000000000002';
const PROPERTY_ID_B = '20000000-0000-4000-8000-000000000022';
const BOOKING_OPS_ID = '30000000-0000-4000-8000-000000000003';
const BOOKING_OPS_ID_B = '30000000-0000-4000-8000-000000000033';
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

function baseDelta(overrides: Partial<ManualChannelIncrementalDelta> & {
  booking?: Row;
  bookings?: Array<Record<string, unknown>>;
} = {}): ManualChannelIncrementalDelta {
  const { booking, bookings, ...rest } = overrides;
  return {
    bookings: bookings ?? (booking ? [{
      external_booking_id: 'book-1',
      external_object_id: 'ext-1',
      guest_safe_name: 'Анна',
      checkin_date: '2026-07-10',
      checkout_date: '2026-07-12',
      status: 'confirmed',
      change_kind: 'updated',
      ...booking,
    }] : []),
    calendar: rest.calendar ?? [],
    pricing: rest.pricing ?? [],
    currentCursor: rest.currentCursor ?? null,
    nextCursor: rest.nextCursor ?? { stream: 'incremental', checkpoint: 'cursor-1' },
    hasMore: rest.hasMore ?? false,
  };
}

function checkpointHash(checkpoint: string): string {
  return createHash('sha256').update(checkpoint).digest('hex').slice(0, 16);
}

function seedBookingOps(id = BOOKING_OPS_ID, patch: Row = {}) {
  rows('booking_ops_records').push({
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
  });
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
  return connection;
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
      schemaVersion: 2,
      initialSyncTypeReady: true,
      incrementalSyncTypeReady: true,
      atomicRunningGuardReady: true,
      atomicLiveSyncGuardReady: true,
      cursorStorageReady: true,
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

describe('Channel Manager Live Incremental Sync v1', () => {
  describe('schema readiness v2', () => {
    it('probes v2 fields via RPC and fails closed on partial readiness', async () => {
      setChannelLiveCoreSchemaStateOverride(null);
      clearChannelLiveCoreSchemaStateCache();
      supabaseRpc.mockResolvedValueOnce({
        data: {
          schemaVersion: 2,
          initialSyncTypeReady: true,
          incrementalSyncTypeReady: true,
          atomicRunningGuardReady: true,
          atomicLiveSyncGuardReady: true,
          cursorStorageReady: true,
          ready: true,
        },
        error: null,
      });
      const ready = await probeChannelLiveCoreSchema();
      expect(ready).toMatchObject({
        schemaVersion: 2,
        incrementalSyncTypeReady: true,
        atomicLiveSyncGuardReady: true,
        cursorStorageReady: true,
        ready: true,
        blocker: null,
      });
      expect(supabaseRpc).toHaveBeenCalledWith('channel_manager_live_core_schema_state');

      clearChannelLiveCoreSchemaStateCache();
      supabaseRpc.mockResolvedValueOnce({
        data: {
          schemaVersion: 2,
          initialSyncTypeReady: true,
          incrementalSyncTypeReady: false,
          atomicRunningGuardReady: true,
          atomicLiveSyncGuardReady: true,
          cursorStorageReady: true,
          ready: false,
        },
        error: null,
      });
      const partial = await probeChannelLiveCoreSchema();
      expect(partial.ready).toBe(false);
      expect(partial.incrementalSyncTypeReady).toBe(false);
      expect(partial.blocker).toMatch(/Incremental/i);

      clearChannelLiveCoreSchemaStateCache();
      supabaseRpc.mockResolvedValueOnce({
        data: {
          schemaVersion: 2,
          initialSyncTypeReady: true,
          incrementalSyncTypeReady: true,
          atomicLiveSyncGuardReady: false,
          atomicRunningGuardReady: false,
          cursorStorageReady: false,
          ready: false,
        },
        error: null,
      });
      const missingCursor = await probeChannelLiveCoreSchema();
      expect(missingCursor.ready).toBe(false);
      expect(missingCursor.cursorStorageReady).toBe(false);
    });
  });

  describe('atomic live-sync guard', () => {
    it('acquires incremental_sync import type and enforces exclusivity', async () => {
      const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
      const acquired = await acquireChannelLiveSyncGuard(connection.id, { importType: 'incremental_sync' });
      expect(acquired.ok).toBe(true);
      if (acquired.ok) expect(acquired.run.importType).toBe('incremental_sync');
      expect(rows('booking_channel_import_runs').some((row) => (
        row.import_type === 'incremental_sync' && row.status === 'running'
      ))).toBe(true);

      const [first, second] = await Promise.all([
        acquireChannelLiveSyncGuard(connection.id, { importType: 'incremental_sync' }),
        acquireChannelLiveSyncGuard(connection.id, { importType: 'incremental_sync' }),
      ]);
      // one already running from above → both concurrent attempts fail; release then retest clean concurrency
      expect([first, second].every((item) => !item.ok)).toBe(true);

      rows('booking_channel_import_runs').forEach((row) => {
        if (row.status === 'running') row.status = 'completed';
      });
      const [a, b] = await Promise.all([
        acquireChannelLiveSyncGuard(connection.id, { importType: 'incremental_sync' }),
        acquireChannelLiveSyncGuard(connection.id, { importType: 'incremental_sync' }),
      ]);
      expect([a, b].filter((item) => item.ok)).toHaveLength(1);
      expect([a, b].filter((item) => !item.ok)).toHaveLength(1);
      if (![a, b].find((item) => !item.ok)!.ok) {
        expect([a, b].find((item) => !item.ok)!.code).toBe('execution_guard');
      }
    });

    it('blocks initial↔incremental on same connection; different connections stay independent', async () => {
      const connectionA = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
      const connectionB = await initializeChannelManagerConnection(PROPERTY_ID_B, 'manual');

      const initial = await acquireChannelLiveSyncGuard(connectionA.id, { importType: 'initial_sync' });
      expect(initial.ok).toBe(true);
      const blockedInc = await acquireChannelLiveSyncGuard(connectionA.id, { importType: 'incremental_sync' });
      expect(blockedInc.ok).toBe(false);
      if (!blockedInc.ok) expect(blockedInc.code).toBe('execution_guard');

      rows('booking_channel_import_runs').forEach((row) => {
        if (row.connection_id === connectionA.id && row.status === 'running') row.status = 'completed';
      });
      const incremental = await acquireChannelLiveSyncGuard(connectionA.id, { importType: 'incremental_sync' });
      expect(incremental.ok).toBe(true);
      const blockedInitial = await acquireChannelLiveSyncGuard(connectionA.id, { importType: 'initial_sync' });
      expect(blockedInitial.ok).toBe(false);
      if (!blockedInitial.ok) expect(blockedInitial.code).toBe('execution_guard');

      const other = await acquireChannelLiveSyncGuard(connectionB.id, { importType: 'incremental_sync' });
      expect(other.ok).toBe(true);
      expect(rows('booking_channel_import_runs').filter((row) => row.status === 'running')).toHaveLength(2);
    });
  });

  describe('prerequisites and scope', () => {
    it('rejects incremental without completed initial_sync', async () => {
      const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual', { accountId: ACCOUNT_ID });
      const result = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({ booking: { change_kind: 'unchanged' } }),
      });
      expect(result.status).toBe('failed');
      expect(result.safeError?.code).toBe('initial_sync_required');
      expect(result.cursorCommitted).toBe(false);
    });

    it('rejects account/owner scope mismatch', async () => {
      const connection = await seedInitialSync();
      const wrongAccount = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        accountId: 'other-account',
        delta: baseDelta({ booking: { change_kind: 'unchanged' } }),
      });
      expect(wrongAccount.status).toBe('failed');
      expect(wrongAccount.safeError?.code).toBe('account_scope_mismatch');

      const wrongOwner = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        ownerSetupId: '10000000-0000-4000-8000-000000000099',
        delta: baseDelta({ booking: { change_kind: 'unchanged', status: 'confirmed' } }),
      });
      expect(wrongOwner.status).toBe('failed');
      expect(wrongOwner.safeError?.code).toBe('account_scope_mismatch');
    });
  });

  describe('booking change kinds', () => {
    it('creates, updates dates, cancels, restores, skips unchanged, and blocks overbooking restore', async () => {
      const connection = await seedInitialSync();

      processInboundBookingRequest.mockResolvedValueOnce({ bookingId: BOOKING_OPS_ID_B, intakeStatus: 'processed' });
      const created = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          bookings: [{
            external_booking_id: 'book-new',
            external_object_id: 'ext-1',
            guest_safe_name: 'Борис',
            checkin_date: '2026-08-01',
            checkout_date: '2026-08-03',
            status: 'confirmed',
            change_kind: 'created',
          }],
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-create' },
        }),
      });
      expect(created.status).not.toBe('failed');
      expect(created.counters.created).toBe(1);
      expect(created.counters.imported).toBe(1);
      expect(processInboundBookingRequest).toHaveBeenCalled();

      updateBookingOpsRecord.mockClear();
      const updated = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          booking: {
            change_kind: 'updated',
            status: 'modified',
            checkin_date: '2026-07-11',
            checkout_date: '2026-07-13',
          },
          currentCursor: { stream: 'incremental', checkpoint: 'cursor-create' },
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-update' },
        }),
      });
      expect(updated.status).not.toBe('failed');
      expect(updated.counters.updated).toBe(1);
      expect(updateBookingOpsRecord).toHaveBeenCalledWith(
        BOOKING_OPS_ID,
        expect.objectContaining({ checkInAt: '2026-07-11', checkOutAt: '2026-07-13' }),
        expect.anything(),
      );

      cancelReservation.mockClear();
      const cancelled = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          booking: { change_kind: 'cancelled', status: 'cancelled' },
          currentCursor: { stream: 'incremental', checkpoint: 'cursor-update' },
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-cancel' },
        }),
      });
      expect(cancelled.status).not.toBe('failed');
      expect(cancelled.counters.cancelled).toBe(1);
      expect(cancelReservation).toHaveBeenCalledWith(expect.objectContaining({
        accountId: ACCOUNT_ID,
        reservationId: BOOKING_OPS_ID,
      }));
      expect(rows('booking_ops_records').find((row) => row.id === BOOKING_OPS_ID)?.normalized_status).toBe('cancelled');

      const restored = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          booking: { change_kind: 'restored', status: 'restored' },
          currentCursor: { stream: 'incremental', checkpoint: 'cursor-cancel' },
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-restore' },
        }),
      });
      expect(restored.status).not.toBe('failed');
      expect(restored.counters.restored).toBe(1);
      expect(restoreReservation).toHaveBeenCalled();
      expect(rows('booking_ops_records').find((row) => row.id === BOOKING_OPS_ID)?.normalized_status).toBe('confirmed');

      const unchanged = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          booking: { change_kind: 'unchanged', status: 'confirmed' },
          currentCursor: { stream: 'incremental', checkpoint: 'cursor-restore' },
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-unchanged' },
        }),
      });
      expect(unchanged.status).not.toBe('failed');
      expect(unchanged.counters.skipped).toBeGreaterThanOrEqual(1);
      expect(unchanged.counters.updated).toBe(0);
      expect(unchanged.counters.created).toBe(0);

      rows('booking_ops_records').find((row) => row.id === BOOKING_OPS_ID)!.normalized_status = 'cancelled';
      restoreReservation.mockResolvedValueOnce({
        changed: false,
        blocked: true,
        conflicts: [{ kind: 'reservation', id: 'other', reference: 'ASI', dateFrom: '2026-07-10', dateTo: '2026-07-12' }],
      });
      const blocked = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          booking: { change_kind: 'restored', status: 'restored' },
          currentCursor: { stream: 'incremental', checkpoint: 'cursor-unchanged' },
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-blocked-restore' },
        }),
      });
      expect(blocked.status).toBe('failed');
      expect(blocked.counters.failed).toBeGreaterThanOrEqual(1);
      expect(blocked.warnings.some((item) => item.type === 'availability_conflict' && item.severity === 'blocker')).toBe(true);
      expect(blocked.cursorCommitted).toBe(false);
    });
  });

  describe('calendar, pricing, cursor, and idempotency', () => {
    it('applies calendar/pricing, advances cursor on success, retains after failure, and replays idempotently', async () => {
      const connection = await seedInitialSync();

      const withCal = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          booking: { change_kind: 'unchanged' },
          calendar: [{ external_object_id: 'ext-1', date: '2026-07-20', availability_status: 'available' }],
          pricing: [{ external_object_id: 'ext-1', date: '2026-07-20', price_amount: 7777, currency: 'RUB' }],
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-cal' },
        }),
      });
      expect(withCal.status).not.toBe('failed');
      expect(withCal.counters.calendarDays).toBe(1);
      expect(withCal.counters.prices).toBe(1);
      expect(withCal.cursorCommitted).toBe(true);
      expect(withCal.committedCursor?.checkpoint).toBe('cursor-cal');
      const connAfter = rows('booking_channel_manager_connections')[0];
      expect(connAfter.metadata.incrementalCursor.checkpoint).toBe('cursor-cal');
      expect(rows('booking_channel_calendar_snapshots').some((row) => (
        row.date === '2026-07-20' && row.availability_status === 'available'
      ))).toBe(true);
      expect(rows('booking_channel_calendar_snapshots').some((row) => (
        row.date === '2026-07-20' && Number(row.price_amount) === 7777
      ))).toBe(true);

      const priorCheckpoint = connAfter.metadata.incrementalCursor.checkpoint;
      processInboundBookingRequest.mockRejectedValueOnce(new Error('intake boom token=secret-value-xyz'));
      const failed = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          bookings: [{
            external_booking_id: 'book-fail',
            external_object_id: 'ext-1',
            guest_safe_name: 'Виктор',
            checkin_date: '2026-09-01',
            checkout_date: '2026-09-03',
            status: 'confirmed',
            change_kind: 'created',
          }],
          currentCursor: { stream: 'incremental', checkpoint: priorCheckpoint },
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-should-not-commit' },
        }),
      });
      expect(failed.status).toBe('failed');
      expect(failed.cursorCommitted).toBe(false);
      expect(rows('booking_channel_manager_connections')[0].metadata.incrementalCursor.checkpoint).toBe(priorCheckpoint);

      cancelReservation.mockClear();
      processInboundBookingRequest.mockClear();
      const cancelOnce = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          booking: { change_kind: 'cancelled', status: 'cancelled' },
          currentCursor: { stream: 'incremental', checkpoint: priorCheckpoint },
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-cancel-1' },
        }),
      });
      expect(cancelOnce.status).not.toBe('failed');
      expect(cancelOnce.counters.cancelled).toBe(1);
      expect(cancelReservation).toHaveBeenCalledTimes(1);

      cancelReservation.mockClear();
      processInboundBookingRequest.mockClear();
      const replay = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          booking: { change_kind: 'cancelled', status: 'cancelled' },
          currentCursor: { stream: 'incremental', checkpoint: 'cursor-cancel-1' },
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-cancel-2' },
        }),
      });
      expect(replay.status).not.toBe('failed');
      expect(replay.counters.cancelled).toBe(0);
      expect(processInboundBookingRequest).not.toHaveBeenCalled();
      expect(rows('booking_channel_imported_bookings').filter((row) => row.external_booking_id === 'book-1')).toHaveLength(1);
      expect(rows('reservation_ledger_audit').filter((row) => row.action === 'reservation_cancelled')).toHaveLength(1);
    });
  });

  describe('limits, safety, capabilities, and status', () => {
    it('rejects oversized batches and redacts secrets from safe errors/metadata', async () => {
      expect(() => validateManualChannelIncrementalDelta(baseDelta({
        bookings: Array.from({ length: MAX_INCREMENTAL_BATCH_ROWS + 1 }, (_, i) => ({
          external_booking_id: `book-${i}`,
          status: 'confirmed',
          change_kind: 'created',
        })),
        nextCursor: { stream: 'incremental', checkpoint: 'too-big' },
      }))).toThrow(/не более/);

      expect(() => validateManualChannelIncrementalDelta(baseDelta({
        booking: { api_token: 'super-secret' },
        nextCursor: { stream: 'incremental', checkpoint: 'secret-delta' },
      } as any))).toThrow(/секрет/);

      const connection = await seedInitialSync();
      processInboundBookingRequest.mockRejectedValueOnce(
        new Error('provider failed with bearer abcdefghijklmnop and api_key=leak'),
      );
      const result = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          bookings: [{
            external_booking_id: 'book-secret-fail',
            external_object_id: 'ext-1',
            guest_safe_name: 'Глеб',
            checkin_date: '2026-10-01',
            checkout_date: '2026-10-03',
            status: 'confirmed',
            change_kind: 'created',
          }],
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-secret' },
        }),
      });
      expect(result.status).toBe('failed');
      const warningText = result.warnings.map((item) => item.message).join('\n');
      expect(warningText).toMatch(/скрыты|\[redacted\]/i);
      expect(warningText).not.toMatch(/abcdefghijklmnop|api_key=leak/i);
      const serialized = JSON.stringify({
        safeError: result.safeError,
        warnings: result.warnings,
        metadata: rows('booking_channel_manager_connections')[0].metadata,
        runMeta: rows('booking_channel_import_runs').find((row) => row.import_type === 'incremental_sync')?.metadata,
      });
      expect(serialized).not.toMatch(/abcdefghijklmnop|api_key=leak/i);
    });

    it('exposes no outbound OTA write capabilities and status cursor fields without raw checkpoint', async () => {
      expect(MANUAL_INCREMENTAL_LIVE_CAPABILITIES).toMatchObject({
        writePrices: false,
        writeAvailability: false,
        incrementalCursor: true,
        webhooks: false,
      });
      const adapter = createChannelLiveCoreAdapter('manual', {
        incrementalDelta: baseDelta({ booking: { change_kind: 'unchanged' } }),
      });
      expect(adapter.getIdentity().supportsRealApi).toBe(false);
      expect(adapter.capabilities.writePrices).toBe(false);
      expect(adapter.capabilities.writeAvailability).toBe(false);

      const connection = await seedInitialSync();
      const ran = await runChannelManagerIncrementalSync({
        connectionId: connection.id,
        delta: baseDelta({
          booking: { change_kind: 'unchanged' },
          nextCursor: { stream: 'incremental', checkpoint: 'cursor-status-raw-value' },
        }),
      });
      expect(ran.status).not.toBe('failed');

      const status = await getChannelLiveCoreStatus(connection.id);
      expect(status.incrementalSyncEnabled).toBe(true);
      expect(status.cursorPresent).toBe(true);
      expect(status.cursorCheckpointHash).toBe(checkpointHash('cursor-status-raw-value'));
      expect(status.cursorCheckpointHash).not.toBe('cursor-status-raw-value');
      expect(status).not.toHaveProperty('incrementalCursor');
      expect(status.latestIncrementalRun).toMatchObject({
        id: ran.run.id,
        importType: 'incremental_sync',
        status: expect.stringMatching(/completed/),
      });
      expect(status.realProviderApiEnabled).toBe(false);
    });
  });
});
