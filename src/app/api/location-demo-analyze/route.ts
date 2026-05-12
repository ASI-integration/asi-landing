import { NextRequest, NextResponse } from 'next/server';
import {
  fetchOsmData,
  buildAnalysis,
  applyLocationDataIntegrityGate,
  cacheEntryPassesDataIntegrity,
  cloneAnalysisForResidentialDemoPatch,
  applyResidentialDemoPresentationToAnalysis,
  attachLocationDecisionToAnalysis,
} from '@/lib/location';
import type { OSMElement } from '@/lib/location';
import { patchLegacyLocationAnalysis } from '@/lib/location/foot-traffic';
import { cacheGet, cacheSet, cacheEvictCoord } from '@/lib/location/cache';
import {
  isKorzunDiagnosticCoords,
  logKorzunPipelineDiagnostics,
} from '@/lib/location/korzun-pipeline-diagnostics';
import type { AnalysisMeta } from '@/lib/location/types';
import type { GeocodeResult } from '@/lib/location/providers/types';

export const dynamic = 'force-dynamic';
/** Allow slow Overpass batches on Vercel (default is often 10s). */
export const maxDuration = 60;

function parseOptionalInputAddress(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t || undefined;
}

/** Accepts structured forward-geocode payload from the client (same shape as {@link GeocodeResult}). */
function parseOptionalGeocodeResult(v: unknown): GeocodeResult | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.lat !== 'number' || typeof o.lon !== 'number') return undefined;
  if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) return undefined;
  const s = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);
  return {
    lat: o.lat,
    lon: o.lon,
    displayName: s(o.displayName),
    locality: s(o.locality),
    settlement: s(o.settlement),
    municipality: s(o.municipality),
    adminArea1: s(o.adminArea1),
    adminArea2: s(o.adminArea2),
  };
}

function sourceLabel(usedFallback: boolean | undefined): string {
  return usedFallback ? 'osm-overpass+fallback' : 'osm-overpass';
}

function mergeAnalysisIntegrityWarnings(
  meta: AnalysisMeta,
  analysis: Awaited<ReturnType<typeof buildAnalysis>>,
  locale: 'en' | 'ru',
): void {
  const reasons = analysis.analysisIntegrity?.reasons;
  if (!reasons?.length) return;
  const seen = new Set((meta.warnings ?? []).map(w => w.code));
  const extra: NonNullable<AnalysisMeta['warnings']> = [];
  const catalog: Record<string, { en: string; ru: string }> = {
    osm_empty_result: {
      en: 'OpenStreetMap returned no nearby objects for this point.',
      ru: 'OpenStreetMap не вернул объектов рядом с этой точкой.',
    },
    osm_sparse_result: {
      en: 'Urban map coverage looks too sparse to score this location reliably.',
      ru: 'Покрытие карты в городской зоне слишком бедное для уверенной оценки.',
    },
    analysis_incomplete: {
      en: 'The preview could not be completed with available map data.',
      ru: 'Предпросмотр не удалось завершить по доступным данным карты.',
    },
    score_blocked_due_to_incomplete_data: {
      en: 'Headline score withheld because map signals were incomplete.',
      ru: 'Итоговый индекс скрыт: данные карты были неполными.',
    },
  };
  for (const code of reasons) {
    if (seen.has(code as NonNullable<AnalysisMeta['warnings']>[number]['code'])) continue;
    const row = catalog[code];
    if (!row) continue;
    seen.add(code as NonNullable<AnalysisMeta['warnings']>[number]['code']);
    extra.push({
      code: code as NonNullable<AnalysisMeta['warnings']>[number]['code'],
      message: locale === 'ru' ? row.ru : row.en,
    });
  }
  meta.warnings = [...(meta.warnings ?? []), ...extra];
}

function attachIntegrityMeta(meta: AnalysisMeta, analysis: Awaited<ReturnType<typeof buildAnalysis>>): void {
  meta.analysisIncomplete = !!analysis.analysisIntegrity?.analysisIncomplete;
  meta.scoreBlockedDueToIncompleteData = !!analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData;
}

function buildWarnings(args: {
  elementsCount: number;
  usedFallbackQuery?: boolean;
  hadProviderFailure?: boolean;
  locale: 'en' | 'ru';
}): NonNullable<AnalysisMeta['warnings']> {
  const { elementsCount, usedFallbackQuery, hadProviderFailure, locale } = args;
  const warnings: NonNullable<AnalysisMeta['warnings']> = [];

  const preliminaryMsg =
    locale === 'ru'
      ? 'Часть картографических данных не успела загрузиться. Это предварительная оценка.'
      : 'Some map data did not load in time. This is a preliminary estimate.';

  if (hadProviderFailure) {
    if (elementsCount > 0) {
      warnings.push({ code: 'partial_result', message: preliminaryMsg });
    } else {
      warnings.push({
        code: 'overpass_timeout',
        message: preliminaryMsg,
      });
    }
  } else if (usedFallbackQuery) {
    warnings.push({ code: 'partial_result', message: preliminaryMsg });
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
  lat: number;
  lon: number;
  osmElements?: readonly OSMElement[];
  inputAddress?: string;
  geocodeResult?: GeocodeResult;
}) {
  const { analysis, elementsCount, meta, locale, wantSpatial, lat, lon, osmElements, inputAddress, geocodeResult } =
    args;
  const blocked = !!analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData;

  let analysisOut = analysis;
  let demoSanity: ReturnType<typeof applyResidentialDemoPresentationToAnalysis> = null;
  if (locale === 'ru' && !wantSpatial && !blocked) {
    analysisOut = cloneAnalysisForResidentialDemoPatch(analysis);
    demoSanity = applyResidentialDemoPresentationToAnalysis(analysisOut);
  }

  const analysisWithKernel = attachLocationDecisionToAnalysis(analysisOut, {
    inputAddress: (inputAddress ?? '').trim(),
    coordinates: { lat, lon },
    rawElements: osmElements,
    locale,
    ...(geocodeResult ? { geocodeResult } : {}),
  });

  const metaWithDemo = demoSanity ? { ...meta, demoSanity } : meta;
  return {
    analysis: analysisWithKernel,
    elementsCount,
    meta: metaWithDemo,
    ...(demoSanity ? {
      demoSanity,
      displayAudience: demoSanity.displayAudience,
      displayAudienceLabelRu: demoSanity.audienceLabelRu,
      displayVerdictLabelRu: demoSanity.verdictLabelRu,
    } : {}),
  };
}

