import { describe, it, expect } from 'vitest';
import {
  applyResidentialDemoSanity,
  computeResidentialDemoPresentation,
} from '../residential-demo-sanity';
import type {
  MagnetItem,
  LocationAnalysis,
  NeighborhoodEnvironmentLayer,
  TargetAudience,
  ScoreBand,
} from '../types';
import type { LocationScoringTrace } from '../location-scoring-trace';

function magnet(p: Partial<MagnetItem> & Pick<MagnetItem, 'categoryId' | 'name' | 'distance'>): MagnetItem {
  return {
    categoryLabel: p.categoryId,
    icon: '•',
    lat: 0,
    lon: 0,
    weight: p.weight ?? 4,
    permanenceType: p.permanenceType ?? 'permanent',
    scopeLevel: p.scopeLevel ?? 'local',
    strengthClass: p.strengthClass ?? 'medium',
    attractionScore: p.attractionScore ?? 3,
    ...p,
  };
}

function mkTrace(evergreenIndex: number, finalScore: number): LocationScoringTrace {
  return {
    coordinates: { lat: 59.93, lon: 30.36 },
    rawObjectsCount: 0,
    classifiedMagnets: [],
    scoreFeatures: {
      evergreenIndex,
      attractionScaled: 0,
      competitorPressure: 0,
      magnet_score: 0,
      demand_score: 0,
      supply_score: 0,
      accessibility_score: 0,
      audience_fit_score: 0,
      seasonality_score: 0,
    },
    baseScore: finalScore,
    capsApplied: [],
    finalScore,
    evidence: [],
    publicBullets: [],
    removedPublicBullets: [],
    warnings: [],
  };
}

const baseEnv: NeighborhoodEnvironmentLayer = {
  environmentalFrictionScore: 14,
  concernLevel: 'low',
  concernLabelEn: 'Low concern',
  concernLabelRu: 'Окружение: спокойное',
  reasonsEn: [],
  reasonsRu: [],
  environmentNarrativeEn: '',
  environmentNarrativeRu: '',
  confidence: 'medium',
  breakdown: {
    majorRoads01: 0.2,
    industrial01: 0.05,
    aviation01: 0.04,
    nightlife01: 0.05,
    transitCorridor01: 0.12,
    harshUrbanStack01: 0.18,
  },
};

function fixture(p: {
  evergreenIndex: number;
  compositeHeadline?: number;
  magnets: MagnetItem[];
  primaryAudience: TargetAudience;
  audienceFitScore: number;
  fallbackMode?: boolean;
  audienceSharePct?: number;
  businessClusterDetected?: boolean;
  accessibilityStopDistances?: number[];
}): LocationAnalysis {
  const headline = p.compositeHeadline ?? p.evergreenIndex;
  return {
    evergreenIndex: p.evergreenIndex,
    scoreBand: (headline >= 70 ? 'strong' : headline >= 45 ? 'medium' : headline > 0 ? 'weak' : 'none') as ScoreBand,
    locationScore: {
      location_score: headline,
      rating: 'viable',
      breakdown: {
        demand_score: headline,
        supply_score: 60,
        magnet_score: 50,
        seasonality_score: 60,
        audience_fit_score: p.audienceFitScore,
        accessibility_score: 50,
      },
      estimated_monthly_income: { short_term: 0, mid_term: 0, hybrid: 0 },
      income_model: { base_adr_rub: 0, base_occupancy_pct: 0 },
      top_positive_factors: [],
      top_negative_factors: [],
      recommended_strategy: 'hybrid',
    },
    magnets: p.magnets,
    magnetCountByCategory: {},
    accessibilityStops: (p.accessibilityStopDistances ?? []).map((d) => ({
      id: `stop_${d}`,
      name: `Stop ${d}`,
      lat: 0,
      lon: 0,
      distance: d,
      mode: 'bus',
    })),
    competitors: [],
    gravityExplanation: {
      dominantMagnets: [],
      strongestZoneLabel: '',
      competitorPressureLevel: 'low',
      demandDistribution: 'split',
      demandType: 'mixed',
      clusterDetected: false,
      clusterSize: 0,
      scoreBreakdown: { attraction: 0, competitorPressure: 0, clusterBonus: 0, trafficBoost: 0 },
    },
    demandType: 'mixed',
    strongestMagnets: [],
    clusterZones: [],
    splitDemand: false,
    competitorPressure: 0,
    footTraffic: {
      modifierTier: 'moderate',
      boostPoints: 0,
      movementDensity: '',
      zoneActivity: '',
      flowStability: '',
      flowCharacter: '',
      transitVsTarget: { transitShare: 0.33, localActiveShare: 0.34, destinationShare: 0.33 },
      stability01: 0.5,
      concentration01: 0.5,
    },
    audienceAnalysis: {
      primaryAudience: p.primaryAudience,
      locationType: 'MIXED',
      audienceFitScore: p.audienceFitScore,
      primaryMagnets: [],
      fallbackMode: p.fallbackMode ?? false,
      audienceSharePct: p.audienceSharePct ?? 50,
      businessClusterDetected: p.businessClusterDetected ?? false,
      primaryDriverLabel: '',
      lockedMode: false,
      demandFlowLabel: '',
    },
    neighborhoodEnvironment: baseEnv,
    heatmapPoints: [],
    scoringTrace: mkTrace(p.evergreenIndex, headline),
    conclusion: '',
  };
}

