import type { MagnetItem } from '../types';

export type CanonicalMagnetFamily =
  | 'railway_station'
  | 'metro_station'
  | 'transport_hub'
  | 'airport'
  | 'port'
  | 'industrial_anchor'
  | 'industrial_zone'
  | 'business_center'
  | 'office_cluster'
  | 'hospital'
  | 'medical_cluster'
  | 'university'
  | 'shopping_mall'
  | 'park'
  | 'beach_waterfront'
  | 'resort_area'
  | 'stadium_event_venue'
  | 'cultural_landmark'
  | 'museum'
  | 'theater'
  | 'tourist_attraction'
  | 'hotel_cluster'
  | 'residential_density'
  | 'weak_amenity';

export type AnchorStrength = 'tier1' | 'tier2' | 'weak' | 'noise' | 'negative';

export type AudienceKey =
  | 'business'
  | 'corporate'
  | 'tourist'
  | 'family'
  | 'medical'
  | 'student'
  | 'industrial_worker';

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

export type CanonicalMagnetRole = 'primary' | 'secondary' | 'tertiary';

export type CanonicalMagnetDecision = {
  family: CanonicalMagnetFamily;
  role: CanonicalMagnetRole;
  anchorStrength: AnchorStrength;
  /**
   * Upper bound for “headline / tier” uses in residential logic.
   * This is intentionally separate from `anchorStrength` so that
   * e.g. “museum” can be a meaningful context but capped below Tier‑1.
   */
  maxResidentialTier: 1 | 2 | 3;
  distanceBand: DistanceBandId;
  audiences: Readonly<Record<AudienceKey, boolean>>;
  scoreCaps: Readonly<{
    /** Maximum contribution to audience-fit in a single domain. */
    audienceFitMax?: number;
    /** Maximum contribution to “prime magnet / tier‑1 count” decisions. */
    tier1CreditMax?: number;
  }>;
  public: Readonly<{
    labelRu: string;
    labelEn: string;
    claimStrength: PublicClaimStrength;
  }>;
  antiSignals: ReadonlyArray<string>;
};

