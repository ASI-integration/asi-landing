/**
 * Durable idempotency / deduplication store.
 *
 * Requirements:
 * - Stable keying (provider message id, channel + external id, hash fallback)
 * - Must survive process restarts on the VPS (TimeWeb)
 * - Safe in tests (in-memory; no filesystem access)
 *
 * Backing store:
 * - Production: append-only JSONL file + in-memory index (best-effort)
 * - Tests: in-memory Map only
 *
 * NOTE: This is intentionally lightweight and pragmatic (no Redis dependency).
 */

import * as fs from 'fs';
import * as path from 'path';

const TTL_MS = Number(process.env.COMM_IDEMPOTENCY_TTL_MS ?? 24 * 60 * 60 * 1000); // default 24h
const MAX_INDEX_SIZE = Number(process.env.COMM_IDEMPOTENCY_MAX_KEYS ?? 50_000);

type Scope = 'inbound' | 'outbound' | 'action';

interface Entry {
  k: string;
  scope: Scope;
  ts: number; // epoch ms
  meta?: Record<string, unknown>;
}

const isTest = process.env.NODE_ENV === 'test';
const BASE_DIR =
  process.env.COMM_STATE_DIR ??
  process.env.CONVERSATION_SESSION_DIR ??
  process.env.SESSION_STORE_DIR ??
  '/tmp';
const FILE_PATH = path.join(BASE_DIR, 'asi-comm-idempotency.jsonl');

// Process-local index; persisted via JSONL so it can be rebuilt on start.
const index = new Map<string, Entry>();
let loadedFromDisk = false;

function nowMs(): number {
  return Date.now();
}

function sweep(): void {
  const cutoff = nowMs() - TTL_MS;
  for (const [k, e] of index.entries()) {
    if (e.ts < cutoff) index.delete(k);
  }
  // Cap worst-case memory growth. Prefer dropping oldest.
  if (index.size > MAX_INDEX_SIZE) {
    const entries = Array.from(index.entries()).sort((a, b) => a[1].ts - b[1].ts);
    const toDrop = entries.slice(0, Math.max(0, index.size - MAX_INDEX_SIZE));
    for (const [k] of toDrop) index.delete(k);
  }
}

function safeMkdirp(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort
  }
}

function loadOnce(): void {
  if (isTest || loadedFromDisk) return;
  loadedFromDisk = true;
  safeMkdirp(BASE_DIR);
  try {
    if (!fs.existsSync(FILE_PATH)) return;
    const raw = fs.readFileSync(FILE_PATH, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as Entry;
        if (!e?.k || !e?.scope || typeof e.ts !== 'number') continue;
        index.set(`${e.scope}:${e.k}`, e);
      } catch {
        // skip malformed line
      }
    }
  } catch {
    // best-effort
  }
  sweep();
}

function appendToDisk(e: Entry): void {
  if (isTest) return;
  safeMkdirp(BASE_DIR);
  try {
    fs.appendFileSync(FILE_PATH, JSON.stringify(e) + '\n', 'utf-8');
  } catch {
    // best-effort
  }
}

/**
 * Returns true if key was already seen for scope; otherwise records and returns false.
 */
export function checkAndMarkKey(params: {
  scope: Scope;
  key: string;
  meta?: Record<string, unknown>;
}): boolean {
  loadOnce();
  sweep();
  const idxKey = `${params.scope}:${params.key}`;
  if (index.has(idxKey)) return true;
  const e: Entry = { scope: params.scope, k: params.key, ts: nowMs(), meta: params.meta };
  index.set(idxKey, e);
  appendToDisk(e);
  return false;
}

export function isDuplicateKey(scope: Scope, key: string): boolean {
  loadOnce();
  sweep();
  return index.has(`${scope}:${key}`);
}

/** Reset the store — for testing only. */
export function _resetForTesting(): void {
  index.clear();
  loadedFromDisk = false;
}

/** Current store size — for testing/observability only. */
export function _storeSize(): number {
  return index.size;
}
