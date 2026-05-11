/**
 * Pick best Google Geocoding hit when the user typed a street + house number:
 * prefer rooftop / street_address / premise over establishment-only POIs.
 */

import type { GeocodeResult } from '../providers/types';
import { looksLikeRuStreetWithHouseNumber } from './ru-house-number';

export type GoogleGeocodeRawResult = {
  formatted_address?: string;
  geometry?: {
    location?: { lat: number; lng: number };
    location_type?: string;
  };
  types?: string[];
};

function locationTypeScore(locationType: string | undefined): number {
  switch (locationType) {
    case 'ROOFTOP':
      return 110;
    case 'RANGE_INTERPOLATED':
      return 95;
    case 'GEOMETRIC_CENTER':
      return 55;
    case 'APPROXIMATE':
      return 35;
    default:
      return 45;
  }
}

/** Negative when result looks like a POI rather than a postal address. */
function poiPenalty(types: string[] | undefined): number {
  const t = types ?? [];
  const establishmentLike =
    t.includes('establishment') ||
    t.includes('point_of_interest') ||
    t.includes('doctor') ||
    t.includes('health') ||
    t.includes('hospital') ||
    t.includes('physiotherapist');
  const addressLike =
    t.includes('street_address') ||
    t.includes('premise') ||
    t.includes('subpremise') ||
    t.includes('route');

  if (establishmentLike && !addressLike) return -55;
  if (establishmentLike && addressLike) return -15;
  return 0;
}

function typesBoost(types: string[] | undefined): number {
  const t = types ?? [];
  let s = 0;
  if (t.includes('street_address')) s += 55;
  if (t.includes('premise')) s += 45;
  if (t.includes('subpremise')) s += 35;
  return s;
}

export function scoreGoogleGeocodeCandidate(r: GoogleGeocodeRawResult): number {
  const lt = r.geometry?.location_type;
  return locationTypeScore(lt) + typesBoost(r.types) + poiPenalty(r.types);
}

export function pickGoogleGeocodeResultForQuery(
  address: string,
  rawResults: GoogleGeocodeRawResult[],
): GeocodeResult | null {
  const list = rawResults.filter(r => r.geometry?.location?.lat != null && r.geometry?.location?.lng != null);
  if (!list.length) return null;

  const preferHouse = looksLikeRuStreetWithHouseNumber(address);

  if (!preferHouse) {
    const r = list[0];
    const loc = r.geometry!.location!;
    return {
      lat: loc.lat,
      lon: loc.lng,
      displayName: r.formatted_address,
      geocodeDebug: { winnerTypes: r.types, skippedEstablishment: false },
    };
  }

  let best = list[0];
  let bestScore = scoreGoogleGeocodeCandidate(best);
  for (let i = 1; i < list.length; i++) {
    const r = list[i];
    const sc = scoreGoogleGeocodeCandidate(r);
    if (sc > bestScore) {
      best = r;
      bestScore = sc;
    }
  }

  const types = best.types ?? [];
  const skippedEstablishment =
    list.some(r => (r.types ?? []).includes('establishment')) &&
    !types.includes('establishment');

  const loc = best.geometry!.location!;
  return {
    lat: loc.lat,
    lon: loc.lng,
    displayName: best.formatted_address,
    geocodeDebug: { winnerTypes: types, skippedEstablishment },
  };
}
