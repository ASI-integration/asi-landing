/**
 * In-process idempotency event logs.
 *
 * Two independent stores:
 *   - webhookLog   — prevents processing the same provider webhook event twice
 *   - confirmationLog — prevents sending duplicate paid confirmations to a guest
 *
 * Both are keyed in-memory Maps/Sets. Swap for Redis or a Supabase table in production.
 */

/** key: `${provider}:${eventId}` → timestamp of first receipt */
const webhookLog = new Map<string, number>();

/** key: internal payment ID */
const confirmationLog = new Set<string>();

// ─── Webhook dedup ────────────────────────────────────────────────────────────

export function hasWebhookBeenProcessed(provider: string, eventId: string): boolean {
  return webhookLog.has(`${provider}:${eventId}`);
}

export function markWebhookProcessed(provider: string, eventId: string): void {
  webhookLog.set(`${provider}:${eventId}`, Date.now());
}

// ─── Confirmation dedup ───────────────────────────────────────────────────────

export function hasConfirmationBeenSent(paymentId: string): boolean {
  return confirmationLog.has(paymentId);
}

export function markConfirmationSent(paymentId: string): void {
  confirmationLog.add(paymentId);
}

// ─── Testing helpers ──────────────────────────────────────────────────────────

/** Reset all event logs — for testing only. */
export function _resetEventLogs(): void {
  webhookLog.clear();
  confirmationLog.clear();
}
