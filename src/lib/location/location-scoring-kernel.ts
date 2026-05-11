/**
 * Deterministic demand scoring kernel v1 — ranks POIs before score/headline/public claims.
 */

import type { CanonicalLocationFact, DemandSignal, MagnetFact } from './location-decision-contract';
import type { MagnetItem } from './types';
import {
  baseWeightForTier,
  classifyDriverKind,
  computeDistanceCoefficient,
  confidenceCoefficientFromMagnet,
  demandTypeVoteForMagnet,
  distanceDecayProfiles,
  inferScaleClass,
  resolveDemandTier,
  tagsForMagnetIndex,
} from './location-demand-kernel-rules';
import type { InferredCityScaleTier } from './city-scale-from-address';
import type {
  LocationDemandKernelDemandType,
  LocationDemandKernelInput,
  LocationDemandScaleClass,
  LocationDemandScoredDriver,
  LocationDemandScoringKernelResult,
  SmallCitySparsePublicScoreGuard,
} from './location-scoring-contract';
import { formatPublicEvidenceLineRu } from './location-decision-rules';

const REF_SUM_FOR_FULL_SCORE = 44;
const CAP_SUPPORTING_INFRA = 11;
const CAP_LOCAL_INTEREST = 4;
const CAP_HOTEL_SUPPORT = 6;
const CAP_TOURISM_NO_ANCHOR = 8;
const NO_TIER1_BLEND_FLOOR = 0.58;
const SMALL_CITY_PUBLIC_SCORE_CAP = 58;

/** Mirrors taxonomy municipal vs regional split — kept in kernel to avoid brittle bundler ordering. */
function coerceMunicipalHospitalScaleForSmallCity(
  m: MagnetItem,
  cityTier: InferredCityScaleTier | undefined,
  scaleClass: ReturnType<typeof inferScaleClass>,
): ReturnType<typeof inferScaleClass> {
  if (m.categoryId !== 'hospital' && m.categoryId !== 'specializedMedicalAnchor') return scaleClass;
  if (cityTier !== 'small' && cityTier !== 'micro') return scaleClass;
  const n = (m.name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n) return scaleClass;
  const regional =
    /областн|федеральн|(?:^|\s)нии(?:$|\s|\W)|научн(?:ый|ого|)?\s+центр|онкологическ|кардиологическ|перинатальн/i;
  if (regional.test(n)) return scaleClass;
  const municipal =
    /городская|гбуз|муниципальн|районн|поселков|участков|поликлиник|амбулатор|учреждени|црб|цгб|\bмб\b|клиническая\s+больниц|\bгкб\b/i;
  if (municipal.test(n)) return 'weak_local';
  return scaleClass;
}

/** Stricter than kernel acceptance — hero bullets / demand signals */
const MIN_PUBLIC_DISPLAY_CONTRIBUTION = 0.22;
const PUBLIC_DISPLAY_STRONG_T2 = 1.12;
const PUBLIC_DISPLAY_METRO_RAIL_MIN = 0.38;
const PUBLIC_DISPLAY_EXPLICIT_T2_MIN = 0.48;

const PUBLIC_DRIVER_EXPLICIT_CATEGORIES = new Set([
  'hospital',
  'specializedMedicalAnchor',
  'university',
  'stadium',
  'convention',
  'shopping_major',
  'railway_station',
  'airport',
  'strategicTransportHub',
]);

