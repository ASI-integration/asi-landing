import type { MagnetItem } from './types';

export type Level1MagnetGroupId =
  | 'transport_logistics'
  | 'medicine'
  | 'business_administration'
  | 'industry'
  | 'education_science'
  | 'retail_mixed_use'
  | 'tourism_events';

export type Level1EntityType =
  | 'international_airport'
  | 'regional_airport'
  | 'private_business_aviation_terminal'
  | 'public_dual_use_airport'
  | 'seaport'
  | 'river_port'
  | 'cargo_port'
  | 'railway_hub'
  | 'major_railway_station'
  | 'bus_hub'
  | 'intercity_bus_terminal'
  | 'logistics_terminal'
  | 'dry_port'
  | 'major_freight_terminal'
  | 'federal_medical_center'
  | 'large_regional_hospital'
  | 'oncology_center'
  | 'perinatal_center'
  | 'trauma_center'
  | 'specialized_medical_cluster'
  | 'large_diagnostic_rehabilitation_center'
  | 'major_business_center'
  | 'business_district'
  | 'administrative_center'
  | 'court_government_cluster'
  | 'exhibition_center'
  | 'congress_center'
  | 'major_factory'
  | 'industrial_park'
  | 'port_industrial_cluster'
  | 'oil_gas_infrastructure'
  | 'metallurgy_cluster'
  | 'chemical_plant'
  | 'shipbuilding_ship_repair'
  | 'energy_infrastructure'
  | 'large_warehouse_fulfillment_center'
  | 'major_university'
  | 'campus'
  | 'research_center'
  | 'large_regional_college'
  | 'large_shopping_mall'
  | 'retail_cluster'
  | 'mixed_use_district'
  | 'stadium'
  | 'major_arena'
  | 'convention_venue'
  | 'year_round_tourist_anchor'
  | 'cruise_terminal'
  | 'major_cultural_institution';

export interface Level1MagnetGroup {
  id: Level1MagnetGroupId;
  labelRu: string;
  entityTypes: readonly Level1EntityType[];
  categoryIds: readonly string[];
  subTypes?: readonly string[];
}

export const LEVEL1_MAGNET_TAXONOMY = [
  {
    id: 'transport_logistics',
    labelRu: 'Транспорт и логистика',
    entityTypes: [
      'international_airport',
      'regional_airport',
      'private_business_aviation_terminal',
      'public_dual_use_airport',
      'seaport',
      'river_port',
      'cargo_port',
      'railway_hub',
      'major_railway_station',
      'bus_hub',
      'intercity_bus_terminal',
      'logistics_terminal',
      'dry_port',
      'major_freight_terminal',
    ],
    categoryIds: ['airport', 'railway_station', 'strategicTransportHub'],
    subTypes: ['airport', 'railway_station', 'bus_station', 'port', 'river_port', 'transport_interchange', 'metro_hub'],
  },
  {
    id: 'medicine',
    labelRu: 'Медицина',
    entityTypes: [
      'federal_medical_center',
      'large_regional_hospital',
      'oncology_center',
      'perinatal_center',
      'trauma_center',
      'specialized_medical_cluster',
      'large_diagnostic_rehabilitation_center',
    ],
    categoryIds: ['hospital', 'specializedMedicalAnchor'],
  },
  {
    id: 'business_administration',
    labelRu: 'Бизнес и управление',
    entityTypes: [
      'major_business_center',
      'business_district',
      'administrative_center',
      'court_government_cluster',
      'exhibition_center',
      'congress_center',
    ],
    categoryIds: ['business', 'civic', 'convention'],
    subTypes: ['office', 'government', 'townhall'],
  },
  {
    id: 'industry',
    labelRu: 'Промышленность',
    entityTypes: [
      'major_factory',
      'industrial_park',
      'port_industrial_cluster',
      'oil_gas_infrastructure',
      'metallurgy_cluster',
      'chemical_plant',
      'shipbuilding_ship_repair',
      'energy_infrastructure',
      'large_warehouse_fulfillment_center',
    ],
    categoryIds: ['business'],
    subTypes: ['factory', 'industrial', 'logistics', 'warehouse', 'fulfillment'],
  },
  {
    id: 'education_science',
    labelRu: 'Образование и наука',
    entityTypes: ['major_university', 'campus', 'research_center', 'large_regional_college'],
    categoryIds: ['university'],
  },
  {
    id: 'retail_mixed_use',
    labelRu: 'Крупный ритейл и mixed-use',
    entityTypes: ['large_shopping_mall', 'retail_cluster', 'mixed_use_district'],
    categoryIds: ['shopping_major'],
  },
  {
    id: 'tourism_events',
    labelRu: 'Туризм и события',
    entityTypes: [
      'stadium',
      'major_arena',
      'convention_venue',
      'year_round_tourist_anchor',
      'cruise_terminal',
      'major_cultural_institution',
    ],
    categoryIds: ['stadium', 'convention', 'attraction', 'entertainment'],
    subTypes: ['port', 'river_port'],
  },
] as const satisfies readonly Level1MagnetGroup[];

