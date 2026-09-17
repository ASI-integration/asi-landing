import { describe, it, expect } from 'vitest';
import { resolveGuestAutopilotStripeSecretKey } from '../stripe-client';

describe('resolveGuestAutopilotStripeSecretKey — fail-closed test-mode enforcement', () => {
  it('returns null when unset (feature unavailable, not a fallback)', () => {
    expect(resolveGuestAutopilotStripeSecretKey({})).toBeNull();
  });

  it('accepts a Stripe test secret key', () => {
    expect(resolveGuestAutopilotStripeSecretKey({ GUEST_AUTOPILOT_STRIPE_SECRET_KEY: 'sk_test_abc123' })).toBe(
      'sk_test_abc123',
    );
  });

  it('refuses a live Stripe secret key outright', () => {
    expect(resolveGuestAutopilotStripeSecretKey({ GUEST_AUTOPILOT_STRIPE_SECRET_KEY: 'sk_live_abc123' })).toBeNull();
  });

  it('refuses a malformed/placeholder value', () => {
    expect(resolveGuestAutopilotStripeSecretKey({ GUEST_AUTOPILOT_STRIPE_SECRET_KEY: 'not-a-real-key' })).toBeNull();
  });

  it('never falls back to the unrelated operational-payments Stripe key', () => {
    // Scenario J guard: even if the existing ops-payments Stripe key is
    // configured (STRIPE_SECRET_KEY), this module must not read it.
    const env = { STRIPE_SECRET_KEY: 'sk_live_unrelated_ops_key' };
    expect(resolveGuestAutopilotStripeSecretKey(env)).toBeNull();
  });
});
