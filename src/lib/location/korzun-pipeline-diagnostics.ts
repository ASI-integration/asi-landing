/**
 * Temporary diagnostics for ул. Солдата Корзуна, 12к (Saint Petersburg) —
 * traces strategic transport + specialized medical through the live pipeline.
 */

import type { LocationAnalysis, OSMElement } from './types';

/** Regression fixture centre (~ Корзун 12к) */
export const KORZUN_DIAGNOSTIC_LAT = 59.8369;
export const KORZUN_DIAGNOSTIC_LON = 30.3178;

const COORD_EPS = 0.004;

export function isKorzunDiagnosticCoords(lat: number, lon: number): boolean {
  return (
    Math.abs(lat - KORZUN_DIAGNOSTIC_LAT) <= COORD_EPS &&
    Math.abs(lon - KORZUN_DIAGNOSTIC_LON) <= COORD_EPS
  );
}

/** Korzun regression diagnostics (`console.info` / soft `console.warn`). Off unless explicitly enabled. */
export function isLocationKorzunDiagnosticsEnabled(): boolean {
  return process.env.LOCATION_KORZUN_DIAGNOSTICS_ENABLED === 'true';
}

function tagsSignal(tags: Record<string, string> | undefined): string {
  const t = tags ?? {};
  if (t.aeroway === 'aerodrome') return 'raw:aerodrome';
  if (t.landuse === 'harbour' || t['harbour'] === 'yes') return 'raw:harbour/port_landuse';
  if (t.waterway === 'dock') return 'raw:dock';
  if (t.industrial === 'port') return 'raw:industrial_port';
  if (t.amenity === 'ferry_terminal') return 'raw:ferry_terminal';
  if (t.amenity === 'hospital' || t.healthcare === 'hospital') return 'raw:hospital';
  if (t.healthcare === 'surgery') return 'raw:healthcare_surgery';
  if (t.amenity === 'dentist') return 'raw:dentist';
  return '';
}

/** Raw OSM elements relevant to strategic transport / specialized medical (best-effort tag scan). */
export function korzunRawCandidateSignals(elements: OSMElement[]): string[] {
  const out: string[] = [];
  for (const el of elements) {
    const sig = tagsSignal(el.tags);
    if (sig) out.push(sig);
  }
  return [...new Set(out)].sort();
}