export const LEVEL1_MAGNET_RULES_RU = [
  'Мелкие POI не показываются как главные магниты в основном отчёте.',
  'Кафе, маленькие парки, небольшие магазины, аптеки, обычные рестораны и локальные сервисы — только фон окружения.',
  'Level-1 магниты в объяснениях важнее обычных POI.',
  'Перед рендерингом дубли магнитов объединяются.',
  'Стратегические якоря нельзя повышать только по названию: сначала категория, тип источника или таксономический gate.',
  'Если таксономия источника неполная, fallback должен быть явным, ограниченным и покрытым тестом.',
] as const;

export const MINOR_POI_BACKGROUND_CATEGORY_IDS = new Set([
  'food',
  'shopping_local',
  'education_local',
  'accessibility_stop',
  'bus_stop',
  'tram_stop',
  'mid_hotel',
]);

const MINOR_POI_NAME_RE =
  /кафе|кофейня|ресторан|аптек|магазин у дома|минимаркет|лар[её]к|павильон|парикмахер|салон красоты|local service|pharmacy|cafe|restaurant|small shop/i;

const LARGE_RETAIL_NAME_RE =
  /(?:^|\s)мега(?:$|\s|\W)|торгово-развлекательн|\bтрц\b|\bтрк\b|\bmall\b|\bmoll\b|галерея|крупн(?:ый|ого)\s+тц|retail\s+cluster/i;

const STRONG_ADMIN_CLUSTER_NAME_RE =
  /правительств|судебн|суды|арбитраж|административн(?:ый|ого)\s+центр|government\s+cluster|court\s+cluster/i;

const STRONG_BUSINESS_NAME_RE =
  /бизнес-центр|деловой\s+центр|бизнес\s+парк|технопарк|business\s+center|business\s+district|moscow\s+city|москва[-\s]?сити/i;

const STRONG_TOURISM_NAME_RE =
  /эрмитаж|третьяков|кремл|музей-заповедник|государственн(?:ый|ого)\s+(?:музей|театр)|федеральн|национальн|unesco|юнеско/i;

export interface Level1MagnetClassification {
  isLevel1: boolean;
  groupId: Level1MagnetGroupId | null;
  entityType: Level1EntityType | null;
  reason: string;
}

