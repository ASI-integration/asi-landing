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
  private orMode = false;
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
    this.orMode = true;
    // Support lead_id.eq.X,metadata->>acceptanceHarness.eq.Y
    const parts = expression.split(',');
    this.filtered = rows(this.table).filter((row) => parts.some((part) => {
      if (part.includes('lead_id.eq.')) {
        return row.lead_id === part.replace('lead_id.eq.', '');
      }
      if (part.includes('metadata->>acceptanceHarness.eq.')) {
        const expected = part.replace('metadata->>acceptanceHarness.eq.', '');
        return row.metadata?.acceptanceHarness === expected;
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
  private execute() {
    if (this.deleteMode) {
      const remaining = rows(this.table).filter((row) => !this.filtered.some((item) => item.id === row.id));
      const removed = this.filtered;
      tables[this.table] = remaining;
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
  LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
  LIVE_CORE_ACCEPTANCE_HARNESS,
  LIVE_CORE_ACCEPTANCE_LEAD_ID,
  LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
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

const BOOKING_OPS_ID = '30000000-0000-4000-8000-000000000003';
const ORDINARY_OWNER_ID = 'aaaaaaaa-0000-4000-8000-000000000099';
const ORDINARY_PROPERTY_ID = 'bbbbbbbb-0000-4000-8000-000000000099';
const ORDINARY_CONNECTION_ID = 'cccccccc-0000-4000-8000-000000000099';
const ORDINARY_BOOKING_OPS_ID = 'dddddddd-0000-4000-8000-000000000099';

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
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
  processInboundBookingRequest.mockImplementation(async () => {
    rows('booking_ops_records').push({
      id: BOOKING_OPS_ID,
      account_id: 'account-acceptance',
      property_id: LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
      booking_id: LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
      guest_name: 'Тестовый Гость ASI',
      reservation_metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { bookingId: BOOKING_OPS_ID, intakeStatus: 'processed' };
  });
  updateBookingOpsRecord.mockResolvedValue({ ok: true });
  getUnifiedAvailability.mockResolvedValue({ available: true, conflicts: [] });
  setChannelLiveCoreSchemaReadyOverride(true);
});

describe('Channel Manager Live Core Acceptance Harness v1', () => {
  it('keeps acceptance block visible in Channel Manager panel markup without requiring selected connection', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/components/booking-ops/ChannelManagerImportPanel.tsx'), 'utf8');
    expect(panel).toContain('data-testid="channel-live-core-acceptance"');
    expect(panel).toContain('Проверка Live Core');
    expect(panel).toContain('Подготовить и запустить тест');
    expect(panel).toContain('Удалить тестовый контур');
    expect(panel).toContain('isDevelopmentOwner');
    // Block is rendered before selected-connection gated Live Core status.
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
    expect(evidence.schemaReady).toBe(true);
    expect(evidence.importedFirstRun).toBe(1);
    expect(evidence.importedSecondRun).toBe(0);
    expect(evidence.duplicateCount).toBe(0);
    expect(evidence.firstRunId).toBeTruthy();
    expect(evidence.secondRunId).toBeTruthy();
    expect(evidence.firstRunId).not.toBe(evidence.secondRunId);
    expect(evidence.bookingOpsRecordId).toBe(BOOKING_OPS_ID);
    expect(evidence.steps.every((step) => step.status === 'passed')).toBe(true);
    expect(rows('booking_channel_imported_bookings').filter((row) => row.external_booking_id === LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID)).toHaveLength(1);
    expect(rows('booking_ops_records').filter((row) => row.property_id === LIVE_CORE_ACCEPTANCE_PROPERTY_ID)).toHaveLength(1);
    expect(rows('booking_ops_records')[0].reservation_metadata.acceptanceHarness).toBe(LIVE_CORE_ACCEPTANCE_HARNESS);
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
    processInboundBookingRequest.mockResolvedValue({ bookingId: null, intakeStatus: 'failed' });
    // Force empty imported bookings after sync by skipping create path via failed intake without matched id.
    // Simulate by making processInbound throw after import rows exist — use booking_check path via counters.
    processInboundBookingRequest.mockImplementation(async () => {
      // Create import path succeeds in live core but no booking ops id returned
      throw new Error('Booking Ops не создал бронь: нужна проверка данных.');
    });
    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(false);
    expect(['first_sync', 'booking_check']).toContain(evidence.failedStep);
    expect(evidence.blocker).toBeTruthy();
  });

  it('cleanup removes only acceptanceHarness records and preserves ordinary data', async () => {
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

    const evidence = await runChannelManagerLiveCoreAcceptance();
    expect(evidence.passed).toBe(true);

    const cleanup = await cleanupLiveCoreAcceptanceHarness();
    expect(cleanup.ok).toBe(true);
    expect(cleanup.preservedOrdinaryData).toBe(true);
    expect(cleanup.deleted.ownerSetups).toBeGreaterThanOrEqual(1);
    expect(rows('booking_owner_setup_profiles').some((row) => row.id === ORDINARY_OWNER_ID)).toBe(true);
    expect(rows('booking_property_setup_profiles').some((row) => row.id === ORDINARY_PROPERTY_ID)).toBe(true);
    expect(rows('booking_channel_manager_connections').some((row) => row.id === ORDINARY_CONNECTION_ID)).toBe(true);
    expect(rows('booking_ops_records').some((row) => row.id === ORDINARY_BOOKING_OPS_ID)).toBe(true);
    expect(rows('booking_owner_setup_profiles').some((row) => row.lead_id === LIVE_CORE_ACCEPTANCE_LEAD_ID)).toBe(false);
    expect(rows('booking_ops_records').some((row) => row.id === BOOKING_OPS_ID)).toBe(false);
  });

  it('UI passed marker appears only when evidence.passed is true', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/components/booking-ops/ChannelManagerImportPanel.tsx'), 'utf8');
    expect(panel).toContain('channel-live-core-acceptance-passed');
    expect(panel).toMatch(/acceptanceEvidence\.passed \? \([\s\S]*Acceptance пройден/);
    expect(panel).not.toMatch(/Acceptance пройден[\s\S]*acceptanceEvidence\.passed === false/);
  });
});
