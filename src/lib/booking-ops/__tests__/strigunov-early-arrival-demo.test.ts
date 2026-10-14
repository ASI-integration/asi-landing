import { afterEach, describe, expect, it, vi } from 'vitest';

// Positive import cut: retain genuine business functions; every DB/service call throws.
// These factories execute before the physical-readiness module is imported.
const boundary = vi.hoisted(() => ({
  forbidden: vi.fn(() => { throw new Error('forbidden_external_or_service_boundary'); }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: boundary.forbidden, rpc: boundary.forbidden } }));
vi.mock('../repository', () => ({ getBookingOpsRecord: boundary.forbidden, requireBookingOpsRecordScope: boundary.forbidden }));
vi.mock('../lifecycle', () => ({ blockGate: boundary.forbidden, completeGate: boundary.forbidden, markGateInProgress: boundary.forbidden }));
vi.mock('../tasks', () => ({ createBookingOpsTask: boundary.forbidden, updateBookingOpsTask: boundary.forbidden }));
vi.mock('../lifecycle-autopilot-service', () => ({ durableEventId: boundary.forbidden, recordProcessedBookingAuditEvent: boundary.forbidden }));

import {
  createStrigunovEarlyArrivalDemo, runStrigunovEarlyArrivalDemo,
  DEMO_SCOPE, DEMO_OPERATOR, DEMO_CLEANER, type DemoAction, type DemoReadiness,
} from '../strigunov-early-arrival-demo';

type ActionData = DemoAction extends infer A ? A extends DemoAction
  ? Omit<A, 'id' | 'actor' | 'scope' | 'evidence'> : never : never;
const ORIGIN = Date.parse('2026-10-11T08:00:00.000Z');
function fixture() {
  const demo = createStrigunovEarlyArrivalDemo();
  let sequence = 0;
  let now = ORIGIN;
  function act(data: ActionData, actor = DEMO_OPERATOR, extra: Partial<Pick<DemoAction, 'id' | 'scope' | 'evidence'>> = {}) {
    now += 1000;
    return demo.step({
      ...data, actor, id: 'synthetic-action-' + (++sequence),
      scope: { ...DEMO_SCOPE }, evidence: 'synthetic-evidence-' + sequence, ...extra,
    } as DemoAction, new Date(now).toISOString());
  }
  function intake(extra: Partial<Pick<DemoAction, 'id' | 'scope' | 'evidence'>> = {}) {
    return act({ kind: 'intake', requestedTime: '12:00' }, 'synthetic-guest', extra);
  }
  function cleanThrough(status: 'completed' | 'verified' = 'verified') {
    act({ kind: 'acknowledge' });
    for (const nextStatus of ['assigned', 'in_progress', 'completed'] as const) {
      act({ kind: 'cleaning', nextStatus }, DEMO_CLEANER);
    }
    if (status === 'verified') act({ kind: 'cleaning', nextStatus: 'verified' });
  }
  function observe(patch: Partial<DemoReadiness> = {}) {
    return act({ kind: 'readiness', value: {
      scope: { ...DEMO_SCOPE }, observedAt: new Date(now).toISOString(), evidence: 'synthetic-inspection',
      previousCheckoutComplete: true, legalReady: true, cleaningStatus: 'verified',
      linenStatus: 'verified', suppliesStatus: 'verified', maintenance: [], ...patch,
    } });
  }
  const approve = () => act({ kind: 'decision', approved: true });
  const respond = () => act({ kind: 'respond' }, 'synthetic-system');
  return { demo, act, intake, cleanThrough, observe, approve, respond, advance(ms: number) { now += ms; } };
}
function ready() {
  const f = fixture(); f.intake(); f.cleanThrough(); f.observe(); return f;
}
function held(result: ReturnType<ReturnType<typeof createStrigunovEarlyArrivalDemo>['snapshot']>) {
  expect(result.outcome).toBe('hold');
  expect(result.replies).toHaveLength(0);
  expect(result.guestResponse).not.toContain('Оператор подтвердил заезд');
}
afterEach(() => { expect(boundary.forbidden).not.toHaveBeenCalled(); });

