import type { AddressMarket, AddressSuggestionRow } from './types';
import { googleForwardGeocode, googlePlaceDetailsLatLon } from './geocode-google';
import { twogisGeocode } from './geocode-2gis';
import { geocodeWithFallback } from '../providers/geocoding';

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

/**
 * Resolves a picked suggestion to coordinates using market-primary providers,
 * then shared OSM fallbacks via `geocodeWithFallback`.
 */
export async function resolveAddressSelection(
  market: AddressMarket,
  suggestion: AddressSuggestionRow,
): Promise<{ lat: number; lon: number; displayName?: string } | null> {
  const inline = parseInlineCoords(suggestion);
  if (inline) {
    return { lat: inline.lat, lon: inline.lon };
  }

  const value = suggestion.value.trim();
  if (!value) return null;

  if (market === 'ru') {
    const tk = twogisCatalogKey();
    if (tk) {
      const rText = await twogisGeocode({ apiKey: tk, text: value });
      if (rText) return { lat: rText.lat, lon: rText.lon, displayName: rText.displayName };
    }
  } else {
    const gk = googleKey();
    if (gk && suggestion.placeId) {
      const r = await googlePlaceDetailsLatLon(suggestion.placeId, gk);
      if (r) return { lat: r.lat, lon: r.lon, displayName: r.displayName };
    }
    if (gk) {
      const g = await googleForwardGeocode(value, gk);
      if (g) return { lat: g.lat, lon: g.lon, displayName: g.displayName };
    }
  }

  const { result } = await geocodeWithFallback(value);
  if (result) {
    return { lat: result.lat, lon: result.lon, displayName: result.displayName };
  }

  return null;
}
