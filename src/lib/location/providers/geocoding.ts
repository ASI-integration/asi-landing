// ── Nominatim geocoding provider ──────────────────────────────────────────────
// Converts addresses ↔ coordinates using OpenStreetMap's Nominatim service.
//
// This path is SEPARATE from magnet/competitor fetching (osm-overpass.ts).
// The scoring engine never calls geocoding — geocoding is only an entry-point
// helper when the caller has an address string rather than a coordinate.
//
// Locale-primary geocoding is in address-providers (Google for all markets, then OSM fallbacks).
// This module remains the shared Nominatim → Photon fallback chain.

import type { GeocodingProvider, GeocodeResult } from './types';

const USER_AGENT = 'asi-landing-location-demo/1.0';
const TIMEOUT_MS = 8_000;

export interface GeocodeAttemptStatus {
  id: string;
  ok: boolean;
}

type NominatimHit = {
  lat: string;
  lon: string;
  display_name?: string;
  class?: string;
  type?: string;
  importance?: number;
  address?: Record<string, string>;
};

function nominatimHousePreferenceScore(hit: NominatimHit): number {
  const addr = hit.address ?? {};
  const hasHouse = Boolean(addr.house_number || addr.house_name);
  let s = hit.importance ?? 0;
  if (hasHouse) s += 85;

  const cls = hit.class ?? '';
  const typ = hit.type ?? '';

  if (cls === 'building' || typ === 'house') s += 45;
  if (cls === 'place' && typ === 'house') s += 95;

  if (
    cls === 'amenity' ||
    cls === 'shop' ||
    cls === 'healthcare' ||
    cls === 'office' ||
    typ === 'clinic' ||
    typ === 'doctors'
  ) {
    s -= 75;
  }
  if (cls === 'highway') s -= 35;

  return s;
}

async function nominatimGeocodeSmart(address: string, preferStreetHouse: boolean): Promise<GeocodeResult | null> {
  try {
    const limit = preferStreetHouse ? 12 : 1;
    const details = preferStreetHouse ? 1 : 0;
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?format=json&q=${encodeURIComponent(address)}&limit=${limit}&addressdetails=${details}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ru,en' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as NominatimHit[];
    if (!data.length) return null;

    if (!preferStreetHouse) {
      const h = data[0];
      return {
        lat: parseFloat(h.lat),
        lon: parseFloat(h.lon),
        displayName: h.display_name,
      };
    }

    let best = data[0];
    let bestScore = nominatimHousePreferenceScore(best);
    for (const h of data.slice(1)) {
      const sc = nominatimHousePreferenceScore(h);
      if (sc > bestScore) {
        best = h;
        bestScore = sc;
      }
    }

    return {
      lat: parseFloat(best.lat),
      lon: parseFloat(best.lon),
      displayName: best.display_name,
      geocodeDebug: {
        nominatimClass: best.class,
        nominatimType: best.type,
      },
    };
  } catch {
    return null;
  }
}

function createNominatimGeocodingProvider(): GeocodingProvider {
  return {
    id: 'nominatim',

    async geocode(address: string): Promise<GeocodeResult | null> {
      return nominatimGeocodeSmart(address, false);
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

type PhotonProps = {
  name?: string;
  street?: string;
  city?: string;
  country?: string;
  housenumber?: string;
  postcode?: string;
  osm_key?: string;
  osm_value?: string;
};

function photonHousePreferenceScore(props: PhotonProps | undefined): number {
  if (!props) return 0;
  let s = 0;
  if (props.housenumber && props.housenumber.trim()) s += 75;
  if (props.street && props.street.trim()) s += 15;

  const k = props.osm_key ?? '';
  if (k === 'building' || k === 'addr') s += 40;
  if (k === 'amenity' || k === 'shop' || k === 'healthcare') s -= 55;

  return s;
}

async function photonGeocodeSmart(address: string, preferStreetHouse: boolean): Promise<GeocodeResult | null> {
  try {
    const limit = preferStreetHouse ? 10 : 1;
    const url =
      `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=${limit}&lang=ru`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: PhotonProps;
      }>;
    };
    const feats = data.features ?? [];
    if (!feats.length) return null;

    type PhotonMapped = { lat: number; lon: number; props?: PhotonProps };
    const mapped: PhotonMapped[] = [];
    for (const f of feats) {
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const [lon, lat] = coords;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      mapped.push({ lat, lon, props: f.properties });
    }

    if (!mapped.length) return null;

    let pick = mapped[0]!;
    if (preferStreetHouse && mapped.length > 1) {
      for (const m of mapped.slice(1)) {
        if (photonHousePreferenceScore(m.props) > photonHousePreferenceScore(pick.props)) pick = m;
      }
    }

    const props = pick.props;
    const displayName = [props?.name, props?.street, props?.housenumber, props?.city, props?.country]
      .filter(Boolean)
      .join(', ');
    return {
      lat: pick.lat,
      lon: pick.lon,
      displayName: displayName || undefined,
      geocodeDebug:
        preferStreetHouse && props
          ? { winnerTypes: [props.osm_key ?? '', props.osm_value ?? ''].filter(Boolean) }
          : undefined,
    };
  } catch {
    return null;
  }
}

/** Photon (Komoot) — OSM-derived search API, second step when Nominatim is down or empty */
function createPhotonGeocodingProvider(): GeocodingProvider {
  return {
    id: 'photon',

    async geocode(address: string): Promise<GeocodeResult | null> {
      return photonGeocodeSmart(address, false);
    },
  };
}

const photonGeocodingProvider: GeocodingProvider = createPhotonGeocodingProvider();

export type GeocodeFallbackOptions = {
  /**
   * Prefer building/house hits over amenity POIs when the query looks like street + number.
   */
  preferStreetHouse?: boolean;
};

/**
 * Try geocoders in order; log outcome. Does not throw.
 */
export async function geocodeWithFallback(
  address: string,
  options?: GeocodeFallbackOptions,
): Promise<{
  result: GeocodeResult | null;
  /** Provider that returned coordinates, if any */
  winner: string | null;
  attempts: GeocodeAttemptStatus[];
}> {
  const prefer = options?.preferStreetHouse ?? false;
  const attempts: GeocodeAttemptStatus[] = [];

  try {
    const r = await nominatimGeocodeSmart(address, prefer);
    attempts.push({ id: 'nominatim', ok: r != null });
    if (r) {
      return { result: r, winner: 'nominatim', attempts };
    }
  } catch {
    attempts.push({ id: 'nominatim', ok: false });
  }

  try {
    const r = await photonGeocodeSmart(address, prefer);
    attempts.push({ id: 'photon', ok: r != null });
    if (r) {
      const failed = attempts.filter(a => !a.ok).map(a => a.id);
      if (failed.length) {
        console.warn(
          `[location-geocode] geocode_chain winner=photon failed_before=[${failed.join(',')}]`,
        );
      }
      return { result: r, winner: 'photon', attempts };
    }
  } catch {
    attempts.push({ id: 'photon', ok: false });
  }

  console.warn(
    `[location-geocode] geocode_chain status=all_failed attempts=[${attempts.map(a => `${a.id}:${a.ok}`).join(',')}]`,
  );
  return { result: null, winner: null, attempts };
}