export function magnetIndexFromMagnetFactId(id: string): number | null {
  const p = id.split(':');
  if (p.length < 2) return null;
  const n = Number.parseInt(p[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function magnetCategoryFromFactIndex(magnetFactId: string, magnets: readonly MagnetItem[]): string | null {
  const i = magnetIndexFromMagnetFactId(magnetFactId);
  if (i == null) return null;
  return magnets[i]?.categoryId ?? null;
}

function tagAlignmentStatusFromCanonical(cf: CanonicalLocationFact | undefined): string {
  const w = cf?.warnings?.find(x => x.startsWith('tag_alignment_'));
  return w ?? 'tag_alignment_none';
}

function passesPublicDisplayRules(d: LocationDemandScoredDriver, magnets: readonly MagnetItem[]): boolean {
  if (!d.accepted || d.finalContribution < MIN_PUBLIC_DISPLAY_CONTRIBUTION) return false;
  if (d.driverKind === 'noise' || d.driverKind === 'local_interest') return false;
  if (isHotelCategory(magnets, d.magnetFactId)) return false;

  const cat = magnetCategoryFromFactIndex(d.magnetFactId, magnets);

  if (d.driverKind === 'supporting_infrastructure') {
    if (!isMetroOrRail(magnets, d.magnetFactId)) return false;
    return d.finalContribution >= PUBLIC_DISPLAY_METRO_RAIL_MIN;
  }

  if (d.driverKind === 'unknown_uncapped') {
    return d.resolvedTier <= 2 && d.finalContribution >= PUBLIC_DISPLAY_STRONG_T2 * 0.72;
  }

  if (d.driverKind !== 'real_demand_driver') return false;

  if (cat === 'major_hotel' || cat === 'mid_hotel') return false;

  if (d.resolvedTier === 1) return true;

  if (d.resolvedTier === 2) {
    if (d.finalContribution >= PUBLIC_DISPLAY_STRONG_T2) return true;
    if (cat && PUBLIC_DRIVER_EXPLICIT_CATEGORIES.has(cat) && d.finalContribution >= PUBLIC_DISPLAY_EXPLICIT_T2_MIN) {
      return true;
    }
    return false;
  }

  return false;
}

function computePublicDisplayRejectReason(d: LocationDemandScoredDriver, magnets: readonly MagnetItem[]): string {
  if (!d.accepted) return 'public_reject:not_accepted_kernel';
  if (d.finalContribution < MIN_PUBLIC_DISPLAY_CONTRIBUTION) {
    return 'public_reject:below_public_contribution_threshold';
  }
  if (d.driverKind === 'noise') return 'public_reject:noise';
  if (d.driverKind === 'local_interest') return 'public_reject:local_interest';
  if (isHotelCategory(magnets, d.magnetFactId)) return 'public_reject:hotel_accommodation_context';
  if (d.driverKind === 'supporting_infrastructure' && !isMetroOrRail(magnets, d.magnetFactId)) {
    return 'public_reject:generic_supporting_infrastructure';
  }
  if (
    d.driverKind === 'supporting_infrastructure' &&
    isMetroOrRail(magnets, d.magnetFactId) &&
    d.finalContribution < PUBLIC_DISPLAY_METRO_RAIL_MIN
  ) {
    return 'public_reject:transit_evidence_below_public_floor';
  }
  if (
    d.driverKind === 'unknown_uncapped' &&
    (d.resolvedTier > 2 || d.finalContribution < PUBLIC_DISPLAY_STRONG_T2 * 0.72)
  ) {
    return 'public_reject:unknown_anchor_not_public_strong_enough';
  }
  if (d.driverKind === 'real_demand_driver') {
    const cat = magnetCategoryFromFactIndex(d.magnetFactId, magnets);
    if (d.resolvedTier >= 3) return 'public_reject:tier3_weak_anchor';
    if (
      d.resolvedTier === 2 &&
      d.finalContribution < PUBLIC_DISPLAY_STRONG_T2 &&
      !(cat && PUBLIC_DRIVER_EXPLICIT_CATEGORIES.has(cat) && d.finalContribution >= PUBLIC_DISPLAY_EXPLICIT_T2_MIN)
    ) {
      return 'public_reject:tier2_below_public_strength';
    }
  }
  return 'public_reject:rules';
}

/** Tourism may win vote aggregation from weak leisure — re-label unless real anchors + margin vs medical/business/transport. */
function resolveDominantDemandTypeWithTourismHardGate(
  working: LocationDemandScoredDriver[],
  magnets: readonly MagnetItem[],
  preliminary: LocationDemandKernelDemandType,
): LocationDemandKernelDemandType {
  if (preliminary !== 'tourist') return preliminary;

  const sumAccepted = (vote: LocationDemandKernelDemandType | null) =>
    working.filter(d => d.accepted && d.demandTypeVote === vote).reduce((s, d) => s + d.finalContribution, 0);

  const realTouristAnchorContrib = working
    .filter(d => {
      if (!d.accepted || d.demandTypeVote !== 'tourist') return false;
      if (d.driverKind !== 'real_demand_driver') return false;
      const cat = magnetCategoryFromFactIndex(d.magnetFactId, magnets);
      if (!cat || cat === 'major_hotel' || cat === 'mid_hotel') return false;
      if (!['stadium', 'convention', 'entertainment', 'attraction'].includes(cat)) return false;
      if (cat === 'attraction' && (d.resolvedTier >= 3 || d.scaleClass === 'weak_local')) return false;
      return d.resolvedTier <= 2;
    })
    .reduce((s, d) => s + d.finalContribution, 0);

  const touristTotal = sumAccepted('tourist');
  const med = sumAccepted('medical');
  const biz =
    sumAccepted('corporate/business') + sumAccepted('industrial') + sumAccepted('education');
  const tr = sumAccepted('transport');

  const MARGIN = 1.22;

  if (realTouristAnchorContrib < 0.42) {
    if (med >= biz && med >= tr && med > 0.16) return med > 0.32 ? 'medical' : 'mixed';
    if (biz >= med && biz > 0.18) return 'corporate/business';
    return 'mixed';
  }

  if (touristTotal + 1e-6 < med * MARGIN && med > 0.18) return med >= biz ? 'medical' : 'mixed';
  if (touristTotal + 1e-6 < biz * MARGIN && biz > 0.2) return 'corporate/business';
  if (touristTotal + 1e-6 < tr * MARGIN && tr > 0.26) return 'transport';

  return preliminary;
}

function emptyResult(engineFinal: number): LocationDemandScoringKernelResult {
  const breakdown = {
    rawSumBeforeCaps: 0,
    cappedSupportingInfra: 0,
    cappedLocalInterest: 0,
    cappedHotels: 0,
    cappedGenericBusiness: 0,
    cappedTourismWithoutAnchor: 0,
    cappedNoTier1Penalty: 0,
    cappedSmallCitySparse: 0,
    finalWeightedSum: 0,
  };
  return {
    acceptedDrivers: [],
    rejectedDrivers: [],
    scoredDrivers: [],
    dominantDemandType: 'weak/unclear',
    scoreBreakdown: breakdown,
    kernelEvidenceScore: 0,
    blendedPublicScore: Math.round(engineFinal),
    warnings: [],
    debugTrace: ['kernel:empty_input'],
  };
}

function scaleClassToContract(c: ReturnType<typeof inferScaleClass>): LocationDemandScaleClass {
  return c;
}

function voteWeight(d: LocationDemandScoredDriver): number {
  if (!d.accepted) return 0;
  if (d.driverKind === 'noise' || d.driverKind === 'local_interest') return 0;
  if (d.driverKind === 'supporting_infrastructure') return d.finalContribution * 0.35;
  return d.finalContribution;
}

function arbitrateDominantType(votes: LocationDemandScoredDriver[]): LocationDemandKernelDemandType {
  const buckets = new Map<LocationDemandKernelDemandType, number>();
  for (const d of votes) {
    const w = voteWeight(d);
    if (!d.demandTypeVote || w <= 0) continue;
    buckets.set(d.demandTypeVote, (buckets.get(d.demandTypeVote) ?? 0) + w);
  }
  if (buckets.size === 0) return 'weak/unclear';

  let bestType: LocationDemandKernelDemandType = 'weak/unclear';
  let best = 0;
  let second = 0;
  for (const [t, v] of buckets) {
    if (v > best) {
      second = best;
      best = v;
      bestType = t;
    } else if (v > second) second = v;
  }

  const total = [...buckets.values()].reduce((a, b) => a + b, 0);
  if (best < total * 0.28) return 'mixed';
  if (second >= best * 0.85 && bestType !== 'weak/unclear') return 'mixed';
  return bestType;
}

function applyProportionalCap(
  drivers: LocationDemandScoredDriver[],
  predicate: (d: LocationDemandScoredDriver) => boolean,
  cap: number,
  label: string,
  breakdown: LocationDemandScoringKernelResult['scoreBreakdown'],
  debugTrace: string[],
): void {
  const subset = drivers.filter(predicate);
  const sum = subset.reduce((s, d) => s + d.finalContribution, 0);
  if (sum <= cap || sum <= 0) return;
  const factor = cap / sum;
  let applied = 0;
  for (const d of subset) {
    const before = d.finalContribution;
    d.finalContribution *= factor;
    applied += before - d.finalContribution;
  }
  debugTrace.push(`cap:${label}:before=${sum.toFixed(2)}:after=${cap}`);
  if (label === 'supporting_infra') breakdown.cappedSupportingInfra += applied;
  else if (label === 'local_interest') breakdown.cappedLocalInterest += applied;
  else if (label === 'hotels') breakdown.cappedHotels += applied;
  else if (label === 'tourism_no_anchor') breakdown.cappedTourismWithoutAnchor += applied;
}

export function runLocationDemandScoringKernel(
  input: LocationDemandKernelInput,
): LocationDemandScoringKernelResult {
  const debugTrace: string[] = [];
  const warnings: string[] = [];
  const { magnets, magnetFacts, canonicalFacts, engineFinalScore } = input;

  if (!magnetFacts.length || !magnets.length) {
    return emptyResult(engineFinalScore);
  }

  const integritySkip =
    input.analysisIncomplete ||
    input.scoreBlockedDueToIncompleteData ||
    !Number.isFinite(engineFinalScore);

  const breakdown: LocationDemandScoringKernelResult['scoreBreakdown'] = {
    rawSumBeforeCaps: 0,
    cappedSupportingInfra: 0,
    cappedLocalInterest: 0,
    cappedHotels: 0,
    cappedGenericBusiness: 0,
    cappedTourismWithoutAnchor: 0,
    cappedNoTier1Penalty: 0,
    cappedSmallCitySparse: 0,
    finalWeightedSum: 0,
  };

  const staged: LocationDemandScoredDriver[] = [];

  const cityTier = input.cityScaleTier;
  const n = Math.min(magnets.length, magnetFacts.length);
  for (let i = 0; i < n; i++) {
    const m = magnets[i]!;
    const mf = magnetFacts[i]!;
    const tags = tagsForMagnetIndex(i, canonicalFacts);
    const { kind, reason: kindReason } = classifyDriverKind({ m, magnets, tags });
    let scaleClass = inferScaleClass(m, tags, cityTier);
    scaleClass = coerceMunicipalHospitalScaleForSmallCity(m, cityTier, scaleClass);
    let tier = resolveDemandTier({ m, scaleClass, tags, cityTier });

    if (scaleClass === 'unknown' && tier === 1 && (m.categoryId === 'airport' || m.categoryId === 'strategicTransportHub')) {
      tier = 2;
      debugTrace.push(`${mf.id}:tier_downgrade:unknown_scale_airport_like`);
    }

    const demandTypeVote = demandTypeVoteForMagnet(m, kind);
    const profile = distanceDecayProfiles(m.categoryId);
    const distCoeff = computeDistanceCoefficient(m.distance, profile);
    let scaleCoeff = scaleCoefficientFromClassInner(scaleClass);
    const confCoeff = confidenceCoefficientFromMagnet(m);

    if (kind === 'noise' || kind === 'local_interest') {
      scaleCoeff = kind === 'noise' ? 0 : Math.min(scaleCoeff, 0.25);
    }

    const baseWeight = baseWeightForTier(tier, kind);
    let contribution = baseWeight * distCoeff * scaleCoeff * confCoeff;

    if (kind === 'noise') contribution = 0;

    const driver: LocationDemandScoredDriver = {
      magnetFactId: mf.id,
      evidenceId: `ev:${mf.id}`,
      sourceName: m.name,
      category: mf.category,
      driverKind: kind,
      resolvedTier: tier,
      scaleClass: scaleClassToContract(scaleClass),
      demandTypeVote,
      distanceMeters: Math.round(m.distance),
      baseWeight,
      distanceCoefficient: distCoeff,
      scaleCoefficient: scaleCoeff,
      confidenceCoefficient: confCoeff,
      finalContribution: contribution,
      accepted: false,
      reason: kindReason,
    };

    let accepted = true;
    let rejectReason = '';

    if (kind === 'noise') {
      accepted = false;
      rejectReason = kindReason;
    } else if (kind === 'local_interest') {
      accepted = false;
      rejectReason = 'local_interest:no_public_score';
    } else if (!mf.includedInScore && kind !== 'supporting_infrastructure') {
      accepted = false;
      rejectReason = 'category_excluded_from_engine_score';
    }

    if (!Number.isFinite(m.distance) || m.distance <= 0) {
      accepted = false;
      rejectReason = 'missing_distance';
    }

    driver.accepted = accepted;
    if (!accepted) driver.reason = rejectReason || kindReason;

    staged.push(driver);
    breakdown.rawSumBeforeCaps += contribution;
    debugTrace.push(
      `row:${mf.id}:kind=${kind}:tier=${tier}:scale=${scaleClass}:contrib=${contribution.toFixed(2)}:${driver.reason}`,
    );
  }

  const structuralStrongAnchor = staged.some(
    d =>
      d.accepted &&
      d.driverKind === 'real_demand_driver' &&
      (d.resolvedTier === 1 ||
        (d.resolvedTier === 2 && d.scaleClass === 'verified_major') ||
        (d.resolvedTier === 2 && d.scaleClass === 'medium' && d.finalContribution >= 1.82)),
  );

  const working = staged.map(d => ({ ...d }));

  /** Tier-1/2 real leisure/tourism POIs unlock higher tourism stacking budgets */
  const effectiveTouristAnchor = working.some(
    d =>
      d.driverKind === 'real_demand_driver' &&
      d.demandTypeVote === 'tourist' &&
      d.resolvedTier <= 2,
  );

  applyProportionalCap(
    working,
    d => d.driverKind === 'supporting_infrastructure' && !isHotelCategory(magnets, d.magnetFactId),
    CAP_SUPPORTING_INFRA,
    'supporting_infra',
    breakdown,
    debugTrace,
  );

  applyProportionalCap(
    working,
    d => d.driverKind === 'supporting_infrastructure' && isHotelCategory(magnets, d.magnetFactId),
    CAP_HOTEL_SUPPORT,
    'hotels',
    breakdown,
    debugTrace,
  );

  applyProportionalCap(
    working,
    d => d.driverKind === 'local_interest',
    CAP_LOCAL_INTEREST,
    'local_interest',
    breakdown,
    debugTrace,
  );

  if (!effectiveTouristAnchor) {
    applyProportionalCap(
      working,
      d => d.demandTypeVote === 'tourist',
      CAP_TOURISM_NO_ANCHOR,
      'tourism_no_anchor',
      breakdown,
      debugTrace,
    );
  }

  const hasTier1 = working.some(d => d.accepted && d.resolvedTier === 1 && d.finalContribution > 0.5);
  const hasStrongTier2 = working.some(
    d =>
      d.accepted &&
      d.resolvedTier === 2 &&
      d.driverKind === 'real_demand_driver' &&
      d.scaleClass !== 'weak_local' &&
      d.finalContribution > 1.5,
  );

  if (!hasTier1 && !hasStrongTier2) {
    for (const d of working) {
      if (d.accepted && d.finalContribution > 0) {
        const before = d.finalContribution;
        d.finalContribution *= NO_TIER1_BLEND_FLOOR;
        breakdown.cappedNoTier1Penalty += before - d.finalContribution;
      }
    }
    debugTrace.push(`cap:no_tier1_or_strong_t2:factor=${NO_TIER1_BLEND_FLOOR}`);
  }

  let finalSum = 0;
  for (const d of working) {
    if (d.accepted) finalSum += d.finalContribution;
  }

  breakdown.finalWeightedSum = finalSum;

  let kernelEvidenceScore = Math.min(100, Math.round((finalSum / REF_SUM_FOR_FULL_SCORE) * 100));

  let dominantDemandType = arbitrateDominantType(working);
  dominantDemandType = resolveDominantDemandTypeWithTourismHardGate(working, magnets, dominantDemandType);

  const driverStrength = Math.min(1, finalSum / 38);
  const blendFactor = 0.1 + 0.9 * driverStrength;
  let blendedPublicScore = Math.round(
    Math.min(100, Math.max(0, (integritySkip ? engineFinalScore : engineFinalScore * blendFactor))),
  );

  if (integritySkip) {
    blendedPublicScore = Math.round(engineFinalScore);
    warnings.push('kernel:integrity_skip_blend');
  }

  let smallCitySparseScoreGuard: SmallCitySparsePublicScoreGuard | undefined;
  const cs = input.cityScaleTier;
  if (!integritySkip && (cs === 'small' || cs === 'micro')) {
    if (!structuralStrongAnchor && blendedPublicScore > SMALL_CITY_PUBLIC_SCORE_CAP) {
      const before = blendedPublicScore;
      blendedPublicScore = SMALL_CITY_PUBLIC_SCORE_CAP;
      breakdown.cappedSmallCitySparse += before - blendedPublicScore;
      smallCitySparseScoreGuard = {
        applied: true,
        reason:
          'small_city_sparse_cap:no_structural_tier1_or_verified_major_or_strong_tier2_medium_anchor',
        scoreBefore: before,
        scoreAfter: blendedPublicScore,
      };
      debugTrace.push(
        `cap:small_city_sparse:before=${before}:after=${blendedPublicScore}:reason=no_structural_major_anchor`,
      );
    } else {
      smallCitySparseScoreGuard = {
        applied: false,
        reason: structuralStrongAnchor
          ? 'small_city_sparse_cap:skipped_verified_major_or_strong_tier2_anchor_present'
          : `small_city_sparse_cap:skipped_score_within_cap_<=${SMALL_CITY_PUBLIC_SCORE_CAP}`,
        scoreBefore: blendedPublicScore,
        scoreAfter: blendedPublicScore,
      };
    }
  }

  const scoredDriversAnnotated: LocationDemandScoredDriver[] = working.map(d => {
    const idx = magnetIndexFromMagnetFactId(d.magnetFactId);
    const cf = idx != null ? canonicalFacts?.[idx] : undefined;
    const eligible = passesPublicDisplayRules(d, magnets);
    return {
      ...d,
      tagAlignmentStatus: tagAlignmentStatusFromCanonical(cf),
      publicDisplayEligible: eligible,
      publicDisplayRejectReason: eligible ? undefined : computePublicDisplayRejectReason(d, magnets),
    };
  });

  const acceptedDrivers = scoredDriversAnnotated.filter(d => d.accepted && d.finalContribution > 0.05);
  const rejectedDrivers = scoredDriversAnnotated.filter(d => !d.accepted || d.finalContribution <= 0.05);

  if (!effectiveTouristAnchor && magnets.some(m => m.categoryId === 'major_hotel' || m.categoryId === 'mid_hotel')) {
    debugTrace.push('rule:hotels_do_not_create_tourism');
  }

  return {
    acceptedDrivers,
    rejectedDrivers,
    scoredDrivers: scoredDriversAnnotated,
    dominantDemandType,
    scoreBreakdown: breakdown,
    kernelEvidenceScore,
    blendedPublicScore,
    smallCitySparseScoreGuard,
    warnings,
    debugTrace,
  };
}

function scaleCoefficientFromClassInner(c: ReturnType<typeof inferScaleClass>): number {
  switch (c) {
    case 'verified_major':
      return 1.15;
    case 'medium':
      return 0.75;
    case 'weak_local':
      return 0.22;
    default:
      return 0.45;
  }
}

function isHotelCategory(magnets: readonly MagnetItem[], magnetFactId: string): boolean {
  const idx = magnetFactId.split(':')[1];
  const i = idx !== undefined ? Number.parseInt(idx, 10) : NaN;
  if (!Number.isFinite(i)) return false;
  const m = magnets[i];
  return m?.categoryId === 'major_hotel' || m?.categoryId === 'mid_hotel';
}

export function buildDemandSignalsFromKernel(args: {
  accepted: readonly LocationDemandScoredDriver[];
  magnetFacts: readonly MagnetFact[];
  magnets: readonly MagnetItem[];
}): DemandSignal[] {
  const { accepted, magnetFacts, magnets } = args;
  const byFact = new Map(magnetFacts.map(f => [f.id, f]));
  const primaryDrivers = accepted.filter(
    d =>
      d.publicDisplayEligible &&
      (d.driverKind === 'real_demand_driver' ||
        d.driverKind === 'unknown_uncapped' ||
        (d.driverKind === 'supporting_infrastructure' &&
          isMetroOrRail(magnets, d.magnetFactId) &&
          d.finalContribution >= PUBLIC_DISPLAY_METRO_RAIL_MIN)),
  );

  const ordered = [...primaryDrivers].sort((a, b) => b.finalContribution - a.finalContribution);

  const out: DemandSignal[] = [];

  for (const d of ordered) {
    const mf = byFact.get(d.magnetFactId);
    if (!mf) continue;

    const strength =
      d.resolvedTier === 1 ? 'strong' : d.resolvedTier === 2 ? 'moderate' : 'weak';
    const roleFromVote = demandVoteToMagnetRole(d.demandTypeVote, d.driverKind);
    const patched: MagnetFact = {
      ...mf,
      tier: d.resolvedTier === 1 ? 'primary' : d.resolvedTier === 2 ? 'secondary' : 'weak',
      role: roleFromVote ?? mf.role,
      explanationRu: formatPublicEvidenceLineRu({ ...mf, role: roleFromVote ?? mf.role }),
    };

    const type = `${patched.role}_${patched.category.replace(/\s+/g, '_').slice(0, 40)}`;

    out.push({
      id: `ds:${patched.id}`,
      type,
      strength,
      evidenceFactIds: [patched.id],
      reason: patched.explanationRu,
      publicLabelRu: patched.explanationRu,
      internalReason: `kernel_v1:${d.driverKind}:tier${d.resolvedTier}:${d.reason}`,
    });
  }

  return out.length ? out : [];
}

export function magnetRoleForScoredDriver(d: LocationDemandScoredDriver): MagnetFact['role'] | null {
  return demandVoteToMagnetRole(d.demandTypeVote, d.driverKind);
}

function demandVoteToMagnetRole(
  vote: LocationDemandKernelDemandType | null,
  kind: LocationDemandScoredDriver['driverKind'],
): MagnetFact['role'] | null {
  if (kind === 'supporting_infrastructure') return 'accessibility';
  switch (vote) {
    case 'corporate/business':
      return 'business_demand';
    case 'medical':
      return 'medical_demand';
    case 'transport':
      return 'transport_anchor';
    case 'industrial':
      return 'business_demand';
    case 'tourist':
      return 'tourist_demand';
    case 'education':
      return 'business_demand';
    default:
      return null;
  }
}

function isMetroOrRail(magnets: readonly MagnetItem[], magnetFactId: string): boolean {
  const parts = magnetFactId.split(':');
  const i = parts.length >= 2 ? Number.parseInt(parts[1]!, 10) : NaN;
  if (!Number.isFinite(i)) return false;
  const m = magnets[i];
  return m?.categoryId === 'metro' || m?.categoryId === 'railway_station';
}

/** Evidence rows for public claims — stricter than kernel acceptance (noise/hotel/generic tier-3 excluded). */
export function kernelDriversEligibleForPublicDisplay(args: {
  kernel: LocationDemandScoringKernelResult;
  magnets: readonly MagnetItem[];
}): LocationDemandScoredDriver[] {
  const { kernel, magnets } = args;
  const pool = kernel.scoredDrivers.filter(d => d.publicDisplayEligible);

  const demandAnchors = pool.filter(
    d => d.driverKind === 'real_demand_driver' || d.driverKind === 'unknown_uncapped',
  );

  const transit = pool.filter(
    d => d.driverKind === 'supporting_infrastructure' && isMetroOrRail(magnets, d.magnetFactId),
  );

  const ranked = [...demandAnchors, ...transit].sort((a, b) => b.finalContribution - a.finalContribution);

  const seen = new Set<string>();
  const dedup: LocationDemandScoredDriver[] = [];
  for (const d of ranked) {
    if (seen.has(d.magnetFactId)) continue;
    seen.add(d.magnetFactId);
    dedup.push(d);
  }
  return dedup;
}

/** @deprecated Prefer {@link kernelDriversEligibleForPublicDisplay} — kept for binary compat in forks */
export function kernelDriversEligibleForPublicClaims(args: {
  kernel: LocationDemandScoringKernelResult;
  magnets: readonly MagnetItem[];
}): LocationDemandScoredDriver[] {
  return kernelDriversEligibleForPublicDisplay(args);
}
