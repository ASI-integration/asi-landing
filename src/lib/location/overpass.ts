import type { OSMElement } from './types';
import { CATEGORY_RADIUS, COMPETITOR_RADIUS } from './config';

// ── Overpass API — fetch real nearby objects ──────────────────────────────────

const OVERPASS_ENDPOINTS = [
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;

interface QuerySelector {
  filter: string;
  radius: number;
  includeInStrict: boolean;
}

function makeAround(filter: string, radius: number, lat: number, lon: number, allGeometryTypes: boolean): string[] {
  if (!allGeometryTypes) return [`node[${filter}](around:${radius},${lat},${lon});`];
  return [
    `node[${filter}](around:${radius},${lat},${lon});`,
    `way[${filter}](around:${radius},${lat},${lon});`,
    `relation[${filter}](around:${radius},${lat},${lon});`,
  ];
}

function buildClauses(lat: number, lon: number, radiusScale: number, broad: boolean): string[] {
  const selectors: QuerySelector[] = [
    // ── Strong: Metro ────────────────────────────────────────────────────────
    // Only genuine subway/underground systems. Generic railway=station is classified
    // separately as railway_station (medium) — see below.
    { filter: '"railway"="subway_entrance"', radius: CATEGORY_RADIUS.metro,           includeInStrict: true  },
    { filter: '"station"="subway"',          radius: CATEGORY_RADIUS.metro,           includeInStrict: true  },

    // ── Medium: Railway stations (commuter / intercity / regional rail) ───────
    // Deliberately not strong — a suburban rail stop in a peripheral district
    // must not produce the same score impact as a real city-centre metro station.
    { filter: '"railway"="station"',         radius: CATEGORY_RADIUS.railway_station, includeInStrict: true  },
    { filter: '"railway"="halt"',            radius: CATEGORY_RADIUS.railway_station, includeInStrict: false },

    // ── Strong: Attractions (major tourism, monuments) ───────────────────────
    // Excludes local memorials and parks — those do not drive stable rental demand.
    { filter: '"tourism"="attraction"', radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"historic"="monument"',  radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"tourism"="museum"',     radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"tourism"="gallery"',    radius: CATEGORY_RADIUS.attraction, includeInStrict: false },

    // ── Strong: Universities ─────────────────────────────────────────────────
    { filter: '"amenity"="university"', radius: CATEGORY_RADIUS.university, includeInStrict: true },
    { filter: '"amenity"="college"',    radius: CATEGORY_RADIUS.education_local, includeInStrict: false },

    // Major surface transit hubs (not mere stop positions)
    { filter: '"amenity"="bus_station"', radius: CATEGORY_RADIUS.railway_station, includeInStrict: true },

    // ── Medium: Entertainment (city-scale venues) ────────────────────────────
    // Sports centres intentionally excluded — they are local, not city-scale.
    { filter: '"amenity"="cinema"',     radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="theatre"',    radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="arts_centre"',radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="nightclub"',  radius: CATEGORY_RADIUS.entertainment, includeInStrict: false },

    // ── Medium: Shopping major (malls / department stores) ───────────────────
    { filter: '"shop"="mall"',             radius: CATEGORY_RADIUS.shopping_major, includeInStrict: true },
    { filter: '"shop"="department_store"', radius: CATEGORY_RADIUS.shopping_major, includeInStrict: true },

    // ── Medium: Business (offices — district-level) ──────────────────────────
    { filter: '"office"',           radius: CATEGORY_RADIUS.business, includeInStrict: true },
    { filter: '"amenity"="bank"',   radius: CATEGORY_RADIUS.business, includeInStrict: false },

    // ── Accessibility only: local stops / platforms (weak bonus, not demand magnets)
    { filter: '"highway"="bus_stop"',               radius: CATEGORY_RADIUS.accessibility_stop, includeInStrict: true },
    { filter: '"public_transport"="stop_position"', radius: CATEGORY_RADIUS.accessibility_stop, includeInStrict: true },
    { filter: '"public_transport"="platform"',     radius: CATEGORY_RADIUS.accessibility_stop, includeInStrict: false },
    { filter: '"railway"="tram_stop"',              radius: CATEGORY_RADIUS.accessibility_stop, includeInStrict: false },

    // ── Weak: Shopping local (supermarkets) ──────────────────────────────────
    { filter: '"shop"="supermarket"', radius: CATEGORY_RADIUS.shopping_local, includeInStrict: true },

    // ── Weak: Food (local cafes / restaurants) ───────────────────────────────
    { filter: '"amenity"="restaurant"', radius: CATEGORY_RADIUS.food, includeInStrict: true },
    { filter: '"amenity"="cafe"',       radius: CATEGORY_RADIUS.food, includeInStrict: true },
    { filter: '"amenity"="fast_food"',  radius: CATEGORY_RADIUS.food, includeInStrict: true },
    { filter: '"amenity"="bar"',        radius: CATEGORY_RADIUS.food, includeInStrict: false },

    // ── Competitors ──────────────────────────────────────────────────────────
    { filter: '"tourism"="hotel"',       radius: COMPETITOR_RADIUS, includeInStrict: true },
    { filter: '"tourism"="apartment"',   radius: COMPETITOR_RADIUS, includeInStrict: true },
    { filter: '"tourism"="guest_house"', radius: COMPETITOR_RADIUS, includeInStrict: true },
    { filter: '"tourism"="hostel"',      radius: COMPETITOR_RADIUS, includeInStrict: true },
    { filter: '"tourism"="motel"',       radius: COMPETITOR_RADIUS, includeInStrict: false },
  ];

  const parts: string[] = [];
  for (const s of selectors) {
    if (!broad && !s.includeInStrict) continue;
    const radius = Math.max(150, Math.round(s.radius * radiusScale));
    parts.push(...makeAround(s.filter, radius, lat, lon, broad));
  }

  return parts;
}

function buildQuery(clauses: string[]): string {
  return `[out:json][timeout:18];(${clauses.join('')});out center;`;
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

async function fetchOverpassQuery(query: string): Promise<{ elements: OSMElement[]; hadProviderFailure: boolean }> {
  let hadProviderFailure = false;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'asi-landing-location-demo/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      if (!res.ok) {
        hadProviderFailure = true;
        continue;
      }

      const json = await res.json();
      return { elements: (json.elements ?? []) as OSMElement[], hadProviderFailure };
    } catch {
      hadProviderFailure = true;
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  return { elements: [], hadProviderFailure };
}

async function fetchOsmByBatches(clauses: string[]): Promise<{ elements: OSMElement[]; hadProviderFailure: boolean }> {
  let hadProviderFailure = false;
  const all: OSMElement[] = [];

  for (const part of chunk(clauses, 12)) {
    const result = await fetchOverpassQuery(buildQuery(part));
    hadProviderFailure = hadProviderFailure || result.hadProviderFailure;
    all.push(...result.elements);
  }

  return { elements: dedupeElements(all), hadProviderFailure };
}

export interface OsmFetchResult {
  elements: OSMElement[];
  hadProviderFailure: boolean;
  /** Primary full query failed across endpoints; a smaller query recovered data */
  usedFallbackQuery?: boolean;
}

/** Reduced query: fewer selectors, single batch — last resort when full pipeline fails */
function buildMinimalClauses(lat: number, lon: number): string[] {
  const r = (meters: number, filter: string) => makeAround(filter, meters, lat, lon, true);
  return [
    ...r(CATEGORY_RADIUS.metro, '"railway"="subway_entrance"'),
    ...r(CATEGORY_RADIUS.metro, '"station"="subway"'),
    ...r(CATEGORY_RADIUS.attraction, '"tourism"="attraction"'),
    ...r(COMPETITOR_RADIUS, '"tourism"="hotel"'),
    ...r(COMPETITOR_RADIUS, '"tourism"="guest_house"'),
  ];
}

async function fetchOsmDataMinimal(lat: number, lon: number): Promise<OsmFetchResult> {
  const clauses = buildMinimalClauses(lat, lon);
  const result = await fetchOverpassQuery(buildQuery(clauses));
  return {
    elements: result.elements,
    hadProviderFailure: result.hadProviderFailure,
    usedFallbackQuery: true,
  };
}

export async function fetchOsmData(lat: number, lon: number): Promise<OsmFetchResult> {
  const strictClauses = buildClauses(lat, lon, 1, false);
  const strictResult = await fetchOsmByBatches(strictClauses);
  const strictElements = dedupeElements(strictResult.elements);

  // If strict filters return enough data, skip the broader fallback.
  if (strictElements.length >= 12) {
    return { elements: strictElements, hadProviderFailure: strictResult.hadProviderFailure };
  }

  const fallbackClauses = buildClauses(lat, lon, 1.4, true);
  const fallbackResult = await fetchOsmByBatches(fallbackClauses);
  const merged = dedupeElements([...strictElements, ...fallbackResult.elements]);
  const hadProviderFailure = strictResult.hadProviderFailure || fallbackResult.hadProviderFailure;

  if (merged.length === 0 && hadProviderFailure) {
    console.warn(
      `[location] magnet_provider primary_exhausted lat=${lat} lon=${lon} trying=minimal_overpass`,
    );
    const minimal = await fetchOsmDataMinimal(lat, lon);
    if (minimal.elements.length > 0) {
      console.warn(
        `[location] magnet_provider status=recovered via=minimal_overpass count=${minimal.elements.length}`,
      );
      return {
        elements: dedupeElements(minimal.elements),
        hadProviderFailure: minimal.hadProviderFailure,
        usedFallbackQuery: true,
      };
    }
    console.warn(`[location] magnet_provider status=all_failed lat=${lat} lon=${lon}`);
  }

  return { elements: merged, hadProviderFailure };
}

/** Map a raw OSM element to a category id + display name, or null if unrecognised */
export function classifyElement(el: OSMElement): { categoryId: string; name: string } | null {
  const t = el.tags ?? {};

  // ── Strong magnets ──────────────────────────────────────────────────────────
  // Metro: only actual subway systems (underground rapid transit).
  // railway=station alone is NOT sufficient — that covers commuter/intercity rail
  // which belongs in the railway_station category below.
  if (t.railway === 'subway_entrance' || t.station === 'subway')
    return { categoryId: 'metro', name: t.name || 'Метро' };

  // Major tourism/cultural objects only — local memorials and parks excluded
  if (t.tourism === 'attraction' || t.tourism === 'museum' || t.tourism === 'gallery' || t.historic === 'monument')
    return { categoryId: 'attraction', name: t.name || 'Достопримечательность' };

  if (t.amenity === 'university')
    return { categoryId: 'university', name: t.name || 'Университет' };

  // Vocational / local colleges — neighborhood infrastructure, not city-scale pull
  if (t.amenity === 'college')
    return { categoryId: 'education_local', name: t.name || 'Колледж' };

  // ── Medium: Railway stations + major bus hubs (commuter / intercity) ─────────
  // Classified AFTER metro so station=subway is never double-matched here.
  if (t.amenity === 'bus_station')
    return { categoryId: 'railway_station', name: t.name || 'Транспортный узел' };

  if (t.railway === 'station' || t.railway === 'halt')
    return { categoryId: 'railway_station', name: t.name || 'Станция' };

  // ── Medium magnets ──────────────────────────────────────────────────────────
  // City-scale entertainment only (sports centres are local — not classified)
  if (t.amenity === 'cinema' || t.amenity === 'theatre' || t.amenity === 'arts_centre' || t.amenity === 'nightclub')
    return { categoryId: 'entertainment', name: t.name || t.amenity || 'Развлечение' };

  // Large shopping formats (city-scale draw)
  if (t.shop === 'mall' || t.shop === 'department_store')
    return { categoryId: 'shopping_major', name: t.name || 'ТЦ' };

  // Offices and banks — district/medium level (not strong demand generators)
  if (t.office || t.amenity === 'bank')
    return { categoryId: 'business', name: t.name || 'Офис' };

  // ── Accessibility: stop positions only (not scored as attraction magnets) ───
  if (t.highway === 'bus_stop' || t.public_transport === 'stop_position' || t.public_transport === 'platform' || t.railway === 'tram_stop')
    return { categoryId: 'accessibility_stop', name: t.name || 'Остановка' };

  // Everyday retail — only formats that imply recurring household visits
  if (t.shop === 'supermarket' || t.shop === 'convenience')
    return { categoryId: 'shopping_local', name: t.name || 'Магазин' };

  if (t.amenity === 'restaurant' || t.amenity === 'cafe' || t.amenity === 'fast_food' || t.amenity === 'bar' || t.amenity === 'pub')
    return { categoryId: 'food', name: t.name || t.amenity || 'Кафе' };

  // ── Competitors ─────────────────────────────────────────────────────────────
  if (t.tourism === 'hotel' || t.tourism === 'apartment' || t.tourism === 'guest_house' || t.tourism === 'hostel' || t.tourism === 'motel')
    return { categoryId: 'competitor', name: t.name || t.tourism || 'Объект аренды' };

  return null;
}
