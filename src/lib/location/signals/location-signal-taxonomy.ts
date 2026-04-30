import type { MagnetItem } from '../types';

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
];

export interface MagnetSignalTaxonomy {
  level: SignalLevel;
  domain: SignalDomain;
  publicClaimStrength: PublicClaimStrength;
  /**
   * true when this signal is eligible to unlock BUSINESS audience claims
   * (corporate/commanded traveler framing) in public copy.
   */
  allowsBusinessAudience: boolean;
  /**
   * true when this is explicitly a weak/local business-like POI that must never
   * be used as a strong public driver (bank/insurance/person-name office/etc).
   */
  isWeakLocalBusinessPoi: boolean;
}

const WEAK_BUSINESS_SUBTYPES = new Set([
  'bank',
  'insurance',
  'commercial',
  'office_anon',
  'travel_agency',
]);

const WEAK_BUSINESS_NAME_RE =
  /банк|bank|страх|insurance|ингосстрах|росгосстрах|ренессанс|сбер|втб|альфа|тинькоф|тиньк|райффайзен|открытие|офис\b|office\b|страхован|нотариус|адвокат|юрист|юридич|бухгалтер|аудит|local\s+office/i;

// "Фамилия И.О." / "Surname I.O."-like patterns.
// Note: avoid relying on trailing \b after '.' (not a word char).
const PERSON_NAME_OFFICE_RE =
  /(?:^|\s)[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.?\s*[А-ЯЁ]\.?(?=$|\s|[,.])|(?:^|\s)[A-Z][a-z]+\s+[A-Z]\.?\s*[A-Z]\.?(?=$|\s|[,.])/;

const STRONG_BUSINESS_ANCHOR_NAME_RE =
  /бизнес-центр|business\s+center|\bбц\b|office\s+complex|деловой\s+центр|москва[-\s]?сити|moscow\s+city|technopark|технопарк|industrial\s+park|штаб-квартира|headquarters/i;

const CBD_CONTEXT_NAME_RE =
  /москва[-\s]?сити|moscow\s+city|деловой\s+центр|central\s+business\s+district|\bcbd\b/i;

function nameStr(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isPersonNameOfficePoi(name: string | undefined): boolean {
  const n = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) return false;
  return PERSON_NAME_OFFICE_RE.test(` ${n} `);
}

export function looksLikeWeakLocalBusinessPoi(m: MagnetItem): boolean {
  const st = m.subType?.toLowerCase().trim();
  if (st && WEAK_BUSINESS_SUBTYPES.has(st)) return true;
  // Generic "office" should be treated as weak/local unless explicitly a known anchor (BC/CBD/etc).
  if (st === 'office') {
    return !STRONG_BUSINESS_ANCHOR_NAME_RE.test(nameStr(m.name));
  }
  const n = nameStr(m.name);
  if (!n) return false;
  if (WEAK_BUSINESS_NAME_RE.test(n)) return true;
  if (isPersonNameOfficePoi(m.name)) return true;
  return false;
}

export function isStrongBusinessAnchorPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'business') return false;
  const st = m.subType?.toLowerCase().trim();
  if (st === 'factory' || st === 'industrial') return true;
  return STRONG_BUSINESS_ANCHOR_NAME_RE.test(nameStr(m.name));
}

export function isCbdTransitAnchorPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'metro' && m.categoryId !== 'railway_station') return false;
  return CBD_CONTEXT_NAME_RE.test(nameStr(m.name));
}

/**
 * Strict signal taxonomy contract.
 *
 * Goal: weak/local POIs must never become strong public demand drivers,
 * and must never unlock BUSINESS audience on their own.
 */
