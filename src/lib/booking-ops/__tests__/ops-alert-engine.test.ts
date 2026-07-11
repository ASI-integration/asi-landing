import { describe, expect, it } from 'vitest';
import { calculateTurnoverDeadlines, evaluateOpsTurnover, type OpsTurnoverEvaluationInput } from '../ops-alert-engine';

const base: OpsTurnoverEvaluationInput = {
  turnoverId: 'turnover-1', propertyId: 'property-1', previousBookingId: 'previous-1', nextBookingId: 'next-1',
  checkoutAt: '2026-07-11T08:00:00.000Z', nextCheckInAt: '2026-07-11T14:00:00.000Z', now: '2026-07-11T10:00:00.000Z',
  cleaning: { status: 'verified', assigned: true }, linen: { status: 'verified', assigned: true }, inspection: { status: 'done', assigned: true },
  maintenance: [], finalReady: true,
};
const run = (patch: Partial<OpsTurnoverEvaluationInput> = {}) => evaluateOpsTurnover({ ...base, ...patch });

describe('OPS v15 alert engine', () => {
  it('calculates all deadlines from the next check-in', () => expect(calculateTurnoverDeadlines(base.nextCheckInAt!)).toEqual({ nextCheckInAt: base.nextCheckInAt, cleaningDeadlineAt: '2026-07-11T12:30:00.000Z', linenDeadlineAt: '2026-07-11T13:00:00.000Z', inspectionDeadlineAt: '2026-07-11T13:30:00.000Z', readyDeadlineAt: '2026-07-11T13:40:00.000Z' }));
  it('creates no actionable alert when all gates are timely', () => expect(run().conditions).toEqual([]));
  it('creates one cleaning warning when cleaning is unassigned', () => expect(run({ cleaning: { status: 'pending', assigned: false } }).conditions.filter((item) => item.gate === 'cleaning')).toMatchObject([{ code: 'CLEANING_NOT_ACCEPTED', severity: 'warning' }]));
  it('uses a stable cleaning incident key as status becomes overdue', () => { const warning = run({ cleaning: { status: 'pending', assigned: false } }).conditions[0]; const critical = run({ cleaning: { status: 'in_progress', assigned: true }, now: '2026-07-11T13:00:00.000Z' }).conditions[0]; expect(critical.dedupeKey).toBe(warning.dedupeKey); expect(critical).toMatchObject({ code: 'CLEANING_OVERDUE', severity: 'critical' }); });
  it('clears cleaning conditions after completion', () => expect(run({ cleaning: { status: 'completed', assigned: true } }).conditions.some((item) => item.gate === 'cleaning')).toBe(false));
  it('keeps linen blocked until confirmed', () => expect(run({ linen: { status: 'in_laundry', assigned: true }, finalReady: false }).conditions.map((item) => item.code)).toContain('LINEN_NOT_CONFIRMED'));
  it('clears linen conditions when delivered', () => expect(run({ linen: { status: 'delivered', assigned: true } }).conditions.some((item) => item.gate === 'linen')).toBe(false));
  it('makes a failed inspection critical', () => expect(run({ inspection: { status: 'failed' } }).conditions.find((item) => item.gate === 'inspection')).toMatchObject({ code: 'INSPECTION_FAILED', severity: 'critical' }));
  it('clears inspection conditions after pass', () => expect(run({ inspection: { status: 'passed' } }).conditions.some((item) => item.gate === 'inspection')).toBe(false));
  it('alerts for unresolved blocking maintenance', () => expect(run({ maintenance: [{ isBlocking: true, status: 'open' }] }).conditions.map((item) => item.code)).toContain('MAINTENANCE_BLOCKER_ACTIVE'));
  it('ignores non-blocking and resolved maintenance', () => { expect(run({ maintenance: [{ isBlocking: false, status: 'open' }] }).conditions).toEqual([]); expect(run({ maintenance: [{ isBlocking: true, status: 'resolved' }] }).conditions).toEqual([]); });
  it('clears final readiness risk when all gates are ready', () => expect(run({ finalReady: true }).conditions.some((item) => item.gate === 'readiness')).toBe(false));
  it('does not create false urgency without a next booking', () => expect(run({ nextCheckInAt: null, finalReady: false }).conditions).toEqual([]));
  it('recalculates deadlines when check-in changes', () => expect(run({ nextCheckInAt: '2026-07-11T16:00:00.000Z' }).deadlines?.readyDeadlineAt).toBe('2026-07-11T15:40:00.000Z'));
  it('skips inactive units', () => expect(run({ active: false, finalReady: false }).conditions).toEqual([]));
  it('makes back-to-back overdue gates critical', () => expect(run({ now: '2026-07-11T13:45:00.000Z', cleaning: null, linen: null, inspection: null, finalReady: false }).conditions.every((item) => item.severity === 'critical')).toBe(true));
  it('keeps readiness incident key stable through escalation', () => { const warning = run({ finalReady: false }).conditions.find((item) => item.gate === 'readiness')!; const critical = run({ finalReady: false, now: '2026-07-11T13:45:00.000Z' }).conditions.find((item) => item.gate === 'readiness')!; expect(critical.dedupeKey).toBe(warning.dedupeKey); expect(critical.severity).toBe('critical'); });
});
