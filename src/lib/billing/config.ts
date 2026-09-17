/**
 * Guest Autopilot (international) billing feature gate.
 *
 * `INTERNATIONAL_BILLING_ENABLED` defaults OFF. Until the owner explicitly
 * sets it to 'true' (which requires an approved merchant/legal entity,
 * finalized pricing, and production Stripe config), paid activation is
 * impossible regardless of lifecycle state — see
 * lifecycle.ts#evaluatePaidActivationGate. This is a server-side-only check;
 * it must never be read from a client-submitted value.
 */
export function isInternationalBillingEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.INTERNATIONAL_BILLING_ENABLED === 'true';
}
