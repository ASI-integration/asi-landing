import type { OSMElement } from './types';
import { CATEGORY_RADIUS, COMPETITOR_RADIUS } from './config';
import { classifyElement } from './overpass-classify';
import { STRATEGIC_TRANSPORT_FETCH_RADIUS_M } from './strategic-transport-hub';
import { SPECIALIZED_MEDICAL_FETCH_RADIUS_M } from './specialized-medical-anchor';

// ── Overpass API — fetch real nearby objects ──────────────────────────────────

const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.maprva.org/api/interpreter',
  // Legacy alias still used in some docs; keep as a fallback (may redirect).
  'https://overpass.kumi.systems/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
] as const;

interface QuerySelector {
  filter: string;
  radius: number;
  includeInStrict: boolean;
  /** Query priority: core selectors are fetched even under tight budgets. */
  priority?: 'core' | 'extras';
  /** When set, query node+way+relation even in strict mode (needed for highways, landuse, runways). */
  allGeometries?: boolean;
}

function makeAround(filter: string, radius: number, lat: number, lon: number, allGeometryTypes: boolean): string[] {
  if (!allGeometryTypes) return [`node[${filter}](around:${radius},${lat},${lon});`];
  // `nwr` is significantly more compact than enumerating node+way+relation.
  // It is also the canonical Overpass shorthand for "all geometry types".
  return [`nwr[${filter}](around:${radius},${lat},${lon});`];
}

