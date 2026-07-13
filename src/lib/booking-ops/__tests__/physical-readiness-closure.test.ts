import { describe, expect, it } from 'vitest';
import {
  assertPhysicalApprovalAllowed,
  computePhysicalReadiness,
  physicalReadinessClosureDecision,
  validateCleaningTransition,
} from '../physical-readiness-execution';

const clear = { cleaningStatus: 'verified', linenStatus: 'verified', suppliesStatus: 'verified', maintenance: [] };

describe('cleaning execution and physical readiness closure', () => {
  it('rejects assignment without an executor', () => expect(() => validateCleaningTransition({ currentStatus: 'pending', nextStatus: 'assigned', hasExecutor: false })).toThrow('cleaning_executor_required'));
  it('allows pending to assigned with an executor', () => expect(() => validateCleaningTransition({ currentStatus: 'pending', nextStatus: 'assigned', hasExecutor: true })).not.toThrow());
  it('allows assigned to in progress', () => expect(() => validateCleaningTransition({ currentStatus: 'assigned', nextStatus: 'in_progress', hasExecutor: true })).not.toThrow());
  it('allows in progress to completed', () => expect(() => validateCleaningTransition({ currentStatus: 'in_progress', nextStatus: 'completed', hasExecutor: true })).not.toThrow());
  it('allows completed to verified', () => expect(() => validateCleaningTransition({ currentStatus: 'completed', nextStatus: 'verified', hasExecutor: true })).not.toThrow());
  it('rejects invalid forward status skipping', () => expect(() => validateCleaningTransition({ currentStatus: 'pending', nextStatus: 'completed', hasExecutor: true })).toThrow('cleaning_transition_invalid'));
  it('treats repeating the same valid state as idempotent', () => expect(() => validateCleaningTransition({ currentStatus: 'in_progress', nextStatus: 'in_progress', hasExecutor: true })).not.toThrow());
  it('keeps blocked and cancelled cleaning from producing ready', () => {
    expect(computePhysicalReadiness({ ...clear, cleaningStatus: 'blocked', finalApproved: true }).finalReady).toBe(false);
    expect(computePhysicalReadiness({ ...clear, cleaningStatus: 'cancelled', finalApproved: true }).finalReady).toBe(false);
  });
  it('does not treat completed cleaning as ready', () => {
    const result = computePhysicalReadiness({ ...clear, cleaningStatus: 'completed', finalApproved: false });
    expect(result.finalReady).toBe(false);
    expect(result.operationalBlockers.map((item) => item.key)).toContain('cleaning_not_verified');
  });
  it('verified cleaning removes only the cleaning blocker', () => {
    const result = computePhysicalReadiness({ cleaningStatus: 'verified', linenStatus: 'pending', suppliesStatus: 'pending', maintenance: [], finalApproved: false });
    expect(result.operationalBlockers.map((item) => item.key)).not.toContain('cleaning_not_verified');
    expect(result.operationalBlockers).toHaveLength(2);
  });
  it('another operational blocker keeps the property not ready', () => expect(computePhysicalReadiness({ ...clear, linenStatus: 'pending', finalApproved: true }).finalReady).toBe(false));
  it('all operational blockers cleared produces ready for review', () => expect(computePhysicalReadiness({ ...clear, finalApproved: false })).toMatchObject({ status: 'ready_for_review', finalReady: false }));
  it('final approval produces approved and final ready', () => expect(computePhysicalReadiness({ ...clear, finalApproved: true })).toMatchObject({ status: 'approved', finalReady: true }));
  it('final approval completes the property-ready gate and readiness task', () => expect(physicalReadinessClosureDecision(computePhysicalReadiness({ ...clear, finalApproved: true }), false)).toEqual({ gateStatus: 'completed', readinessTask: 'complete', invalidated: false }));
  it('rejects final approval while blockers exist', () => expect(() => assertPhysicalApprovalAllowed(computePhysicalReadiness({ ...clear, linenStatus: 'pending', finalApproved: false }).operationalBlockers)).toThrow('physical_blockers_exist'));
  it('a new blocker invalidates approval, blocks the gate, and repeated approval stays idempotent', () => {
    const regressed = computePhysicalReadiness({ ...clear, suppliesStatus: 'missing', finalApproved: false });
    expect(physicalReadinessClosureDecision(regressed, true)).toEqual({ gateStatus: 'blocked', readinessTask: 'open', invalidated: true });
    const approved = computePhysicalReadiness({ ...clear, finalApproved: true });
    expect(physicalReadinessClosureDecision(approved, true).readinessTask).toBe('complete');
  });
});
