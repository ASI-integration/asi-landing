import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTelegramDraftFromBookingOpsAction } from '../telegram-drafts';
import {
  computeBookingReadiness,
  canCreateTelegramDraftForAction,
} from '../readiness';
import type { BookingOpsRecord } from '../types';

const sendMessage = vi.fn();
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: sendMessage,
  sendTelegramMessage: sendMessage,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: [], error: null })),
      })),
    })),
  },
}));

function readyBooking(overrides: Partial<BookingOpsRecord> = {}): BookingOpsRecord {
  return {
    id: 'ops-ready',
    bookingId: 'reservation-ready',
    guestName: 'Анна Смирнова',
    guestPhone: '+79990000002',
    guestEmail: null,
    guestTelegram: 'tg_920002',
    propertyId: 'OBJ-2',
    propertyLabel: 'Студия у метро',
    otaSource: 'avito',
    checkInAt: '2026-08-01T14:00:00.000Z',
    checkOutAt: '2026-08-03T11:00:00.000Z',
    opsStatus: 'deposit_confirmed',
    manualNextAction: null,
    isBlocked: false,
    blockerReason: null,
    documentsStatus: 'verified',
    contractStatus: 'signed',
    depositStatus: 'confirmed',
    mvdStatus: 'not_required',
    checkinReadinessStatus: 'in_progress',
    notes: null,
    guestCount: 2,
    paymentStatus: 'paid',
    documentRequired: true,
    documentCollected: true,
    documentVerificationStatus: 'verified',
    documentNotes: null,
    contractRequired: true,
    contractProvider: 'manual',
    contractIntakeStatus: 'signed',
    contractLink: 'https://example.com/contract',
    contractNotes: null,
    depositRequired: true,
    depositAmount: 5000,
    depositIntakeStatus: 'received',
    depositPaymentMethod: 'card',
    depositNotes: null,
    mvdRequired: false,
    mvdDataStatus: 'not_required',
    mvdConfirmationLink: null,
    mvdNotes: null,
    createdAt: '2026-06-28T08:00:00.000Z',
    updatedAt: '2026-06-28T08:00:00.000Z',
    ...overrides,
  };
}

describe('computeBookingReadiness', () => {
  it('returns missing_booking_data when core booking fields are absent', () => {
    const result = computeBookingReadiness(readyBooking({ guestCount: null, propertyId: null, propertyLabel: null }));
    expect(result.status).toBe('missing_booking_data');
    expect(result.canCreateDrafts).toBe(false);
    expect(result.missingItems.length).toBeGreaterThan(0);
  });

  it('blocks draft readiness when required documents are not verified', () => {
    const result = computeBookingReadiness(
      readyBooking({
        documentsStatus: 'received',
        documentVerificationStatus: 'uploaded',
      }),
    );
    expect(result.status).toBe('missing_documents');
    expect(result.canCreateDrafts).toBe(false);
    expect(canCreateTelegramDraftForAction(
      readyBooking({ documentsStatus: 'received', documentVerificationStatus: 'uploaded' }),
      'send_contract',
    ).allowed).toBe(false);
  });

  it('blocks draft readiness when contract is required but not signed', () => {
    const record = readyBooking({
      contractRequired: true,
      contractStatus: 'sent',
      contractIntakeStatus: 'sent',
    });
    const result = computeBookingReadiness(record);
    expect(result.status).toBe('missing_contract');
    expect(result.canCreateDrafts).toBe(false);
    expect(canCreateTelegramDraftForAction(record, 'request_deposit').allowed).toBe(false);
  });

  it('blocks draft readiness when deposit is required but not received', () => {
    const record = readyBooking({
      depositRequired: true,
      depositStatus: 'requested',
      depositIntakeStatus: 'requested',
    });
    const result = computeBookingReadiness(record);
    expect(result.status).toBe('missing_deposit');
    expect(result.canCreateDrafts).toBe(false);
    expect(canCreateTelegramDraftForAction(record, 'prepare_checkin_instructions').allowed).toBe(false);
  });

  it('blocks draft readiness when MVD is required but data is incomplete', () => {
    const record = readyBooking({
      mvdRequired: true,
      mvdStatus: 'required',
      mvdDataStatus: 'missing',
    });
    const result = computeBookingReadiness(record);
    expect(result.status).toBe('missing_mvd_data');
    expect(result.canCreateDrafts).toBe(false);
    expect(canCreateTelegramDraftForAction(record, 'prepare_checkin_instructions').allowed).toBe(false);
  });

  it('does not block readiness when optional contours are marked not_required', () => {
    const record = readyBooking({
      contractRequired: false,
      contractProvider: 'none',
      contractIntakeStatus: 'not_required',
      depositRequired: false,
      depositIntakeStatus: 'not_required',
      mvdRequired: false,
      mvdDataStatus: 'not_required',
    });
    const result = computeBookingReadiness(record);
    expect(result.status).toBe('ready_for_drafts');
    expect(result.canCreateDrafts).toBe(true);
  });

  it('marks a fully ready booking as ready_for_drafts', () => {
    const result = computeBookingReadiness(readyBooking());
    expect(result.status).toBe('ready_for_drafts');
    expect(result.canCreateDrafts).toBe(true);
    expect(result.telegramDraftStatus).toBe('ready_for_drafts');
  });
});

describe('Booking Ops Telegram draft readiness gate', () => {
  beforeEach(() => {
    sendMessage.mockClear();
  });

  it('does not call Telegram send helpers when readiness blocks draft creation', async () => {
    const record = readyBooking({
      guestCount: null,
      documentsStatus: 'verified',
      contractStatus: 'prepared',
      contractIntakeStatus: 'prepared',
    });
    const dependencies = {
      getRecord: vi.fn(async () => record),
      resolveTarget: vi.fn(async () => ({ chatId: '920002', target: 'tg_920002', warning: null })),
      insertDraft: vi.fn(),
    };

    const result = await createTelegramDraftFromBookingOpsAction(
      record.id,
      'send_contract',
      undefined,
      dependencies,
    );

    expect(result).toMatchObject({ ok: false, error: 'readiness_blocked' });
    expect(dependencies.insertDraft).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
