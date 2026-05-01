import type { CanonicalMagnetType } from './generated-magnet-registry';
import { STRICT_CANONICAL_LOCATION_MODE } from '../config';

export type RawOverpassPoi = Readonly<{
  name?: string;
  tags?: Record<string, string>;
  category?: string;
  subType?: string;
  distanceMeters?: number;
  source?: string;
}>;

export type OverpassToCanonicalMatchedBy =
  | 'tag'
  | 'category'
  | 'alias'
  | 'nameFallback'
  | 'unknownFallback';

export type OverpassToCanonicalResult = Readonly<{
  canonicalType: CanonicalMagnetType;
  confidence: number; // 0..1
  matchedBy: OverpassToCanonicalMatchedBy;
  ambiguous: boolean;
  ambiguityReasons: string[];
  warnings: string[];
  normalizedTags: Record<string, string>;
  /** A safe fallback type when raw input is unknown/ambiguous. */
  safeFallbackType: CanonicalMagnetType;
}>;

function n(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeTags(tags: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags ?? {})) {
    const kk = n(k);
    if (!kk) continue;
    out[kk] = n(v);
  }
  return out;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

const GENERIC_TOURIST_TERMS_RE = /museum|theatre|theater|attraction|landmark|gallery|monument|sight|достопримечательност|музей|театр|галере|памятник/i;
const INDUSTRIAL_TERMS_RE = /factory|plant|works|mill|refinery|завод|фабрик|комбинат|цех|производств|нпз|тэц|гэс|предприяти/i;
const BUSINESS_CENTER_TERMS_RE = /\bbusiness\s+center\b|бизнес[\s\-‑–—]?центр|\bбц\b|office\s+complex|деловой\s+центр|москва[\s\-‑–—]?сити|moscow\s+city/i;

function strictWarn(warnings: string[], code: string): void {
  if (STRICT_CANONICAL_LOCATION_MODE) warnings.push(code);
}

/**
 * Single sanctioned mapping layer:
 * raw Overpass/OSM POI → canonical magnet candidate.
 *
 * Rules:
 * - Prefer structured tags over names.
 * - Names are weak fallback only and MUST NOT create Tier‑1 promotions.
 * - Unknown/ambiguous must fall back to weak/tertiary.
 * - Industrial POIs must be separated (industrial_anchor/industrial_zone/office_cluster/business_center/weak_amenity).
 */
