import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingOpsEvent } from '../events';
import { getBookingOpsOperatorGuidance } from '../operator-guidance';
import { computeBookingReadiness } from '../readiness';
import { syncBookingOpsTasksForReadiness } from '../task-sync';
import type { BookingOpsTask } from '../task-types';
import type { BookingOpsRecord, BookingOpsTelegramDraft } from '../types';

const sendMessage = vi.fn();
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: sendMessage,
  sendMessage,
  sendTelegramMessage: sendMessage,
}));

function readyBooking(overrides: Partial<BookingOpsRecord> = {}): BookingOpsRecord {
  return {
    id: 'ops-guidance', bookingId: 'booking-guidance', guestName: 'Анна Смирнова',
    guestPhone: '+79990000002', guestEmail: null, guestTelegram: 'tg_920002',
    propertyId: 'OBJ-2', propertyLabel: 'Студия', otaSource: 'manual',
    checkInAt: '2026-08-01T14:00:00.000Z', checkOutAt: '2026-08-03T11:00:00.000Z',
    opsStatus: 'deposit_confirmed', manualNextAction: null, isBlocked: false, blockerReason: null,
    documentsStatus: 'verified', contractStatus: 'signed', depositStatus: 'confirmed',
    mvdStatus: 'not_required', checkinReadinessStatus: 'in_progress', notes: null,
    guestCount: 2, paymentStatus: 'paid', documentRequired: true, documentCollected: true,
    documentVerificationStatus: 'verified', documentNotes: null, contractRequired: true,
    contractProvider: 'manual', contractIntakeStatus: 'signed',
    contractLink: 'https://example.com/contract', contractNotes: null, depositRequired: true,
    depositAmount: 5000, depositIntakeStatus: 'received', depositPaymentMethod: 'card',
    depositNotes: null, mvdRequired: false, mvdDataStatus: 'not_required',
    mvdConfirmationLink: null, mvdNotes: null, createdAt: '2026-06-28T08:00:00.000Z',
    updatedAt: '2026-06-28T08:00:00.000Z', ...overrides,
  };
}

function drafts(statuses: BookingOpsTelegramDraft['status'][]): BookingOpsTelegramDraft[] {
  return statuses.map((status, index) => ({
    id: `draft-${index}`, bookingOpsRecordId: 'ops-guidance', actionId: 'request_guest_documents',
    sourceBookingId: 'booking-guidance', telegramChatId: '920002', telegramTarget: 'tg_920002',
    messageText: 'Черновик', status, createdBy: null, warning: null, metadata: {},
    createdAt: '2026-06-28T08:00:00.000Z', updatedAt: '2026-06-28T08:00:00.000Z',
  }));
}

function guidance(record: BookingOpsRecord, telegramDrafts: BookingOpsTelegramDraft[] = []) {
  const readiness = computeBookingReadiness({ ...record, telegramDrafts });
  const tasks: BookingOpsTask[] = syncBookingOpsTasksForReadiness(record, readiness).items.map((item, index) => ({
    id: `task-${index}`, bookingOpsRecordId: record.id, bookingId: record.bookingId,
    taskType: item.taskType, title: item.title, description: item.description, status: 'open',
    priority: item.priority, source: 'readiness_gate', dueAt: null, completedAt: null,
    metadata: item.metadata ?? {}, createdAt: record.createdAt, updatedAt: record.updatedAt,
  }));
  return getBookingOpsOperatorGuidance(record, readiness, tasks, [], telegramDrafts);
}

