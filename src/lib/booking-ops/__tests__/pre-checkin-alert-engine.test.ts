import { describe, expect, it } from 'vitest';
import { evaluatePreCheckinAlerts, type PreCheckinAlertEngineInput } from '../pre-checkin-alert-engine';
import type { BookingLifecycleGate, BookingLifecycleGateKey, BookingLifecycleStatus } from '../lifecycle-types';
import type { BookingOpsCommunicationIntent } from '../types';

const now = '2026-07-13T04:00:00.000Z';
const checkInAt = '2026-07-13T08:00:00.000Z';
const managedGates: BookingLifecycleGateKey[] = [
  'guest_data_completed', 'documents_verified', 'contract_signed', 'deposit_received',
  'mvd_report_submitted', 'checkin_instructions_sent',
];

function gate(gateKey: BookingLifecycleGateKey, status: BookingLifecycleStatus = 'completed', metadata: Record<string, unknown> = {}): BookingLifecycleGate {
  return {
    id: `gate-${gateKey}`, bookingId: 'booking-1', gateKey, status, source: 'system',
    updatedAt: now, completedAt: status === 'completed' ? now : null, reason: null, note: null, metadata,
  };
}

function input(overrides: Partial<PreCheckinAlertEngineInput> = {}): PreCheckinAlertEngineInput {
  return {
    bookingId: 'booking-1', bookingStatus: 'created', checkInAt, manualNextAction: null,
    lifecycleGates: managedGates.map((key) => gate(key)), tasks: [], communications: [], now,
    ...overrides,
  };
}

function withGateStatus(gateKey: BookingLifecycleGateKey, status: BookingLifecycleStatus, metadata: Record<string, unknown> = {}) {
  return managedGates.map((key) => gate(key, key === gateKey ? status : 'completed', key === gateKey ? metadata : {}));
}

function draft(): BookingOpsCommunicationIntent {
  return {
    id: 'draft-1', bookingOpsRecordId: 'booking-1', bookingId: 'source-booking-1', relatedTaskId: null,
    actorType: 'guest', actorLabel: 'Private Guest', purpose: 'send_checkin_instructions', channel: 'manual',
    status: 'draft_ready', messageText: 'private message body', messageTemplateKey: 'guest.instructions',
    metadata: { passportNumber: 'secret' }, createdAt: now, updatedAt: now, supersededAt: null,
  };
}

