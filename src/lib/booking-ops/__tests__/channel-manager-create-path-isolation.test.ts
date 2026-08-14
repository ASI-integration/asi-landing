/**
 * Real shared-intake Channel Manager create-path isolation.
 * Exercises processInboundBookingRequest + createBookingFromImportedChannelBooking
 * without mocking intake semantics.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

type Row = Record<string, any>;

const {
  createBookingOpsRecord,
  getBookingOpsRecord,
  updateBookingOpsRecord,
  syncBookingOpsTasksForRecordId,
  initializeCheckinExecutionBaseline,
  initializeInStayCheckoutBaseline,
  recomputeBookingCheckinReadiness,
  getLifecycleStatus,
  canAutoSendCommunicationIntent,
  recordAndProcessBookingEvent,
  createAvailabilityHold,
  checkAvailabilityConflict,
  initializeBookingOpsCoreLoop,
} = vi.hoisted(() => ({
  createBookingOpsRecord: vi.fn(),
  getBookingOpsRecord: vi.fn(),
  updateBookingOpsRecord: vi.fn(),
  syncBookingOpsTasksForRecordId: vi.fn(),
  initializeCheckinExecutionBaseline: vi.fn(),
  initializeInStayCheckoutBaseline: vi.fn(),
  recomputeBookingCheckinReadiness: vi.fn(),
  getLifecycleStatus: vi.fn(),
  canAutoSendCommunicationIntent: vi.fn(),
  recordAndProcessBookingEvent: vi.fn(),
  createAvailabilityHold: vi.fn(),
  checkAvailabilityConflict: vi.fn(),
  initializeBookingOpsCoreLoop: vi.fn(),
}));

const tables: Record<string, Row[]> = {};
const callOrder: string[] = [];

function rows(table: string): Row[] {
  return tables[table] ?? (tables[table] = []);
}

class Query {
  private filtered: Row[];
  constructor(private table: string, private options: { patch?: Row; count?: boolean; head?: boolean } = {}) {
    this.filtered = [...rows(table)];
  }
  eq(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => row[column] !== value);
    return this;
  }
  or(expression?: string) {
    if (!expression) return this;
    const clauses = expression.split(',').map((part) => part.trim()).filter(Boolean);
    this.filtered = this.filtered.filter((row) => clauses.some((clause) => {
      const [column, , ...rest] = clause.split('.');
      const expected = rest.join('.');
      return String(row[column] ?? '') === expected;
    }));
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filtered = this.filtered.filter((row) => values.includes(row[column]));
    return this;
  }
  order() { return this; }
  limit(value: number) { this.filtered = this.filtered.slice(0, value); return this; }
  select(_columns = '*', options?: { count?: string; head?: boolean }) {
    if (options) this.options = { ...this.options, count: Boolean(options.count), head: options.head };
    return this;
  }
  private execute() {
    if (this.options.patch) for (const row of this.filtered) Object.assign(row, this.options.patch);
    return {
      data: this.options.head ? null : this.filtered,
      error: null,
      count: this.options.count ? this.filtered.length : null,
    };
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

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn((_columns = '*', options?: { count?: string; head?: boolean }) =>
        new Query(table, { count: Boolean(options?.count), head: options?.head })),
      insert: vi.fn((input: Row | Row[]) => {
        const inserted = (Array.isArray(input) ? input : [input]).map((row) => ({ ...row }));
        rows(table).push(...inserted);
        return new Query(table).eq('id', inserted[0]?.id).select();
      }),
      update: vi.fn((patch: Row) => new Query(table, { patch })),
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
    })),
    rpc: vi.fn(async () => ({ data: null, error: { message: 'unexpected rpc' } })),
  },
}));

vi.mock('../repository', () => ({
  createBookingOpsRecord,
  getBookingOpsRecord,
  updateBookingOpsRecord,
  syncBookingOpsTasksForRecordId,
}));

vi.mock('../core-loop-initialization', () => ({ initializeBookingOpsCoreLoop }));
vi.mock('../checkin-execution-autopilot', () => ({ initializeCheckinExecutionBaseline }));
vi.mock('../instay-checkout-autopilot', () => ({ initializeInStayCheckoutBaseline }));
vi.mock('../pre-checkin-control-center', () => ({ recomputeBookingCheckinReadiness }));
vi.mock('../lifecycle', () => ({ getLifecycleStatus }));
vi.mock('../events', () => ({ recordBookingOpsEvent: vi.fn(async () => undefined) }));
vi.mock('../lifecycle-autopilot-service', () => ({
  durableEventId: (...parts: string[]) => `deterministic:${parts.join(':')}`,
  recordAndProcessBookingEvent,
}));
vi.mock('../communication-orchestrator', () => ({
  listBookingOpsCommunicationsForRecord: vi.fn(async () => ({ ok: true, communications: [] })),
}));
vi.mock('../communication-auto-send-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../communication-auto-send-policy')>();
  return { ...actual, canAutoSendCommunicationIntent };
});
vi.mock('../availability-overbooking-protection', () => ({
  createAvailabilityHold,
  checkAvailabilityConflict,
}));

import {
  computeChannelManagerIdempotencyKey,
  processInboundBookingRequest,
} from '../real-booking-intake-autopilot';
import { createBookingFromImportedChannelBooking } from '../channel-manager-access-import';

const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';
const PROPERTY_A = 'prop-a';
const PROPERTY_B = 'prop-b';
const CONNECTION_A = '10000000-0000-4000-8000-0000000000a1';
const CONNECTION_B = '10000000-0000-4000-8000-0000000000b1';
const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const PROPERTY_SETUP_A = '20000000-0000-4000-8000-0000000000a2';
const PROPERTY_SETUP_B = '20000000-0000-4000-8000-0000000000b2';
const IMPORTED_A = '40000000-0000-4000-8000-0000000000a4';
const IMPORTED_B = '40000000-0000-4000-8000-0000000000b4';
const FOREIGN_BOOKING_ID = '30000000-0000-4000-8000-0000000000f3';
const EXTERNAL_ID = 'ext-shared-42';

function mapRecord(row: Row) {
  return {
    id: row.id,
    bookingId: row.booking_id ?? null,
    accountId: row.account_id ?? null,
    guestName: row.guest_name ?? null,
    guestPhone: row.guest_phone ?? null,
    guestEmail: row.guest_email ?? null,
    guestTelegram: row.guest_telegram ?? null,
    propertyId: row.property_id ?? null,
    propertyLabel: row.property_label ?? null,
    checkInAt: row.check_in_at ?? null,
    checkOutAt: row.check_out_at ?? null,
    guestCount: row.guest_count ?? null,
    guestIntake: null,
    opsStatus: 'created',
    otaSource: row.ota_source ?? null,
  };
}

function seedConnection(id: string, accountId: string, propertySetupId: string, provider = 'manual') {
  rows('booking_channel_manager_connections').push({
    id,
    owner_setup_id: OWNER_ID,
    property_setup_id: propertySetupId,
    owner_id: OWNER_ID,
    provider,
    status: 'connected_placeholder',
    access_status: 'received',
    metadata: { accountId },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

function seedImported(id: string, connectionId: string, provider = 'manual') {
  rows('booking_channel_imported_bookings').push({
    id,
    connection_id: connectionId,
    provider,
    external_booking_id: EXTERNAL_ID,
    external_object_id: 'ext-obj-1',
    guest_safe_name: 'Гость',
    guest_count: 2,
    checkin_date: '2026-08-10',
    checkout_date: '2026-08-12',
    match_status: 'unmatched',
    matched_booking_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  rows('booking_channel_imported_objects').push({
    id: randomUUID(),
    connection_id: connectionId,
    external_object_id: 'ext-obj-1',
    title: 'Квартира',
    matched_property_id: PROPERTY_A,
    matched_property_setup_id: connectionId === CONNECTION_A ? PROPERTY_SETUP_A : PROPERTY_SETUP_B,
    match_status: 'matched',
  });
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  callOrder.length = 0;
  createBookingOpsRecord.mockReset();
  getBookingOpsRecord.mockReset();
  updateBookingOpsRecord.mockReset();
  syncBookingOpsTasksForRecordId.mockReset();
  initializeCheckinExecutionBaseline.mockReset();
  initializeInStayCheckoutBaseline.mockReset();
  recomputeBookingCheckinReadiness.mockReset();
  getLifecycleStatus.mockReset();
  canAutoSendCommunicationIntent.mockReset();
  recordAndProcessBookingEvent.mockReset();
  createAvailabilityHold.mockReset();
  checkAvailabilityConflict.mockReset();
  initializeBookingOpsCoreLoop.mockReset();

  rows('booking_owner_setup_profiles').push({ id: OWNER_ID });
  rows('booking_property_setup_profiles').push(
    { id: PROPERTY_SETUP_A, owner_setup_id: OWNER_ID, property_id: PROPERTY_A },
    { id: PROPERTY_SETUP_B, owner_setup_id: OWNER_ID, property_id: PROPERTY_B },
  );

  canAutoSendCommunicationIntent.mockResolvedValue({ eligible: false, reason: 'global_off' });
  createAvailabilityHold.mockResolvedValue({ status: 'active', conflict_status: 'no_conflict' });
  checkAvailabilityConflict.mockResolvedValue({ status: 'no_conflict' });
  initializeCheckinExecutionBaseline.mockImplementation(async () => {
    callOrder.push('automation:checkin');
  });
  initializeInStayCheckoutBaseline.mockImplementation(async () => {
    callOrder.push('automation:instay');
  });
  recomputeBookingCheckinReadiness.mockResolvedValue(undefined);
  syncBookingOpsTasksForRecordId.mockResolvedValue({ ok: true });
  getLifecycleStatus.mockResolvedValue({ ok: true });
  recordAndProcessBookingEvent.mockResolvedValue(undefined);
  initializeBookingOpsCoreLoop.mockImplementation(async (bookingOpsId: string) => {
    callOrder.push(`core-loop:${bookingOpsId}`);
  });

  createBookingOpsRecord.mockImplementation(async (input: Row) => {
    callOrder.push(`create:${input.accountId ?? 'null'}:${input.propertyId ?? 'null'}`);
    const id = randomUUID();
    const row = {
      id,
      booking_id: input.bookingId ?? null,
      account_id: input.accountId ?? null,
      property_id: input.propertyId ?? null,
      property_label: input.propertyLabel ?? null,
      guest_name: input.guestName ?? null,
      guest_phone: input.guestPhone ?? null,
      guest_email: input.guestEmail ?? null,
      guest_telegram: input.guestTelegram ?? null,
      guest_count: input.guestCount ?? null,
      check_in_at: input.checkInAt ?? null,
      check_out_at: input.checkOutAt ?? null,
      ota_source: input.otaSource ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    rows('booking_ops_records').push(row);
    if (input.accountId) {
      // Contour must exist before automation side effects for CM creates.
      expect(row.account_id).toBe(input.accountId);
      expect(row.property_id).toBe(input.propertyId);
      await initializeBookingOpsCoreLoop(id);
    }
    callOrder.push('holds-ready');
    return { ok: true, record: mapRecord(row) };
  });

  getBookingOpsRecord.mockImplementation(async (id: string) => {
    const row = rows('booking_ops_records').find((item) => item.id === id);
    return row ? mapRecord(row) : null;
  });

  updateBookingOpsRecord.mockImplementation(async (id: string, patch: Row) => {
    const row = rows('booking_ops_records').find((item) => item.id === id);
    if (!row) return { ok: false, error: 'not_found' };
    if (patch.guestPhone) row.guest_phone = patch.guestPhone;
    if (patch.guestEmail) row.guest_email = patch.guestEmail;
    if (patch.guestTelegram) row.guest_telegram = patch.guestTelegram;
    if (patch.checkInAt) row.check_in_at = patch.checkInAt;
    if (patch.checkOutAt) row.check_out_at = patch.checkOutAt;
    if (patch.propertyId) row.property_id = patch.propertyId;
    if (patch.propertyLabel) row.property_label = patch.propertyLabel;
    if (patch.accountId) row.account_id = patch.accountId;
    return { ok: true, record: mapRecord(row) };
  });
});

describe('Channel Manager create-path isolation (real shared intake)', () => {
  it('foreign account booking with same external ID is left unchanged and canonical create is distinct', async () => {
    seedConnection(CONNECTION_A, ACCOUNT_A, PROPERTY_SETUP_A);
    seedImported(IMPORTED_A, CONNECTION_A);
    rows('booking_ops_records').push({
      id: FOREIGN_BOOKING_ID,
      booking_id: EXTERNAL_ID,
      account_id: ACCOUNT_B,
      property_id: PROPERTY_A,
      guest_name: 'Чужой',
      check_in_at: '2026-08-10T00:00:00.000Z',
      check_out_at: '2026-08-12T00:00:00.000Z',
    });
    const foreignBefore = { ...rows('booking_ops_records').find((row) => row.id === FOREIGN_BOOKING_ID)! };

    const created = await createBookingFromImportedChannelBooking(IMPORTED_A, {
      accountId: ACCOUNT_A,
      propertyId: PROPERTY_A,
    });

    expect(created.bookingId).toBeTruthy();
    expect(created.bookingId).not.toBe(FOREIGN_BOOKING_ID);
    expect(created.created).toBe(true);

    const foreignAfter = rows('booking_ops_records').find((row) => row.id === FOREIGN_BOOKING_ID)!;
    expect(foreignAfter).toMatchObject({
      account_id: foreignBefore.account_id,
      property_id: foreignBefore.property_id,
      guest_name: foreignBefore.guest_name,
      booking_id: EXTERNAL_ID,
    });

    const canonical = rows('booking_ops_records').find((row) => row.id === created.bookingId)!;
    expect(canonical).toMatchObject({
      booking_id: EXTERNAL_ID,
      account_id: ACCOUNT_A,
      property_id: PROPERTY_A,
    });
  });

  it('foreign intake event with old global external ID identity is not reused', async () => {
    seedConnection(CONNECTION_A, ACCOUNT_A, PROPERTY_SETUP_A);
    seedImported(IMPORTED_A, CONNECTION_A);
    rows('booking_inbound_intake_events').push({
      id: randomUUID(),
      source: 'channel_manager_placeholder',
      idempotency_key: `ext:channel_manager_placeholder:${EXTERNAL_ID}`,
      status: 'processed',
      booking_id: FOREIGN_BOOKING_ID,
      guest_id: null,
      owner_id: null,
      property_id: PROPERTY_A,
      normalized_payload: {},
      missing_fields: [],
      automation_result: {},
      failure_reason: null,
      duplicate_of_booking_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    rows('booking_ops_records').push({
      id: FOREIGN_BOOKING_ID,
      booking_id: EXTERNAL_ID,
      account_id: ACCOUNT_B,
      property_id: PROPERTY_A,
      guest_name: 'Чужой',
    });

    const created = await createBookingFromImportedChannelBooking(IMPORTED_A, {
      accountId: ACCOUNT_A,
      propertyId: PROPERTY_A,
    });

    expect(created.bookingId).not.toBe(FOREIGN_BOOKING_ID);
    const scopedKey = computeChannelManagerIdempotencyKey(CONNECTION_A, 'manual', EXTERNAL_ID);
    expect(scopedKey).toBe(`channel-manager:${CONNECTION_A}:manual:${EXTERNAL_ID}`);
    expect(rows('booking_inbound_intake_events').some((row) => (
      row.idempotency_key === scopedKey && row.booking_id === created.bookingId
    ))).toBe(true);
    expect(rows('booking_ops_records').find((row) => row.id === FOREIGN_BOOKING_ID)?.account_id).toBe(ACCOUNT_B);
  });

  it('two connections in different accounts with same external ID get distinct local identities', async () => {
    seedConnection(CONNECTION_A, ACCOUNT_A, PROPERTY_SETUP_A);
    seedConnection(CONNECTION_B, ACCOUNT_B, PROPERTY_SETUP_B, 'bnovo');
    seedImported(IMPORTED_A, CONNECTION_A, 'manual');
    // second imported uses property B match
    rows('booking_channel_imported_bookings').push({
      id: IMPORTED_B,
      connection_id: CONNECTION_B,
      provider: 'bnovo',
      external_booking_id: EXTERNAL_ID,
      external_object_id: 'ext-obj-1',
      guest_safe_name: 'Гость B',
      guest_count: 2,
      checkin_date: '2026-08-10',
      checkout_date: '2026-08-12',
      match_status: 'unmatched',
      matched_booking_id: null,
    });
    rows('booking_channel_imported_objects').push({
      id: randomUUID(),
      connection_id: CONNECTION_B,
      external_object_id: 'ext-obj-1',
      title: 'Квартира B',
      matched_property_id: PROPERTY_B,
      matched_property_setup_id: PROPERTY_SETUP_B,
      match_status: 'matched',
    });

    const a = await createBookingFromImportedChannelBooking(IMPORTED_A, {
      accountId: ACCOUNT_A,
      propertyId: PROPERTY_A,
    });
    const b = await createBookingFromImportedChannelBooking(IMPORTED_B, {
      accountId: ACCOUNT_B,
      propertyId: PROPERTY_B,
    });

    expect(a.bookingId).not.toBe(b.bookingId);
    expect(rows('booking_ops_records').filter((row) => row.booking_id === EXTERNAL_ID)).toHaveLength(2);
    expect(rows('booking_inbound_intake_events').map((row) => row.idempotency_key).sort()).toEqual([
      computeChannelManagerIdempotencyKey(CONNECTION_A, 'manual', EXTERNAL_ID),
      computeChannelManagerIdempotencyKey(CONNECTION_B, 'bnovo', EXTERNAL_ID),
    ].sort());
  });

  it('retry on the same connection returns the same local booking without duplicate creates', async () => {
    seedConnection(CONNECTION_A, ACCOUNT_A, PROPERTY_SETUP_A);
    seedImported(IMPORTED_A, CONNECTION_A);

    const first = await createBookingFromImportedChannelBooking(IMPORTED_A, {
      accountId: ACCOUNT_A,
      propertyId: PROPERTY_A,
    });
    createBookingOpsRecord.mockClear();
    const second = await createBookingFromImportedChannelBooking(IMPORTED_A, {
      accountId: ACCOUNT_A,
      propertyId: PROPERTY_A,
    });

    expect(second.duplicate).toBe(true);
    expect(second.bookingId).toBe(first.bookingId);
    expect(createBookingOpsRecord).not.toHaveBeenCalled();
    expect(rows('booking_ops_records').filter((row) => (
      row.booking_id === EXTERNAL_ID && row.account_id === ACCOUNT_A
    ))).toHaveLength(1);
    expect(rows('booking_inbound_intake_events').filter((row) => (
      row.idempotency_key === computeChannelManagerIdempotencyKey(CONNECTION_A, 'manual', EXTERNAL_ID)
    ))).toHaveLength(1);
  });

  it('scoped intake rejects reuse when scoped event points at a foreign booking', async () => {
    const scopedKey = computeChannelManagerIdempotencyKey(CONNECTION_A, 'manual', EXTERNAL_ID);
    rows('booking_inbound_intake_events').push({
      id: randomUUID(),
      source: 'channel_manager_placeholder',
      idempotency_key: scopedKey,
      status: 'processed',
      booking_id: FOREIGN_BOOKING_ID,
      guest_id: null,
      owner_id: null,
      property_id: PROPERTY_A,
      normalized_payload: {},
      missing_fields: [],
      automation_result: {},
      failure_reason: null,
      duplicate_of_booking_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    rows('booking_ops_records').push({
      id: FOREIGN_BOOKING_ID,
      booking_id: EXTERNAL_ID,
      account_id: ACCOUNT_B,
      property_id: PROPERTY_A,
      guest_name: 'Чужой',
    });

    await expect(processInboundBookingRequest({
      guestName: 'Гость',
      checkInAt: '2026-08-10',
      checkOutAt: '2026-08-12',
      guestCount: 2,
      propertyId: PROPERTY_A,
      bookingReference: EXTERNAL_ID,
      externalSourceId: EXTERNAL_ID,
    }, 'channel_manager_placeholder', {
      channelManagerScope: {
        connectionId: CONNECTION_A,
        provider: 'manual',
        accountId: ACCOUNT_A,
        propertyId: PROPERTY_A,
      },
    })).rejects.toMatchObject({ code: 'account_scope_mismatch' });

    expect(rows('booking_ops_records').find((row) => row.id === FOREIGN_BOOKING_ID)?.account_id).toBe(ACCOUNT_B);
    expect(createBookingOpsRecord).not.toHaveBeenCalled();
  });

  it('canonical account_id/property_id exist before automation/holds/tasks/communications init', async () => {
    seedConnection(CONNECTION_A, ACCOUNT_A, PROPERTY_SETUP_A);
    seedImported(IMPORTED_A, CONNECTION_A);

    await createBookingFromImportedChannelBooking(IMPORTED_A, {
      accountId: ACCOUNT_A,
      propertyId: PROPERTY_A,
    });

    expect(callOrder[0]).toBe(`create:${ACCOUNT_A}:${PROPERTY_A}`);
    expect(callOrder[1]).toMatch(/^core-loop:/);
    const createIdx = callOrder.findIndex((item) => item.startsWith('create:'));
    const automationIdx = callOrder.findIndex((item) => item.startsWith('automation:'));
    expect(createIdx).toBeGreaterThanOrEqual(0);
    if (automationIdx >= 0) {
      expect(createIdx).toBeLessThan(automationIdx);
    }
    expect(createBookingOpsRecord).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_A, propertyId: PROPERTY_A, bookingId: EXTERNAL_ID }),
      expect.anything(),
    );
  });

  it('public non-CM intake uses an isolated key and cannot attach a property', async () => {
    const result = await processInboundBookingRequest({
      guestName: 'Иван',
      guestPhone: '+79991112233',
      checkInAt: '2026-08-10',
      checkOutAt: '2026-08-12',
      guestCount: 2,
      propertyLabel: 'Описание объекта',
    }, 'web');

    expect(result.intakeStatus).toBe('needs_review');
    expect(rows('booking_inbound_intake_events')[0]?.idempotency_key).toMatch(/^public-web:/);
    expect(createBookingOpsRecord).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: null, propertyId: null, propertyLabel: 'Описание объекта' }),
      expect.anything(),
    );
    expect(createBookingOpsRecord).toHaveBeenCalledWith(
      expect.not.objectContaining({ accountId: expect.anything() }),
      expect.anything(),
    );
  });
});
