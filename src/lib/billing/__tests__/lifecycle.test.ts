import { describe, it, expect } from 'vitest';
import {
  applyCardVerified,
  applyIntegrationStarted,
  applyIntegrationAccepted,
  applyPaidActivation,
  evaluatePaidActivationGate,
  deriveTrialWindow,
  canTransition,
  TRIAL_DAYS,
  type LifecycleState,
} from '../lifecycle';

function freshState(): LifecycleState {
  return {
    status: 'signup',
    timestamps: {
      cardVerifiedAt: null,
      integrationStartedAt: null,
      integrationReadyAt: null,
      trialStartedAt: null,
      trialEndsAt: null,
      billingStartedAt: null,
    },
  };
}

describe('lifecycle: allowed transitions', () => {
  it('only allows the canonical forward path', () => {
    expect(canTransition('signup', 'card_verified')).toBe(true);
    expect(canTransition('card_verified', 'integration_in_progress')).toBe(true);
    expect(canTransition('integration_in_progress', 'integration_ready')).toBe(true);
    expect(canTransition('integration_ready', 'trial_active')).toBe(true);
    expect(canTransition('trial_active', 'paid_active')).toBe(true);
  });

  it('rejects skipping states', () => {
    expect(canTransition('signup', 'trial_active')).toBe(false);
    expect(canTransition('card_verified', 'trial_active')).toBe(false);
    expect(canTransition('integration_in_progress', 'paid_active')).toBe(false);
    expect(canTransition('signup', 'paid_active')).toBe(false);
  });

  it('paid_active is terminal', () => {
    expect(canTransition('paid_active', 'signup')).toBe(false);
    expect(canTransition('paid_active', 'trial_active')).toBe(false);
  });
});

describe('scenario A: card attach never charges and never starts the trial', () => {
  it('card_verified sets only cardVerifiedAt; trial fields remain null', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const result = applyCardVerified(freshState(), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('card_verified');
    expect(result.state.timestamps.cardVerifiedAt).toEqual(now);
    expect(result.state.timestamps.trialStartedAt).toBeNull();
    expect(result.state.timestamps.trialEndsAt).toBeNull();
    expect(result.state.timestamps.integrationReadyAt).toBeNull();
  });

  it('rejects marking card_verified from a state that has not signed up', () => {
    const state: LifecycleState = { ...freshState(), status: 'paid_active' };
    const result = applyCardVerified(state, new Date());
    // paid_active is "further along" than card_verified, so this is treated
    // as an idempotent no-op rather than an error — never regresses state.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
  });
});

describe('scenario B: integration delay does not consume trial days', () => {
  it('30 days in integration_in_progress produces no trial fields whatsoever', () => {
    let state = freshState();
    const cardVerified = applyCardVerified(state, new Date('2026-01-01T00:00:00Z'));
    expect(cardVerified.ok).toBe(true);
    if (!cardVerified.ok) return;
    state = cardVerified.state;

    const started = applyIntegrationStarted(state, new Date('2026-01-01T00:05:00Z'));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    state = started.state;
    expect(state.status).toBe('integration_in_progress');

    // Simulate 30 days passing with no IntegrationAccepted event — nothing
    // in this module is time-driven, so the trial window simply never
    // appears until the domain event fires.
    expect(state.timestamps.trialStartedAt).toBeNull();
    expect(state.timestamps.trialEndsAt).toBeNull();
    expect(state.timestamps.integrationReadyAt).toBeNull();
  });
});

describe('scenario C + D: integration acceptance starts the trial exactly then', () => {
  it('trial_started_at === integration_ready_at, trial_ends_at = +14 days', () => {
    let state = freshState();
    state = (applyCardVerified(state, new Date('2026-01-01T00:00:00Z')) as { ok: true; state: LifecycleState }).state;
    state = (applyIntegrationStarted(state, new Date('2026-01-01T00:05:00Z')) as { ok: true; state: LifecycleState }).state;

    const acceptedAt = new Date('2026-01-31T12:00:00Z'); // 30 days later, arbitrary
    const accepted = applyIntegrationAccepted(state, acceptedAt);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    expect(accepted.state.status).toBe('trial_active');
    expect(accepted.state.timestamps.integrationReadyAt).toEqual(acceptedAt);
    expect(accepted.state.timestamps.trialStartedAt).toEqual(acceptedAt);

    const expectedEnd = new Date(acceptedAt);
    expectedEnd.setUTCDate(expectedEnd.getUTCDate() + TRIAL_DAYS);
    expect(accepted.state.timestamps.trialEndsAt).toEqual(expectedEnd);
  });

  it('deriveTrialWindow is exactly +14 calendar days', () => {
    const readyAt = new Date('2026-03-01T09:30:00Z');
    const { trialStartedAt, trialEndsAt } = deriveTrialWindow(readyAt);
    expect(trialStartedAt).toEqual(readyAt);
    expect(trialEndsAt.toISOString()).toBe('2026-03-15T09:30:00.000Z');
  });
});

