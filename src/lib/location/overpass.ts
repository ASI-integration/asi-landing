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
    // Transport magnets
    { filter: '"railway"="subway_entrance"', radius: CATEGORY_RADIUS.metro, includeInStrict: true },
    { filter: '"station"="subway"', radius: CATEGORY_RADIUS.metro, includeInStrict: false },
    { filter: '"railway"="station"', radius: CATEGORY_RADIUS.metro, includeInStrict: false },
    { filter: '"highway"="bus_stop"', radius: CATEGORY_RADIUS.transport, includeInStrict: true },
    { filter: '"public_transport"="stop_position"', radius: CATEGORY_RADIUS.transport, includeInStrict: true },
    { filter: '"public_transport"="platform"', radius: CATEGORY_RADIUS.transport, includeInStrict: false },
    { filter: '"railway"="tram_stop"', radius: CATEGORY_RADIUS.transport, includeInStrict: false },

    // Attractions
    { filter: '"tourism"="attraction"', radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"historic"="monument"', radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"historic"="memorial"', radius: CATEGORY_RADIUS.attraction, includeInStrict: true },
    { filter: '"tourism"="museum"', radius: CATEGORY_RADIUS.attraction, includeInStrict: false },
    { filter: '"tourism"="gallery"', radius: CATEGORY_RADIUS.attraction, includeInStrict: false },
    { filter: '"leisure"="park"', radius: CATEGORY_RADIUS.attraction, includeInStrict: false },

    // Business
    { filter: '"office"', radius: CATEGORY_RADIUS.business, includeInStrict: true },
    { filter: '"amenity"="bank"', radius: CATEGORY_RADIUS.business, includeInStrict: false },
    { filter: '"amenity"="university"', radius: CATEGORY_RADIUS.business, includeInStrict: false },

    // Entertainment
    { filter: '"amenity"="cinema"', radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="theatre"', radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="arts_centre"', radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"amenity"="nightclub"', radius: CATEGORY_RADIUS.entertainment, includeInStrict: true },
    { filter: '"leisure"="sports_centre"', radius: CATEGORY_RADIUS.entertainment, includeInStrict: false },

    // Shopping
    { filter: '"shop"="supermarket"', radius: CATEGORY_RADIUS.shopping, includeInStrict: true },
    { filter: '"shop"="mall"', radius: CATEGORY_RADIUS.shopping, includeInStrict: true },
    { filter: '"shop"="department_store"', radius: CATEGORY_RADIUS.shopping, includeInStrict: true },

    // Food
    { filter: '"amenity"="restaurant"', radius: CATEGORY_RADIUS.food, includeInStrict: true },
    { filter: '"amenity"="cafe"', radius: CATEGORY_RADIUS.food, includeInStrict: true },
    { filter: '"amenity"="fast_food"', radius: CATEGORY_RADIUS.food, includeInStrict: true },
    { filter: '"amenity"="bar"', radius: CATEGORY_RADIUS.food, includeInStrict: false },

    // Competitors
    { filter: '"tourism"="hotel"', radius: COMPETITOR_RADIUS, includeInStrict: true },
    { filter: '"tourism"="apartment"', radius: COMPETITOR_RADIUS, includeInStrict: true },
    { filter: '"tourism"="guest_house"', radius: COMPETITOR_RADIUS, includeInStrict: true },
    { filter: '"tourism"="hostel"', radius: COMPETITOR_RADIUS, includeInStrict: true },
    { filter: '"tourism"="motel"', radius: COMPETITOR_RADIUS, includeInStrict: false },
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

export async function fetchOsmData(lat: number, lon: number): Promise<OSMElement[]> {
  const strictClauses = buildClauses(lat, lon, 1, false);
  const strictResult = await fetchOsmByBatches(strictClauses);
  const strictElements = dedupeElements(strictResult.elements);

  // If strict filters return too little, retry with wider radii and broader category sources.
  if (strictElements.length >= 12) {
    return strictElements;
  }

  const fallbackClauses = buildClauses(lat, lon, 1.4, true);
  const fallbackResult = await fetchOsmByBatches(fallbackClauses);
  const merged = dedupeElements([...strictElements, ...fallbackResult.elements]);

  if (merged.length === 0 && (strictResult.hadProviderFailure || fallbackResult.hadProviderFailure)) {
    console.warn(`[location-demo] overpass_failed lat=${lat} lon=${lon}`);
  }

  return merged;
}

/** Map a raw OSM element to a category id + display name, or null if unrecognised */
export function classifyElement(el: OSMElement): { categoryId: string; name: string } | null {
  const t = el.tags ?? {};

  if (t.railway === 'subway_entrance' || t.station === 'subway' || (t.railway === 'station' && t.subway !== 'no'))
    return { categoryId: 'metro', name: t.name || 'Метро' };

  if (t.highway === 'bus_stop' || t.public_transport === 'stop_position' || t.public_transport === 'platform' || t.railway === 'tram_stop')
    return { categoryId: 'transport', name: t.name || 'Остановка' };

  if (
    t.tourism === 'attraction'
    || t.tourism === 'museum'
    || t.tourism === 'gallery'
    || t.historic === 'monument'
    || t.historic === 'memorial'
    || t.leisure === 'park'
  )
    return { categoryId: 'attraction', name: t.name || 'Достопримечательность' };

  if (t.office || t.amenity === 'bank' || t.amenity === 'university')
    return { categoryId: 'business', name: t.name || 'Бизнес-объект' };

  if (t.amenity === 'cinema' || t.amenity === 'theatre' || t.amenity === 'arts_centre' || t.amenity === 'nightclub' || t.leisure === 'sports_centre')
    return { categoryId: 'entertainment', name: t.name || t.amenity || 'Развлечение' };

  if (t.shop === 'supermarket' || t.shop === 'mall' || t.shop === 'department_store' || Boolean(t.shop))
    return { categoryId: 'shopping', name: t.name || 'Магазин' };

  if (t.amenity === 'restaurant' || t.amenity === 'cafe' || t.amenity === 'fast_food' || t.amenity === 'bar' || t.amenity === 'pub')
    return { categoryId: 'food', name: t.name || t.amenity || 'Кафе' };

  if (t.tourism === 'hotel' || t.tourism === 'apartment' || t.tourism === 'guest_house' || t.tourism === 'hostel' || t.tourism === 'motel')
    return { categoryId: 'competitor', name: t.name || t.tourism || 'Объект аренды' };

  return null;
}
