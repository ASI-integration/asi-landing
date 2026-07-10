import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createBookingOpsRecord,
  getBookingOpsRecord,
  updateBookingOpsRecord,
  initializeCheckinExecutionBaseline,
  initializeInStayCheckoutBaseline,
  recomputeBookingCheckinReadiness,
  syncBookingOpsTasksForRecordId,
  getLifecycleStatus,
  canAutoSendCommunicationIntent,
} = vi.hoisted(() => ({
  createBookingOpsRecord: vi.fn(),
  getBookingOpsRecord: vi.fn(),
  updateBookingOpsRecord: vi.fn(),
  initializeCheckinExecutionBaseline: vi.fn(),
  initializeInStayCheckoutBaseline: vi.fn(),
  recomputeBookingCheckinReadiness: vi.fn(),
  syncBookingOpsTasksForRecordId: vi.fn(),
  getLifecycleStatus: vi.fn(),
  canAutoSendCommunicationIntent: vi.fn(),
}));

import {
  computeInboundIdempotencyKey,
  computeMissingInboundFields,
  normalizeInboundBookingRequest,
  validatePublicWebIntakePayload,
} from '../real-booking-intake-autopilot';

type Row = Record<string, unknown>;

const tables = {
  booking_inbound_intake_events: [] as Row[],
  booking_ops_records: [] as Row[],
  booking_ops_communication_intents: [] as Row[],
  booking_checkin_execution: [] as Row[],
  booking_instay_checkout: [] as Row[],
};

function tableRows(table: keyof typeof tables): Row[] {
  return tables[table];
}

function makeSelect(table: keyof typeof tables) {
  let result = [...tableRows(table)];
  const query = {
    eq(column: string, value: unknown) {
      result = result.filter((row) => row[column] === value);
      return query;
    },
    or() { return query; },
    in(column: string, values: unknown[]) {
      result = result.filter((row) => values.includes(row[column]));
      return query;
    },
    order() { return query; },
    limit(count: number) {
      result = result.slice(0, count);
      return query;
    },
    maybeSingle: vi.fn(async () => ({ data: result[0] ?? null, error: null })),
    then(resolve: (value: unknown) => void) {
      resolve({ data: result, error: null });
    },
  };
  return query;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: keyof typeof tables) => ({
      select: vi.fn(() => makeSelect(table)),
      insert: vi.fn((input: Row | Row[]) => {
        tableRows(table).push(...(Array.isArray(input) ? input : [input]));
        return { then: (resolve: (v: unknown) => void) => resolve({ data: input, error: null }) };
      }),
      update: vi.fn((patch: Row) => ({
        eq: vi.fn((column: string, value: unknown) => {
          const row = tableRows(table).find((item) => item[column] === value);
          if (row) Object.assign(row, patch);
          return { then: (resolve: (v: unknown) => void) => resolve({ data: row, error: null }) };
        }),
      })),
      upsert: vi.fn((input: Row) => {
        const existing = tableRows(table).find((row) => row.idempotency_key === input.idempotency_key);
        if (existing) Object.assign(existing, input);
        else tableRows(table).push(input);
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: tableRows(table).find((row) => row.idempotency_key === input.idempotency_key) ?? input,
              error: null,
            })),
          })),
        };
      }),
    })),
  },
}));

vi.mock('../repository', () => ({
  createBookingOpsRecord,
  getBookingOpsRecord,
  updateBookingOpsRecord,
  syncBookingOpsTasksForRecordId,
}));

vi.mock('../checkin-execution-autopilot', () => ({ initializeCheckinExecutionBaseline }));
vi.mock('../instay-checkout-autopilot', () => ({ initializeInStayCheckoutBaseline }));
vi.mock('../pre-checkin-control-center', () => ({ recomputeBookingCheckinReadiness }));
vi.mock('../lifecycle', () => ({ getLifecycleStatus }));
vi.mock('../events', () => ({
  recordBookingOpsEvent: vi.fn(async () => undefined),
}));
vi.mock('../communication-orchestrator', () => ({
  listBookingOpsCommunicationsForRecord: vi.fn(async () => ({ ok: true, communications: [] })),
}));
vi.mock('../communication-auto-send-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../communication-auto-send-policy')>();
  return {
    ...actual,
    canAutoSendCommunicationIntent,
  };
});

const bookingRecord = {
  id: 'booking-ops-intake-1',
  bookingId: 'ref-1',
  guestName: 'Иван Петров',
  guestPhone: '+79991112233',
  guestEmail: null,
  guestTelegram: '@ivan',
  propertyId: 'OBJ-1',
  propertyLabel: 'Студия',
  checkInAt: '2026-08-10T14:00:00.000Z',
  checkOutAt: '2026-08-12T11:00:00.000Z',
  guestCount: 2,
  guestIntake: { intakeStatus: 'waiting_for_guest' },
};

