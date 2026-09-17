import { describe, it, expect } from 'vitest';
import { resolveGuestAutopilotStripeSecretKey, resolveGuestAutopilotStripeWebhookSecret } from '../stripe-client';

const ENABLED = { STRIPE_ONBOARDING_ENABLED: 'true' };

describe('resolveGuestAutopilotStripeSecretKey — fail-closed test-mode enforcement', () => {
  it('returns null when unset entirely (feature unavailable, not a fallback)', () => {
    expect(resolveGuestAutopilotStripeSecretKey({})).toBeNull();
  });

  it('scenario P: returns null when the key is missing even if the enabled flag is set', () => {
    expect(resolveGuestAutopilotStripeSecretKey({ STRIPE_ONBOARDING_ENABLED: 'true' })).toBeNull();
  });

  it('scenario P: returns null when a valid test key is set but the enabled flag is missing', () => {
    expect(resolveGuestAutopilotStripeSecretKey({ STRIPE_ONBOARDING_SECRET_KEY: 'sk_test_abc123' })).toBeNull();
  });

  it('scenario P: returns null when the enabled flag is set to something other than the literal "true"', () => {
    expect(
      resolveGuestAutopilotStripeSecretKey({
        STRIPE_ONBOARDING_ENABLED: 'TRUE',
        STRIPE_ONBOARDING_SECRET_KEY: 'sk_test_abc123',
      }),
    ).toBeNull();
    expect(
      resolveGuestAutopilotStripeSecretKey({
        STRIPE_ONBOARDING_ENABLED: '1',
        STRIPE_ONBOARDING_SECRET_KEY: 'sk_test_abc123',
      }),
    ).toBeNull();
  });

  it('accepts a Stripe test secret key when both gates pass', () => {
    expect(
      resolveGuestAutopilotStripeSecretKey({ ...ENABLED, STRIPE_ONBOARDING_SECRET_KEY: 'sk_test_abc123' }),
    ).toBe('sk_test_abc123');
  });

  it('scenario O: refuses a live Stripe secret key outright, even with the flag enabled', () => {
    expect(
      resolveGuestAutopilotStripeSecretKey({ ...ENABLED, STRIPE_ONBOARDING_SECRET_KEY: 'sk_live_abc123' }),
    ).toBeNull();
  });

  it('refuses a malformed/placeholder value', () => {
    expect(
      resolveGuestAutopilotStripeSecretKey({ ...ENABLED, STRIPE_ONBOARDING_SECRET_KEY: 'not-a-real-key' }),
    ).toBeNull();
  });

  it('never falls back to the unrelated operational-payments Stripe key', () => {
    // Even if the existing ops-payments Stripe key (STRIPE_SECRET_KEY) is
    // configured and live, this module must not read it.
    const env = { ...ENABLED, STRIPE_SECRET_KEY: 'sk_live_unrelated_ops_key' };
    expect(resolveGuestAutopilotStripeSecretKey(env)).toBeNull();
  });
});

describe('resolveGuestAutopilotStripeWebhookSecret', () => {
  it('returns null when the enabled flag is off, even if a webhook secret is configured', () => {
    expect(resolveGuestAutopilotStripeWebhookSecret({ STRIPE_ONBOARDING_WEBHOOK_SECRET: 'whsec_abc' })).toBeNull();
  });

  it('returns the configured secret once enabled', () => {
    expect(
      resolveGuestAutopilotStripeWebhookSecret({ ...ENABLED, STRIPE_ONBOARDING_WEBHOOK_SECRET: 'whsec_abc' }),
    ).toBe('whsec_abc');
  });
});
