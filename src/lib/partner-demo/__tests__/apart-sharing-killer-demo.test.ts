import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { runApartSharingKillerDemo } from '../apart-sharing-killer-demo';

describe('Apart Sharing killer demo v1', () => {
  it('runs the complete deterministic synthetic story through existing ASI modules', async () => {
    const first = await runApartSharingKillerDemo();
    const second = await runApartSharingKillerDemo();

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.synthetic).toBe(true);
    expect(first.partner).toEqual({
      id: 'apart-sharing-demo',
      role: 'target_partner',
      integrationStatus: 'not_integrated',
    });

    // A. Wi-Fi answer is grounded.
    expect(first.communication.routine).toMatchObject({
      decision: 'reply', policy: 'auto_allowed', grounded: true, operatorRequired: false,
      responseLatencyMs: 0, routineHumanTouchAvoided: true,
    });
    expect(first.communication.routine.answer).toContain('demo-wifi-2026');

    // B–F. Heating escalates into one recovery and technical resolution remains distinct from recovery.
    expect(first.communication.operationalIssue).toMatchObject({
      category: 'heating', actionType: 'maintenance_issue', actionReused: true,
      handoffStatus: 'pending', operatorRequired: true,
    });
    expect(first.serviceRecovery.caseCount).toBe(1);
    expect(first.serviceRecovery).toMatchObject({ opened: 'open', inProgress: 'in_progress' });
    expect(first.serviceRecovery.technicalResolution).toEqual({
      status: 'awaiting_guest_confirmation',
      recovered: false,
      followupPrepared: 'Удалось решить проблему с отоплением. Подскажите, пожалуйста, сейчас всё в порядке?',
      followupSent: false,
    });
    expect(first.serviceRecovery.guestConfirmation).toEqual({
      satisfied: true, status: 'recovered', outcome: 'satisfied', operatorRequired: false,
    });
    expect(first.serviceRecovery.metrics).toEqual({
      resolutionLatencyMs: 1_200_000,
      confirmationLatencyMs: 300_000,
      totalRecoveryLatencyMs: 1_500_000,
    });

    // G–I. Review is correlated to the recovered stay, safely drafted, unpublished, and signaled.
    expect(first.reputation.analysis).toMatchObject({
      sentiment: 'positive', reputationRisk: 'low', recoveryContext: 'recovered_before_review',
    });
    expect(first.reputation.analysis.categories).toEqual(expect.arrayContaining(['heating', 'maintenance']));
    expect(first.reputation.responseDraft).toMatchObject({ safe: true, publiclyPublished: false });
    expect(first.reputation.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'heating', recoveryContext: 'recovered_before_review' }),
    ]));
    expect(first.reputation.propertyIntelligence).toMatchObject({
      synthetic: true, windowDays: 30, reviewCount: 4, heatingMentions: 4,
      trendSignal: 'insufficient_sample',
    });

    // J–K. Shadow pricing is advisory and never changes the price.
    expect(first.revenue.recommendation).toMatchObject({
      currentRate: 6000, shadowRecommendedRate: 6500, delta: 500,
      mode: 'shadow', priceChanged: false,
    });
    expect(first.revenue.recommendation.guardrails).toEqual({ minPrice: 4500, maxPrice: 6500 });

    // L–O. All external actions remain off, uplift remains unproven, and every fixture is synthetic.
    expect(first.communication.outboundGuestMessages).toBe(0);
    expect(first.sideEffects).toEqual({
      productionChanged: false,
      stagingChanged: false,
      externalCalls: 0,
      otaPriceWrites: 0,
      outboundGuestMessages: 0,
      publicReviewPublications: 0,
    });
    expect(first.revenue.historicalEvidence).toMatchObject({
      fixtureNights: 75,
      provenRevenueUplift: null,
      counterfactual: 'NOT_PROVEN',
    });
    expect(first.claims.syntheticDemo).toContain('Apartment 101 story');
    expect(first.disclaimers.join(' ')).toMatch(/synthetic|синтетич/iu);
  });
});
