import { NextRequest, NextResponse } from 'next/server';
import { fetchOsmData, buildAnalysis, applyResidentialDemoSanity } from '@/lib/location';
import { cacheGet, cacheSet } from '@/lib/location/cache';
import type { AnalysisMeta } from '@/lib/location/types';

export const dynamic = 'force-dynamic';
/** Allow slow Overpass batches on Vercel (default is often 10s). */
export const maxDuration = 60;

function sourceLabel(usedFallback: boolean | undefined): string {
  return usedFallback ? 'osm-overpass+fallback' : 'osm-overpass';
}

function buildWarnings(args: {
  elementsCount: number;
  usedFallbackQuery?: boolean;
  hadProviderFailure?: boolean;
  locale: 'en' | 'ru';
}): NonNullable<AnalysisMeta['warnings']> {
  const { elementsCount, usedFallbackQuery, hadProviderFailure, locale } = args;
  const warnings: NonNullable<AnalysisMeta['warnings']> = [];

  if (hadProviderFailure) {
    warnings.push({
      code: 'osm_provider_unavailable',
      message: locale === 'ru'
        ? 'Источник карт временно недоступен: часть сигналов может отсутствовать.'
        : 'Map provider temporarily unavailable: some signals may be missing.',
    });
  }
  if (usedFallbackQuery) {
    warnings.push({
      code: 'osm_fallback_query',
      message: locale === 'ru'
        ? 'Часть запросов к карте выполнена в упрощённом режиме — детализация может быть ниже.'
        : 'Some map queries ran in simplified mode — detail may be lower.',
    });
  }

  // Heuristic "sparse" threshold: low object density means weaker confidence in magnets/competitors.
  if (elementsCount < 60) {
    warnings.push({
      code: 'osm_sparse',
      message: locale === 'ru'
        ? 'Мало объектов в OpenStreetMap рядом с адресом — выводы менее надёжны.'
        : 'Sparse OpenStreetMap coverage near this address — results are less reliable.',
    });
  }

  return warnings;
}

function confidenceFromSignals(args: {
  elementsCount: number;
  usedFallbackQuery?: boolean;
  hadProviderFailure?: boolean;
}): NonNullable<AnalysisMeta['confidence']> {
  const { elementsCount, usedFallbackQuery, hadProviderFailure } = args;
  if (hadProviderFailure) return 'low';
  if (elementsCount < 60) return 'low';
  if (usedFallbackQuery || elementsCount < 140) return 'medium';
  return 'high';
}

function withDemoSanityPayload(args: {
  analysis: Awaited<ReturnType<typeof buildAnalysis>>;
  elementsCount: number;
  meta: AnalysisMeta;
  locale: 'en' | 'ru';
  wantSpatial: boolean;
}) {
  const { analysis, elementsCount, meta, locale, wantSpatial } = args;
  const demoSanity = locale === 'ru' && !wantSpatial
    ? applyResidentialDemoSanity(analysis)
    : null;
  const metaWithDemo = demoSanity ? { ...meta, demoSanity } : meta;
  return {
    analysis,
    elementsCount,
    meta: metaWithDemo,
    ...(demoSanity ? {
      demoSanity,
      displayScore: demoSanity.displayScore,
      displayAudience: demoSanity.displayAudience,
      displayAudienceLabelRu: demoSanity.audienceLabelRu,
      displayVerdictLabelRu: demoSanity.verdictLabelRu,
    } : {}),
  };
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
    const body = await req.json() as { lat?: unknown; lon?: unknown; spatialFoundation?: unknown; locale?: unknown };
    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lon = typeof body.lon === 'number' ? body.lon : null;
    const wantSpatial = body.spatialFoundation === true;
    const locale: 'en' | 'ru' = body.locale === 'en' ? 'en' : 'ru';

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
      meta.warnings = buildWarnings({
        elementsCount: cached.entry.elementsCount,
        usedFallbackQuery: meta.usedFallbackQuery,
        locale,
      });
      meta.confidence = confidenceFromSignals({
        elementsCount: cached.entry.elementsCount,
        usedFallbackQuery: meta.usedFallbackQuery,
      });

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

      return NextResponse.json(withDemoSanityPayload({
        analysis: cached.entry.analysis,
        elementsCount: cached.entry.elementsCount,
        meta,
        locale,
        wantSpatial,
      }));
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
    meta.warnings = buildWarnings({
      elementsCount: elements.length,
      usedFallbackQuery,
      hadProviderFailure,
      locale,
    });
    meta.confidence = confidenceFromSignals({
      elementsCount: elements.length,
      usedFallbackQuery,
      hadProviderFailure,
    });

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

    return NextResponse.json(withDemoSanityPayload({
      analysis,
      elementsCount: elements.length,
      meta,
      locale,
      wantSpatial,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[location-demo-analyze] failed: ${message}`);
    return NextResponse.json({ error: 'analysis_failed' }, { status: 502 });
  }
}
