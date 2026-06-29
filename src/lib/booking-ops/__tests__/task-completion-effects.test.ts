import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingOpsTask } from '../task-types';
import type { BookingOpsRecord } from '../types';

const sendMessage = vi.fn();
const sendTelegramMessage = vi.fn();

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: sendMessage,
  sendMessage,
  sendTelegramMessage,
}));

function record(overrides: Partial<BookingOpsRecord> = {}): BookingOpsRecord {
  return {
    id: 'ops-1',
    bookingId: 'booking-1',
    guestName: 'Анна',
    guestPhone: '+79990000000',
    guestEmail: null,
    guestTelegram: 'tg_100',
    propertyId: 'property-1',
    propertyLabel: 'Квартира',
    otaSource: 'avito',
    checkInAt: '2026-08-01T14:00:00.000Z',
    checkOutAt: '2026-08-03T11:00:00.000Z',
    opsStatus: 'created',
    manualNextAction: null,
    isBlocked: false,
    blockerReason: null,
    documentsStatus: 'not_started',
    contractStatus: 'not_started',
    depositStatus: 'not_started',
    mvdStatus: 'required',
    checkinReadinessStatus: 'not_started',
    notes: null,
    guestCount: 2,
    paymentStatus: 'paid',
    documentRequired: true,
    documentCollected: false,
    documentVerificationStatus: 'missing',
    documentNotes: null,
    contractRequired: true,
    contractProvider: 'manual',
    contractIntakeStatus: 'missing',
    contractLink: null,
    contractNotes: null,
    depositRequired: true,
    depositAmount: 5000,
    depositIntakeStatus: 'missing',
    depositPaymentMethod: null,
    depositNotes: null,
    mvdRequired: true,
    mvdDataStatus: 'missing',
    mvdConfirmationLink: null,
    mvdNotes: null,
    createdAt: '2026-06-28T08:00:00.000Z',
    updatedAt: '2026-06-28T08:00:00.000Z',
    ...overrides,
  };
}

function task(taskType: BookingOpsTask['taskType']): BookingOpsTask {
  return {
    id: `task-${taskType}`,
    bookingOpsRecordId: 'ops-1',
    bookingId: 'booking-1',
    taskType,
    title: taskType,
    description: null,
    status: 'open',
    priority: 'normal',
    source: 'readiness_gate',
    dueAt: null,
    completedAt: null,
    metadata: {},
    createdAt: '2026-06-28T08:00:00.000Z',
    updatedAt: '2026-06-28T08:00:00.000Z',
  };
}

