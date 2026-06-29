import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { planBookingOpsCommunications } from '../communication-orchestrator';
import type { BookingOpsTask } from '../task-types';
import type { BookingOpsCommunicationIntent, BookingOpsRecord } from '../types';

const sendMessage = vi.fn();
vi.mock('@/lib/telegram', () => ({
  replyToTelegram: sendMessage,
  sendTelegramMessage: sendMessage,
}));

function booking(overrides: Partial<BookingOpsRecord> = {}): BookingOpsRecord {
  return {
    id: 'ops-communication-v1',
    bookingId: 'reservation-communication-v1',
    guestName: 'Анна Смирнова',
    guestPhone: '+79990000002',
    guestEmail: null,
    guestTelegram: '@guest',
    propertyId: 'OBJ-2',
    propertyLabel: 'Студия у метро',
    otaSource: 'avito',
    checkInAt: '2026-08-01T14:00:00.000Z',
    checkOutAt: '2026-08-03T11:00:00.000Z',
    opsStatus: 'created',
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
    createdAt: '2026-06-29T08:00:00.000Z',
    updatedAt: '2026-06-29T08:00:00.000Z',
    ...overrides,
  };
}

function task(taskType: BookingOpsTask['taskType'], id = `task-${taskType}`): BookingOpsTask {
  return {
    id,
    bookingOpsRecordId: 'ops-communication-v1',
    bookingId: 'reservation-communication-v1',
    taskType,
    title: taskType,
    description: null,
    status: 'open',
    priority: 'normal',
    source: 'system',
    dueAt: null,
    completedAt: null,
    metadata: {},
    createdAt: '2026-06-29T08:00:00.000Z',
    updatedAt: '2026-06-29T08:00:00.000Z',
  };
}

function existing(
  overrides: Partial<BookingOpsCommunicationIntent> = {},
): BookingOpsCommunicationIntent {
  return {
    id: 'communication-existing',
    bookingOpsRecordId: 'ops-communication-v1',
    bookingId: 'reservation-communication-v1',
    relatedTaskId: 'task-request_guest_documents',
    actorType: 'guest',
    actorLabel: 'Анна Смирнова',
    purpose: 'request_guest_documents',
    channel: 'telegram',
    status: 'draft_ready',
    messageText: 'old',
    messageTemplateKey: 'guest.documents_request.v1',
    metadata: {},
    createdAt: '2026-06-29T08:00:00.000Z',
    updatedAt: '2026-06-29T08:00:00.000Z',
    supersededAt: null,
    ...overrides,
  };
}

describe('Booking Ops Communication Orchestrator v1', () => {
  it('creates a guest document request when documents are missing', () => {
    const plan = planBookingOpsCommunications({
      record: booking({
        documentsStatus: 'requested',
        documentCollected: false,
        documentVerificationStatus: 'missing',
      }),
      tasks: [task('request_guest_documents')],
    });
    expect(plan.desired).toMatchObject([
      { actorType: 'guest', purpose: 'request_guest_documents', channel: 'telegram' },
    ]);
  });

  it('creates a guest deposit request when deposit is missing', () => {
    const plan = planBookingOpsCommunications({
      record: booking({
        depositStatus: 'not_started',
        depositIntakeStatus: 'missing',
      }),
      tasks: [task('request_deposit')],
    });
    expect(plan.desired[0]).toMatchObject({
      actorType: 'guest',
      purpose: 'request_deposit_payment',
    });
  });

  it('creates cleaner communication from cleaning_needed task', () => {
    const plan = planBookingOpsCommunications({
      record: booking(),
      tasks: [task('cleaning_needed')],
    });
    expect(plan.desired).toContainEqual(expect.objectContaining({
      actorType: 'cleaner',
      purpose: 'cleaning_assignment',
    }));
  });

  it('creates laundry communication from linen_pickup_needed task', () => {
    const plan = planBookingOpsCommunications({
      record: booking(),
      tasks: [task('linen_pickup_needed')],
    });
    expect(plan.desired).toContainEqual(expect.objectContaining({
      actorType: 'laundry',
      purpose: 'linen_pickup_request',
    }));
  });

  it('creates master communication from maintenance_needed task', () => {
    const plan = planBookingOpsCommunications({
      record: booking(),
      tasks: [task('maintenance_needed')],
    });
    expect(plan.desired).toContainEqual(expect.objectContaining({
      actorType: 'master',
      purpose: 'maintenance_request',
    }));
  });

  it('creates admin readiness communication from unit_ready_confirmation task', () => {
    const plan = planBookingOpsCommunications({
      record: booking(),
      tasks: [task('unit_ready_confirmation')],
    });
    expect(plan.desired).toContainEqual(expect.objectContaining({
      actorType: 'admin',
      purpose: 'readiness_confirmation_needed',
    }));
  });

  it('rerun reuses active communication instead of duplicating it', () => {
    const record = booking({
      documentsStatus: 'requested',
      documentCollected: false,
      documentVerificationStatus: 'missing',
    });
    const tasks = [task('request_guest_documents')];
    const first = planBookingOpsCommunications({ record, tasks });
    const second = planBookingOpsCommunications({
      record,
      tasks,
      existingCommunications: [existing({
        messageText: first.desired[0].messageText,
      })],
    });
    expect(second.toCreate).toHaveLength(0);
    expect(second.toSupersede).toHaveLength(0);
  });

  it('respects completed communication and does not recreate it', () => {
    const plan = planBookingOpsCommunications({
      record: booking({
        documentsStatus: 'requested',
        documentCollected: false,
        documentVerificationStatus: 'missing',
      }),
      tasks: [task('request_guest_documents')],
      existingCommunications: [existing({ status: 'completed' })],
    });
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
  });

  it('supersedes obsolete communication when state changes', () => {
    const plan = planBookingOpsCommunications({
      record: booking(),
      tasks: [],
      existingCommunications: [existing()],
    });
    expect(plan.toSupersede).toHaveLength(1);
    expect(plan.toSupersede[0].purpose).toBe('request_guest_documents');
  });

  it('sets next action from the highest-priority waiting item', () => {
    const plan = planBookingOpsCommunications({
      record: booking({
        documentsStatus: 'requested',
        documentCollected: false,
        documentVerificationStatus: 'missing',
        depositStatus: 'not_started',
        depositIntakeStatus: 'missing',
      }),
      tasks: [task('request_guest_documents'), task('request_deposit')],
    });
    expect(plan.nextAction).toBe('Отправить запрос документов гостю');
  });

  it('does not import or call external send functions', () => {
    planBookingOpsCommunications({
      record: booking(),
      tasks: [task('cleaning_needed')],
    });
    const source = readFileSync(
      'src/lib/booking-ops/communication-orchestrator.ts',
      'utf8',
    );
    expect(source).not.toContain('sendMessage');
    expect(source).not.toContain('sendTelegramMessage');
    expect(source).not.toContain('api.telegram.org');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
