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
import {
  classifyMagnetSignal,
  hasCredibleBusinessAnchors,
  isCredibleTouristAnchor,
  looksLikeWeakLocalAttractionPoi,
  FORBIDDEN_PUBLIC_WORDING_RU,
} from './signals/location-signal-taxonomy';
import { classifyCanonicalMagnet } from './canonical/magnet-registry';

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

/**
 * Audience taxonomy contract:
 * BUSINESS must be unlocked only by credible anchors (see `classifyMagnetSignal`).
 * Weak/local POIs (bank/insurance/person-name offices/etc) must never unlock BUSINESS
 * and must never generate strong public driver copy.
 */

function isCredibleBusinessMagnet(m: MagnetItem): boolean {
  const c = classifyCanonicalMagnet({ magnet: m });
  const t = classifyMagnetSignal(m); // legacy safety gate; taxonomy is registry-backed
  const credibleLevel = t.level === 'tier1_anchor' || t.level === 'tier2_anchor';
  // BUSINESS must be unlocked only by canonical eligibility + credible taxonomy.
  return (c.audiences.business || c.audiences.corporate) && credibleLevel;
}

function isTouristMagnet(m: MagnetItem): boolean {
  const c = classifyCanonicalMagnet({ magnet: m });
  if (!c.audiences.tourist) return false;
  // Weak/hidden tourist signals must not contribute to TOURIST audience score.
  return isCredibleTouristAnchor(m);
}

// ── Primary magnets classifier ────────────────────────────────────────────────

/**
 * Extract and classify magnets relevant for audience scoring.
 * Relevance uses exponential decay × sub-type multiplier — no step functions.
 */
export function classifyPrimaryMagnets(magnets: MagnetItem[]): PrimaryMagnet[] {
  const result: PrimaryMagnet[] = [];

  for (const m of magnets) {
    const isBusiness = isCredibleBusinessMagnet(m);
    const isTourist  = isTouristMagnet(m);
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
    if (isCredibleBusinessMagnet(m)) {
      businessScore += m.attractionScore * subtypeWeight(m.subType);
    } else if (isTouristMagnet(m)) {
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
  const relevant =
    audience === 'BUSINESS'
      ? magnets.filter(isCredibleBusinessMagnet)
      : magnets.filter(isTouristMagnet);

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
    if (isCredibleBusinessMagnet(m)) {
      businessScore += decayed * subtypeWeight(m.subType);
    } else if (isTouristMagnet(m)) {
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
  allMagnets: MagnetItem[],
): string {
  if (primaryAudience === 'BUSINESS') {
    // Anchor recall: prefer the nearest must-surface transport / business
    // anchor (railway / airport / CBD metro / business center) over weaker
    // primaryMagnets that may have edged ahead by relevance score.
    const surfacing = allMagnets
      .filter(m =>
        (m.categoryId === 'railway_station' || m.categoryId === 'airport') &&
        classifyMagnetSignal(m).level === 'tier1_anchor',
      )
      .sort((a, b) => a.distance - b.distance);
    const transportTop = surfacing[0];
    if (transportTop) {
      const role = transportTop.categoryId === 'airport' ? 'аэропорт' : 'ж/д вокзал';
      return `Ключевой транспортный якорь: ${transportTop.name} (${distRu(transportTop.distance)}, ${role})`;
    }

    const top = primaryMagnets.find(m => m.type === 'business');
    if (!top) return `Деловых якорей рядом не обнаружено (${audienceSharePct}%).`;

    const topTax = classifyMagnetSignal({
      // minimal MagnetItem shape for taxonomy
      categoryId: top.categoryId,
      name: top.name,
      distance: top.distance,
      subType: top.subType,
      // unused fields
      categoryLabel: top.categoryId,
      icon: '',
      lat: 0,
      lon: 0,
      weight: top.weight,
      permanenceType: 'permanent',
      scopeLevel: 'local',
      strengthClass: 'medium',
      attractionScore: top.relevanceScore,
    } as MagnetItem);

    // If taxonomy says "weak/hidden", never use strong public framing.
    if (topTax.publicClaimStrength === 'hidden_from_public_copy' || topTax.level === 'weak_local_signal') {
      return `Локальные деловые сигналы рядом (${distRu(top.distance)}), но сильный деловой драйвер не подтверждён.`;
    }

    const cluster = businessClusterDetected ? ' · деловой кластер' : '';
    const role = top.categoryId === 'hospital' ? 'больница' : subtypeLabel(top.subType);
    const label = `Деловой поток: ${top.name} (${distRu(top.distance)}, ${role})${cluster}`;

    // Defensive: ensure forbidden wording cannot leak.
    const lowered = label.toLowerCase();
    for (const bad of FORBIDDEN_PUBLIC_WORDING_RU) {
      if (lowered.includes(bad)) {
        return `Деловой поток подтверждён якорями поблизости.`;
      }
    }
    return label;
  }

  // TOURIST (primary or fallback)
  const top = primaryMagnets.find(m => m.type === 'tourist');
  if (!top) {
    // Weak-only context: corporate/industrial museum, single small clinic,
    // school/kindergarten, single small hotel, civic office, mini-market.
    const hasWeakAttraction = allMagnets.some(looksLikeWeakLocalAttractionPoi);
    if (hasWeakAttraction) {
      return 'Есть отдельный культурный объект рядом, но сильный туристический поток не подтверждён.';
    }
    const hasAnyWeakSignal = allMagnets.some(m => {
      const t = classifyMagnetSignal(m);
      return t.level === 'weak_local_signal' && t.publicClaimStrength !== 'hidden_from_public_copy';
    });
    if (hasAnyWeakSignal) {
      return 'Есть отдельные сигналы спроса рядом, но крупный якорь не подтверждён.';
    }
    return `Туристический поток (слабый сигнал — объекты не обнаружены)`;
  }

  // Credible tourist anchor present — but if it is in fact weak per taxonomy,
  // suppress strong wording symmetrically with the BUSINESS branch above.
  const topTax = classifyMagnetSignal({
    categoryId: top.categoryId,
    name: top.name,
    distance: top.distance,
    subType: top.subType,
    categoryLabel: top.categoryId,
    icon: '',
    lat: 0,
    lon: 0,
    weight: top.weight,
    permanenceType: 'permanent',
    scopeLevel: 'local',
    strengthClass: 'medium',
    attractionScore: top.relevanceScore,
  } as MagnetItem);
  if (topTax.level === 'weak_local_signal' || topTax.publicClaimStrength === 'hidden_from_public_copy') {
    if (top.categoryId === 'attraction') {
      return 'Есть отдельный культурный объект рядом, но сильный туристический поток не подтверждён.';
    }
    return 'Есть отдельные сигналы спроса рядом, но крупный якорь не подтверждён.';
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
  const hasViableBusiness = hasCredibleBusinessAnchors(magnets);

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

  // Cluster: ≥2 credible business anchors within cluster radius (weak/local POIs excluded)
  const businessClusterDetected = businessMagnets.filter(m => m.distance <= BUSINESS_CLUSTER_RADIUS).length >= CLUSTER_MIN_COUNT;

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
    magnets,
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