describe('getBookingOpsOperatorGuidance', () => {
  beforeEach(() => sendMessage.mockClear());

  it('guides missing booking data', () => {
    const result = guidance(readyBooking({ guestName: null, propertyId: null, propertyLabel: null }));
    expect(result).toMatchObject({ stage: 'booking_data', recommendedTaskType: 'complete_booking_data' });
    expect(result.title).toContain('Заполните базовые данные брони');
  });

  it('guides missing documents', () => {
    const result = guidance(readyBooking({ documentsStatus: 'requested', documentCollected: false, documentVerificationStatus: 'missing' }));
    expect(result).toMatchObject({ stage: 'documents', recommendedTaskType: 'request_guest_documents' });
  });

  it('guides document verification after upload', () => {
    const result = guidance(readyBooking({ documentsStatus: 'received', documentCollected: true, documentVerificationStatus: 'uploaded' }));
    expect(result).toMatchObject({ stage: 'documents', recommendedTaskType: 'verify_guest_documents' });
    expect(result.title).toContain('Проверьте документы');
  });

  it('guides missing contract', () => {
    expect(guidance(readyBooking({ contractStatus: 'not_started', contractIntakeStatus: 'missing' })))
      .toMatchObject({ stage: 'contract', recommendedTaskType: 'prepare_contract' });
  });

  it('guides missing deposit', () => {
    expect(guidance(readyBooking({ depositStatus: 'not_started', depositIntakeStatus: 'missing' })))
      .toMatchObject({ stage: 'deposit', recommendedTaskType: 'request_deposit' });
  });

  it('guides missing MVD data', () => {
    expect(guidance(readyBooking({ mvdRequired: true, mvdStatus: 'required', mvdDataStatus: 'missing' })))
      .toMatchObject({ stage: 'mvd', recommendedTaskType: 'collect_mvd_data' });
  });

  it('guides draft generation when intake is ready', () => {
    const result = guidance(readyBooking());
    expect(result).toMatchObject({ stage: 'telegram_drafts', recommendedTaskType: 'generate_telegram_drafts' });
    expect(result.title).toContain('Создайте черновики Telegram');
  });

  it('guides manual send when drafts were reviewed', () => {
    const result = guidance(readyBooking(), drafts(['copied', 'copied']));
    expect(result).toMatchObject({ stage: 'telegram_drafts', recommendedTaskType: 'manual_send_telegram_drafts' });
    expect(result.title).toContain('отправьте вручную');
  });

  it('shows post-stay guidance when readiness is completed but deposit return is open', () => {
    const record = readyBooking({ depositIntakeStatus: 'received' });
    const readiness = computeBookingReadiness({ ...record, telegramDrafts: drafts(['sent_manually', 'sent_manually']) });
    const tasks: BookingOpsTask[] = [
      {
        id: 'task-deposit-return', bookingOpsRecordId: record.id, bookingId: record.bookingId,
        taskType: 'track_deposit_return', title: 'Отследить возврат депозита',
        description: 'Депозит получен — отследите возврат после выезда.', status: 'open',
        priority: 'normal', source: 'readiness_gate', dueAt: null, completedAt: null,
        metadata: {}, createdAt: record.createdAt, updatedAt: record.updatedAt,
      },
    ];
    const result = getBookingOpsOperatorGuidance(record, readiness, tasks, [], drafts(['sent_manually', 'sent_manually']));
    expect(result.stage).toBe('post_stay');
    expect(result.title).toContain('Основной контур завершён');
    expect(result.title).not.toContain('Бронь операционно завершена');
    expect(result.recommendedTaskType).toBe('track_deposit_return');
    expect(result.progress.find((item) => item.stage === 'post_stay')?.status).toBe('current');
    expect(result.progress.find((item) => item.stage === 'completed')?.status).toBe('pending');
  });

  it('marks an operationally completed booking when no post-stay tasks remain open', () => {
    const result = guidance(readyBooking({ depositIntakeStatus: 'returned' }), drafts(['sent_manually', 'sent_manually']));
    expect(result).toMatchObject({ stage: 'completed', recommendedTaskType: null, recommendedActionLabel: null });
    expect(result.title).toContain('Бронь операционно завершена');
    expect(result.progress.at(-1)?.status).toBe('current');
  });

  it('uses a blocked latest task action as the blocking reason', () => {
    const record = readyBooking({ contractStatus: 'not_started', contractIntakeStatus: 'missing' });
    const readiness = computeBookingReadiness(record);
    const event: BookingOpsEvent = {
      id: 'event-1', bookingOpsRecordId: record.id, eventType: 'task_action_run',
      title: 'Действие требует внимания', description: 'Устраните условие готовности.',
      actorType: 'task_runner', metadata: { actionType: 'prepare_contract', actionOutcome: 'blocked' },
      createdAt: '2026-06-29T08:00:00.000Z',
    };
    expect(getBookingOpsOperatorGuidance(record, readiness, [], [event], []).blockingReason)
      .toBe('Устраните условие готовности.');
  });

  it('does not call Telegram send helpers', () => {
    guidance(readyBooking(), drafts(['copied']));
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
