import type { GeocodeResult } from '../providers/types';
import type { GeocodeAttemptStatus } from '../providers/geocoding';
import { geocodeWithFallback } from '../providers/geocoding';
import type { AddressMarket } from './types';
import { googleForwardGeocode } from './geocode-google';
import { buildRuMetroGeocodeVariants, resolveRuAddressSearchProfiles } from './ru-address-search-profile';
import { normalizeRuAddressQuery } from './ru-normalize';

function googleKey(): string | null {
  const k =
    (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim() ||
    (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
  return k || null;
}

async function geocodeSingleAddress(
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

function uniqueGeocodeAttempts(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of addresses) {
    const t = a.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Plain-string geocoding for API routes: Google (all markets), then Nominatim → Photon.
 * RU: after the raw string, tries metro-profile disambiguation variants (capped).
 */
export async function geocodePlainAddressForMarket(
  market: AddressMarket,
  address: string,
): Promise<{
  result: GeocodeResult | null;
  winner: string | null;
  attempts: GeocodeAttemptStatus[];
}> {
  const trimmed = address.trim();
  const variantList =
    market === 'ru'
      ? uniqueGeocodeAttempts([
          trimmed,
          ...buildRuMetroGeocodeVariants(
            trimmed,
            resolveRuAddressSearchProfiles({
              normalizedQuery: normalizeRuAddressQuery(trimmed).normalized,
              contextCity: null,
              biasLat: null,
              biasLon: null,
            }),
          ),
        ])
      : [trimmed];

  const allAttempts: GeocodeAttemptStatus[] = [];
  let lastWinner: string | null = null;

  for (const addr of variantList) {
    const r = await geocodeSingleAddress(market, addr);
    allAttempts.push(...r.attempts);
    lastWinner = r.winner;
    if (r.result) {
      return { result: r.result, winner: r.winner, attempts: allAttempts };
    }
  }

  return {
    result: null,
    winner: lastWinner,
    attempts: allAttempts,
  };
}
