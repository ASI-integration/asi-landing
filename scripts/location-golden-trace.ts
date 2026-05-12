/**
 * Golden regression trace for {@link LocationPublicSummary} (geocode → Overpass → kernel).
 *
 * Usage (from repo root):
 *   npm run location:golden
 *
 * Live network (Google/Nominatim + Overpass):
 *   PowerShell: $env:LOCATION_GOLDEN_LIVE='1'; npm run location:golden
 *   bash:       LOCATION_GOLDEN_LIVE=1 npm run location:golden
 *
 * Optional tuning:
 *   LOCATION_GOLDEN_GEOCODE_MS (default 30000)
 *   LOCATION_GOLDEN_OVERPASS_MS (default 45000)
 *
 * Live-only alternate case list (same schema as golden-addresses.json; replay unused in live):
 *   LOCATION_GOLDEN_LIVE_CASELIST=tmp/location-golden-live-ru-acceptance.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LocationDecision, LocationPublicSummary } from '../src/lib/location/location-decision-contract';
import type { MagnetItem, OSMElement } from '../src/lib/location/types';
import type { GeocodeResult } from '../src/lib/location/providers/types';
import { geocodePlainAddressForMarket } from '../src/lib/location/address-providers/geocode-pipeline';
import { computeOverpassTimeoutSeconds, fetchOsmData, type OsmFetchResult } from '../src/lib/location/overpass';
import { buildAnalysis } from '../src/lib/location/gravity-scoring';
import { enrichAnalysisWithReportProjection } from '../src/lib/location/location-scoring-projection';
import { buildLocationDecision } from '../src/lib/location/location-decision-kernel';
import type {
  GoldenHarnessCaseDiagnostics,
  GoldenHarnessOverpassDiagnostics,
  LocationDecisionWarningHarness,
} from '../src/lib/location/location-golden-harness-diagnostics';
import {
  buildGoldenHarnessCaseDiagnostics,
  buildLocationDecisionWarningHarness,
} from '../src/lib/location/location-golden-harness-diagnostics';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

export type LocationGoldenHarnessStatus =
  | 'ok'
  | 'geocode_timeout'
  | 'overpass_timeout'
  | 'no_raw_elements'
  | 'partial_result'
  | 'pipeline_error';

interface GoldenCaseFile {
  version: number;
  cases: readonly {
    id: string;
    cityKey: string;
    addressRu: string;
    expectedCity?: string;
    expectedRegion?: string;
    expectedProfileExpectation?: string;
    replay: { lat: number; lon: number; elements: OSMElement[] };
  }[];
}

interface GoldenCaseOutput {
  id: string;
  cityKey: string;
  addressRu: string;
  mode: 'live' | 'fixture';
  status: LocationGoldenHarnessStatus;
  summaryLine: string;
  geocodeWinner: string | null;
  rawElementCount: number;
  hadProviderFailure: boolean;
  usedFallbackQuery: boolean;
  publicSummary: Pick<
    LocationPublicSummary,
    | 'finalScore'
    | 'scoreBand'
    | 'primaryDemandType'
    | 'secondaryDemandTypes'
    | 'headlineRu'
    | 'audienceVerdictRu'
    | 'trace'
    | 'cityScale'
    | 'populationTier'
    | 'marketGravityCoefficient'
    | 'specialMarketFlags'
    | 'scoreCapReason'
  > & {
    publicDriverLinesRu: string[];
    rejectedFromPublicCount: number;
  };
  diagnostics: GoldenHarnessCaseDiagnostics;
  /** Mirrors {@link LocationDecision.warnings} + grouped slices for golden JSON review. */
  locationDecisionWarningHarness: LocationDecisionWarningHarness | null;
  /** Live mode only: Overpass wall-clock vs HTTP timeout vs pipeline stages. */
  overpassHarness: GoldenHarnessOverpassDiagnostics | null;
  errorMessage?: string;
}

function loadFixture(): GoldenCaseFile {
  const p = join(REPO_ROOT, 'src/lib/location/__fixtures__/golden-addresses.json');
  return JSON.parse(readFileSync(p, 'utf8')) as GoldenCaseFile;
}

/** Live-only override: same JSON shape as golden-addresses.json; replay is ignored in live mode. */
function loadBundle(): GoldenCaseFile {
  const live = process.env.LOCATION_GOLDEN_LIVE === '1';
  const rel = process.env.LOCATION_GOLDEN_LIVE_CASELIST?.trim();
  if (live && rel) {
    const p = isAbsolute(rel) ? rel : join(REPO_ROOT, rel);
    return JSON.parse(readFileSync(p, 'utf8')) as GoldenCaseFile;
  }
  return loadFixture();
}

