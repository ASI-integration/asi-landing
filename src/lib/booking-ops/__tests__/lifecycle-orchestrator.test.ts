import { describe, expect, it } from 'vitest';
import { planBookingLifecycle, type BookingLifecycleRunType } from '../lifecycle-orchestrator';
import type { BookingLifecyclePlanInput } from '../lifecycle-orchestrator-types';

const BASE: BookingLifecyclePlanInput = {
  bookingId: '00000000-0000-4000-8000-000000000001',
  propertyId: 'prop_A',
  createdAt: '2026-07-01T08:00:00.000Z',
  checkInAt: '2026-07-03T15:00:00.000Z',
  now: '2026-07-01T09:00:00.000Z',
  guestComplete: false,
  guestBlockers: ['guest_intake_incomplete', 'guest_required_fields_missing'],
  legalComplete: false,
  legalBlockers: ['documents', 'contract', 'deposit', 'mvd'],
  physicalReady: false,
  physicalBlockers: ['cleaning_not_verified', 'linen_not_verified', 'final_readiness_not_approved'],
  cleaningVerified: false,
  linenVerified: false,
  blockingMaintenanceOpen: false,
  finalDraftPrepared: false,
};

function plan(patch: Partial<BookingLifecyclePlanInput> = {}) {
  return planBookingLifecycle({ ...BASE, ...patch });
}

describe('Booking Lifecycle Orchestrator planner', () => {
  it('keeps a new or partial booking in guest intake with explicit blockers', () => {
    const result = plan();
    expect(result.currentStage).toBe('guest_intake');
    expect(result.status).toBe('waiting_guest');
    expect(result.blockers).toContain('guest_required_fields_missing');
    expect(result.finalCheckinDraftAllowed).toBe(false);
  });

  it('moves to legal preparation only after guest intake is complete', () => {
    const result = plan({ guestComplete: true, guestBlockers: [] });
    expect(result.currentStage).toBe('legal_preparation');
    expect(result.blockers).toEqual(expect.arrayContaining(['documents', 'contract', 'deposit', 'mvd']));
  });

  it('keeps cleaning completed but not verified blocked', () => {
    const result = plan({ guestComplete: true, guestBlockers: [], legalComplete: true, legalBlockers: [] });
    expect(result.currentStage).toBe('physical_preparation');
    expect(result.blockers).toContain('cleaning_not_verified');
    expect(result.finalCheckinDraftAllowed).toBe(false);
  });

  it('keeps delivered linen without verification blocked', () => {
    const result = plan({
      guestComplete: true, guestBlockers: [], legalComplete: true, legalBlockers: [],
      cleaningVerified: true, physicalBlockers: ['linen_not_verified', 'final_readiness_not_approved'],
    });
    expect(result.blockers).toContain('linen_not_verified');
    expect(result.finalCheckinDraftAllowed).toBe(false);
  });

  it('keeps unresolved blocking maintenance blocked and creates an urgent SLA obligation', () => {
    const result = plan({
      guestComplete: true, guestBlockers: [], legalComplete: true, legalBlockers: [],
      cleaningVerified: true, linenVerified: true, blockingMaintenanceOpen: true,
      physicalBlockers: ['blocking_maintenance_open'], now: '2026-07-03T12:00:00.000Z',
    });
    const maintenance = result.slaItems.find((item) => item.itemType === 'maintenance');
    expect(maintenance?.overdue).toBe(true);
    expect(['urgent', 'critical']).toContain(maintenance?.severity);
    expect(result.finalCheckinDraftAllowed).toBe(false);
  });

  it('requires final operator review after worker tasks are verified', () => {
    const result = plan({
      guestComplete: true, guestBlockers: [], legalComplete: true, legalBlockers: [],
      cleaningVerified: true, linenVerified: true, physicalBlockers: ['final_readiness_not_approved'],
    });
    expect(result.currentStage).toBe('final_readiness_review');
    expect(result.status).toBe('ready_for_review');
  });

  it('allows a final draft only when guest, legal and physical gates all pass', () => {
    const result = plan({
      guestComplete: true, guestBlockers: [], legalComplete: true, legalBlockers: [], physicalReady: true,
      physicalBlockers: [], cleaningVerified: true, linenVerified: true,
    });
    expect(result.currentStage).toBe('checkin_release_ready');
    expect(result.finalCheckinDraftAllowed).toBe(true);
  });

  it('marks the lifecycle completed only after the final draft exists', () => {
    const result = plan({
      guestComplete: true, guestBlockers: [], legalComplete: true, legalBlockers: [], physicalReady: true,
      physicalBlockers: [], cleaningVerified: true, linenVerified: true, finalDraftPrepared: true,
    });
    expect(result.currentStage).toBe('checkin_release_draft_prepared');
    expect(result.status).toBe('completed');
  });

  it('computes overdue state deterministically from the injected clock', () => {
    const first = plan({ now: '2026-07-03T14:00:00.000Z' });
    const second = plan({ now: '2026-07-03T14:00:00.000Z' });
    expect(second).toEqual(first);
    expect(first.slaStatus).toBe('overdue');
    expect(first.status).toBe('overdue');
  });

  it('does not treat an escalation as completion', () => {
    const result = plan({ now: '2026-07-03T14:00:00.000Z' });
    const guest = result.slaItems.find((item) => item.itemType === 'guest_intake');
    expect(guest?.escalationNeeded).toBe(true);
    expect(guest?.status).toBe('overdue');
    expect(result.finalCheckinDraftAllowed).toBe(false);
  });

  it('keeps cancellation explicit and prevents draft preparation', () => {
    const result = plan({ cancelled: true });
    expect(result.currentStage).toBe('cancelled');
    expect(result.status).toBe('cancelled');
    expect(result.finalCheckinDraftAllowed).toBe(false);
  });

  it('keeps supported run types compile-time constrained', () => {
    const runType: BookingLifecycleRunType = 'probe';
    expect(runType).toBe('probe');
  });
});