export function logKorzunPipelineDiagnostics(args: {
  lat: number;
  lon: number;
  elementsCount: number;
  elements?: OSMElement[];
  analysis: LocationAnalysis;
  cached: boolean;
}): void {
  if (!isLocationKorzunDiagnosticsEnabled()) return;

  const { lat, lon, elementsCount, elements, analysis, cached } = args;
  const diag = analysis.magnetDiagnostics;
  const classified = diag?.classifiedCandidates ?? [];

  // Pre-buildAnalysis classification: hubs start as airport / railway_station / metro, then remap.
  const classifiedAirport = classified.filter(c => c.classifiedCategoryId === 'airport');
  const classifiedRailBus = classified.filter(
    c => c.classifiedCategoryId === 'railway_station' || c.classifiedCategoryId === 'metro',
  );
  const classifiedMedical = classified.filter(
    c =>
      c.classifiedCategoryId === 'specializedMedicalAnchor' ||
      c.classifiedCategoryId === 'hospital',
  );

  const rawAirportPortHospital =
    elements != null
      ? {
          rawSignalsPresent: korzunRawCandidateSignals(elements),
          aerodromeCount: elements.filter(e => e.tags?.aeroway === 'aerodrome').length,
          harbourishCount: elements.filter(e =>
            e.tags?.landuse === 'harbour' ||
            e.tags?.waterway === 'dock' ||
            e.tags?.industrial === 'port' ||
            e.tags?.amenity === 'ferry_terminal' ||
            e.tags?.harbour === 'yes',
          ).length,
          hospitalishCount: elements.filter(e =>
            e.tags?.amenity === 'hospital' ||
            e.tags?.healthcare === 'hospital' ||
            e.tags?.healthcare === 'surgery',
          ).length,
        }
      : { note: 'no_elements_payload_cached_path' as const };

  const surfaced = analysis.magnets ?? [];
  const surfacedHub = surfaced.filter(m => m.categoryId === 'strategicTransportHub');
  const surfacedMed = surfaced.filter(m => m.categoryId === 'specializedMedicalAnchor');

  const suppressed = diag?.suppressedMagnets ?? [];
  const suppressedRelevant = suppressed.filter(s => {
    const tags = s.tags ?? {};
    if (tags.aeroway === 'aerodrome') return true;
    if (tags.landuse === 'harbour' || tags.waterway === 'dock' || tags.industrial === 'port') return true;
    if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') return true;
    if (tags.healthcare === 'surgery' || tags.amenity === 'dentist') return true;
    if (s.classifiedCategoryId === 'specializedMedicalAnchor') return true;
    if (s.classifiedCategoryId === 'airport' || s.classifiedCategoryId === 'railway_station') return true;
    return false;
  });

  const hubArrayLen =
    (analysis.strategicTransportHubMagnets?.length ?? 0) ||
    surfacedHub.length;

  console.info(
    '[korzun-pipeline-diag]',
    JSON.stringify({
      lat,
      lon,
      cached,
      elementsCount,
      rawAirportPortHospital,
      classifiedCounts: {
        airport_pre_hub: classifiedAirport.length,
        rail_or_metro_pre_hub: classifiedRailBus.length,
        hospital_or_specialized_pre_hub: classifiedMedical.length,
      },
      surfacedCounts: {
        strategicTransportHub: surfacedHub.length,
        specializedMedicalAnchor: surfacedMed.length,
      },
      strategicTransportHubMagnetsArrayLen: hubArrayLen,
      surfacedHubSample: surfacedHub.slice(0, 4).map(m => ({
        subType: m.subType,
        name: m.name,
        distanceM: Math.round(m.distance),
        band: m.strategicReachBand,
      })),
      surfacedMedSample: surfacedMed.slice(0, 4).map(m => ({
        subType: m.subType,
        name: m.name,
        distanceM: Math.round(m.distance),
        band: m.specializedMedicalReachBand,
      })),
      suppressedRelevantSample: suppressedRelevant.slice(0, 12).map(s => ({
        name: s.name,
        reason: s.reason,
        detail: s.detail,
        distanceM: s.distanceM,
        classifiedCategoryId: s.classifiedCategoryId,
      })),
    }),
  );

  // Explicit asserts — surface mismatch quickly in CI / server logs if fixtures regress.
  const rawHasAerodrome =
    elements?.some(e => e.tags?.aeroway === 'aerodrome') ||
    classifiedAirport.length > 0;
  const rawHasHarbourish =
    elements?.some(e =>
      e.tags?.landuse === 'harbour' ||
      e.tags?.waterway === 'dock' ||
      e.tags?.industrial === 'port',
    ) ?? false;

  const missingPulkovo = rawHasAerodrome && surfacedHub.every(m => m.subType !== 'airport');
  const missingPort = rawHasHarbourish && surfacedHub.every(m => m.subType !== 'port' && m.subType !== 'river_port');
  const missingMed =
    (elements?.some(e =>
      e.tags?.amenity === 'hospital' ||
      e.tags?.healthcare === 'hospital' ||
      e.tags?.healthcare === 'surgery',
    ) ??
      false) &&
    surfacedMed.length === 0;

  if (elements != null && elementsCount >= 80 && !cached) {
    if (missingPulkovo) {
      console.warn('[korzun-pipeline-diag] ASSERT_SOFT missing_airport_strategic_hub (dense_osm_expected)');
    }
    if (missingPort) {
      console.warn('[korzun-pipeline-diag] ASSERT_SOFT missing_port_hub (harbour/dock tags vary_by_mapper)');
    }
    if (missingMed) {
      console.warn('[korzun-pipeline-diag] ASSERT_SOFT missing_specialized_medical (may_be_mapper_or_radius)');
    }
  }
}
