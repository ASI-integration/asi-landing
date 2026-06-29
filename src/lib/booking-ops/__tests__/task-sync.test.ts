import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeBookingReadiness } from '../readiness';
import { syncBookingOpsTasksForReadiness } from '../task-sync';
import type { BookingOpsRecord } from '../types';

const sendMessage = vi.fn();
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: sendMessage,
  sendTelegramMessage: sendMessage,
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
    unitReadinessStatus: 'not_ready',
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

function planTypes(record: BookingOpsRecord, telegramDrafts?: Array<{ status: 'draft' | 'copied' | 'sent_manually' }>) {
  const readiness = computeBookingReadiness({ ...record, telegramDrafts });
  return syncBookingOpsTasksForReadiness(record, readiness).items.map((item) => item.taskType);
}

describe('syncBookingOpsTasksForReadiness', () => {
  beforeEach(() => {
    sendMessage.mockClear();
  });

  it('missing documents creates request documents task', () => {
    const record = readyBooking({
      documentsStatus: 'requested',
      documentVerificationStatus: 'missing',
      documentCollected: false,
    });
    expect(computeBookingReadiness(record).status).toBe('missing_documents');
    expect(planTypes(record)).toEqual(['request_guest_documents']);
  });

  it('uploaded documents creates verify documents task', () => {
    const record = readyBooking({
      documentsStatus: 'received',
      documentVerificationStatus: 'uploaded',
      documentCollected: true,
    });
    expect(computeBookingReadiness(record).status).toBe('missing_documents');
    expect(planTypes(record)).toEqual(['verify_guest_documents']);
  });

  it('missing contract creates contract task', () => {
    const record = readyBooking({
      contractRequired: true,
      contractStatus: 'not_started',
      contractIntakeStatus: 'missing',
    });
    expect(computeBookingReadiness(record).status).toBe('missing_contract');
    expect(planTypes(record)).toEqual(['prepare_contract']);
  });

  it('missing deposit creates deposit task', () => {
    const record = readyBooking({
      depositRequired: true,
      depositStatus: 'not_started',
      depositIntakeStatus: 'missing',
    });
    expect(computeBookingReadiness(record).status).toBe('missing_deposit');
    expect(planTypes(record)).toEqual(['request_deposit']);
  });

  it('missing MVD creates MVD task', () => {
    const record = readyBooking({
      mvdRequired: true,
      mvdStatus: 'required',
      mvdDataStatus: 'missing',
    });
    expect(computeBookingReadiness(record).status).toBe('missing_mvd_data');
    expect(planTypes(record)).toEqual(['collect_mvd_data']);
  });

  it('ready_for_drafts creates Telegram draft review task', () => {
    const record = readyBooking();
    expect(computeBookingReadiness(record).status).toBe('ready_for_drafts');
    expect(planTypes(record)).toEqual(['generate_telegram_drafts', 'track_deposit_return']);
  });

  it('ready_for_manual_send creates manual-send task', () => {
    const record = readyBooking();
    const drafts = [{ status: 'copied' as const }, { status: 'copied' as const }];
    const readiness = computeBookingReadiness({ ...record, telegramDrafts: drafts });
    expect(readiness.status).toBe('ready_for_manual_send');
    expect(planTypes(record, drafts)).toEqual([
      'manual_send_telegram_drafts',
      'track_deposit_return',
    ]);
  });

  it('completed booking creates no new tasks', () => {
    const record = readyBooking({ depositIntakeStatus: 'returned' });
    const drafts = [{ status: 'sent_manually' as const }, { status: 'sent_manually' as const }];
    const readiness = computeBookingReadiness({ ...record, telegramDrafts: drafts });
    expect(readiness.status).toBe('completed');
    expect(syncBookingOpsTasksForReadiness(record, readiness).items).toEqual([]);
  });

  it('Telegram auto-send is not called from task sync', () => {
    syncBookingOpsTasksForReadiness(
      readyBooking(),
      computeBookingReadiness(readyBooking()),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
