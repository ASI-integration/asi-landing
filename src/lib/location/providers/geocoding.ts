// ── Nominatim geocoding provider ──────────────────────────────────────────────
// Converts addresses ↔ coordinates using OpenStreetMap's Nominatim service.
//
// This path is SEPARATE from magnet/competitor fetching (osm-overpass.ts).
// The scoring engine never calls geocoding — geocoding is only an entry-point
// helper when the caller has an address string rather than a coordinate.
//
// To swap to Yandex Geocoder or 2GIS:
//   1. Implement GeocodingProvider with their API
//   2. Export a new singleton and use it in the API route
//   3. The map display vendor (Yandex Maps, 2GIS tiles) stays its own concern

import type { GeocodingProvider, GeocodeResult } from './types';

const USER_AGENT = 'asi-landing-location-demo/1.0';
const TIMEOUT_MS = 8_000;

export interface GeocodeAttemptStatus {
  id: string;
  ok: boolean;
}

function createNominatimGeocodingProvider(): GeocodingProvider {
  return {
    id: 'nominatim',

    async geocode(address: string): Promise<GeocodeResult | null> {
      try {
        const url =
          `https://nominatim.openstreetmap.org/search` +
          `?format=json&q=${encodeURIComponent(address)}&limit=1&addressdetails=0`;

        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ru,en' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!res.ok) return null;

        const data = await res.json() as Array<{ lat: string; lon: string; display_name?: string }>;
        if (!data.length) return null;

        return {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          displayName: data[0].display_name,
        };
      } catch {
        return null;
      }
    },

    async reverseGeocode(lat: number, lon: number): Promise<string | null> {
      try {
        const url =
          `https://nominatim.openstreetmap.org/reverse` +
          `?format=json&lat=${lat}&lon=${lon}&zoom=16`;

        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ru,en' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!res.ok) return null;

        const data = await res.json() as { display_name?: string };
        return data.display_name ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** Default singleton — Nominatim (free, OSM-based). */
export const nominatimGeocodingProvider: GeocodingProvider = createNominatimGeocodingProvider();

/** Photon (Komoot) — OSM-derived search API, second step when Nominatim is down or empty */
function createPhotonGeocodingProvider(): GeocodingProvider {
  return {
    id: 'photon',

    async geocode(address: string): Promise<GeocodeResult | null> {
      try {
        const url =
          `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1&lang=ru`;
        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
          features?: Array<{
            geometry?: { coordinates?: [number, number] };
            properties?: { name?: string; street?: string; city?: string; country?: string };
          }>;
        };
        const f = data.features?.[0];
        const coords = f?.geometry?.coordinates;
        if (!coords || coords.length < 2) return null;
        const [lon, lat] = coords;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const props = f.properties;
        const displayName = [props?.name, props?.street, props?.city, props?.country]
          .filter(Boolean)
          .join(', ');
        return {
          lat,
          lon,
          displayName: displayName || undefined,
        };
      } catch {
        return null;
      }
    },
  };
}

const photonGeocodingProvider: GeocodingProvider = createPhotonGeocodingProvider();

/**
 * Try geocoders in order; log outcome. Does not throw.
 */
export async function geocodeWithFallback(address: string): Promise<{
  result: GeocodeResult | null;
  /** Provider that returned coordinates, if any */
  winner: string | null;
  attempts: GeocodeAttemptStatus[];
}> {
  const attempts: GeocodeAttemptStatus[] = [];
  const chain: GeocodingProvider[] = [nominatimGeocodingProvider, photonGeocodingProvider];

  for (const p of chain) {
    try {
      const r = await p.geocode(address);
      attempts.push({ id: p.id, ok: r != null });
      if (r) {
        const failed = attempts.filter(a => !a.ok).map(a => a.id);
        if (failed.length) {
          console.warn(
            `[location-geocode] geocode_chain winner=${p.id} failed_before=[${failed.join(',')}]`,
          );
        }
        return { result: r, winner: p.id, attempts };
      }
    } catch {
      attempts.push({ id: p.id, ok: false });
    }
  }

  console.warn(
    `[location-geocode] geocode_chain status=all_failed attempts=[${attempts.map(a => `${a.id}:${a.ok}`).join(',')}]`,
  );
  return { result: null, winner: null, attempts };
}