/** Fetch live data, run scoring, store in cache. Never throws — logs instead. */
async function fetchAndCache(lat: number, lon: number): Promise<void> {
  try {
    const { elements, usedFallbackQuery, hadProviderFailure } = await fetchOsmData(lat, lon);
    const analysis = buildAnalysis(elements, lat, lon, { spatialFoundation: false });
    applyLocationDataIntegrityGate(analysis, {
      lat,
      lon,
      rawObjectsCount: elements.length,
      hadProviderFailure,
      usedFallbackQuery,
      cacheServed: false,
    });
    if (analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData) return;
    await cacheSet(lat, lon, analysis, sourceLabel(usedFallbackQuery), elements.length);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[location-demo-analyze] background_refresh_failed lat=${lat} lon=${lon}: ${message}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      lat?: unknown;
      lon?: unknown;
      spatialFoundation?: unknown;
      locale?: unknown;
      inputAddress?: unknown;
      geocodeResult?: unknown;
    };
    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lon = typeof body.lon === 'number' ? body.lon : null;
    const wantSpatial = body.spatialFoundation === true;
    const locale: 'en' | 'ru' = body.locale === 'en' ? 'en' : 'ru';
    const inputAddress = parseOptionalInputAddress(body.inputAddress);
    const geocodeResult = parseOptionalGeocodeResult(body.geocodeResult);

    if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: 'lat/lon required' }, { status: 400 });
    }

    // ── Cache check (residential / default pipeline only) ─────────────────────
    // Commercial spatial variant mutates magnet scores — never read/write the shared coord cache row.
    let cached = wantSpatial ? null : await cacheGet(lat, lon);

    if (cached) {
      const probeLat = cached.entry.lat ?? lat;
      const probeLon = cached.entry.lon ?? lon;
      const patchedProbe = patchLegacyLocationAnalysis({
        ...cached.entry.analysis,
        accessibilityStops: cached.entry.analysis.accessibilityStops ?? [],
      });
      if (
        !cacheEntryPassesDataIntegrity({
          elementsCount: cached.entry.elementsCount,
          lat: probeLat,
          lon: probeLon,
          analysis: patchedProbe,
        })
      ) {
        await cacheEvictCoord(lat, lon);
        cached = null;
      }
    }

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

      const ca = patchLegacyLocationAnalysis({
        ...cached.entry.analysis,
        accessibilityStops: cached.entry.analysis.accessibilityStops ?? [],
      });
      const usedFb = cached.entry.source.includes('fallback');
      applyLocationDataIntegrityGate(ca, {
        lat,
        lon,
        rawObjectsCount: cached.entry.elementsCount,
        hadProviderFailure: false,
        usedFallbackQuery: usedFb,
        cacheServed: true,
      });
      mergeAnalysisIntegrityWarnings(meta, ca, locale);
      attachIntegrityMeta(meta, ca);

      if (isKorzunDiagnosticCoords(lat, lon)) {
        logKorzunPipelineDiagnostics({
          lat,
          lon,
          elementsCount: cached.entry.elementsCount,
          analysis: ca,
          cached: true,
        });
      }
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
        analysis: ca,
        elementsCount: cached.entry.elementsCount,
        meta,
        locale,
        wantSpatial,
        lat,
        lon,
        inputAddress,
        geocodeResult,
      }));
    }

    // ── Cache miss: live fetch ─────────────────────────────────────────────────
    const { elements, hadProviderFailure, usedFallbackQuery } = await fetchOsmData(lat, lon);
    const analysis = buildAnalysis(elements, lat, lon, { spatialFoundation: wantSpatial });
    applyLocationDataIntegrityGate(analysis, {
      lat,
      lon,
      rawObjectsCount: elements.length,
      hadProviderFailure,
      usedFallbackQuery,
      cacheServed: false,
    });
    if (isKorzunDiagnosticCoords(lat, lon)) {
      logKorzunPipelineDiagnostics({
        lat,
        lon,
        elementsCount: elements.length,
        elements,
        analysis,
        cached: false,
      });
    }
    const src = sourceLabel(usedFallbackQuery);
    if (!wantSpatial && !analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData) {
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
    mergeAnalysisIntegrityWarnings(meta, analysis, locale);
    attachIntegrityMeta(meta, analysis);

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
      lat,
      lon,
      osmElements: elements,
      inputAddress,
      geocodeResult,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[location-demo-analyze] failed: ${message}`);
    return NextResponse.json({ error: 'analysis_failed' }, { status: 502 });
  }
}
