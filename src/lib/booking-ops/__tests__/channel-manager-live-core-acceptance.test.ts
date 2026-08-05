import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

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

/** Production-accurate direct ON DELETE CASCADE edges used by the in-memory fake. */
const CASCADE_CHILDREN: Record<string, Array<{ table: string; column: string }>> = {
  booking_owner_setup_profiles: OWNER_SETUP_CASCADE_CHILDREN.map((spec) => ({
    table: spec.table,
    column: spec.parentColumn,
  })),
  booking_property_setup_profiles: PROPERTY_SETUP_CASCADE_CHILDREN.map((spec) => ({
    table: spec.table,
    column: spec.parentColumn,
  })),
  booking_channel_manager_connections: [
    { table: 'booking_channel_import_runs', column: 'connection_id' },
    { table: 'booking_channel_imported_bookings', column: 'connection_id' },
    { table: 'booking_channel_imported_objects', column: 'connection_id' },
  ],
};

function applyCascadeDelete(table: string, removedIds: string[]) {
  if (removedIds.length === 0) return;
  const children = CASCADE_CHILDREN[table] ?? [];
  for (const child of children) {
    const doomed = rows(child.table).filter((row) => removedIds.includes(String(row[child.column])));
    if (doomed.length === 0) continue;
    const doomedIds = doomed.map((row) => String(row.id));
    tables[child.table] = rows(child.table).filter((row) => !doomedIds.includes(String(row.id)));
    applyCascadeDelete(child.table, doomedIds);
  }
}

