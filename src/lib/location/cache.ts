// ── Location analysis persistent cache ────────────────────────────────────────
// Backed by Supabase table `location_analysis_cache`.
// Schema: scripts/migrations/001_location_analysis_cache.sql
//
// Keys:
//   coord_key   — rounded coordinates "lat4,lon4" (≈11 m precision, PRIMARY KEY)
//   address_key — normalised address string (optional secondary lookup)
//
// Freshness windows:
//   FRESH_TTL_MS  — results within this window are served as-is (fresh)
//   MAX_STALE_MS  — rows older than this are evicted on read

import type { LocationAnalysis, AnalysisFreshness } from './types';
import { supabase } from '@/lib/supabase';
import { patchLegacyLocationAnalysis } from './foot-traffic';

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
  /** Resolved coordinates — available when the entry was found by address lookup */
  lat?: number;
  lon?: number;
}

export interface CacheResult {
  entry: CacheEntry;
  freshness: AnalysisFreshness;
}

// ── Row shape as returned by Supabase ────────────────────────────────────────

interface CacheRow {
  coord_key: string;
  lat: number;
  lon: number;
  address_key: string | null;
  analysis: LocationAnalysis;
  elements_count: number;
  source: string;
  updated_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function makeCoordKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowToResult(row: CacheRow): CacheResult | null {
  const updatedAt = new Date(row.updated_at).getTime();
  const age = Date.now() - updatedAt;
  if (age > MAX_STALE_MS) return null;
  const freshness: AnalysisFreshness = age < FRESH_TTL_MS ? 'fresh' : 'stale';
  const analysis = patchLegacyLocationAnalysis({
    ...row.analysis,
    accessibilityStops: row.analysis.accessibilityStops ?? [],
  });
  return {
    entry: {
      analysis,
      updatedAt,
      source: row.source,
      elementsCount: row.elements_count,
      lat: row.lat,
      lon: row.lon,
    },
    freshness,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Look up by coordinates. Returns null on miss or expired entry. */
export async function cacheGet(lat: number, lon: number): Promise<CacheResult | null> {
  try {
    const { data, error } = await supabase
      .from('location_analysis_cache')
      .select('coord_key, lat, lon, address_key, analysis, elements_count, source, updated_at')
      .eq('coord_key', makeCoordKey(lat, lon))
      .maybeSingle<CacheRow>();

    if (error || !data) return null;

    const result = rowToResult(data);
    if (!result) {
      // Evict stale row
      await supabase
        .from('location_analysis_cache')
        .delete()
        .eq('coord_key', data.coord_key);
    }
    return result;
  } catch {
    return null;
  }
}

/** Look up by normalized address string. Returns null on miss. */
export async function cacheGetByAddress(address: string): Promise<CacheResult | null> {
  try {
    const { data, error } = await supabase
      .from('location_analysis_cache')
      .select('coord_key, lat, lon, address_key, analysis, elements_count, source, updated_at')
      .eq('address_key', normalizeAddress(address))
      .maybeSingle<CacheRow>();

    if (error || !data) return null;

    const result = rowToResult(data);
    if (!result) {
      await supabase
        .from('location_analysis_cache')
        .delete()
        .eq('coord_key', data.coord_key);
    }
    return result;
  } catch {
    return null;
  }
}

/** Store a live-fetched result. Pass address to also index by address. */
export async function cacheSet(
  lat: number,
  lon: number,
  analysis: LocationAnalysis,
  source: string,
  elementsCount: number,
  address?: string,
): Promise<void> {
  try {
    await supabase
      .from('location_analysis_cache')
      .upsert(
        {
          coord_key: makeCoordKey(lat, lon),
          lat,
          lon,
          analysis,
          elements_count: elementsCount,
          source,
          updated_at: new Date().toISOString(),
          ...(address != null ? { address_key: normalizeAddress(address) } : {}),
        },
        { onConflict: 'coord_key' },
      );
  } catch {
    // Non-fatal: cache miss is acceptable, scoring still works
  }
}

/** Evict all entries older than MAX_STALE_MS. Safe to call periodically. */
export async function cachePurgeExpired(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - MAX_STALE_MS).toISOString();
    await supabase
      .from('location_analysis_cache')
      .delete()
      .lt('updated_at', cutoff);
  } catch {
    // Best-effort purge — ignore failures
  }
}
