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

// ── Domain-specific weak/strong patterns ────────────────────────────────────

// Note: JS \b only recognises ASCII word chars, so Cyrillic word boundaries are
// emulated with `(?:^|\s)` / `(?:$|\s|\W)` lookarounds where needed.
const WEAK_TOURIST_NAME_RE =
  /завод|фабрика|комбинат|промышленн|(?:^|\s)оао(?:$|\s|\W)|(?:^|\s)ао(?:$|\s|\W)|(?:^|\s)ооо(?:$|\s|\W)|предприяти|музей\s+истории\s+(?:предприятия|завода|фабрики|комбината|техники)|корпоративный\s+музей/i;

const STRONG_MEDICAL_NAME_RE =
  /больниц|госпитал|медицинский\s+центр|клиническая\s+больниц|перинатальн|онкологическ|кардиологическ|(?:^|\s)нии(?:$|\s|\W)|научный\s+центр|многопрофильн/i;

const WEAK_MEDICAL_NAME_RE =
  /стоматолог|клиника\s+красоты|косметолог|аптек|лаборатор|медицинский\s+кабинет|зубной|санэпидем|ветеринарн/i;

const STRONG_EDUCATION_NAME_RE =
  /университет|институт|академия|кампус|university|campus|политех|(?:^|\s)нгу(?:$|\s|\W)|(?:^|\s)мгу(?:$|\s|\W)|(?:^|\s)спбгу(?:$|\s|\W)|\bhse\b|вшэ/i;

const WEAK_EDUCATION_NAME_RE =
  /детский\s+сад|садик|(?:^|\s)школа(?:$|\s|№|\W)|курсы|тренинг|репетитор/i;

const WEAK_HOSPITALITY_NAME_RE =
  /хостел|гостевой\s+дом|апарт-отель|hostel|guest\s+house/i;

const STRONG_RETAIL_NAME_RE =
  /(?:^|\s)мега(?:$|\s|\W)|(?:^|\s)молл(?:$|\s|\W)|торгово-развлекательн|\btrc\b|\btrk\b|\bmoll\b|галере/i;

const WEAK_RETAIL_NAME_RE =
  /магазин\s+у\s+дома|минимаркет|павильон|ларёк|ларек|local\s+shop|продукты/i;

// Civic POIs (ZAGS, local administration, MFC, post office, archive) are all
// classified as weak by category alone — no name regex is needed at the
// single-POI level. Pattern reference (kept as a documented constant string
// for the contract; not used at runtime since `categoryId === 'civic'` already
// short-circuits to weak):
const _WEAK_CIVIC_NAME_PATTERN_DOC =
  '(?:^|\\s)загс(?:$|\\s|\\W)|администрация|муниципальн|(?:^|\\s)мфц(?:$|\\s|\\W)|почта\\s+россии|нотариус|архив';
void _WEAK_CIVIC_NAME_PATTERN_DOC;

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

// ── Domain-specific weak/credible classifiers ───────────────────────────────

/**
 * Corporate / industrial / factory museums and similar enterprise-history
 * "attractions" must never become strong tourist drivers, even at close range.
 */
export function looksLikeWeakLocalAttractionPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'attraction') return false;
  return WEAK_TOURIST_NAME_RE.test(nameStr(m.name));
}

export function looksLikeWeakLocalMedicalPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'hospital') return false;
  const n = nameStr(m.name);
  if (!n) return false;
  if (STRONG_MEDICAL_NAME_RE.test(n)) return false;
  return WEAK_MEDICAL_NAME_RE.test(n);
}

export function looksLikeWeakLocalEducationPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'university') return false;
  const n = nameStr(m.name);
  if (!n) return false;
  if (STRONG_EDUCATION_NAME_RE.test(n)) return false;
  return WEAK_EDUCATION_NAME_RE.test(n);
}

export function looksLikeWeakLocalHospitalityPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'major_hotel' && m.categoryId !== 'mid_hotel') return false;
  if (m.categoryId === 'mid_hotel') return true;
  return WEAK_HOSPITALITY_NAME_RE.test(nameStr(m.name));
}

export function looksLikeWeakLocalRetailPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'shopping_major') return false;
  const n = nameStr(m.name);
  if (!n) return true;
  if (STRONG_RETAIL_NAME_RE.test(n)) return false;
  return WEAK_RETAIL_NAME_RE.test(n);
}

export function looksLikeWeakLocalCivicPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'civic') return false;
  return true; // every civic POI is weak by default; strong civic clusters live at array level.
}

