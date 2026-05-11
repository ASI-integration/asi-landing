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
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { OSMElement } from '../src/lib/location/types';
import type { LocationPublicSummary } from '../src/lib/location/location-decision-contract';
import { geocodePlainAddressForMarket } from '../src/lib/location/address-providers/geocode-pipeline';
import { fetchOsmData } from '../src/lib/location/overpass';
import { buildAnalysis } from '../src/lib/location/gravity-scoring';
import { enrichAnalysisWithReportProjection } from '../src/lib/location/location-scoring-projection';
import { buildLocationDecision } from '../src/lib/location/location-decision-kernel';

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
  > & {
    publicDriverLinesRu: string[];
  };
  errorMessage?: string;
}

function loadFixture(): GoldenCaseFile {
  const p = join(REPO_ROOT, 'src/lib/location/__fixtures__/golden-addresses.json');
  return JSON.parse(readFileSync(p, 'utf8')) as GoldenCaseFile;
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
  };
}

function buildSummaryFromPipeline(args: {
  elements: OSMElement[];
  lat: number;
  lon: number;
  inputAddress: string;
  selectedGeocodeResult?: string | null;
}): LocationPublicSummary {
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
  });
  const ps = decision.publicSummary;
  if (!ps) {
    throw new Error('location_golden: buildLocationDecision returned null publicSummary');
  }
  return ps;
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
        errorMessage: 'geocode returned no coordinates',
      };
    }

    const osmResult = await raceWithTimeout(
      fetchOsmData(lat, lon, { requestTimeoutMs: Math.min(20_000, overpassMs) }),
      overpassMs,
    );

    if (isGoldenTimeout(osmResult)) {
      return {
        id: c.id,
        cityKey: c.cityKey,
        addressRu: c.addressRu,
        mode,
        status: 'overpass_timeout',
        summaryLine: '',
        geocodeWinner,
        rawElementCount: 0,
        hadProviderFailure: false,
        usedFallbackQuery: false,
        publicSummary: emptySummaryPlaceholder(),
        errorMessage: `overpass exceeded ${overpassMs}ms`,
      };
    }

    const osm = osmResult;
    rawElementCount = osm.elements.length;
    hadProviderFailure = Boolean(osm.hadProviderFailure);
    usedFallbackQuery = Boolean(osm.usedFallbackQuery);
    const status = classifyAfterFetch({
      elements: osm.elements,
      hadProviderFailure,
      usedFallbackQuery: osm.usedFallbackQuery,
    });

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
      };
    }

    const displayName = geo.result?.displayName ?? null;
    const ps = buildSummaryFromPipeline({
      elements: osm.elements,
      lat,
      lon,
      inputAddress: c.addressRu,
      selectedGeocodeResult: displayName,
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
      geocodeWinner,
      rawElementCount,
      hadProviderFailure,
      usedFallbackQuery,
      publicSummary: emptySummaryPlaceholder(),
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
  };
}

function runFixtureCase(c: GoldenCaseFile['cases'][number]): GoldenCaseOutput {
  const mode = 'fixture' as const;
  try {
    const { lat, lon, elements } = c.replay;
    const ps = buildSummaryFromPipeline({
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
      errorMessage: msg,
    };
  }
}

async function main() {
  const live = process.env.LOCATION_GOLDEN_LIVE === '1';
  const geocodeMs = Number(process.env.LOCATION_GOLDEN_GEOCODE_MS ?? 30_000);
  const overpassMs = Number(process.env.LOCATION_GOLDEN_OVERPASS_MS ?? 45_000);

  const bundle = loadFixture();
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