describe('pre-check-in Operator Alert evaluator', () => {
  it('creates one warning when guest data is missing', () => {
    const conditions = evaluatePreCheckinAlerts(input({
      lifecycleGates: managedGates.filter((key) => key !== 'guest_data_completed').map((key) => gate(key)),
    }));
    expect(conditions).toEqual([expect.objectContaining({
      code: 'GUEST_DATA_INCOMPLETE', incidentFamily: 'GUEST_DATA', sourceDomain: 'guest',
      sourceGate: 'guest_data_completed', severity: 'warning', deadlineAt: checkInAt,
    })]);
  });

  it('creates one critical legal alert for blocked documents', () => {
    const dueAt = '2026-07-13T03:00:00.000Z';
    const conditions = evaluatePreCheckinAlerts(input({ lifecycleGates: withGateStatus('documents_verified', 'blocked', { dueAt }) }));
    expect(conditions).toEqual([expect.objectContaining({
      code: 'DOCUMENTS_NOT_VERIFIED', incidentFamily: 'DOCUMENTS', sourceDomain: 'legal', severity: 'critical', deadlineAt: dueAt,
    })]);
  });

  it('creates one legal alert for an unsigned contract', () => {
    expect(evaluatePreCheckinAlerts(input({ lifecycleGates: withGateStatus('contract_signed', 'pending') })))
      .toEqual([expect.objectContaining({ code: 'CONTRACT_NOT_SIGNED', incidentFamily: 'CONTRACT', sourceDomain: 'legal', severity: 'warning' })]);
  });

  it('creates one payment alert for a missing deposit', () => {
    expect(evaluatePreCheckinAlerts(input({
      lifecycleGates: managedGates.filter((key) => key !== 'deposit_received').map((key) => gate(key)),
    }))).toEqual([expect.objectContaining({ code: 'DEPOSIT_NOT_RECEIVED', incidentFamily: 'DEPOSIT', sourceDomain: 'payment' })]);
  });

  it('creates one compliance alert for an incomplete MVD gate', () => {
    expect(evaluatePreCheckinAlerts(input({ lifecycleGates: withGateStatus('mvd_report_submitted', 'in_progress') })))
      .toEqual([expect.objectContaining({ code: 'MVD_NOT_SUBMITTED', incidentFamily: 'MVD', sourceDomain: 'compliance', severity: 'warning' })]);
  });

  it('uses one communication alert and enriches it when a ready draft exists', () => {
    const lifecycleGates = withGateStatus('checkin_instructions_sent', 'pending');
    const withoutDraft = evaluatePreCheckinAlerts(input({ lifecycleGates }));
    const withDraft = evaluatePreCheckinAlerts(input({ lifecycleGates, communications: [draft()] }));
    expect(withoutDraft).toEqual([expect.objectContaining({ code: 'CHECKIN_INSTRUCTIONS_NOT_SENT', sourceDomain: 'communication' })]);
    expect(withDraft).toHaveLength(1);
    expect(withDraft[0]).toMatchObject({
      code: 'CHECKIN_INSTRUCTIONS_NOT_SENT', metadata: { communicationState: 'draft_ready', referenceId: 'draft-1' },
    });
    expect(withDraft[0].recommendedAction).toContain('черновик');
  });

  it('creates one booking alert when arrival time needs clarification', () => {
    expect(evaluatePreCheckinAlerts(input({ manualNextAction: 'Уточнить время заезда у гостя' })))
      .toEqual([expect.objectContaining({
        code: 'ARRIVAL_TIME_UNCONFIRMED', incidentFamily: 'ARRIVAL_TIME', sourceDomain: 'booking',
        sourceGate: 'arrival_time', severity: 'warning',
      })]);
  });

  it('creates no condition for completed, skipped, turnover, or physical gates', () => {
    const lifecycleGates = [
      ...managedGates.map((key) => gate(key, key === 'contract_signed' ? 'skipped' : 'completed')),
      gate('cleaning_scheduled', 'pending'), gate('linen_scheduled', 'failed'), gate('inspection_scheduled', 'pending'),
      gate('maintenance_required', 'completed'), gate('maintenance_resolved', 'blocked'), gate('property_ready', 'pending'),
    ];
    expect(evaluatePreCheckinAlerts(input({ lifecycleGates }))).toEqual([]);
  });

  it('returns no conditions for checked-in, closed, or inactive bookings', () => {
    const incomplete = managedGates.map((key) => gate(key, 'pending'));
    expect(evaluatePreCheckinAlerts(input({ lifecycleGates: [...incomplete, gate('guest_checked_in', 'completed')] }))).toEqual([]);
    expect(evaluatePreCheckinAlerts(input({ lifecycleGates: [...incomplete, gate('booking_closed', 'completed')] }))).toEqual([]);
    expect(evaluatePreCheckinAlerts(input({ bookingStatus: 'inactive', lifecycleGates: incomplete }))).toEqual([]);
  });

  it('emits only allowlisted operational metadata without guest PII or message content', () => {
    const conditions = evaluatePreCheckinAlerts(input({
      lifecycleGates: withGateStatus('checkin_instructions_sent', 'pending'), communications: [draft()],
    }));
    expect(conditions[0].metadata).toEqual({
      gateStatus: 'pending', readinessStatus: 'needs_attention', minutesToCheckIn: 240,
      communicationState: 'draft_ready', referenceId: 'draft-1',
    });
    expect(JSON.stringify(conditions)).not.toContain('Private Guest');
    expect(JSON.stringify(conditions)).not.toContain('private message body');
    expect(JSON.stringify(conditions)).not.toContain('passportNumber');
  });
});