describe('Strigunov 12:00 synthetic early-arrival positive allow-list', () => {
  it('01 completes real policy/readiness/operator composition and one correlated chronological journal', () => {
    const result = runStrigunovEarlyArrivalDemo();
    expect(result.outcome).toBe('approved');
    expect(result.replies).toHaveLength(1);
    expect(result.task).toMatchObject({ acknowledged: true, cleaningStatus: 'verified', assignedTo: DEMO_CLEANER });
    expect(result.handoff).toMatchObject({ resolved_booking_id: DEMO_SCOPE.bookingId, safe_to_auto_send: false });
    expect(result.timeline.map(e => e.kind)).toEqual([
      'guest_request_and_policy', 'operator_handoff_and_assignment', 'guest_response_held',
      'operator_acknowledged', 'cleaning_assigned', 'cleaning_in_progress', 'cleaning_completed',
      'cleaning_verified', 'readiness_observed', 'operator_approved',
      'readiness_rechecked_before_reply', 'synthetic_reply_recorded',
      'readiness_rechecked_before_reply', 'duplicate_reply_suppressed',
    ]);
    for (const event of result.timeline) {
      expect(event.scope).toEqual(DEMO_SCOPE);
      expect(event.actor).toMatch(/^synthetic-/);
      expect(event.evidence).toMatch(/^synthetic-/);
      expect(event.taskId).toBe('synthetic-cleaning-task-1');
      expect(Number.isFinite(Date.parse(event.at))).toBe(true);
    }
    expect(result.timeline.map(e => e.at)).toEqual([...result.timeline.map(e => e.at)].sort());
    expect(result.replies[0].decisionId).toBe(result.decision?.id);
    console.log('STRIGUNOV_TASK02_TIMELINE=' + JSON.stringify(result));
  });
  it('02 classifies 12:00 as conditional and produces a genuine conservative operator handoff', () => {
    const f = fixture(); const result = f.intake();
    expect(result.policy).toMatchObject({ bucket: 'conditional_early_checkin', requiresCleaningAvailability: true });
    expect(result.handoff).toMatchObject({ next_action: 'operator_review_and_reply', safe_to_auto_send: false });
    expect(result.guestResponse).toContain('зависит от уборки');
    expect(result.replies).toHaveLength(0);
  });
  it('03 completed cleaning cannot stand in for verified cleaning', () => {
    const f = fixture(); f.intake(); f.cleanThrough('completed'); f.observe({ cleaningStatus: 'completed' });
    expect(f.approve().reason).toContain('cleaning_not_verified'); held(f.respond());
  });
  it('04 absent readiness cannot approve or deliver', () => {
    const f = fixture(); f.intake(); f.cleanThrough();
    expect(f.approve().reason).toBe('readiness_missing'); held(f.respond());
  });
  it('05 readiness becomes stale between approval and response and invalidates that approval', () => {
    const f = ready(); f.approve(); f.advance(301_000);
    const result = f.respond(); held(result);
    expect(result.reason).toBe('readiness_stale_or_invalid'); expect(result.decision).toBeNull();
  });
  it('06 future and invalid readiness timestamps both fail closed', () => {
    for (const observedAt of ['2026-10-12T08:00:00.000Z', 'not-a-time']) {
      const f = ready(); f.observe({ observedAt });
      expect(f.approve().reason).toBe('readiness_stale_or_invalid'); held(f.respond());
    }
  });
  it('07 cross-account request, decision and observation cannot mutate canonical booking state', () => {
    const f = ready(); const before = f.demo.snapshot();
    const scope = { ...DEMO_SCOPE, accountId: 'synthetic-other-account' };
    expect(() => f.intake({ scope })).toThrow('demo_scope_mismatch');
    expect(() => f.act({ kind: 'decision', approved: true }, DEMO_OPERATOR, { scope })).toThrow('demo_scope_mismatch');
    expect(() => f.observe({ scope })).toThrow('demo_readiness_scope_mismatch');
    expect(f.demo.snapshot()).toEqual(before); held(f.respond());
  });
  it('08 fresh physical/legal readiness alone cannot replace an operator decision', () => {
    const f = ready(); const result = f.respond(); held(result);
    expect(result.reason).toBe('operator_approval_missing');
  });
  it('09 a legal hold blocks otherwise verified physical readiness', () => {
    const f = ready(); f.observe({ legalReady: false });
    expect(f.approve().reason).toContain('legal_readiness_not_complete'); held(f.respond());
  });
  it('10 previous checkout must be confirmed for conditional early arrival', () => {
    const f = ready(); f.observe({ previousCheckoutComplete: false });
    expect(f.approve().reason).toBe('previous_checkout_unconfirmed'); held(f.respond());
  });
  it('11 repeated inbound and actions create neither a second task nor a second reply', () => {
    const f = fixture();
    const inbound = { id: 'synthetic-fixed-inbound', evidence: 'synthetic-fixed-evidence' };
    f.intake(inbound); const first = f.demo.snapshot(); f.intake(inbound);
    expect(f.demo.snapshot().timeline).toEqual(first.timeline);
    f.cleanThrough(); f.observe();
    const decision = { id: 'synthetic-fixed-decision', evidence: 'synthetic-fixed-decision-evidence' };
    f.act({ kind: 'decision', approved: true }, DEMO_OPERATOR, decision);
    f.act({ kind: 'decision', approved: true }, DEMO_OPERATOR, decision);
    f.respond(); const result = f.respond();
    expect(result.duplicateCount).toBe(2);
    expect(result.replies).toHaveLength(1);
    expect(new Set(result.timeline.map(e => e.taskId)).size).toBe(1);
  });
  it('12 reused action identity with changed payload is rejected', () => {
    const f = fixture(); const id = 'synthetic-fixed-intake';
    f.intake({ id, evidence: 'synthetic-original' });
    expect(() => f.intake({ id, evidence: 'synthetic-changed' })).toThrow('demo_action_replay_conflict');
    expect(f.demo.snapshot().replies).toHaveLength(0);
  });
  it('13 a new maintenance blocker revokes a previous approval before delivery', () => {
    const f = ready(); expect(f.approve().outcome).toBe('approved');
    f.observe({ maintenance: [{ status: 'open', isBlocking: true }] });
    const result = f.respond(); held(result);
    expect(result.reason).toContain('blocking_maintenance_open');
    expect(result.decision).toBeNull();
  });
  it('14 an explicit negative operator decision produces a clear safe response', () => {
    const f = ready(); f.act({ kind: 'decision', approved: false });
    const result = f.respond(); held(result);
    expect(result.guestResponse).toContain('Оператор поможет согласовать другое время');
    expect(result.timeline.some(e => e.kind === 'operator_declined')).toBe(true);
  });
  it('15 executor refusal holds the request and is visible in the same timeline', () => {
    const f = fixture(); f.intake(); f.act({ kind: 'acknowledge' });
    f.act({ kind: 'cleaning', nextStatus: 'assigned' }, DEMO_CLEANER);
    f.act({ kind: 'cleaning', nextStatus: 'blocked' }, DEMO_CLEANER);
    f.observe({ cleaningStatus: 'blocked' }); f.approve();
    const result = f.respond(); held(result);
    expect(result.timeline.find(e => e.kind === 'cleaning_blocked')?.detail).toContain('Исполнитель отказался');
  });
  it('16 wrong actors and skipped cleaning transitions cannot grant readiness', () => {
    const f = fixture(); f.intake(); f.act({ kind: 'acknowledge' });
    expect(() => f.act({ kind: 'decision', approved: true }, DEMO_CLEANER)).toThrow('demo_operator_required');
    expect(() => f.act({ kind: 'cleaning', nextStatus: 'verified' }, DEMO_CLEANER)).toThrow('demo_cleaning_actor_invalid');
    expect(() => f.act({ kind: 'cleaning', nextStatus: 'verified' })).toThrow('cleaning_transition_invalid');
    held(f.respond());
  });
  it('17 acknowledgment is mandatory before cleaning and operator approval', () => {
    const f = fixture(); f.intake();
    expect(() => f.act({ kind: 'cleaning', nextStatus: 'assigned' }, DEMO_CLEANER)).toThrow('demo_acknowledgment_required');
    expect(f.approve().reason).toBe('operator_acknowledgment_missing'); held(f.respond());
  });
  it('18 snapshot mutation cannot forge approval; invalid event time cannot alter history', () => {
    const f = ready(); const exposed = f.demo.snapshot();
    exposed.outcome = 'approved'; exposed.timeline.length = 0;
    expect(f.demo.snapshot().timeline.length).toBeGreaterThan(0);
    expect(() => f.demo.step({ kind: 'respond', id: 'synthetic-invalid-time', actor: 'synthetic-system',
      scope: { ...DEMO_SCOPE }, evidence: 'synthetic-clock' }, '2025-01-01T00:00:00Z')).toThrow('demo_time_invalid');
    held(f.respond());
  });
});
