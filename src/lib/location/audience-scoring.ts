/**
 * Target audience layer — classifies locations by primary audience type
 * and computes an audience-specific fit score independent of the generic
 * evergreen index.
 *
 * Primary audience priority: BUSINESS (corporate / commanded travelers) first.
 * Auto-fallback to TOURIST when no viable business magnets exist within range.
 *
 * Scoring model
 * ─────────────
 *  • Exponential distance decay:  score = weight × exp(−distance / DECAY_FACTOR)
 *  • Sub-type multipliers:        factory/industrial ×1.5 › office ×1.0 › bank ×0.5
 *  • URBAN_BUSINESS amplifier:    ×1.7 when locationType === 'URBAN_BUSINESS'
 *  • Multi-magnet cluster bonus:  ×1.25 when ≥ 2 business magnets within 1 km
 *  • Hard far-penalty:            score = 0 when nearest business magnet > 3 km
 *  • Noise filter:                bank-only clusters do NOT trigger cluster bonus
 */

import type {
  MagnetItem,
  PrimaryMagnet,
  AudienceAnalysis,
  TargetAudience,
  LocationType,
} from './types';

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Exponential decay half-distance: score drops to ~37 % at this range (meters) */
const DECAY_FACTOR = 800;

/** Score amplifier when locationType === 'URBAN_BUSINESS' */
const URBAN_BUSINESS_AMPLIFIER = 1.7;

/** Score multiplier when ≥ CLUSTER_MIN_COUNT business magnets are within CLUSTER_RADIUS */
const CLUSTER_BONUS_FACTOR = 1.25;
const BUSINESS_CLUSTER_RADIUS = 1000; // meters
const CLUSTER_MIN_COUNT = 2;

/** Nearest-magnet hard cutoff: beyond this range business score resets to 0 */
const MAX_BUSINESS_DISTANCE = 3000; // meters

/**
 * Normalisation divisor: chosen so that a single factory (weight 5.5, subType factor 1.5)
 * at 300 m in an URBAN_BUSINESS zone maps to ≈ 75 / 100.
 * Derivation: 5.5 × exp(−300/800) × 1.5 × 1.7 ≈ 9.6  →  9.6 / 0.13 ≈ 74
 */
const SCORE_NORMALIZER = 0.13;

// ── Sub-type strength weights ─────────────────────────────────────────────────

/**
 * Per-subType score multipliers for business magnets.
 * Only factories and industrial zones are strong standalone demand generators.
 * Banks are noise: they exist everywhere and do not predict corporate travel.
 */
const BUSINESS_SUBTYPE_WEIGHT: Readonly<Record<string, number>> = {
  factory:    1.5,
  industrial: 1.5,
  office:     1.0,
  commercial: 0.8,
  bank:       0.5,
};

function subtypeWeight(subType?: string): number {
  return subType ? (BUSINESS_SUBTYPE_WEIGHT[subType] ?? 1.0) : 1.0;
}

/** Russian label for a business sub-type — used in primaryDriverLabel */
function subtypeLabel(subType?: string): string {
  switch (subType) {
    case 'factory':    return 'завод';
    case 'industrial': return 'промзона';
    case 'office':     return 'офис';
    case 'commercial': return 'коммерческая зона';
    case 'bank':       return 'банк';
    default:           return 'бизнес-объект';
  }
}

