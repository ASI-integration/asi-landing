import type { MagnetItem } from '../types';
import { GENERATED_MAGNET_REGISTRY, type CanonicalMagnetType } from './generated-magnet-registry';

export type AnchorStrength = 'tier1' | 'tier2' | 'weak' | 'noise' | 'negative';
export type CanonicalMagnetRole = 'primary' | 'secondary' | 'tertiary';

export type DistanceBandId =
  | 'on_site'
  | 'walk_0_600'
  | 'walk_600_1000'
  | 'soft_1000_1500'
  | 'drive_1500_3000'
  | 'far_3000_plus';

export type PublicClaimStrength =
  | 'strong_driver_allowed'
  | 'moderate_driver_allowed'
  | 'weak_context_only'
  | 'hidden_from_public_copy';

export type CanonicalMagnetDecision = {
  /** Canonical magnet family/type id (stable public contract). */
  family: CanonicalMagnetType;
  role: CanonicalMagnetRole;
  anchorStrength: AnchorStrength;
  /**
   * Upper bound for “headline / tier” uses in residential logic.
   * Intentionally separate from `anchorStrength` so e.g. museums can be meaningful
   * context but capped below Tier‑1 by default.
   */
  maxResidentialTier: 1 | 2 | 3;
  distanceBand: DistanceBandId;
  audiences: Readonly<{
    business: boolean;
    corporate: boolean;
    tourist: boolean;
    family: boolean;
    medical: boolean;
    student: boolean;
    industrialWorker: boolean;
  }>;
  scoreCaps: Readonly<{ audienceFitMax: number; tier1CreditMax: number }>;
  public: Readonly<{
    labelRu: string;
    labelEn: string;
    claimStrength: PublicClaimStrength;
  }>;
  antiSignals: ReadonlyArray<string>;
};

function n(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function distanceBandId(distanceM: number): DistanceBandId {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 'far_3000_plus';
  if (distanceM <= 80) return 'on_site';
  if (distanceM <= 600) return 'walk_0_600';
  if (distanceM <= 1000) return 'walk_600_1000';
  if (distanceM <= 1500) return 'soft_1000_1500';
  if (distanceM <= 3000) return 'drive_1500_3000';
  return 'far_3000_plus';
}

const CBD_CONTEXT_NAME_RE =
  /москва[-\s]?сити|moscow\s+city|деловой\s+центр|central\s+business\s+district|\bcbd\b/i;

const STRONG_BUSINESS_ANCHOR_NAME_RE =
  /бизнес-центр|business\s+center|\bбц\b|office\s+complex|деловой\s+центр|москва[-\s]?сити|moscow\s+city|technopark|технопарк|industrial\s+park|штаб-квартира|headquarters/i;

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

const STRONG_RETAIL_NAME_RE =
  /(?:^|\s)мега(?:$|\s|\W)|(?:^|\s)молл(?:$|\s|\W)|торгово-развлекательн|\btrc\b|\btrk\b|\bmoll\b|галере/i;

const WEAK_RETAIL_NAME_RE =
  /магазин\s+у\s+дома|минимаркет|павильон|ларёк|ларек|local\s+shop|продукты/i;

const WEAK_HOSPITALITY_NAME_RE =
  /хостел|гостевой\s+дом|апарт-отель|hostel|guest\s+house/i;

const WEAK_BUSINESS_SUBTYPES = new Set(['bank', 'insurance', 'commercial', 'office_anon', 'travel_agency']);

const WEAK_BUSINESS_NAME_RE =
  /банк|bank|страх|insurance|ингосстрах|росгосстрах|ренессанс|сбер|втб|альфа|тинькоф|тиньк|райффайзен|открытие|офис\b|office\b|страхован|нотариус|адвокат|юрист|юридич|бухгалтер|аудит|local\s+office/i;

const PERSON_NAME_OFFICE_RE =
  /(?:^|\s)[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.?\s*[А-ЯЁ]\.?(?=$|\s|[,.])|(?:^|\s)[A-Z][a-z]+\s+[A-Z]\.?\s*[A-Z]\.?(?=$|\s|[,.])/;

export function isPersonNameOfficePoi(name: string | undefined): boolean {
  const raw = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  return PERSON_NAME_OFFICE_RE.test(` ${raw} `);
}

export function mustSurfaceRadiusMForFamily(family: CanonicalMagnetType): number | null {
  const r = GENERATED_MAGNET_REGISTRY[family].distanceBands.mustSurfaceRadiusM;
  if (!Number.isFinite(r) || r <= 0) return null;
  return r;
}

function isCbdContextName(name: string | undefined): boolean {
  return CBD_CONTEXT_NAME_RE.test(n(name));
}

function looksLikeWeakLocalBusinessPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'business') return false;
  const st = m.subType?.toLowerCase().trim();
  if (st && WEAK_BUSINESS_SUBTYPES.has(st)) return true;
  if (st === 'office') {
    return !STRONG_BUSINESS_ANCHOR_NAME_RE.test(n(m.name));
  }
  const name = n(m.name);
  if (!name) return false;
  if (WEAK_BUSINESS_NAME_RE.test(name)) return true;
  if (isPersonNameOfficePoi(m.name)) return true;
  return false;
}

function looksLikeWeakLocalAttractionPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'attraction') return false;
  return WEAK_TOURIST_NAME_RE.test(n(m.name));
}

function looksLikeWeakLocalMedicalPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'hospital') return false;
  const name = n(m.name);
  if (!name) return false;
  if (STRONG_MEDICAL_NAME_RE.test(name)) return false;
  return WEAK_MEDICAL_NAME_RE.test(name);
}

function looksLikeWeakLocalEducationPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'university') return false;
  const name = n(m.name);
  if (!name) return false;
  if (STRONG_EDUCATION_NAME_RE.test(name)) return false;
  return WEAK_EDUCATION_NAME_RE.test(name);
}

function looksLikeWeakLocalRetailPoi(m: MagnetItem): boolean {
  if (m.categoryId !== 'shopping_major') return false;
  const name = n(m.name);
  if (!name) return true;
  if (STRONG_RETAIL_NAME_RE.test(name)) return false;
  return WEAK_RETAIL_NAME_RE.test(name);
}

function inferCanonicalTypeFromMagnet(m: MagnetItem): CanonicalMagnetType {
  if (m.canonicalType) return m.canonicalType;
  const name = n(m.name);

  // Transport
  if (m.categoryId === 'airport') return 'airport';
  if (m.categoryId === 'railway_station') return 'railway_station';
  if (m.categoryId === 'metro') return 'metro_station';

  // Medical / education
  if (m.categoryId === 'hospital') return 'hospital';
  if (m.categoryId === 'university') return 'university';

  // Hospitality
  if (m.categoryId === 'major_hotel' || m.categoryId === 'mid_hotel') return 'hotel_cluster';

  // Business / industrial
  if (m.categoryId === 'business') {
    if (m.subType === 'factory') return 'industrial_anchor';
    if (m.subType === 'industrial') return 'industrial_zone';
    if (/(?:^|\s)бизнес-центр|business\s+center|\bбц\b|moscow\s+city|москва[-\s]?сити/i.test(name)) {
      return 'business_center';
    }
    return 'office_cluster';
  }

  // Retail / events / leisure
  if (m.categoryId === 'shopping_major') return 'shopping_mall';
  if (m.categoryId === 'stadium') return 'stadium';
  if (m.categoryId === 'convention') return 'event_venue';

  // Attractions (split conservatively by name; this must NOT auto-promote to tier1)
  if (m.categoryId === 'attraction') {
    if (/парк|park/i.test(name)) return 'park';
    if (/пляж|beach/i.test(name)) return 'beach';
    if (/набереж|waterfront/i.test(name)) return 'waterfront';
    if (/курорт|resort|ski|горнолыж/i.test(name)) return 'resort_area';
    if (/музей|museum/i.test(name)) return 'museum';
    if (/театр|theatre|theater/i.test(name)) return 'theater';
    // Landmarks that aren’t explicitly museum/theater should still stay capped
    // (contextual promotion only).
    return 'tourist_attraction';
  }
  if (m.categoryId === 'entertainment') {
    if (/театр|theatre|theater/i.test(name)) return 'theater';
    return 'event_venue';
  }

  // Default: do not surface as a prime magnet
  return 'weak_amenity';
}

