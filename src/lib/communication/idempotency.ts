/**
 * Idempotency / duplicate update guard for Telegram updates.
 *
 * Two-layer design:
 *   L1 — in-memory Map (fast, synchronous, 24h TTL).  Handles the common case
 *        within a single process lifetime (including serverless warm invocations).
 *   L2 — Supabase tg_processed_updates table (durable, cross-restart).  Checked
 *        asynchronously when L1 misses; written on first-ever processing.
 *
 * DDL (run once in Supabase):
 *   CREATE TABLE tg_processed_updates (
 *     update_id    BIGINT PRIMARY KEY,
 *     processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *
 * Graceful degradation: if Supabase is unavailable, falls back to L1-only
 * behaviour (same as before this change) and never throws.
 */

import { supabase } from '@/lib/supabase';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface Entry {
  processedAt: number;
}

// Module-level singleton — shared across requests in the same process.
const store = new Map<number, Entry>();

/**
 * Synchronous L1 check-and-mark.
 * Returns true if update_id was already seen in this process.
 */
export function checkAndMark(updateId: number): boolean {
  sweep();
  if (store.has(updateId)) return true;
  store.set(updateId, { processedAt: Date.now() });
  return false;
}

/**
 * Async L2 check: query Supabase for cross-restart duplicate detection.
 * Call this BEFORE checkAndMark when L1 returns false (i.e. first time seen
 * in this process).  Returns true if the update was already processed in a
 * previous process instance.
 *
 * On success also populates L1 so subsequent calls within the same process
 * are handled synchronously.
 */
export async function checkDurableDuplicate(updateId: number): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('tg_processed_updates')
      .select('update_id')
      .eq('update_id', updateId)
      .maybeSingle();

    if (error || !data) return false;

    // Warm up L1 so we don't hit Supabase again within this process
    store.set(updateId, { processedAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Write the update_id to the durable store (fire-and-forget).
 * Call after checkAndMark returns false and processing starts.
 */
export function markDurable(updateId: number): void {
  supabase
    .from('tg_processed_updates')
    .insert({ update_id: updateId, processed_at: new Date().toISOString() })
    .then(({ error }) => {
      if (error && error.code !== '23505') {
        // 23505 = unique_violation — harmless race, another instance got there first
        console.warn(`[Idempotency] Supabase write failed for update_id=${updateId}: ${error.message}`);
      }
    });
}

/** Returns true if the update_id was already processed (without marking it). */
export function isDuplicate(updateId: number): boolean {
  return store.has(updateId);
}

/** Evict entries older than TTL_MS. Called lazily on each checkAndMark. */
function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, entry] of Array.from(store.entries())) {
    if (entry.processedAt < cutoff) store.delete(id);
  }
}

/** Reset the store — for testing only. */
export function _resetForTesting(): void {
  store.clear();
}

/** Current store size — for testing/observability only. */
export function _storeSize(): number {
  return store.size;
}
