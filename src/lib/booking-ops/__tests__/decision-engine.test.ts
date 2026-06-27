import { describe, expect, it } from 'vitest';
import {
  buildBookingOpsAutomationPatch,
  evaluateBookingOpsAutomation,
  hasBookingOpsManualOverride,
} from '../decision-engine';
import type { BookingOpsRecord } from '../types';

const baseRecord: BookingOpsRecord = {
  id: 'ops-1',
  bookingId: null,
  guestName: 'Иван Петров',
  guestPhone: '+79990000001',
  guestEmail: null,
  guestTelegram: null,
  propertyId: 'OBJ-1',
  propertyLabel: 'Апартаменты',
  otaSource: 'avito',
  checkInAt: '2026-07-01T14:00:00.000Z',
  checkOutAt: '2026-07-03T11:00:00.000Z',
  opsStatus: 'created',
  manualNextAction: null,
  isBlocked: false,
  blockerReason: null,
  documentsStatus: 'not_started',
  contractStatus: 'not_started',
  depositStatus: 'not_started',
  mvdStatus: 'not_required',
  checkinReadinessStatus: 'not_started',
  notes: 'Заметка оператора',
  createdAt: '2026-06-27T08:00:00.000Z',
  updatedAt: '2026-06-27T08:00:00.000Z',
};

describe('Guest/Booking Ops v1 decision engine', () => {
  it('computes request_guest_documents for a new record with contact', () => {
    const result = evaluateBookingOpsAutomation(baseRecord, '2026-06-27T09:00:00.000Z');
    expect(result).toMatchObject({
      nextAction: 'request_guest_documents',
      automationState: 'action_required',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: 'documents_requested',
    });
    expect(buildBookingOpsAutomationPatch(baseRecord)).toMatchObject({
      manualNextAction: 'Запросить документы гостя',
    });
  });

  it('advances through documents, contract, deposit, and check-in readiness', () => {
    const verified: BookingOpsRecord = {
      ...baseRecord,
      documentsStatus: 'verified',
      contractStatus: 'signed',
      depositStatus: 'confirmed',
      checkinReadinessStatus: 'ready',
    };
    expect(evaluateBookingOpsAutomation(verified)).toMatchObject({
      nextAction: 'mark_ready_for_checkin',
      canAutoPerform: true,
      recommendedOpsStatus: 'ready_for_checkin',
    });
    expect(buildBookingOpsAutomationPatch(verified)).toEqual({
      opsStatus: 'ready_for_checkin',
      manualNextAction: 'Пауза',
    });
  });

  it('routes MVD-required bookings through prepare and submit steps', () => {
    const mvdRequired: BookingOpsRecord = {
      ...baseRecord,
      documentsStatus: 'verified',
      contractStatus: 'signed',
      depositStatus: 'confirmed',
      mvdStatus: 'required',
    };
    expect(evaluateBookingOpsAutomation(mvdRequired)).toMatchObject({
      nextAction: 'prepare_mvd_report',
      recommendedOpsStatus: 'mvd_prepared',
    });

    const mvdPrepared: BookingOpsRecord = { ...mvdRequired, mvdStatus: 'prepared' };
    expect(evaluateBookingOpsAutomation(mvdPrepared)).toMatchObject({
      nextAction: 'submit_mvd_report',
      recommendedOpsStatus: 'mvd_submitted',
    });
  });

  it('preserves manual override and never includes notes in a patch', () => {
    const record: BookingOpsRecord = {
      ...baseRecord,
      manualNextAction: 'Сначала позвонить гостю',
    };
    expect(hasBookingOpsManualOverride(record)).toBe(true);
    expect(evaluateBookingOpsAutomation(record)).toMatchObject({
      automationState: 'manual_override',
      canAutoPerform: false,
      recommendedOpsStatus: null,
    });
    const patch = buildBookingOpsAutomationPatch(record);
    expect(patch).toEqual({});
    expect(patch).not.toHaveProperty('notes');
  });

  it('routes blocked and problem states to operator attention', () => {
    expect(
      evaluateBookingOpsAutomation({ ...baseRecord, isBlocked: true, blockerReason: 'Нет паспорта' }),
    ).toMatchObject({
      nextAction: 'blocked',
      automationState: 'blocked',
      needsOperatorAction: true,
    });
    expect(
      evaluateBookingOpsAutomation({ ...baseRecord, documentsStatus: 'problem' }),
    ).toMatchObject({
      nextAction: 'needs_operator_attention',
      automationState: 'needs_operator_attention',
    });
    expect(
      evaluateBookingOpsAutomation({ ...baseRecord, guestPhone: null, guestEmail: null, guestTelegram: null }),
    ).toMatchObject({
      nextAction: 'needs_operator_attention',
      needsOperatorAction: true,
    });
  });
});