type ExpectedBand = 'weak' | 'moderate' | 'strong' | 'premium';
type ExpectedAudience = 'residential' | 'mixed' | 'business' | 'tourist' | 'resort' | 'corporate';

type MatrixCase = {
  address: string;
  cityRegion: string;
  archetype: string;
  expectedBand: ExpectedBand;
  expectedRange: [number, number];
  expectedAudience: ExpectedAudience | ExpectedAudience[];
  mustNotHappen?: string[];
  analysis: {
    evergreenIndex: number;
    compositeHeadline?: number;
    magnets: MagnetItem[];
    primaryAudience: TargetAudience;
    audienceFitScore: number;
    fallbackMode?: boolean;
    audienceSharePct?: number;
    businessClusterDetected?: boolean;
    accessibilityStopDistances?: number[];
  };
};

function normalizeExpectedAudience(a: MatrixCase['expectedAudience']): ExpectedAudience[] {
  return Array.isArray(a) ? a : [a];
}

function mapAudienceToDemo(a: ExpectedAudience): 'RESIDENTIAL' | 'MIXED' | 'BUSINESS' | 'TOURIST' {
  switch (a) {
    case 'residential': return 'RESIDENTIAL';
    case 'mixed': return 'MIXED';
    case 'business': return 'BUSINESS';
    case 'tourist': return 'TOURIST';
    // Demo sanity only supports 4 audiences; map resort/corporate to best-fit.
    case 'resort': return 'TOURIST';
    case 'corporate': return 'BUSINESS';
  }
}

