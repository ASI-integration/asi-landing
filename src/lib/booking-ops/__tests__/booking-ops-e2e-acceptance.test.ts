import { describe, expect, it } from 'vitest';
import {
  initialLifecycleState,
  reduceLifecycle,
  type LifecycleEvent,
  type LifecycleState,
} from '../lifecycle-autopilot';
import { lifecycleProjection } from '../lifecycle-convergence';
import { evaluatePreCheckinAlerts } from '../pre-checkin-alert-engine';
import { evaluateOpsTurnover } from '../ops-alert-engine';
import {
  canReleaseCheckInInstructions,
  computePhysicalReadiness,
  validateCleaningTransition,
} from '../physical-readiness-execution';
import type { BookingLifecycleGate, BookingLifecycleGateKey, BookingLifecycleStatus } from '../lifecycle-types';

const BOOKING_ID = 'acceptance-booking-1';
const NOW = '2026-07-13T09:00:00.000Z';
let sequence = 0;

function event(type: string, payload: Record<string, unknown> = {}, id = `event-${++sequence}`): LifecycleEvent {
  return {
    id,
    bookingId: BOOKING_ID,
    objectId: 'property-1',
    type,
    actorType: 'system',
    payload,
    source: 'acceptance',
    correlationId: 'acceptance-run',
    createdAt: NOW,
  };
}

function apply(state: LifecycleState, type: string, payload: Record<string, unknown> = {}): LifecycleState {
  return reduceLifecycle(state, event(type, payload)).state;
}

function gate(gateKey: BookingLifecycleGateKey, status: BookingLifecycleStatus): BookingLifecycleGate {
  return {
    id: `${BOOKING_ID}:${gateKey}`,
    bookingId: BOOKING_ID,
    gateKey,
    status,
    source: 'system',
    updatedAt: NOW,
    completedAt: status === 'completed' ? NOW : null,
    reason: null,
    note: null,
    metadata: {},
  };
}

function preCheckinAlerts(gates: BookingLifecycleGate[]) {
  return evaluatePreCheckinAlerts({
    bookingId: BOOKING_ID,
    bookingStatus: 'active',
    checkInAt: '2026-07-14T12:00:00.000Z',
    lifecycleGates: gates,
    tasks: [],
    communications: [],
    now: NOW,
  });
}

function legallyReady(): LifecycleState {
  return [
    'booking.received',
    'guest.contacted',
    'guest.data_submitted',
    'guest.documents_uploaded',
    'guest.documents_verified',
    'contract.generated',
    'deposit.confirmed',
    'mvd.completed',
  ].reduce((state, type) => apply(state, type), initialLifecycleState());
}

