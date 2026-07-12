import { describe, expect, it } from 'vitest';
import { initialLifecycleState, reduceLifecycle, type LifecycleEvent, type LifecycleState } from '../lifecycle-autopilot';
import { workerLinkIsUsable, workerLinkTaskScope } from '../secure-worker-links';

let n = 0;
const event = (type: string, payload: Record<string, unknown> = {}): LifecycleEvent => ({
  id: `event-${++n}`, bookingId: 'booking-1', type, actorType: 'system', payload,
  source: 'test', correlationId: 'correlation-1', createdAt: new Date(0).toISOString(),
});
const apply = (state: LifecycleState, type: string, payload: Record<string, unknown> = {}) => reduceLifecycle(state, event(type, payload)).state;
const legalReady = () => {
  let state = initialLifecycleState();
  for (const type of ['guest.data_submitted', 'guest.documents_verified', 'contract.generated', 'deposit.confirmed', 'mvd.completed']) state = apply(state, type);
  return state;
};
const turnover = legalReady;

describe('OPS v16 lifecycle autopilot', () => {
  it('progresses a normal booking to check-in only after gates', () => {
    let state = initialLifecycleState();
    for (const type of ['booking.received','guest.contacted','guest.data_submitted','guest.documents_uploaded','documents.verified','contract.generated','deposit.confirmed','mvd.completed','cleaner.task_completed','linen.task_completed','consumables.task_completed','inspection.completed']) state = apply(state, type);
    expect(state.readiness).toBe('ready');
    state = apply(state, 'property.readiness_changed', { ready: true });
    state = apply(state, 'checkin.instructions_released');
    state = apply(state, 'guest.checked_in');
    expect(state.stage).toBe('checked_in');
  });

  it('cleaner completion updates readiness blockers', () => {
    const state = apply(turnover(), 'cleaner.task_completed');
    expect(state.blockers).not.toContain('cleaner');
    expect(state.tasks.find((task) => task.role === 'cleaner')?.status).toBe('completed');
  });

  it('does not let deposit confirmation bypass the other legal gates', () => {
    const state = apply(initialLifecycleState(), 'deposit.confirmed');
    expect(state.completed).toContain('deposit_confirmed');
    expect(state.completed).not.toContain('turnover_created');
    expect(state.tasks).toHaveLength(0);
  });

  it.each(['mvd.completed', 'mvd.not_required'])('%s unlocks turnover only after the other gates', (type) => {
    let state = initialLifecycleState();
    for (const eventType of ['guest.data_submitted', 'guest.documents_verified', 'contract.generated', 'deposit.confirmed', type]) state = apply(state, eventType);
    expect(state.completed).toContain('turnover_created');
    expect(state.tasks).toHaveLength(4);
  });

  it('damage creates maintenance and blocks readiness', () => {
    let state = turnover();
    for (const type of ['cleaner.task_completed','linen.task_completed','consumables.task_completed','inspection.completed']) state = apply(state, type);
    state = apply(state, 'damage.reported');
    expect(state.readiness).toBe('blocked');
    expect(state.tasks.some((task) => task.role === 'maintenance_technician')).toBe(true);
  });

  it('maintenance completion returns flow to inspection', () => {
    let state = apply(turnover(), 'damage.reported');
    const decision = reduceLifecycle(state, event('maintenance.task_completed'));
    expect(decision.eventsToEmit).toContain('inspection.reinspection_requested');
    expect(decision.state.blockers).toContain('reinspection_required');
  });

  it('normal inspection completes only the canonical pre-check-in inspector task', () => {
    let state = apply(turnover(), 'checkout.started');
    state = apply(state, 'inspection.completed');

    expect(state.tasks.find((task) => task.key === 'booking-1:inspector')?.status).toBe('completed');
    expect(state.tasks.find((task) => task.key === 'booking-1:checkout:inspector')?.status).toBe('pending');
  });

  it('checkout inspection completes only the checkout inspector task and its checklist', () => {
    let state = apply(turnover(), 'checkout.started');
    const originalInspector = state.tasks.find((task) => task.key === 'booking-1:inspector');
    state = apply(state, 'checkout.inspection_completed');

    expect(state.tasks.find((task) => task.key === 'booking-1:inspector')).toEqual(originalInspector);
    expect(state.tasks.find((task) => task.key === 'booking-1:checkout:inspector')).toMatchObject({
      status: 'completed',
      checklist: [{ completed: true }],
    });
    expect(state.tasks).not.toContainEqual(expect.objectContaining({ key: 'booking-1:checkout:inspector', status: 'pending' }));
    expect(state.stage).toBe('checkout_inspected');
  });

  it('reinspection completion targets only the supplied task key', () => {
    let state = apply(turnover(), 'inspection.completed');
    const originalInspector = state.tasks.find((task) => task.key === 'booking-1:inspector');
    state = apply(state, 'damage.reported');
    state = apply(state, 'maintenance.task_completed');
    const reinspection = state.tasks.find((task) => task.key.includes(':reinspection:'));
    expect(reinspection).toBeDefined();

    state = apply(state, 'inspection.completed', { taskKey: reinspection?.key });

    expect(state.tasks.find((task) => task.key === reinspection?.key)?.status).toBe('completed');
    expect(state.tasks.find((task) => task.key === 'booking-1:inspector')).toEqual(originalInspector);
  });

  it('deduplicates an already processed event id', () => {
    const input = event('booking.received');
    const state = initialLifecycleState();
    const decision = reduceLifecycle(state, input, new Set([input.id]));
    expect(decision).toMatchObject({ duplicate: true, tasksToCreate: [], eventsToEmit: [] });
    expect(decision.state).toBe(state);
  });

  it('keeps exact task completion idempotent for duplicate events', () => {
    const input = event('checkout.inspection_completed');
    const state = apply(turnover(), 'checkout.started');
    const first = reduceLifecycle(state, input).state;
    const duplicate = reduceLifecycle(first, input, new Set([input.id]));

    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.state).toBe(first);
    expect(first.tasks.filter((task) => task.key === 'booking-1:checkout:inspector' && task.status === 'completed')).toHaveLength(1);
  });

  it('scheduler recovery produces no duplicate role tasks', () => {
    const input = event('mvd.completed');
    const first = legalReady();
    const recovered = reduceLifecycle(first, { ...input, id: 'recovery-event' }).state;
    expect(recovered.tasks).toHaveLength(4);
  });

  it('acknowledgement never unlocks readiness', () => {
    const state = turnover();
    const next = apply(state, 'alert.acknowledged');
    expect(next.readiness).toBe('blocked');
    expect(next.stage).toBe(state.stage);
  });

  it('closes only after checkout inspection and deposit return', () => {
    let state = turnover();
    state = apply(state, 'checkout.started');
    state = apply(state, 'checkout.inspection_completed');
    state = apply(state, 'deposit.returned');
    expect(state.stage).toBe('deposit_returned');
    state = apply(state, 'booking.closed');
    expect(state.stage).toBe('closed');
    expect(state.completed).toContain('deposit_returned');
  });

  it('cannot close checkout before inspection and deposit return', () => {
    const state = apply(apply(turnover(), 'checkout.started'), 'booking.closed');
    expect(state.completed).not.toContain('closed');
  });

  it('never releases check-in instructions before readiness', () => {
    const state = apply(turnover(), 'checkin.instructions_released');
    expect(state.completed).not.toContain('checkin_released');
  });

  it('records a manual override without silently advancing', () => {
    const state = turnover();
    const next = apply(state, 'manual.override', { reason: 'Подтверждено оператором' });
    expect(next.stage).toBe(state.stage);
    expect(next.audit.at(-1)?.decision).toContain('Подтверждено оператором');
  });

  it('scopes a worker link to exactly one task', () => {
    expect(workerLinkTaskScope('task-1', 'task-1')).toBe(true);
    expect(workerLinkTaskScope('task-1', 'task-2')).toBe(false);
  });

  it('fails revoked and expired worker links safely', () => {
    expect(workerLinkIsUsable({ expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: '2026-01-01T00:00:00.000Z' }, 0)).toBe(false);
    expect(workerLinkIsUsable({ expiresAt: '2020-01-01T00:00:00.000Z' }, Date.parse('2026-01-01T00:00:00.000Z'))).toBe(false);
  });
});