describe('RU residential canonical calibration matrix (deterministic harness)', () => {
  const cases: MatrixCase[] = [
    // Required benchmarks (explicit regression expectations)
    {
      address: 'Санкт-Петербург, Комендантский проспект, 23к1',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'metro residential',
      expectedBand: 'moderate',
      expectedRange: [55, 75],
      expectedAudience: 'mixed',
      mustNotHappen: ['Сильная локация для командированных'],
      analysis: {
        evergreenIndex: 72,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Комендантский проспект', distance: 650, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'business', name: 'Ингосстрах', distance: 250, subType: 'office', weight: 4 }),
          magnet({ categoryId: 'business', name: 'Ренессанс страхование', distance: 310, subType: 'office', weight: 4 }),
          magnet({ categoryId: 'shopping_local', name: 'Пятёрочка', distance: 220 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 62,
        businessClusterDetected: true,
        accessibilityStopDistances: [220],
      },
    },
    {
      address: 'Санкт-Петербург, Большeохтинский проспект, 5/10к1',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'secondary magnet cluster',
      expectedBand: 'moderate',
      expectedRange: [35, 55],
      expectedAudience: ['mixed', 'residential'],
      mustNotHappen: ['Сильная'],
      analysis: {
        // Production regression: raw model can surface this as "strong business" even though
        // it is driven by secondary cluster signals (not Tier-1 business/transport anchors).
        evergreenIndex: 86,
        magnets: [
          magnet({ categoryId: 'civic', name: 'ЗАГС Красногвардейского района', distance: 420, weight: 3 }),
          magnet({ categoryId: 'mid_hotel', name: 'Отель Охта', distance: 620, weight: 2.5 }),
          // Nearby city-scale magnets that can bias the raw model but should not yield a strong BUSINESS headline.
          magnet({ categoryId: 'shopping_major', name: 'Охта Молл', distance: 880, strengthClass: 'strong', weight: 5 }),
          magnet({ categoryId: 'attraction', name: 'Набережная Охты', distance: 650, strengthClass: 'medium', attractionScore: 4.1, weight: 5 }),
          // Food cluster
          magnet({ categoryId: 'food', name: 'Кафе 1', distance: 180 }),
          magnet({ categoryId: 'food', name: 'Кафе 2', distance: 220 }),
          magnet({ categoryId: 'food', name: 'Кафе 3', distance: 260 }),
          magnet({ categoryId: 'food', name: 'Кафе 4', distance: 300 }),
          magnet({ categoryId: 'food', name: 'Кафе 5', distance: 340 }),
          magnet({ categoryId: 'food', name: 'Кафе 6', distance: 360 }),
          magnet({ categoryId: 'food', name: 'Кафе 7', distance: 380 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 40,
        businessClusterDetected: false,
        accessibilityStopDistances: [320],
      },
    },
    {
      address: 'Санкт-Петербург, Невский проспект, 28',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'tourist center',
      expectedBand: 'premium',
      expectedRange: [80, 100],
      expectedAudience: 'tourist',
      analysis: {
        evergreenIndex: 92,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Невский проспект', distance: 240, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'attraction', name: 'Большой музей', distance: 310, strengthClass: 'strong', attractionScore: 4.8, weight: 6 }),
          magnet({ categoryId: 'shopping_major', name: 'ТЦ в центре', distance: 680, strengthClass: 'strong', weight: 5 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 70,
      },
    },
    {
      address: 'Санкт-Петербург, улица Маяковского, 6',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'premium city center',
      expectedBand: 'premium',
      expectedRange: [75, 95],
      expectedAudience: 'mixed',
      analysis: {
        evergreenIndex: 86,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Маяковская', distance: 420, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'attraction', name: 'Театр', distance: 650, strengthClass: 'strong', attractionScore: 4.7, weight: 6 }),
          magnet({ categoryId: 'shopping_major', name: 'Галерея', distance: 900, strengthClass: 'strong', weight: 5 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 55,
      },
    },
    {
      address: 'Москва, Пресненская набережная, 12',
      cityRegion: 'Москва',
      archetype: 'business center',
      expectedBand: 'premium',
      expectedRange: [80, 100],
      expectedAudience: 'corporate',
      analysis: {
        evergreenIndex: 95,
        magnets: [
          magnet({ categoryId: 'business', name: 'Бизнес-центр Москва-Сити', distance: 240, subType: 'office', strengthClass: 'strong', weight: 7 }),
          magnet({ categoryId: 'business', name: 'Технопарк', distance: 680, subType: 'office', strengthClass: 'strong', weight: 6 }),
          magnet({ categoryId: 'metro', name: 'Деловой центр', distance: 520, strengthClass: 'strong', weight: 9 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 85,
        businessClusterDetected: true,
      },
    },
    {
      address: 'Москва, Тверская улица, 7',
      cityRegion: 'Москва',
      archetype: 'premium city center',
      expectedBand: 'premium',
      expectedRange: [80, 100],
      expectedAudience: 'mixed',
      analysis: {
        evergreenIndex: 90,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Охотный ряд', distance: 350, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'attraction', name: 'Музей', distance: 600, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
          magnet({ categoryId: 'shopping_major', name: 'ТЦ', distance: 780, strengthClass: 'strong', weight: 5 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 65,
      },
    },
    {
      address: 'Екатеринбург, улица Малышева, 51',
      cityRegion: 'Свердловская область',
      archetype: 'business center',
      expectedBand: 'strong',
      expectedRange: [70, 90],
      expectedAudience: 'business',
      analysis: {
        evergreenIndex: 82,
        magnets: [
          magnet({ categoryId: 'business', name: 'Бизнес-центр', distance: 520, subType: 'office', strengthClass: 'strong', weight: 6 }),
          magnet({ categoryId: 'shopping_major', name: 'ТЦ', distance: 740, strengthClass: 'medium', weight: 4 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 72,
        businessClusterDetected: true,
      },
    },
    {
      address: 'Казань, улица Баумана, 21',
      cityRegion: 'Татарстан',
      archetype: 'tourist center',
      expectedBand: 'strong',
      expectedRange: [70, 90],
      expectedAudience: 'tourist',
      analysis: {
        evergreenIndex: 80,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Музей', distance: 420, strengthClass: 'strong', attractionScore: 4.7, weight: 6 }),
          magnet({ categoryId: 'metro', name: 'Кремлёвская', distance: 980, strengthClass: 'strong', weight: 9 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 60,
      },
    },
    {
      address: 'Сочи, Курортный проспект, 50',
      cityRegion: 'Краснодарский край',
      archetype: 'resort city',
      expectedBand: 'strong',
      expectedRange: [65, 90],
      expectedAudience: 'resort',
      analysis: {
        evergreenIndex: 74,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Театр', distance: 650, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
          magnet({ categoryId: 'major_hotel', name: 'Отель 5★', distance: 720, strengthClass: 'strong', weight: 6 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 58,
      },
    },
    {
      address: 'Анапа, Пионерский проспект, 20',
      cityRegion: 'Краснодарский край',
      archetype: 'beach resort',
      expectedBand: 'moderate',
      expectedRange: [45, 75],
      expectedAudience: 'resort',
      mustNotHappen: ['Сильная локация для командированных'],
      analysis: {
        evergreenIndex: 62,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Достопримечательность: пляж', distance: 420, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
          magnet({ categoryId: 'mid_hotel', name: 'Отель 3★', distance: 550, weight: 2.5 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 52,
      },
    },
    {
      address: 'Всеволожск, Колтушское шоссе, 44',
      cityRegion: 'Ленинградская область',
      archetype: 'satellite town',
      expectedBand: 'weak',
      expectedRange: [25, 45],
      expectedAudience: 'residential',
      analysis: {
        evergreenIndex: 32,
        magnets: [magnet({ categoryId: 'shopping_local', name: 'Магазин', distance: 260 })],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 20,
      },
    },
    {
      address: 'Горелово, Красносельское шоссе, 50',
      cityRegion: 'Ленинградская область',
      archetype: 'weak residential edge',
      expectedBand: 'weak',
      expectedRange: [15, 35],
      expectedAudience: 'residential',
      analysis: {
        evergreenIndex: 22,
        magnets: [],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 15,
      },
    },
    {
      address: 'Шерегеш, улица Гагарина, 12',
      cityRegion: 'Кемеровская область',
      archetype: 'mountain resort',
      expectedBand: 'moderate',
      expectedRange: [40, 70],
      expectedAudience: 'resort',
      analysis: {
        evergreenIndex: 55,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Горнолыжный курорт', distance: 650, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
          magnet({ categoryId: 'mid_hotel', name: 'Отель', distance: 520, weight: 2.5 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 55,
      },
    },

    // Remaining entries mirror the canonical markdown matrix (docs/location-validation/ru-residential-calibration-matrix.md).
    {
      address: 'Санкт-Петербург, Лиговский проспект, 50',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'railway station',
      expectedBand: 'strong',
      expectedRange: [70, 90],
      expectedAudience: 'business',
      analysis: {
        evergreenIndex: 82,
        magnets: [
          magnet({ categoryId: 'railway_station', name: 'Московский вокзал', distance: 520, strengthClass: 'strong', weight: 7 }),
          magnet({ categoryId: 'metro', name: 'Площадь Восстания', distance: 680, strengthClass: 'strong', weight: 9 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 72,
      },
    },
    {
      address: 'Москва, площадь Киевского Вокзала, 1',
      cityRegion: 'Москва',
      archetype: 'railway station',
      expectedBand: 'strong',
      expectedRange: [70, 95],
      expectedAudience: 'business',
      analysis: {
        evergreenIndex: 85,
        magnets: [
          magnet({ categoryId: 'railway_station', name: 'Киевский вокзал', distance: 520, strengthClass: 'strong', weight: 7 }),
          magnet({ categoryId: 'metro', name: 'Киевская', distance: 650, strengthClass: 'strong', weight: 9 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 75,
      },
    },
    {
      address: 'Москва, Аэропорт Шереметьево, терминал B',
      cityRegion: 'Московская область',
      archetype: 'airport',
      expectedBand: 'moderate',
      expectedRange: [45, 75],
      expectedAudience: 'corporate',
      mustNotHappen: ['Сильная туристическая локация'],
      analysis: {
        evergreenIndex: 62,
        magnets: [
          magnet({ categoryId: 'airport', name: 'Аэропорт Шереметьево', distance: 420, strengthClass: 'strong', weight: 7 }),
          magnet({ categoryId: 'railway_station', name: 'Аэроэкспресс', distance: 780, strengthClass: 'strong', weight: 7 }),
          magnet({ categoryId: 'mid_hotel', name: 'Отель рядом с аэропортом', distance: 640, weight: 2.5 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 55,
      },
    },
    {
      address: 'Санкт-Петербург, Аэропорт Пулково, 1',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'airport',
      expectedBand: 'moderate',
      expectedRange: [40, 70],
      expectedAudience: 'corporate',
      mustNotHappen: ['Сильная туристическая локация'],
      analysis: {
        evergreenIndex: 55,
        magnets: [
          magnet({ categoryId: 'airport', name: 'Аэропорт Пулково', distance: 520, strengthClass: 'strong', weight: 7 }),
          magnet({ categoryId: 'railway_station', name: 'Транспортный узел', distance: 820, strengthClass: 'strong', weight: 7 }),
          magnet({ categoryId: 'mid_hotel', name: 'Отель', distance: 650, weight: 2.5 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 52,
      },
    },
    {
      address: 'Москва, улица Арбат, 1',
      cityRegion: 'Москва',
      archetype: 'tourist center',
      expectedBand: 'premium',
      expectedRange: [80, 100],
      expectedAudience: 'tourist',
      analysis: {
        evergreenIndex: 94,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Арбатская', distance: 450, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'attraction', name: 'Театр', distance: 500, strengthClass: 'strong', attractionScore: 4.7, weight: 6 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 70,
      },
    },
    {
      address: 'Санкт-Петербург, Дворцовая площадь, 2',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'tourist center',
      expectedBand: 'premium',
      expectedRange: [85, 100],
      expectedAudience: 'tourist',
      analysis: {
        evergreenIndex: 96,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Адмиралтейская', distance: 650, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'attraction', name: 'Музей', distance: 260, strengthClass: 'strong', attractionScore: 4.9, weight: 6 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 75,
      },
    },
    {
      address: 'Нижний Новгород, Большая Покровская улица, 2',
      cityRegion: 'Нижегородская область',
      archetype: 'tourist center',
      expectedBand: 'strong',
      expectedRange: [70, 90],
      expectedAudience: 'tourist',
      analysis: {
        evergreenIndex: 82,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Театр', distance: 650, strengthClass: 'strong', attractionScore: 4.7, weight: 6 }),
          magnet({ categoryId: 'shopping_major', name: 'ТЦ', distance: 900, strengthClass: 'medium', weight: 4 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 60,
      },
    },
    {
      address: 'Новосибирск, Красный проспект, 25',
      cityRegion: 'Новосибирская область',
      archetype: 'business center',
      expectedBand: 'strong',
      expectedRange: [65, 90],
      expectedAudience: ['business', 'mixed'],
      analysis: {
        evergreenIndex: 78,
        magnets: [
          magnet({ categoryId: 'business', name: 'Бизнес-центр', distance: 650, subType: 'office', strengthClass: 'strong', weight: 6 }),
          magnet({ categoryId: 'shopping_major', name: 'ТЦ', distance: 820, strengthClass: 'medium', weight: 4 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 65,
        businessClusterDetected: true,
      },
    },
    {
      address: 'Ростов-на-Дону, Большая Садовая улица, 50',
      cityRegion: 'Ростовская область',
      archetype: 'business center',
      expectedBand: 'strong',
      expectedRange: [65, 90],
      expectedAudience: ['mixed', 'business'],
      analysis: {
        evergreenIndex: 76,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Остановка', distance: 650, strengthClass: 'medium', weight: 4 }), // stand-in transit
          magnet({ categoryId: 'shopping_major', name: 'ТЦ', distance: 900, strengthClass: 'medium', weight: 4 }),
          magnet({ categoryId: 'attraction', name: 'Театр', distance: 700, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 58,
      },
    },
    {
      address: 'Самара, Ленинградская улица, 25',
      cityRegion: 'Самарская область',
      archetype: 'tourist center',
      expectedBand: 'strong',
      expectedRange: [65, 90],
      expectedAudience: ['mixed', 'tourist'],
      analysis: {
        evergreenIndex: 74,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Музей', distance: 650, strengthClass: 'strong', attractionScore: 4.7, weight: 6 }),
          magnet({ categoryId: 'shopping_major', name: 'ТЦ', distance: 850, strengthClass: 'medium', weight: 4 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 55,
      },
    },
    {
      address: 'Калининград, Ленинский проспект, 30',
      cityRegion: 'Калининградская область',
      archetype: 'waterfront urban area',
      expectedBand: 'moderate',
      expectedRange: [55, 80],
      expectedAudience: 'mixed',
      analysis: {
        evergreenIndex: 65,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Центр', distance: 850, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'attraction', name: 'Набережная', distance: 650, strengthClass: 'medium', attractionScore: 4.4, weight: 5 }),
          magnet({ categoryId: 'shopping_major', name: 'ТЦ', distance: 900, strengthClass: 'medium', weight: 4 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 50,
      },
    },
    {
      address: 'Владивосток, Светланская улица, 33',
      cityRegion: 'Приморский край',
      archetype: 'waterfront urban area',
      expectedBand: 'moderate',
      expectedRange: [55, 80],
      expectedAudience: 'mixed',
      analysis: {
        evergreenIndex: 64,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Центр', distance: 850, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'attraction', name: 'Набережная', distance: 650, strengthClass: 'medium', attractionScore: 4.4, weight: 5 }),
          magnet({ categoryId: 'shopping_major', name: 'ТЦ', distance: 900, strengthClass: 'medium', weight: 4 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 48,
      },
    },
    {
      address: 'Санкт-Петербург, набережная Макарова, 10',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'waterfront urban area',
      expectedBand: 'strong',
      expectedRange: [65, 90],
      expectedAudience: 'mixed',
      analysis: {
        evergreenIndex: 78,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Спортивная', distance: 900, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'attraction', name: 'Набережная', distance: 420, strengthClass: 'strong', attractionScore: 4.7, weight: 6 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 58,
      },
    },
    {
      address: 'Москва, Комсомольский проспект, 28',
      cityRegion: 'Москва',
      archetype: 'premium city center',
      expectedBand: 'premium',
      expectedRange: [75, 95],
      expectedAudience: 'mixed',
      analysis: {
        evergreenIndex: 86,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Фрунзенская', distance: 650, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'shopping_major', name: 'ТЦ', distance: 900, strengthClass: 'medium', weight: 4 }),
          magnet({ categoryId: 'attraction', name: 'Музей', distance: 700, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 60,
      },
    },
    {
      address: 'Санкт-Петербург, Большой проспект П.С., 35',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'premium city center',
      expectedBand: 'premium',
      expectedRange: [75, 95],
      expectedAudience: 'mixed',
      analysis: {
        evergreenIndex: 84,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Петроградская', distance: 650, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'attraction', name: 'Театр', distance: 700, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 55,
      },
    },
    {
      address: 'Москва, Люблинская улица, 153',
      cityRegion: 'Москва',
      archetype: 'metro residential',
      expectedBand: 'moderate',
      expectedRange: [45, 70],
      expectedAudience: 'residential',
      mustNotHappen: ['Сильная локация для командированных'],
      analysis: {
        evergreenIndex: 58,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Марьино', distance: 650, strengthClass: 'strong', weight: 9 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 28,
      },
    },
    {
      address: 'Москва, улица Недорубова, 15',
      cityRegion: 'Москва',
      archetype: 'ordinary residential',
      expectedBand: 'weak',
      expectedRange: [25, 50],
      expectedAudience: 'residential',
      analysis: {
        evergreenIndex: 35,
        magnets: [],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 15,
      },
    },
    {
      address: 'Санкт-Петербург, Бухарестская улица, 130',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'ordinary residential',
      expectedBand: 'weak',
      expectedRange: [25, 50],
      expectedAudience: 'residential',
      analysis: {
        evergreenIndex: 34,
        magnets: [],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 15,
      },
    },
    {
      address: 'Екатеринбург, улица Бакинских Комиссаров, 100',
      cityRegion: 'Свердловская область',
      archetype: 'ordinary residential',
      expectedBand: 'weak',
      expectedRange: [20, 45],
      expectedAudience: 'residential',
      analysis: {
        evergreenIndex: 28,
        magnets: [],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 12,
      },
    },
    {
      address: 'Казань, проспект Победы, 180',
      cityRegion: 'Татарстан',
      archetype: 'ordinary residential',
      expectedBand: 'weak',
      expectedRange: [20, 45],
      expectedAudience: 'residential',
      analysis: {
        evergreenIndex: 26,
        magnets: [],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 12,
      },
    },
    {
      address: 'Челябинск, Комсомольский проспект, 80',
      cityRegion: 'Челябинская область',
      archetype: 'weak residential edge',
      expectedBand: 'weak',
      expectedRange: [15, 40],
      expectedAudience: 'residential',
      analysis: {
        evergreenIndex: 22,
        magnets: [],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 10,
      },
    },
    {
      address: 'Омск, проспект Мира, 150',
      cityRegion: 'Омская область',
      archetype: 'weak residential edge',
      expectedBand: 'weak',
      expectedRange: [15, 40],
      expectedAudience: 'residential',
      analysis: {
        evergreenIndex: 20,
        magnets: [],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 10,
      },
    },
    {
      address: 'Пермь, улица Ленина, 68',
      cityRegion: 'Пермский край',
      archetype: 'business center',
      expectedBand: 'strong',
      expectedRange: [65, 90],
      expectedAudience: ['mixed', 'business'],
      analysis: {
        evergreenIndex: 76,
        magnets: [
          magnet({ categoryId: 'business', name: 'Бизнес-центр', distance: 650, subType: 'office', strengthClass: 'strong', weight: 6 }),
          magnet({ categoryId: 'shopping_major', name: 'ТЦ', distance: 900, strengthClass: 'medium', weight: 4 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 60,
      },
    },
    {
      address: 'Томск, проспект Ленина, 36',
      cityRegion: 'Томская область',
      archetype: 'university cluster',
      expectedBand: 'strong',
      expectedRange: [60, 85],
      expectedAudience: ['mixed', 'business'],
      analysis: {
        evergreenIndex: 72,
        magnets: [
          magnet({ categoryId: 'university', name: 'Университет', distance: 650, strengthClass: 'strong', weight: 7 }),
          magnet({ categoryId: 'metro', name: 'Остановка', distance: 900, strengthClass: 'medium', weight: 4 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 55,
      },
    },
    {
      address: 'Новосибирск, проспект Академика Лаврентьева, 17',
      cityRegion: 'Новосибирская область',
      archetype: 'university cluster',
      expectedBand: 'moderate',
      expectedRange: [45, 70],
      expectedAudience: ['mixed', 'business'],
      analysis: {
        evergreenIndex: 58,
        magnets: [
          magnet({ categoryId: 'university', name: 'Кампус', distance: 650, strengthClass: 'medium', weight: 6 }),
          magnet({ categoryId: 'shopping_major', name: 'ТЦ', distance: 900, strengthClass: 'medium', weight: 4 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 50,
      },
    },
    {
      address: 'Москва, Большая Пироговская улица, 2',
      cityRegion: 'Москва',
      archetype: 'hospital cluster',
      expectedBand: 'strong',
      expectedRange: [65, 90],
      expectedAudience: 'corporate',
      analysis: {
        evergreenIndex: 78,
        magnets: [
          magnet({ categoryId: 'hospital', name: 'Клиника', distance: 650, strengthClass: 'strong', weight: 7 }),
          magnet({ categoryId: 'metro', name: 'Фрунзенская', distance: 900, strengthClass: 'strong', weight: 9 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 70,
      },
    },
    {
      address: 'Санкт-Петербург, Литейный проспект, 56',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'hospital cluster',
      expectedBand: 'moderate',
      expectedRange: [55, 80],
      expectedAudience: ['mixed', 'business'],
      analysis: {
        evergreenIndex: 66,
        magnets: [
          magnet({ categoryId: 'hospital', name: 'Клиника', distance: 650, strengthClass: 'strong', weight: 7 }),
          magnet({ categoryId: 'metro', name: 'Маяковская', distance: 980, strengthClass: 'strong', weight: 9 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 55,
      },
    },
    {
      address: 'Зеленоградск, Курортный проспект, 1',
      cityRegion: 'Калининградская область',
      archetype: 'beach resort',
      expectedBand: 'moderate',
      expectedRange: [45, 75],
      expectedAudience: 'resort',
      analysis: {
        evergreenIndex: 60,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Пляж', distance: 650, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
          magnet({ categoryId: 'mid_hotel', name: 'Отель', distance: 650, weight: 2.5 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 55,
      },
    },
    {
      address: 'Светлогорск, улица Ленина, 8',
      cityRegion: 'Калининградская область',
      archetype: 'resort city',
      expectedBand: 'moderate',
      expectedRange: [45, 75],
      expectedAudience: 'resort',
      analysis: {
        evergreenIndex: 58,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Достопримечательность: набережная', distance: 650, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
          magnet({ categoryId: 'mid_hotel', name: 'Отель', distance: 650, weight: 2.5 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 50,
      },
    },
    {
      address: 'Геленджик, набережная, 1',
      cityRegion: 'Краснодарский край',
      archetype: 'beach resort',
      expectedBand: 'moderate',
      expectedRange: [45, 80],
      expectedAudience: 'resort',
      analysis: {
        evergreenIndex: 62,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Набережная', distance: 650, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
          magnet({ categoryId: 'mid_hotel', name: 'Отель', distance: 650, weight: 2.5 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 55,
      },
    },
    {
      address: 'Сочи, Эсто‑Садок, улица Эстонская, 37',
      cityRegion: 'Краснодарский край',
      archetype: 'mountain resort',
      expectedBand: 'moderate',
      expectedRange: [45, 80],
      expectedAudience: 'resort',
      analysis: {
        evergreenIndex: 62,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Горнолыжный курорт', distance: 650, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
          magnet({ categoryId: 'mid_hotel', name: 'Отель', distance: 650, weight: 2.5 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 55,
      },
    },
    {
      address: 'Норильск, Заводская улица, 1',
      cityRegion: 'Красноярский край',
      archetype: 'industrial edge',
      expectedBand: 'weak',
      expectedRange: [10, 35],
      expectedAudience: ['corporate', 'residential'],
      mustNotHappen: ['Сильная туристическая локация'],
      analysis: {
        evergreenIndex: 18,
        magnets: [magnet({ categoryId: 'business', name: 'Завод', distance: 650, subType: 'industrial', strengthClass: 'medium', weight: 4 })],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 30,
        businessClusterDetected: false,
      },
    },
    {
      address: 'Тольятти, Южное шоссе, 20',
      cityRegion: 'Самарская область',
      archetype: 'industrial edge',
      expectedBand: 'weak',
      expectedRange: [15, 40],
      expectedAudience: ['corporate', 'residential'],
      analysis: {
        evergreenIndex: 24,
        magnets: [magnet({ categoryId: 'business', name: 'Промзона', distance: 650, subType: 'industrial', strengthClass: 'medium', weight: 4 })],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 28,
      },
    },
    {
      address: 'Москва, Харьковская улица, 2',
      cityRegion: 'Москва',
      archetype: 'low competition niche',
      expectedBand: 'weak',
      expectedRange: [20, 45],
      expectedAudience: 'residential',
      mustNotHappen: ['Сильная туристическая локация'],
      analysis: {
        evergreenIndex: 30,
        magnets: [],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 15,
      },
    },
    {
      address: 'Москва, улица Маросейка, 2/15',
      cityRegion: 'Москва',
      archetype: 'high competition saturated area',
      expectedBand: 'premium',
      expectedRange: [75, 95],
      expectedAudience: 'tourist',
      mustNotHappen: ['Слабый спрос'],
      analysis: {
        evergreenIndex: 86,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Китай-город', distance: 650, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'attraction', name: 'Музей', distance: 650, strengthClass: 'strong', attractionScore: 4.7, weight: 6 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 70,
      },
    },
    {
      address: 'Санкт-Петербург, Невский проспект, 110',
      cityRegion: 'Санкт‑Петербург',
      archetype: 'high competition saturated area',
      expectedBand: 'strong',
      expectedRange: [70, 95],
      expectedAudience: ['mixed', 'tourist'],
      analysis: {
        evergreenIndex: 82,
        magnets: [
          magnet({ categoryId: 'metro', name: 'Площадь Восстания', distance: 650, strengthClass: 'strong', weight: 9 }),
          magnet({ categoryId: 'attraction', name: 'Театр', distance: 650, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 60,
      },
    },
    {
      address: 'Суздаль, улица Ленина, 1',
      cityRegion: 'Владимирская область',
      archetype: 'village / settlement',
      expectedBand: 'moderate',
      expectedRange: [35, 60],
      /** Tier‑1 demo gate no longer treats isolated museum+hotel as walking anchors — presentation stays residential */
      expectedAudience: ['tourist', 'residential'],
      analysis: {
        evergreenIndex: 45,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Музей', distance: 650, strengthClass: 'medium', attractionScore: 4.4, weight: 5 }),
          magnet({ categoryId: 'mid_hotel', name: 'Отель', distance: 650, weight: 2.5 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 45,
      },
    },
  ];

  it('covers 50 calibration locations', () => {
    expect(cases).toHaveLength(50);
  });

  it.each(cases)('$address', (c) => {
    const analysis = fixture(c.analysis);
    const sanity = applyResidentialDemoSanity(analysis);
    const { cappedHeadline } = computeResidentialDemoPresentation(analysis, analysis.scoringTrace!.finalScore);

    expect(cappedHeadline).toBeGreaterThanOrEqual(c.expectedRange[0]);
    expect(cappedHeadline).toBeLessThanOrEqual(c.expectedRange[1]);

    const allowed = normalizeExpectedAudience(c.expectedAudience).map(mapAudienceToDemo);
    expect(allowed).toContain(sanity.displayAudience);

    for (const forbidden of c.mustNotHappen ?? []) {
      expect(sanity.verdictLabelRu).not.toContain(forbidden);
    }
  });

  it('explicit regressions: Komendantsky not strong business', () => {
    const kom = cases.find(x => x.address.includes('Комендантский проспект, 23к1'));
    expect(kom).toBeTruthy();

    const sanity = applyResidentialDemoSanity(fixture(kom!.analysis));
    expect(sanity.verdictLabelRu).not.toContain('Сильная локация для командированных');
    expect(sanity.displayAudience).not.toBe('BUSINESS');
  });

  it('explicit regressions: secondary cluster does not collapse to near-zero', () => {
    const analysisFloor = fixture({
        evergreenIndex: 6, // simulate gravity collapse; rules must floor it
        magnets: [
          magnet({ categoryId: 'civic', name: 'ЗАГС Красногвардейского района', distance: 420, weight: 3 }),
          magnet({ categoryId: 'mid_hotel', name: 'Отель Охта', distance: 620, weight: 2.5 }),
          // Food cluster
          magnet({ categoryId: 'food', name: 'Кафе 1', distance: 180 }),
          magnet({ categoryId: 'food', name: 'Кафе 2', distance: 220 }),
          magnet({ categoryId: 'food', name: 'Кафе 3', distance: 260 }),
          magnet({ categoryId: 'food', name: 'Кафе 4', distance: 300 }),
          magnet({ categoryId: 'food', name: 'Кафе 5', distance: 340 }),
          magnet({ categoryId: 'food', name: 'Кафе 6', distance: 360 }),
          magnet({ categoryId: 'food', name: 'Кафе 7', distance: 380 }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 40,
        businessClusterDetected: false,
        accessibilityStopDistances: [320],
      });
    const { cappedHeadline } = computeResidentialDemoPresentation(analysisFloor, analysisFloor.scoringTrace!.finalScore);
    expect(cappedHeadline).toBeGreaterThanOrEqual(35);
  });

  it('explicit regressions: Bolshokhtinsky public display is capped + has secondary-cluster reason', () => {
    const okhta = cases.find(x => x.address.includes('Большeохтинский'));
    expect(okhta).toBeTruthy();

    const okhtaAnalysis = fixture(okhta!.analysis);
    const sanity = applyResidentialDemoSanity(okhtaAnalysis);
    const { cappedHeadline } = computeResidentialDemoPresentation(okhtaAnalysis, okhtaAnalysis.scoringTrace!.finalScore);
    expect(cappedHeadline).toBeGreaterThanOrEqual(35);
    expect(cappedHeadline).toBeLessThanOrEqual(55);
    expect(sanity.displayAudience).not.toBe('BUSINESS');
    expect(sanity.verdictLabelRu).not.toContain('Сильная');
    expect(sanity.capReasonsRu.join(' ')).toContain('вторичный кластер');
  });

  it('explicit regressions: empty/weak residential stays weak', () => {
    const weakAnalysis = fixture({
        evergreenIndex: 18,
        magnets: [],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 10,
      });
    const sanity = applyResidentialDemoSanity(weakAnalysis);
    const { cappedHeadline } = computeResidentialDemoPresentation(weakAnalysis, weakAnalysis.scoringTrace!.finalScore);
    expect(cappedHeadline).toBe(18);
    expect(sanity.displayAudience).toBe('RESIDENTIAL');
  });

  it('explicit regressions: tier-1 business/tourist can still be strong', () => {
    const bizAnalysis = fixture({
        evergreenIndex: 92,
        magnets: [
          magnet({ categoryId: 'business', name: 'Бизнес-центр Сенатор', distance: 450, subType: 'office', weight: 6, strengthClass: 'strong' }),
          magnet({ categoryId: 'business', name: 'Технопарк Невский', distance: 700, subType: 'office', weight: 6, strengthClass: 'strong' }),
        ],
        primaryAudience: 'BUSINESS',
        audienceFitScore: 78,
        businessClusterDetected: true,
      });
    const businessStrong = applyResidentialDemoSanity(bizAnalysis);
    const bizCap = computeResidentialDemoPresentation(bizAnalysis, bizAnalysis.scoringTrace!.finalScore);
    expect(bizCap.cappedHeadline).toBe(92);
    expect(businessStrong.displayAudience).toBe('BUSINESS');

    const tourAnalysis = fixture({
        evergreenIndex: 88,
        magnets: [
          magnet({ categoryId: 'attraction', name: 'Большой музей современного искусства', distance: 300, strengthClass: 'strong', attractionScore: 4.8, weight: 6 }),
          magnet({ categoryId: 'shopping_major', name: 'Торговый центр', distance: 900, strengthClass: 'strong', weight: 5 }),
        ],
        primaryAudience: 'TOURIST',
        audienceFitScore: 40,
        fallbackMode: false,
      });
    const touristStrong = applyResidentialDemoSanity(tourAnalysis);
    const tourCap = computeResidentialDemoPresentation(tourAnalysis, tourAnalysis.scoringTrace!.finalScore);
    expect(tourCap.cappedHeadline).toBe(88);
    expect(touristStrong.displayAudience).toBe('TOURIST');
  });
});

