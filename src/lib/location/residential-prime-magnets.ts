/**
 * Residential prime magnets policy — closed allowlist implementation.
 *
 * Canonical source: docs/residential-prime-magnets-policy.md
 *
 * Enforces:
 *   1. Closed allowlist (sections A/B/C only; D is hard exclusion)
 *   2. Distance rule: primary 1.0 km, soft extension ≤ 1.5 km for exceptional anchors
 *   3. Persistence rule: only structurally recurring 24/7/365 anchors
 *   4. Market-aware rules: RU and INTERNATIONAL modes
 *   5. Surfacing limit: default top 3, hard max 5
 *   6. Anchor semantics: POSITIVE / MIXED_CONTEXT / RESTRICTIVE_OR_FRICTION
 */

import type { MagnetItem } from './types';

// ── Anchor type ───────────────────────────────────────────────────────────────

export type PrimeMagnetAnchorType =
  | 'POSITIVE_DEMAND_ANCHOR'
  | 'MIXED_CONTEXT_ANCHOR'
  | 'RESTRICTIVE_OR_FRICTION_ANCHOR';

// ── Output shape ──────────────────────────────────────────────────────────────

export interface ResidentialPrimeMagnet {
  categoryId: string;
  name: string;
  distance: number;
  anchorType: PrimeMagnetAnchorType;
  anchorLabelRu: string;
  categoryLabelRu: string;
}

// ── Closed exclusion set — never surface in residential report ────────────────
//
// These correspond exactly to the HARD EXCLUSION list (section D) plus categories
// that are absent from sections A/B/C of the canonical allowlist.

const EXCLUDED_CATEGORIES = new Set([
  'food',           // cafes, restaurants, fast_food, bars, bakeries
  'education_local', // schools, colleges, kindergartens
  'shopping_local',  // supermarkets, convenience stores
  'major_hotel',     // not on residential prime magnet allowlist (STR competitor proxy only)
  'entertainment',   // cinemas, theatres, nightclubs — mostly local/episodic;
                     // major venues that qualify as landmarks appear under 'attraction'
]);

// Business subTypes that never qualify as prime magnets
const EXCLUDED_BUSINESS_SUBTYPES = new Set([
  'bank',        // single bank branch — minor office, not a demand cluster
  'office_anon', // unnamed anonymous office node — negligible signal
  'commercial',  // landuse=commercial — retail strip, rarely at regional scale
]);

// ── Distance constants ────────────────────────────────────────────────────────

/** Core residential reporting radius (meters) — primary criterion. */
const PRIMARY_RADIUS_M = 1000;

/** Absolute soft-extension cap — only for truly exceptional city-forming anchors. */
const SOFT_EXTENSION_RADIUS_M = 1500;

/**
 * Categories eligible for soft extension beyond 1.0 km up to ~1.5 km.
 * All others are hard-capped at the primary radius.
 */
const SOFT_EXTENSION_ELIGIBLE = new Set([
  'railway_station', // major rail station or bus terminal
  'airport',         // only if materially relevant to the property
  'hospital',        // major medical cluster
  'university',      // university campus / research cluster
  'metro',           // metro hub / urban rail interchange
  'business',        // CBD, office cluster — but NOT factory/industrial subTypes
]);

/**
 * Conditional persistence: semi-permanence categories (stadiums, convention centers)
 * that are often event-driven and episodic must be restricted to the primary radius.
 * They are NOT eligible for soft extension.
 */
const CONDITIONAL_PERSISTENCE_CATEGORIES = new Set([
  'stadium',    // semi — show only if within primary radius
  'convention', // semi — show only if within primary radius
]);

// ── Market modes ──────────────────────────────────────────────────────────────

export type ResidentialMarketMode = 'RU' | 'INTERNATIONAL';

// ── Anchor type classification ────────────────────────────────────────────────

/**
 * Classify anchor type per category and subType.
 *
 * POSITIVE_DEMAND_ANCHOR: transport, medical, university, business (office/admin),
 *   tourism/culture at regional scale, retail at true regional scale.
 *
 * MIXED_CONTEXT_ANCHOR: industrial/logistics (factory, plant, industrial zone).
 *   Still allowed in the report, but wording must acknowledge friction / non-residential
 *   operating profile.
 *
 * RESTRICTIVE_OR_FRICTION_ANCHOR: military, penal. Not in current detection scope
 *   but included for completeness when the OSM data is enriched.
 */
