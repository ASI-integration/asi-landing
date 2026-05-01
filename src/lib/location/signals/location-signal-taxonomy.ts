import type { MagnetItem } from '../types';
import {
  classifyCanonicalMagnet,
  mustSurfaceRadiusMForFamily,
} from '../canonical/magnet-registry';

export { isPersonNameOfficePoi } from '../canonical/magnet-registry';

export type SignalLevel =
  | 'tier1_anchor'
  | 'tier2_anchor'
  | 'weak_local_signal'
  | 'noise'
  | 'negative_environment_signal';

export type SignalDomain =
  | 'business'
  | 'tourist'
  | 'medical'
  | 'education'
  | 'transport'
  | 'civic'
  | 'hospitality'
  | 'retail'
  | 'residential_support'
  | 'environment_negative';

export type PublicClaimStrength =
  | 'strong_driver_allowed'
  | 'moderate_driver_allowed'
  | 'weak_context_only'
  | 'hidden_from_public_copy';

export const FORBIDDEN_PUBLIC_WORDING_RU: ReadonlyArray<string> = [
  'основной драйвер',
  'стабильный поток командированных',
  'кластер деловых объектов',
  'сильный коммерческий профиль',
  'сильная туристическая локация',
  'сильная медицинская локация',
  'сильная образовательная локация',
  'студенческий поток',
  'медицинский кластер',
];

export interface MagnetSignalTaxonomy {
  level: SignalLevel;
  domain: SignalDomain;
  publicClaimStrength: PublicClaimStrength;
  allowsBusinessAudience: boolean;
  isWeakLocalBusinessPoi: boolean;
}

function domainFor(m: MagnetItem): SignalDomain {
  if (m.categoryId === 'civic') return 'civic';
  if (m.categoryId === 'major_hotel' || m.categoryId === 'mid_hotel') return 'hospitality';
  const d = classifyCanonicalMagnet({ magnet: m });
  switch (d.family) {
    case 'airport':
    case 'railway_station':
    case 'metro_station':
    case 'transport_hub':
      return 'transport';
    case 'hospital':
    case 'medical_cluster':
      return 'medical';
    case 'university':
      return 'education';
    case 'business_center':
    case 'office_cluster':
    case 'industrial_anchor':
    case 'industrial_zone':
      return 'business';
    case 'shopping_mall':
      // Keep legacy behavior: strong malls behave like tourist/leisure anchors;
      // weak retail signals are a separate retail/weak branch.
      return d.anchorStrength === 'weak' ? 'retail' : 'tourist';
    case 'stadium_event_venue':
      return m.categoryId === 'convention' ? 'civic' : 'tourist';
    case 'hotel_cluster':
      return 'hospitality';
    case 'museum':
    case 'theater':
    case 'tourist_attraction':
    case 'cultural_landmark':
    case 'park':
    case 'beach_waterfront':
    case 'resort_area':
      return 'tourist';
    case 'weak_amenity':
    case 'residential_density':
      return 'residential_support';
    default:
      return 'residential_support';
  }
}

function levelFor(m: MagnetItem): SignalLevel {
  const d = classifyCanonicalMagnet({ magnet: m });
  switch (d.anchorStrength) {
    case 'tier1': return 'tier1_anchor';
    case 'tier2': return 'tier2_anchor';
    case 'weak':  return 'weak_local_signal';
    case 'noise': return 'noise';
    case 'negative': return 'negative_environment_signal';
  }
}

export function looksLikeWeakLocalAttractionPoi(m: MagnetItem): boolean {
  const d = classifyCanonicalMagnet({ magnet: m });
  return (
    m.categoryId === 'attraction' &&
    (d.family === 'museum' || d.family === 'tourist_attraction' || d.family === 'cultural_landmark') &&
    d.anchorStrength === 'weak'
  );
}

export function looksLikeWeakLocalMedicalPoi(m: MagnetItem): boolean {
  const d = classifyCanonicalMagnet({ magnet: m });
  return m.categoryId === 'hospital' && d.anchorStrength === 'weak';
}

export function looksLikeWeakLocalEducationPoi(m: MagnetItem): boolean {
  const d = classifyCanonicalMagnet({ magnet: m });
  return m.categoryId === 'university' && d.anchorStrength === 'weak';
}

export function looksLikeWeakLocalHospitalityPoi(m: MagnetItem): boolean {
  const d = classifyCanonicalMagnet({ magnet: m });
  return (m.categoryId === 'mid_hotel' || m.categoryId === 'major_hotel') && d.anchorStrength === 'weak';
}

export function looksLikeWeakLocalRetailPoi(m: MagnetItem): boolean {
  const d = classifyCanonicalMagnet({ magnet: m });
  return m.categoryId === 'shopping_major' && d.family === 'shopping_mall' && d.anchorStrength === 'weak';
}

export function looksLikeWeakLocalCivicPoi(m: MagnetItem): boolean {
  return m.categoryId === 'civic';
}

export function isCbdTransitAnchorPoi(m: MagnetItem): boolean {
  const d = classifyCanonicalMagnet({ magnet: m });
  return (m.categoryId === 'metro' || m.categoryId === 'railway_station') && d.family === 'metro_station' && d.anchorStrength === 'tier1';
}

export function isStrongBusinessAnchorPoi(m: MagnetItem): boolean {
  const d = classifyCanonicalMagnet({ magnet: m });
  return d.family === 'business_center' || d.anchorStrength === 'tier1';
}

export function looksLikeWeakLocalBusinessPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'business') return false;
  const d = classifyCanonicalMagnet({ magnet: m });
  return d.anchorStrength === 'weak';
}

export function classifyMagnetSignal(m: MagnetItem): MagnetSignalTaxonomy {
  const d = classifyCanonicalMagnet({ magnet: m });
  const domain = domainFor(m);
  const level = levelFor(m);
  const allowsBusinessAudience = d.audiences.business || d.audiences.corporate;
  const isWeakLocalBusinessPoi = m.categoryId === 'business' && level === 'weak_local_signal';
  return {
    level,
    domain,
    publicClaimStrength: d.public.claimStrength,
    allowsBusinessAudience,
    isWeakLocalBusinessPoi,
  };
}

function isCredible(m: MagnetItem, domain: SignalDomain): boolean {
  const t = classifyMagnetSignal(m);
  if (t.domain !== domain) return false;
  return t.level === 'tier1_anchor' || t.level === 'tier2_anchor';
}

export function isCredibleBusinessAnchor(m: MagnetItem): boolean {
  const t = classifyMagnetSignal(m);
  if (t.domain === 'business') return t.level === 'tier1_anchor' || t.level === 'tier2_anchor';
  return t.allowsBusinessAudience === true;
}

export function isCredibleTouristAnchor(m: MagnetItem): boolean {
  return isCredible(m, 'tourist');
}

export function isCredibleMedicalAnchor(m: MagnetItem): boolean {
  return isCredible(m, 'medical');
}

export function isCredibleEducationAnchor(m: MagnetItem): boolean {
  return isCredible(m, 'education');
}

export function isCredibleTransportAnchor(m: MagnetItem): boolean {
  const t = classifyMagnetSignal(m);
  return t.domain === 'transport' && t.level === 'tier1_anchor';
}

export function isCredibleHospitalityAnchor(m: MagnetItem): boolean {
  return isCredible(m, 'hospitality');
}

export function isCredibleRetailAnchor(m: MagnetItem): boolean {
  const t = classifyMagnetSignal(m);
  if (m.categoryId !== 'shopping_major') return false;
  // Only strong mall signals count; weak retail is not credible.
  if (t.domain === 'retail') return false;
  return t.level === 'tier1_anchor' || t.level === 'tier2_anchor';
}

export function isCredibleCivicAnchor(_m: MagnetItem): boolean {
  return false;
}

export function allowsBusinessAudienceFromMagnets(magnets: MagnetItem[]): boolean {
  return magnets.some(m => classifyMagnetSignal(m).allowsBusinessAudience);
}

export function hasCredibleBusinessAnchors(magnets: MagnetItem[]): boolean {
  return magnets.some(m => {
    const t = classifyMagnetSignal(m);
    return (
      (t.domain === 'business' &&
        (t.level === 'tier1_anchor' || t.level === 'tier2_anchor') &&
        t.publicClaimStrength !== 'hidden_from_public_copy') ||
      t.allowsBusinessAudience
    );
  });
}

export function hasCredibleTouristAnchors(magnets: MagnetItem[]): boolean {
  return magnets.some(isCredibleTouristAnchor);
}

export function hasCredibleMedicalAnchors(magnets: MagnetItem[]): boolean {
  return magnets.some(isCredibleMedicalAnchor);
}

export function hasCredibleEducationAnchors(magnets: MagnetItem[]): boolean {
  return magnets.some(isCredibleEducationAnchor);
}

export function hasCredibleHospitalityCluster(magnets: MagnetItem[]): boolean {
  const credible = magnets.filter(isCredibleHospitalityAnchor);
  return credible.length >= 2;
}

export function isMustSurfaceAnchor(m: MagnetItem): boolean {
  const d = classifyCanonicalMagnet({ magnet: m });
  const radius = mustSurfaceRadiusMForFamily(d.family);
  if (radius == null) return false;
  if (!Number.isFinite(m.distance) || m.distance > radius) return false;

  const t = classifyMagnetSignal(m);
  if (t.level !== 'tier1_anchor' && t.level !== 'tier2_anchor') return false;
  if (t.publicClaimStrength === 'hidden_from_public_copy') return false;

  // Legacy rule retained: non-CBD metro is context, not must-surface.
  if (m.categoryId === 'metro' && !isCbdTransitAnchorPoi(m)) return false;
  if (m.categoryId === 'shopping_major' && looksLikeWeakLocalRetailPoi(m)) return false;

  return true;
}

export function getCredibleAnchorsByDomain(magnets: MagnetItem[]): Record<SignalDomain, MagnetItem[]> {
  const out: Record<SignalDomain, MagnetItem[]> = {
    business: [],
    tourist: [],
    medical: [],
    education: [],
    transport: [],
    civic: [],
    hospitality: [],
    retail: [],
    residential_support: [],
    environment_negative: [],
  };
  for (const m of magnets) {
    const t = classifyMagnetSignal(m);
    if (t.level !== 'tier1_anchor' && t.level !== 'tier2_anchor') continue;
    if (t.publicClaimStrength === 'hidden_from_public_copy') continue;
    out[t.domain].push(m);
  }
  return out;
}

export function getMustSurfaceAnchors(magnets: MagnetItem[]): MagnetItem[] {
  const surfacing = magnets.filter(isMustSurfaceAnchor);
  return [...surfacing].sort((a, b) => a.distance - b.distance);
}