describe('Real Booking Intake Autopilot v1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.booking_inbound_intake_events = [];
    tables.booking_ops_records = [];
    tables.booking_ops_communication_intents = [];
    tables.booking_checkin_execution = [];
    tables.booking_instay_checkout = [];

    createBookingOpsRecord.mockResolvedValue({ ok: true, record: bookingRecord });
    getBookingOpsRecord.mockResolvedValue(bookingRecord);
    updateBookingOpsRecord.mockResolvedValue({ ok: true, record: bookingRecord });
    initializeCheckinExecutionBaseline.mockResolvedValue({ id: 'checkin-1' });
    initializeInStayCheckoutBaseline.mockResolvedValue({ id: 'instay-1' });
    recomputeBookingCheckinReadiness.mockResolvedValue({ status: 'needs_attention' });
    syncBookingOpsTasksForRecordId.mockResolvedValue({ ok: true });
    getLifecycleStatus.mockResolvedValue({ ok: true, lifecycle: { gates: [] } });
    canAutoSendCommunicationIntent.mockResolvedValue({
      decision: 'allowed',
      allowed: true,
      reason: 'safe',
      rule_key: 'test',
      safe_to_display_summary: 'ok',
      actual_send_enabled: false,
      policy_decision_id: null,
    });
  });

  it('normalizes web and telegram inbound payloads', () => {
    const web = normalizeInboundBookingRequest({
      guestName: 'Анна',
      guestPhone: '+79990000001',
      checkInAt: '2026-08-01',
      checkOutAt: '2026-08-03',
      propertyLabel: 'Квартира',
    }, 'web');
    expect(web.guestName).toBe('Анна');
    expect(web.checkInAt).toContain('2026-08-01');

    const tg = normalizeInboundBookingRequest({
      telegramUserId: '12345',
      rawMessageText: 'Хочу забронировать',
    }, 'telegram');
    expect(tg.guestTelegram).toBe('tg:12345');
  });

  it('computes stable idempotency key for duplicate detection', () => {
    const normalized = normalizeInboundBookingRequest({
      externalSourceId: 'msg-42',
      guestName: 'Анна',
    }, 'telegram');
    const key1 = computeInboundIdempotencyKey(normalized, 'telegram');
    const key2 = computeInboundIdempotencyKey(normalized, 'telegram');
    expect(key1).toBe(key2);
    expect(key1).toContain('ext:telegram:msg-42');
  });

  it('flags missing dates and property without inventing schedule', () => {
    const missing = computeMissingInboundFields(normalizeInboundBookingRequest({
      guestName: 'Анна',
      guestPhone: '+79990000001',
    }, 'web'));
    expect(missing).toContain('dates');
    expect(missing).toContain('property');
  });

  it('valid web request creates booking through processInboundBookingRequest', async () => {
    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');
    const result = await process({
      guestName: 'Иван Петров',
      guestPhone: '+79991112233',
      guestTelegram: '@ivan',
      checkInAt: '2026-08-10',
      checkOutAt: '2026-08-12',
      guestCount: 2,
      propertyId: 'OBJ-1',
      propertyLabel: 'Студия',
      externalSourceId: 'web-req-1',
    }, 'web');

    expect(createBookingOpsRecord).toHaveBeenCalled();
    expect(result.bookingId).toBe('booking-ops-intake-1');
    expect(result.intakeStatus).toBe('processed');
    expect(initializeCheckinExecutionBaseline).toHaveBeenCalledWith('booking-ops-intake-1');
    expect(initializeInStayCheckoutBaseline).toHaveBeenCalledWith('booking-ops-intake-1');
  });

  it('duplicate inbound request does not create duplicate booking', async () => {
    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');
    const payload = {
      guestName: 'Иван Петров',
      guestPhone: '+79991112233',
      externalSourceId: 'dup-1',
      propertyId: 'OBJ-1',
      checkInAt: '2026-08-10',
      checkOutAt: '2026-08-12',
    };
    await process(payload, 'web');
    const second = await process(payload, 'web');
    expect(second.intakeStatus).toBe('duplicate');
    expect(createBookingOpsRecord).toHaveBeenCalledTimes(1);
  });

  it('duplicate partial telegram request does not create duplicate booking', async () => {
    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');
    const payload = {
      guestName: 'Мария',
      guestPhone: '+79990000002',
      checkInAt: '2026-08-10',
      checkOutAt: '2026-08-12',
      sourceMessageId: 'telegram:message:9001:77:original',
    };
    const first = await process(payload, 'telegram');
    const second = await process(payload, 'telegram');

    expect(first.intakeStatus).toBe('needs_review');
    expect(second.intakeStatus).toBe('duplicate');
    expect(createBookingOpsRecord).toHaveBeenCalledTimes(1);
  });

  it('missing property creates needs_review intake status', async () => {
    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');
    const result = await process({
      guestName: 'Мария',
      guestPhone: '+79990000002',
      checkInAt: '2026-08-10',
      checkOutAt: '2026-08-12',
      externalSourceId: 'needs-property-1',
    }, 'admin');
    expect(result.missingRequiredFields).toContain('property');
    expect(result.intakeStatus).toBe('needs_review');
  });

  it('queues safe communication types and keeps risky types review-required', async () => {
    const policy = await vi.importActual<typeof import('../communication-auto-send-policy')>(
      '../communication-auto-send-policy',
    );
    const safe = policy.classifyMessageForAutoSend({
      actorType: 'guest',
      purpose: 'neutral_booking_acknowledgement',
      channel: 'telegram',
      messageText: 'Мы получили вашу заявку.',
    });
    expect(safe).toBeNull();

    const risky = policy.classifyMessageForAutoSend({
      actorType: 'guest',
      purpose: 'request_deposit_payment',
      channel: 'telegram',
      messageText: 'Нужен депозит.',
    });
    expect(risky?.decision).toBe('review_required');
  });

  it('validates public web intake required fields', () => {
    expect(validatePublicWebIntakePayload({})).toContain('имя');
    expect(validatePublicWebIntakePayload({
      guestPhone: '+79990000001',
      rawMessageText: 'Интересует бронь',
    })).toBeNull();
  });

  it('admin-created request uses admin source', async () => {
    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');
    await process({
      guestName: 'Оператор',
      guestPhone: '+79990000003',
      propertyLabel: 'Демо',
      checkInAt: '2026-09-01',
      checkOutAt: '2026-09-03',
      externalSourceId: 'admin-1',
    }, 'admin');
    expect(createBookingOpsRecord).toHaveBeenCalledWith(
      expect.objectContaining({ guestName: 'Оператор', otaSource: 'admin' }),
      expect.any(Object),
    );
  });
});