/**
 * Strict signal taxonomy contract.
 *
 * Goal: weak/local POIs must never become strong public demand drivers,
 * and must never unlock BUSINESS audience on their own. The same rule applies
 * across every domain (tourist, medical, education, hospitality, retail, civic):
 * raw category is never enough — credible anchor patterns are required.
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

  // Strategic hubs beyond ordinary magnet radii — never framed as pedestrian anchors.
  if (m.categoryId === 'strategicTransportHub') {
    const band = m.strategicReachBand ?? 'secondary';
    return {
      level: 'tier2_anchor',
      domain: 'transport',
      publicClaimStrength: band === 'strategic' ? 'weak_context_only' : 'moderate_driver_allowed',
      allowsBusinessAudience: band !== 'strategic',
      isWeakLocalBusinessPoi: false,
    };
  }

  // Transport anchors (pedestrian-relevant fetch radii only — airports beyond ~2 km remap to strategicTransportHub)
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
  if (m.categoryId === 'bus_stop' || m.categoryId === 'tram_stop') {
    return {
      level: 'weak_local_signal',
      domain: 'transport',
      publicClaimStrength: 'weak_context_only',
      allowsBusinessAudience: false,
      isWeakLocalBusinessPoi: false,
    };
  }

  // Large / specialized healthcare beyond ordinary hospital radius
  if (m.categoryId === 'specializedMedicalAnchor') {
    const band = m.specializedMedicalReachBand ?? 'secondary';
    return {
      level: 'tier2_anchor',
      domain: 'medical',
      publicClaimStrength: band === 'primary' ? 'moderate_driver_allowed' : 'weak_context_only',
      allowsBusinessAudience: false,
      isWeakLocalBusinessPoi: false,
    };
  }

  // Medical anchors — split strong hospitals vs small clinics/dentistries/pharmacies.
  if (m.categoryId === 'hospital') {
    if (looksLikeWeakLocalMedicalPoi(m)) {
      return {
        level: 'weak_local_signal',
        domain: 'medical',
        publicClaimStrength: 'weak_context_only',
        allowsBusinessAudience: false,
        isWeakLocalBusinessPoi: false,
      };
    }
    return {
      level: 'tier1_anchor',
      domain: 'medical',
      publicClaimStrength: 'strong_driver_allowed',
      allowsBusinessAudience: true,
      isWeakLocalBusinessPoi: false,
    };
  }

  // Education — universities and institutes; weak when name signals school/kindergarten.
  if (m.categoryId === 'university') {
    if (looksLikeWeakLocalEducationPoi(m)) {
      return {
        level: 'weak_local_signal',
        domain: 'education',
        publicClaimStrength: 'weak_context_only',
        allowsBusinessAudience: false,
        isWeakLocalBusinessPoi: false,
      };
    }
    return {
      level: 'tier2_anchor',
      domain: 'education',
      publicClaimStrength: 'moderate_driver_allowed',
      allowsBusinessAudience: false,
      isWeakLocalBusinessPoi: false,
    };
  }

  // Tourist / leisure / convention / stadium / shopping_major
  if (
    m.categoryId === 'attraction' ||
    m.categoryId === 'entertainment' ||
    m.categoryId === 'shopping_major' ||
    m.categoryId === 'stadium' ||
    m.categoryId === 'convention'
  ) {
    // Corporate / industrial / factory / enterprise museum — not a credible tourist anchor.
    if (looksLikeWeakLocalAttractionPoi(m)) {
      return {
        level: 'weak_local_signal',
        domain: 'tourist',
        publicClaimStrength: 'weak_context_only',
        allowsBusinessAudience: false,
        isWeakLocalBusinessPoi: false,
      };
    }
    // Mini-market / local shop tagged as "shopping_major" — weak retail signal.
    if (m.categoryId === 'shopping_major' && looksLikeWeakLocalRetailPoi(m)) {
      return {
        level: 'weak_local_signal',
        domain: 'retail',
        publicClaimStrength: 'weak_context_only',
        allowsBusinessAudience: false,
        isWeakLocalBusinessPoi: false,
      };
    }
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

  // Hotels / hospitality — single isolated hotel is never a strong driver alone.
  if (m.categoryId === 'major_hotel') {
    const isHostelLike = WEAK_HOSPITALITY_NAME_RE.test(nameStr(m.name));
    if (isHostelLike) {
      return {
        level: 'weak_local_signal',
        domain: 'hospitality',
        publicClaimStrength: 'weak_context_only',
        allowsBusinessAudience: false,
        isWeakLocalBusinessPoi: false,
      };
    }
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

  // Civic/admin — ZAGS, local administration, MFC, post office, archive: never primary.
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

// ── Single-POI credibility predicates (per domain) ──────────────────────────

function isCredible(m: MagnetItem, domain: SignalDomain): boolean {
  const t = classifyMagnetSignal(m);
  if (t.domain !== domain) return false;
  return t.level === 'tier1_anchor' || t.level === 'tier2_anchor';
}

export function isCredibleBusinessAnchor(m: MagnetItem): boolean {
  const t = classifyMagnetSignal(m);
  if (t.domain === 'business') {
    return t.level === 'tier1_anchor' || t.level === 'tier2_anchor';
  }
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
  // Strong retail (mall/TRC) is classified under tourist domain by category routing
  // unless the weak retail branch reclassifies it. A strong mall is therefore a
  // credible tourist anchor; we expose isCredibleRetailAnchor for symmetry but it
  // never returns true at the single-POI level for "shopping_major" mini-markets.
  const t = classifyMagnetSignal(m);
  if (t.domain === 'retail') return false; // weak retail
  if (m.categoryId !== 'shopping_major') return false;
  return t.level === 'tier1_anchor' || t.level === 'tier2_anchor';
}

/**
 * Civic POIs (ZAGS / local admin / MFC / archive) are never credible primary
 * anchors at the single-POI level. A real civic cluster is decided at the
 * audience layer, never by one object.
 */
