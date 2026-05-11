/**
 * Deterministic gates, tiers, distance decay, and scale coefficients for demand kernel v1.
 */

import type { CanonicalLocationFact } from './location-decision-contract';
import type { MagnetItem } from './types';
import type { CityScale, CityScaleInference } from './city-scale-from-address';
import {
  isStrongBusinessAnchorPoi,
  looksLikeSmallTownMunicipalHospitalPoi,
  looksLikeWeakLocalAttractionPoi,
  looksLikeWeakLocalBusinessPoi,
  looksLikeWeakLocalMedicalPoi,
} from './signals/location-signal-taxonomy';

/** Mirrors taxonomy STRONG_MEDICAL — kept local to avoid exporting taxonomy internals */
const MEDICAL_MAJOR_NAME_HINT_RE =
  /больниц|госпитал|медицинский\s+центр|клиническая\s+больниц|перинатальн|онкологическ|кардиологическ|(?:^|\s)нии(?:$|\s|\W)|научный\s+центр|многопрофильн/i;

const STRONG_EDUCATION_NAME_HINT_RE =
  /университет|институт|академия|кампус|university|campus|политех|\bhse\b|вшэ/i;
import type {
  LocationDemandDriverKind,
  LocationDemandKernelDemandType,
  LocationDemandResolvedTier,
} from './location-scoring-contract';

const GENERIC_SERVICE_NAME_RE =
  /\bсдэк\b|\bsdek\b|\bmegafon\b|\bмегафон\b|\bмтс\b|\bбилайн\b|\btele2\b|\bтеле2\b|\byandex\b|\bяндекс\b|\bpickpoint\b|\bпостамат\b|\bозон\b|\bwildberries\b|\bwb\b|\bcdek\b/i;

const SMALL_ATTRACTION_NAME_RE =
  /театр|theatre|музей(?!\s+(?:истории|истории))/i;

/** Same semantics as location-decision-rules — duplicated here to avoid import cycles with the kernel */
function informativeEvidenceNameRu(name: string | undefined, categoryId: string): boolean {
  const n = (name ?? '').trim().toLowerCase();
  if (!n && categoryId !== 'metro') return false;
  if (categoryId === 'attraction' && (n === 'достопримечательность' || !n)) return false;
  return true;
}

function hasTouristAnchorCluster(magnets: readonly MagnetItem[]): boolean {
  const anchors = magnets.filter(
    x =>
      ['entertainment', 'stadium', 'convention'].includes(x.categoryId) && x.distance <= 1200,
  );
  return anchors.length >= 2;
}

export interface DistanceDecayProfile {
  primeM: number;
  usefulM: number;
  maxM: number;
  /** 'smooth' = smoothstep falloff */
  curve: 'smooth' | 'linear';
}