describe('applyBookingOpsTaskCompletionEffect', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    sendTelegramMessage.mockClear();
  });

  it('suggests uploaded documents after request completion, never verified', async () => {
    const { applyBookingOpsTaskCompletionEffect } = await import('../task-completion-effects');
    const result = applyBookingOpsTaskCompletionEffect(
      record(), task('request_guest_documents'), 'completed',
    );
    expect(result.appliedUpdates).toEqual({});
    expect(result.suggestedUpdates).toMatchObject({
      documentVerificationStatus: 'uploaded',
      documentCollected: true,
    });
    expect(result.suggestedUpdates.documentVerificationStatus).not.toBe('verified');
  });

  it.each([
    ['verify_guest_documents', 'documentVerificationStatus', 'verified'],
    ['prepare_contract', 'contractIntakeStatus', 'prepared'],
    ['send_contract_manual', 'contractIntakeStatus', 'sent'],
    ['request_deposit', 'depositIntakeStatus', 'requested'],
    ['confirm_deposit', 'depositIntakeStatus', 'received'],
    ['collect_mvd_data', 'mvdDataStatus', 'collected'],
    ['prepare_mvd_report', 'mvdDataStatus', 'prepared'],
    ['submit_mvd_report', 'mvdDataStatus', 'submitted'],
    ['review_telegram_drafts', 'telegramDraftStatus', 'ready_for_manual_send'],
    ['manual_send_telegram_drafts', 'telegramDraftStatus', 'completed'],
  ] as const)('%s completion applies %s=%s', async (taskType, field, value) => {
    const { applyBookingOpsTaskCompletionEffect } = await import('../task-completion-effects');
    const result = applyBookingOpsTaskCompletionEffect(record(), task(taskType), 'completed');
    expect(result.ok).toBe(true);
    expect(result.appliedUpdates[field]).toBe(value);
  });

  it('completion orchestration updates intake and re-runs readiness task sync', async () => {
    const { updateBookingOpsTaskWithCompletionEffects } = await import('../task-completion-effects');
    const booking = record();
    const opsTask = task('verify_guest_documents');
    const updateRecord = vi.fn(async () => ({ ok: true, record: booking }));
    const updateTask = vi.fn(async () => ({
      ok: true as const,
      task: { ...opsTask, status: 'completed' as const },
    }));
    const syncTasks = vi.fn(async () => ({ ok: true }));
    const applyTelegramDraftStatus = vi.fn(async () => ({ ok: true }));

    const result = await updateBookingOpsTaskWithCompletionEffects(
      booking.id,
      opsTask.id,
      { status: 'completed' },
      {
        getRecord: vi.fn(async () => booking),
        getTask: vi.fn(async () => ({ ok: true as const, task: opsTask })),
        updateRecord,
        updateTask,
        syncTasks,
        applyTelegramDraftStatus,
      },
    );

    expect(result.ok).toBe(true);
    expect(updateRecord).toHaveBeenCalledWith(booking.id, {
      documentsStatus: 'verified',
      documentVerificationStatus: 'verified',
      documentCollected: true,
    });
    expect(updateTask).toHaveBeenCalledWith(booking.id, opsTask.id, { status: 'completed' });
    expect(syncTasks).toHaveBeenCalledWith(booking.id);
    expect(applyTelegramDraftStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['verify_guest_documents', 'documentsStatus', 'verified'],
    ['prepare_contract', 'contractStatus', 'prepared'],
    ['send_contract_manual', 'contractStatus', 'sent'],
    ['request_deposit', 'depositStatus', 'requested'],
    ['confirm_deposit', 'depositStatus', 'confirmed'],
    ['prepare_mvd_report', 'mvdStatus', 'prepared'],
    ['submit_mvd_report', 'mvdStatus', 'submitted'],
  ] as const)('%s completion keeps legacy %s in sync', async (taskType, field, value) => {
    const { applyBookingOpsTaskCompletionEffect } = await import('../task-completion-effects');
    const result = applyBookingOpsTaskCompletionEffect(record(), task(taskType), 'completed');
    expect(result.appliedUpdates[field]).toBe(value);
  });

  it('Telegram completion updates draft readiness only and never calls sending functions', async () => {
    const { updateBookingOpsTaskWithCompletionEffects } = await import('../task-completion-effects');
    const booking = record();
    const opsTask = task('manual_send_telegram_drafts');
    const applyTelegramDraftStatus = vi.fn(async () => ({ ok: true }));
    const result = await updateBookingOpsTaskWithCompletionEffects(
      booking.id,
      opsTask.id,
      { status: 'completed' },
      {
        getRecord: vi.fn(async () => booking),
        getTask: vi.fn(async () => ({ ok: true as const, task: opsTask })),
        updateRecord: vi.fn(async () => ({ ok: true, record: booking })),
        updateTask: vi.fn(async () => ({
          ok: true as const,
          task: { ...opsTask, status: 'completed' as const },
        })),
        syncTasks: vi.fn(async () => ({ ok: true })),
        applyTelegramDraftStatus,
      },
    );

    expect(result.ok).toBe(true);
    expect(applyTelegramDraftStatus).toHaveBeenCalledWith(booking.id, 'completed');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });
});