type GoldenTimeout = { readonly __locationGoldenTimeout: true };

function isGoldenTimeout(x: unknown): x is GoldenTimeout {
  return typeof x === 'object' && x !== null && '__locationGoldenTimeout' in x;
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | GoldenTimeout> {
  return Promise.race([
    promise,
    new Promise<GoldenTimeout>(resolve => {
      setTimeout(() => resolve({ __locationGoldenTimeout: true }), ms);
    }),
  ]);
}

function serializePublicSummary(s: LocationPublicSummary): GoldenCaseOutput['publicSummary'] {
  return {
    finalScore: s.finalScore,
    scoreBand: s.scoreBand,
    primaryDemandType: s.primaryDemandType,
    secondaryDemandTypes: [...s.secondaryDemandTypes],
    headlineRu: s.headlineRu,
    audienceVerdictRu: s.audienceVerdictRu,
    trace: s.trace,
    publicDriverLinesRu: s.publicDrivers.map(d => d.textRu),
    cityScale: s.cityScale,
    populationTier: s.populationTier,
    marketGravityCoefficient: s.marketGravityCoefficient,
    specialMarketFlags: [...s.specialMarketFlags],
    scoreCapReason: s.scoreCapReason,
    rejectedFromPublicCount: s.rejectedFromPublic.length,
  };
}

function buildOverpassHarnessDiagnostics(args: {
  harnessWallClockBudgetMs: number;
  perHttpRequestTimeoutMs: number;
  harnessBudgetExceeded: boolean;
  osm: OsmFetchResult;
}): GoldenHarnessOverpassDiagnostics {
  const overpassClauseTimeoutSeconds = computeOverpassTimeoutSeconds(args.perHttpRequestTimeoutMs);
  const denseWouldActivate = args.perHttpRequestTimeoutMs <= 7_000;
  const activationRequires =
    'requestTimeoutMs<=7000 AND allowBroadFallback===false AND allowBackfill===false (fetchOsmData validationTightMode)';

  const el = args.osm.elements.length;
  const partial = args.harnessBudgetExceeded && el > 0;

  let bottleneckSummary =
    'Overpass: batched strict queries (core/full), optional transport backfill, broad radiusScale fallback, then minimal clauses; each batch uses [timeout:n] on the server.';
  if (args.harnessBudgetExceeded && el === 0) {
    bottleneckSummary =
      'Harness wall clock aborted the in-flight fetch before any elements were merged — typical when many batched clauses + endpoint rotation exhaust LOCATION_GOLDEN_OVERPASS_MS, or every endpoint failed within per-HTTP budgets.';
  } else if (args.harnessBudgetExceeded && el > 0) {
    bottleneckSummary =
      'Harness wall clock aborted mid-pipeline; JSON may omit later batches (broad/minimal). Treat demand typing / headline as potentially incomplete.';
  } else if (args.osm.hadProviderFailure && el > 0 && el < 12) {
    bottleneckSummary =
      'Provider failures and/or sparse merge; some selector batches may be missing even though partial elements exist.';
  }

  let suggestedNextFallbackPath =
    'Increase LOCATION_GOLDEN_OVERPASS_MS; retry off-peak; optionally point LOCATION_GOLDEN at disk-backed OSM cache for stable coords.';
  if (args.perHttpRequestTimeoutMs <= 12_000) {
    suggestedNextFallbackPath +=
      ' If keeping tight per-HTTP timeouts, consider raising wall-clock budget first before toggling validation-tight mode.';
  }

  return {
    harnessWallClockBudgetMs: args.harnessWallClockBudgetMs,
    perHttpRequestTimeoutMs: args.perHttpRequestTimeoutMs,
    overpassClauseTimeoutSeconds,
    pipelineSummary:
      'fetchOsmData: strict (core/full) → partial-failure backfill → broad fallback → minimal recovery (see overpass.ts)',
    denseAreaStagedPipelineAvailable: true,
    denseAreaStagedWouldActivateWithTheseOptions: denseWouldActivate,
    denseAreaStagedActivationRequires: activationRequires,
    harnessWallClockBudgetExceeded: args.harnessBudgetExceeded,
    elementCountReturned: el,
    partialElementsCapturedBeforeHarnessCutoff: partial,
    usedFallbackQuery: Boolean(args.osm.usedFallbackQuery),
    hadProviderFailure: Boolean(args.osm.hadProviderFailure),
    bottleneckSummary,
    suggestedNextFallbackPath,
  };
}

function harnessDiag(
  c: GoldenCaseFile['cases'][number],
  args: {
    lat: number | null;
    lon: number | null;
    geocodeDisplayName: string | null;
    geocodeResult?: GeocodeResult | null;
    decision: LocationDecision | null;
    magnets: readonly MagnetItem[];
  },
): GoldenHarnessCaseDiagnostics {
  return buildGoldenHarnessCaseDiagnostics({
    caseId: c.id,
    fixtureMeta: {
      expectedCity: c.expectedCity,
      expectedRegion: c.expectedRegion,
      expectedProfileExpectation: c.expectedProfileExpectation,
    },
    lat: args.lat,
    lon: args.lon,
    geocodeDisplayName: args.geocodeDisplayName,
    geocodeResult: args.geocodeResult,
    addressRu: c.addressRu,
    magnets: args.magnets,
    decision: args.decision,
  });
}

function buildPipeline(args: {
  elements: OSMElement[];
  lat: number;
  lon: number;
  inputAddress: string;
  selectedGeocodeResult?: string | null;
  geocodeResult?: GeocodeResult | null;
}): { publicSummary: LocationPublicSummary; decision: LocationDecision; magnets: readonly MagnetItem[] } {
  const { elements, lat, lon, inputAddress } = args;
  const analysis = buildAnalysis(elements, lat, lon, {
    spatialFoundation: false,
    inputAddress,
  });
  const projected = enrichAnalysisWithReportProjection(analysis, {
    reportMode: 'free',
    rawElements: elements,
  });
  const trace = projected.scoringTrace;
  if (!trace?.coordinates) {
    throw new Error('location_golden: missing scoringTrace.coordinates after projection');
  }
  const decision = buildLocationDecision({
    analysis: projected,
    inputAddress,
    coordinates: trace.coordinates,
    rawElements: elements,
    selectedGeocodeResult: args.selectedGeocodeResult ?? trace.selectedGeocodeResult,
    locale: 'ru',
    geocodeResult: args.geocodeResult,
  });
  const ps = decision.publicSummary;
  if (!ps) {
    throw new Error('location_golden: buildLocationDecision returned null publicSummary');
  }
  return { publicSummary: ps, decision, magnets: projected.magnets };
}

function compactSummaryLine(o: GoldenCaseOutput): string {
  const ps = o.publicSummary;
  const score = ps.finalScore == null || !Number.isFinite(ps.finalScore) ? '—' : String(Math.round(ps.finalScore));
  const driversN = ps.publicDriverLinesRu.length;
  const head = ps.headlineRu.replace(/\s+/g, ' ').slice(0, 72);
  return `${o.id} ${o.status} primary=${ps.primaryDemandType} score=${score} drivers=${driversN} | ${head}`;
}

function classifyAfterFetch(args: {
  elements: OSMElement[];
  hadProviderFailure: boolean;
  usedFallbackQuery: boolean | undefined;
}): LocationGoldenHarnessStatus {
  if (args.elements.length === 0) return 'no_raw_elements';
  if (args.hadProviderFailure || args.usedFallbackQuery) return 'partial_result';
  return 'ok';
}

async function runLiveCase(
  c: GoldenCaseFile['cases'][number],
  geocodeMs: number,
  overpassMs: number,
): Promise<GoldenCaseOutput> {
  const mode = 'live' as const;
  let geocodeWinner: string | null = null;
  let hadProviderFailure = false;
  let usedFallbackQuery = false;
  let rawElementCount = 0;

  try {
    const geoResult = await raceWithTimeout(geocodePlainAddressForMarket('ru', c.addressRu), geocodeMs);

    if (isGoldenTimeout(geoResult)) {
      return {
        id: c.id,
        cityKey: c.cityKey,
        addressRu: c.addressRu,
        mode,
        status: 'geocode_timeout',
        summaryLine: '',
        geocodeWinner: null,
        rawElementCount: 0,
        hadProviderFailure: false,
        usedFallbackQuery: false,
        publicSummary: emptySummaryPlaceholder(),
        diagnostics: harnessDiag(c, {
          lat: null,
          lon: null,
          geocodeDisplayName: null,
          decision: null,
          magnets: [],
        }),
        locationDecisionWarningHarness: null,
        overpassHarness: null,
        errorMessage: `geocode exceeded ${geocodeMs}ms`,
      };
    }

    const geo = geoResult;
    geocodeWinner = geo.winner;
    const lat = geo.result?.lat;
    const lon = geo.result?.lon;
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      return {
        id: c.id,
        cityKey: c.cityKey,
        addressRu: c.addressRu,
        mode,
        status: 'pipeline_error',
        summaryLine: '',
        geocodeWinner: geo.winner,
        rawElementCount: 0,
        hadProviderFailure: false,
        usedFallbackQuery: false,
        publicSummary: emptySummaryPlaceholder(),
        diagnostics: harnessDiag(c, {
          lat: null,
          lon: null,
          geocodeDisplayName: geo.result?.displayName ?? null,
          geocodeResult: geo.result ?? null,
          decision: null,
          magnets: [],
        }),
        locationDecisionWarningHarness: null,
        overpassHarness: null,
        errorMessage: 'geocode returned no coordinates',
      };
    }

    const perHttp = Math.min(20_000, overpassMs);
    const overpassController = new AbortController();
    const overpassTimer = setTimeout(() => overpassController.abort(), overpassMs);
    let osm: OsmFetchResult;
    try {
      osm = await fetchOsmData(lat, lon, {
        requestTimeoutMs: perHttp,
        signal: overpassController.signal,
      });
    } finally {
      clearTimeout(overpassTimer);
    }
    const harnessBudgetExceeded = overpassController.signal.aborted;
    const overpassHarness = buildOverpassHarnessDiagnostics({
      harnessWallClockBudgetMs: overpassMs,
      perHttpRequestTimeoutMs: perHttp,
      harnessBudgetExceeded,
      osm,
    });

    rawElementCount = osm.elements.length;
    hadProviderFailure = Boolean(osm.hadProviderFailure);
    usedFallbackQuery = Boolean(osm.usedFallbackQuery);

    let status: LocationGoldenHarnessStatus;
    if (harnessBudgetExceeded && osm.elements.length === 0) {
      status = 'overpass_timeout';
    } else if (harnessBudgetExceeded && osm.elements.length > 0) {
      status = 'partial_result';
    } else {
      status = classifyAfterFetch({
        elements: osm.elements,
        hadProviderFailure,
        usedFallbackQuery: osm.usedFallbackQuery,
      });
    }

    if (status === 'overpass_timeout') {
      return {
        id: c.id,
        cityKey: c.cityKey,
        addressRu: c.addressRu,
        mode,
        status: 'overpass_timeout',
        summaryLine: '',
        geocodeWinner,
        rawElementCount: 0,
        hadProviderFailure,
        usedFallbackQuery,
        publicSummary: emptySummaryPlaceholder(),
        diagnostics: harnessDiag(c, {
          lat,
          lon,
          geocodeDisplayName: geo.result?.displayName ?? null,
          geocodeResult: geo.result ?? null,
          decision: null,
          magnets: [],
        }),
        locationDecisionWarningHarness: null,
        overpassHarness,
        errorMessage: `overpass harness wall clock exceeded ${overpassMs}ms with zero merged elements`,
      };
    }

    if (status === 'no_raw_elements') {
      return {
        id: c.id,
        cityKey: c.cityKey,
        addressRu: c.addressRu,
        mode,
        status: 'no_raw_elements',
        summaryLine: '',
        geocodeWinner,
        rawElementCount: 0,
        hadProviderFailure,
        usedFallbackQuery,
        publicSummary: emptySummaryPlaceholder(),
        diagnostics: harnessDiag(c, {
          lat,
          lon,
          geocodeDisplayName: geo.result?.displayName ?? null,
          geocodeResult: geo.result ?? null,
          decision: null,
          magnets: [],
        }),
        locationDecisionWarningHarness: null,
        overpassHarness,
      };
    }

    const displayName = geo.result?.displayName ?? null;
    const { publicSummary: ps, decision, magnets } = buildPipeline({
      elements: osm.elements,
      lat,
      lon,
      inputAddress: c.addressRu,
      selectedGeocodeResult: displayName,
      geocodeResult: geo.result ?? null,
    });

    const out: GoldenCaseOutput = {
      id: c.id,
      cityKey: c.cityKey,
      addressRu: c.addressRu,
      mode,
      status,
      summaryLine: '',
      geocodeWinner,
      rawElementCount,
      hadProviderFailure,
      usedFallbackQuery,
      publicSummary: serializePublicSummary(ps),
      diagnostics: harnessDiag(c, {
        lat,
        lon,
        geocodeDisplayName: displayName,
        geocodeResult: geo.result ?? null,
        decision,
        magnets,
      }),
      locationDecisionWarningHarness: buildLocationDecisionWarningHarness(decision),
      overpassHarness,
    };
    if (harnessBudgetExceeded) {
      out.errorMessage = `overpass harness wall clock exceeded ${overpassMs}ms with partial merged OSM (${rawElementCount} objects)`;
    }
    out.summaryLine = compactSummaryLine(out);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id: c.id,
      cityKey: c.cityKey,
      addressRu: c.addressRu,
      mode,
      status: 'pipeline_error',
      summaryLine: '',
      geocodeWinner,
      rawElementCount,
      hadProviderFailure,
      usedFallbackQuery,
      publicSummary: emptySummaryPlaceholder(),
      diagnostics: harnessDiag(c, {
        lat: null,
        lon: null,
        geocodeDisplayName: null,
        decision: null,
        magnets: [],
      }),
      locationDecisionWarningHarness: null,
      overpassHarness: null,
      errorMessage: msg,
    };
  }
}

