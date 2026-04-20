import { NextRequest, NextResponse } from 'next/server';
import { fetchOsmData, buildAnalysis } from '@/lib/location';
import { cacheGet, cacheSet } from '@/lib/location/cache';
import type { AnalysisMeta } from '@/lib/location/types';

export const dynamic = 'force-dynamic';
/** Allow slow Overpass batches on Vercel (default is often 10s). */
export const maxDuration = 60;

function sourceLabel(usedFallback: boolean | undefined): string {
  return usedFallback ? 'osm-overpass+fallback' : 'osm-overpass';
}

/** Fetch live data, run scoring, store in cache. Never throws — logs instead. */
async function fetchAndCache(lat: number, lon: number): Promise<void> {
  try {
    const { elements, usedFallbackQuery } = await fetchOsmData(lat, lon);
    const analysis = buildAnalysis(elements, lat, lon, { spatialFoundation: false });
    await cacheSet(lat, lon, analysis, sourceLabel(usedFallbackQuery), elements.length);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[location-demo-analyze] background_refresh_failed lat=${lat} lon=${lon}: ${message}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { lat?: unknown; lon?: unknown; spatialFoundation?: unknown };
    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lon = typeof body.lon === 'number' ? body.lon : null;
    const wantSpatial = body.spatialFoundation === true;

    if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: 'lat/lon required' }, { status: 400 });
    }

    // ── Cache check (residential / default pipeline only) ─────────────────────
    // Commercial spatial variant mutates magnet scores — never read/write the shared coord cache row.
    const cached = wantSpatial ? null : await cacheGet(lat, lon);

    if (cached) {
      const meta: AnalysisMeta = {
        freshness: cached.freshness,
        updatedAt: new Date(cached.entry.updatedAt).toISOString(),
        source: cached.entry.source,
        cached: true,
        ...(cached.freshness === 'stale' ? { refreshing: true } : {}),
      };

      // Return cached result immediately — no "Нет данных" when data exists.
      // If stale, kick off a background refresh (fire-and-forget).
      if (cached.freshness === 'stale') {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        fetchAndCache(lat, lon);
      }

      const ca = cached.entry.analysis;
      console.info(
        `[location-demo-analyze] result ` +
        `lat=${lat} lon=${lon} ` +
        `elements=${cached.entry.elementsCount} ` +
        `magnets=${ca.magnets.length} ` +
        `competitors=${ca.competitors.length} ` +
        `evergreenIndex=${ca.evergreenIndex} ` +
        `scoreBand=${ca.scoreBand} ` +
        `locationScore=${ca.locationScore?.location_score ?? 'n/a'} ` +
        `recommendedStrategy=${ca.locationScore?.recommended_strategy ?? 'n/a'} ` +
        `demandType=${ca.demandType} ` +
        `audience=${ca.audienceAnalysis?.primaryAudience ?? 'n/a'} ` +
        `audienceFallback=${ca.audienceAnalysis?.fallbackMode ?? false} ` +
        `audienceFit=${ca.audienceAnalysis?.audienceFitScore ?? 'n/a'} ` +
        `clusterDetected=${ca.gravityExplanation.clusterDetected} ` +
        `competitorPressure=${ca.gravityExplanation.competitorPressureLevel} ` +
        `usedFallbackQuery=${!!meta.usedFallbackQuery} ` +
        `spatialFoundation=false ` +
        `cached=true freshness=${cached.freshness}`,
      );

      return NextResponse.json({
        analysis: cached.entry.analysis,
        elementsCount: cached.entry.elementsCount,
        meta,
      });
    }

    // ── Cache miss: live fetch ─────────────────────────────────────────────────
    const { elements, hadProviderFailure, usedFallbackQuery } = await fetchOsmData(lat, lon);
    const analysis = buildAnalysis(elements, lat, lon, { spatialFoundation: wantSpatial });
    const src = sourceLabel(usedFallbackQuery);
    if (!wantSpatial) {
      await cacheSet(lat, lon, analysis, src, elements.length);
    }

    if (usedFallbackQuery) {
      console.warn(`[location-demo-analyze] magnet_provider used_fallback_query count=${elements.length}`);
    }
    if (elements.length === 0) {
      console.warn(
        `[location-demo-analyze] magnet_provider status=${hadProviderFailure ? 'unavailable' : 'empty_area'} lat=${lat} lon=${lon}`,
      );
    }

    const meta: AnalysisMeta = {
      freshness: 'fresh',
      updatedAt: new Date().toISOString(),
      source: src,
      cached: false,
      ...(usedFallbackQuery ? { usedFallbackQuery: true } : {}),
    };

    // ── Structured diagnostics — always logged; helps detect silent regressions ──
    console.info(
      `[location-demo-analyze] result ` +
      `lat=${lat} lon=${lon} ` +
      `elements=${elements.length} ` +
      `magnets=${analysis.magnets.length} ` +
      `competitors=${analysis.competitors.length} ` +
      `evergreenIndex=${analysis.evergreenIndex} ` +
      `scoreBand=${analysis.scoreBand} ` +
      `locationScore=${analysis.locationScore?.location_score ?? 'n/a'} ` +
      `recommendedStrategy=${analysis.locationScore?.recommended_strategy ?? 'n/a'} ` +
      `demandType=${analysis.demandType} ` +
      `audience=${analysis.audienceAnalysis?.primaryAudience ?? 'n/a'} ` +
      `audienceFallback=${analysis.audienceAnalysis?.fallbackMode ?? false} ` +
      `audienceFit=${analysis.audienceAnalysis?.audienceFitScore ?? 'n/a'} ` +
      `clusterDetected=${analysis.gravityExplanation.clusterDetected} ` +
      `competitorPressure=${analysis.gravityExplanation.competitorPressureLevel} ` +
        `usedFallbackQuery=${!!usedFallbackQuery} ` +
        `spatialFoundation=${wantSpatial} ` +
        `cached=false`,
    );

    return NextResponse.json({
      analysis,
      elementsCount: elements.length,
      meta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[location-demo-analyze] failed: ${message}`);
    return NextResponse.json({ error: 'analysis_failed' }, { status: 502 });
  }
}