function claimStrengthForDecision(args: { anchorStrength: AnchorStrength; canonicalType: CanonicalMagnetType }): PublicClaimStrength {
  const { anchorStrength, canonicalType } = args;
  if (anchorStrength === 'negative' || anchorStrength === 'noise') return 'hidden_from_public_copy';
  if (anchorStrength === 'weak') return 'weak_context_only';
  if (anchorStrength === 'tier2') {
    if (canonicalType === 'metro_station') return 'weak_context_only';
    return 'moderate_driver_allowed';
  }
  if (canonicalType === 'metro_station') return 'moderate_driver_allowed';
  return 'strong_driver_allowed';
}

/**
 * Canonical classifier: executable logic, parameterized by generated registry constraints.
 *
 * Contract:
 * - museums/theaters/generic tourist attractions MUST NOT become Tier-1 by raw name/category.
 * - weak/tertiary amenities MUST NOT become prime magnets.
 */
export function classifyCanonicalMagnet(input: { magnet: MagnetItem }): CanonicalMagnetDecision {
  const m = input.magnet;
  const canonicalType = inferCanonicalTypeFromMagnet(m);
  const reg = GENERATED_MAGNET_REGISTRY[canonicalType];

  const band = distanceBandId(m.distance);
  const antiSignals: string[] = [];

  let anchorStrength: AnchorStrength = reg.anchorStrength;
  let maxTier: 1 | 2 | 3 = reg.maxTier;
  let audiences = { ...reg.audienceEligibility };

  const name = n(m.name);

  // Name anti-signals from canon (regex patterns live in JSON; executed here).
  for (const s of reg.antiSignals) {
    if (s.kind === 'name_regex') {
      const re = new RegExp(s.pattern, 'i');
      if (re.test(name)) {
        antiSignals.push(`antiSignal:${s.id}`);
        if (s.effect === 'force_weak_context') {
          anchorStrength = 'weak';
          maxTier = 3;
        }
      }
    }
  }

  // Cross-family weak/local downgrades (kept executable, but must respect canon caps).
  if (looksLikeWeakLocalAttractionPoi(m) && (canonicalType === 'museum' || canonicalType === 'tourist_attraction' || canonicalType === 'cultural_landmark')) {
    antiSignals.push('antiSignal:weak_local_attraction');
    anchorStrength = 'weak';
    maxTier = 3;
  }
  if (looksLikeWeakLocalMedicalPoi(m) && canonicalType === 'hospital') {
    antiSignals.push('antiSignal:weak_local_medical');
    anchorStrength = 'weak';
    maxTier = 3;
    audiences.medical = false;
    audiences.business = false;
    audiences.corporate = false;
  }
  if (looksLikeWeakLocalEducationPoi(m) && canonicalType === 'university') {
    antiSignals.push('antiSignal:weak_local_education');
    anchorStrength = 'weak';
    maxTier = 3;
    audiences.student = false;
  }
  if (looksLikeWeakLocalRetailPoi(m) && canonicalType === 'shopping_mall') {
    antiSignals.push('antiSignal:weak_local_retail');
    anchorStrength = 'weak';
    maxTier = 3;
    audiences.tourist = false;
    audiences.family = false;
  }
  if (looksLikeWeakLocalBusinessPoi(m) && (canonicalType === 'business_center' || canonicalType === 'office_cluster' || canonicalType === 'industrial_anchor' || canonicalType === 'industrial_zone')) {
    antiSignals.push('antiSignal:weak_local_business');
    anchorStrength = 'weak';
    maxTier = 3;
    audiences.business = false;
    audiences.corporate = false;
  }

  // Hospitality: hostel/guest-house patterns are weak local context.
  if (canonicalType === 'hotel_cluster') {
    const isWeak = WEAK_HOSPITALITY_NAME_RE.test(name);
    if (m.categoryId === 'mid_hotel' || isWeak) {
      antiSignals.push('antiSignal:weak_local_hospitality');
      anchorStrength = 'weak';
      maxTier = 3;
    } else if (m.categoryId === 'major_hotel') {
      anchorStrength = anchorStrength === 'weak' ? 'weak' : 'tier2';
      maxTier = (maxTier < 2 ? 2 : maxTier) as any;
    }
  }

  // Context unlock: metro becomes tier1 only in explicit CBD context.
  if (canonicalType === 'metro_station' && isCbdContextName(m.name)) {
    anchorStrength = 'tier1';
    maxTier = 1;
    audiences.business = true;
    audiences.corporate = true;
  }

  // Tourist contextual promotion:
  // Hard cap: museums/theaters/generic tourist attractions must not become tier1
  // unless explicit non-raw context exists. We treat this as "strong attractionScore + proximity".
  // (This preserves existing behavior while still forbidding raw shortcuts.)
  const isTouristFamily =
    canonicalType === 'museum' ||
    canonicalType === 'theater' ||
    canonicalType === 'tourist_attraction' ||
    canonicalType === 'cultural_landmark' ||
    canonicalType === 'park' ||
    canonicalType === 'beach' ||
    canonicalType === 'waterfront' ||
    canonicalType === 'resort_area';

  if (
    isTouristFamily &&
    anchorStrength !== 'weak' &&
    Number.isFinite(m.attractionScore) &&
    (
      (m.strengthClass === 'strong' && m.attractionScore >= 4.2 && m.distance <= 1200) ||
      (m.attractionScore >= 4.4 && m.distance <= 800)
    )
  ) {
    // Contextual promotion only (attractionScore + proximity). This is the ONLY path
    // that allows capped families (museum/theater/tourist_attraction) to become Tier‑1.
    anchorStrength = 'tier1';
    maxTier = 1;
  }

  // Strong office anchors: may become tier1 with explicit strong patterns + proximity.
  if (
    (canonicalType === 'office_cluster' || canonicalType === 'business_center') &&
    anchorStrength !== 'weak' &&
    STRONG_BUSINESS_ANCHOR_NAME_RE.test(name) &&
    m.distance <= 1000
  ) {
    anchorStrength = 'tier1';
    maxTier = 1;
  }

  // Distance-based softening for tier2 families.
  if (anchorStrength === 'tier2' && m.distance > reg.distanceBands.softenTier2AfterM) {
    antiSignals.push('antiSignal:too_far_for_tier2');
    anchorStrength = 'weak';
    maxTier = 3;
  }

  // Canon hard rules: weak/tertiary amenities cannot be prime magnets.
  if (canonicalType === 'weak_amenity' || canonicalType === 'tertiary_local_amenity') {
    anchorStrength = 'weak';
    maxTier = 3;
  }

  // Canon hard cap: museum/theater/tourist_attraction must not yield Tier-1 credit.
  const tier1CreditMax = reg.scoringCaps.tier1CreditMax;

  const claimStrength = (() => {
    if (m.categoryId === 'business' && looksLikeWeakLocalBusinessPoi(m)) return 'hidden_from_public_copy' as const;
    return claimStrengthForDecision({ anchorStrength, canonicalType });
  })();

  return {
    family: canonicalType,
    role: reg.role,
    anchorStrength,
    maxResidentialTier: maxTier,
    distanceBand: band,
    audiences,
    scoreCaps: {
      audienceFitMax: reg.scoringCaps.audienceFitMax,
      tier1CreditMax,
    },
    public: {
      labelRu: reg.publicLabel.ru,
      labelEn: reg.publicLabel.en,
      claimStrength,
    },
    antiSignals,
  };
}