function buildClauses(
  lat: number,
  lon: number,
  radiusScale: number,
  broad: boolean,
  profile: 'core' | 'full' = 'full',
): string[] {
  const selectors: QuerySelector[] = [
    // ── Tier 1: Strong regional anchors ──────────────────────────────────────

    // Metro: only genuine subway/underground systems.
    { filter: '"railway"="subway_entrance"', radius: CATEGORY_RADIUS.metro,    includeInStrict: true  },
    // Many OSM metro stations are mapped as ways/relations (e.g. stop_area / station relations).
    // Query all geometries in strict mode to avoid silent under-detection.
    { filter: '"station"="subway"',          radius: CATEGORY_RADIUS.metro,    includeInStrict: true, allGeometries: true  },

    // Airport: major air traffic hubs — very strong demand generator
    { filter: '"aeroway"="aerodrome"',       radius: CATEGORY_RADIUS.airport,  includeInStrict: true  },
    { filter: '"aeroway"="terminal"',        radius: CATEGORY_RADIUS.airport,  includeInStrict: false },
    // Extended fetch — hubs scored via strategicTransportHub beyond ordinary magnet radius (≤ same hubs).
    { filter: '"aeroway"="aerodrome"',       radius: STRATEGIC_TRANSPORT_FETCH_RADIUS_M, includeInStrict: true, allGeometries: true },

    // Attractions (major tourism, monuments)
    { filter: '"tourism"="attraction"', radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"historic"="monument"',  radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"tourism"="museum"',     radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"tourism"="gallery"',    radius: CATEGORY_RADIUS.attraction, includeInStrict: false },

    // Hospital / medical cluster — evergreen demand from staff & visitors
    { filter: '"amenity"="hospital"',      radius: CATEGORY_RADIUS.hospital, includeInStrict: true  },
    { filter: '"healthcare"="hospital"',   radius: CATEGORY_RADIUS.hospital, includeInStrict: false },
    // Extended fetch for large/specialized healthcare — gated in buildAnalysis (does not widen ordinary hospital scoring)
    { filter: '"amenity"="hospital"',      radius: SPECIALIZED_MEDICAL_FETCH_RADIUS_M, includeInStrict: true, allGeometries: true },
    { filter: '"healthcare"="hospital"',   radius: SPECIALIZED_MEDICAL_FETCH_RADIUS_M, includeInStrict: true, allGeometries: true },
    { filter: '"healthcare"="surgery"',   radius: SPECIALIZED_MEDICAL_FETCH_RADIUS_M - 500, includeInStrict: true, allGeometries: true },
    { filter: '"amenity"="dentist"',      radius: 2200, includeInStrict: true, allGeometries: true },
    { filter: '"amenity"="clinic"',       radius: 2200, includeInStrict: false, allGeometries: true, priority: 'extras' },

    // ── Tier 2: District anchors ──────────────────────────────────────────────

    // Major hotels (4–5★ / luxury chains) — used as quality proxy signal.
    // These are ALSO classified as competitor supply in classifyElement.
    { filter: '"tourism"="hotel"',       radius: CATEGORY_RADIUS.major_hotel, includeInStrict: true  },

    // Convention / expo centers — corporate demand anchor
    { filter: '"amenity"="conference_centre"',  radius: CATEGORY_RADIUS.convention, includeInStrict: true  },
    { filter: '"amenity"="exhibition_centre"',  radius: CATEGORY_RADIUS.convention, includeInStrict: false },
    { filter: '"amenity"="convention_centre"',  radius: CATEGORY_RADIUS.convention, includeInStrict: false },

    // Universities
    { filter: '"amenity"="university"', radius: CATEGORY_RADIUS.university, includeInStrict: true },
    { filter: '"amenity"="college"',    radius: CATEGORY_RADIUS.education_local, includeInStrict: false },

    // Business (offices, factories, industrial zones)
    { filter: '"office"',                  radius: CATEGORY_RADIUS.business, includeInStrict: true  },
    { filter: '"amenity"="bank"',          radius: CATEGORY_RADIUS.business, includeInStrict: false },
    { filter: '"landuse"="industrial"',    radius: CATEGORY_RADIUS.business, includeInStrict: false },
    { filter: '"man_made"="works"',        radius: CATEGORY_RADIUS.business, includeInStrict: false },
    { filter: '"building"="industrial"',   radius: CATEGORY_RADIUS.business, includeInStrict: false },
    { filter: '"landuse"="commercial"',    radius: CATEGORY_RADIUS.business, includeInStrict: false },

    // Railway stations (commuter / intercity)
    // Major stations are frequently mapped as ways/relations; strict mode must include them.
    { filter: '"railway"="station"',       radius: CATEGORY_RADIUS.railway_station, includeInStrict: true,  allGeometries: true  },
    { filter: '"railway"="halt"',          radius: CATEGORY_RADIUS.railway_station, includeInStrict: false, allGeometries: true },
    // Major surface transit hubs
    { filter: '"amenity"="bus_station"',   radius: CATEGORY_RADIUS.railway_station, includeInStrict: true,  allGeometries: true  },
    { filter: '"railway"="station"',       radius: STRATEGIC_TRANSPORT_FETCH_RADIUS_M, includeInStrict: true, allGeometries: true },
    { filter: '"amenity"="bus_station"',   radius: STRATEGIC_TRANSPORT_FETCH_RADIUS_M, includeInStrict: true, allGeometries: true },
    { filter: '"amenity"="ferry_terminal"', radius: STRATEGIC_TRANSPORT_FETCH_RADIUS_M, includeInStrict: true, allGeometries: true },
    { filter: '"landuse"="harbour"',       radius: STRATEGIC_TRANSPORT_FETCH_RADIUS_M, includeInStrict: true, allGeometries: true },
    { filter: '"waterway"="dock"',         radius: STRATEGIC_TRANSPORT_FETCH_RADIUS_M, includeInStrict: true, allGeometries: true },
    { filter: '"industrial"="port"',       radius: STRATEGIC_TRANSPORT_FETCH_RADIUS_M, includeInStrict: true, allGeometries: true },
    { filter: '"industrial"="logistics"',  radius: STRATEGIC_TRANSPORT_FETCH_RADIUS_M, includeInStrict: false, allGeometries: true, priority: 'extras' },
    { filter: '"harbour"="yes"',           radius: STRATEGIC_TRANSPORT_FETCH_RADIUS_M, includeInStrict: false, allGeometries: true, priority: 'extras' },

    // Entertainment (city-scale venues)
    { filter: '"amenity"="cinema"',     radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="theatre"',    radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="arts_centre"',radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="nightclub"',  radius: CATEGORY_RADIUS.entertainment, includeInStrict: false, priority: 'extras' },

    // Shopping major (malls / department stores)
    { filter: '"shop"="mall"',             radius: CATEGORY_RADIUS.shopping_major, includeInStrict: true },
    { filter: '"shop"="department_store"', radius: CATEGORY_RADIUS.shopping_major, includeInStrict: true },

    // Stadiums / arenas — year-round event venues
    { filter: '"leisure"="stadium"',        radius: CATEGORY_RADIUS.stadium, includeInStrict: true  },
    { filter: '"leisure"="sports_centre"',  radius: CATEGORY_RADIUS.stadium, includeInStrict: false },

    // ── Tier 3: Local / accessibility-only ───────────────────────────────────

    // Accessibility stops (weak bonus, not demand magnets)
    { filter: '"highway"="bus_stop"',               radius: CATEGORY_RADIUS.accessibility_stop, includeInStrict: true  },
    { filter: '"public_transport"="stop_position"', radius: CATEGORY_RADIUS.accessibility_stop, includeInStrict: true  },
    // In many cities stops are mapped only as platforms; keep them in strict to avoid "no stops" outcomes.
    { filter: '"public_transport"="platform"',      radius: CATEGORY_RADIUS.accessibility_stop, includeInStrict: true  },
    { filter: '"public_transport"="station"',       radius: CATEGORY_RADIUS.accessibility_stop, includeInStrict: true,  allGeometries: true },
    { filter: '"railway"="tram_stop"',              radius: CATEGORY_RADIUS.accessibility_stop, includeInStrict: true  },

    // Supermarkets (weak local signal)
    { filter: '"shop"="supermarket"', radius: CATEGORY_RADIUS.shopping_local, includeInStrict: true, priority: 'extras' },

    // Food (weak — only valuable as cluster proxy)
    { filter: '"amenity"="restaurant"', radius: CATEGORY_RADIUS.food, includeInStrict: true, priority: 'extras' },
    { filter: '"amenity"="cafe"',       radius: CATEGORY_RADIUS.food, includeInStrict: true, priority: 'extras' },
    { filter: '"amenity"="fast_food"',  radius: CATEGORY_RADIUS.food, includeInStrict: true, priority: 'extras' },
    { filter: '"amenity"="bar"',        radius: CATEGORY_RADIUS.food, includeInStrict: false, priority: 'extras' },

    // ── Competitors (non-hotel STR supply) ───────────────────────────────────
    // Note: tourism=hotel is handled by major_hotel selector above + classifyElement split.
    { filter: '"tourism"="apartment"',   radius: COMPETITOR_RADIUS, includeInStrict: true,  allGeometries: true },
    { filter: '"tourism"="guest_house"', radius: COMPETITOR_RADIUS, includeInStrict: true,  allGeometries: true },
    { filter: '"tourism"="hostel"',      radius: COMPETITOR_RADIUS, includeInStrict: true,  allGeometries: true },
    { filter: '"tourism"="motel"',       radius: COMPETITOR_RADIUS, includeInStrict: false, allGeometries: true },

    // ── Neighborhood environment (strict + full geometry — independent of commercial score) ──
    { filter: '"highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link)$"', radius: 520, includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"aeroway"="runway"',       radius: 2600, includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"aeroway"="taxiway"',      radius: 900,  includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"landuse"="industrial"',  radius: 1100, includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"industrial"="warehouse"', radius: 950, includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"man_made"="works"',       radius: 1000, includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"building"="industrial"', radius: 800,  includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"amenity"="nightclub"',    radius: 360,  includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"amenity"="bar"',          radius: 300,  includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"amenity"="pub"',          radius: 280,  includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"railway"="rail"',         radius: 520,  includeInStrict: true, allGeometries: true, priority: 'extras' },
    // Spatial foundation v1 — barrier + walkable-corridor proxies (strict; light batch)
    { filter: '"natural"="water"',        radius: 620,  includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"waterway"="riverbank"',   radius: 620,  includeInStrict: true, allGeometries: true, priority: 'extras' },
    { filter: '"landuse"="reservoir"',    radius: 620,  includeInStrict: true, allGeometries: true, priority: 'extras' },
    {
      filter: '"highway"~"^(residential|secondary|tertiary|living_street|pedestrian|unclassified|service)$"',
      radius: 420,
      includeInStrict: true,
      allGeometries: true,
      priority: 'extras',
    },
  ];

  const parts: string[] = [];
  for (const s of selectors) {
    if (!broad && !s.includeInStrict) continue;
    if (!broad && profile === 'core' && (s.priority ?? 'core') !== 'core') continue;
    const radius = Math.max(150, Math.round(s.radius * radiusScale));
    const useAllGeom = s.allGeometries ?? broad;
    parts.push(...makeAround(s.filter, radius, lat, lon, useAllGeom));
  }

  return parts;
}

/** Used by harnesses to align golden JSON diagnostics with the Overpass `[timeout:n]` clause. */
export function computeOverpassTimeoutSeconds(requestTimeoutMs?: number): number {
  // Keep the server-side timeout aligned with the client-side budget to avoid
  // long-running queries that the client will abort anyway.
  const ms = requestTimeoutMs ?? 20_000;
  const sec = Math.floor(Math.max(5_000, ms - 1_200) / 1000);
  return Math.max(5, Math.min(25, sec));
}

function buildQuery(clauses: string[], requestTimeoutMs?: number): string {
  const timeoutSec = computeOverpassTimeoutSeconds(requestTimeoutMs);
  // `out center;` is the most compatible output mode across Overpass instances and
  // includes tags by default (needed for classification) plus `center` for ways/relations.
  return `[out:json][timeout:${timeoutSec}];(${clauses.join('')});out center;`;
}

/**
 * Backfill clauses — small, high-signal selectors that are frequently represented as ways/relations
 * and are critical for demand type (transport-led) and competitor pressure.
 *
 * Used when Overpass returns partial results (provider failures) to avoid returning a silently
 * incomplete element set without paying the cost of the full broad pass.
 */
function buildBackfillClauses(lat: number, lon: number): string[] {
  const r = (meters: number, filter: string) => makeAround(filter, meters, lat, lon, true);
  return [
    ...r(STRATEGIC_TRANSPORT_FETCH_RADIUS_M, '"aeroway"="aerodrome"'),
    ...r(STRATEGIC_TRANSPORT_FETCH_RADIUS_M, '"railway"="station"'),
    ...r(STRATEGIC_TRANSPORT_FETCH_RADIUS_M, '"amenity"="bus_station"'),
    ...r(STRATEGIC_TRANSPORT_FETCH_RADIUS_M, '"amenity"="ferry_terminal"'),
    ...r(STRATEGIC_TRANSPORT_FETCH_RADIUS_M, '"landuse"="harbour"'),
    ...r(STRATEGIC_TRANSPORT_FETCH_RADIUS_M, '"waterway"="dock"'),
    ...r(STRATEGIC_TRANSPORT_FETCH_RADIUS_M, '"industrial"="port"'),
    // Rail / bus hubs
    ...r(CATEGORY_RADIUS.railway_station, '"railway"="station"'),
    ...r(CATEGORY_RADIUS.railway_station, '"amenity"="bus_station"'),
    // Metro stations + entrances
    ...r(CATEGORY_RADIUS.metro, '"station"="subway"'),
    ...r(CATEGORY_RADIUS.metro, '"railway"="subway_entrance"'),
    // STR supply competitors
    ...r(COMPETITOR_RADIUS, '"tourism"="apartment"'),
    ...r(COMPETITOR_RADIUS, '"tourism"="guest_house"'),
    ...r(COMPETITOR_RADIUS, '"tourism"="hostel"'),
    ...r(COMPETITOR_RADIUS, '"tourism"="motel"'),
  ];
}

function capRadius(meters: number, capMeters: number | null): number {
  if (capMeters == null) return meters;
  return Math.max(120, Math.min(meters, capMeters));
}

/**
 * Validation-tight staged selectors:
 * - Stage 1: core anchors that should be cheap even in dense cities
 * - Stage 2: potentially heavy categories (competitors + many local stops), with smaller radii
 *
 * This specifically targets dense-area cases where Overpass times out and returns 0 elements.
 */
function buildValidationTightClausesStage1(lat: number, lon: number): string[] {
  const r = (meters: number, filter: string, allGeom = true) => makeAround(filter, meters, lat, lon, allGeom);
  return [
    // Transport-led anchors (keep them first; avoid bundling with heavy supply queries)
    ...r(CATEGORY_RADIUS.railway_station, '"railway"="station"'),
    ...r(CATEGORY_RADIUS.railway_station, '"amenity"="bus_station"'),
    ...r(CATEGORY_RADIUS.metro, '"station"="subway"'),
    ...r(CATEGORY_RADIUS.metro, '"railway"="subway_entrance"', false),

    // Major demand generators
    ...r(CATEGORY_RADIUS.airport, '"aeroway"="aerodrome"', false),
    ...r(CATEGORY_RADIUS.hospital, '"amenity"="hospital"', false),
    ...r(CATEGORY_RADIUS.attraction, '"tourism"="attraction"', false),

    // Supply proxy (major hotels) — typically manageable
    ...r(CATEGORY_RADIUS.major_hotel, '"tourism"="hotel"'),
  ];
}

function buildValidationTightClausesStage2(lat: number, lon: number): string[] {
  // Dense-city hardening: competitors + stop/platform can be huge; cap radii aggressively.
  const competitorRadius = capRadius(COMPETITOR_RADIUS, 650);
  const stopRadius = capRadius(CATEGORY_RADIUS.accessibility_stop, 260);

  const r = (meters: number, filter: string, allGeom = true) => makeAround(filter, meters, lat, lon, allGeom);
  return [
    // STR competitors (heavy in dense cities)
    ...r(competitorRadius, '"tourism"="apartment"'),
    ...r(competitorRadius, '"tourism"="guest_house"'),
    ...r(competitorRadius, '"tourism"="hostel"'),

    // Local accessibility coverage (cap to keep query size bounded)
    ...r(stopRadius, '"highway"="bus_stop"', false),
    ...r(stopRadius, '"public_transport"="platform"', false),
    ...r(stopRadius, '"public_transport"="stop_position"', false),
    ...r(stopRadius, '"railway"="tram_stop"', false),
  ];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function dedupeElements(elements: OSMElement[]): OSMElement[] {
  const byId = new Map<string, OSMElement>();
  for (const el of elements) {
    byId.set(`${el.type}:${el.id}`, el);
  }
  return [...byId.values()];
}

type FetchOverpassQueryOptions = {
  /** Abort the whole Overpass call chain (used by harness time budgets). */
  signal?: AbortSignal;
  /** Hard timeout per endpoint request (ms). Default 20000. */
  requestTimeoutMs?: number;
};

type OverpassFetchOk = { ok: true; elements: OSMElement[]; endpoint: string };
type OverpassFetchBad = { ok: false; endpoint: string; status?: number; retryAfterMs?: number };

type EndpointHealth = { nextAvailableAt: number };
const endpointHealth = new Map<string, EndpointHealth>();

function getEndpointHealth(endpoint: string): EndpointHealth {
  const existing = endpointHealth.get(endpoint);
  if (existing) return existing;
  const h = { nextAvailableAt: 0 };
  endpointHealth.set(endpoint, h);
  return h;
}

let lastOverpassRequestStartedAt = 0;
const MIN_OVERPASS_REQUEST_INTERVAL_MS = 1_500;

async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    }
  });
}

