// ── Location analysis in-memory cache ─────────────────────────────────────────
// Keys: rounded coordinates (4 decimal places ≈ 11 m precision) + optional address.
// For production replace the Map with Redis/Upstash — the interface stays the same.

import type { LocationAnalysis, AnalysisFreshness } from './types';

/** 10 minutes: results within this window are considered fresh */
const FRESH_TTL_MS = 10 * 60 * 1000;
/** 24 hours: entries older than this are evicted on read */
const MAX_STALE_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  analysis: LocationAnalysis;
  /** Unix ms timestamp of the last successful live fetch */
  updatedAt: number;
  source: string;
  elementsCount: number;
}

export interface CacheResult {
  entry: CacheEntry;
  freshness: AnalysisFreshness;
}

// Primary store: "lat4,lon4" → entry
const coordStore = new Map<string, CacheEntry>();
// Secondary index: normalised address string → coord key
const addressIndex = new Map<string, string>();

function makeCoordKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readEntry(key: string): CacheResult | null {
  const entry = coordStore.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.updatedAt;
  if (age > MAX_STALE_MS) {
    coordStore.delete(key);
    return null;
  }
  const freshness: AnalysisFreshness = age < FRESH_TTL_MS ? 'fresh' : 'stale';
  return { entry, freshness };
}

/** Look up by coordinates. Returns null on miss or expired entry. */
export function cacheGet(lat: number, lon: number): CacheResult | null {
  return readEntry(makeCoordKey(lat, lon));
}

/** Look up by normalized address string. Returns null on miss. */
export function cacheGetByAddress(address: string): CacheResult | null {
  const key = addressIndex.get(normalizeAddress(address));
  if (!key) return null;
  const result = readEntry(key);
  if (!result) {
    addressIndex.delete(normalizeAddress(address));
  }
  return result;
}

/** Store a live-fetched result. Pass address to also index by address. */
export function cacheSet(
  lat: number,
  lon: number,
  analysis: LocationAnalysis,
  source: string,
  elementsCount: number,
  address?: string,
): void {
  const key = makeCoordKey(lat, lon);
  coordStore.set(key, { analysis, updatedAt: Date.now(), source, elementsCount });
  if (address) {
    addressIndex.set(normalizeAddress(address), key);
  }
}

/** Evict all entries older than MAX_STALE_MS. Call periodically if needed. */
export function cachePurgeExpired(): void {
  const now = Date.now();
  for (const [key, entry] of coordStore) {
    if (now - entry.updatedAt > MAX_STALE_MS) coordStore.delete(key);
  }
  for (const [addr, key] of addressIndex) {
    if (!coordStore.has(key)) addressIndex.delete(addr);
  }
}
