/**
 * POST /api/location-analyze
 *
 * Accepts: { address: string; lat?: number | null; lon?: number | null }
 * Returns: LocationAnalysisResult with score, band, metrics, audienceScores
 *
 * Cache strategy (Supabase-backed, shared across all serverless instances):
 *   1. Normalise address → address_key (trimmed, lowercased)
 *   2. Check location_analysis_cache in Supabase — if hit and < 24 h old → return
 *   3. Compute deterministic score locally (pure function, no external calls)
 *   4. Upsert result into cache (ON CONFLICT update hit_count)
 *
 * This replaces any per-serverless-instance in-memory caching and survives
 * cold starts across the entire deployment.
 *
 * Observability: every cache miss and hit logs a structured line to stdout
 * so Vercel log drains can track DaDat avoidance rate and hit ratio.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { analyzeAddress } from '@/lib/location/scoring';
import type { Metric, AudienceScore } from '@/lib/location/scoring';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

interface CacheRow {
  score:        number;
  band:         string;
  metrics_json: Metric[];
  audience_json: AudienceScore[];
  cached_at:    string;
  hit_count:    number;
}

export async function POST(req: NextRequest) {
  let address: string;
  let lat: number | null = null;
  let lon: number | null = null;

  try {
    const body = await req.json() as { address?: unknown; lat?: unknown; lon?: unknown };
    if (typeof body.address !== 'string' || !body.address.trim()) {
      return NextResponse.json({ error: 'address required' }, { status: 400 });
    }
    address = body.address.trim();
    if (typeof body.lat === 'number') lat = body.lat;
    if (typeof body.lon === 'number') lon = body.lon;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const addressKey = address.toLowerCase().replace(/\s+/g, ' ');

  // ── 1. Cache lookup ───────────────────────────────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('location_analysis_cache')
      .select('score, band, metrics_json, audience_json, cached_at, hit_count')
      .eq('address_key', addressKey)
      .maybeSingle();

    if (cached) {
      const row = cached as CacheRow;
      const age = Date.now() - new Date(row.cached_at).getTime();
      if (age < CACHE_TTL_MS) {
        console.log(`[location-analyze] cache_hit address="${addressKey}" age_s=${Math.round(age / 1000)} hits=${row.hit_count}`);

        // Bump hit counter best-effort
        supabase
          .from('location_analysis_cache')
          .update({ hit_count: row.hit_count + 1 })
          .eq('address_key', addressKey)
          .then(() => {/* ignore */});

        return NextResponse.json({
          source:       'cache',
          address,
          lat,
          lon,
          score:        row.score,
          band:         row.band,
          metrics:      row.metrics_json,
          audienceScores: row.audience_json,
        });
      }
      console.log(`[location-analyze] cache_stale address="${addressKey}" age_s=${Math.round(age / 1000)}`);
    }
  } catch (err) {
    // Supabase unavailable — fall through to compute
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[location-analyze] cache_lookup_error: ${msg}`);
  }

  // ── 2. Compute ────────────────────────────────────────────────────────────
  console.log(`[location-analyze] cache_miss address="${addressKey}" — computing`);
  const result = analyzeAddress(address);

  // ── 3. Store in cache (upsert on address_key) ─────────────────────────────
  supabase
    .from('location_analysis_cache')
    .upsert(
      {
        address_key:   addressKey,
        address_raw:   address,
        lat,
        lon,
        score:         result.score,
        band:          result.band.labelEn,
        metrics_json:  result.metrics,
        audience_json: result.audienceScores,
        cached_at:     new Date().toISOString(),
        hit_count:     1,
      },
      { onConflict: 'address_key', ignoreDuplicates: false },
    )
    .then(({ error }) => {
      if (error) {
        console.warn(`[location-analyze] cache_write_error: ${error.message}`);
      }
    });

  return NextResponse.json({
    source: 'computed',
    address,
    lat,
    lon,
    ...result,
    band: result.band.labelEn,
    bandLabel: result.band.label,
  });
}
