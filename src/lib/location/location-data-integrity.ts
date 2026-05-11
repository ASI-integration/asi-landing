/**
 * OSM / Overpass data integrity — distinguishes “weak real location” from
 * “analysis incomplete due to missing or broken map data”.
 *
 * Does not change gravity weights; only gates presentation + cache eligibility.
 */

import type { AnalysisIntegritySnapshot, LocationAnalysis } from './types';
import type { LocationScoringIntegritySnapshot, LocationScoringTrace } from './location-scoring-trace';

/** Russian copy for free/demo UI when analysis cannot be scored reliably */
export const LOCATION_DEMO_INCOMPLETE_RU =
  'Не удалось получить достаточно данных по карте. Попробуйте повторить анализ или запросить полный отчёт.';

export const LOCATION_DEMO_INCOMPLETE_EN =
  'We could not retrieve enough map data for this location. Please try the analysis again or request a full report.';

export type LocationDataIntegrityWarningCode =
  | 'osm_provider_unavailable'
  | 'osm_empty_result'
  | 'osm_sparse_result'
  | 'analysis_incomplete'
  | 'score_blocked_due_to_incomplete_data';

export interface LocationDataIntegrityInput {
  lat: number;
  lon: number;
  rawObjectsCount: number;
  hadProviderFailure: boolean;
  usedFallbackQuery?: boolean;
  classifiedMagnetCount: number;
}

export interface LocationDataIntegrityResult {
  analysisComplete: boolean;
  scoreBlockedDueToIncompleteData: boolean;
  warningCodes: LocationDataIntegrityWarningCode[];
}

/** Conservative urban bounding boxes — used only to flag “0 magnets” as suspicious */
const URBAN_BBOS: ReadonlyArray<{ minLat: number; maxLat: number; minLon: number; maxLon: number }> = [
  { minLat: 55.5, maxLat: 55.95, minLon: 37.3, maxLon: 37.9 },
  { minLat: 59.78, maxLat: 60.12, minLon: 29.9, maxLon: 30.65 },
  { minLat: 55.72, maxLat: 55.88, minLon: 48.96, maxLon: 49.22 },
  { minLat: 56.75, maxLat: 56.96, minLon: 60.45, maxLon: 60.65 },
  { minLat: 54.9, maxLat: 55.12, minLon: 82.85, maxLon: 83.12 },
  { minLat: 56.25, maxLat: 56.4, minLon: 43.85, maxLon: 44.12 },
  { minLat: 53.15, maxLat: 53.3, minLon: 50.08, maxLon: 50.38 },
  { minLat: 47.18, maxLat: 47.32, minLon: 39.65, maxLon: 39.95 },
  { minLat: 44.98, maxLat: 45.12, minLon: 38.88, maxLon: 39.12 },
  { minLat: 51.28, maxLat: 51.72, minLon: -0.55, maxLon: 0.35 },
  { minLat: 40.48, maxLat: 40.92, minLon: -74.28, maxLon: -73.68 },
];

export function isLikelyUrbanCoordinates(lat: number, lon: number): boolean {
  return URBAN_BBOS.some(
    b => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon,
  );
}

const URBAN_SPARSE_RAW_THRESHOLD = 28;

export function evaluateLocationDataIntegrity(input: LocationDataIntegrityInput): LocationDataIntegrityResult {
  const {
    lat,
    lon,
    rawObjectsCount,
    hadProviderFailure,
    usedFallbackQuery,
    classifiedMagnetCount,
  } = input;

  const urban = isLikelyUrbanCoordinates(lat, lon);
  const codes = new Set<LocationDataIntegrityWarningCode>();

  let incomplete = false;

  if (rawObjectsCount === 0) {
    incomplete = true;
    codes.add('osm_empty_result');
    codes.add('analysis_incomplete');
    if (hadProviderFailure) codes.add('osm_provider_unavailable');
  }

  if (hadProviderFailure && classifiedMagnetCount === 0) {
    incomplete = true;
    codes.add('osm_provider_unavailable');
    codes.add('analysis_incomplete');
  }

  /**
   * Dense-city safeguard: very few raw objects and zero scoring magnets usually means a broken/partial fetch,
   * not a meaningful “weak location”. Wider urban pulls with zero magnets may still be scored (noisy OSM).
   */
  if (
    urban &&
    classifiedMagnetCount === 0 &&
    rawObjectsCount > 0 &&
    (rawObjectsCount < URBAN_SPARSE_RAW_THRESHOLD ||
      hadProviderFailure ||
      usedFallbackQuery)
  ) {
    incomplete = true;
    codes.add('osm_sparse_result');
    codes.add('analysis_incomplete');
    if (hadProviderFailure) codes.add('osm_provider_unavailable');
  }

  const scoreBlocked = incomplete;
  if (scoreBlocked) {
    codes.add('score_blocked_due_to_incomplete_data');
  }

  return {
    analysisComplete: !incomplete,
    scoreBlockedDueToIncompleteData: scoreBlocked,
    warningCodes: [...codes],
  };
}

