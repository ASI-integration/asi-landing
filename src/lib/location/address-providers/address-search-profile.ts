/**
 * Country / metro address search profiles — shared types and CIS stubs.
 * Russia-specific data lives in `ru-address-search-profile.ts`.
 */

export interface GeoBBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * Regional hints for autocomplete expansion + reranking (no impact on location scoring).
 */
export interface AddressSearchProfile {
  id: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  /** Major hubs / aliases (normalized lowercase, spacing as in `normalizeForMatch`). */
  primaryCities: readonly string[];
  regionNames: readonly string[];
  satelliteCities: readonly string[];
  districtNames?: readonly string[];
  bbox?: GeoBBox;
  biasCenter?: { lat: number; lon: number };
  /** Tokens in normalized suggestion text that indicate a common wrong region when context locks this profile. */
  negativeRegions?: readonly string[];
  /** Use `{tail}` for the street + house fragment (already normalized). */
  queryExpansionTemplates?: readonly string[];
}

export function pointInBBox(lat: number, lon: number, box: GeoBBox): boolean {
  return lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;
}

/**
 * Boost / demote vendor suggestions using resolved profiles.
 * When many profiles are active without a locked context, rely on expansions only (no broad positive boost).
 */
export function profileRegionalAdjustment(
  suggestionNorm: string,
  ctx: {
    profiles: readonly AddressSearchProfile[];
    expansionActive: boolean;
    contextLocked: boolean;
  },
): number {
  if (!suggestionNorm || ctx.profiles.length === 0) return 0;

  let score = 0;
  const narrowBoost =
    ctx.expansionActive && (ctx.contextLocked || ctx.profiles.length <= 2);

  if (narrowBoost) {
    const positive = ctx.profiles.flatMap(p => [...p.primaryCities, ...p.regionNames, ...p.satelliteCities]);
    const hit = positive.some(t => Boolean(t) && suggestionNorm.includes(t));
    if (hit) score += 68;
  }

  if (ctx.contextLocked && ctx.profiles.length > 0) {
    const negatives = ctx.profiles.flatMap(p => p.negativeRegions ?? []);
    const wrong = negatives.some(t => t && suggestionNorm.includes(t));
    if (wrong) score -= 105;
  }

  return score;
}

/** Placeholder profiles for future CIS routing — empty expansions, keeps interface stable. */
export const CIS_ADDRESS_SEARCH_PROFILE_PLACEHOLDERS: Record<
  'KZ' | 'BY' | 'AM' | 'KG' | 'UZ' | 'GE',
  AddressSearchProfile
> = {
  KZ: {
    id: 'cis-kz',
    country: 'KZ',
    primaryCities: [],
    regionNames: [],
    satelliteCities: [],
    queryExpansionTemplates: [],
  },
  BY: {
    id: 'cis-by',
    country: 'BY',
    primaryCities: [],
    regionNames: [],
    satelliteCities: [],
    queryExpansionTemplates: [],
  },
  AM: {
    id: 'cis-am',
    country: 'AM',
    primaryCities: [],
    regionNames: [],
    satelliteCities: [],
    queryExpansionTemplates: [],
  },
  KG: {
    id: 'cis-kg',
    country: 'KG',
    primaryCities: [],
    regionNames: [],
    satelliteCities: [],
    queryExpansionTemplates: [],
  },
  UZ: {
    id: 'cis-uz',
    country: 'UZ',
    primaryCities: [],
    regionNames: [],
    satelliteCities: [],
    queryExpansionTemplates: [],
  },
  GE: {
    id: 'cis-ge',
    country: 'GE',
    primaryCities: [],
    regionNames: [],
    satelliteCities: [],
    queryExpansionTemplates: [],
  },
};
