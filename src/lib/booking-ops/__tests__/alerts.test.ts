import { describe, expect, it } from 'vitest';
import {
  BOOKING_OPS_CHECKIN_CRITICAL_HOURS,
  computeBookingOpsAlerts,
} from '../alerts';
import type { BookingOpsRecord } from '../types';

const baseRecord: BookingOpsRecord = {
  id: 'ops-1',
  bookingId: 'booking-42',
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
  notes: null,
  createdAt: '2026-06-27T08:00:00.000Z',
  updatedAt: '2026-06-27T08:00:00.000Z',
};

function alertKinds(record: BookingOpsRecord, evaluatedAt: string) {
  return computeBookingOpsAlerts(record, evaluatedAt).alerts.map((alert) => alert.kind);
}

function maxSeverity(record: BookingOpsRecord, evaluatedAt: string) {
  return computeBookingOpsAlerts(record, evaluatedAt).maxSeverity;
}

describe('Booking Ops Alerts v1', () => {
  it('flags missing guest contact', () => {
    const record: BookingOpsRecord = {
      ...baseRecord,
      guestPhone: null,
      guestEmail: null,
      guestTelegram: null,
    };
    const summary = computeBookingOpsAlerts(record, '2026-06-27T09:00:00.000Z');
    expect(summary.alerts.some((alert) => alert.kind === 'guest_contact_missing')).toBe(true);
    expect(summary.primaryAlert?.relatedNextAction).toBe('needs_operator_attention');
  });

  it('flags documents requested but not received', () => {
    const record: BookingOpsRecord = {
      ...baseRecord,
      checkInAt: '2026-08-01T14:00:00.000Z',
      documentsStatus: 'requested',
    };
    expect(alertKinds(record, '2026-06-27T09:00:00.000Z')).toContain('documents_not_received');
    expect(maxSeverity(record, '2026-06-27T09:00:00.000Z')).toBe('info');
  });

  it('flags incomplete contract', () => {
    const record: BookingOpsRecord = {
      ...baseRecord,
      documentsStatus: 'verified',
      contractStatus: 'sent',
    };
    const summary = computeBookingOpsAlerts(record, '2026-06-27T09:00:00.000Z');
    expect(summary.alerts.some((alert) => alert.kind === 'contract_incomplete')).toBe(true);
    expect(summary.primaryAlert?.relatedNextAction).toBe('confirm_contract_signed');
  });

  it('flags incomplete deposit', () => {
    const record: BookingOpsRecord = {
      ...baseRecord,
      documentsStatus: 'verified',
      contractStatus: 'signed',
      depositStatus: 'requested',
    };
    const summary = computeBookingOpsAlerts(record, '2026-06-27T09:00:00.000Z');
    expect(summary.alerts.some((alert) => alert.kind === 'deposit_incomplete')).toBe(true);
    expect(summary.primaryAlert?.relatedNextAction).toBe('confirm_deposit');
  });

  it('flags MVD required but not submitted', () => {
    const record: BookingOpsRecord = {
      ...baseRecord,
      documentsStatus: 'verified',
      contractStatus: 'signed',
      depositStatus: 'confirmed',
      mvdStatus: 'prepared',
    };
    const summary = computeBookingOpsAlerts(record, '2026-06-27T09:00:00.000Z');
    expect(summary.alerts.some((alert) => alert.kind === 'mvd_not_submitted')).toBe(true);
    expect(summary.primaryAlert?.relatedNextAction).toBe('submit_mvd_report');
  });

  it('flags blocked/problem booking as critical', () => {
    const blocked = computeBookingOpsAlerts(
      { ...baseRecord, isBlocked: true, blockerReason: 'Нет паспорта' },
      '2026-06-27T09:00:00.000Z',
    );
    expect(blocked.maxSeverity).toBe('critical');
    expect(blocked.primaryAlert?.kind).toBe('booking_blocked');

    const problem = computeBookingOpsAlerts(
      { ...baseRecord, documentsStatus: 'problem' },
      '2026-06-27T09:00:00.000Z',
    );
    expect(problem.maxSeverity).toBe('critical');
  });

  it('escalates severity when check-in is approaching with incomplete steps', () => {
    const checkInSoon = new Date('2026-06-27T09:00:00.000Z');
    checkInSoon.setHours(checkInSoon.getHours() + BOOKING_OPS_CHECKIN_CRITICAL_HOURS - 1);
    const record: BookingOpsRecord = {
      ...baseRecord,
      checkInAt: checkInSoon.toISOString(),
      documentsStatus: 'not_started',
    };
    const summary = computeBookingOpsAlerts(record, '2026-06-27T09:00:00.000Z');
    expect(summary.maxSeverity).toBe('critical');
    expect(summary.alerts.some((alert) => alert.kind === 'checkin_approaching_incomplete')).toBe(
      true,
    );
  });

  it('ready booking has no critical alerts', () => {
    const ready: BookingOpsRecord = {
      ...baseRecord,
      documentsStatus: 'verified',
      contractStatus: 'signed',
      depositStatus: 'confirmed',
      checkinReadinessStatus: 'ready',
      opsStatus: 'ready_for_checkin',
    };
    const summary = computeBookingOpsAlerts(ready, '2026-06-27T09:00:00.000Z');
    expect(summary.alerts.every((alert) => alert.severity !== 'critical')).toBe(true);
    expect(summary.maxSeverity).toBeNull();
  });

  it('does not mutate the source record', () => {
    const record: BookingOpsRecord = { ...baseRecord };
    const before = JSON.stringify(record);
    computeBookingOpsAlerts(record, '2026-06-27T09:00:00.000Z');
    expect(JSON.stringify(record)).toBe(before);
  });
});
