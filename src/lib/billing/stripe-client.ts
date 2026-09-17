/**
 * Dedicated Stripe client for the Guest Autopilot (international) onboarding
 * card-capture flow. Intentionally separate from src/lib/payments/stripe.ts
 * (the existing operational_payments / Telegram-pilot Checkout Session
 * flow) and from asi-global.ru's YooKassa merchant config — a missing or
 * misconfigured key here must never fall back to either of those.
 *
 * Fail-closed by construction, with TWO independent gates that must both
 * pass — a single "not live mode" boolean is not enough on its own, since
 * that still trusts whatever secret key happens to be configured:
 *
 *   1. STRIPE_ONBOARDING_ENABLED must be the literal string 'true'.
 *   2. STRIPE_ONBOARDING_SECRET_KEY must be present AND start with
 *      "sk_test_". A live key (sk_live_...), a malformed value, or a
 *      missing key is refused outright — never used, never a fallback.
 *
 * There is no live-mode code path in this file. Flipping to production
 * Stripe requires a deliberate, separate change once the merchant/legal
 * entity, pricing, and production credentials are approved — not a config
 * toggle here.
 */
import Stripe from 'stripe';

const TEST_KEY_PREFIX = 'sk_test_';

function isOnboardingEnabledFlag(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.STRIPE_ONBOARDING_ENABLED === 'true';
}

export function resolveGuestAutopilotStripeSecretKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  if (!isOnboardingEnabledFlag(env)) {
    // Gate 1 failed — refuse regardless of what key is configured.
    return null;
  }
  const key = env.STRIPE_ONBOARDING_SECRET_KEY;
  if (!key) return null;
  if (!key.startsWith(TEST_KEY_PREFIX)) {
    console.error(
      '[billing/stripe-client] Refusing to initialize with a non-test Stripe secret key ' +
        '(STRIPE_ONBOARDING_SECRET_KEY must start with "sk_test_"). Onboarding billing remains disabled.',
    );
    return null;
  }
  return key;
}

let cachedClient: Stripe | null | undefined;

/** Returns null (feature unavailable) rather than throwing when unconfigured. */
export function getGuestAutopilotStripeClient(): Stripe | null {
  if (cachedClient !== undefined) return cachedClient;
  const key = resolveGuestAutopilotStripeSecretKey();
  cachedClient = key ? new Stripe(key) : null;
  return cachedClient;
}

export function isGuestAutopilotStripeConfigured(): boolean {
  return getGuestAutopilotStripeClient() !== null;
}

export function resolveGuestAutopilotStripeWebhookSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  if (!isOnboardingEnabledFlag(env)) return null;
  return env.STRIPE_ONBOARDING_WEBHOOK_SECRET || null;
}

/** Test-only seam; pass undefined to restore environment-based resolution. */
export function _resetGuestAutopilotStripeClientForTesting(): void {
  cachedClient = undefined;
}
