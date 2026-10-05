import { beforeEach, describe, expect, it, vi } from 'vitest';

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
function rows(table: string): Row[] {
  return tables[table] ?? (tables[table] = []);
}

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

function validateConnectionScopeInMemory(connectionId: string, expectedScope: unknown) {
  const expected = expectedScope && typeof expectedScope === 'object' ? expectedScope as Row : null;
  const connection = rows('booking_channel_manager_connections').find((row) => row.id === connectionId);
  if (!connection) {
    return { data: { success: false, code: 'connection_not_found', message: 'connection not found' }, error: null };
  }
  if (!expected) {
    return { data: { success: false, code: 'connection_scope_invalid', message: 'expected scope missing' }, error: null };
  }
  const property = rows('booking_property_setup_profiles').find((row) => row.id === connection.property_setup_id);
  const accountId = String(connection.metadata?.accountId ?? '');
  if (
    String(connection.owner_setup_id ?? '') !== String(expected.ownerSetupId ?? '')
    || String(connection.property_setup_id ?? '') !== String(expected.propertySetupId ?? '')
    || String(property?.owner_setup_id ?? '') !== String(expected.ownerSetupId ?? '')
    || String(property?.property_id ?? '') !== String(expected.propertyId ?? '')
    || accountId !== String(expected.accountId ?? '')
  ) {
    return { data: { success: false, code: 'account_scope_mismatch', message: 'connection scope changed' }, error: null };
  }
  return null;
}

function setLiveSyncLeaseInMemory(args: Record<string, unknown> = {}) {
  const connectionId = String(args.p_connection_id ?? '');
  const scopeFailure = validateConnectionScopeInMemory(connectionId, args.p_expected_scope);
  if (scopeFailure) return scopeFailure;
  const connection = rows('booking_channel_manager_connections').find((row) => row.id === connectionId)!;
  const lease = args.p_lease && typeof args.p_lease === 'object' ? args.p_lease as Row : {};
  connection.metadata = { ...(connection.metadata ?? {}), liveSyncLease: lease };
  if (args.p_updated_at) connection.updated_at = args.p_updated_at;
  if (args.p_last_import_at) connection.last_import_at = args.p_last_import_at;
  return { data: { success: true }, error: null };
}

function updateLiveConnectionScopedInMemory(args: Record<string, unknown> = {}) {
  const connectionId = String(args.p_connection_id ?? '');
  const scopeFailure = validateConnectionScopeInMemory(connectionId, args.p_expected_scope);
  if (scopeFailure) return scopeFailure;
  const connection = rows('booking_channel_manager_connections').find((row) => row.id === connectionId)!;
  const patch = args.p_patch && typeof args.p_patch === 'object' ? args.p_patch as Row : {};
  Object.assign(connection, patch);
  return { data: { success: true, connection: { ...connection } }, error: null };
}

function updateImportRunScopedInMemory(args: Record<string, unknown> = {}) {
  const connectionId = String(args.p_connection_id ?? '');
  const scopeFailure = validateConnectionScopeInMemory(connectionId, args.p_expected_scope);
  if (scopeFailure) return scopeFailure;
  const runId = String(args.p_run_id ?? '');
  const run = rows('booking_channel_import_runs').find(
    (row) => row.id === runId && row.connection_id === connectionId,
  );
  if (!run) {
    return { data: { success: false, code: 'import_run_not_found', message: 'import run not found in connection scope' }, error: null };
  }
  const patch = args.p_patch && typeof args.p_patch === 'object' ? args.p_patch as Row : {};
  Object.assign(run, patch);
  return { data: { success: true, run: { ...run } }, error: null };
}

