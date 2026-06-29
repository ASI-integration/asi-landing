import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeBookingReadiness } from '../readiness';
import {
  computeUnitReadinessStatus,
  isTurnoverEligible,
  syncTurnoverTasksForRecord,
  unitReadinessAfterTaskCompletion,
} from '../turnover';
import type { BookingOpsTask } from '../task-types';
import type { BookingOpsRecord } from '../types';

const sendMessage = vi.fn();
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: sendMessage,
  sendTelegramMessage: sendMessage,
}));

function readyBooking(overrides: Partial<BookingOpsRecord> = {}): BookingOpsRecord {
  return {
    id: 'ops-turnover',
    bookingId: 'reservation-turnover',
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
    depositIntakeStatus: 'returned',
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

function completedTask(taskType: BookingOpsTask['taskType']): BookingOpsTask {
  return {
    id: `task-${taskType}`,
    bookingOpsRecordId: 'ops-turnover',
    bookingId: 'reservation-turnover',
    taskType,
    title: taskType,
    description: null,
    status: 'completed',
    priority: 'normal',
    source: 'system',
    dueAt: null,
    completedAt: '2026-06-29T08:00:00.000Z',
    metadata: {},
    createdAt: '2026-06-28T08:00:00.000Z',
    updatedAt: '2026-06-29T08:00:00.000Z',
  };
}

function openTask(taskType: BookingOpsTask['taskType']): BookingOpsTask {
  return { ...completedTask(taskType), status: 'open', completedAt: null };
}

describe('turnover ops', () => {
  beforeEach(() => sendMessage.mockClear());

  it('is eligible when intake completed and checkout date exists', () => {
    const record = readyBooking();
    const readiness = computeBookingReadiness({
      ...record,
      telegramDrafts: [{ status: 'sent_manually' }, { status: 'sent_manually' }],
    });
    expect(readiness.status).toBe('completed');
    expect(isTurnoverEligible(record, readiness)).toBe(true);
  });

  it('is not eligible without checkout date', () => {
    const record = readyBooking({ checkOutAt: null });
    const readiness = computeBookingReadiness({
      ...record,
      telegramDrafts: [{ status: 'sent_manually' }],
    });
    expect(isTurnoverEligible(record, readiness)).toBe(false);
  });

  it('creates checkout_confirmed as first turnover task', () => {
    const record = readyBooking();
    const readiness = computeBookingReadiness({
      ...record,
      telegramDrafts: [{ status: 'sent_manually' }],
    });
    const plan = syncTurnoverTasksForRecord(record, readiness, []);
    expect(plan.items.map((item) => item.taskType)).toEqual(['checkout_confirmed']);
  });

  it('plans parallel cleaning, linen and supplies after checkout confirmed', () => {
    const record = readyBooking();
    const readiness = computeBookingReadiness({
      ...record,
      telegramDrafts: [{ status: 'sent_manually' }],
    });
    const tasks = [completedTask('checkout_confirmed')];
    const types = syncTurnoverTasksForRecord(record, readiness, tasks).items.map((item) => item.taskType);
    expect(types).toContain('cleaning_needed');
    expect(types).toContain('linen_pickup_needed');
    expect(types).toContain('supplies_check_needed');
  });

  it('plans inspection after all tracks complete', () => {
    const record = readyBooking();
    const readiness = computeBookingReadiness({
      ...record,
      telegramDrafts: [{ status: 'sent_manually' }],
    });
    const tasks = [
      completedTask('checkout_confirmed'),
      completedTask('cleaning_done'),
      completedTask('laundry_return_needed'),
      completedTask('supplies_check_needed'),
    ];
    const types = syncTurnoverTasksForRecord(record, readiness, tasks).items.map((item) => item.taskType);
    expect(types).toEqual(['unit_inspection_needed']);
  });

  it('derives unit readiness from open turnover tasks', () => {
    const record = readyBooking();
    expect(computeUnitReadinessStatus(record, [openTask('cleaning_needed')])).toBe('cleaning_pending');
    expect(computeUnitReadinessStatus(record, [openTask('linen_pickup_needed')])).toBe('linen_pending');
    expect(computeUnitReadinessStatus(record, [openTask('unit_inspection_needed')])).toBe('inspection_pending');
    expect(computeUnitReadinessStatus(record, [completedTask('unit_ready_for_next_guest')])).toBe('ready');
  });

  it('advances unit readiness on task completion', () => {
    expect(unitReadinessAfterTaskCompletion('checkout_confirmed', 'not_ready')).toBe('cleaning_pending');
    expect(unitReadinessAfterTaskCompletion('unit_ready_for_next_guest', 'inspection_pending')).toBe('ready');
  });

  it('does not call Telegram send helpers', () => {
    const record = readyBooking();
    const readiness = computeBookingReadiness({
      ...record,
      telegramDrafts: [{ status: 'sent_manually' }],
    });
    syncTurnoverTasksForRecord(record, readiness, []);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