export function classifyPrimeMagnetAnchorType(
  categoryId: string,
  subType?: string,
): PrimeMagnetAnchorType {
  if (categoryId === 'business') {
    if (subType === 'factory' || subType === 'industrial') {
      return 'MIXED_CONTEXT_ANCHOR';
    }
  }
  return 'POSITIVE_DEMAND_ANCHOR';
}

// ── Human-readable RU labels ──────────────────────────────────────────────────

function anchorLabelRu(anchorType: PrimeMagnetAnchorType): string {
  switch (anchorType) {
    case 'POSITIVE_DEMAND_ANCHOR':         return 'Позитивный магнит';
    case 'MIXED_CONTEXT_ANCHOR':           return 'Смешанный контекст';
    case 'RESTRICTIVE_OR_FRICTION_ANCHOR': return 'Фрикционный объект';
  }
}

/** User-facing category label in Russian, consistent with the canonical policy. */
export function residentialMagnetCategoryLabelRu(categoryId: string, subType?: string): string {
  switch (categoryId) {
    case 'metro':           return 'Метро / пересадочный узел';
    case 'airport':         return 'Аэропорт';
    case 'attraction':      return 'Достопримечательность / культурный объект';
    case 'hospital':        return 'Больница / медицинский кластер';
    case 'convention':      return 'Конгресс-центр / выставочный центр';
    case 'university':      return 'Университет / кампус';
    case 'railway_station': return 'Ж/д вокзал / автовокзал / транспортный узел';
    case 'shopping_major':  return 'Крупный торговый центр / ритейл-кластер';
    case 'stadium':         return 'Стадион / арена';
    case 'business':
      if (subType === 'factory' || subType === 'industrial') {
        return 'Промышленная зона / завод';
      }
      return 'Деловой кластер / офисный центр';
    default:
      return categoryId;
  }
}

// ── Filter rules ──────────────────────────────────────────────────────────────

/** Returns false if the category/subType is on the hard exclusion list. */
export function isAllowlistedForResidential(categoryId: string, subType?: string): boolean {
  if (EXCLUDED_CATEGORIES.has(categoryId)) return false;
  if (categoryId === 'business' && subType && EXCLUDED_BUSINESS_SUBTYPES.has(subType)) return false;
  return true;
}

/**
 * Distance rule (section J of the policy).
 *
 * - Anchors within 1.0 km pass unconditionally (allowlist + persistence still apply).
 * - Between 1.0 km and 1.5 km: only exceptional city-forming anchors pass.
 * - Conditional persistence categories (stadiums, convention centers) are hard-capped
 *   at the primary radius regardless of category eligibility.
 * - Beyond 1.5 km: never pass.
 */
export function passesResidentialDistanceRule(
  distance: number,
  categoryId: string,
  subType?: string,
): boolean {
  if (distance <= PRIMARY_RADIUS_M) return true;
  if (distance > SOFT_EXTENSION_RADIUS_M) return false;

  // 1.0 km – 1.5 km soft zone: exceptional anchors only
  if (!SOFT_EXTENSION_ELIGIBLE.has(categoryId)) return false;

  // Conditional persistence categories must stay within primary radius
  if (CONDITIONAL_PERSISTENCE_CATEGORIES.has(categoryId)) return false;

  // Factory/industrial business subTypes may not use soft extension
  if (categoryId === 'business' && (subType === 'factory' || subType === 'industrial')) {
    return false;
  }

  return true;
}

/**
 * Persistence rule (section K of the policy).
 *
 * A residential prime magnet must be a stable, durable 24/7/365 anchor —
 * not episodic, seasonal, or event-only.
 *
 * - `permanent` anchors always pass.
 * - `semi` anchors (stadiums, convention centers) are allowed only within the
 *   primary radius (enforced at the distance-rule level).
 * - `temporary` anchors are never surfaced.
 */
export function passesResidentialPersistenceRule(
  permanenceType: MagnetItem['permanenceType'],
): boolean {
  return permanenceType !== 'temporary';
}

// ── Main filter function ──────────────────────────────────────────────────────

export interface FilterResidentialPrimeMagnetsOptions {
  market?: ResidentialMarketMode;
  /** Default number of anchors to surface (policy default: 3). */
  defaultTop?: number;
  /** Absolute maximum (policy hard max: 5). */
  hardMax?: number;
}