function acquireLiveSyncGuardScopedInMemory(args: Record<string, unknown> = {}) {
  const connectionId = String(args.p_connection_id ?? '');
  const scopeFailure = validateConnectionScopeInMemory(connectionId, args.p_expected_scope);
  if (scopeFailure) return scopeFailure;
  const importType = String(args.p_import_type ?? '');
  const liveTypes = ['initial_sync', 'incremental_sync', 'reconciliation_recovery'];
  const exists = rows('booking_channel_import_runs').some((row) => (
    row.connection_id === connectionId
    && liveTypes.includes(String(row.import_type ?? ''))
    && row.status === 'running'
  ));
  if (exists) {
    return {
      data: {
        success: false,
        code: 'execution_guard',
        message: 'live sync already running for this connection',
      },
      error: null,
    };
  }
  const startedAt = String(args.p_started_at ?? new Date().toISOString());
  const connection = rows('booking_channel_manager_connections').find((row) => row.id === connectionId);
  const metadata = args.p_metadata && typeof args.p_metadata === 'object'
    ? { ...(args.p_metadata as Row) }
    : {};
  const run = {
    id: String(args.p_run_id ?? ''),
    connection_id: connectionId,
    provider: String(args.p_provider ?? connection?.provider ?? ''),
    status: 'running',
    import_type: importType,
    started_at: startedAt,
    finished_at: null,
    imported_objects_count: 0,
    imported_bookings_count: 0,
    imported_calendar_days_count: 0,
    imported_prices_count: 0,
    warnings: [],
    errors: [],
    safe_summary: null,
    metadata,
    created_at: startedAt,
    updated_at: startedAt,
  };
  rows('booking_channel_import_runs').push(run);
  return { data: { success: true, run: { ...run } }, error: null };
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

import { initializeChannelManagerConnection } from '../channel-manager-access-import';
import {
  clearChannelLiveCoreSchemaStateCache,
  runChannelManagerInitialSync,
  setChannelLiveCoreSchemaReadyOverride,
  setChannelLiveCoreSchemaStateOverride,
} from '../channel-manager-live-core';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROPERTY_ID = '20000000-0000-4000-8000-000000000002';
const BOOKING_OPS_ID = '30000000-0000-4000-8000-000000000003';
const OTHER_BOOKING_OPS_ID = '30000000-0000-4000-8000-000000000007';
const ACCOUNT_ID = 'account-live-core';

function twoNightSnapshot(overrides: Record<string, unknown> = {}) {
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
    calendar: [
      {
        external_object_id: 'ext-1',
        date: '2026-07-10',
        availability_status: 'booked',
        price_amount: 5000,
        currency: 'RUB',
        ...(overrides.calendarDay1 as Row | undefined),
      },
      {
        external_object_id: 'ext-1',
        date: '2026-07-11',
        availability_status: 'booked',
        price_amount: 5000,
        currency: 'RUB',
        ...(overrides.calendarDay2 as Row | undefined),
      },
    ],
    pricing: [
      { external_object_id: 'ext-1', date: '2026-07-10', price_amount: 5000, currency: 'RUB' },
      { external_object_id: 'ext-1', date: '2026-07-11', price_amount: 5000, currency: 'RUB' },
    ],
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
  rows('properties').push({ id: 'prop-a', account_id: ACCOUNT_ID });
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
  supabaseRpc.mockImplementation(async (fnName: string, args?: Record<string, unknown>) => {
    if (fnName === 'channel_manager_set_live_sync_lease_scoped_v1') {
      return setLiveSyncLeaseInMemory(args ?? {});
    }
    if (fnName === 'channel_manager_update_live_connection_scoped_v1') {
      return updateLiveConnectionScopedInMemory(args ?? {});
    }
    if (fnName === 'channel_manager_acquire_live_sync_guard_scoped_v1') {
      return acquireLiveSyncGuardScopedInMemory(args ?? {});
    }
    if (fnName === 'channel_manager_update_import_run_scoped_v1') {
      return updateImportRunScopedInMemory(args ?? {});
    }
    return { data: null, error: { message: `unexpected rpc ${fnName}` } };
  });

  canAutoSendCommunicationIntent.mockResolvedValue({ eligible: false, reason: 'global_off' });
  processInboundBookingRequest.mockResolvedValue({ bookingId: BOOKING_OPS_ID, intakeStatus: 'processed' });
  updateBookingOpsRecord.mockResolvedValue({ ok: true });
  cancelReservation.mockResolvedValue({ changed: true });
  getUnifiedAvailability.mockResolvedValue({ available: true, conflicts: [] });
  setChannelLiveCoreSchemaReadyOverride(true);
});