async function fetchFromEndpoint(
  endpoint: string,
  query: string,
  options?: FetchOverpassQueryOptions,
): Promise<OverpassFetchOk | OverpassFetchBad> {
  if (options?.signal?.aborted) return { ok: false, endpoint };

  const controller = new AbortController();
  const timeoutMs = options?.requestTimeoutMs ?? 20_000;
  const signal =
    options?.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const now = Date.now();
    const waitFor = MIN_OVERPASS_REQUEST_INTERVAL_MS - (now - lastOverpassRequestStartedAt);
    if (waitFor > 0) await sleepMs(waitFor, options?.signal);
    lastOverpassRequestStartedAt = Date.now();

    // Start the per-endpoint timer only when the network request is about to start,
    // so internal throttling doesn't eat into the fetch budget.
    timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'asi-landing-location-demo/1.0',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal,
    });

    if (!res.ok) {
      const retryAfter = res.headers.get('retry-after');
      const retryAfterMs =
        retryAfter && Number.isFinite(Number(retryAfter))
          ? Math.max(0, Math.floor(Number(retryAfter) * 1000))
          : undefined;
      return { ok: false, endpoint, status: res.status, retryAfterMs };
    }
    const json = await res.json();
    return { ok: true, elements: (json.elements ?? []) as OSMElement[], endpoint };
  } catch {
    return { ok: false, endpoint };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchOverpassQuery(
  query: string,
  options?: FetchOverpassQueryOptions,
): Promise<{ elements: OSMElement[]; hadProviderFailure: boolean }> {
  // Provider bottleneck fix:
  // - Avoid hedged parallel requests (triggers rate limits / 429).
  // - Track endpoint cooldowns and rotate on 429/5xx.
  if (options?.signal?.aborted) return { elements: [], hadProviderFailure: true };

  let hadProviderFailure = false;
  const failures: Array<{ endpoint: string; status?: number }> = [];

  // Prefer endpoints that are not on cooldown.
  const ordered = [...OVERPASS_ENDPOINTS].sort((a, b) => getEndpointHealth(a).nextAvailableAt - getEndpointHealth(b).nextAvailableAt);

  for (const endpoint of ordered) {
    if (options?.signal?.aborted) break;

    const h = getEndpointHealth(endpoint);
    if (h.nextAvailableAt > Date.now()) {
      hadProviderFailure = true;
      failures.push({ endpoint, status: 429 });
      continue;
    }

    const r = await fetchFromEndpoint(endpoint, query, options);
    if (r.ok) return { elements: r.elements, hadProviderFailure };

    hadProviderFailure = true;
    failures.push({ endpoint, status: r.status });

    // Cooldowns: back off on rate-limit and transient gateway errors.
    if (r.status === 429) {
      h.nextAvailableAt = Date.now() + Math.max(r.retryAfterMs ?? 0, 15_000);
      // If the server provided a short Retry-After, wait and retry this endpoint once.
      const waitMs = r.retryAfterMs != null ? Math.min(r.retryAfterMs, 6_000) : 0;
      if (waitMs > 0 && !options?.signal?.aborted) {
        await sleepMs(waitMs, options?.signal);
        const retry = await fetchFromEndpoint(endpoint, query, options);
        if (retry.ok) return { elements: retry.elements, hadProviderFailure: true };
        failures.push({ endpoint, status: retry.status });
      }
    } else if (r.status === 504 || r.status === 503 || r.status === 502) {
      h.nextAvailableAt = Date.now() + 5_000;
    } else if (r.status != null && r.status >= 400) {
      h.nextAvailableAt = Date.now() + 2_000;
    }
  }

  if (failures.length) {
    console.warn(
      `[location] overpass_all_failed attempts=[${failures.map(f => `${f.endpoint}:${f.status ?? 'err'}`).join(',')}]`,
    );
  }

  return { elements: [], hadProviderFailure };
}

type FetchOsmByBatchesOptions = {
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  batchSize?: number;
  stopWhenAtLeast?: number;
};

async function fetchOsmByBatches(
  clauses: string[],
  options?: FetchOsmByBatchesOptions,
): Promise<{ elements: OSMElement[]; hadProviderFailure: boolean }> {
  let hadProviderFailure = false;
  const byId = new Map<string, OSMElement>();

  const batchSize = options?.batchSize ?? 24;
  for (const part of chunk(clauses, batchSize)) {
    if (options?.signal?.aborted) {
      hadProviderFailure = true;
      break;
    }
    const result = await fetchOverpassQuery(buildQuery(part, options?.requestTimeoutMs), options);
    hadProviderFailure = hadProviderFailure || result.hadProviderFailure;
    for (const el of result.elements) {
      byId.set(`${el.type}:${el.id}`, el);
    }

    if (options?.stopWhenAtLeast != null && byId.size >= options.stopWhenAtLeast && !hadProviderFailure) {
      break;
    }
  }

  return { elements: [...byId.values()], hadProviderFailure };
}

export interface OsmFetchResult {
  elements: OSMElement[];
  hadProviderFailure: boolean;
  /** Primary full query failed across endpoints; a smaller query recovered data */
  usedFallbackQuery?: boolean;
  /** Result was served from the persistent on-disk cache (no network request made) */
  fromDiskCache?: boolean;
}

export interface DiskCacheEntry {
  created_at: string;
  source_endpoint: string;
  query_profile: string;
  lat: number;
  lon: number;
  elements: OSMElement[];
  hadProviderFailure: boolean;
  usedFallbackQuery?: boolean;
}

/** Reduced query: fewer selectors, single batch — last resort when full pipeline fails */
function buildMinimalClauses(lat: number, lon: number): string[] {
  const r = (meters: number, filter: string) => makeAround(filter, meters, lat, lon, true);
  return [
    ...r(CATEGORY_RADIUS.metro, '"railway"="subway_entrance"'),
    ...r(CATEGORY_RADIUS.metro, '"station"="subway"'),
    ...r(CATEGORY_RADIUS.attraction, '"tourism"="attraction"'),
    ...r(CATEGORY_RADIUS.hospital, '"amenity"="hospital"'),
    ...r(CATEGORY_RADIUS.major_hotel, '"tourism"="hotel"'),
    ...r(COMPETITOR_RADIUS, '"tourism"="guest_house"'),
  ];
}

async function fetchOsmDataMinimal(
  lat: number,
  lon: number,
  options?: FetchOverpassQueryOptions,
): Promise<OsmFetchResult> {
  const clauses = buildMinimalClauses(lat, lon);
  const result = await fetchOverpassQuery(buildQuery(clauses, options?.requestTimeoutMs), options);
  return {
    elements: result.elements,
    hadProviderFailure: result.hadProviderFailure,
    usedFallbackQuery: true,
  };
}

export type FetchOsmDataOptions = {
  /** Abort the full fetch (strict + fallbacks) when time budget is exceeded. */
  signal?: AbortSignal;
  /** Hard timeout per endpoint request (ms). Default 20000. */
  requestTimeoutMs?: number;
  /** Disable strict partial-failure backfill query. */
  allowBackfill?: boolean;
  /**
   * Disable the broad (radiusScale=1.4, broad=true) fallback. Useful for validation harness runs
   * where we prefer fast partial results + a warning over multi-minute retries.
   */
  allowBroadFallback?: boolean;
  /**
   * Absolute path to a directory for persistent on-disk element-set cache.
   * When provided: cache is checked before any network request; successful fetches are persisted.
   * Cache files are keyed by coordinates + query profile and never expire automatically.
   */
  diskCacheDir?: string;
};

type OsmFetchCacheEntry = { expiresAt: number; value: OsmFetchResult };
const osmFetchCache = new Map<string, OsmFetchCacheEntry>();
const OSM_FETCH_CACHE_TTL_MS = 5 * 60 * 1000;

// ── Persistent disk cache helpers ─────────────────────────────────────────────

function makeDiskQueryProfile(validationTightMode: boolean, options?: FetchOsmDataOptions): string {
  if (validationTightMode) return 'validation-tight';
  if (options?.allowBroadFallback !== false) return 'full';
  return (options?.allowBackfill ?? true) ? 'strict-backfill' : 'strict';
}

function makeDiskCacheFileName(lat: number, lon: number, profile: string): string {
  // Use the same 5-decimal rounding as the in-memory key for coordinate stability.
  return `${lat.toFixed(5)}_${lon.toFixed(5)}_${profile}.json`;
}

function tryReadDiskCache(dir: string, fileName: string): DiskCacheEntry | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path') as typeof import('node:path');
    return JSON.parse(readFileSync(join(dir, fileName), 'utf8')) as DiskCacheEntry;
  } catch {
    return null;
  }
}