function mergeTraceWarnings(trace: LocationScoringTrace, codes: Iterable<string>): void {
  trace.warnings = [...new Set([...trace.warnings, ...codes])];
}

/**
 * Mutates `analysis` when integrity fails: neutral headline indices, empty factor lists,
 * and trace integrity snapshot. Safe no-op when analysis is complete.
 */
export function applyLocationDataIntegrityGate(
  analysis: LocationAnalysis,
  args: {
    lat: number;
    lon: number;
    rawObjectsCount: number;
    hadProviderFailure: boolean;
    usedFallbackQuery?: boolean;
    classifiedMagnetCount?: number;
    cacheServed?: boolean;
  },
): LocationAnalysis {
  const classifiedMagnetCount =
    args.classifiedMagnetCount ??
    analysis.scoringTrace?.classifiedMagnets.length ??
    analysis.magnets.length;

  const evaluated = evaluateLocationDataIntegrity({
    lat: args.lat,
    lon: args.lon,
    rawObjectsCount: args.rawObjectsCount,
    hadProviderFailure: args.hadProviderFailure,
    usedFallbackQuery: args.usedFallbackQuery,
    classifiedMagnetCount,
  });

  const snapshot: AnalysisIntegritySnapshot = {
    analysisIncomplete: !evaluated.analysisComplete,
    scoreBlockedDueToIncompleteData: evaluated.scoreBlockedDueToIncompleteData,
    reasons: [...evaluated.warningCodes],
  };
  analysis.analysisIntegrity = snapshot;

  if (analysis.scoringTrace) {
    mergeTraceWarnings(analysis.scoringTrace, evaluated.warningCodes);
    const integrity: LocationScoringIntegritySnapshot = {
      analysisComplete: evaluated.analysisComplete,
      scoreBlockedDueToIncompleteData: evaluated.scoreBlockedDueToIncompleteData,
      rawObjectsCount: args.rawObjectsCount,
      classifiedMagnetsCount: classifiedMagnetCount,
      providerHadFailure: args.hadProviderFailure,
      cacheServed: args.cacheServed,
    };
    analysis.scoringTrace.integrity = integrity;
  }

  if (evaluated.analysisComplete || !evaluated.scoreBlockedDueToIncompleteData) {
    return analysis;
  }

  analysis.evergreenIndex = 0;
  analysis.scoreBand = 'none';
  if (analysis.locationScore) {
    analysis.locationScore = {
      ...analysis.locationScore,
      location_score: 0,
      rating: 'risky',
      top_positive_factors: [],
      top_negative_factors: [],
    };
  }
  analysis.conclusion = '';

  if (analysis.scoringTrace) {
    analysis.scoringTrace.finalScore = 0;
  }

  return analysis;
}

export interface CacheEntryIntegrityProbe {
  elementsCount: number;
  lat?: number;
  lon?: number;
  analysis: LocationAnalysis;
}

/**
 * Legacy rows with empty OSM snapshots or blocked integrity must not be served as “good weak” demos.
 */
export function cacheEntryPassesDataIntegrity(entry: CacheEntryIntegrityProbe): boolean {
  const lat = entry.lat ?? entry.analysis.scoringTrace?.coordinates.lat;
  const lon = entry.lon ?? entry.analysis.scoringTrace?.coordinates.lon;

  if (entry.analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData) return false;

  if (entry.elementsCount === 0) return false;

  if (lat == null || lon == null) return entry.elementsCount > 0;

  const magnetCount =
    entry.analysis.scoringTrace?.classifiedMagnets?.length ?? entry.analysis.magnets?.length ?? 0;

  if (isLikelyUrbanCoordinates(lat, lon) && magnetCount === 0) return false;

  return true;
}

export function locationDemoPresentationBlocked(analysis: LocationAnalysis): boolean {
  return !!analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData;
}

export function locationDemoIncompleteUserMessage(locale: 'en' | 'ru'): string {
  return locale === 'ru' ? LOCATION_DEMO_INCOMPLETE_RU : LOCATION_DEMO_INCOMPLETE_EN;
}
