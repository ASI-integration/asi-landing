import type { OSMElement } from './types';
import { CATEGORY_RADIUS, COMPETITOR_RADIUS } from './config';

// ── Overpass API — fetch real nearby objects ──────────────────────────────────

export async function fetchOsmData(lat: number, lon: number): Promise<OSMElement[]> {
  const parts = [
    // Transport magnets
    `node["railway"="subway_entrance"](around:${CATEGORY_RADIUS.metro},${lat},${lon});`,
    `node["highway"="bus_stop"](around:${CATEGORY_RADIUS.transport},${lat},${lon});`,
    `node["public_transport"="stop_position"](around:${CATEGORY_RADIUS.transport},${lat},${lon});`,
    // Attractions
    `node["tourism"="attraction"](around:${CATEGORY_RADIUS.attraction},${lat},${lon});`,
    `node["historic"="monument"](around:${CATEGORY_RADIUS.attraction},${lat},${lon});`,
    `node["historic"="memorial"](around:${CATEGORY_RADIUS.attraction},${lat},${lon});`,
    // Business
    `node["office"="yes"]["name"](around:${CATEGORY_RADIUS.business},${lat},${lon});`,
    `node["office"="company"]["name"](around:${CATEGORY_RADIUS.business},${lat},${lon});`,
    // Entertainment
    `node["amenity"="cinema"](around:${CATEGORY_RADIUS.entertainment},${lat},${lon});`,
    `node["amenity"="theatre"](around:${CATEGORY_RADIUS.entertainment},${lat},${lon});`,
    `node["amenity"="arts_centre"](around:${CATEGORY_RADIUS.entertainment},${lat},${lon});`,
    `node["amenity"="nightclub"](around:${CATEGORY_RADIUS.entertainment},${lat},${lon});`,
    // Shopping
    `node["shop"="supermarket"](around:${CATEGORY_RADIUS.shopping},${lat},${lon});`,
    `node["shop"="mall"](around:${CATEGORY_RADIUS.shopping},${lat},${lon});`,
    `node["shop"="department_store"](around:${CATEGORY_RADIUS.shopping},${lat},${lon});`,
    // Food
    `node["amenity"="restaurant"](around:${CATEGORY_RADIUS.food},${lat},${lon});`,
    `node["amenity"="cafe"](around:${CATEGORY_RADIUS.food},${lat},${lon});`,
    `node["amenity"="fast_food"](around:${CATEGORY_RADIUS.food},${lat},${lon});`,
    // Competitors
    `node["tourism"="hotel"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
    `node["tourism"="apartment"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
    `node["tourism"="guest_house"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
    `node["tourism"="hostel"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
    `way["tourism"="hotel"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
    `way["tourism"="apartment"](around:${COMPETITOR_RADIUS},${lat},${lon});`,
  ];

  const query = `[out:json][timeout:14];(${parts.join('')});out center;`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.elements ?? []) as OSMElement[];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Map a raw OSM element to a category id + display name, or null if unrecognised */
export function classifyElement(el: OSMElement): { categoryId: string; name: string } | null {
  const t = el.tags ?? {};

  if (t.railway === 'subway_entrance')
    return { categoryId: 'metro', name: t.name || 'Метро' };

  if (t.highway === 'bus_stop' || t.public_transport === 'stop_position')
    return { categoryId: 'transport', name: t.name || 'Остановка' };

  if (t.tourism === 'attraction' || t.historic === 'monument' || t.historic === 'memorial')
    return { categoryId: 'attraction', name: t.name || 'Достопримечательность' };

  if (t.office && t.name)
    return { categoryId: 'business', name: t.name };

  if (t.amenity === 'cinema' || t.amenity === 'theatre' || t.amenity === 'arts_centre' || t.amenity === 'nightclub')
    return { categoryId: 'entertainment', name: t.name || t.amenity || 'Развлечение' };

  if (t.shop === 'supermarket' || t.shop === 'mall' || t.shop === 'department_store')
    return { categoryId: 'shopping', name: t.name || 'Магазин' };

  if (t.amenity === 'restaurant' || t.amenity === 'cafe' || t.amenity === 'fast_food')
    return { categoryId: 'food', name: t.name || t.amenity || 'Кафе' };

  if (t.tourism === 'hotel' || t.tourism === 'apartment' || t.tourism === 'guest_house' || t.tourism === 'hostel')
    return { categoryId: 'competitor', name: t.name || t.tourism || 'Объект аренды' };

  return null;
}
