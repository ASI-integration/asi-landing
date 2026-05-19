/**
 * Street-retail suitability — separates area target flow (H3 / foot-traffic layer)
 * from premises frontage, floor level, and entrance accessibility.
 *
 * Detailed street-retail scoring applies only to first-line, street-level / 1st-floor
 * premises with known frontage. Basement, semi-basement, non-first-line, and unknown
 * floor/frontage cases are capped and flagged for manual verification.
 */

import type { LocationAnalysis } from './types';

// ── Public copy (RU) ─────────────────────────────────────────────────────────

export const RETAIL_FRONTAGE_METHODOLOGY_RU =
  'Для ритейла важен не только поток рядом, но и первая линия, вход с улицы, видимость вывески и отсутствие барьеров. Если данных по входной группе нет, ASI помечает этот блок как требующий ручной проверки.';

export const RETAIL_FLOOR_LEVEL_METHODOLOGY_RU =
  'Для ритейла ASI оценивает только помещения на уровне улицы или 1 этаже. Цоколь, полуподвал и помещения без прямого входа с улицы требуют отдельной ручной проверки.';

/** Shown on retail / target-traffic blocks in paid reports (first-line / street-level scope). */
export const RETAIL_TARGET_TRAFFIC_WARNING_RU =
  'Блок по целевому трафику применяется только к помещениям на первой линии, на уровне улицы или 1 этаже. Цоколь, полуподвал, подвал и помещения без прямого входа с улицы требуют отдельной ручной проверки.';

export const MANUAL_CHECK_FRONTAGE_RU =
  'Требует ручной проверки: входная группа, первая линия, видимость с улицы.';

export const MANUAL_CHECK_FLOOR_AND_FRONTAGE_RU =
  'Требует ручной проверки: этаж, входная группа, первая линия, ступеньки и видимость с улицы.';

// ── Premises input (explicit property / listing / manual only) ───────────────

export type RetailPremisesFloorClass =
  | 'street_eligible'
  | 'below_street'
  | 'upper_or_interior'
  | 'unknown';

export type TriState = true | false | 'unknown';

export interface RetailPremisesAttributes {
  /** Normalized floor bucket from explicit floor level or numeric floor. */
  floorClass: RetailPremisesFloorClass;
  /** First-line / street frontage row — only when explicitly provided. */
  firstLine: TriState;
  directStreetEntrance: TriState;
  signVisibility: 'good' | 'medium' | 'poor' | 'unknown';
  pedestrianFlowBarrierFree: TriState;
  /** Set only from listing, photo review, or declared attribute — never inferred. */
  accessibleEntranceNoSteps: TriState;
  parkingOrTransitProximity: TriState;
  streetSide: string | null;
  crossingsNearby: TriState;
}

export interface StreetRetailSuitabilityResult {
  /** 0–100: where target pedestrian flow exists near the point (foot-traffic / H3 layer). */
  areaTargetFlowScore: number;
  /** 0–100 when frontage fields are explicit; null when insufficient entrance-group data. */
  frontageAccessibilityScore: number | null;
  floorClass: RetailPremisesFloorClass;
  firstLine: TriState;
  frontageDataComplete: boolean;
  /** Area flow is strong enough that retail would look good without premises gates. */
  areaTargetFlowStrong: boolean;
  /** May combine area flow with frontage for a high street-retail fit. */
  strongStreetRetailAllowed: boolean;
  manualCheckWarningsRu: string[];
  methodologyNotesRu: string[];
}

// ── Parsing ───────────────────────────────────────────────────────────────────

const BELOW_STREET_TERMS = [
  'подвал',
  'полуподвал',
  'цоколь',
  'basement',
  'semi-basement',
  'semi_basement',
  'semi basement',
  'below-grade',
  'below grade',
];

const STREET_ELIGIBLE_TERMS = [
  'street-level',
  'street level',
  'ground floor',
  'первый этаж',
  '1 этаж',
  '1-й этаж',
  '1 эт',
  'на уровне улицы',
];

