import type { GeocodeResult } from '../providers/types';

const TIMEOUT_MS = 8_000;

interface DgisGeocodeJson {
  meta?: { code?: number };
  result?: {
    items?: Array<{
      full_name?: string;
      name?: string;
      address_name?: string;
      point?: { lat?: number; lon?: number } | string;
    }>;
  };
}

/**
 * Forward geocode via 2GIS Catalog Geocoder API (direct geocoding by address text).
 */
export async function twogisGeocode(params: { apiKey: string; text: string }): Promise<GeocodeResult | null> {
  const q = params.text.trim();
  if (!q) return null;

  const url = new URL('https://catalog.api.2gis.com/3.0/items/geocode');
  url.searchParams.set('key', params.apiKey);
  url.searchParams.set('q', q);
  url.searchParams.set('fields', 'items.point');
  url.searchParams.set('locale', 'ru_RU');

  try {
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as DgisGeocodeJson;
    if (data.meta?.code != null && data.meta.code !== 200) return null;

    const item = data.result?.items?.[0];
    if (!item?.point) return null;

    const parsed = parsePoint(item.point);
    if (!parsed) return null;

    const displayName =
      [item.full_name, item.address_name].filter(Boolean).join(' · ') ||
      item.name ||
      undefined;

    return { lat: parsed.lat, lon: parsed.lon, displayName };
  } catch {
    return null;
  }
}

function parsePoint(point: { lat?: number; lon?: number } | string): { lat: number; lon: number } | null {
  if (typeof point === 'string') {
    const parts = point.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    }
    return null;
  }
  const lat = point.lat;
  const lon = point.lon;
  if (lat == null || lon == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