export function isCredibleCivicAnchor(_m: MagnetItem): boolean {
  return false;
}

// ── Array-level audience eligibility gates ──────────────────────────────────

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

export function hasCredibleTouristAnchors(magnets: MagnetItem[]): boolean {
  return magnets.some(isCredibleTouristAnchor);
}

export function hasCredibleMedicalAnchors(magnets: MagnetItem[]): boolean {
  return magnets.some(isCredibleMedicalAnchor);
}

export function hasCredibleEducationAnchors(magnets: MagnetItem[]): boolean {
  return magnets.some(isCredibleEducationAnchor);
}

/**
 * Hospitality "cluster" requires ≥ 2 credible hospitality anchors — a single
 * small/mid hotel or hostel is never enough on its own.
 */
export function hasCredibleHospitalityCluster(magnets: MagnetItem[]): boolean {
  const credible = magnets.filter(isCredibleHospitalityAnchor);
  return credible.length >= 2;
}

// ── Anchor recall / mandatory surfacing contract ────────────────────────────

/**
 * Per-category must-surface radius (meters). When a credible anchor of the
 * category is closer than this, the public explanation is required to mention
 * it — weaker POIs cannot displace it from the primary driver / drivers line.
 *
 * Radii reflect realistic guest-facing relevance: airports stay relevant much
 * further than business centers, transport hubs further than hotels, etc.
 */
const MUST_SURFACE_RADIUS_M: Readonly<Record<string, number>> = {
  airport:         2000,
  railway_station: 1500,
  metro:           1200,
  hospital:        1500,
  university:      1500,
  attraction:      1200,
  convention:      1500,
  business:         800,
  shopping_major:  1500,
  major_hotel:      800,
  stadium:         1500,
  strategicTransportHub: 8000,
};

/**
 * True when this magnet is a credible domain anchor (per-domain validity)
 * AND it sits within its must-surface radius. The public explanation MUST
 * mention every such magnet — they cannot be hidden, displaced, or replaced
 * by weak/local POIs (banks, person-name offices, corporate museums, small
 * clinics, schools, mini-markets, civic offices).
 */
export function isMustSurfaceAnchor(m: MagnetItem): boolean {
  const radius = MUST_SURFACE_RADIUS_M[m.categoryId];
  if (radius == null) return false;
  if (!Number.isFinite(m.distance) || m.distance > radius) return false;

  const t = classifyMagnetSignal(m);
  // Only credible anchors surface. Weak/hidden signals never qualify.
  if (t.level !== 'tier1_anchor' && t.level !== 'tier2_anchor') return false;
  if (t.publicClaimStrength === 'hidden_from_public_copy') return false;

  // Metro: only the CBD-context tier1 variant is must-surface; ordinary metro
  // is universal context, not a domain anchor by itself.
  if (m.categoryId === 'metro' && !isCbdTransitAnchorPoi(m)) return false;

  // shopping_major: only the strong retail variant (mall / TRC) — weak retail
  // (mini-markets) is already filtered out by the credibility check above
  // (domain becomes 'retail' / weak_local_signal), but be defensive.
  if (m.categoryId === 'shopping_major' && t.domain === 'retail') return false;

  return true;
}

/**
 * All credible anchors grouped by domain — used to decide which anchors
 * deserve mention even when audience-scoring picks a different primary
 * audience.
 */
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

/**
 * The list of magnets the public explanation MUST surface — sorted nearest
 * first, then by category priority. A driver picker that ignores this list
 * is in violation of the recall contract.
 */
export function getMustSurfaceAnchors(magnets: MagnetItem[]): MagnetItem[] {
  const surfacing = magnets.filter(isMustSurfaceAnchor);
  // Stable, deterministic order: nearest first, then preserve input order.
  return [...surfacing].sort((a, b) => a.distance - b.distance);
}
