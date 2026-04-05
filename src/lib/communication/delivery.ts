/**
 * Reliable Delivery Layer
 *
 * Wraps any channel adapter's sendMessage() with:
 *   1. Exponential-backoff retry (transient errors)
 *   2. Error classification (transient vs. permanent)
 *   3. Dead-Letter Queue (DLQ) — failed messages stored in Supabase `comm_dlq`
 *   4. Per-conversation rate limiting (token bucket — in-memory)
 *
 * Architecture:
 *   - Retry and DLQ logic are transparent to callers.
 *   - The DLQ table enables operator visibility and manual replay.
 *   - Rate limiting is per conversationId (or chatId as fallback).
 *
 * DB table required: comm_dlq (see migration)
 */

import { randomUUID } from 'crypto';
import { supabase } from '@/lib/supabase';
import { DeliveryResult } from './types';

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS       = 3;
const BASE_DELAY_MS      = 500;  // 500ms, 1s, 2s
const RATE_LIMIT_WINDOW  = 60_000;  // 1 minute
const RATE_LIMIT_MAX_MSG = 10;       // max messages per conversation per window

// ─── Rate Limiting (Token Bucket) ────────────────────────────────────────────

interface RateBucket {
  count: number;
  windowStart: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function isRateLimited(conversationKey: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(conversationKey);

  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW) {
    rateBuckets.set(conversationKey, { count: 1, windowStart: now });
    return false;
  }

  if (bucket.count >= RATE_LIMIT_MAX_MSG) {
    console.warn(`[Delivery] Rate limit hit for ${conversationKey}`);
    return true;
  }

  bucket.count += 1;
  return false;
}

// ─── Error Classification ─────────────────────────────────────────────────────

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  // Network timeouts, 429, 503, 502 are transient
  return (
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('network') ||
    msg.includes('socket hang up')
  );
}

// ─── DLQ ──────────────────────────────────────────────────────────────────────

async function sendToDLQ(params: {
  conversationKey: string;
  targetId: string;
  message: string;
  error: string;
  attempts: number;
}): Promise<void> {
  try {
    await supabase.from('comm_dlq').insert({
      id:               randomUUID(),
      conversation_key: params.conversationKey,
      target_id:        params.targetId,
      message_text:     params.message.slice(0, 2000),
      error_detail:     params.error.slice(0, 500),
      attempts:         params.attempts,
      status:           'failed',
      created_at:       new Date().toISOString(),
    });
  } catch (dlqErr) {
    // DLQ itself failed — log to console as last resort
    console.error('[Delivery] DLQ insert failed:', dlqErr, 'Original error:', params.error);
  }
}

/**
 * Replay a DLQ entry by its ID.
 * Marks the entry as 'replayed' on success, 're_failed' on failure.
 */
export async function replayDLQEntry(
  dlqId: string,
  sendFn: (targetId: string, message: string) => Promise<boolean>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('comm_dlq')
    .select('*')
    .eq('id', dlqId)
    .single();

  if (error || !data) {
    console.warn(`[Delivery] DLQ entry ${dlqId} not found`);
    return false;
  }

  const sent = await sendFn(data.target_id, data.message_text);

  await supabase
    .from('comm_dlq')
    .update({
      status:      sent ? 'replayed' : 're_failed',
      updated_at:  new Date().toISOString(),
    })
    .eq('id', dlqId);

  return sent;
}

// ─── Core: sendWithRetry ──────────────────────────────────────────────────────

/**
 * Send a message via the provided sendFn with automatic retry + DLQ.
 *
 * @param conversationKey  Unique key for rate limiting (e.g. `telegram:12345`)
 * @param targetId         Provider-specific target (chatId string, email, phone)
 * @param message          The text to send
 * @param sendFn           Provider adapter's sendMessage — returns true on success
 */
export async function sendWithRetry(
  conversationKey: string,
  targetId: string,
  message: string,
  sendFn: (targetId: string, message: string) => Promise<boolean>,
): Promise<DeliveryResult> {
  // Rate limit check
  if (isRateLimited(conversationKey)) {
    const errMsg = 'rate_limit_exceeded';
    await sendToDLQ({ conversationKey, targetId, message, error: errMsg, attempts: 0 });
    return { sent: false, attempts: 0, error: errMsg };
  }

  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const ok = await sendFn(targetId, message);
      if (ok) {
        return { sent: true, attempts: attempt };
      }
      lastError = 'send_returned_false';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      // Permanent error — no point retrying
      if (!isTransient(err)) {
        console.error(`[Delivery] Permanent error on attempt ${attempt}:`, lastError);
        break;
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delayMs);
    }
  }

  // All attempts exhausted — push to DLQ
  await sendToDLQ({
    conversationKey,
    targetId,
    message,
    error: lastError,
    attempts: MAX_ATTEMPTS,
  });

  return { sent: false, attempts: MAX_ATTEMPTS, error: lastError };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
