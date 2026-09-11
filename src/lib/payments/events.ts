/**
 * Payment idempotency event logs.
 *
 * Two independent stores:
 *   - webhookLog   — prevents processing the same provider webhook event twice
 *   - confirmationLog — prevents sending duplicate paid confirmations to a guest
 *
 * Supabase `payment_event_dedup` is the durable authority when configured. The
 * in-memory indexes remain a fast path and a dependency-free test/local fallback.
 */

import { getPaymentsSupabase } from './supabase';

/** key: `webhook:${provider}:${eventId}` → timestamp of first receipt */
const webhookLog = new Map<string, number>();

/** key: internal payment ID */
const confirmationLog = new Set<string>();

// ─── Webhook dedup ────────────────────────────────────────────────────────────

function webhookKey(provider: string, eventId: string): string {
  return `webhook:${provider}:${eventId}`;
}

export function hasWebhookBeenProcessed(provider: string, eventId: string): boolean {
  return webhookLog.has(webhookKey(provider, eventId));
}

export function markWebhookProcessed(provider: string, eventId: string): void {
  webhookLog.set(webhookKey(provider, eventId), Date.now());
}

// ─── Confirmation dedup ───────────────────────────────────────────────────────

export function hasConfirmationBeenSent(paymentId: string): boolean {
  return confirmationLog.has(paymentId);
}

export function markConfirmationSent(paymentId: string): void {
  confirmationLog.add(paymentId);
}

type DurableClaim =
  | { kind: 'webhook'; key: string; provider: string; eventId: string; paymentId: null }
  | { kind: 'confirmation'; key: string; provider: null; eventId: null; paymentId: string };

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

async function claimDurably(claim: DurableClaim): Promise<boolean> {
  const alreadyClaimed = claim.kind === 'webhook'
    ? webhookLog.has(claim.key)
    : confirmationLog.has(claim.paymentId);
  if (alreadyClaimed) return false;

  const sb = getPaymentsSupabase();
  if (sb) {
    const { error } = await sb.from('payment_event_dedup').insert({
      dedupe_key: claim.key,
      kind: claim.kind,
      provider: claim.provider,
      event_id: claim.eventId,
      payment_id: claim.paymentId,
      created_at: new Date().toISOString(),
    });
    if (isUniqueViolation(error)) {
      if (claim.kind === 'webhook') webhookLog.set(claim.key, Date.now());
      else confirmationLog.add(claim.paymentId);
      return false;
    }
    if (error) throw new Error(`Payment dedupe persistence failed: ${error.message}`);
  }

  if (claim.kind === 'webhook') webhookLog.set(claim.key, Date.now());
  else confirmationLog.add(claim.paymentId);
  return true;
}

async function releaseDurableClaim(claim: DurableClaim): Promise<void> {
  if (claim.kind === 'webhook') webhookLog.delete(claim.key);
  else confirmationLog.delete(claim.paymentId);

  const sb = getPaymentsSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from('payment_event_dedup').delete().eq('dedupe_key', claim.key);
    if (error) console.error('[payments/events] Failed to release payment dedupe claim', error);
  } catch (error) {
    console.error('[payments/events] Failed to release payment dedupe claim', error);
  }
}

export async function claimWebhookEvent(provider: string, eventId: string): Promise<boolean> {
  return claimDurably({
    kind: 'webhook',
    key: webhookKey(provider, eventId),
    provider,
    eventId,
    paymentId: null,
  });
}

export async function releaseWebhookEvent(provider: string, eventId: string): Promise<void> {
  return releaseDurableClaim({
    kind: 'webhook',
    key: webhookKey(provider, eventId),
    provider,
    eventId,
    paymentId: null,
  });
}

export async function claimPaymentConfirmation(paymentId: string): Promise<boolean> {
  return claimDurably({
    kind: 'confirmation',
    key: `confirmation:${paymentId}`,
    provider: null,
    eventId: null,
    paymentId,
  });
}

export async function releasePaymentConfirmation(paymentId: string): Promise<void> {
  return releaseDurableClaim({
    kind: 'confirmation',
    key: `confirmation:${paymentId}`,
    provider: null,
    eventId: null,
    paymentId,
  });
}

// ─── Testing helpers ──────────────────────────────────────────────────────────

/** Reset all event logs — for testing only. */
export function _resetEventLogs(): void {
  webhookLog.clear();
  confirmationLog.clear();
}
