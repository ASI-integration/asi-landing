/**
 * Pre-booking inquiry flow tests.
 *
 * Covers acceptance criteria from the feat/prebooking-inquiry-slice task:
 *   I1 — unknown guest first contact creates inquiry context
 *   I2 — general question classification path
 *   I3 — booking inquiry detection path
 *   I4 — partial intake across multiple turns
 *   I5 — missing-details follow-up path
 *   I6 — structured booking handoff creation
 *   I7 — no duplicate handoff on harmless retry
 *   I8 — inquiry persistence across service re-instantiation (cold start)
 *   I9 — bridge from inquiry to reservation_linked stay-flow
 *   I10 — timeline/audit continuity across the bridge
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyFirstContact,
  mergeBookingDetails,
  getMissingBookingFields,
  isReadyForHandoff,
  buildNextMissingFieldQuestion,
  InquiryFlowStatus,
} from '../inquiry-flow';
import { IntentCategory } from '../types';

// ─── Supabase + dependency mocks ──────────────────────────────────────────────

const dbRows: Record<string, unknown> = {};
const upsertedRows: Record<string, unknown[]> = {};

function makeSupabaseMock() {
  return {
    from: (table: string) => ({
      select: (_cols?: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => {
            if (table === 'tg_inquiry_flows') {
              return { data: dbRows[`${table}:${_val}`] ?? null, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      upsert: async (row: unknown) => {
        (upsertedRows[table] ??= []).push(row);
        // Simulate persisting so subsequent getInquiryFlowByChatId returns it
        const r = row as Record<string, unknown>;
        if (table === 'tg_inquiry_flows' && r.chat_id != null) {
          const existing = (dbRows[`${table}:${r.chat_id}`] ?? {}) as Record<string, unknown>;
          dbRows[`${table}:${r.chat_id}`] = {
            id:                   existing.id ?? 'test-uuid',
            chat_id:              r.chat_id,
            guest_id:             r.guest_id              ?? existing.guest_id,
            telegram_user_id:     r.telegram_user_id      ?? existing.telegram_user_id,
            inquiry_status:       r.inquiry_status        ?? existing.inquiry_status ?? 'new_contact',
            booking_details:      r.booking_details       ?? existing.booking_details ?? {},
            intake_turn_count:    r.intake_turn_count     ?? existing.intake_turn_count ?? 0,
            handoff_type:         r.handoff_type          ?? existing.handoff_type,
            handoff_at:           r.handoff_at            ?? existing.handoff_at,
            handoff_summary:      r.handoff_summary       ?? existing.handoff_summary,
            linked_reservation_id: r.linked_reservation_id ?? existing.linked_reservation_id,
            converted_at:         r.converted_at          ?? existing.converted_at,
            last_inbound_at:      r.last_inbound_at       ?? existing.last_inbound_at ?? new Date().toISOString(),
            last_outbound_at:     r.last_outbound_at      ?? existing.last_outbound_at,
            created_at:           existing.created_at     ?? new Date().toISOString(),
            updated_at:           r.updated_at            ?? new Date().toISOString(),
          };
        }
        return { error: null };
      },
    }),
  };
}

vi.mock('@/lib/supabase', () => ({ supabase: makeSupabaseMock() }));

const mockSendTelegram = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/telegram', () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegram(...args),
  replyToTelegram:     (...args: unknown[]) => mockSendTelegram(...args),
}));

const mockAppendTimeline = vi.fn().mockResolvedValue(undefined);
vi.mock('../timeline', () => ({
  appendTimelineEvent: (...args: unknown[]) => mockAppendTimeline(...args),
}));

// Import under test (after mocks)
import {
  getInquiryFlowByChatId,
  upsertInquiryFlow,
  manageInquiryFlow,
  bridgeInquiryToReservation,
  createBookingHandoff,
} from '../inquiry-flow';
import { IntentResult } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BOOKING_INTENT: IntentResult = { intent: IntentCategory.BookingInquiry, confidence: 0.9 };
const GENERAL_INTENT: IntentResult = { intent: IntentCategory.GeneralQuestion, confidence: 0.9 };
const ISSUE_INTENT:   IntentResult = { intent: IntentCategory.IssueReport,     confidence: 0.9 };

function resetState() {
  for (const key of Object.keys(dbRows))    delete dbRows[key];
  for (const key of Object.keys(upsertedRows)) delete upsertedRows[key];
  mockSendTelegram.mockClear();
  mockAppendTimeline.mockClear();
}

// ─── I1: First contact creates inquiry context ────────────────────────────────

describe('I1 — first contact creates inquiry context', () => {
  beforeEach(resetState);

  it('manageInquiryFlow creates a new inquiry row on first contact', async () => {
    await manageInquiryFlow({
      chatId: 1001,
      guestId: 'guest_1001',
      text: 'Hello, I want to book',
      lang: 'en',
      intentResult: BOOKING_INTENT,
      messageCategory: 'booking',
    });

    const flow = await getInquiryFlowByChatId(1001);
    expect(flow).not.toBeNull();
    expect(flow!.chatId).toBe(1001);
    expect(flow!.guestId).toBe('guest_1001');
  });

  it('inquiry status is collecting_booking_details for booking inquiry', async () => {
    await manageInquiryFlow({
      chatId: 1002,
      guestId: 'guest_1002',
      text: 'I want to book an apartment',
      lang: 'en',
      intentResult: BOOKING_INTENT,
      messageCategory: 'booking',
    });

    const flow = await getInquiryFlowByChatId(1002);
    // After first turn with booking intent: collecting or awaiting_missing_details
    expect([
      InquiryFlowStatus.CollectingDetails,
      InquiryFlowStatus.AwaitingMissingDetails,
    ]).toContain(flow!.inquiryStatus);
  });
});

// ─── I2: General question path ────────────────────────────────────────────────

describe('I2 — general question path', () => {
  beforeEach(resetState);

  it('classifyFirstContact → general_question for fallback intent + fallback category', () => {
    const result = classifyFirstContact(GENERAL_INTENT, 'fallback');
    expect(result).toBe('general_question');
  });

  it('classifyFirstContact → general_question for greeting', () => {
    const result = classifyFirstContact(GENERAL_INTENT, 'greeting');
    expect(result).toBe('general_question');
  });

  it('manageInquiryFlow sets general_question status for non-booking first contact', async () => {
    await manageInquiryFlow({
      chatId: 2001,
      guestId: 'guest_2001',
      text: 'Hi, what is your cancellation policy?',
      lang: 'en',
      intentResult: GENERAL_INTENT,
      messageCategory: 'fallback',
    });

    const flow = await getInquiryFlowByChatId(2001);
    expect(flow!.inquiryStatus).toBe(InquiryFlowStatus.GeneralQuestion);
  });
});

// ─── I3: Booking inquiry detection ───────────────────────────────────────────

describe('I3 — booking inquiry detection', () => {
  beforeEach(resetState);

  it('classifyFirstContact → booking_inquiry for explicit booking intent', () => {
    expect(classifyFirstContact(BOOKING_INTENT, 'fallback')).toBe('booking_inquiry');
  });

  it('classifyFirstContact → booking_inquiry for booking category even with unknown intent', () => {
    const unknownIntent: IntentResult = { intent: IntentCategory.Unknown, confidence: 0.1 };
    expect(classifyFirstContact(unknownIntent, 'booking')).toBe('booking_inquiry');
  });

  it('classifyFirstContact → support_issue for issue intent', () => {
    expect(classifyFirstContact(ISSUE_INTENT, 'issue')).toBe('support_issue');
  });
});

// ─── I4: Partial intake across multiple turns ─────────────────────────────────

describe('I4 — partial intake across multiple turns', () => {
  beforeEach(resetState);

  it('mergeBookingDetails accumulates fields across turns', () => {
    let details = mergeBookingDetails('I want to book in Moscow', {});
    expect(details.property_ref).toContain('Moscow');

    // Second turn adds guest count
    details = mergeBookingDetails('We will be 2 people', details);
    expect(details.guest_count).toBe(2);
  });

  it('mergeBookingDetails does not overwrite already-known fields', () => {
    const existing = { desired_dates: 'July 5-10', guest_count: 2 };
    const updated  = mergeBookingDetails('We are 4 people coming July 1-3', existing);
    // Existing fields preserved
    expect(updated.desired_dates).toBe('July 5-10');
    expect(updated.guest_count).toBe(2);
  });

  it('mergeBookingDetails extracts guest count from Russian text', () => {
    const details = mergeBookingDetails('нас будет 3 человека', {});
    expect(details.guest_count).toBe(3);
  });

  it('mergeBookingDetails extracts Russian date range', () => {
    const details = mergeBookingDetails('хочу забронировать с 05.07 по 10.07', {});
    expect(details.desired_dates).toBeDefined();
    expect(details.desired_dates).toContain('05.07');
  });

  it('mergeBookingDetails stores freeform note on first message', () => {
    const details = mergeBookingDetails('Hello, I am interested in booking', {});
    expect(details.freeform_note).toContain('interested in booking');
  });

  it('mergeBookingDetails does not overwrite existing freeform note', () => {
    const existing = { freeform_note: 'original message' };
    const updated  = mergeBookingDetails('follow-up message', existing);
    expect(updated.freeform_note).toBe('original message');
  });
});

// ─── I5: Missing-details follow-up ────────────────────────────────────────────

describe('I5 — missing-details follow-up', () => {
  beforeEach(resetState);

  it('getMissingBookingFields returns all 3 when nothing is known', () => {
    const missing = getMissingBookingFields({});
    expect(missing).toHaveLength(3);
    expect(missing).toContain('desired_dates');
    expect(missing).toContain('guest_count');
    expect(missing).toContain('property_ref');
  });

  it('getMissingBookingFields returns 0 when all known', () => {
    const details = { desired_dates: 'July 5', guest_count: 2, property_ref: 'Moscow' };
    expect(getMissingBookingFields(details)).toHaveLength(0);
  });

  it('buildNextMissingFieldQuestion returns desired_dates question first', () => {
    const q = buildNextMissingFieldQuestion(['desired_dates', 'guest_count'], 'en');
    expect(q).toContain('dates');
  });

  it('buildNextMissingFieldQuestion returns Russian question when lang=ru', () => {
    const q = buildNextMissingFieldQuestion(['guest_count'], 'ru');
    expect(q).not.toBeNull();
    // Should be Russian
    expect(q).toMatch(/[а-яёА-ЯЁ]/);
  });

  it('buildNextMissingFieldQuestion returns null when no fields missing', () => {
    expect(buildNextMissingFieldQuestion([], 'en')).toBeNull();
  });
});

// ─── I6: Booking handoff creation ────────────────────────────────────────────

describe('I6 — structured booking handoff creation', () => {
  beforeEach(resetState);

  it('isReadyForHandoff returns true when 2 of 3 fields present', () => {
    const details = { desired_dates: 'July 5-10', guest_count: 2 };
    expect(isReadyForHandoff(details, 1)).toBe(true);
  });

  it('isReadyForHandoff returns false when only 1 of 3 fields present with <3 turns', () => {
    const details = { desired_dates: 'July 5-10' };
    expect(isReadyForHandoff(details, 1)).toBe(false);
  });

  it('isReadyForHandoff returns true after 3 intake turns regardless of fields', () => {
    expect(isReadyForHandoff({}, 3)).toBe(true);
  });

  it('createBookingHandoff sends operator notification', async () => {
    const flow = await upsertInquiryFlow({
      chatId:         3001,
      guestId:        'guest_3001',
      status:         InquiryFlowStatus.ReadyForHandoff,
      bookingDetails: { desired_dates: 'July 5', guest_count: 2 },
      intakeTurnCount: 2,
    });

    await createBookingHandoff(flow!);

    expect(mockSendTelegram).toHaveBeenCalledOnce();
    const message = mockSendTelegram.mock.calls[0][0] as string;
    expect(message).toContain('Booking Inquiry');
    expect(message).toContain('booking_inquiry');
    expect(message).toContain('3001');
  });

  it('createBookingHandoff sets handoff_type to booking_inquiry', async () => {
    const initial = await upsertInquiryFlow({
      chatId:         3002,
      guestId:        'guest_3002',
      status:         InquiryFlowStatus.ReadyForHandoff,
      bookingDetails: { desired_dates: 'Aug 1', guest_count: 3, property_ref: 'SPb' },
      intakeTurnCount: 2,
    });

    await createBookingHandoff(initial!);
    const after = await getInquiryFlowByChatId(3002);
    expect(after!.handoffType).toBe('booking_inquiry');
    expect(after!.handoffAt).toBeDefined();
  });

  it('manageInquiryFlow triggers handoff when 3 turns reached', async () => {
    const chatId = 3003;
    // Simulate 2 prior turns already stored
    dbRows[`tg_inquiry_flows:${chatId}`] = {
      id:               'uuid-3003',
      chat_id:          chatId,
      guest_id:         'guest_3003',
      inquiry_status:   InquiryFlowStatus.AwaitingMissingDetails,
      booking_details:  { freeform_note: 'first message' },
      intake_turn_count: 2,  // about to hit threshold on this turn
      handoff_at:        null,
      last_inbound_at:  new Date().toISOString(),
      created_at:       new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    };

    await manageInquiryFlow({
      chatId,
      guestId:         'guest_3003',
      text:            'I want to book something',
      lang:            'en',
      intentResult:    BOOKING_INTENT,
      messageCategory: 'booking',
    });

    // After 3 turns, handoff should have been triggered
    const flow = await getInquiryFlowByChatId(chatId);
    expect([InquiryFlowStatus.HandedOff, InquiryFlowStatus.ReadyForHandoff]).toContain(
      flow!.inquiryStatus,
    );
    expect(mockSendTelegram).toHaveBeenCalled();
  });
});

// ─── I7: No duplicate handoff on retry ───────────────────────────────────────

describe('I7 — no duplicate handoff on harmless retry', () => {
  beforeEach(resetState);

  it('createBookingHandoff is idempotent — second call does not resend', async () => {
    const now = new Date().toISOString();
    dbRows['tg_inquiry_flows:4001'] = {
      id:               'uuid-4001',
      chat_id:          4001,
      guest_id:         'guest_4001',
      inquiry_status:   InquiryFlowStatus.HandedOff,
      booking_details:  { desired_dates: 'July 5', guest_count: 2 },
      intake_turn_count: 2,
      handoff_at:       now,   // already handed off
      handoff_type:     'booking_inquiry',
      handoff_summary:  'existing summary',
      last_inbound_at:  now,
      created_at:       now,
      updated_at:       now,
    };

    const flow = await getInquiryFlowByChatId(4001);
    await createBookingHandoff(flow!);

    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  it('manageInquiryFlow skips already handed-off inquiry on repeated delivery', async () => {
    const now = new Date().toISOString();
    dbRows['tg_inquiry_flows:4002'] = {
      id:               'uuid-4002',
      chat_id:          4002,
      guest_id:         'guest_4002',
      inquiry_status:   InquiryFlowStatus.HandedOff,
      booking_details:  {},
      intake_turn_count: 3,
      handoff_at:       now,
      last_inbound_at:  now,
      created_at:       now,
      updated_at:       now,
    };

    await manageInquiryFlow({
      chatId:          4002,
      guestId:         'guest_4002',
      text:            'just checking',
      lang:            'en',
      intentResult:    GENERAL_INTENT,
      messageCategory: 'fallback',
    });

    // Should not have sent any operator notification
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });
});

// ─── I8: Persistence across cold start ───────────────────────────────────────

describe('I8 — inquiry persistence across cold start', () => {
  beforeEach(resetState);

  it('getInquiryFlowByChatId returns null when no row exists', async () => {
    const flow = await getInquiryFlowByChatId(9999);
    expect(flow).toBeNull();
  });

  it('upsertInquiryFlow and getInquiryFlowByChatId round-trip persisted state', async () => {
    await upsertInquiryFlow({
      chatId:         5001,
      guestId:        'guest_5001',
      status:         InquiryFlowStatus.CollectingDetails,
      bookingDetails: { desired_dates: 'July 5', lang_hint: 'en' },
      intakeTurnCount: 1,
    });

    const flow = await getInquiryFlowByChatId(5001);
    expect(flow).not.toBeNull();
    expect(flow!.inquiryStatus).toBe(InquiryFlowStatus.CollectingDetails);
    expect(flow!.bookingDetails.desired_dates).toBe('July 5');
    expect(flow!.intakeTurnCount).toBe(1);
  });

  it('second upsert merges without losing existing data', async () => {
    await upsertInquiryFlow({
      chatId:         5002,
      guestId:        'guest_5002',
      status:         InquiryFlowStatus.CollectingDetails,
      bookingDetails: { desired_dates: 'Aug 1' },
      intakeTurnCount: 1,
    });

    await upsertInquiryFlow({
      chatId:         5002,
      intakeTurnCount: 2,
      status:         InquiryFlowStatus.AwaitingMissingDetails,
    });

    const flow = await getInquiryFlowByChatId(5002);
    expect(flow!.inquiryStatus).toBe(InquiryFlowStatus.AwaitingMissingDetails);
    expect(flow!.intakeTurnCount).toBe(2);
    // guest_id preserved from first upsert
    expect(flow!.guestId).toBe('guest_5002');
  });
});

// ─── I9: Bridge from inquiry to reservation_linked stay-flow ─────────────────

describe('I9 — bridge inquiry to reservation', () => {
  beforeEach(resetState);

  it('bridgeInquiryToReservation sets status to converted_to_reservation', async () => {
    const now = new Date().toISOString();
    dbRows['tg_inquiry_flows:6001'] = {
      id:               'uuid-6001',
      chat_id:          6001,
      guest_id:         'guest_6001',
      inquiry_status:   InquiryFlowStatus.HandedOff,
      booking_details:  {},
      intake_turn_count: 2,
      handoff_at:       now,
      last_inbound_at:  now,
      created_at:       now,
      updated_at:       now,
    };

    await bridgeInquiryToReservation(6001, 'res_ABC', 'guest_6001');

    const flow = await getInquiryFlowByChatId(6001);
    expect(flow!.inquiryStatus).toBe(InquiryFlowStatus.ConvertedToReservation);
    expect(flow!.linkedReservationId).toBe('res_ABC');
    expect(flow!.convertedAt).toBeDefined();
  });

  it('bridgeInquiryToReservation is idempotent when already converted', async () => {
    const now = new Date().toISOString();
    dbRows['tg_inquiry_flows:6002'] = {
      id:               'uuid-6002',
      chat_id:          6002,
      guest_id:         'guest_6002',
      inquiry_status:   InquiryFlowStatus.ConvertedToReservation,
      booking_details:  {},
      intake_turn_count: 2,
      linked_reservation_id: 'res_XYZ',
      converted_at:     now,
      last_inbound_at:  now,
      created_at:       now,
      updated_at:       now,
    };

    await bridgeInquiryToReservation(6002, 'res_NEW', 'guest_6002');

    const flow = await getInquiryFlowByChatId(6002);
    // Should not have overwritten the original reservation
    expect(flow!.linkedReservationId).toBe('res_XYZ');
  });

  it('bridgeInquiryToReservation returns gracefully when no inquiry exists', async () => {
    // No entry in dbRows for this chatId
    await expect(bridgeInquiryToReservation(9998, 'res_XYZ')).resolves.not.toThrow();
  });
});

// ─── I10: Timeline continuity across bridge ───────────────────────────────────

describe('I10 — timeline continuity across inquiry-to-reservation bridge', () => {
  beforeEach(resetState);

  it('createBookingHandoff appends inquiry_handoff timeline event', async () => {
    const flow = await upsertInquiryFlow({
      chatId:         7001,
      guestId:        'guest_7001',
      status:         InquiryFlowStatus.ReadyForHandoff,
      bookingDetails: { desired_dates: 'July 5', guest_count: 2 },
      intakeTurnCount: 2,
    });

    await createBookingHandoff(flow!);

    expect(mockAppendTimeline).toHaveBeenCalledWith(
      'guest_7001',
      expect.objectContaining({ type: 'inquiry_handoff', reason: 'booking_inquiry' }),
      7001,
    );
  });

  it('bridgeInquiryToReservation appends inquiry_converted timeline event', async () => {
    const now = new Date().toISOString();
    dbRows['tg_inquiry_flows:7002'] = {
      id:               'uuid-7002',
      chat_id:          7002,
      guest_id:         'guest_7002',
      inquiry_status:   InquiryFlowStatus.HandedOff,
      booking_details:  {},
      intake_turn_count: 2,
      handoff_at:       now,
      last_inbound_at:  now,
      created_at:       now,
      updated_at:       now,
    };

    await bridgeInquiryToReservation(7002, 'res_DEF', 'guest_7002');

    expect(mockAppendTimeline).toHaveBeenCalledWith(
      'guest_7002',
      expect.objectContaining({ type: 'inquiry_converted' }),
      7002,
    );
  });
});
