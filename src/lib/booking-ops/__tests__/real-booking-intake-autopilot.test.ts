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
  recordAndProcessBookingEvent,
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
  recordAndProcessBookingEvent: vi.fn(),
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
vi.mock('../lifecycle-autopilot-service', () => ({
  durableEventId: (...parts: string[]) => `deterministic:${parts.join(':')}`,
  recordAndProcessBookingEvent,
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
    recordAndProcessBookingEvent.mockResolvedValue({ eventId: 'domain-event-1', processed: true, duplicate: false });
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

  it('normal public web request creates a new unscoped inquiry', async () => {
    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');
    const publicRecord = {
      ...bookingRecord,
      bookingId: null,
      accountId: null,
      propertyId: null,
      propertyLabel: 'Студия у метро',
    };
    createBookingOpsRecord.mockResolvedValueOnce({ ok: true, record: publicRecord });
    getBookingOpsRecord.mockResolvedValue(publicRecord);
    const result = await process({
      guestName: 'Иван Петров',
      guestPhone: '+79991112233',
      guestTelegram: '@ivan',
      checkInAt: '2026-08-10',
      checkOutAt: '2026-08-12',
      guestCount: 2,
      propertyLabel: 'Студия у метро',
      rawMessageText: 'Подскажите, свободны ли даты?',
    }, 'web');

    expect(createBookingOpsRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: null,
        propertyId: null,
        propertyLabel: 'Студия у метро',
        otaSource: 'web',
      }),
      expect.any(Object),
    );
    expect(createBookingOpsRecord).toHaveBeenCalledWith(
      expect.not.objectContaining({ accountId: expect.anything(), reservationMetadata: expect.anything() }),
      expect.any(Object),
    );
    expect(result.bookingId).toBe('booking-ops-intake-1');
    expect(result.intakeStatus).toBe('needs_review');
    expect(result.missingRequiredFields).toContain('property');
    expect(initializeCheckinExecutionBaseline).toHaveBeenCalledWith('booking-ops-intake-1');
    expect(initializeInStayCheckoutBaseline).toHaveBeenCalledWith('booking-ops-intake-1');
    expect(recordAndProcessBookingEvent).toHaveBeenCalledTimes(1);
    expect(recordAndProcessBookingEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringContaining('booking.received'),
      bookingId: 'booking-ops-intake-1',
      objectId: null,
      type: 'booking.received',
      actorType: 'system',
      source: 'real_booking_intake',
    }));
  });

  it('duplicate internal request does not create duplicate booking', async () => {
    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');
    const payload = {
      guestName: 'Иван Петров',
      guestPhone: '+79991112233',
      externalSourceId: 'dup-1',
      propertyId: 'OBJ-1',
      checkInAt: '2026-08-10',
      checkOutAt: '2026-08-12',
    };
    await process(payload, 'admin');
    const second = await process(payload, 'admin');
    expect(second.intakeStatus).toBe('duplicate');
    expect(createBookingOpsRecord).toHaveBeenCalledTimes(1);
    expect(recordAndProcessBookingEvent).toHaveBeenCalledTimes(1);
  });

  it('existing booking emits guest.data_submitted only on incomplete-to-complete transition', async () => {
    const incomplete = { ...bookingRecord, guestName: 'Guest', guestPhone: null, guestEmail: null, guestTelegram: null };
    getBookingOpsRecord.mockResolvedValueOnce(incomplete);
    updateBookingOpsRecord.mockResolvedValueOnce({ ok: true, record: { ...incomplete, guestPhone: '+79990000001' } });
    tables.booking_ops_records.push({ id: incomplete.id, guest_name: incomplete.guestName, property_id: 'OBJ-1' });
    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');
    await process({ guestName: 'Guest', guestPhone: '+79990000001', propertyId: 'OBJ-1', externalSourceId: 'sync-complete-1' }, 'admin');
    expect(recordAndProcessBookingEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'guest.data_submitted', source: 'real_booking_intake' }));
    expect(recordAndProcessBookingEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'booking.received' }));
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

  it('rejects every non-descriptive public field at the trust boundary', async () => {
    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');
    const forbiddenFields: Array<[string, unknown]> = [
      ['accountId', 'account-foreign'],
      ['ownerId', 'owner-foreign'],
      ['propertyId', 'property-foreign'],
      ['propertyReference', 'property-foreign'],
      ['bookingId', 'booking-foreign'],
      ['bookingReference', 'booking-foreign'],
      ['externalSourceId', 'external-foreign'],
      ['sourceMessageId', 'message-foreign'],
      ['telegramUserId', '12345'],
      ['telegramChatId', '67890'],
      ['metadata', { acceptanceHarness: 'channel_manager_live_core_v1' }],
      ['hasMaintenanceIssue', true],
      ['action', 'attach_property'],
      ['intakeEventId', 'intake-foreign'],
      ['duplicateOfBookingId', 'booking-foreign'],
      ['attachPropertyId', 'property-foreign'],
      ['schemaVersion', 'partner.communication.v1'],
      ['eventId', 'partner-event-foreign'],
      ['eventType', 'guest.message.received'],
      ['partner', { partnerId: 'partner-foreign', accountId: 'account-foreign' }],
      ['conversation', { conversationId: 'conversation-foreign', messageId: 'message-foreign' }],
      ['partnerCommunicationContext', { accountId: 'account-foreign' }],
    ];

    for (const [field, value] of forbiddenFields) {
      const body = {
        guestName: 'Атакующий',
        rawMessageText: 'Заявка',
        [field]: value,
      };
      expect(validatePublicWebIntakePayload(body)).toBe(
        'Публичная заявка содержит недопустимые служебные поля.',
      );
      await expect(process(body as never, 'web')).rejects.toMatchObject({
        code: 'public_web_authoritative_field_forbidden',
      });
    }

    expect(createBookingOpsRecord).not.toHaveBeenCalled();
    expect(updateBookingOpsRecord).not.toHaveBeenCalled();
    expect(initializeCheckinExecutionBaseline).not.toHaveBeenCalled();
    expect(initializeInStayCheckoutBaseline).not.toHaveBeenCalled();
    expect(syncBookingOpsTasksForRecordId).not.toHaveBeenCalled();
    expect(recordAndProcessBookingEvent).not.toHaveBeenCalled();
    expect(tables.booking_inbound_intake_events).toHaveLength(0);
    expect(tables.booking_ops_communication_intents).toHaveLength(0);
  });

  it('does not match a foreign booking on a public guest-contact collision', async () => {
    const foreignRecord = {
      ...bookingRecord,
      id: 'foreign-booking',
      accountId: 'foreign-account',
      propertyId: 'foreign-property',
    };
    tables.booking_ops_records.push({
      id: foreignRecord.id,
      account_id: foreignRecord.accountId,
      property_id: foreignRecord.propertyId,
      guest_phone: '+79991112233',
      guest_email: 'same@example.test',
      check_in_at: '2026-08-10T00:00:00.000Z',
      check_out_at: '2026-08-12T00:00:00.000Z',
    });
    const publicRecord = {
      ...bookingRecord,
      id: 'new-public-inquiry',
      bookingId: null,
      accountId: null,
      propertyId: null,
      propertyLabel: 'Описание объекта',
    };
    createBookingOpsRecord.mockResolvedValueOnce({ ok: true, record: publicRecord });
    getBookingOpsRecord.mockResolvedValue(publicRecord);

    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');
    const result = await process({
      guestName: 'Новый гость',
      guestPhone: '+79991112233',
      guestEmail: 'same@example.test',
      checkInAt: '2026-08-10',
      checkOutAt: '2026-08-12',
      propertyLabel: 'Описание объекта',
    }, 'web');

    expect(result.bookingId).toBe('new-public-inquiry');
    expect(createBookingOpsRecord).toHaveBeenCalledOnce();
    expect(updateBookingOpsRecord).not.toHaveBeenCalled();
    expect(tables.booking_ops_records.find((row) => row.id === 'foreign-booking')).toMatchObject({
      account_id: 'foreign-account',
      property_id: 'foreign-property',
    });
  });

  it('rejects a foreign booking reference without probing or mutating that booking', async () => {
    tables.booking_ops_records.push({
      id: 'foreign-booking',
      booking_id: 'foreign-reference',
      account_id: 'foreign-account',
      property_id: 'foreign-property',
      guest_phone: '+79990000077',
    });
    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');

    await expect(process({
      guestName: 'Атакующий',
      rawMessageText: 'Заявка',
      bookingReference: 'foreign-reference',
    }, 'web')).rejects.toMatchObject({ code: 'public_web_authoritative_field_forbidden' });

    expect(getBookingOpsRecord).not.toHaveBeenCalled();
    expect(createBookingOpsRecord).not.toHaveBeenCalled();
    expect(updateBookingOpsRecord).not.toHaveBeenCalled();
    expect(tables.booking_ops_records).toEqual([
      expect.objectContaining({
        id: 'foreign-booking',
        account_id: 'foreign-account',
        property_id: 'foreign-property',
      }),
    ]);
  });

  it('preserves authoritative fields for authenticated internal processing', async () => {
    const { processInboundBookingRequest: process } = await import('../real-booking-intake-autopilot');
    getBookingOpsRecord.mockResolvedValueOnce(null);
    await process({
      guestName: 'Операторская заявка',
      guestPhone: '+79990000003',
      propertyId: 'OBJ-1',
      bookingReference: 'operator-ref-1',
      externalSourceId: 'operator-source-1',
    }, 'web', { inputTrust: 'authenticated_internal' });

    expect(createBookingOpsRecord).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'operator-ref-1', propertyId: 'OBJ-1', otaSource: 'web' }),
      expect.any(Object),
    );
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
