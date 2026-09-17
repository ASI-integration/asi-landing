/**
 * Dedicated Stripe client for the Guest Autopilot (international) onboarding
 * card-capture flow. Intentionally separate from src/lib/payments/stripe.ts
 * (the existing operational_payments / Telegram-pilot Checkout Session
 * flow) and from asi-global.ru's YooKassa merchant config — a missing or
 * misconfigured key here must never fall back to either of those.
 *
 * Fail-closed by construction: this module refuses to initialize with
 * anything that isn't an explicit Stripe *test* secret key. There is no
 * live-mode code path in this file. Flipping to production Stripe requires
 * a deliberate, separate change once the merchant/legal entity, pricing,
 * and production credentials are approved — not a config toggle here.
 */
import Stripe from 'stripe';

const TEST_KEY_PREFIX = 'sk_test_';

export function resolveGuestAutopilotStripeSecretKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const key = env.GUEST_AUTOPILOT_STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!key.startsWith(TEST_KEY_PREFIX)) {
    console.error(
      '[billing/stripe-client] Refusing to initialize with a non-test Stripe secret key ' +
        '(GUEST_AUTOPILOT_STRIPE_SECRET_KEY must start with "sk_test_"). Onboarding billing remains disabled.',
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
  return env.GUEST_AUTOPILOT_STRIPE_WEBHOOK_SECRET || null;
}

/** Test-only seam; pass undefined to restore environment-based resolution. */
export function _resetGuestAutopilotStripeClientForTesting(): void {
  cachedClient = undefined;
}