function norm(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isBackgroundMinorPoi(m: Pick<MagnetItem, 'categoryId' | 'name'>): boolean {
  if (MINOR_POI_BACKGROUND_CATEGORY_IDS.has(m.categoryId)) return true;
  return MINOR_POI_NAME_RE.test(norm(m.name));
}

export function classifyLevel1Magnet(m: Pick<MagnetItem, 'categoryId' | 'subType' | 'name'>): Level1MagnetClassification {
  if (isBackgroundMinorPoi(m)) {
    return {
      isLevel1: false,
      groupId: null,
      entityType: null,
      reason: 'minor_poi_background_only',
    };
  }

  const subType = norm(m.subType);
  const name = norm(m.name);

  if (m.categoryId === 'airport' || (m.categoryId === 'strategicTransportHub' && subType === 'airport')) {
    return { isLevel1: true, groupId: 'transport_logistics', entityType: 'regional_airport', reason: 'transport_category_gate' };
  }
  if (m.categoryId === 'railway_station') {
    if (subType === 'port') return { isLevel1: true, groupId: 'transport_logistics', entityType: 'seaport', reason: 'transport_subtype_gate' };
    if (subType === 'river_port') return { isLevel1: true, groupId: 'transport_logistics', entityType: 'river_port', reason: 'transport_subtype_gate' };
    if (subType === 'transport_interchange') return { isLevel1: true, groupId: 'transport_logistics', entityType: 'railway_hub', reason: 'transport_subtype_gate' };
    if (subType === 'halt') return { isLevel1: false, groupId: null, entityType: null, reason: 'minor_rail_halt' };
    return { isLevel1: true, groupId: 'transport_logistics', entityType: 'major_railway_station', reason: 'transport_category_gate' };
  }
  if (m.categoryId === 'strategicTransportHub') {
    if (subType === 'port') return { isLevel1: true, groupId: 'transport_logistics', entityType: 'seaport', reason: 'strategic_transport_subtype_gate' };
    if (subType === 'river_port') return { isLevel1: true, groupId: 'transport_logistics', entityType: 'river_port', reason: 'strategic_transport_subtype_gate' };
    if (subType === 'bus_station') return { isLevel1: true, groupId: 'transport_logistics', entityType: 'bus_hub', reason: 'strategic_transport_subtype_gate' };
    if (subType === 'railway_station') return { isLevel1: true, groupId: 'transport_logistics', entityType: 'railway_hub', reason: 'strategic_transport_subtype_gate' };
    return { isLevel1: true, groupId: 'transport_logistics', entityType: 'logistics_terminal', reason: 'strategic_transport_category_gate' };
  }
  if (m.categoryId === 'hospital' || m.categoryId === 'specializedMedicalAnchor') {
    if (/онколог/i.test(name)) return { isLevel1: true, groupId: 'medicine', entityType: 'oncology_center', reason: 'medical_category_and_specialization_gate' };
    if (/перинатальн/i.test(name)) return { isLevel1: true, groupId: 'medicine', entityType: 'perinatal_center', reason: 'medical_category_and_specialization_gate' };
    if (/травм|trauma/i.test(name)) return { isLevel1: true, groupId: 'medicine', entityType: 'trauma_center', reason: 'medical_category_and_specialization_gate' };
    if (/федеральн|научн|нии|research/i.test(name)) return { isLevel1: true, groupId: 'medicine', entityType: 'federal_medical_center', reason: 'medical_category_and_scale_gate' };
    return { isLevel1: true, groupId: 'medicine', entityType: 'large_regional_hospital', reason: 'medical_category_gate' };
  }
  if (m.categoryId === 'business') {
    if (subType === 'factory') return { isLevel1: true, groupId: 'industry', entityType: 'major_factory', reason: 'industry_subtype_gate' };
    if (subType === 'industrial') return { isLevel1: true, groupId: 'industry', entityType: 'industrial_park', reason: 'industry_subtype_gate' };
    if (STRONG_BUSINESS_NAME_RE.test(name)) return { isLevel1: true, groupId: 'business_administration', entityType: 'major_business_center', reason: 'business_category_and_scale_gate' };
    return { isLevel1: false, groupId: null, entityType: null, reason: 'business_scale_not_confirmed' };
  }
  if (m.categoryId === 'civic') {
    if (STRONG_ADMIN_CLUSTER_NAME_RE.test(name)) {
      return { isLevel1: true, groupId: 'business_administration', entityType: 'court_government_cluster', reason: 'admin_cluster_category_and_scale_gate' };
    }
    return { isLevel1: false, groupId: null, entityType: null, reason: 'single_civic_poi_background_only' };
  }
  if (m.categoryId === 'convention') {
    return { isLevel1: true, groupId: 'business_administration', entityType: 'congress_center', reason: 'convention_category_gate' };
  }
  if (m.categoryId === 'university') {
    if (/кампус|campus/i.test(name)) return { isLevel1: true, groupId: 'education_science', entityType: 'campus', reason: 'education_category_and_campus_gate' };
    if (/нии|исследователь|research|научн/i.test(name)) return { isLevel1: true, groupId: 'education_science', entityType: 'research_center', reason: 'education_category_and_research_gate' };
    return { isLevel1: true, groupId: 'education_science', entityType: 'major_university', reason: 'education_category_gate' };
  }
  if (m.categoryId === 'shopping_major') {
    if (!LARGE_RETAIL_NAME_RE.test(name)) return { isLevel1: false, groupId: null, entityType: null, reason: 'retail_scale_not_confirmed' };
    return { isLevel1: true, groupId: 'retail_mixed_use', entityType: 'large_shopping_mall', reason: 'retail_category_and_scale_gate' };
  }
  if (m.categoryId === 'stadium') {
    return { isLevel1: true, groupId: 'tourism_events', entityType: 'stadium', reason: 'stadium_category_gate' };
  }
  if (m.categoryId === 'attraction') {
    if (!STRONG_TOURISM_NAME_RE.test(name)) return { isLevel1: false, groupId: null, entityType: null, reason: 'tourist_scale_not_confirmed' };
    return { isLevel1: true, groupId: 'tourism_events', entityType: 'major_cultural_institution', reason: 'tourism_category_and_scale_gate' };
  }
  if (m.categoryId === 'entertainment') {
    return { isLevel1: true, groupId: 'tourism_events', entityType: 'year_round_tourist_anchor', reason: 'entertainment_category_gate' };
  }

  return { isLevel1: false, groupId: null, entityType: null, reason: 'not_in_level1_taxonomy' };
}

export type CanonicalCityScale = 'metropolis' | 'large_city' | 'medium_city' | 'small_city' | 'single_industry_town';
export type CanonicalDensityLevel = 'low' | 'medium' | 'high';
export type CanonicalRoleStrength = 'none' | 'district_forming' | 'city_forming';

export interface CanonicalLocationWeightInput {
  magnet: Pick<MagnetItem, 'categoryId' | 'subType' | 'name' | 'distance' | 'weight'>;
  cityScale: CanonicalCityScale;
  populationDensity: CanonicalDensityLevel;
  competingLevel1AnchorCount: number;
  uniqueness: 'ordinary' | 'rare' | 'unique_in_city';
  transportAccessibility: 'weak' | 'moderate' | 'strong';
  localEconomicRole: CanonicalRoleStrength;
}

export interface CanonicalLocationWeight {
  score: number;
  level: 'background' | 'district' | 'city' | 'regional';
  factors: readonly string[];
}

const GROUP_BASE_WEIGHT: Record<Level1MagnetGroupId, number> = {
  transport_logistics: 78,
  medicine: 68,
  business_administration: 62,
  industry: 66,
  education_science: 58,
  retail_mixed_use: 54,
  tourism_events: 56,
};

export function estimateCanonicalLocationWeight(input: CanonicalLocationWeightInput): CanonicalLocationWeight {
  const classification = classifyLevel1Magnet(input.magnet);
  if (!classification.isLevel1 || !classification.groupId) {
    return { score: 12, level: 'background', factors: ['background_minor_or_unconfirmed_poi'] };
  }

  const factors: string[] = [classification.reason];
  let score = GROUP_BASE_WEIGHT[classification.groupId];
  const distance = Math.max(0, input.magnet.distance);
  const distanceMul = distance <= 800 ? 1 : distance <= 1500 ? 0.86 : distance <= 5000 ? 0.58 : 0.34;
  score *= distanceMul;
  factors.push(`distance_multiplier_${distanceMul}`);

  if (input.cityScale === 'metropolis') {
    score *= 0.82;
    score -= Math.min(18, input.competingLevel1AnchorCount * 2.5);
    factors.push('metropolis_competing_anchor_discount');
  } else if (input.cityScale === 'small_city') {
    score *= 1.18;
    factors.push('small_city_anchor_premium');
  } else if (input.cityScale === 'single_industry_town') {
    score *= 1.28;
    factors.push('city_forming_town_premium');
  }

  if (input.uniqueness === 'unique_in_city') {
    score += 14;
    factors.push('unique_anchor_in_city');
  } else if (input.uniqueness === 'rare') {
    score += 7;
    factors.push('rare_anchor');
  }

  if (input.transportAccessibility === 'strong') {
    score += 8;
    factors.push('strong_transport_access');
  } else if (input.transportAccessibility === 'weak') {
    score -= 8;
    factors.push('weak_transport_access');
  }

  if (input.localEconomicRole === 'city_forming') {
    score += 16;
    factors.push('city_forming_anchor');
  } else if (input.localEconomicRole === 'district_forming') {
    score += 8;
    factors.push('district_forming_anchor');
  }

  if (input.populationDensity === 'high' && input.cityScale !== 'metropolis') {
    score += 4;
    factors.push('dense_non_metropolis_catchment');
  }

  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  const level = rounded >= 82 ? 'regional' : rounded >= 66 ? 'city' : rounded >= 40 ? 'district' : 'background';
  return { score: rounded, level, factors };
}

export function dedupeCanonicalMagnets<T extends Pick<MagnetItem, 'categoryId' | 'subType' | 'name' | 'distance'>>(magnets: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  for (const m of [...magnets].sort((a, b) => a.distance - b.distance)) {
    const key = canonicalMagnetDedupeKey(m);
    if (!byKey.has(key)) byKey.set(key, m);
  }
  return [...byKey.values()];
}

export function canonicalMagnetDedupeKey(
  m: Pick<MagnetItem, 'categoryId' | 'subType' | 'name' | 'distance'>,
): string {
  const normalizedName = norm(m.name)
    .replace(/(?:^|\s)(?:гбуз|фгбу|фгбуз|гбу|гбукк|гбуу?з|мбуз|ооо|ао|пао)(?=\s|$)/g, ' ')
    .replace(/\b(?:ккод|код)\b/g, ' ')
    .replace(/краев(?:ой|ого)|городск(?:ой|ая|ого)|клиническ(?:ий|ая|ого)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [
    m.categoryId,
    norm(m.subType),
    normalizedName,
    Math.round(m.distance / 100),
  ].join('|');
}

const LEVEL1_GROUP_PRIORITY: Record<Level1MagnetGroupId, number> = {
  transport_logistics: 0,
  industry: 1,
  business_administration: 2,
  medicine: 3,
  education_science: 4,
  retail_mixed_use: 5,
  tourism_events: 6,
};

export function canonicalLevel1Priority(
  m: Pick<MagnetItem, 'categoryId' | 'subType' | 'name' | 'distance' | 'weight'>,
): number {
  const classification = classifyLevel1Magnet(m);
  if (!classification.isLevel1 || !classification.groupId) return 100;
  const groupPriority = LEVEL1_GROUP_PRIORITY[classification.groupId] ?? 50;
  const entityBoost =
    classification.entityType === 'seaport' ||
    classification.entityType === 'cargo_port' ||
    classification.entityType === 'logistics_terminal' ||
    classification.entityType === 'port_industrial_cluster'
      ? -0.5
      : 0;
  const distancePenalty = Math.min(9, Math.max(0, m.distance) / 1000);
  const weightBoost = Math.min(2, Math.max(0, m.weight ?? 0) / 10);
  return groupPriority + entityBoost + distancePenalty * 0.01 - weightBoost * 0.01;
}