export function classifyMagnetSignal(m: MagnetItem): MagnetSignalTaxonomy {
  // Negative / environment concerns
  if (
    m.categoryId === 'industrial_negative' ||
    m.categoryId === 'airport_noise' ||
    m.categoryId === 'major_road' ||
    m.categoryId === 'railway_noise'
  ) {
    return {
      level: 'negative_environment_signal',
      domain: 'environment_negative',
      publicClaimStrength: 'hidden_from_public_copy',
      allowsBusinessAudience: false,
      isWeakLocalBusinessPoi: false,
    };
  }

  // Transport anchors
  if (m.categoryId === 'airport' || m.categoryId === 'railway_station') {
    return {
      level: 'tier1_anchor',
      domain: 'transport',
      publicClaimStrength: 'strong_driver_allowed',
      allowsBusinessAudience: true,
      isWeakLocalBusinessPoi: false,
    };
  }
  if (m.categoryId === 'metro') {
    const cbd = isCbdTransitAnchorPoi(m);
    return {
      level: cbd ? 'tier1_anchor' : 'tier2_anchor',
      domain: 'transport',
      publicClaimStrength: cbd ? 'moderate_driver_allowed' : 'weak_context_only',
      allowsBusinessAudience: cbd,
      isWeakLocalBusinessPoi: false,
    };
  }

  // Medical anchors
  if (m.categoryId === 'hospital') {
    return {
      level: 'tier1_anchor',
      domain: 'medical',
      publicClaimStrength: 'strong_driver_allowed',
      allowsBusinessAudience: true,
      isWeakLocalBusinessPoi: false,
    };
  }

  // Education
  if (m.categoryId === 'university') {
    return {
      level: 'tier2_anchor',
      domain: 'education',
      publicClaimStrength: 'moderate_driver_allowed',
      allowsBusinessAudience: false,
      isWeakLocalBusinessPoi: false,
    };
  }

  // Tourist / leisure
  if (
    m.categoryId === 'attraction' ||
    m.categoryId === 'entertainment' ||
    m.categoryId === 'shopping_major' ||
    m.categoryId === 'stadium' ||
    m.categoryId === 'convention'
  ) {
    return {
      level: m.distance <= 1200 ? 'tier1_anchor' : 'tier2_anchor',
      domain: m.categoryId === 'convention' ? 'civic' : 'tourist',
      publicClaimStrength: m.distance <= 900 ? 'moderate_driver_allowed' : 'weak_context_only',
      allowsBusinessAudience: m.categoryId === 'convention',
      isWeakLocalBusinessPoi: false,
    };
  }

  // Business POIs — strict gating
  if (m.categoryId === 'business') {
    const weak = looksLikeWeakLocalBusinessPoi(m);
    const strong = isStrongBusinessAnchorPoi(m);
    if (strong) {
      return {
        level: 'tier1_anchor',
        domain: 'business',
        publicClaimStrength: 'strong_driver_allowed',
        allowsBusinessAudience: true,
        isWeakLocalBusinessPoi: false,
      };
    }
    if (weak) {
      return {
        level: 'weak_local_signal',
        domain: 'business',
        publicClaimStrength: 'hidden_from_public_copy',
        allowsBusinessAudience: false,
        isWeakLocalBusinessPoi: true,
      };
    }
    // Unknown scale business: keep conservative.
    return {
      level: 'tier2_anchor',
      domain: 'business',
      publicClaimStrength: 'weak_context_only',
      allowsBusinessAudience: false,
      isWeakLocalBusinessPoi: false,
    };
  }

  // Hotels
  if (m.categoryId === 'major_hotel') {
    return {
      level: m.distance <= 800 ? 'tier2_anchor' : 'weak_local_signal',
      domain: 'hospitality',
      publicClaimStrength: m.distance <= 600 ? 'moderate_driver_allowed' : 'weak_context_only',
      allowsBusinessAudience: false,
      isWeakLocalBusinessPoi: false,
    };
  }
  if (m.categoryId === 'mid_hotel') {
    return {
      level: 'weak_local_signal',
      domain: 'hospitality',
      publicClaimStrength: 'weak_context_only',
      allowsBusinessAudience: false,
      isWeakLocalBusinessPoi: false,
    };
  }

  // Civic/admin
  if (m.categoryId === 'civic') {
    return {
      level: 'weak_local_signal',
      domain: 'civic',
      publicClaimStrength: 'weak_context_only',
      allowsBusinessAudience: false,
      isWeakLocalBusinessPoi: false,
    };
  }

  // Everything else: treat as noise for public claims.
  return {
    level: 'noise',
    domain: 'residential_support',
    publicClaimStrength: 'hidden_from_public_copy',
    allowsBusinessAudience: false,
    isWeakLocalBusinessPoi: false,
  };
}

export function allowsBusinessAudienceFromMagnets(magnets: MagnetItem[]): boolean {
  return magnets.some(m => classifyMagnetSignal(m).allowsBusinessAudience);
}

export function hasCredibleBusinessAnchors(magnets: MagnetItem[]): boolean {
  return magnets.some(m => {
    const t = classifyMagnetSignal(m);
    return (
      (t.domain === 'business' && (t.level === 'tier1_anchor' || t.level === 'tier2_anchor') && t.publicClaimStrength !== 'hidden_from_public_copy') ||
      t.allowsBusinessAudience
    );
  });
}