function tryWriteDiskCache(dir: string, fileName: string, entry: DiskCacheEntry): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('node:path') as typeof import('node:path');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, fileName), JSON.stringify(entry, null, 2), 'utf8');
  } catch {
    // non-fatal — disk cache write failure does not affect fetch result
  }
}

function saveToDiskCache(
  diskCacheDir: string | undefined,
  diskFileName: string,
  lat: number,
  lon: number,
  diskProfile: string,
  result: OsmFetchResult,
): void {
  // Never cache empty results — a failed/empty fetch should be retried on the next run.
  if (!diskCacheDir || result.elements.length === 0) return;
  tryWriteDiskCache(diskCacheDir, diskFileName, {
    created_at: new Date().toISOString(),
    source_endpoint: 'overpass-multi',
    query_profile: diskProfile,
    lat,
    lon,
    elements: result.elements,
    hadProviderFailure: result.hadProviderFailure,
    usedFallbackQuery: result.usedFallbackQuery,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

function makeOsmFetchCacheKey(lat: number, lon: number, options?: FetchOsmDataOptions): string {
  // Rounded coordinates keep keys stable and avoid cache fragmentation due to tiny float diffs.
  const coord = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const flags = `broad=${options?.allowBroadFallback !== false};backfill=${options?.allowBackfill ?? true}`;
  return `${coord}|${flags}`;
}

export async function fetchOsmData(lat: number, lon: number, options?: FetchOsmDataOptions): Promise<OsmFetchResult> {
  const cacheKey = makeOsmFetchCacheKey(lat, lon, options);
  const cached = osmFetchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Under tight per-request budgets (e.g. harness), reduce round-trips by batching more clauses per call.
  // This is safer than blindly increasing timeouts: we try to get *some* data within the same budget.
  const tightBudget = (options?.requestTimeoutMs ?? 20_000) <= 7_000;
  const validationTightMode =
    tightBudget && options?.allowBroadFallback === false && options?.allowBackfill === false;

  // Persistent disk cache: check before any network request; populate on successful live fetch.
  const diskProfile = makeDiskQueryProfile(validationTightMode, options);
  const diskFileName = makeDiskCacheFileName(lat, lon, diskProfile);
  if (options?.diskCacheDir) {
    const diskHit = tryReadDiskCache(options.diskCacheDir, diskFileName);
    if (diskHit) {
      const out: OsmFetchResult = {
        elements: diskHit.elements,
        hadProviderFailure: diskHit.hadProviderFailure,
        usedFallbackQuery: diskHit.usedFallbackQuery,
        fromDiskCache: true,
      };
      osmFetchCache.set(cacheKey, { expiresAt: Date.now() + OSM_FETCH_CACHE_TTL_MS, value: out });
      return out;
    }
  }

  const strictBatchSize = tightBudget ? 34 : 24;

  // Some Overpass instances have become too slow to reliably respond within 6s even for core queries.
  // If the caller is already enforcing a global budget via AbortSignal (as the harness does),
  // slightly increasing per-endpoint timeout improves success rates without unbounded waits.
  const effectiveRequestTimeoutMs =
    // In validation-tight mode, we prefer *more endpoint attempts* over longer single attempts,
    // because dense-city queries can hit server-side timeouts and returning within the harness
    // budget matters more than squeezing through a single slow endpoint.
    validationTightMode
      ? (options?.requestTimeoutMs ?? 6_000)
      : Math.max(options?.requestTimeoutMs ?? 0, 10_000);
  const effectiveOptions: FetchOsmDataOptions = { ...options, requestTimeoutMs: effectiveRequestTimeoutMs };

  let strictElements: OSMElement[] = [];
  let strictHadProviderFailure = false;

  if (validationTightMode) {
    // Dense-city hardening: avoid bundling heavy categories in a single request.
    // Stage 1 gets "something reliable" fast; Stage 2 fills competitors/stops with capped radii.
    const stage1 = buildValidationTightClausesStage1(lat, lon);
    const r1 = await fetchOverpassQuery(buildQuery(stage1, effectiveOptions.requestTimeoutMs), effectiveOptions);

    const stage2 = buildValidationTightClausesStage2(lat, lon);
    // If we already have enough anchors and no provider failures, stop early to respect global budgets.
    if (r1.elements.length >= 12 && !r1.hadProviderFailure) {
      strictHadProviderFailure = false;
      strictElements = dedupeElements(r1.elements);
    } else {
      const r2 = await fetchOverpassQuery(buildQuery(stage2, effectiveOptions.requestTimeoutMs), effectiveOptions);
      strictHadProviderFailure = r1.hadProviderFailure || r2.hadProviderFailure;
      strictElements = dedupeElements([...r1.elements, ...r2.elements]);
    }
  } else {
    const strictClauses = buildClauses(lat, lon, 1, false, tightBudget ? 'core' : 'full');
    const strictResult = await fetchOsmByBatches(strictClauses, {
      ...effectiveOptions,
      batchSize: strictBatchSize,
      stopWhenAtLeast: tightBudget ? 40 : undefined,
    });
    strictHadProviderFailure = strictResult.hadProviderFailure;
    strictElements = dedupeElements(strictResult.elements);
  }

  // If strict filters return enough data, skip the broader fallback.
  // Exception: if Overpass had partial failures, strict results can be silently incomplete
  // (missing entire selector batches). In that case, always run the broad pass to backfill.
  if (strictElements.length >= 12 && !strictHadProviderFailure) {
    const out: OsmFetchResult = { elements: strictElements, hadProviderFailure: strictHadProviderFailure };
    osmFetchCache.set(cacheKey, { expiresAt: Date.now() + OSM_FETCH_CACHE_TTL_MS, value: out });
    saveToDiskCache(options?.diskCacheDir, diskFileName, lat, lon, diskProfile, out);
    return out;
  }

  // Partial-failure recovery: run a small transport/competitor backfill query first.
  // This addresses the most damaging regressions (missing stations, metro, competitors)
  // without paying the cost of the full broad pass.
  if ((options?.allowBackfill ?? true) && strictElements.length > 0 && strictHadProviderFailure) {
    const backfillResult = await fetchOsmByBatches(buildBackfillClauses(lat, lon), { ...effectiveOptions, batchSize: 28 });
    const merged = dedupeElements([...strictElements, ...backfillResult.elements]);
    const hadProviderFailure = strictHadProviderFailure || backfillResult.hadProviderFailure;
    if (merged.length >= 12) {
      const out: OsmFetchResult = { elements: merged, hadProviderFailure, usedFallbackQuery: true };
      osmFetchCache.set(cacheKey, { expiresAt: Date.now() + OSM_FETCH_CACHE_TTL_MS, value: out });
      saveToDiskCache(options?.diskCacheDir, diskFileName, lat, lon, diskProfile, out);
      return out;
    }
    // fall through to broad pass (still too sparse)
  }

  if (options?.allowBroadFallback === false) {
    const out: OsmFetchResult = { elements: strictElements, hadProviderFailure: strictHadProviderFailure, usedFallbackQuery: true };
    osmFetchCache.set(cacheKey, { expiresAt: Date.now() + OSM_FETCH_CACHE_TTL_MS, value: out });
    saveToDiskCache(options?.diskCacheDir, diskFileName, lat, lon, diskProfile, out);
    return out;
  }

  const fallbackClauses = buildClauses(lat, lon, 1.4, true, 'full');
  const fallbackResult = await fetchOsmByBatches(fallbackClauses, { ...effectiveOptions, batchSize: 24 });
  const merged = dedupeElements([...strictElements, ...fallbackResult.elements]);
  const hadProviderFailure = strictHadProviderFailure || fallbackResult.hadProviderFailure;

  if (merged.length === 0 && hadProviderFailure) {
    console.warn(
      `[location] magnet_provider primary_exhausted lat=${lat} lon=${lon} trying=minimal_overpass`,
    );
    const minimal = await fetchOsmDataMinimal(lat, lon, effectiveOptions);
    if (minimal.elements.length > 0) {
      console.warn(
        `[location] magnet_provider status=recovered via=minimal_overpass count=${minimal.elements.length}`,
      );
      const out: OsmFetchResult = {
        elements: dedupeElements(minimal.elements),
        hadProviderFailure: minimal.hadProviderFailure,
        usedFallbackQuery: true,
      };
      osmFetchCache.set(cacheKey, { expiresAt: Date.now() + OSM_FETCH_CACHE_TTL_MS, value: out });
      saveToDiskCache(options?.diskCacheDir, diskFileName, lat, lon, diskProfile, out);
      return out;
    }
    console.warn(`[location] magnet_provider status=all_failed lat=${lat} lon=${lon}`);
  }

  const out: OsmFetchResult = { elements: merged, hadProviderFailure };
  osmFetchCache.set(cacheKey, { expiresAt: Date.now() + OSM_FETCH_CACHE_TTL_MS, value: out });
  saveToDiskCache(options?.diskCacheDir, diskFileName, lat, lon, diskProfile, out);
  return out;
}

export { classifyElement };