export function overpassToCanonical(poi: RawOverpassPoi): OverpassToCanonicalResult {
  const warnings: string[] = [];
  const ambiguityReasons: string[] = [];
  const normalizedTags = normalizeTags(poi.tags);
  const rawName = poi.name ?? poi.tags?.name;
  const name = n(rawName);
  const category = n(poi.category);
  const subType = n(poi.subType);

  const safeFallbackType: CanonicalMagnetType = 'weak_amenity';

  // --- Highest confidence: explicit OSM tags ---

  // Transport (metro must win over generic railway=station)
  if (normalizedTags.railway === 'subway_entrance' || normalizedTags.station === 'subway') {
    return { canonicalType: 'metro_station', confidence: 0.95, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }
  if (normalizedTags.railway === 'station' || normalizedTags.railway === 'halt') {
    return { canonicalType: 'railway_station', confidence: 0.95, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }
  if (normalizedTags.aeroway === 'helipad') {
    strictWarn(warnings, 'overpass:helipad_excluded');
    return { canonicalType: safeFallbackType, confidence: 0.25, matchedBy: 'tag', ambiguous: true, ambiguityReasons: ['helipad_excluded'], warnings, normalizedTags, safeFallbackType };
  }
  if (normalizedTags.aeroway === 'aerodrome' || normalizedTags.aeroway === 'terminal') {
    // Explicitly exclude helipads from airport anchors.
    if (/\bheli(port|pad)\b/i.test(name)) {
      strictWarn(warnings, 'overpass:helipad_excluded');
      return { canonicalType: safeFallbackType, confidence: 0.25, matchedBy: 'tag', ambiguous: true, ambiguityReasons: ['helipad_excluded'], warnings, normalizedTags, safeFallbackType };
    }
    return { canonicalType: 'airport', confidence: 0.92, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }
  if (normalizedTags.harbour === 'yes' || normalizedTags.harbour === 'port' || normalizedTags.amenity === 'ferry_terminal') {
    return { canonicalType: 'port', confidence: 0.82, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }

  // Medical / education
  if (normalizedTags.amenity === 'hospital' || normalizedTags.healthcare === 'hospital') {
    return { canonicalType: 'hospital', confidence: 0.92, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }
  if (normalizedTags.amenity === 'university') {
    return { canonicalType: 'university', confidence: 0.90, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }

  // Retail / leisure / tourism
  if (normalizedTags.shop === 'mall' || normalizedTags.shop === 'department_store') {
    return { canonicalType: 'shopping_mall', confidence: 0.88, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }
  if (normalizedTags.leisure === 'stadium') {
    return { canonicalType: 'stadium', confidence: 0.86, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }
  if (normalizedTags.amenity === 'conference_centre' || normalizedTags.amenity === 'exhibition_centre' || normalizedTags.amenity === 'convention_centre') {
    return { canonicalType: 'event_venue', confidence: 0.84, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }

  // Explicit tourism tags remain capped families by default (canon caps apply later).
  if (normalizedTags.tourism === 'museum' || /музей|museum/i.test(name)) {
    return { canonicalType: 'museum', confidence: 0.78, matchedBy: normalizedTags.tourism === 'museum' ? 'tag' : 'nameFallback', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }
  if (normalizedTags.amenity === 'theatre' || normalizedTags.amenity === 'arts_centre' || /театр|theatre|theater/i.test(name)) {
    return { canonicalType: 'theater', confidence: normalizedTags.amenity ? 0.76 : 0.55, matchedBy: normalizedTags.amenity ? 'tag' : 'nameFallback', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }
  if (normalizedTags.tourism === 'attraction' || normalizedTags.historic === 'monument' || normalizedTags.tourism === 'gallery') {
    return { canonicalType: 'tourist_attraction', confidence: 0.72, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }

  // Nature / waterfront / resort (tag-first)
  if (normalizedTags.leisure === 'park' || /(^|\s)(park|парк)(\s|$)/i.test(name)) {
    return { canonicalType: 'park', confidence: normalizedTags.leisure === 'park' ? 0.70 : 0.45, matchedBy: normalizedTags.leisure === 'park' ? 'tag' : 'nameFallback', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }
  if (normalizedTags.natural === 'beach' || /пляж|beach/i.test(name)) {
    return { canonicalType: 'beach', confidence: normalizedTags.natural === 'beach' ? 0.68 : 0.44, matchedBy: normalizedTags.natural === 'beach' ? 'tag' : 'nameFallback', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }
  if (normalizedTags.waterway === 'riverbank' || normalizedTags.natural === 'water' || /набереж|waterfront|embankment/i.test(name)) {
    return { canonicalType: 'waterfront', confidence: 0.55, matchedBy: normalizedTags.waterway || normalizedTags.natural ? 'tag' : 'nameFallback', ambiguous: true, ambiguityReasons: ['waterfront_inferred'], warnings, normalizedTags, safeFallbackType };
  }
  if (/курорт|resort|ski|горнолыж/i.test(name) || category.includes('resort')) {
    return { canonicalType: 'resort_area', confidence: 0.52, matchedBy: name ? 'nameFallback' : 'category', ambiguous: true, ambiguityReasons: ['resort_inferred'], warnings, normalizedTags, safeFallbackType };
  }

  // Hospitality (hotel cluster is canonical; tier/caps later)
  if (normalizedTags.tourism === 'hotel') {
    return { canonicalType: 'hotel_cluster', confidence: 0.78, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }

  // --- Business / industrial: keep strict separation ---
  const hasIndustrialTag =
    normalizedTags.landuse === 'industrial' ||
    normalizedTags.building === 'industrial' ||
    normalizedTags.man_made === 'works' ||
    normalizedTags.industrial === 'warehouse';
  const hasOfficeTag = Boolean(normalizedTags.office);
  const hasCommercialLanduse = normalizedTags.landuse === 'commercial';

  if (hasIndustrialTag) {
    if (normalizedTags.landuse === 'industrial') {
      return { canonicalType: 'industrial_zone', confidence: 0.90, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
    }
    // works / industrial buildings are "anchors" but MIXED context.
    return { canonicalType: 'industrial_anchor', confidence: 0.86, matchedBy: 'tag', ambiguous: false, ambiguityReasons: [], warnings, normalizedTags, safeFallbackType };
  }
  if (hasOfficeTag || hasCommercialLanduse) {
    // Only promote to business_center when explicit strong patterns exist (tag + name),
    // otherwise keep as office_cluster.
    if (BUSINESS_CENTER_TERMS_RE.test(name) || category.includes('business_center') || subType.includes('business_center')) {
      return { canonicalType: 'business_center', confidence: 0.70, matchedBy: name ? 'nameFallback' : 'category', ambiguous: true, ambiguityReasons: ['business_center_name_inference'], warnings, normalizedTags, safeFallbackType };
    }
    return { canonicalType: 'office_cluster', confidence: hasOfficeTag ? 0.66 : 0.55, matchedBy: hasOfficeTag ? 'tag' : 'category', ambiguous: true, ambiguityReasons: ['generic_office_or_commercial'], warnings, normalizedTags, safeFallbackType };
  }

  // --- Category-based (weaker than tags) ---
  if (category) {
    if (category.includes('airport')) return { canonicalType: 'airport', confidence: 0.55, matchedBy: 'category', ambiguous: true, ambiguityReasons: ['category_only'], warnings, normalizedTags, safeFallbackType };
    if (category.includes('rail') || category.includes('station')) return { canonicalType: 'railway_station', confidence: 0.55, matchedBy: 'category', ambiguous: true, ambiguityReasons: ['category_only'], warnings, normalizedTags, safeFallbackType };
    if (category.includes('metro') || category.includes('subway')) return { canonicalType: 'metro_station', confidence: 0.55, matchedBy: 'category', ambiguous: true, ambiguityReasons: ['category_only'], warnings, normalizedTags, safeFallbackType };
    if (category.includes('hospital')) return { canonicalType: 'hospital', confidence: 0.55, matchedBy: 'category', ambiguous: true, ambiguityReasons: ['category_only'], warnings, normalizedTags, safeFallbackType };
    if (category.includes('university')) return { canonicalType: 'university', confidence: 0.55, matchedBy: 'category', ambiguous: true, ambiguityReasons: ['category_only'], warnings, normalizedTags, safeFallbackType };
    if (category.includes('mall') || category.includes('shopping')) return { canonicalType: 'shopping_mall', confidence: 0.52, matchedBy: 'category', ambiguous: true, ambiguityReasons: ['category_only'], warnings, normalizedTags, safeFallbackType };
    if (category.includes('stadium') || category.includes('arena')) return { canonicalType: 'stadium', confidence: 0.52, matchedBy: 'category', ambiguous: true, ambiguityReasons: ['category_only'], warnings, normalizedTags, safeFallbackType };
    if (category.includes('museum')) return { canonicalType: 'museum', confidence: 0.50, matchedBy: 'category', ambiguous: true, ambiguityReasons: ['category_only'], warnings, normalizedTags, safeFallbackType };
    if (category.includes('theatre') || category.includes('theater')) return { canonicalType: 'theater', confidence: 0.50, matchedBy: 'category', ambiguous: true, ambiguityReasons: ['category_only'], warnings, normalizedTags, safeFallbackType };
    if (category.includes('industrial') || category.includes('factory')) {
      // Category-only industrial must stay capped and not become business_center.
      strictWarn(warnings, 'overpass:industrial_category_only');
      return { canonicalType: 'industrial_anchor', confidence: 0.45, matchedBy: 'category', ambiguous: true, ambiguityReasons: ['category_only_industrial'], warnings, normalizedTags, safeFallbackType };
    }
  }

  // --- Name fallback (weak, capped) ---
  if (name) {
    if (INDUSTRIAL_TERMS_RE.test(name)) {
      strictWarn(warnings, 'overpass:industrial_name_fallback_capped');
      return { canonicalType: 'industrial_anchor', confidence: 0.32, matchedBy: 'nameFallback', ambiguous: true, ambiguityReasons: ['name_industrial_terms'], warnings, normalizedTags, safeFallbackType };
    }
    if (BUSINESS_CENTER_TERMS_RE.test(name)) {
      strictWarn(warnings, 'overpass:business_center_name_fallback_ambiguous');
      return { canonicalType: 'business_center', confidence: 0.30, matchedBy: 'nameFallback', ambiguous: true, ambiguityReasons: ['name_business_center_terms'], warnings, normalizedTags, safeFallbackType };
    }
    if (GENERIC_TOURIST_TERMS_RE.test(name)) {
      strictWarn(warnings, 'overpass:generic_tourist_name_fallback_capped');
      return { canonicalType: 'tourist_attraction', confidence: 0.28, matchedBy: 'nameFallback', ambiguous: true, ambiguityReasons: ['name_generic_tourist_terms'], warnings, normalizedTags, safeFallbackType };
    }
  }

  // Unknown → safe fallback (strict mode warns)
  strictWarn(warnings, 'overpass:unknown_poi_fallback');
  return {
    canonicalType: safeFallbackType,
    confidence: clamp01(0.18),
    matchedBy: 'unknownFallback',
    ambiguous: true,
    ambiguityReasons: ['unknown_raw_poi'],
    warnings,
    normalizedTags,
    safeFallbackType,
  };
}