/** Russian distance string, e.g. "300 м" or "1.4 км" */
function distRu(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters / 10) * 10} м`
    : `${(meters / 1000).toFixed(1)} км`;
}

// ── Category classification ───────────────────────────────────────────────────

/** Category IDs that generate business (corporate / commanded traveler) demand */
const BUSINESS_CATEGORY_IDS: ReadonlySet<string> = new Set(['business']);

/** Category IDs that generate tourist demand */
const TOURIST_CATEGORY_IDS: ReadonlySet<string> = new Set([
  'attraction',
  'entertainment',
  'shopping_major',
]);

// ── Primary magnets classifier ────────────────────────────────────────────────

/**
 * Extract and classify magnets relevant for audience scoring.
 * Relevance uses exponential decay × sub-type multiplier — no step functions.
 */
export function classifyPrimaryMagnets(magnets: MagnetItem[]): PrimaryMagnet[] {
  const result: PrimaryMagnet[] = [];

  for (const m of magnets) {
    const isBusiness = BUSINESS_CATEGORY_IDS.has(m.categoryId);
    const isTourist  = TOURIST_CATEGORY_IDS.has(m.categoryId);
    if (!isBusiness && !isTourist) continue;

    const decayed   = m.weight * Math.exp(-m.distance / DECAY_FACTOR);
    const typeWeight = isBusiness ? subtypeWeight(m.subType) : 1.0;

    result.push({
      type: isBusiness ? 'business' : 'tourist',
      name: m.name,
      categoryId: m.categoryId,
      subType: m.subType,
      weight: m.weight,
      distance: m.distance,
      relevanceScore: decayed * typeWeight,
    });
  }

  return result.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// ── Location type detection ───────────────────────────────────────────────────

/**
 * Classify the location character from the decay-weighted score balance
 * between business and tourist magnets.
 */
export function detectLocationType(magnets: MagnetItem[]): LocationType {
  let businessScore = 0;
  let touristScore  = 0;

  for (const m of magnets) {
    // Use attractionScore (already decay-weighted by gravity engine) for consistency
    if (BUSINESS_CATEGORY_IDS.has(m.categoryId)) {
      businessScore += m.attractionScore * subtypeWeight(m.subType);
    } else if (TOURIST_CATEGORY_IDS.has(m.categoryId)) {
      touristScore += m.attractionScore;
    }
  }

  const total = businessScore + touristScore;
  if (total === 0) return 'MIXED';

  const businessShare = businessScore / total;
  if (businessShare >= 0.60) return 'URBAN_BUSINESS';
  if (businessShare <= 0.30) return 'TOURIST_CLUSTER';
  return 'MIXED';
}

// ── Audience fit scoring ──────────────────────────────────────────────────────

/**
 * Score how well the location's magnet mix serves the given audience (0–100).
 *
 * BUSINESS path:
 *  1. Hard-zero if all business magnets are beyond MAX_BUSINESS_DISTANCE.
 *  2. Exponential decay sum with sub-type multipliers.
 *  3. Cluster bonus (×CLUSTER_BONUS_FACTOR) when ≥2 non-bank magnets are within 1 km.
 *  4. URBAN_BUSINESS amplifier.
 *
 * TOURIST path:
 *  Standard exponential decay sum without sub-type weighting.
 */
export function calculateAudienceFitScore(
  magnets: MagnetItem[],
  audience: TargetAudience,
  locationType: LocationType,
): number {
  const targetIds = audience === 'BUSINESS' ? BUSINESS_CATEGORY_IDS : TOURIST_CATEGORY_IDS;
  const relevant  = magnets.filter(m => targetIds.has(m.categoryId));

  if (relevant.length === 0) return 0;

  // Hard far-penalty: no viable business magnets within cutoff
  if (audience === 'BUSINESS') {
    const nearest = Math.min(...relevant.map(m => m.distance));
    if (nearest > MAX_BUSINESS_DISTANCE) return 0;
  }

  // Exponential decay sum
  let rawScore = 0;
  for (const m of relevant) {
    const decayed = m.weight * Math.exp(-m.distance / DECAY_FACTOR);
    const swt     = audience === 'BUSINESS' ? subtypeWeight(m.subType) : 1.0;
    rawScore += decayed * swt;
  }

  // Cluster bonus: ≥ CLUSTER_MIN_COUNT meaningful (non-bank) business magnets within radius
  if (audience === 'BUSINESS') {
    const strongClose = relevant.filter(
      m => m.distance <= BUSINESS_CLUSTER_RADIUS && m.subType !== 'bank',
    ).length;
    if (strongClose >= CLUSTER_MIN_COUNT) rawScore *= CLUSTER_BONUS_FACTOR;
  }

  // URBAN_BUSINESS location amplifier
  if (locationType === 'URBAN_BUSINESS') rawScore *= URBAN_BUSINESS_AMPLIFIER;

  return Math.max(0, Math.min(100, Math.round(rawScore / SCORE_NORMALIZER)));
}

// ── Audience share ────────────────────────────────────────────────────────────

/**
 * Compute the share of business vs total (business + tourist) decay-weighted demand.
 * Returns a 0–100 integer representing the business percentage.
 * Falls back to 50 when no relevant magnets exist.
 */
export function computeAudienceSharePct(magnets: MagnetItem[]): number {
  let businessScore = 0;
  let touristScore  = 0;

  for (const m of magnets) {
    const decayed = m.weight * Math.exp(-m.distance / DECAY_FACTOR);
    if (BUSINESS_CATEGORY_IDS.has(m.categoryId)) {
      businessScore += decayed * subtypeWeight(m.subType);
    } else if (TOURIST_CATEGORY_IDS.has(m.categoryId)) {
      touristScore += decayed;
    }
  }

  const total = businessScore + touristScore;
  if (total === 0) return 50;
  return Math.round((businessScore / total) * 100);
}

// ── Primary driver label ──────────────────────────────────────────────────────

function buildPrimaryDriverLabel(
  primaryAudience: TargetAudience,
  primaryMagnets: PrimaryMagnet[],
  audienceSharePct: number,
  businessClusterDetected: boolean,
): string {
  if (primaryAudience === 'BUSINESS') {
    const top = primaryMagnets.find(m => m.type === 'business');
    if (!top) {
      return `Основной поток: BUSINESS (${audienceSharePct}%) — деловые объекты не обнаружены`;
    }
    const cluster = businessClusterDetected ? ' · кластер деловых объектов' : '';
    return (
      `Основной драйвер: деловой поток — ${top.name} ` +
      `(${distRu(top.distance)}, ${subtypeLabel(top.subType)})` +
      cluster
    );
  }

  // TOURIST (primary or fallback)
  const top = primaryMagnets.find(m => m.type === 'tourist');
  if (!top) {
    return `Туристический поток (слабый сигнал — объекты не обнаружены)`;
  }
  return `Основной поток: TOURIST — ${top.name} (${distRu(top.distance)})`;
}

// ── Top-level builder ─────────────────────────────────────────────────────────

/**
 * Build the full AudienceAnalysis for a location.
 *
 * Mode selection (in priority order):
 *  1. Hard lock: audienceSharePct >= 65 → BUSINESS; <= 35 → TOURIST.
 *  2. Default: BUSINESS when viable magnets exist, TOURIST as fallback.
 *
 * Visual-noise filter applied after mode lock:
 *  • BUSINESS mode: tourist POIs removed from primaryMagnets.
 *  • TOURIST  mode: factory / industrial (heavy industrial) removed from primaryMagnets.
 */
export function buildAudienceAnalysis(magnets: MagnetItem[]): AudienceAnalysis {
  const allPrimary        = classifyPrimaryMagnets(magnets);
  const locationType      = detectLocationType(magnets);
  const audienceSharePct  = computeAudienceSharePct(magnets);

  const businessMagnets   = allPrimary.filter(m => m.type === 'business');
  const hasViableBusiness = businessMagnets.some(m => m.distance <= MAX_BUSINESS_DISTANCE);

  // ── Mode lock ────────────────────────────────────────────────────────────────
  let primaryAudience: TargetAudience;
  let fallbackMode: boolean;
  let lockedMode: boolean;

  if (audienceSharePct >= 65) {
    primaryAudience = 'BUSINESS';
    fallbackMode    = false;
    lockedMode      = true;
  } else if (audienceSharePct <= 35) {
    primaryAudience = 'TOURIST';
    fallbackMode    = !hasViableBusiness;
    lockedMode      = true;
  } else {
    primaryAudience = hasViableBusiness ? 'BUSINESS' : 'TOURIST';
    fallbackMode    = !hasViableBusiness;
    lockedMode      = false;
  }

  // ── Remove visual noise: keep only the relevant POI type ────────────────────
  const primaryMagnets: PrimaryMagnet[] =
    primaryAudience === 'BUSINESS'
      ? allPrimary.filter(m => m.type !== 'tourist')
      : allPrimary.filter(
          m => !(m.type === 'business' && (m.subType === 'factory' || m.subType === 'industrial')),
        );

  const audienceFitScore  = calculateAudienceFitScore(magnets, primaryAudience, locationType);

  // Cluster: ≥2 meaningful (non-bank) business magnets within cluster radius
  const businessClusterDetected = businessMagnets.filter(
    m => m.distance <= BUSINESS_CLUSTER_RADIUS && m.subType !== 'bank',
  ).length >= CLUSTER_MIN_COUNT;

  // ── Demand-flow consistency label ────────────────────────────────────────────
  const hasStrongClose = businessMagnets.some(
    m =>
      m.distance <= BUSINESS_CLUSTER_RADIUS &&
      (m.subType === 'factory' || m.subType === 'industrial'),
  );
  const demandFlowLabel: string =
    primaryAudience === 'TOURIST'
      ? 'туристический поток'
      : businessClusterDetected && hasStrongClose
        ? 'устойчивый поток'
        : 'поток ограничен';

  const primaryDriverLabel = buildPrimaryDriverLabel(
    primaryAudience,
    primaryMagnets,
    audienceSharePct,
    businessClusterDetected,
  );

  return {
    primaryAudience,
    locationType,
    audienceFitScore,
    primaryMagnets,
    fallbackMode,
    audienceSharePct,
    businessClusterDetected,
    primaryDriverLabel,
    lockedMode,
    demandFlowLabel,
  };
}
