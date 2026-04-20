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
  /** When set, query node+way+relation even in strict mode (needed for highways, landuse, runways). */
  allGeometries?: boolean;
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
    // ── Tier 1: Strong regional anchors ──────────────────────────────────────

    // Metro: only genuine subway/underground systems.
    { filter: '"railway"="subway_entrance"', radius: CATEGORY_RADIUS.metro,    includeInStrict: true  },
    { filter: '"station"="subway"',          radius: CATEGORY_RADIUS.metro,    includeInStrict: true  },

    // Airport: major air traffic hubs — very strong demand generator
    { filter: '"aeroway"="aerodrome"',       radius: CATEGORY_RADIUS.airport,  includeInStrict: true  },
    { filter: '"aeroway"="terminal"',        radius: CATEGORY_RADIUS.airport,  includeInStrict: false },

    // Attractions (major tourism, monuments)
    { filter: '"tourism"="attraction"', radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"historic"="monument"',  radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"tourism"="museum"',     radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"tourism"="gallery"',    radius: CATEGORY_RADIUS.attraction, includeInStrict: false },

    // Hospital / medical cluster — evergreen demand from staff & visitors
    { filter: '"amenity"="hospital"',      radius: CATEGORY_RADIUS.hospital, includeInStrict: true  },
    { filter: '"healthcare"="hospital"',   radius: CATEGORY_RADIUS.hospital, includeInStrict: false },

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
    { filter: '"railway"="station"',       radius: CATEGORY_RADIUS.railway_station, includeInStrict: true  },
    { filter: '"railway"="halt"',          radius: CATEGORY_RADIUS.railway_station, includeInStrict: false },
    // Major surface transit hubs
    { filter: '"amenity"="bus_station"',   radius: CATEGORY_RADIUS.railway_station, includeInStrict: true  },

    // Entertainment (city-scale venues)
    { filter: '"amenity"="cinema"',     radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="theatre"',    radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="arts_centre"',radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="nightclub"',  radius: CATEGORY_RADIUS.entertainment, includeInStrict: false },

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
    { filter: '"public_transport"="platform"',      radius: CATEGORY_RADIUS.accessibility_stop, includeInStrict: false },
    { filter: '"railway"="tram_stop"',              radius: CATEGORY_RADIUS.accessibility_stop, includeInStrict: false },

    // Supermarkets (weak local signal)
    { filter: '"shop"="supermarket"', radius: CATEGORY_RADIUS.shopping_local, includeInStrict: true },

    // Food (weak — only valuable as cluster proxy)
    { filter: '"amenity"="restaurant"', radius: CATEGORY_RADIUS.food, includeInStrict: true },
    { filter: '"amenity"="cafe"',       radius: CATEGORY_RADIUS.food, includeInStrict: true },
    { filter: '"amenity"="fast_food"',  radius: CATEGORY_RADIUS.food, includeInStrict: true },
    { filter: '"amenity"="bar"',        radius: CATEGORY_RADIUS.food, includeInStrict: false },

    // ── Competitors (non-hotel STR supply) ───────────────────────────────────
    // Note: tourism=hotel is handled by major_hotel selector above + classifyElement split.
    { filter: '"tourism"="apartment"',   radius: COMPETITOR_RADIUS, includeInStrict: true },
    { filter: '"tourism"="guest_house"', radius: COMPETITOR_RADIUS, includeInStrict: true },
    { filter: '"tourism"="hostel"',      radius: COMPETITOR_RADIUS, includeInStrict: true },
    { filter: '"tourism"="motel"',       radius: COMPETITOR_RADIUS, includeInStrict: false },

    // ── Neighborhood environment (strict + full geometry — independent of commercial score) ──
    { filter: '"highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link)$"', radius: 520, includeInStrict: true, allGeometries: true },
    { filter: '"aeroway"="runway"',       radius: 2600, includeInStrict: true, allGeometries: true },
    { filter: '"aeroway"="taxiway"',      radius: 900,  includeInStrict: true, allGeometries: true },
    { filter: '"landuse"="industrial"',  radius: 1100, includeInStrict: true, allGeometries: true },
    { filter: '"industrial"="warehouse"', radius: 950, includeInStrict: true, allGeometries: true },
    { filter: '"man_made"="works"',       radius: 1000, includeInStrict: true, allGeometries: true },
    { filter: '"building"="industrial"', radius: 800,  includeInStrict: true, allGeometries: true },
    { filter: '"amenity"="nightclub"',    radius: 360,  includeInStrict: true, allGeometries: true },
    { filter: '"amenity"="bar"',          radius: 300,  includeInStrict: true, allGeometries: true },
    { filter: '"amenity"="pub"',          radius: 280,  includeInStrict: true, allGeometries: true },
    { filter: '"railway"="rail"',         radius: 520,  includeInStrict: true, allGeometries: true },
    // Spatial foundation v1 — barrier + walkable-corridor proxies (strict; light batch)
    { filter: '"natural"="water"',        radius: 620,  includeInStrict: true, allGeometries: true },
    { filter: '"waterway"="riverbank"',   radius: 620,  includeInStrict: true, allGeometries: true },
    { filter: '"landuse"="reservoir"',    radius: 620,  includeInStrict: true, allGeometries: true },
    {
      filter: '"highway"~"^(residential|secondary|tertiary|living_street|pedestrian|unclassified|service)$"',
      radius: 420,
      includeInStrict: true,
      allGeometries: true,
    },
  ];

  const parts: string[] = [];
  for (const s of selectors) {
    if (!broad && !s.includeInStrict) continue;
    const radius = Math.max(150, Math.round(s.radius * radiusScale));
    const useAllGeom = s.allGeometries ?? broad;
    parts.push(...makeAround(s.filter, radius, lat, lon, useAllGeom));
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
    ...r(CATEGORY_RADIUS.hospital, '"amenity"="hospital"'),
    ...r(CATEGORY_RADIUS.major_hotel, '"tourism"="hotel"'),
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

/**
 * Luxury hotel chains: their presence is a quality signal independent of star rating.
 * These brands do not operate in commercially weak locations.
 */
const LUXURY_CHAINS = [
  'marriott', 'hilton', 'hyatt', 'sheraton', 'radisson', 'intercontinental',
  'four seasons', 'ritz', 'pullman', 'doubletree', 'crowne plaza', 'holiday inn',
  'ramada', 'wyndham', 'novotel', 'mercure', 'westin', 'sofitel', 'renaissance',
  'kempinski', 'swissôtel', 'swissotel', 'shangri-la', 'fairmont', 'waldorf',
  'mandarin oriental', 'okura', 'lotte hotel', 'azimut', 'cosmos hotel',
  'national hotel', 'metropol', 'savoy', 'astoria', 'lotte',
] as const;

/**
 * Returns true when a tourism=hotel element represents a major 4–5★ property.
 * Checks: OSM stars tag ≥ 4 first; then chain-name heuristic as fallback.
 * Returns false for untagged, 1–3★, or unknown hotels (→ classified as competitor).
 */
function isMajorHotel(t: Record<string, string>): boolean {
  const stars = parseInt(t.stars ?? '0', 10);
  if (stars >= 4) return true;
  const nameLower = (t.name ?? '').toLowerCase();
  return LUXURY_CHAINS.some(chain => nameLower.includes(chain));
}

/** Map a raw OSM element to a category id + display name (+ optional subType), or null if unrecognised */
export function classifyElement(el: OSMElement): { categoryId: string; name: string; subType?: string } | null {
  const t = el.tags ?? {};

  // ── Tier 1: Regional / city-scale anchors ──────────────────────────────────

  // Metro: only actual subway systems (underground rapid transit).
  if (t.railway === 'subway_entrance' || t.station === 'subway')
    return { categoryId: 'metro', name: t.name || 'Метро' };

  // Airports: scheduled / general aviation hubs — exclude helipads (noise + false transport-led).
  if (t.aeroway === 'helipad') return null;
  if (t.aeroway === 'aerodrome' || t.aeroway === 'terminal') {
    const nameLower = (t.name ?? '').toLowerCase();
    if (t.aerodrome === 'helipad' || /heliport|helipad|\bheli pad\b/i.test(nameLower)) return null;
    return { categoryId: 'airport', name: t.name || 'Аэропорт' };
  }

  // Major tourism/cultural objects — local memorials and parks excluded
  if (t.tourism === 'attraction' || t.tourism === 'museum' || t.tourism === 'gallery' || t.historic === 'monument')
    return { categoryId: 'attraction', name: t.name || 'Достопримечательность' };

  // Hospitals / major medical clusters — evergreen demand from staff and visitors
  if (t.amenity === 'hospital' || t.healthcare === 'hospital')
    return { categoryId: 'hospital', name: t.name || 'Больница' };

  // ── Tier 2: District anchors ────────────────────────────────────────────────

  // Major hotels (4–5★ / luxury chains): quality proxy signal.
  // buildAnalysis also adds these to the competitor array for supply pressure.
  if (t.tourism === 'hotel') {
    if (isMajorHotel(t))
      return { categoryId: 'major_hotel', name: t.name || 'Крупный отель' };
    return { categoryId: 'competitor', name: t.name || 'Отель' };
  }

  // Convention / expo / conference centers — corporate demand anchor
  if (t.amenity === 'conference_centre' || t.amenity === 'exhibition_centre' || t.amenity === 'convention_centre')
    return { categoryId: 'convention', name: t.name || 'Конгресс-центр' };

  if (t.amenity === 'university')
    return { categoryId: 'university', name: t.name || 'Университет' };

  // Vocational / local colleges
  if (t.amenity === 'college')
    return { categoryId: 'education_local', name: t.name || 'Колледж' };

  // Railway stations + major bus hubs (classified AFTER metro)
  if (t.amenity === 'bus_station')
    return { categoryId: 'railway_station', name: t.name || 'Транспортный узел' };
  if (t.railway === 'station' || t.railway === 'halt')
    return { categoryId: 'railway_station', name: t.name || 'Станция' };

  // City-scale entertainment (sports centres excluded — local only)
  if (t.amenity === 'cinema' || t.amenity === 'theatre' || t.amenity === 'arts_centre' || t.amenity === 'nightclub')
    return { categoryId: 'entertainment', name: t.name || t.amenity || 'Развлечение' };

  // Large shopping formats (city-scale draw)
  if (t.shop === 'mall' || t.shop === 'department_store')
    return { categoryId: 'shopping_major', name: t.name || 'ТЦ' };

  // Stadiums / arenas — year-round event venues with periodic demand spikes
  // Only large stadiums (leisure=stadium); smaller sports_centre is treated as
  // local and only matched in broad mode (includeInStrict: false).
  if (t.leisure === 'stadium')
    return { categoryId: 'stadium', name: t.name || 'Стадион' };
  if (t.leisure === 'sports_centre' && t.name)
    return { categoryId: 'stadium', name: t.name, subType: 'sports_centre' };

  // Business: factories, works, offices, industrial zones
  if (t.man_made === 'works')
    return { categoryId: 'business', name: t.name || 'Завод', subType: 'factory' };
  if (t.landuse === 'industrial')
    return { categoryId: 'business', name: t.name || 'Промзона', subType: 'industrial' };
  if (t.building === 'industrial')
    return { categoryId: 'business', name: t.name || 'Производство', subType: 'factory' };
  if (t.landuse === 'commercial')
    return { categoryId: 'business', name: t.name || 'Коммерческая зона', subType: 'commercial' };
  if (t.amenity === 'bank')
    return { categoryId: 'business', name: t.name || 'Банк', subType: 'bank' };
  if (t.office) {
    const hasName = Boolean(t.name && t.name.trim());
    return { categoryId: 'business', name: t.name || 'Офис', subType: hasName ? 'office' : 'office_anon' };
  }

  // ── Tier 3: Local / accessibility-only ──────────────────────────────────────

  if (t.highway === 'bus_stop' || t.public_transport === 'stop_position' || t.public_transport === 'platform' || t.railway === 'tram_stop')
    return { categoryId: 'accessibility_stop', name: t.name || 'Остановка' };

  if (t.shop === 'supermarket' || t.shop === 'convenience')
    return { categoryId: 'shopping_local', name: t.name || 'Магазин' };

  if (t.amenity === 'restaurant' || t.amenity === 'cafe' || t.amenity === 'fast_food' || t.amenity === 'bar' || t.amenity === 'pub')
    return { categoryId: 'food', name: t.name || t.amenity || 'Кафе' };

  // ── Competitors (non-major STR supply) ─────────────────────────────────────
  if (t.tourism === 'apartment' || t.tourism === 'guest_house' || t.tourism === 'hostel' || t.tourism === 'motel')
    return { categoryId: 'competitor', name: t.name || t.tourism || 'Объект аренды' };

  return null;
}
