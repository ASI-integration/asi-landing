/**
 * Idempotency / duplicate update guard for Telegram updates.
 *
 * Uses an in-memory Map keyed by `update_id`. Entries expire after TTL_MS
 * (default 24 h) to prevent unbounded growth.
 *
 * Limitation: this store is process-local. On cold-start / server restart it
 * resets, so an update arriving just after a restart could be processed twice.
 * For production hardening replace the backing store with Redis or a Supabase
 * dedup table — the interface is designed to make that swap trivial.
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface Entry {
  processedAt: number;
}

// Module-level singleton — shared across requests in the same process.
const store = new Map<number, Entry>();

/** Returns true if this update_id has already been seen (and records it if not). */
export function checkAndMark(updateId: number): boolean {
  sweep();
  if (store.has(updateId)) return true;
  store.set(updateId, { processedAt: Date.now() });
  return false;
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