export function distanceDecayProfiles(categoryId: string): DistanceDecayProfile {
  switch (categoryId) {
    case 'airport':
    case 'strategicTransportHub':
      return { primeM: 3500, usefulM: 12000, maxM: 45000, curve: 'smooth' };
    case 'railway_station':
      return { primeM: 600, usefulM: 2500, maxM: 8000, curve: 'smooth' };
    case 'metro':
      return { primeM: 400, usefulM: 900, maxM: 2000, curve: 'linear' };
    case 'hospital':
    case 'specializedMedicalAnchor':
      return { primeM: 500, usefulM: 2000, maxM: 7000, curve: 'smooth' };
    case 'university':
      return { primeM: 600, usefulM: 2200, maxM: 6000, curve: 'smooth' };
    case 'business':
      return { primeM: 400, usefulM: 1800, maxM: 6000, curve: 'smooth' };
    case 'stadium':
    case 'convention':
    case 'entertainment':
      return { primeM: 700, usefulM: 2800, maxM: 9000, curve: 'smooth' };
    case 'shopping_major':
      return { primeM: 600, usefulM: 2500, maxM: 8000, curve: 'smooth' };
    case 'attraction':
      return { primeM: 400, usefulM: 1500, maxM: 5000, curve: 'smooth' };
    case 'major_hotel':
    case 'mid_hotel':
      return { primeM: 200, usefulM: 800, maxM: 2500, curve: 'linear' };
    default:
      return { primeM: 300, usefulM: 1200, maxM: 4000, curve: 'linear' };
  }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 1 at prime, decays to ~0 beyond max */
export function computeDistanceCoefficient(
  distanceM: number,
  profile: DistanceDecayProfile,
): number {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 0;
  const { primeM, usefulM, maxM, curve } = profile;
  if (distanceM <= primeM) return 1;
  if (distanceM >= maxM) return 0.02;
  if (curve === 'linear') {
    const u = (distanceM - primeM) / (maxM - primeM);
    return clamp01(1 - u * 0.92);
  }
  const mid = usefulM;
  if (distanceM <= mid) {
    return clamp01(1 - smoothstep(primeM, mid, distanceM) * 0.55);
  }
  return clamp01((1 - 0.55) * (1 - smoothstep(mid, maxM, distanceM)) + 0.02);
}

export type ScaleClass = 'verified_major' | 'medium' | 'weak_local' | 'unknown';

export function inferScaleClass(
  m: MagnetItem,
  tags?: Record<string, string>,
  cityScale?: CityScale,
): ScaleClass {
  const t = tags ?? {};
  const name = (m.name ?? '').toLowerCase();

  if (m.categoryId === 'airport' || m.subType === 'airport') {
    if (t.iata || t['iata'] || /international|международн/i.test(name) || t.aerodrome === 'international')
      return 'verified_major';
    if (m.strategicReachBand === 'strategic') return 'verified_major';
    return 'unknown';
  }

  if (m.categoryId === 'strategicTransportHub') {
    if (m.strategicReachBand === 'strategic' && m.subType === 'airport') return 'verified_major';
    if (m.strategicReachBand === 'strategic') return 'medium';
    return 'unknown';
  }

  if (m.categoryId === 'hospital') {
    if (looksLikeWeakLocalMedicalPoi(m)) return 'weak_local';
    const cityIsMunicipalLike = cityScale === 'small_city' || cityScale === 'micro_city' || cityScale === 'settlement' || cityScale === 'unknown';
    if (cityIsMunicipalLike && looksLikeSmallTownMunicipalHospitalPoi(m)) {
      return 'weak_local';
    }
    if (MEDICAL_MAJOR_NAME_HINT_RE.test(name) && m.strengthClass === 'strong') return 'verified_major';
    if (MEDICAL_MAJOR_NAME_HINT_RE.test(name)) return 'medium';
    return 'unknown';
  }

  if (m.categoryId === 'specializedMedicalAnchor') {
    if (
      (cityScale === 'small_city' || cityScale === 'micro_city' || cityScale === 'settlement' || cityScale === 'unknown') &&
      looksLikeSmallTownMunicipalHospitalPoi(m)
    ) {
      return 'weak_local';
    }
    if (m.specializedMedicalReachBand === 'primary') return 'verified_major';
    return 'medium';
  }

  if (m.categoryId === 'university') {
    if (STRONG_EDUCATION_NAME_HINT_RE.test(name)) return 'verified_major';
    if (m.scopeLevel === 'regional' || m.scopeLevel === 'federal') return 'medium';
    return 'unknown';
  }

  if (m.categoryId === 'business') {
    const st = m.subType?.toLowerCase();
    if (st === 'factory' || st === 'industrial') {
      if (isStrongBusinessAnchorPoi(m)) return 'medium';
      return 'unknown';
    }
    if (isStrongBusinessAnchorPoi(m)) return 'verified_major';
    return 'weak_local';
  }

  if (m.categoryId === 'railway_station') {
    if (t.station === 'subway') return 'medium';
    if (/вокзал|terminal|интермодальн/i.test(name)) return 'medium';
    return 'unknown';
  }

  if (m.categoryId === 'stadium' || m.categoryId === 'convention') return 'medium';

  if (m.categoryId === 'entertainment') {
    if (SMALL_ATTRACTION_NAME_RE.test(name)) return 'weak_local';
    return 'medium';
  }

  if (m.categoryId === 'attraction') return looksLikeWeakLocalAttractionPoi(m) ? 'weak_local' : 'medium';

  if (m.categoryId === 'shopping_major') return 'medium';

  if (m.strengthClass === 'strong') return 'medium';
  if (m.strengthClass === 'medium') return 'medium';
  return 'weak_local';
}

export function scaleCoefficientFromClass(c: ScaleClass): number {
  switch (c) {
    case 'verified_major':
      return 1.15;
    case 'medium':
      return 0.75;
    case 'weak_local':
      return 0.22;
    case 'unknown':
      return 0.45;
    default:
      return 0.45;
  }
}

export function confidenceCoefficientFromMagnet(m: MagnetItem): number {
  if (m.strengthClass === 'strong') return 1;
  if (m.strengthClass === 'medium') return 0.88;
  return 0.72;
}

/** Tier resolver — deterministic; unknown-scale important categories never default to Tier 1. */
export function resolveDemandTier(args: {
  m: MagnetItem;
  scaleClass: ScaleClass;
  tags?: Record<string, string>;
  cityScaleInference?: CityScaleInference;
}): LocationDemandResolvedTier {
  const { m, scaleClass } = args;
  const cityScale = args.cityScaleInference?.cityScale;
  const flags = args.cityScaleInference?.specialMarketFlags ?? [];
  const cityIsMunicipalLike = cityScale === 'small_city' || cityScale === 'micro_city' || cityScale === 'settlement' || cityScale === 'unknown';
  const resortException = flags.includes('resort_exception') || flags.includes('federal_tourist_anchor');
  const regionalMedicalCluster = flags.includes('regional_medical_cluster');
  const majorIndustrialEmployer = flags.includes('major_industrial_employer');
  const universityTown = flags.includes('university_town');
  const largeTransportHub = flags.includes('large_transport_hub') || flags.includes('port_or_logistics_gateway');

  const forceWeak =
    m.categoryId === 'food' ||
    m.categoryId === 'shopping_local' ||
    m.categoryId === 'education_local' ||
    m.categoryId === 'civic' ||
    m.categoryId === 'accessibility_stop';

  if (forceWeak) return 3;

  if (m.categoryId === 'airport' || (m.categoryId === 'strategicTransportHub' && m.subType === 'airport')) {
    if (scaleClass === 'verified_major') return 1;
    if (scaleClass === 'medium') return 2;
    return 2;
  }

  if (m.categoryId === 'strategicTransportHub') {
    if (scaleClass === 'verified_major') return 1;
    if (scaleClass === 'medium') return 2;
    return 3;
  }

  if (m.categoryId === 'hospital') {
    if (cityIsMunicipalLike && looksLikeSmallTownMunicipalHospitalPoi(m)) {
      return regionalMedicalCluster ? 2 : 3;
    }
    if (scaleClass === 'verified_major') return 1;
    if (scaleClass === 'medium') return 2;
    if (scaleClass === 'unknown') return 2;
    return 3;
  }

  if (m.categoryId === 'specializedMedicalAnchor') {
    if (cityIsMunicipalLike && looksLikeSmallTownMunicipalHospitalPoi(m)) {
      return regionalMedicalCluster ? 2 : 3;
    }
    if (m.specializedMedicalReachBand === 'primary') return 1;
    return 2;
  }

  if (m.categoryId === 'university') {
    if (scaleClass === 'verified_major') return 1;
    if (scaleClass === 'medium') return cityIsMunicipalLike && !universityTown ? 3 : 2;
    return 3;
  }

  if (m.categoryId === 'railway_station') {
    if (scaleClass === 'medium') return cityIsMunicipalLike && !largeTransportHub ? 3 : 2;
    if (scaleClass === 'unknown') return 3;
    return 3;
  }

  if (m.categoryId === 'metro') {
    return 3;
  }

  if (m.categoryId === 'business') {
    const st = m.subType?.toLowerCase();
    if (st === 'factory' || st === 'industrial') {
      if (scaleClass === 'verified_major') return 2;
      if (scaleClass === 'medium') return cityIsMunicipalLike && !majorIndustrialEmployer ? 3 : 2;
      return 3;
    }
    if (isStrongBusinessAnchorPoi(m)) return 2;
    return 3;
  }

  if (m.categoryId === 'stadium' || m.categoryId === 'convention') return 2;

  if (m.categoryId === 'entertainment') {
    if (SMALL_ATTRACTION_NAME_RE.test(m.name)) return 3;
    return 2;
  }

  if (m.categoryId === 'shopping_major') return 2;

  if (m.categoryId === 'attraction') {
    if (looksLikeWeakLocalAttractionPoi(m)) return cityIsMunicipalLike && resortException ? 2 : 3;
    return 2;
  }

  if (m.categoryId === 'major_hotel' || m.categoryId === 'mid_hotel') return 3;

  return 3;
}

export function baseWeightForTier(tier: LocationDemandResolvedTier, kind: LocationDemandDriverKind): number {
  if (kind === 'noise' || kind === 'local_interest') return 0;
  if (kind === 'supporting_infrastructure') {
    return tier === 1 ? 5 : tier === 2 ? 3.5 : 2;
  }
  if (kind === 'unknown_uncapped') return tier === 1 ? 12 : tier === 2 ? 7 : 3;
  switch (tier) {
    case 1:
      return 22;
    case 2:
      return 12;
    default:
      return 5;
  }
}

export function demandTypeVoteForMagnet(
  m: MagnetItem,
  kind: LocationDemandDriverKind,
): LocationDemandKernelDemandType | null {
  if (kind === 'noise' || kind === 'local_interest') return null;
  if (kind === 'supporting_infrastructure') {
    if (
      m.categoryId === 'metro' ||
      m.categoryId === 'railway_station' ||
      m.categoryId === 'airport' ||
      m.categoryId === 'strategicTransportHub'
    )
      return 'transport';
    return null;
  }

  switch (m.categoryId) {
    case 'hospital':
    case 'specializedMedicalAnchor':
      return 'medical';
    case 'university':
      return 'education';
    case 'business': {
      const st = m.subType?.toLowerCase();
      if (st === 'factory' || st === 'industrial') return 'industrial';
      return 'corporate/business';
    }
    case 'airport':
    case 'railway_station':
    case 'metro':
    case 'strategicTransportHub':
      return 'transport';
    case 'stadium':
    case 'convention':
    case 'entertainment':
    case 'attraction':
      return 'tourist';
    case 'shopping_major':
      return 'corporate/business';
    default:
      return null;
  }
}

export function classifyDriverKind(args: {
  m: MagnetItem;
  magnets: readonly MagnetItem[];
  tags?: Record<string, string>;
}): { kind: LocationDemandDriverKind; reason: string } {
  const { m, magnets } = args;
  const name = (m.name ?? '').trim();
  const cat = m.categoryId;

  if (!Number.isFinite(m.distance) || m.distance <= 0) {
    return { kind: 'noise', reason: 'missing_distance' };
  }

  const namedOk = informativeEvidenceNameRu(m.name, cat);
  if (!namedOk && cat !== 'metro') {
    return { kind: 'noise', reason: 'unnamed_evidence' };
  }

  if (GENERIC_SERVICE_NAME_RE.test(name)) {
    return { kind: 'noise', reason: 'generic_service_point' };
  }

  if (looksLikeWeakLocalBusinessPoi(m) && cat === 'business') {
    return { kind: 'noise', reason: 'weak_local_office' };
  }

  if (cat === 'food' || cat === 'shopping_local' || cat === 'education_local' || cat === 'civic') {
    return { kind: 'noise', reason: 'non_anchor_category' };
  }

  if (cat === 'competitor' || cat === 'accessibility_stop') {
    return { kind: 'noise', reason: 'supply_or_micro_stop' };
  }

  if (cat === 'major_hotel' || cat === 'mid_hotel') {
    return { kind: 'supporting_infrastructure', reason: 'hotel_supply_context' };
  }

  if (cat === 'metro') {
    return { kind: 'supporting_infrastructure', reason: 'metro_accessibility' };
  }

  if (cat === 'railway_station') {
    const halt = args.tags?.railway === 'halt';
    if (halt && m.distance > 2500) {
      return { kind: 'supporting_infrastructure', reason: 'distant_rail_halt' };
    }
    return { kind: 'real_demand_driver', reason: 'transit_hub_candidate' };
  }

  if (cat === 'airport' || cat === 'strategicTransportHub') {
    const scale = inferScaleClass(m, args.tags);
    if (scale === 'unknown') {
      return { kind: 'unknown_uncapped', reason: 'transport_anchor_unknown_scale' };
    }
    return { kind: 'real_demand_driver', reason: 'transport_anchor' };
  }

  if (cat === 'hospital' || cat === 'specializedMedicalAnchor') {
    return { kind: 'real_demand_driver', reason: 'medical_anchor' };
  }

  if (cat === 'university') {
    return { kind: 'real_demand_driver', reason: 'education_anchor' };
  }

  if (cat === 'business') {
    if (looksLikeWeakLocalBusinessPoi(m)) return { kind: 'noise', reason: 'weak_business_poi' };
    return { kind: 'real_demand_driver', reason: 'business_anchor' };
  }

  if (cat === 'stadium' || cat === 'convention') {
    return { kind: 'real_demand_driver', reason: 'events_anchor' };
  }

  if (cat === 'entertainment') {
    if (SMALL_ATTRACTION_NAME_RE.test(name)) {
      return { kind: 'local_interest', reason: 'small_venue_local_interest' };
    }
    return { kind: 'real_demand_driver', reason: 'leisure_anchor' };
  }

  if (cat === 'shopping_major') {
    return { kind: 'real_demand_driver', reason: 'retail_anchor' };
  }

  if (cat === 'attraction') {
    if (looksLikeWeakLocalAttractionPoi(m)) {
      return { kind: 'local_interest', reason: 'weak_attraction_taxonomy' };
    }
    if (hasTouristAnchorCluster(magnets)) {
      return { kind: 'real_demand_driver', reason: 'tourist_cluster_attraction' };
    }
    return { kind: 'local_interest', reason: 'attraction_without_cluster' };
  }

  return { kind: 'noise', reason: 'unclassified_category' };
}

export function tagsForMagnetIndex(
  idx: number,
  canonicalFacts?: readonly CanonicalLocationFact[],
): Record<string, string> | undefined {
  const cf = canonicalFacts?.[idx];
  return cf?.rawTags;
}
