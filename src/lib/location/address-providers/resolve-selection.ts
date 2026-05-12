import type { AddressMarket, AddressSuggestionRow } from './types';
import { googleForwardGeocode, googlePlaceDetailsLatLon } from './geocode-google';
import { twogisGeocode } from './geocode-2gis';
import { geocodeWithFallback } from '../providers/geocoding';
import type { GeocodeResult } from '../providers/types';

function googleKey(): string | null {
  const k =
    (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim() ||
    (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
  return k || null;
}

function twogisCatalogKey(): string | null {
  const k = (process.env.TWOGIS_CATALOG_API_KEY ?? '').trim();
  return k || null;
}

function parseInlineCoords(s: AddressSuggestionRow): { lat: number; lon: number } | null {
  if (s.lat == null || s.lon == null) return null;
  const lat = parseFloat(String(s.lat));
  const lon = parseFloat(String(s.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export type ResolvedAddressSelection = {
  lat: number;
  lon: number;
  displayName?: string;
  /** Structured forward-geocode row when the resolver had one (for demo analyze / RU sanity). */
  geocodeResult?: GeocodeResult;
};

/**
 * Resolves a picked suggestion to coordinates using Google when available,
 * then shared OSM fallbacks via `geocodeWithFallback`.
 */
export async function resolveAddressSelection(
  market: AddressMarket,
  suggestion: AddressSuggestionRow,
): Promise<ResolvedAddressSelection | null> {
  const inline = parseInlineCoords(suggestion);
  if (inline) {
    return { lat: inline.lat, lon: inline.lon };
  }

  const value = suggestion.value.trim();
  if (!value) return null;

  const gk = googleKey();
  const geoOpts = { region: market === 'ru' ? 'ru' as const : undefined };

  if (gk && suggestion.placeId) {
    const r = await googlePlaceDetailsLatLon(suggestion.placeId, gk);
    if (r) return { lat: r.lat, lon: r.lon, displayName: r.displayName, geocodeResult: r };
  }
  if (gk) {
    const g = await googleForwardGeocode(value, gk, geoOpts);
    if (g) return { lat: g.lat, lon: g.lon, displayName: g.displayName, geocodeResult: g };
  }

  // RU-only vendor fallback: 2GIS geocoder can resolve many RU addresses when Google key is missing/denied.
  if (market === 'ru') {
    const dgKey = twogisCatalogKey();
    if (dgKey) {
      const dg = await twogisGeocode({ apiKey: dgKey, text: value });
      if (dg) return { lat: dg.lat, lon: dg.lon, displayName: dg.displayName, geocodeResult: dg };
    }
  }

  const { result } = await geocodeWithFallback(value);
  if (result) {
    return {
      lat: result.lat,
      lon: result.lon,
      displayName: result.displayName,
      geocodeResult: result,
    };
  }

  return null;
}
