import { describe, expect, it } from 'vitest';
import {
  computePreCheckinReadinessSnapshot,
  type PreCheckinReadinessSnapshot,
} from '../pre-checkin-control-center';
import type { BookingLifecycleGate, BookingLifecycleGateKey, BookingLifecycleSnapshot } from '../lifecycle-types';
import type { BookingOpsTask } from '../task-types';

const now = new Date('2026-06-30T10:00:00.000Z');

function gate(gateKey: BookingLifecycleGateKey, status: BookingLifecycleGate['status']): BookingLifecycleGate {
  return {
    id: gateKey,
    bookingId: 'ops-1',
    gateKey,
    status,
    source: 'system',
    updatedAt: now.toISOString(),
    completedAt: status === 'completed' ? now.toISOString() : null,
    reason: null,
    note: null,
    metadata: {},
  };
}

function lifecycle(gates: BookingLifecycleGate[]): BookingLifecycleSnapshot {
  return {
    bookingId: 'ops-1',
    gates,
    readinessScore: 100,
    currentActiveGate: null,
    blockedGates: gates.filter((item) => item.status === 'blocked' || item.status === 'failed'),
    completedGates: gates.filter((item) => item.status === 'completed'),
    nextRequiredGates: gates.filter((item) => item.status === 'pending' || item.status === 'in_progress'),
    exceptions: [],
  };
}

const required: BookingLifecycleGateKey[] = [
  'guest_data_completed',
  'documents_verified',
  'contract_signed',
  'deposit_received',
  'mvd_report_prepared',
  'cleaning_scheduled',
  'linen_scheduled',
  'inspection_scheduled',
  'property_ready',
  'checkin_instructions_sent',
];

function snapshot(overrides: Partial<Record<BookingLifecycleGateKey, BookingLifecycleGate['status']>>, tasks: BookingOpsTask[] = []): PreCheckinReadinessSnapshot {
  return computePreCheckinReadinessSnapshot({
    bookingId: 'ops-1',
    lifecycle: lifecycle(required.map((gateKey) => gate(gateKey, overrides[gateKey] ?? 'completed'))),
    tasks,
    communications: [],
    now,
  });
}

function task(input: Partial<BookingOpsTask>): BookingOpsTask {
  return {
    id: input.id ?? 'task-1',
    bookingOpsRecordId: 'ops-1',
    bookingId: 'booking-1',
    taskType: input.taskType ?? 'maintenance_needed',
    title: input.title ?? 'Ремонт',
    description: input.description ?? null,
    status: input.status ?? 'open',
    priority: input.priority ?? 'normal',
    source: input.source ?? 'system',
    dueAt: input.dueAt ?? null,
    completedAt: input.completedAt ?? null,
    metadata: input.metadata ?? {},
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

describe('Pre-check-in Control Center v1', () => {
  it('marks booking ready when all required gates are complete', () => {
    const result = snapshot({});

    expect(result.status).toBe('ready_for_checkin');
    expect(result.readinessScore).toBe(100);
    expect(result.hardBlockers).toHaveLength(0);
  });

  it('returns needs_attention when documents are missing', () => {
    const result = snapshot({ documents_verified: 'pending' });

    expect(result.status).toBe('needs_attention');
    expect(result.topBlocker).toMatchObject({ gateKey: 'documents_verified', severity: 'missing' });
  });

  it('returns blocked and fallback eligibility when documents are rejected', () => {
    const result = snapshot({ documents_verified: 'blocked' });

    expect(result.status).toBe('blocked');
    expect(result.topBlocker).toMatchObject({
      gateKey: 'documents_verified',
      severity: 'blocked',
      fallbackEligible: true,
    });
  });

  it('does not block when deposit is waived', () => {
    const result = snapshot({ deposit_received: 'skipped' });

    expect(result.status).toBe('ready_for_checkin');
  });

  it('does not block when contract is skipped by admin', () => {
    const result = snapshot({ contract_signed: 'skipped' });

    expect(result.status).toBe('ready_for_checkin');
  });

  it('blocks on unresolved maintenance', () => {
    const result = computePreCheckinReadinessSnapshot({
      bookingId: 'ops-1',
      lifecycle: lifecycle([
        ...required.map((gateKey) => gate(gateKey, 'completed')),
        gate('maintenance_required', 'completed'),
        gate('maintenance_resolved', 'pending'),
      ]),
      tasks: [],
      communications: [],
      now,
    });

    expect(result.status).toBe('blocked');
    expect(result.hardBlockers.map((item) => item.gateKey)).toContain('maintenance_resolved');
  });

  it('keeps normal pending non-overdue gate as needs_attention without fallback', () => {
    const result = snapshot({ cleaning_scheduled: 'pending' });

    expect(result.status).toBe('needs_attention');
    expect(result.topBlocker).toMatchObject({ gateKey: 'cleaning_scheduled', fallbackEligible: false });
  });

  it('returns overdue for overdue required gate', () => {
    const overdue = gate('inspection_scheduled', 'pending');
    overdue.metadata = { dueAt: '2026-06-29T10:00:00.000Z' };
    const result = computePreCheckinReadinessSnapshot({
      bookingId: 'ops-1',
      lifecycle: lifecycle(required.map((gateKey) =>
        gateKey === 'inspection_scheduled' ? overdue : gate(gateKey, 'completed'))),
      tasks: [],
      communications: [],
      now,
    });

    expect(result.status).toBe('overdue');
    expect(result.topBlocker).toMatchObject({ gateKey: 'inspection_scheduled', fallbackEligible: true });
  });

  it('blocks on unresolved maintenance task', () => {
    const result = snapshot({}, [task({ status: 'blocked', description: 'Нужен мастер' })]);

    expect(result.status).toBe('blocked');
    expect(result.hardBlockers.map((item) => item.gateKey)).toContain('maintenance_resolved');
  });
});
