import { describe, expect, it } from 'vitest';
import {
  buildPhysicalCoordinationDraftText,
  canReleaseCheckInInstructions,
  computePhysicalReadiness,
} from '../physical-readiness-execution';

const readyInput = {
  cleaningStatus: 'verified',
  linenStatus: 'verified',
  suppliesStatus: 'verified',
  maintenance: [],
  finalApproved: true,
};

describe('physical readiness execution v1', () => {
  it('keeps cleaning completed blocked until verification', () => {
    expect(computePhysicalReadiness({ ...readyInput, cleaningStatus: 'completed' }).blockers.map((item) => item.key))
      .toContain('cleaning_not_verified');
    expect(computePhysicalReadiness(readyInput).blockers.map((item) => item.key)).not.toContain('cleaning_not_verified');
  });

  it('keeps linen delivered blocked until verification', () => {
    expect(computePhysicalReadiness({ ...readyInput, linenStatus: 'delivered' }).blockers.map((item) => item.key))
      .toContain('linen_not_verified');
    expect(computePhysicalReadiness(readyInput).blockers.map((item) => item.key)).not.toContain('linen_not_verified');
  });

  it('blocks missing supplies and allows an explicit waiver', () => {
    expect(computePhysicalReadiness({ ...readyInput, suppliesStatus: 'missing' }).blockers.map((item) => item.key))
      .toContain('critical_supplies_missing');
    expect(computePhysicalReadiness({ ...readyInput, suppliesStatus: 'waived', suppliesWaiverReason: 'Запас гостю не требуется' }).blockers.map((item) => item.key))
      .not.toContain('critical_supplies_missing');
    expect(computePhysicalReadiness({ ...readyInput, suppliesStatus: 'waived', suppliesWaiverReason: '' }).blockers.map((item) => item.key))
      .toContain('critical_supplies_missing');
  });

  it('requires verification for resolved blocking maintenance', () => {
    for (const status of ['open', 'assigned', 'in_progress', 'resolved']) {
      expect(computePhysicalReadiness({ ...readyInput, maintenance: [{ status, isBlocking: true }] }).blockers.map((item) => item.key))
        .toContain('blocking_maintenance_open');
    }
    expect(computePhysicalReadiness({ ...readyInput, maintenance: [{ status: 'verified', isBlocking: true }] }).blockers.map((item) => item.key))
      .not.toContain('blocking_maintenance_open');
  });

  it('allows deferred maintenance only with an explicit reason', () => {
    expect(computePhysicalReadiness({ ...readyInput, maintenance: [{ status: 'deferred', isBlocking: false }] }).blockers.map((item) => item.key))
      .toContain('blocking_maintenance_open');
    expect(computePhysicalReadiness({ ...readyInput, maintenance: [{ status: 'deferred', isBlocking: false, reason: 'После выезда, гостю не мешает' }] }).blockers.map((item) => item.key))
      .not.toContain('blocking_maintenance_open');
  });

  it('does not allow final approval while operational blockers exist', () => {
    const result = computePhysicalReadiness({ ...readyInput, cleaningStatus: 'completed', finalApproved: true });
    expect(result.finalReady).toBe(false);
    expect(result.status).toBe('blocked');
  });

  it('requires final approval after all operational blockers clear', () => {
    const review = computePhysicalReadiness({ ...readyInput, finalApproved: false });
    expect(review.status).toBe('ready_for_review');
    expect(review.blockers.map((item) => item.key)).toEqual(['final_readiness_not_approved']);
    expect(computePhysicalReadiness(readyInput).finalReady).toBe(true);
  });

  it('releases instructions only when legal and physical gates both pass', () => {
    const physical = computePhysicalReadiness(readyInput);
    expect(canReleaseCheckInInstructions({ legalReady: false, physical })).toEqual({
      allowed: false, blockerKeys: ['legal_readiness_not_complete'],
    });
    expect(canReleaseCheckInInstructions({ legalReady: true, physical }).allowed).toBe(true);
  });

  it('builds a draft without changing execution state or implying a send', () => {
    const before = computePhysicalReadiness({ ...readyInput, cleaningStatus: 'pending' });
    const draft = buildPhysicalCoordinationDraftText({
      taskType: 'cleaning', property: 'Квартира 1', bookingDates: '2–5 июля', deadline: '2 июля 14:00',
    });
    const after = computePhysicalReadiness({ ...readyInput, cleaningStatus: 'pending' });
    expect(after).toEqual(before);
    expect(draft).toContain('Это черновик');
    expect(draft).toContain('фото или короткий отчёт');
  });
});