export type CanonicalMagnetClassifierInput = {
  magnet: MagnetItem;
  /**
   * Optional raw hints (future-proofing): when upstream mapping starts providing
   * “raw taxonomy” signals, they should flow here rather than enabling ad-hoc bypasses.
   */
  raw?: {
    osmTags?: Record<string, string>;
    rawCategoryHints?: string[];
  };
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

/**
 * Canonical executable registry.
 *
 * IMPORTANT GUARANTEE:
 * Museums, theaters, and generic tourist attractions MUST NOT become Tier‑1
 * residential anchors by raw name/category alone. The registry enforces this
 * via conservative `maxResidentialTier` and anti-signal downgrades.
 */
export const CANONICAL_MAGNET_REGISTRY: Readonly<Record<CanonicalMagnetFamily, Readonly<{
  aliases: ReadonlyArray<string>;
  rawCategoryIds: ReadonlyArray<string>;
  rawSubTypes?: ReadonlyArray<string>;
  role: CanonicalMagnetRole;
  defaultAnchorStrength: AnchorStrength;
  maxResidentialTier: 1 | 2 | 3;
  audiences: Readonly<Record<AudienceKey, boolean>>;
  public: Readonly<{ labelRu: string; labelEn: string }>;
  mustSurfaceRadiusM?: number;
  antiSignalNameRe?: RegExp;
  /** When true, a match requires additional context beyond raw category/subType. */
  requiresContext?: boolean;
}>>> = {
  railway_station: {
    aliases: ['rail', 'station', ' вокзал', 'автовокзал'],
    rawCategoryIds: ['railway_station'],
    role: 'primary',
    defaultAnchorStrength: 'tier1',
    maxResidentialTier: 1,
    audiences: { business: true, corporate: true, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Ж/д вокзал / транспортный узел', labelEn: 'Railway station / transit hub' },
    mustSurfaceRadiusM: 1500,
  },
  metro_station: {
    aliases: ['metro', 'метро'],
    rawCategoryIds: ['metro'],
    role: 'secondary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: false, corporate: false, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Метро', labelEn: 'Metro' },
    mustSurfaceRadiusM: 1200,
    requiresContext: true, // CBD/hub context is needed for business unlock.
  },
  transport_hub: {
    aliases: ['transport hub'],
    rawCategoryIds: ['railway_station', 'metro'],
    role: 'primary',
    defaultAnchorStrength: 'tier1',
    maxResidentialTier: 1,
    audiences: { business: true, corporate: true, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Крупный транспортный узел', labelEn: 'Major transport hub' },
    mustSurfaceRadiusM: 1500,
    requiresContext: true,
  },
  airport: {
    aliases: ['airport', 'аэропорт'],
    rawCategoryIds: ['airport'],
    role: 'primary',
    defaultAnchorStrength: 'tier1',
    maxResidentialTier: 1,
    audiences: { business: true, corporate: true, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Аэропорт', labelEn: 'Airport' },
    mustSurfaceRadiusM: 8000,
  },
  port: {
    aliases: ['port', 'порт', 'terminal'],
    rawCategoryIds: [],
    role: 'secondary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: true, corporate: true, tourist: true, family: false, medical: false, student: false, industrial_worker: true },
    public: { labelRu: 'Порт / терминал', labelEn: 'Port / terminal' },
    requiresContext: true,
  },
  industrial_anchor: {
    aliases: ['factory', 'works', 'завод', 'фабрика'],
    rawCategoryIds: ['business'],
    rawSubTypes: ['factory'],
    role: 'secondary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: true, corporate: true, tourist: false, family: false, medical: false, student: false, industrial_worker: true },
    public: { labelRu: 'Крупный промышленный объект', labelEn: 'Industrial anchor' },
    mustSurfaceRadiusM: 900,
    requiresContext: true, // needs credibility checks (avoid “museum of factory” etc).
  },
  industrial_zone: {
    aliases: ['industrial', 'промзона'],
    rawCategoryIds: ['business'],
    rawSubTypes: ['industrial'],
    role: 'tertiary',
    defaultAnchorStrength: 'weak',
    maxResidentialTier: 3,
    audiences: { business: false, corporate: true, tourist: false, family: false, medical: false, student: false, industrial_worker: true },
    public: { labelRu: 'Промышленная зона', labelEn: 'Industrial zone' },
    requiresContext: true,
  },
  business_center: {
    aliases: ['business center', 'бизнес-центр', 'бц', 'moscow city', 'москва-сити'],
    rawCategoryIds: ['business'],
    rawSubTypes: ['office'],
    role: 'primary',
    defaultAnchorStrength: 'tier1',
    maxResidentialTier: 1,
    audiences: { business: true, corporate: true, tourist: false, family: false, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Деловой центр', labelEn: 'Business center' },
    mustSurfaceRadiusM: 800,
    requiresContext: true, // must be validated via name patterns + taxonomy gate
  },
  office_cluster: {
    aliases: ['office cluster', 'деловой центр', 'office complex', 'technopark', 'технопарк'],
    rawCategoryIds: ['business'],
    rawSubTypes: ['office'],
    role: 'secondary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: true, corporate: true, tourist: false, family: false, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Офисный кластер', labelEn: 'Office cluster' },
    mustSurfaceRadiusM: 900,
    requiresContext: true,
  },
  hospital: {
    aliases: ['hospital', 'больниц', 'госпитал'],
    rawCategoryIds: ['hospital'],
    role: 'primary',
    defaultAnchorStrength: 'tier1',
    maxResidentialTier: 1,
    audiences: { business: true, corporate: true, tourist: false, family: true, medical: true, student: false, industrial_worker: false },
    public: { labelRu: 'Больница / медцентр', labelEn: 'Hospital / medical center' },
    mustSurfaceRadiusM: 1500,
    requiresContext: true, // small clinics/dentistry must downgrade
  },
  medical_cluster: {
    aliases: ['medical cluster', 'медкластер'],
    rawCategoryIds: ['hospital'],
    role: 'primary',
    defaultAnchorStrength: 'tier1',
    maxResidentialTier: 1,
    audiences: { business: true, corporate: true, tourist: false, family: true, medical: true, student: false, industrial_worker: false },
    public: { labelRu: 'Медицинский кластер', labelEn: 'Medical cluster' },
    mustSurfaceRadiusM: 1500,
    requiresContext: true,
  },
  university: {
    aliases: ['university', 'университет', 'институт', 'академия', 'campus', 'кампус'],
    rawCategoryIds: ['university'],
    role: 'secondary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: false, corporate: false, tourist: false, family: true, medical: false, student: true, industrial_worker: false },
    public: { labelRu: 'Университет / кампус', labelEn: 'University / campus' },
    mustSurfaceRadiusM: 1500,
    requiresContext: true, // school/kindergarten must downgrade
  },
  shopping_mall: {
    aliases: ['mall', 'молл', 'трц', 'торгово-развлекательн'],
    rawCategoryIds: ['shopping_major'],
    role: 'tertiary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: false, corporate: false, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Крупный торговый центр', labelEn: 'Shopping mall' },
    mustSurfaceRadiusM: 1500,
    requiresContext: true, // mini-market must downgrade
  },
  park: {
    aliases: ['park', 'парк'],
    rawCategoryIds: [],
    role: 'tertiary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: false, corporate: false, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Парк', labelEn: 'Park' },
    requiresContext: true,
  },
  beach_waterfront: {
    aliases: ['beach', 'пляж', 'waterfront', 'набережн'],
    rawCategoryIds: [],
    role: 'secondary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: false, corporate: false, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Набережная / пляж', labelEn: 'Waterfront / beach' },
    requiresContext: true,
  },
  resort_area: {
    aliases: ['resort', 'курорт', 'ski', 'горнолыж'],
    rawCategoryIds: [],
    role: 'secondary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: false, corporate: false, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Курортная зона', labelEn: 'Resort area' },
    requiresContext: true,
  },
  stadium_event_venue: {
    aliases: ['stadium', 'arena', 'стадион', 'арена', 'expo', 'конгресс', 'выстав'],
    rawCategoryIds: ['stadium', 'convention', 'entertainment'],
    role: 'tertiary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: true, corporate: true, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Стадион / площадка мероприятий', labelEn: 'Stadium / event venue' },
    requiresContext: true,
  },
  cultural_landmark: {
    aliases: ['landmark', 'достопримечательность'],
    rawCategoryIds: ['attraction'],
    role: 'secondary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: false, corporate: false, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Культурный объект', labelEn: 'Cultural landmark' },
    requiresContext: true,
  },
  museum: {
    aliases: ['museum', 'музей'],
    rawCategoryIds: ['attraction'],
    role: 'tertiary',
    defaultAnchorStrength: 'tier2',
    // Key rule: museums are *not* Tier‑1 residential anchors by default.
    maxResidentialTier: 2,
    audiences: { business: false, corporate: false, tourist: true, family: true, medical: false, student: true, industrial_worker: false },
    public: { labelRu: 'Музей', labelEn: 'Museum' },
    // Corporate/industrial “museums of factory history” are anti-signals.
    antiSignalNameRe: /музей\s+истории\s+(?:предприятия|завода|фабрики|комбината|техники)|корпоративный\s+музей|оао|ао|ооо|завод|фабрика|комбинат/i,
    requiresContext: true,
  },
  theater: {
    aliases: ['theatre', 'theater', 'театр'],
    rawCategoryIds: ['attraction', 'entertainment'],
    role: 'tertiary',
    defaultAnchorStrength: 'tier2',
    // Key rule: theaters are *not* Tier‑1 residential anchors by default.
    maxResidentialTier: 2,
    audiences: { business: false, corporate: false, tourist: true, family: true, medical: false, student: true, industrial_worker: false },
    public: { labelRu: 'Театр', labelEn: 'Theater' },
    requiresContext: true,
  },
  tourist_attraction: {
    aliases: ['attraction', 'tourist', 'достопримечательность'],
    rawCategoryIds: ['attraction'],
    role: 'secondary',
    defaultAnchorStrength: 'tier2',
    // Key rule: generic tourist attractions are capped unless context says otherwise.
    maxResidentialTier: 2,
    audiences: { business: false, corporate: false, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Туристический объект', labelEn: 'Tourist attraction' },
    requiresContext: true,
  },
  hotel_cluster: {
    aliases: ['hotel cluster'],
    rawCategoryIds: ['major_hotel', 'mid_hotel'],
    role: 'secondary',
    defaultAnchorStrength: 'tier2',
    maxResidentialTier: 2,
    audiences: { business: true, corporate: true, tourist: true, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Кластер отелей', labelEn: 'Hotel cluster' },
    requiresContext: true,
  },
  residential_density: {
    aliases: ['residential density'],
    rawCategoryIds: [],
    role: 'tertiary',
    defaultAnchorStrength: 'weak',
    maxResidentialTier: 3,
    audiences: { business: false, corporate: false, tourist: false, family: true, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Жилая плотность', labelEn: 'Residential density' },
    requiresContext: true,
  },
  weak_amenity: {
    aliases: ['amenity', 'local'],
    rawCategoryIds: ['food', 'shopping_local', 'education_local', 'civic', 'mid_hotel'],
    role: 'tertiary',
    defaultAnchorStrength: 'weak',
    maxResidentialTier: 3,
    audiences: { business: false, corporate: false, tourist: false, family: false, medical: false, student: false, industrial_worker: false },
    public: { labelRu: 'Локальная инфраструктура', labelEn: 'Local amenity' },
  },
};

// ── Anti-signal and context helpers (moved here from legacy taxonomy) ──────────

const WEAK_BUSINESS_SUBTYPES = new Set([
  'bank',
  'insurance',
  'commercial',
  'office_anon',
  'travel_agency',
]);

const WEAK_BUSINESS_NAME_RE =
  /банк|bank|страх|insurance|ингосстрах|росгосстрах|ренессанс|сбер|втб|альфа|тинькоф|тиньк|райффайзен|открытие|офис\b|office\b|страхован|нотариус|адвокат|юрист|юридич|бухгалтер|аудит|local\s+office/i;

const PERSON_NAME_OFFICE_RE =
  /(?:^|\s)[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.?\s*[А-ЯЁ]\.?(?=$|\s|[,.])|(?:^|\s)[A-Z][a-z]+\s+[A-Z]\.?\s*[A-Z]\.?(?=$|\s|[,.])/;

const STRONG_BUSINESS_ANCHOR_NAME_RE =
  /бизнес-центр|business\s+center|\bбц\b|office\s+complex|деловой\s+центр|москва[-\s]?сити|moscow\s+city|technopark|технопарк|industrial\s+park|штаб-квартира|headquarters/i;

const CBD_CONTEXT_NAME_RE =
  /москва[-\s]?сити|moscow\s+city|деловой\s+центр|central\s+business\s+district|\bcbd\b/i;

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

export function isPersonNameOfficePoi(name: string | undefined): boolean {
  const raw = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return false;
  return PERSON_NAME_OFFICE_RE.test(` ${raw} `);
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

function inferFamilyFromMagnet(m: MagnetItem): CanonicalMagnetFamily {
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
    if (/(?:^|\\s)бизнес-центр|business\\s+center|\\bбц\\b|moscow\\s+city|москва[-\\s]?сити/i.test(name)) {
      return 'business_center';
    }
    if (/technopark|технопарк|office\\s+cluster|office\\s+complex|деловой\\s+центр/i.test(name)) {
      return 'office_cluster';
    }
    return 'office_cluster';
  }

  // Retail / events / leisure
  if (m.categoryId === 'shopping_major') return 'shopping_mall';
  if (m.categoryId === 'stadium' || m.categoryId === 'convention') return 'stadium_event_venue';

  // Attractions (split conservatively by name; this must NOT auto-promote to tier1)
  if (m.categoryId === 'attraction') {
    if (/парк|park/i.test(name)) return 'park';
    if (/набереж|пляж|waterfront|beach/i.test(name)) return 'beach_waterfront';
    if (/курорт|resort|ski|горнолыж/i.test(name)) return 'resort_area';
    if (/музей|museum/i.test(name)) return 'museum';
    if (/театр|theatre|theater/i.test(name)) return 'theater';
    return 'tourist_attraction';
  }
  if (m.categoryId === 'entertainment') {
    if (/театр|theatre|theater/i.test(name)) return 'theater';
    return 'stadium_event_venue';
  }

  return 'weak_amenity';
}

function claimStrengthForDecision(d: Pick<CanonicalMagnetDecision, 'anchorStrength' | 'family'>): PublicClaimStrength {
  // Default mapping; consumer layers may further restrict.
  if (d.anchorStrength === 'negative') return 'hidden_from_public_copy';
  if (d.anchorStrength === 'noise') return 'hidden_from_public_copy';
  if (d.anchorStrength === 'weak') return 'weak_context_only';

  // tier2: moderate or weak, depending on family; keep conservative
  if (d.anchorStrength === 'tier2') {
    if (d.family === 'metro_station') return 'weak_context_only';
    return 'moderate_driver_allowed';
  }

  // tier1
  if (d.family === 'metro_station') return 'moderate_driver_allowed';
  return 'strong_driver_allowed';
}

/**
 * Canonical classifier: the only executable place that decides:
 * - canonical family
 * - anchor strength
 * - audience eligibility
 * - residential tier caps
 * - public labels + claim strength
 * - anti-signal downgrades
 */
export function classifyCanonicalMagnet(input: CanonicalMagnetClassifierInput): CanonicalMagnetDecision {
  const m = input.magnet;
  const family = inferFamilyFromMagnet(m);
  const reg = CANONICAL_MAGNET_REGISTRY[family];

  const band = distanceBandId(m.distance);
  const antiSignals: string[] = [];

  // Start from registry defaults.
  let anchorStrength: AnchorStrength = reg.defaultAnchorStrength;
  let maxResidentialTier: 1 | 2 | 3 = reg.maxResidentialTier;
  let audiences: Record<AudienceKey, boolean> = { ...reg.audiences };

  // Anti-signal downgrades (e.g. corporate/industrial museums).
  const name = n(m.name);
  if (reg.antiSignalNameRe && reg.antiSignalNameRe.test(name)) {
    antiSignals.push(`antiSignal:name(${family})`);
    anchorStrength = 'weak';
    maxResidentialTier = 3;
  }

  // Cross-family weak/local downgrades (canonicalized from legacy taxonomy).
  if (looksLikeWeakLocalAttractionPoi(m) && (family === 'museum' || family === 'tourist_attraction' || family === 'cultural_landmark')) {
    antiSignals.push('antiSignal:weak_local_attraction');
    anchorStrength = 'weak';
    maxResidentialTier = 3;
  }
  if (looksLikeWeakLocalMedicalPoi(m) && family === 'hospital') {
    antiSignals.push('antiSignal:weak_local_medical');
    anchorStrength = 'weak';
    maxResidentialTier = 3;
    audiences.medical = false;
    audiences.business = false;
    audiences.corporate = false;
  }
  if (looksLikeWeakLocalEducationPoi(m) && family === 'university') {
    antiSignals.push('antiSignal:weak_local_education');
    anchorStrength = 'weak';
    maxResidentialTier = 3;
    audiences.student = false;
  }
  if (looksLikeWeakLocalRetailPoi(m) && family === 'shopping_mall') {
    antiSignals.push('antiSignal:weak_local_retail');
    anchorStrength = 'weak';
    maxResidentialTier = 3;
    audiences.tourist = false;
    audiences.family = false;
  }
  if (looksLikeWeakLocalBusinessPoi(m) && (family === 'business_center' || family === 'office_cluster' || family === 'industrial_anchor' || family === 'industrial_zone')) {
    antiSignals.push('antiSignal:weak_local_business');
    anchorStrength = 'weak';
    maxResidentialTier = 3;
    audiences.business = false;
    audiences.corporate = false;
  }

  // Hospitality: hostel/guest-house patterns are weak local context.
  if (family === 'hotel_cluster') {
    const isWeak = WEAK_HOSPITALITY_NAME_RE.test(name);
    if (m.categoryId === 'mid_hotel' || isWeak) {
      antiSignals.push('antiSignal:weak_local_hospitality');
      anchorStrength = 'weak';
      maxResidentialTier = 3;
    } else if (m.categoryId === 'major_hotel') {
      // A single major hotel is never tier1 by itself; keep tier2.
      anchorStrength = anchorStrength === 'weak' ? 'weak' : 'tier2';
      maxResidentialTier = Math.max(maxResidentialTier, 2) as any;
    }
  }

  // Context unlocks.
  // Metro becomes a stronger anchor only in explicit CBD context.
  if (family === 'metro_station' && isCbdContextName(m.name)) {
    anchorStrength = 'tier1';
    maxResidentialTier = 1;
    audiences.business = true;
    audiences.corporate = true;
  }

  // Strong tourist anchors: may become Tier‑1 only with strong non-anti-signal context.
  // This preserves “major museum/landmark” behavior without allowing raw-name shortcuts.
  if (
    (family === 'museum' || family === 'theater' || family === 'tourist_attraction' || family === 'cultural_landmark' || family === 'park' || family === 'beach_waterfront' || family === 'resort_area') &&
    anchorStrength !== 'weak' &&
    Number.isFinite(m.attractionScore) &&
    (
      (m.strengthClass === 'strong' && m.attractionScore >= 4.2 && m.distance <= 1200) ||
      // Small-town / village landmarks: allow Tier‑1 when extremely close + high attractionScore,
      // even if upstream strengthClass is only "medium".
      (m.attractionScore >= 4.4 && m.distance <= 800)
    )
  ) {
    anchorStrength = 'tier1';
    maxResidentialTier = 1;
  }

  // Strong office anchors: “technopark / business center” patterns can be Tier‑1.
  if (
    (family === 'office_cluster' || family === 'business_center') &&
    anchorStrength !== 'weak' &&
    STRONG_BUSINESS_ANCHOR_NAME_RE.test(name) &&
    m.distance <= 1000
  ) {
    anchorStrength = 'tier1';
    maxResidentialTier = 1;
  }

  // Distance-based softening for tier2 families: beyond 1.2–1.5km they become weak context.
  if (anchorStrength === 'tier2' && m.distance > 1500) {
    antiSignals.push('antiSignal:too_far_for_tier2');
    anchorStrength = 'weak';
    maxResidentialTier = 3;
  }

  const claimStrength = (() => {
    // Strict: weak local business must be hidden from public copy.
    if (m.categoryId === 'business' && looksLikeWeakLocalBusinessPoi(m)) return 'hidden_from_public_copy' as const;
    return claimStrengthForDecision({ anchorStrength, family });
  })();

  return {
    family,
    role: reg.role,
    anchorStrength,
    maxResidentialTier,
    distanceBand: band,
    audiences,
    scoreCaps: {
      // Conservative defaults; can be tuned per-family later.
      audienceFitMax: anchorStrength === 'tier1' ? 100 : anchorStrength === 'tier2' ? 75 : 35,
      tier1CreditMax: maxResidentialTier === 1 ? 1 : 0,
    },
    public: {
      labelRu: reg.public.labelRu,
      labelEn: reg.public.labelEn,
      claimStrength,
    },
    antiSignals,
  };
}

export function mustSurfaceRadiusMForFamily(family: CanonicalMagnetFamily): number | null {
  return CANONICAL_MAGNET_REGISTRY[family].mustSurfaceRadiusM ?? null;
}