function emptySummaryPlaceholder(): GoldenCaseOutput['publicSummary'] {
  return {
    finalScore: null,
    scoreBand: 'none',
    primaryDemandType: 'weak/unclear',
    secondaryDemandTypes: [],
    headlineRu: '',
    audienceVerdictRu: '',
    trace: { headlineReason: '', verdictReason: '', contradictionWarnings: [] },
    publicDriverLinesRu: [],
    cityScale: 'unknown',
    populationTier: 'unknown',
    marketGravityCoefficient: 1,
    specialMarketFlags: [],
    scoreCapReason: null,
    rejectedFromPublicCount: 0,
  };
}

function runFixtureCase(c: GoldenCaseFile['cases'][number]): GoldenCaseOutput {
  const mode = 'fixture' as const;
  try {
    const { lat, lon, elements } = c.replay;
    const { publicSummary: ps, decision, magnets } = buildPipeline({
      elements,
      lat,
      lon,
      inputAddress: c.addressRu,
      selectedGeocodeResult: c.addressRu,
    });
    const out: GoldenCaseOutput = {
      id: c.id,
      cityKey: c.cityKey,
      addressRu: c.addressRu,
      mode,
      status: 'ok',
      summaryLine: '',
      geocodeWinner: null,
      rawElementCount: elements.length,
      hadProviderFailure: false,
      usedFallbackQuery: false,
      publicSummary: serializePublicSummary(ps),
      diagnostics: harnessDiag(c, {
        lat,
        lon,
        geocodeDisplayName: null,
        decision,
        magnets,
      }),
      locationDecisionWarningHarness: buildLocationDecisionWarningHarness(decision),
      overpassHarness: null,
    };
    out.summaryLine = compactSummaryLine(out);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id: c.id,
      cityKey: c.cityKey,
      addressRu: c.addressRu,
      mode,
      status: 'pipeline_error',
      summaryLine: '',
      geocodeWinner: null,
      rawElementCount: c.replay.elements.length,
      hadProviderFailure: false,
      usedFallbackQuery: false,
      publicSummary: emptySummaryPlaceholder(),
      diagnostics: harnessDiag(c, {
        lat: c.replay.lat,
        lon: c.replay.lon,
        geocodeDisplayName: null,
        decision: null,
        magnets: [],
      }),
      locationDecisionWarningHarness: null,
      overpassHarness: null,
      errorMessage: msg,
    };
  }
}

async function main() {
  const live = process.env.LOCATION_GOLDEN_LIVE === '1';
  const geocodeMs = Number(process.env.LOCATION_GOLDEN_GEOCODE_MS ?? 30_000);
  const overpassMs = Number(process.env.LOCATION_GOLDEN_OVERPASS_MS ?? 45_000);

  const bundle = loadBundle();
  const cases: GoldenCaseOutput[] = [];

  for (const c of bundle.cases) {
    // eslint-disable-next-line no-await-in-loop
    const row = live ? await runLiveCase(c, geocodeMs, overpassMs) : runFixtureCase(c);
    cases.push(row);
    // eslint-disable-next-line no-console
    console.log(row.summaryLine || `${row.id} ${row.status} (no summaryLine)`);
  }

  const outDir = join(REPO_ROOT, 'tmp/location-golden');
  mkdirSync(outDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: live ? 'live' : 'fixture',
    cases,
  };
  writeFileSync(join(outDir, 'latest.json'), JSON.stringify(payload, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${join('tmp/location-golden', 'latest.json')}`);
}

main().catch(e => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