class Query {
  private filtered: Row[];
  private deleteMode = false;
  private forcedError: { code?: string; message: string } | null = null;
  constructor(private table: string, private options: { patch?: Row; count?: boolean; head?: boolean; deleteMode?: boolean } = {}) {
    this.filtered = [...rows(table)];
    this.deleteMode = options.deleteMode === true;
  }
  eq(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => row[column] !== value);
    return this;
  }
  gte(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => String(row[column] ?? '') >= String(value));
    return this;
  }
  lte(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => String(row[column] ?? '') <= String(value));
    return this;
  }
  gt(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => String(row[column] ?? '') > String(value));
    return this;
  }
  lt(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => String(row[column] ?? '') < String(value));
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filtered = this.filtered.filter((row) => values.includes(row[column]));
    return this;
  }
  contains(column: string, value: Record<string, unknown>) {
    this.filtered = this.filtered.filter((row) => {
      const meta = row[column] ?? {};
      return Object.entries(value).every(([key, expected]) => meta[key] === expected);
    });
    return this;
  }
  or(expression: string) {
    const parts = expression.split(',');
    const base = this.filtered;
    this.filtered = base.filter((row) => parts.some((part) => {
      if (part.includes('lead_id.eq.')) {
        return row.lead_id === part.replace('lead_id.eq.', '');
      }
      if (part.includes('metadata->>acceptanceHarness.eq.')) {
        const expected = part.replace('metadata->>acceptanceHarness.eq.', '');
        return row.metadata?.acceptanceHarness === expected;
      }
      if (part.includes('source_ref.eq.')) {
        return row.source_ref === part.replace('source_ref.eq.', '');
      }
      if (part.includes('idempotency_key.eq.')) {
        return row.idempotency_key === part.replace('idempotency_key.eq.', '');
      }
      return false;
    }));
    return this;
  }
  order() { return this; }
  limit(value: number) { this.filtered = this.filtered.slice(0, value); return this; }
  select(_columns = '*', options?: { count?: string; head?: boolean }) {
    if (options) this.options = { ...this.options, count: Boolean(options.count), head: options.head };
    return this;
  }
  forceError(error: { code?: string; message: string }) {
    this.forcedError = error;
    return this;
  }
  private execute() {
    if (this.forcedError) {
      return { data: null, error: this.forcedError, count: null };
    }
    if (this.deleteMode) {
      const removed = this.filtered;
      const removedIds = removed.map((row) => String(row.id));
      const remaining = rows(this.table).filter((row) => !removedIds.includes(String(row.id)));
      tables[this.table] = remaining;
      applyCascadeDelete(this.table, removedIds);
      return { data: removed, error: null, count: removed.length };
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
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
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

import {
  HARNESS_IDENTITY_COLLISION,
  HARNESS_SCOPE_COLLISION,
  LIVE_CORE_ACCEPTANCE_CASCADE_MANIFEST,
  LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
  LIVE_CORE_ACCEPTANCE_HARNESS,
  LIVE_CORE_ACCEPTANCE_INTAKE_IDEMPOTENCY_KEY,
  LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE,
  LIVE_CORE_ACCEPTANCE_LEAD_ID,
  LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
  OWNER_SETUP_CASCADE_CHILDREN,
  PROPERTY_SETUP_CASCADE_CHILDREN,
  assertLiveCoreAcceptanceSnapshotSafe,
  buildLiveCoreAcceptanceSnapshot,
  cleanupLiveCoreAcceptanceHarness,
  ensureLiveCoreAcceptanceSetup,
  runChannelManagerLiveCoreAcceptance,
} from '../channel-manager-live-core-acceptance';
import {
  clearChannelLiveCoreSchemaStateCache,
  setChannelLiveCoreSchemaReadyOverride,
  setChannelLiveCoreSchemaStateOverride,
} from '../channel-manager-live-core';

const ORDINARY_OWNER_ID = 'aaaaaaaa-0000-4000-8000-000000000099';
const ORDINARY_PROPERTY_ID = 'bbbbbbbb-0000-4000-8000-000000000099';
const ORDINARY_CONNECTION_ID = 'cccccccc-0000-4000-8000-000000000099';
const ORDINARY_BOOKING_OPS_ID = 'dddddddd-0000-4000-8000-000000000099';
const UNMARKED_OWNER_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const UNMARKED_PROPERTY_ID = 'ffffffff-0000-4000-8000-000000000002';
const UNMARKED_CONNECTION_ID = '99999999-0000-4000-8000-000000000003';

let deleteHooks: Record<string, ((filtered: Row[]) => { data: null; error: { code?: string; message: string } } | null) | undefined> = {};

function seedOrdinaryPilotData() {
  rows('booking_owner_setup_profiles').push({
    id: ORDINARY_OWNER_ID,
    lead_id: 'ordinary-lead',
    metadata: { pilot: true },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  rows('booking_property_setup_profiles').push({
    id: ORDINARY_PROPERTY_ID,
    owner_setup_id: ORDINARY_OWNER_ID,
    property_id: 'ordinary-prop',
    title: 'Обычный объект',
    metadata: {},
    channel_access_status: 'not_requested',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  rows('booking_channel_manager_connections').push({
    id: ORDINARY_CONNECTION_ID,
    property_setup_id: ORDINARY_PROPERTY_ID,
    owner_setup_id: ORDINARY_OWNER_ID,
    provider: 'manual',
    status: 'connected',
    access_status: 'received',
    metadata: { pilot: true },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  rows('booking_ops_records').push({
    id: ORDINARY_BOOKING_OPS_ID,
    property_id: 'ordinary-prop',
    reservation_metadata: { pilot: true },
  });
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  deleteHooks = {};
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
    delete: vi.fn(() => {
      const query = new Query(table, { deleteMode: true });
      const originalThen = query.then.bind(query);
      query.then = ((resolve: (value: any) => void) => {
        const hook = deleteHooks[table];
        if (hook) {
          const intercepted = hook((query as any).filtered);
          if (intercepted) {
            resolve(intercepted);
            return;
          }
        }
        originalThen(resolve);
      }) as typeof query.then;
      return query;
    }),
  }));

  supabaseRpc.mockImplementation(async (fn: string) => {
    if (fn === 'channel_manager_live_core_schema_state') {
      return {
        data: {
          schemaVersion: 1,
          initialSyncTypeReady: true,
          atomicRunningGuardReady: true,
          ready: true,
        },
        error: null,
      };
    }
    if (fn === 'channel_manager_live_core_booking_ops_fk_children') {
      return { data: [], error: null };
    }
    if (fn === 'channel_manager_live_core_synthetic_recovery_cleanup') {
      return {
        data: null,
        error: { message: 'function channel_manager_live_core_synthetic_recovery_cleanup does not exist' },
      };
    }
    return { data: null, error: null };
  });

  canAutoSendCommunicationIntent.mockResolvedValue({ eligible: false, reason: 'global_off' });
  processInboundBookingRequest.mockImplementation(async (input?: Row) => {
    const { getLiveCoreAcceptanceCreateContext } = await import('../channel-manager-live-core-acceptance-context');
    const ctx = getLiveCoreAcceptanceCreateContext();
    const fromInput = input?.metadata && typeof input.metadata === 'object' && input.metadata.acceptanceHarness
      ? input.metadata
      : null;
    const reservationMetadata = fromInput ?? ctx?.reservationMetadata ?? {};
    const bookingOpsId = randomUUID();
    rows('booking_ops_records').push({
      id: bookingOpsId,
      account_id: null,
      property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
      booking_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
      guest_name: input?.guestName ?? 'Тестовый Гость ASI',
      guest_phone: null,
      guest_email: null,
      guest_telegram: null,
      ota_source: 'channel_manager',
      check_in_at: input?.checkInAt ?? null,
      check_out_at: input?.checkOutAt ?? null,
      reservation_metadata: reservationMetadata,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    rows('booking_inbound_intake_events').push({
      id: randomUUID(),
      source: LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE,
      source_ref: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
      idempotency_key: LIVE_CORE_ACCEPTANCE_INTAKE_IDEMPOTENCY_KEY,
      status: 'processed',
      booking_id: bookingOpsId,
      property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
      normalized_payload: {},
      missing_fields: [],
      automation_result: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { bookingId: bookingOpsId, intakeStatus: 'processed' };
  });
  updateBookingOpsRecord.mockResolvedValue({ ok: true });
  getUnifiedAvailability.mockResolvedValue({ available: true, conflicts: [] });
  setChannelLiveCoreSchemaReadyOverride(true);
});

describe('Channel Manager Live Core Acceptance Harness v1', () => {
  it('keeps acceptance block visible in Channel Manager panel markup without requiring selected connection', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/components/booking-ops/ChannelManagerImportPanel.tsx'), 'utf8');
    expect(panel).toContain('data-testid="channel-live-core-acceptance"');
    expect(panel).toContain('Производственный acceptance');
    expect(panel).toContain('Запустить acceptance');
    expect(panel).toContain('Удалить тестовый контур');
    expect(panel).toContain('Восстановление синтетических');
    expect(panel).toContain('Просмотреть очистку');
    expect(panel).toContain('isDevelopmentOwner');
    expect(panel).toContain('acceptanceExecutionId');
    expect(panel).toContain('data-testid="channel-live-core-recovery"');
    const acceptanceIdx = panel.indexOf('channel-live-core-acceptance');
    const selectedIdx = panel.indexOf('{selected ? (');
    expect(acceptanceIdx).toBeGreaterThan(-1);
    expect(selectedIdx).toBeGreaterThan(acceptanceIdx);
  });

  it('builds a safe synthetic snapshot without credentials or contact secrets', () => {
    const snapshot = buildLiveCoreAcceptanceSnapshot('20000000-0000-4000-8000-000000000002');
    expect(() => assertLiveCoreAcceptanceSnapshotSafe(snapshot)).not.toThrow();
    const text = JSON.stringify(snapshot);
    expect(text).not.toMatch(/password|token|api[_-]?key|secret|door|wifi/i);
    expect(text).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/\+7\d{10}/);
    expect(snapshot.bookings?.[0]?.guest_safe_name).toBe('Тестовый Гость ASI');
    expect(snapshot.objects).toHaveLength(1);
    expect(snapshot.bookings).toHaveLength(1);
    expect(snapshot.calendar).toHaveLength(1);
    expect(snapshot.pricing).toHaveLength(1);
  });

  it('fails before setup creation when schema is not ready', async () => {
    setChannelLiveCoreSchemaReadyOverride(false);
    setChannelLiveCoreSchemaStateOverride({
      schemaVersion: 0,
      initialSyncTypeReady: false,
      atomicRunningGuardReady: false,
      ready: false,
      blocker: 'Миграция Channel Manager Live Core ещё не применена. Initial sync недоступен.',
    });
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(false);
    expect(evidence.schemaReady).toBe(false);
    expect(evidence.failedStep).toBe('schema');
    expect(evidence.ownerSetupId).toBeNull();
    expect(evidence.propertySetupId).toBeNull();
    expect(evidence.connectionId).toBeNull();
    expect(rows('booking_owner_setup_profiles')).toHaveLength(0);
    expect(rows('booking_property_setup_profiles')).toHaveLength(0);
    expect(rows('booking_channel_manager_connections')).toHaveLength(0);
  });

  it('creates acceptance setup idempotently with harness marker', async () => {
    const first = await ensureLiveCoreAcceptanceSetup();
    const second = await ensureLiveCoreAcceptanceSetup();
    expect(first.ownerSetup.id).toBe(second.ownerSetup.id);
    expect(first.propertySetup.id).toBe(second.propertySetup.id);
    expect(rows('booking_owner_setup_profiles')).toHaveLength(1);
    expect(rows('booking_property_setup_profiles')).toHaveLength(1);
    expect(first.ownerSetup.leadId).toBe(LIVE_CORE_ACCEPTANCE_LEAD_ID);
    expect(first.ownerSetup.metadata.acceptanceHarness).toBe(LIVE_CORE_ACCEPTANCE_HARNESS);
    expect(second.propertySetup.metadata.acceptanceHarness).toBe(LIVE_CORE_ACCEPTANCE_HARNESS);
    expect(second.createdOwner).toBe(false);
  });

  it('imports one booking on first run and zero on second without duplicates', async () => {
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);
    expect(evidence.acceptanceExecutionId).toBeTruthy();
    expect(evidence.schemaReady).toBe(true);
    expect(evidence.importedFirstRun).toBe(1);
    expect(evidence.importedSecondRun).toBe(0);
    expect(evidence.duplicateCount).toBe(0);
    expect(evidence.firstRunId).toBeTruthy();
    expect(evidence.secondRunId).toBeTruthy();
    expect(evidence.firstRunId).not.toBe(evidence.secondRunId);
    expect(evidence.bookingOpsRecordId).toBeTruthy();
    expect(evidence.steps.every((step) => step.status === 'passed')).toBe(true);
    expect(rows('booking_channel_imported_bookings').filter((row) => row.external_booking_id === LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID)).toHaveLength(1);
    expect(rows('booking_ops_records').filter((row) => row.property_id === LIVE_CORE_ACCEPTANCE_PROPERTY_ID)).toHaveLength(1);
    expect(rows('booking_ops_records')[0].reservation_metadata.acceptanceHarness).toBe(LIVE_CORE_ACCEPTANCE_HARNESS);
    expect(rows('booking_ops_records')[0].reservation_metadata.acceptanceExecutionId).toBe(evidence.acceptanceExecutionId);
  });

  it('runs acceptance twice without cleanup and both runs pass', async () => {
    const first = await runChannelManagerLiveCoreAcceptance();
    expect(first.passed).toBe(true);
    expect(first.importedFirstRun).toBe(1);
    expect(first.importedSecondRun).toBe(0);

    const second = await runChannelManagerLiveCoreAcceptance();
    expect(second.passed).toBe(true);
    expect(second.importedFirstRun).toBe(1);
    expect(second.importedSecondRun).toBe(0);
    expect(second.acceptanceExecutionId).toBeTruthy();
    expect(second.acceptanceExecutionId).not.toBe(first.acceptanceExecutionId);
    expect(rows('booking_ops_records').filter((row) => row.property_id === LIVE_CORE_ACCEPTANCE_PROPERTY_ID)).toHaveLength(1);
    expect(rows('booking_channel_imported_bookings').filter((row) => row.external_booking_id === LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID)).toHaveLength(1);
  });

  it('runs acceptance, cleanup, then acceptance again with both runs passing', async () => {
    seedOrdinaryPilotData();
    const first = await runChannelManagerLiveCoreAcceptance();
    expect(first.passed).toBe(true);

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(true);
    expect(cleanup.remainingHarnessRows).toBe(0);
    expect(cleanup.remainingActiveHolds).toBe(0);
    expect(cleanup.remainingIntakeEvents).toBe(0);
    expect(rows('booking_owner_setup_profiles').some((row) => row.id === ORDINARY_OWNER_ID)).toBe(true);

    const second = await runChannelManagerLiveCoreAcceptance();
    expect(second.passed).toBe(true);
    expect(second.importedFirstRun).toBe(1);
    expect(second.importedSecondRun).toBe(0);
  });

  it('removes stale booking_inbound_intake_events before a new execution', async () => {
    rows('booking_inbound_intake_events').push({
      id: randomUUID(),
      source: LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE,
      source_ref: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
      idempotency_key: LIVE_CORE_ACCEPTANCE_INTAKE_IDEMPOTENCY_KEY,
      status: 'processed',
      booking_id: randomUUID(),
      property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
      normalized_payload: {},
      missing_fields: [],
      automation_result: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    // Non-harness intake must survive.
    rows('booking_inbound_intake_events').push({
      id: randomUUID(),
      source: 'web',
      source_ref: 'other-ref',
      idempotency_key: 'ext:web:other',
      status: 'processed',
      property_id: 'ordinary-prop',
      normalized_payload: {},
      missing_fields: [],
      automation_result: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);
    expect(rows('booking_inbound_intake_events').filter((row) => row.source === 'web')).toHaveLength(1);
    expect(rows('booking_inbound_intake_events').filter((row) => (
      row.source === LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE
      && row.property_id === LIVE_CORE_ACCEPTANCE_PROPERTY_ID
    )).length).toBeGreaterThanOrEqual(1);
  });

  it('removes or releases active availability holds for harness property', async () => {
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);
    rows('booking_availability_holds').push({
      id: randomUUID(),
      property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
      booking_id: evidence.bookingOpsRecordId,
      source: 'channel_import',
      status: 'active',
      date_from: '2026-09-01',
      date_to: '2026-09-03',
      conflict_status: 'no_conflict',
      idempotency_key: `hold:${LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID}`,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(true);
    expect(cleanup.deleted.availabilityHolds).toBeGreaterThanOrEqual(1);
    expect(rows('booking_availability_holds').filter((row) => (
      row.property_id === LIVE_CORE_ACCEPTANCE_PROPERTY_ID
      && ['active', 'confirmed'].includes(row.status)
    ))).toHaveLength(0);
    expect(cleanup.remainingActiveHolds).toBe(0);
  });

  it('removes overbooking checks attached to harness booking data', async () => {
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);
    rows('booking_overbooking_conflict_checks').push({
      id: randomUUID(),
      property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
      booking_id: evidence.bookingOpsRecordId,
      check_type: 'channel_import',
      status: 'no_conflict',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(true);
    expect(cleanup.deleted.overbookingChecks).toBeGreaterThanOrEqual(1);
    expect(rows('booking_overbooking_conflict_checks').filter((row) => row.booking_id === evidence.bookingOpsRecordId)).toHaveLength(0);
  });

  it('deletes telegram drafts so they do not block booking deletion', async () => {
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);
    rows('booking_ops_telegram_drafts').push({
      id: randomUUID(),
      booking_ops_record_id: evidence.bookingOpsRecordId,
      source_booking_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
      action_id: 'request_guest_documents',
      message_text: 'Тестовый черновик',
      status: 'draft',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(true);
    expect(cleanup.deleted.telegramDrafts).toBeGreaterThanOrEqual(1);
    expect(rows('booking_ops_telegram_drafts')).toHaveLength(0);
    expect(rows('booking_ops_records').filter((row) => row.id === evidence.bookingOpsRecordId)).toHaveLength(0);
  });

  it('fails closed on unmarked owner with reserved lead id and never modifies it', async () => {
    rows('booking_owner_setup_profiles').push({
      id: UNMARKED_OWNER_ID,
      lead_id: LIVE_CORE_ACCEPTANCE_LEAD_ID,
      owner_name: 'Ordinary reserved collision',
      metadata: { pilot: true },
      status: 'new',
      missing_fields: [],
      readiness_score: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(false);
    expect(evidence.failedStep).toBe('owner_setup');
    expect(evidence.blocker).toContain(HARNESS_IDENTITY_COLLISION);
    expect(rows('booking_owner_setup_profiles')).toHaveLength(1);
    expect(rows('booking_owner_setup_profiles')[0].id).toBe(UNMARKED_OWNER_ID);
    expect(rows('booking_owner_setup_profiles')[0].metadata.acceptanceHarness).toBeUndefined();
    expect(rows('booking_property_setup_profiles')).toHaveLength(0);
  });

  it('fails closed when unmarked property exists under marked owner (CASCADE would delete it)', async () => {
    const setup = await ensureLiveCoreAcceptanceSetup();
    rows('booking_property_setup_profiles').push({
      id: UNMARKED_PROPERTY_ID,
      owner_setup_id: setup.ownerSetup.id,
      property_id: 'unmarked-child-prop',
      title: 'Unmarked child',
      metadata: {},
      channel_access_status: 'not_requested',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);
    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(false);
    expect(cleanup.failedStage).toBe('harness_scope_preflight');
    expect(cleanup.blocker).toContain(HARNESS_SCOPE_COLLISION);
    expect(cleanup.blocker).toContain('booking_property_setup_profiles');
    expect(cleanup.foreignChildTables).toContain('booking_property_setup_profiles');
    expect(cleanup.ordinaryDataPreserved).toBe(true);
    expect(rows('booking_property_setup_profiles').some((row) => row.id === UNMARKED_PROPERTY_ID)).toBe(true);
    expect(rows('booking_owner_setup_profiles').some((row) => row.id === setup.ownerSetup.id)).toBe(true);
    expect(rows('booking_property_setup_profiles').some((row) => row.id === setup.propertySetup.id)).toBe(true);
  });

  it('fails closed when unmarked communication intent exists under marked owner', async () => {
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);
    const intentId = randomUUID();
    rows('booking_owner_setup_communication_intents').push({
      id: intentId,
      owner_setup_id: evidence.ownerSetupId,
      property_setup_id: evidence.propertySetupId,
      message_type: 'request_object_data',
      channel: 'manual',
      status: 'draft_ready',
      message_text: 'ordinary intent',
      message_template_key: 'ordinary',
      metadata: { pilot: true },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(false);
    expect(cleanup.failedStage).toBe('harness_scope_preflight');
    expect(cleanup.blocker).toContain(HARNESS_SCOPE_COLLISION);
    expect(cleanup.blocker).toContain('booking_owner_setup_communication_intents');
    expect(rows('booking_owner_setup_communication_intents').some((row) => row.id === intentId)).toBe(true);
    expect(rows('booking_owner_setup_profiles').some((row) => row.id === evidence.ownerSetupId)).toBe(true);
  });

  it('fails closed when unmarked CM connection exists under marked property', async () => {
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);
    rows('booking_channel_manager_connections').push({
      id: UNMARKED_CONNECTION_ID,
      property_setup_id: evidence.propertySetupId,
      owner_setup_id: evidence.ownerSetupId,
      provider: 'bnovo',
      status: 'connected',
      access_status: 'received',
      metadata: { pilot: true },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(false);
    expect(cleanup.failedStage).toBe('harness_scope_preflight');
    expect(cleanup.blocker).toContain(HARNESS_SCOPE_COLLISION);
    expect(cleanup.blocker).toContain('booking_channel_manager_connections');
    expect(rows('booking_channel_manager_connections').some((row) => row.id === UNMARKED_CONNECTION_ID)).toBe(true);
    expect(rows('booking_property_setup_profiles').some((row) => row.id === evidence.propertySetupId)).toBe(true);
  });

  it('fails closed when unmarked property asset exists under marked property', async () => {
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);
    const assetId = randomUUID();
    rows('booking_property_assets').push({
      id: assetId,
      property_setup_id: evidence.propertySetupId,
      asset_type: 'photo',
      status: 'uploaded',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(false);
    expect(cleanup.failedStage).toBe('harness_scope_preflight');
    expect(cleanup.blocker).toContain('booking_property_assets');
    expect(rows('booking_property_assets').some((row) => row.id === assetId)).toBe(true);
    expect(rows('booking_property_setup_profiles').some((row) => row.id === evidence.propertySetupId)).toBe(true);
  });

  it('fails closed when unmarked pricing/market/publication rows exist under marked property', async () => {
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);
    const packageId = randomUUID();
    const pricingId = randomUUID();
    const sourceId = randomUUID();
    const audienceId = randomUUID();
    rows('booking_channel_publication_packages').push({
      id: packageId,
      property_setup_id: evidence.propertySetupId,
      provider: 'manual',
      status: 'draft',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    rows('booking_pricing_profiles').push({
      id: pricingId,
      property_setup_id: evidence.propertySetupId,
      status: 'draft',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    rows('booking_market_signal_sources').push({
      id: sourceId,
      property_setup_id: evidence.propertySetupId,
      source_type: 'manual',
      provider: 'manual',
      status: 'draft',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    rows('booking_property_audience_profiles').push({
      id: audienceId,
      property_setup_id: evidence.propertySetupId,
      primary_audience: 'unknown',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(false);
    expect(cleanup.failedStage).toBe('harness_scope_preflight');
    expect(cleanup.foreignChildCount).toBeGreaterThanOrEqual(4);
    expect(cleanup.ordinaryDataPreserved).toBe(true);
    expect(rows('booking_channel_publication_packages').some((row) => row.id === packageId)).toBe(true);
    expect(rows('booking_pricing_profiles').some((row) => row.id === pricingId)).toBe(true);
    expect(rows('booking_market_signal_sources').some((row) => row.id === sourceId)).toBe(true);
    expect(rows('booking_property_audience_profiles').some((row) => row.id === audienceId)).toBe(true);
    expect(rows('booking_property_setup_profiles').some((row) => row.id === evidence.propertySetupId)).toBe(true);
  });

  it('fails closed on unsafe unmarked deterministic Booking Ops and never adopts it', async () => {
    rows('booking_ops_records').push({
      id: randomUUID(),
      account_id: 'ordinary-account',
      property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
      booking_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
      guest_name: 'Ordinary Guest',
      reservation_metadata: { pilot: true },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(false);
    expect(evidence.failedStep).toBe('recovery_cleanup');
    expect(evidence.recoveryRequired).toBe(true);
    expect(evidence.recoverySafeToCleanup).toBe(false);
    expect(rows('booking_ops_records').filter((row) => (
      row.property_id === LIVE_CORE_ACCEPTANCE_PROPERTY_ID
      && row.booking_id === LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID
      && row.reservation_metadata?.acceptanceHarness !== LIVE_CORE_ACCEPTANCE_HARNESS
    )).length).toBe(1);
  });

  it('cleanup partial failure does not claim ordinary data was preserved via hardcoded flag', async () => {
    seedOrdinaryPilotData();
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);

    deleteHooks.booking_ops_telegram_drafts = () => ({
      data: null,
      error: { code: '23503', message: 'violates foreign key constraint' },
    });
    rows('booking_ops_telegram_drafts').push({
      id: randomUUID(),
      booking_ops_record_id: evidence.bookingOpsRecordId,
      source_booking_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
      action_id: 'request_guest_documents',
      message_text: 'blocking draft',
      status: 'draft',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(false);
    expect(cleanup.ok).toBe(false);
    expect(cleanup.failedStage).toBe('telegram_drafts');
    expect(cleanup.scopeVerified).toBe(false);
    expect(cleanup.ordinaryDataPreserved).toBe(false);
    expect((cleanup as { preservedOrdinaryData?: boolean }).preservedOrdinaryData).toBeUndefined();
    expect(rows('booking_owner_setup_profiles').some((row) => row.id === ORDINARY_OWNER_ID)).toBe(true);
  });

  it('leaves no exact harness rows after successful cleanup on clean contour', async () => {
    seedOrdinaryPilotData();
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);

    rows('booking_availability_holds').push({
      id: randomUUID(),
      property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
      booking_id: evidence.bookingOpsRecordId,
      source: 'channel_import',
      status: 'active',
      date_from: '2026-09-01',
      date_to: '2026-09-03',
      conflict_status: 'no_conflict',
      idempotency_key: `hold-final:${LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID}`,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    rows('booking_overbooking_conflict_checks').push({
      id: randomUUID(),
      property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
      booking_id: evidence.bookingOpsRecordId,
      check_type: 'channel_import',
      status: 'no_conflict',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    rows('booking_ops_telegram_drafts').push({
      id: randomUUID(),
      booking_ops_record_id: evidence.bookingOpsRecordId,
      source_booking_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
      action_id: 'send_contract',
      message_text: 'draft',
      status: 'draft',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(true);
    expect(cleanup.cascadeScopeVerified).toBe(true);
    expect(cleanup.ordinaryDataPreserved).toBe(true);
    expect(cleanup.scopeVerified).toBe(true);
    expect(cleanup.remainingHarnessRows).toBe(0);
    expect(cleanup.remainingActiveHolds).toBe(0);
    expect(cleanup.remainingIntakeEvents).toBe(0);
    expect(rows('booking_owner_setup_profiles').filter((row) => row.metadata?.acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS)).toHaveLength(0);
    expect(rows('booking_property_setup_profiles').filter((row) => row.metadata?.acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS)).toHaveLength(0);
    expect(rows('booking_channel_manager_connections').filter((row) => row.metadata?.acceptanceHarness === LIVE_CORE_ACCEPTANCE_HARNESS)).toHaveLength(0);
    expect(rows('booking_ops_records').filter((row) => row.property_id === LIVE_CORE_ACCEPTANCE_PROPERTY_ID)).toHaveLength(0);
    expect(rows('booking_channel_imported_bookings').filter((row) => row.external_booking_id === LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID)).toHaveLength(0);
    expect(rows('booking_inbound_intake_events').filter((row) => (
      row.source === LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE
      && row.property_id === LIVE_CORE_ACCEPTANCE_PROPERTY_ID
    ))).toHaveLength(0);
    expect(rows('booking_owner_setup_profiles').some((row) => row.id === ORDINARY_OWNER_ID)).toBe(true);
  });

  it('simulated FK cascade would remove unmarked children if parent were deleted, but cleanup refuses', async () => {
    const setup = await ensureLiveCoreAcceptanceSetup();
    rows('booking_property_setup_profiles').push({
      id: UNMARKED_PROPERTY_ID,
      owner_setup_id: setup.ownerSetup.id,
      property_id: 'cascade-victim',
      title: 'Cascade victim',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Prove the fake cascade works: deleting owner would wipe unmarked property.
    const ownerId = setup.ownerSetup.id;
    const before = rows('booking_property_setup_profiles').some((row) => row.id === UNMARKED_PROPERTY_ID);
    expect(before).toBe(true);
    await supabaseFrom('booking_owner_setup_profiles').delete().eq('id', ownerId).select('id');
    expect(rows('booking_property_setup_profiles').some((row) => row.id === UNMARKED_PROPERTY_ID)).toBe(false);

    // Restore owner+properties for harness fail-closed check is N/A — instead assert cleanup path.
    // Re-seed and assert cleanup never triggers that cascade.
    for (const key of Object.keys(tables)) tables[key] = [];
    const setup2 = await ensureLiveCoreAcceptanceSetup();
    rows('booking_property_setup_profiles').push({
      id: UNMARKED_PROPERTY_ID,
      owner_setup_id: setup2.ownerSetup.id,
      property_id: 'cascade-victim-2',
      title: 'Cascade victim 2',
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.cleanupPassed).toBe(false);
    expect(cleanup.failedStage).toBe('harness_scope_preflight');
    expect(rows('booking_property_setup_profiles').some((row) => row.id === UNMARKED_PROPERTY_ID)).toBe(true);
    expect(rows('booking_owner_setup_profiles').some((row) => row.id === setup2.ownerSetup.id)).toBe(true);
  });

  it('cascade preflight manifest covers every direct CASCADE child from migrations', () => {
    const migrationDir = resolve(process.cwd(), 'supabase/migrations');
    const files = [
      '20260701110000_owner_object_setup_autopilot_v1.sql',
      '20260701111403_channel_manager_access_import_v1.sql',
      '20260701170000_channel_publishing_preparation_v1.sql',
      '20260701180000_pricing_intelligence_tariff_grid_v1.sql',
      '20260702120000_market_signals_ingestion_v1.sql',
    ];
    const sql = files.map((file) => readFileSync(resolve(migrationDir, file), 'utf8')).join('\n');

    function cascadeTables(parent: string): string[] {
      const found = new Set<string>();
      const createRe = /create table if not exists public\.([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*;/gi;
      let match = createRe.exec(sql);
      while (match) {
        const table = match[1];
        const body = match[2];
        const fk = new RegExp(
          String.raw`references\s+public\.${parent}\s*\(\s*id\s*\)\s+on delete cascade`,
          'i',
        );
        if (fk.test(body)) found.add(table);
        match = createRe.exec(sql);
      }
      return [...found].sort();
    }

    const ownerExpected = cascadeTables('booking_owner_setup_profiles');
    const propertyExpected = cascadeTables('booking_property_setup_profiles');
    const ownerManifest = OWNER_SETUP_CASCADE_CHILDREN.map((item) => item.table).sort();
    const propertyManifest = PROPERTY_SETUP_CASCADE_CHILDREN.map((item) => item.table).sort();

    expect(ownerManifest).toEqual(ownerExpected);
    expect(propertyManifest).toEqual(propertyExpected);
    expect(LIVE_CORE_ACCEPTANCE_CASCADE_MANIFEST.ownerSetup).toBe(OWNER_SETUP_CASCADE_CHILDREN);
    expect(LIVE_CORE_ACCEPTANCE_CASCADE_MANIFEST.propertySetup).toBe(PROPERTY_SETUP_CASCADE_CHILDREN);
  });

  it('returns exact failed step evidence when first sync processing fails', async () => {
    processInboundBookingRequest.mockRejectedValue(new Error('intake boom'));
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(false);
    expect(evidence.failedStep).toBe('first_sync');
    expect(evidence.blocker).toBeTruthy();
    expect(evidence.steps.find((step) => step.key === 'first_sync')?.status).toBe('failed');
    expect(evidence.steps.find((step) => step.key === 'booking_check')?.status).toBe('waiting');
  });

  it('returns exact failed step when booking verification finds zero imported bookings', async () => {
    processInboundBookingRequest.mockImplementation(async () => {
      throw new Error('Booking Ops не создал бронь: нужна проверка данных.');
    });
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(false);
    expect(['first_sync', 'booking_check']).toContain(evidence.failedStep);
    expect(evidence.blocker).toBeTruthy();
  });

  it('cleanup removes only acceptanceHarness records and verifies remaining counters', async () => {
    seedOrdinaryPilotData();
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.ok).toBe(true);
    expect(cleanup.cleanupPassed).toBe(true);
    expect(cleanup.cascadeScopeVerified).toBe(true);
    expect(cleanup.ordinaryDataPreserved).toBe(true);
    expect(cleanup.scopeVerified).toBe(true);
    expect(cleanup.remainingHarnessRows).toBe(0);
    expect(cleanup.deleted.ownerSetups).toBeGreaterThanOrEqual(1);
    expect(rows('booking_owner_setup_profiles').some((row) => row.id === ORDINARY_OWNER_ID)).toBe(true);
    expect(rows('booking_property_setup_profiles').some((row) => row.id === ORDINARY_PROPERTY_ID)).toBe(true);
    expect(rows('booking_channel_manager_connections').some((row) => row.id === ORDINARY_CONNECTION_ID)).toBe(true);
    expect(rows('booking_ops_records').some((row) => row.id === ORDINARY_BOOKING_OPS_ID)).toBe(true);
    expect(rows('booking_owner_setup_profiles').some((row) => row.lead_id === LIVE_CORE_ACCEPTANCE_LEAD_ID)).toBe(false);
  });

  it('failure after Booking Ops creation leaves identifiable harness-owned artifacts recoverable without SQL', async () => {
    const {
      previewLiveCoreSyntheticRecovery,
      cleanupLiveCoreSyntheticRecovery,
      LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
    } = await import('../channel-manager-live-core-acceptance');

    const failed = await runChannelManagerLiveCoreAcceptance({
      injectFailureAfterBookingOpsCreate: true,
    });
    expect(failed.passed).toBe(false);
    expect(failed.failedStep).toBe('first_sync');

    const ops = rows('booking_ops_records').filter((row) => (
      row.property_id === LIVE_CORE_ACCEPTANCE_PROPERTY_ID
      && row.booking_id === LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID
    ));
    expect(ops).toHaveLength(1);
    expect(ops[0].reservation_metadata?.acceptanceHarness).toBe(LIVE_CORE_ACCEPTANCE_HARNESS);
    expect(ops[0].reservation_metadata?.acceptanceExecutionId).toBeTruthy();

    const preview = await previewLiveCoreSyntheticRecovery();
    expect(preview.recoveryRequired).toBe(true);
    expect(preview.mainRecord?.classification).toBe('harness_owned');

    const cleanup = await cleanupLiveCoreSyntheticRecovery({
      dryRun: false,
      confirmPhrase: LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
      expectedBookingOpsRecordId: ops[0].id,
    });
    expect(['passed', 'already_clean']).toContain(cleanup.status);

    // After recovery cleanup of harness-owned row, acceptance can complete.
    // If cleanup already removed the row, contour remains for a fresh run.
    if (cleanup.status === 'passed') {
      expect(rows('booking_ops_records').filter((row) => row.id === ops[0].id)).toHaveLength(0);
    }

    const recovered = await runChannelManagerLiveCoreAcceptance();
    expect(recovered.passed).toBe(true);
    expect(recovered.importedFirstRun).toBe(1);
    expect(recovered.importedSecondRun).toBe(0);
    expect(recovered.duplicateCount).toBe(0);
  });

  it('UI passed marker appears only when evidence.passed is true', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/components/booking-ops/ChannelManagerImportPanel.tsx'), 'utf8');
    expect(panel).toContain('channel-live-core-acceptance-passed');
    expect(panel).toMatch(/acceptanceEvidence\.passed \? \([\s\S]*Acceptance пройден/);
    expect(panel).not.toMatch(/Acceptance пройден[\s\S]*acceptanceEvidence\.passed === false/);
  });

  it('uses booking_inbound_intake_events and never booking_ops_inbound_intake_events', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/booking-ops/channel-manager-live-core-acceptance.ts'), 'utf8');
    expect(source).toContain(".from('booking_inbound_intake_events')");
    expect(source).not.toContain(".from('booking_ops_inbound_intake_events')");
    expect(source).not.toContain('preservedOrdinaryData');
  });
});