describe('Live Core initial sync calendar self-conflict regression', () => {
  it('completes for one object, one two-night booking and two booked calendar rows', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    // Pre-match external booking so reconcile does not leave unmatched warning noise as blocker.
    rows('booking_ops_records').push({
      id: BOOKING_OPS_ID,
      account_id: ACCOUNT_ID,
      booking_id: 'book-1',
      property_id: 'prop-a',
      guest_name: 'Анна',
      check_in_at: '2026-07-10T00:00:00.000Z',
      check_out_at: '2026-07-12T00:00:00.000Z',
      normalized_status: 'confirmed',
    });

    const result = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: twoNightSnapshot(),
    });

    expect(result.status).toBe('completed');
    expect(result.counters.objects).toBe(1);
    expect(rows('booking_channel_imported_bookings')).toHaveLength(1);
    expect(rows('booking_channel_calendar_snapshots').filter((row) => row.availability_status === 'booked')).toHaveLength(2);
    expect(result.warnings.filter((item) => item.type === 'availability_conflict')).toHaveLength(0);
    expect(result.warnings.some((item) => /пересечен/i.test(item.message))).toBe(false);
  });

  it('still fails when a blocked calendar day overlaps the imported stay', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    rows('booking_ops_records').push({
      id: BOOKING_OPS_ID,
      account_id: ACCOUNT_ID,
      booking_id: 'book-1',
      property_id: 'prop-a',
      guest_name: 'Анна',
      check_in_at: '2026-07-10T00:00:00.000Z',
      check_out_at: '2026-07-12T00:00:00.000Z',
      normalized_status: 'confirmed',
    });

    const result = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: twoNightSnapshot({
        calendarDay1: { availability_status: 'blocked' },
      }),
    });

    expect(result.status).toBe('failed');
    expect(result.warnings.some((item) => item.type === 'availability_conflict' && item.severity === 'blocker')).toBe(true);
  });

  it('still fails when another overlapping booking exists on the property', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    rows('booking_ops_records').push(
      {
        id: BOOKING_OPS_ID,
        account_id: ACCOUNT_ID,
        booking_id: 'book-1',
        property_id: 'prop-a',
        guest_name: 'Анна',
        check_in_at: '2026-07-10T00:00:00.000Z',
        check_out_at: '2026-07-12T00:00:00.000Z',
        normalized_status: 'confirmed',
      },
      {
        id: OTHER_BOOKING_OPS_ID,
        account_id: ACCOUNT_ID,
        booking_id: 'book-other',
        property_id: 'prop-a',
        guest_name: 'Борис',
        check_in_at: '2026-07-11T00:00:00.000Z',
        check_out_at: '2026-07-13T00:00:00.000Z',
        normalized_status: 'confirmed',
      },
    );

    const result = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: twoNightSnapshot(),
    });

    expect(result.status).toBe('failed');
    expect(result.warnings.some((item) => item.type === 'availability_conflict' && item.severity === 'blocker')).toBe(true);
  });

  it('safe rerun after a failed initial sync does not duplicate imported rows', async () => {
    const connection = await initializeChannelManagerConnection(PROPERTY_ID, 'manual');
    rows('booking_ops_records').push({
      id: BOOKING_OPS_ID,
      account_id: ACCOUNT_ID,
      booking_id: 'book-1',
      property_id: 'prop-a',
      guest_name: 'Анна',
      check_in_at: '2026-07-10T00:00:00.000Z',
      check_out_at: '2026-07-12T00:00:00.000Z',
      normalized_status: 'confirmed',
    });

    const failed = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: twoNightSnapshot({
        calendarDay1: { availability_status: 'blocked' },
      }),
    });
    expect(failed.status).toBe('failed');
    expect(rows('booking_channel_imported_objects')).toHaveLength(1);
    expect(rows('booking_channel_imported_bookings')).toHaveLength(1);
    expect(rows('booking_channel_calendar_snapshots')).toHaveLength(2);

    const recovered = await runChannelManagerInitialSync({
      connectionId: connection.id,
      snapshot: twoNightSnapshot(),
    });

    expect(recovered.status).toBe('completed');
    expect(rows('booking_channel_imported_objects')).toHaveLength(1);
    expect(rows('booking_channel_imported_bookings')).toHaveLength(1);
    expect(rows('booking_channel_calendar_snapshots')).toHaveLength(2);
    expect(rows('booking_ops_records').filter((row) => row.booking_id === 'book-1')).toHaveLength(1);
  });
});