const UPPER_FLOOR_TERMS = [
  '2 этаж',
  '2-й этаж',
  'второй этаж',
  'upper floor',
  'above ground',
];

function includesAnyTerm(text: string, terms: readonly string[]): boolean {
  const n = text.toLowerCase();
  return terms.some(t => n.includes(t));
}

function readBool(raw: unknown): TriState {
  if (raw === true || raw === 'true' || raw === 'yes' || raw === 'да') return true;
  if (raw === false || raw === 'false' || raw === 'no' || raw === 'нет') return false;
  return 'unknown';
}

function pickString(ctx: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = ctx[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function pickRaw(ctx: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (ctx[k] !== undefined && ctx[k] !== null) return ctx[k];
  }
  return undefined;
}

function floorClassFromNumeric(floor: number): RetailPremisesFloorClass {
  if (floor < 0) return 'below_street';
  if (floor === 0) return 'below_street';
  if (floor === 1) return 'street_eligible';
  if (floor >= 2) return 'upper_or_interior';
  return 'unknown';
}

function floorClassFromLabel(label: string): RetailPremisesFloorClass {
  const n = label.toLowerCase();
  if (includesAnyTerm(n, BELOW_STREET_TERMS)) return 'below_street';
  if (includesAnyTerm(n, STREET_ELIGIBLE_TERMS)) return 'street_eligible';
  if (includesAnyTerm(n, UPPER_FLOOR_TERMS)) return 'upper_or_interior';
  if (/этаж/.test(n) && /(^|[^\d])1([^\d]|$)|перв/.test(n)) return 'street_eligible';
  if (/этаж/.test(n) && /[2-9]/.test(n)) return 'upper_or_interior';
  return 'unknown';
}

export function parseRetailPremisesFromObjectContext(
  objectContext?: Record<string, unknown> | null,
): RetailPremisesAttributes {
  const ctx = objectContext ?? {};
  const textBlob = [
    pickString(ctx, 'floorLevel', 'floor_level', 'этаж', 'level'),
    pickString(ctx, 'currentUse', 'current_use'),
    pickString(ctx, 'targetUse', 'target_use'),
    pickString(ctx, 'description', 'notes'),
  ]
    .filter(Boolean)
    .join(' ');

  let floorClass: RetailPremisesFloorClass = 'unknown';
  const floorRaw = pickRaw(ctx, 'floor', 'этаж');
  if (typeof floorRaw === 'number' && Number.isFinite(floorRaw)) {
    floorClass = floorClassFromNumeric(floorRaw);
  }
  const floorLabel = pickString(ctx, 'floorLevel', 'floor_level', 'level');
  if (floorLabel) {
    const fromLabel = floorClassFromLabel(floorLabel);
    if (fromLabel !== 'unknown' || floorClass === 'unknown') floorClass = fromLabel;
  }
  if (floorClass === 'unknown' && textBlob) {
    if (includesAnyTerm(textBlob, BELOW_STREET_TERMS)) floorClass = 'below_street';
    else if (includesAnyTerm(textBlob, STREET_ELIGIBLE_TERMS)) floorClass = 'street_eligible';
    else if (includesAnyTerm(textBlob, UPPER_FLOOR_TERMS)) floorClass = 'upper_or_interior';
  }

  const firstLineRaw = pickRaw(
    ctx,
    'firstLine',
    'first_line',
    'isFirstLine',
    'первая_линия',
    'first_line_location',
  );
  let firstLine: TriState = readBool(firstLineRaw);
  if (firstLine === 'unknown') {
    const fl = pickString(ctx, 'premisesLine', 'line', 'frontage_line');
    if (fl && /первая|first/i.test(fl)) firstLine = true;
    if (fl && /вторая|second|двор|court/i.test(fl)) firstLine = false;
  }

  const signRaw = pickString(ctx, 'signVisibility', 'sign_visibility', 'вывеска');
  let signVisibility: RetailPremisesAttributes['signVisibility'] = 'unknown';
  if (signRaw) {
    const s = signRaw.toLowerCase();
    if (/good|хорош|высок/i.test(s)) signVisibility = 'good';
    else if (/medium|средн/i.test(s)) signVisibility = 'medium';
    else if (/poor|слаб|низк/i.test(s)) signVisibility = 'poor';
  }

  return {
    floorClass,
    firstLine,
    directStreetEntrance: readBool(
      pickRaw(ctx, 'directStreetEntrance', 'direct_street_entrance', 'street_entrance'),
    ),
    signVisibility,
    pedestrianFlowBarrierFree: readBool(
      pickRaw(ctx, 'pedestrianFlowBarrierFree', 'pedestrian_barrier_free', 'no_frontage_barriers'),
    ),
    accessibleEntranceNoSteps: readBool(
      pickRaw(
        ctx,
        'accessibleEntranceNoSteps',
        'accessible_entrance_no_steps',
        'no_steps',
        'entrance_no_steps',
      ),
    ),
    parkingOrTransitProximity: readBool(
      pickRaw(ctx, 'parkingOrTransitProximity', 'parking_or_transit', 'transit_proximity'),
    ),
    streetSide: pickString(ctx, 'streetSide', 'street_side', 'сторона_улицы') ?? null,
    crossingsNearby: readBool(
      pickRaw(ctx, 'crossingsNearby', 'crossings_nearby', 'pedestrian_crossing_nearby'),
    ),
  };
}

// ── Area target flow (H3 / foot-traffic — location, not entrance) ─────────────

export function computeAreaTargetFlowScore(analysis: LocationAnalysis): {
  score: number;
  strong: boolean;
} {
  const idx = analysis.evergreenIndex;
  const { destinationShare, localActiveShare } = analysis.footTraffic.transitVsTarget;
  const hasShoppingAnchor = analysis.magnets.some(m =>
    ['shopping_major', 'shopping_local'].includes(m.categoryId),
  );
  const hasBusinessCluster = analysis.audienceAnalysis?.businessClusterDetected ?? false;
  const hasTransit = analysis.magnets.some(m =>
    ['metro', 'railway_station'].includes(m.categoryId),
  );

  let score = Math.round(
    idx * 0.45 +
      destinationShare * 100 * 0.35 +
      localActiveShare * 100 * 0.1 +
      (hasShoppingAnchor ? 8 : 0) +
      (hasBusinessCluster ? 6 : 0) +
      (hasTransit ? 5 : 0),
  );
  score = Math.max(0, Math.min(100, score));

  const strong =
    idx >= 60 &&
    destinationShare >= 0.4 &&
    (hasShoppingAnchor || hasBusinessCluster || hasTransit);

  return { score, strong };
}

// ── Frontage / accessibility (premises — explicit data only) ─────────────────

export function computeFrontageAccessibilityScore(
  premises: RetailPremisesAttributes,
): number | null {
  const hasFirstLine = premises.firstLine !== 'unknown';
  const hasEntrance = premises.directStreetEntrance !== 'unknown';
  const hasSign = premises.signVisibility !== 'unknown';
  const hasBarrier = premises.pedestrianFlowBarrierFree !== 'unknown';
  const hasParking = premises.parkingOrTransitProximity !== 'unknown';
  const hasCrossing = premises.crossingsNearby !== 'unknown';
  const hasStreetSide = Boolean(premises.streetSide);
  const hasSteps = premises.accessibleEntranceNoSteps !== 'unknown';

  const explicitCount = [
    hasFirstLine,
    hasEntrance,
    hasSign,
    hasBarrier,
    hasParking,
    hasCrossing,
    hasStreetSide,
    hasSteps,
  ].filter(Boolean).length;

  if (!hasFirstLine || !hasEntrance) return null;
  if (explicitCount < 2) return null;

  let score = 0;
  if (premises.firstLine === true) score += 22;
  if (premises.directStreetEntrance === true) score += 22;
  if (premises.signVisibility === 'good') score += 16;
  else if (premises.signVisibility === 'medium') score += 10;
  else if (premises.signVisibility === 'poor') score += 4;
  if (premises.pedestrianFlowBarrierFree === true) score += 14;
  if (premises.accessibleEntranceNoSteps === true) score += 10;
  if (premises.parkingOrTransitProximity === true) score += 10;
  if (premises.crossingsNearby === true) score += 6;
  if (premises.streetSide) score += 5;

  return Math.max(0, Math.min(100, score));
}

export function isFrontageDataComplete(premises: RetailPremisesAttributes): boolean {
  return (
    premises.firstLine !== 'unknown' &&
    premises.directStreetEntrance !== 'unknown'
  );
}

// ── Gates ─────────────────────────────────────────────────────────────────────

export function evaluateStreetRetailSuitability(
  analysis: LocationAnalysis,
  objectContext?: Record<string, unknown> | null,
): StreetRetailSuitabilityResult {
  const premises = parseRetailPremisesFromObjectContext(objectContext);
  const { score: areaTargetFlowScore, strong: areaTargetFlowStrong } =
    computeAreaTargetFlowScore(analysis);
  const frontageAccessibilityScore = computeFrontageAccessibilityScore(premises);
  const frontageDataComplete = isFrontageDataComplete(premises);

  const manualCheckWarningsRu: string[] = [];
  const methodologyNotesRu = [RETAIL_FRONTAGE_METHODOLOGY_RU, RETAIL_FLOOR_LEVEL_METHODOLOGY_RU];

  if (premises.floorClass === 'unknown') {
    manualCheckWarningsRu.push(MANUAL_CHECK_FLOOR_AND_FRONTAGE_RU);
  }
  if (!frontageDataComplete) {
    if (!manualCheckWarningsRu.includes(MANUAL_CHECK_FLOOR_AND_FRONTAGE_RU)) {
      manualCheckWarningsRu.push(MANUAL_CHECK_FRONTAGE_RU);
    }
  }

  const belowStreet = premises.floorClass === 'below_street';
  const nonFirstLine = premises.firstLine === false;
  const upperInterior = premises.floorClass === 'upper_or_interior';
  const floorEligible =
    premises.floorClass === 'street_eligible' && !belowStreet && !upperInterior;

  let strongStreetRetailAllowed = false;
  if (
    areaTargetFlowStrong &&
    floorEligible &&
    premises.firstLine !== false &&
    frontageDataComplete &&
    frontageAccessibilityScore !== null &&
    frontageAccessibilityScore >= 55
  ) {
    strongStreetRetailAllowed = true;
  }

  if (belowStreet || nonFirstLine || upperInterior) {
    strongStreetRetailAllowed = false;
  }

  return {
    areaTargetFlowScore,
    frontageAccessibilityScore,
    floorClass: premises.floorClass,
    firstLine: premises.firstLine,
    frontageDataComplete,
    areaTargetFlowStrong,
    strongStreetRetailAllowed,
    manualCheckWarningsRu,
    methodologyNotesRu,
  };
}

/** Max retail fit when street-retail gates block a “high” verdict. */
export type StreetRetailFitCap = 'high' | 'medium' | 'low';

export function streetRetailFitCap(
  suitability: StreetRetailSuitabilityResult,
): StreetRetailFitCap {
  if (suitability.strongStreetRetailAllowed) return 'high';
  if (
    suitability.floorClass === 'below_street' ||
    suitability.firstLine === false ||
    suitability.floorClass === 'upper_or_interior'
  ) {
    return suitability.areaTargetFlowStrong ? 'medium' : 'low';
  }
  if (!suitability.frontageDataComplete || suitability.floorClass === 'unknown') {
    return suitability.areaTargetFlowStrong ? 'medium' : 'low';
  }
  return 'medium';
}