/**
 * Filter and rank prime magnets for the residential user-facing report.
 *
 * Applies the full policy pipeline:
 *   1. Closed allowlist (excluded categories + excluded business subTypes)
 *   2. Distance rule (1.0 km primary, ≤1.5 km soft extension for exceptional anchors)
 *   3. Persistence rule (no temporary; semi-permanent limited by distance rule)
 *   4. Market-aware overrides (INTERNATIONAL mode suppresses some RU-specific patterns)
 *   5. Deduplication (closest instance per name×category wins)
 *   6. Anchor type classification (POSITIVE / MIXED / RESTRICTIVE)
 *   7. Sorting: POSITIVE first, then MIXED, then RESTRICTIVE; by distance within each type
 *   8. Surfacing limits: default top 3, hard max 5
 */
export function filterResidentialPrimeMagnets(
  magnets: MagnetItem[],
  options: FilterResidentialPrimeMagnetsOptions = {},
): ResidentialPrimeMagnet[] {
  const { market = 'RU', defaultTop = 3, hardMax = 5 } = options;

  // Step 1: Allowlist + distance + persistence
  const eligible = magnets.filter(m => {
    if (!isAllowlistedForResidential(m.categoryId, m.subType)) return false;
    if (!passesResidentialDistanceRule(m.distance, m.categoryId, m.subType)) return false;
    if (!passesResidentialPersistenceRule(m.permanenceType)) return false;
    return true;
  });

  // Step 2: Market-specific suppression for INTERNATIONAL mode
  const marketFiltered =
    market === 'INTERNATIONAL'
      ? eligible.filter(m => {
          // Suppress conditional-persistence categories more aggressively in INTERNATIONAL
          // (stadiums, convention centers rarely qualify as persistent city anchors outside RU)
          if (CONDITIONAL_PERSISTENCE_CATEGORIES.has(m.categoryId)) return false;
          return true;
        })
      : eligible;

  // Step 3: Deduplicate by categoryId + normalised name (keep closest instance)
  const seen = new Map<string, ResidentialPrimeMagnet>();
  for (const m of [...marketFiltered].sort((a, b) => a.distance - b.distance)) {
    const key = `${m.categoryId}:${m.name.toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    const anchorType = classifyPrimeMagnetAnchorType(m.categoryId, m.subType);
    seen.set(key, {
      categoryId: m.categoryId,
      name: m.name,
      distance: m.distance,
      anchorType,
      anchorLabelRu: anchorLabelRu(anchorType),
      categoryLabelRu: residentialMagnetCategoryLabelRu(m.categoryId, m.subType),
    });
  }

  const deduped = [...seen.values()];

  // Step 4: Sort — POSITIVE first, MIXED second, RESTRICTIVE last; distance within each type
  const typeOrder: Record<PrimeMagnetAnchorType, number> = {
    POSITIVE_DEMAND_ANCHOR: 0,
    MIXED_CONTEXT_ANCHOR: 1,
    RESTRICTIVE_OR_FRICTION_ANCHOR: 2,
  };
  deduped.sort((a, b) => {
    const tDiff = typeOrder[a.anchorType] - typeOrder[b.anchorType];
    if (tDiff !== 0) return tDiff;
    return a.distance - b.distance;
  });

  // Step 5: Category-diverse selection up to defaultTop, then fill to hardMax
  const result: ResidentialPrimeMagnet[] = [];
  const usedCategories = new Set<string>();

  // Prefer category diversity in the first defaultTop slots
  for (const m of deduped) {
    if (result.length >= defaultTop) break;
    if (!usedCategories.has(m.categoryId)) {
      result.push(m);
      usedCategories.add(m.categoryId);
    }
  }
  // Fill remaining slots from deduplicated list without repeating exact items
  for (const m of deduped) {
    if (result.length >= hardMax) break;
    if (!result.includes(m)) result.push(m);
  }

  return result.slice(0, hardMax);
}

// ── Distance wording helper ───────────────────────────────────────────────────

/** Format distance in Russian per policy wording examples (section J). */
export function fmtResidentialDistanceRu(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) {
    const rounded = Math.round(meters / 10) * 10;
    return `примерно в ${rounded} м`;
  }
  return `примерно в ${(meters / 1000).toFixed(1)} км`;
}