describe('Booking Ops end-to-end lifecycle acceptance', () => {
  it('closes the complete canonical booking lifecycle with terminal tasks and no stale blockers', () => {
    let state = legallyReady();
    for (const type of [
      'cleaner.task_completed',
      'linen.task_completed',
      'consumables.task_completed',
      'inspection.completed',
      'property.readiness_changed',
      'checkin.instructions_released',
      'guest.checked_in',
      'stay.started',
      'checkout.started',
      'checkout.inspection_completed',
      'deposit.return_completed',
      'booking.closed',
    ]) state = apply(state, type, type === 'property.readiness_changed' ? { ready: true } : {});

    const projection = lifecycleProjection(state, 'property-1');
    expect(state.stage).toBe('closed');
    expect(state.readiness).toBe('ready');
    expect(state.blockers).toEqual([]);
    expect(state.tasks.every((task) => task.status === 'completed')).toBe(true);
    expect(projection).toMatchObject({ current_stage: 'closed', status: 'completed', blocker_reasons: [], next_action: null });
    expect(projection.metadata).toMatchObject({ noExternalSend: true });
    expect(state.audit.map((item) => item.decision)).toEqual(expect.arrayContaining([
      'guest data gate completed', 'deposit gate completed', 'check-in recorded', 'checkout inspection completed', 'booking closure evaluated',
    ]));
  });

  it('keeps missing guest data blocked, raises the canonical alert, and acknowledgement cannot advance state', () => {
    const alert = preCheckinAlerts([gate('guest_data_completed', 'pending')]);
    const before = apply(initialLifecycleState(), 'booking.received');
    const acknowledged = apply(before, 'alert.acknowledged');

    expect(alert).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'GUEST_DATA_INCOMPLETE', sourceDomain: 'guest' })]));
    expect(before.completed).not.toContain('guest_data_completed');
    expect(acknowledged.stage).toBe(before.stage);
    expect(acknowledged.completed).toEqual(before.completed);
  });

  it('clears the guest-data alert from canonical facts and resumes lifecycle progression', () => {
    expect(preCheckinAlerts([gate('guest_data_completed', 'pending')]).some((item) => item.code === 'GUEST_DATA_INCOMPLETE')).toBe(true);
    expect(preCheckinAlerts([gate('guest_data_completed', 'completed')]).some((item) => item.code === 'GUEST_DATA_INCOMPLETE')).toBe(false);

    const resumed = apply(initialLifecycleState(), 'guest.data_submitted');
    expect(resumed.completed).toContain('guest_data_completed');
    expect(resumed.audit.at(-1)?.decision).toBe('guest data gate completed');
  });

  it('blocks check-in for a missing deposit and resumes only after the canonical payment condition clears', () => {
    const missing = preCheckinAlerts([gate('deposit_received', 'blocked')]);
    const physical = computePhysicalReadiness({
      cleaningStatus: 'verified', linenStatus: 'verified', suppliesStatus: 'verified', finalApproved: true,
    });

    expect(missing).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DEPOSIT_NOT_RECEIVED', severity: 'critical' })]));
    expect(canReleaseCheckInInstructions({ legalReady: false, physical })).toMatchObject({ allowed: false });
    expect(preCheckinAlerts([gate('deposit_received', 'completed')]).some((item) => item.code === 'DEPOSIT_NOT_RECEIVED')).toBe(false);
    expect(canReleaseCheckInInstructions({ legalReady: true, physical })).toEqual({ allowed: true, blockerKeys: [] });
  });

  it('turns a cleaning delay into an actionable alert and requires assignment, completion, then verification', () => {
    const delayed = evaluateOpsTurnover({
      turnoverId: 'turnover-1', propertyId: 'property-1', nextBookingId: BOOKING_ID,
      nextCheckInAt: '2026-07-13T10:00:00.000Z', now: NOW,
      cleaning: { status: 'pending', assigned: false }, linen: { status: 'verified' }, inspection: { status: 'verified' },
      maintenance: [], finalReady: false,
    });
    expect(delayed.conditions).toEqual(expect.arrayContaining([expect.objectContaining({ sourceGate: 'cleaning' })]));

    expect(() => validateCleaningTransition({ currentStatus: 'pending', nextStatus: 'assigned', hasExecutor: false })).toThrow('cleaning_executor_required');
    expect(() => validateCleaningTransition({ currentStatus: 'pending', nextStatus: 'assigned', hasExecutor: true })).not.toThrow();
    expect(() => validateCleaningTransition({ currentStatus: 'assigned', nextStatus: 'in_progress', hasExecutor: true })).not.toThrow();
    expect(() => validateCleaningTransition({ currentStatus: 'in_progress', nextStatus: 'completed', hasExecutor: true })).not.toThrow();

    const completed = computePhysicalReadiness({ cleaningStatus: 'completed', linenStatus: 'verified', suppliesStatus: 'verified', finalApproved: true });
    const verified = computePhysicalReadiness({ cleaningStatus: 'verified', linenStatus: 'verified', suppliesStatus: 'verified', finalApproved: true });
    expect(completed.finalReady).toBe(false);
    expect(completed.blockers.map((item) => item.key)).toContain('cleaning_not_verified');
    expect(verified).toMatchObject({ status: 'approved', finalReady: true, blockers: [] });
  });

  it('deduplicates the same durable event without duplicate tasks, decisions, or state changes', () => {
    const input = event('mvd.completed', {}, 'durable-event-1');
    const before = legallyReady();
    const first = reduceLifecycle(before, input);
    const duplicate = reduceLifecycle(first.state, input, new Set([input.id]));

    expect(duplicate).toMatchObject({ duplicate: true, tasksToCreate: [], eventsToEmit: [] });
    expect(duplicate.state).toBe(first.state);
    expect(first.state.tasks.map((task) => task.key)).toEqual([...new Set(first.state.tasks.map((task) => task.key))]);
    expect(first.state.audit.filter((item) => item.eventId === input.id)).toHaveLength(1);
  });

  it('routes damage through maintenance and exact reinspection before restoring readiness', () => {
    let state = legallyReady();
    for (const type of ['cleaner.task_completed', 'linen.task_completed', 'consumables.task_completed', 'inspection.completed']) state = apply(state, type);
    state = apply(state, 'damage.reported');
    const maintenance = state.tasks.find((task) => task.role === 'maintenance_technician');
    expect(state.readiness).toBe('blocked');
    expect(maintenance).toBeDefined();

    state = apply(state, 'maintenance.task_completed', { taskKey: maintenance?.key });
    const reinspection = state.tasks.find((task) => task.key.includes(':reinspection:'));
    expect(state.blockers).toContain('reinspection_required');
    state = apply(state, 'inspection.completed', { taskKey: reinspection?.key });
    expect(state.tasks.find((task) => task.key === reinspection?.key)?.status).toBe('completed');
    expect(state.readiness).toBe('ready');
  });

});
