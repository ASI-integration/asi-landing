import { describe, expect, it } from 'vitest';
import { computePropertyReadinessGate } from '../readiness-gate';
import type { BookingOpsTask } from '../task-types';
import type { BookingOpsRecord } from '../types';

function record(overrides: Partial<BookingOpsRecord> = {}): BookingOpsRecord {
  return {
    id: 'ops-readiness',
    bookingId: 'booking-readiness',
    guestName: 'Anna',
    guestPhone: '+79990000000',
    guestEmail: null,
    guestTelegram: null,
    propertyId: 'property-1',
    propertyLabel: 'Apartment',
    otaSource: 'avito',
    checkInAt: '2026-08-05T14:00:00.000Z',
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
    createdAt: '2026-07-10T08:00:00.000Z',
    updatedAt: '2026-07-10T08:00:00.000Z',
    ...overrides,
  };
}

function task(taskType: BookingOpsTask['taskType'], status: BookingOpsTask['status'] = 'completed'): BookingOpsTask {
  return {
    id: `task-${taskType}`,
    bookingOpsRecordId: 'ops-readiness',
    bookingId: 'booking-readiness',
    taskType,
    title: taskType,
    description: null,
    status,
    priority: 'normal',
    source: 'system',
    dueAt: null,
    completedAt: status === 'completed' ? '2026-07-10T09:00:00.000Z' : null,
    metadata: {},
    createdAt: '2026-07-10T08:00:00.000Z',
    updatedAt: '2026-07-10T09:00:00.000Z',
  };
}

describe('property readiness gate', () => {
  it('requires cleaning after checkout starts', () => {
    const gate = computePropertyReadinessGate(record(), [task('checkout_confirmed')]);

    expect(gate.status).toBe('cleaning_required');
    expect(gate.missingPrerequisites).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'cleaning_incomplete' }),
    ]));
  });

  it('requires linen after cleaning is complete', () => {
    const gate = computePropertyReadinessGate(record(), [
      task('checkout_confirmed'),
      task('cleaning_done'),
    ]);

    expect(gate.status).toBe('linen_required');
  });

  it('does not become ready when only cleaning is complete', () => {
    const gate = computePropertyReadinessGate(record(), [
      task('checkout_confirmed'),
      task('cleaning_done'),
    ]);

    expect(gate.ready).toBe(false);
    expect(gate.status).not.toBe('ready');
  });

  it('becomes ready after cleaning, linen, and inspection are complete', () => {
    const gate = computePropertyReadinessGate(record(), [
      task('checkout_confirmed'),
      task('cleaning_done'),
      task('laundry_return_needed'),
      task('unit_inspection_needed'),
    ]);

    expect(gate.ready).toBe(true);
    expect(gate.status).toBe('ready');
  });
});

