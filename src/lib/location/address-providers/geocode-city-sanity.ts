/**
 * Deterministic guard: typed RU locality vs geocoder-reported city/settlement.
 * Prevents static-table cityScale from combining with coordinates for another place.
 */

import type { GeocodeResult } from '../providers/types';
import { extractRuCityFromValue, normalizeRuAddressQuery } from './ru-normalize';
import { inferCityScaleFromRuAddress } from '../city-scale-from-address';

const REGION_ONLY_SEGMENT_RE =
  /\b(?:область|край|республика|автономный\s+округ|ао\b|округ|район|федерация|россия|рф)\b/i;

function normToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/gu, 'е')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/gu, '-')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function paddedHasWord(haystackNorm: string, needleNorm: string): boolean {
  if (!needleNorm || needleNorm.length < 2) return false;
  const h = ` ${haystackNorm} `;
  const n = ` ${needleNorm} `;
  return h.includes(n);
}

function placeMatchesRequested(requestedNorm: string, placeRaw: string): boolean {
  const place = normToken(placeRaw);
  if (!place || !requestedNorm) return false;
  if (place === requestedNorm) return true;
  if (paddedHasWord(place, requestedNorm)) return true;
  if (paddedHasWord(requestedNorm, place)) return true;
  return false;
}

/** Prefer explicit city list, then static macro table cityName, then first comma block. */
export function extractRuRequestedCityToken(addressRu: string): string | null {
  const explicit = extractRuCityFromValue(addressRu);
  if (explicit) return explicit.trim() || null;

  const table = inferCityScaleFromRuAddress(addressRu);
  if (table.cityName && table.inferredFrom.startsWith('static_table:')) {
    return table.cityName;
  }

  const { normalized } = normalizeRuAddressQuery(addressRu);
  const commaIdx = normalized.indexOf(', ');
  const first = (commaIdx === -1 ? normalized : normalized.slice(0, commaIdx)).trim();
  if (!first || REGION_ONLY_SEGMENT_RE.test(first)) return null;
  return first || null;
}

function displayNamePlaceCandidates(displayName: string): string[] {
  const out: string[] = [];
  for (const part of displayName.split(',')) {
    const p = part.trim();
    if (p.length < 2) continue;
    if (REGION_ONLY_SEGMENT_RE.test(p)) continue;
    if (/^\d/u.test(p)) continue;
    out.push(p);
  }
  const seen = new Set<string>();
  return out.filter(x => {
    const k = normToken(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface GeocodeCitySanityResult {
  readonly requestedCity: string | null;
  readonly geocodeDisplayName: string | null;
  readonly geocodeCity: string | null;
  readonly geocodeAdminArea1: string | null;
  readonly geocodeAdminArea2: string | null;
  readonly geocodeSettlement: string | null;
  readonly cityMismatch: boolean;
  readonly mismatchReason: string | null;
}

function baseDiag(
  requested: string | null,
  geocode: GeocodeResult,
  cityMismatch: boolean,
  mismatchReason: string | null,
): GeocodeCitySanityResult {
  return {
    requestedCity: requested,
    geocodeDisplayName: geocode.displayName?.trim() ?? null,
    geocodeCity: geocode.locality?.trim() ?? null,
    geocodeAdminArea1: geocode.adminArea1?.trim() ?? null,
    geocodeAdminArea2: geocode.adminArea2?.trim() ?? null,
    geocodeSettlement: geocode.settlement?.trim() ?? null,
    cityMismatch,
    mismatchReason,
  };
}

/**
 * When the user named a city, require the requested token to align with returned
 * locality/settlement/municipality, admin2 (settlement-scale), whole displayName,
 * or (without structured fields) comma-separated display fragments.
 */
export function evaluateRuGeocodeCitySanity(
  addressRu: string,
  geocode: GeocodeResult | null | undefined,
): GeocodeCitySanityResult {
  if (!geocode) {
    return {
      requestedCity: null,
      geocodeDisplayName: null,
      geocodeCity: null,
      geocodeAdminArea1: null,
      geocodeAdminArea2: null,
      geocodeSettlement: null,
      cityMismatch: false,
      mismatchReason: 'no_geocode',
    };
  }

  const requested = extractRuRequestedCityToken(addressRu);
  if (!requested) {
    return baseDiag(null, geocode, false, 'no_requested_city_token');
  }

  const requestedNorm = normToken(requested);
  const primaryFields = [geocode.locality, geocode.settlement, geocode.municipality, geocode.adminArea2].filter(
    (x): x is string => Boolean((x ?? '').trim()),
  );

  let matched = primaryFields.some(f => placeMatchesRequested(requestedNorm, f));
  if (!matched && geocode.displayName?.trim()) {
    const dn = geocode.displayName.trim();
    if (placeMatchesRequested(requestedNorm, dn)) matched = true;
  }
  if (!matched && primaryFields.length === 0 && geocode.displayName?.trim()) {
    matched = displayNamePlaceCandidates(geocode.displayName).some(c => placeMatchesRequested(requestedNorm, c));
  }

  if (matched) {
    return baseDiag(requested, geocode, false, null);
  }

  if (!primaryFields.length && !geocode.displayName?.trim()) {
    return baseDiag(requested, geocode, false, 'inconclusive_no_place_candidates');
  }

  const shown = primaryFields.length ? primaryFields.map(normToken).join('|') : displayNamePlaceCandidates(geocode.displayName ?? '').map(normToken).join('|');

  return baseDiag(requested, geocode, true, `requested "${requestedNorm}" not_in_geocode_places=[${shown}]`);
}
