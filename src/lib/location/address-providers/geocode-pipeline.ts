import type { GeocodeResult } from '../providers/types';
import type { GeocodeAttemptStatus } from '../providers/geocoding';
import { geocodeWithFallback } from '../providers/geocoding';
import type { AddressMarket } from './types';
import { googleForwardGeocode } from './geocode-google';
import { yandexGeocode } from './geocode-yandex';

function googleKey(): string | null {
  const k =
    (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim() ||
    (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
  return k || null;
}

function yandexKey(): string | null {
  const k = (process.env.YANDEX_MAPS_API_KEY ?? '').trim();
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
    const yk = yandexKey();
    if (yk) {
      try {
        const r = await yandexGeocode({ apiKey: yk, text: address });
        attempts.push({ id: 'yandex', ok: r != null });
        if (r) {
          return { result: r, winner: 'yandex', attempts };
        }
      } catch {
        attempts.push({ id: 'yandex', ok: false });
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
