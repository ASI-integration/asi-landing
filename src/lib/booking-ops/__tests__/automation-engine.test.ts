import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planBookingOpsPreparation } from '../automation-engine';
import type { BookingOpsTask } from '../task-types';
import type { BookingOpsRecord } from '../types';

const sendMessage = vi.fn();
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: sendMessage,
  sendTelegramMessage: sendMessage,
}));

function booking(overrides: Partial<BookingOpsRecord> = {}): BookingOpsRecord {
  return {
    id: 'ops-automation-v1',
    bookingId: 'reservation-automation-v1',
    guestName: 'Анна Смирнова',
    guestPhone: '+79990000002',
    guestEmail: null,
    guestTelegram: null,
    propertyId: 'OBJ-2',
    propertyLabel: 'Студия у метро',
    otaSource: 'avito',
    checkInAt: '2026-08-03T14:00:00.000Z',
    checkOutAt: '2026-08-01T11:00:00.000Z',
    opsStatus: 'created',
    manualNextAction: null,
    isBlocked: false,
    blockerReason: null,
    documentsStatus: 'not_started',
    contractStatus: 'not_started',
    depositStatus: 'not_started',
    mvdStatus: 'not_required',
    checkinReadinessStatus: 'not_started',
    unitReadinessStatus: 'not_ready',
    notes: null,
    guestCount: 2,
    paymentStatus: null,
    documentRequired: null,
    documentCollected: null,
    documentVerificationStatus: null,
    documentNotes: null,
    contractRequired: null,
    contractProvider: null,
    contractIntakeStatus: null,
    contractLink: null,
    contractNotes: null,
    depositRequired: null,
    depositAmount: null,
    depositIntakeStatus: null,
    depositPaymentMethod: null,
    depositNotes: null,
    mvdRequired: null,
    mvdDataStatus: null,
    mvdConfirmationLink: null,
    mvdNotes: null,
    createdAt: '2026-06-29T08:00:00.000Z',
    updatedAt: '2026-06-29T08:00:00.000Z',
    ...overrides,
  };
}

function task(
  taskType: BookingOpsTask['taskType'],
  status: BookingOpsTask['status'] = 'completed',
): BookingOpsTask {
  return {
    id: `task-${taskType}`,
    bookingOpsRecordId: 'ops-automation-v1',
    bookingId: 'reservation-automation-v1',
    taskType,
    title: taskType,
    description: null,
    status,
    priority: 'normal',
    source: 'system',
    dueAt: null,
    completedAt: status === 'completed' ? '2026-06-29T09:00:00.000Z' : null,
    metadata: { automationEngine: 'v1' },
    createdAt: '2026-06-29T08:00:00.000Z',
    updatedAt: '2026-06-29T09:00:00.000Z',
  };
}

describe('Booking Ops Automation Engine v1', () => {
  beforeEach(() => sendMessage.mockClear());

  it('creates the preparation plan for a booking with check-in and check-out', () => {
    const plan = planBookingOpsPreparation(booking(), []);
    expect(plan.items.map((item) => item.taskType)).toEqual([
      'cleaning_needed',
      'linen_pickup_needed',
      'inspection_needed',
      'supplies_check_needed',
      'unit_ready_confirmation',
    ]);
    expect(plan.unitReadinessStatus).toBe('cleaning_pending');
    expect(plan.nextAction).toBe('Запланировать уборку');
  });

  it('keeps task types unique when automation is recalculated', () => {
    const first = planBookingOpsPreparation(booking(), []);
    const existing = first.items.map((item) => task(item.taskType, 'open'));
    const second = planBookingOpsPreparation(booking(), existing);
    expect(new Set(second.items.map((item) => item.taskType)).size).toBe(second.items.length);
  });

  it('respects completed and cancelled tasks', () => {
    const plan = planBookingOpsPreparation(booking(), [
      task('cleaning_needed'),
      task('linen_pickup_needed', 'cancelled'),
    ]);
    expect(plan.items.map((item) => item.taskType)).not.toContain('cleaning_needed');
    expect(plan.items.map((item) => item.taskType)).not.toContain('linen_pickup_needed');
    expect(plan.unitReadinessStatus).toBe('linen_pending');
  });

  it('moves through cleaning, linen, inspection and confirmation stages', () => {
    const cleaningDone = [task('cleaning_needed')];
    expect(planBookingOpsPreparation(booking(), cleaningDone)).toMatchObject({
      unitReadinessStatus: 'linen_pending',
      nextAction: 'Проверить бельё',
    });

    const linenDone = [...cleaningDone, task('linen_pickup_needed')];
    expect(planBookingOpsPreparation(booking(), linenDone)).toMatchObject({
      unitReadinessStatus: 'inspection_pending',
      nextAction: 'Провести осмотр',
    });

    const inspected = [
      ...linenDone,
      task('inspection_needed'),
      task('supplies_check_needed'),
    ];
    expect(planBookingOpsPreparation(booking(), inspected)).toMatchObject({
      unitReadinessStatus: 'inspection_pending',
      nextAction: 'Подтвердить готовность объекта',
    });
  });

  it('becomes ready only when every required task is complete', () => {
    const tasks = [
      task('cleaning_needed'),
      task('linen_pickup_needed'),
      task('inspection_needed'),
      task('supplies_check_needed'),
      task('unit_ready_confirmation'),
    ];
    expect(planBookingOpsPreparation(booking(), tasks)).toMatchObject({
      unitReadinessStatus: 'ready',
      nextAction: 'Подготовка завершена',
    });
  });

  it('is blocked by the record or an operational task', () => {
    expect(planBookingOpsPreparation(booking({ isBlocked: true }), [])).toMatchObject({
      unitReadinessStatus: 'blocked',
      nextAction: 'Разобрать блокировку',
    });
    expect(planBookingOpsPreparation(booking(), [task('inspection_needed', 'blocked')])).toMatchObject({
      unitReadinessStatus: 'blocked',
      nextAction: 'Разобрать блокировку',
    });
  });

  it('creates a maintenance task only for a repair signal', () => {
    expect(planBookingOpsPreparation(
      booking({ isBlocked: true, blockerReason: 'Протечка, нужен мастер' }),
      [],
    ).requiredTaskTypes).toContain('maintenance_needed');
    expect(planBookingOpsPreparation(
      booking({ isBlocked: true, blockerReason: 'Нужна проверка оператора' }),
      [],
    ).requiredTaskTypes).not.toContain('maintenance_needed');
  });

  it('does not call Telegram or email delivery helpers', () => {
    planBookingOpsPreparation(booking(), []);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
