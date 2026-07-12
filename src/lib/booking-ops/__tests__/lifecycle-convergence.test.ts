import { describe, expect, it } from 'vitest';
import { initialLifecycleState, reduceLifecycle, type LifecycleEvent } from '../lifecycle-autopilot';
import { lifecycleProjection } from '../lifecycle-convergence';

const event = (type: string, id = type): LifecycleEvent => ({ id, bookingId: 'booking-1', objectId: null, type, actorType: 'system', payload: {}, source: 'test', correlationId: 'run-1', createdAt: '2026-07-12T00:00:00.000Z' });

describe('OPS v17.3 lifecycle convergence', () => {
  it('advances the persisted projection from reducer output and synchronizes property_id', () => {
    const state = reduceLifecycle(initialLifecycleState(), event('guest.contacted')).state;
    expect(lifecycleProjection(state, 'property-1')).toMatchObject({ current_stage: 'guest_contacted', property_id: 'property-1' });
  });

  it('persists a closed terminal projection without blockers or next action', () => {
    const state = { ...initialLifecycleState(), stage: 'closed' as const, readiness: 'ready' as const, blockers: ['stale'], completed: ['property_ready' as const] };
    expect(lifecycleProjection(state, 'property-1')).toMatchObject({ current_stage: 'closed', status: 'completed', blocker_reasons: [], next_action: null, final_checkin_draft_allowed: false });
  });
});
