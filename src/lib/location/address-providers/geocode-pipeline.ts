import type { GeocodeResult } from '../providers/types';
import type { GeocodeAttemptStatus } from '../providers/geocoding';
import { geocodeWithFallback } from '../providers/geocoding';
import type { AddressMarket } from './types';
import { googleForwardGeocode } from './geocode-google';

function googleKey(): string | null {
  const k =
    (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim() ||
    (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
  return k || null;
}

/**
 * Plain-string geocoding for API routes: Google (all markets), then Nominatim → Photon.
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
  const gk = googleKey();

  if (gk) {
    try {
      const r = await googleForwardGeocode(address, gk, {
        region: market === 'ru' ? 'ru' : undefined,
      });
      attempts.push({ id: 'google_geocode', ok: r != null });
      if (r) {
        return { result: r, winner: 'google_geocode', attempts };
      }
    } catch {
      attempts.push({ id: 'google_geocode', ok: false });
    }
  }

  const fb = await geocodeWithFallback(address);
  return {
    result: fb.result,
    winner: fb.winner,
    attempts: [...attempts, ...fb.attempts],
  };
}