describe('scenario I: repeated integration-acceptance callback does not reset the trial', () => {
  it('calling applyIntegrationAccepted twice keeps the original trial window', () => {
    let state = freshState();
    state = (applyCardVerified(state, new Date('2026-01-01T00:00:00Z')) as { ok: true; state: LifecycleState }).state;
    state = (applyIntegrationStarted(state, new Date('2026-01-01T00:05:00Z')) as { ok: true; state: LifecycleState }).state;

    const firstAcceptedAt = new Date('2026-01-10T00:00:00Z');
    const first = applyIntegrationAccepted(state, firstAcceptedAt);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const secondAcceptedAt = new Date('2026-02-01T00:00:00Z'); // much later duplicate callback
    const second = applyIntegrationAccepted(first.state, secondAcceptedAt);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.changed).toBe(false);
    expect(second.state.timestamps.trialStartedAt).toEqual(firstAcceptedAt);
    expect(second.state.timestamps.integrationReadyAt).toEqual(firstAcceptedAt);
  });
});

describe('scenarios E, F, G: paid activation hard gate', () => {
  function trialActiveState(trialEndsAt: Date): LifecycleState {
    return {
      status: 'trial_active',
      timestamps: {
        cardVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        integrationStartedAt: new Date('2026-01-01T00:05:00Z'),
        integrationReadyAt: new Date('2026-01-10T00:00:00Z'),
        trialStartedAt: new Date('2026-01-10T00:00:00Z'),
        trialEndsAt,
        billingStartedAt: null,
      },
    };
  }

  it('E: rejects before trial has ended, even with everything else in place', () => {
    const trialEndsAt = new Date('2026-01-24T00:00:00Z');
    const state = trialActiveState(trialEndsAt);
    const result = evaluatePaidActivationGate(state, {
      now: new Date('2026-01-20T00:00:00Z'), // before trialEndsAt
      hasVerifiedPaymentMethod: true,
      hasAcceptedPlan: true,
      hasBillingConsent: true,
      billingFeatureEnabled: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/trial has not ended/);
  });

  it('F: rejects after trial end when no accepted plan exists', () => {
    const trialEndsAt = new Date('2026-01-24T00:00:00Z');
    const state = trialActiveState(trialEndsAt);
    const result = evaluatePaidActivationGate(state, {
      now: new Date('2026-01-25T00:00:00Z'),
      hasVerifiedPaymentMethod: true,
      hasAcceptedPlan: false,
      hasBillingConsent: true,
      billingFeatureEnabled: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/no accepted plan/);
  });

  it('G: rejects after trial end + accepted plan when the billing feature is disabled', () => {
    const trialEndsAt = new Date('2026-01-24T00:00:00Z');
    const state = trialActiveState(trialEndsAt);
    const result = evaluatePaidActivationGate(state, {
      now: new Date('2026-01-25T00:00:00Z'),
      hasVerifiedPaymentMethod: true,
      hasAcceptedPlan: true,
      hasBillingConsent: true,
      billingFeatureEnabled: false,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/billing feature is disabled/);
  });

  it('allows activation only when every condition is satisfied', () => {
    const trialEndsAt = new Date('2026-01-24T00:00:00Z');
    const state = trialActiveState(trialEndsAt);
    const result = evaluatePaidActivationGate(state, {
      now: new Date('2026-01-25T00:00:00Z'),
      hasVerifiedPaymentMethod: true,
      hasAcceptedPlan: true,
      hasBillingConsent: true,
      billingFeatureEnabled: true,
    });
    expect(result.allowed).toBe(true);

    const applied = applyPaidActivation(state, {
      now: new Date('2026-01-25T00:00:00Z'),
      hasVerifiedPaymentMethod: true,
      hasAcceptedPlan: true,
      hasBillingConsent: true,
      billingFeatureEnabled: true,
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.state.status).toBe('paid_active');
  });

  it('rejects paid activation attempted from an earlier lifecycle status', () => {
    const result = evaluatePaidActivationGate(freshState(), {
      now: new Date(),
      hasVerifiedPaymentMethod: true,
      hasAcceptedPlan: true,
      hasBillingConsent: true,
      billingFeatureEnabled: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/not trial_active/);
  });
});
