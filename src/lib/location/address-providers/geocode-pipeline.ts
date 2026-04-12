import type { GeocodeResult } from '../providers/types';
import type { GeocodeAttemptStatus } from '../providers/geocoding';
import { geocodeWithFallback } from '../providers/geocoding';
import type { AddressMarket } from './types';
import { googleForwardGeocode } from './geocode-google';
import { twogisGeocode } from './geocode-2gis';

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

/**
 * Plain-string geocoding for API routes: market-primary vendor, then Nominatim → Photon.
 */
export async function geocodePlainAddressForMarket(
  market: AddressMarket,
  address: string,
): Promise<{
  result: GeocodeResult | null;
  winner: string | null;
  attempts: GeocodeAttemptStatus[];
}> {
  const attempts: GeocodeAttemptStatus[] = [];

  if (market === 'ru') {
    const tk = twogisCatalogKey();
    if (tk) {
      try {
        const r = await twogisGeocode({ apiKey: tk, text: address });
        attempts.push({ id: 'twogis_geocode', ok: r != null });
        if (r) {
          return { result: r, winner: 'twogis_geocode', attempts };
        }
      } catch {
        attempts.push({ id: 'twogis_geocode', ok: false });
      }
    }
  } else {
    const gk = googleKey();
    if (gk) {
      try {
        const r = await googleForwardGeocode(address, gk);
        attempts.push({ id: 'google_geocode', ok: r != null });
        if (r) {
          return { result: r, winner: 'google_geocode', attempts };
        }
      } catch {
        attempts.push({ id: 'google_geocode', ok: false });
      }
    }
  }

  const fb = await geocodeWithFallback(address);
  return {
    result: fb.result,
    winner: fb.winner,
    attempts: [...attempts, ...fb.attempts],
  };
}
