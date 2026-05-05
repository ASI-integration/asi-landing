import { describe, it, expect } from 'vitest';
import { applyResidentialDemoSanity } from '../residential-demo-sanity';
import type {
  MagnetItem,
  LocationAnalysis,
  NeighborhoodEnvironmentLayer,
  TargetAudience,
  ScoreBand,
} from '../types';
import type {
  ResidentialDemoAudience,
  ResidentialDemoVerdictTone,
} from '../residential-demo-sanity';

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
  magnets: MagnetItem[];
  primaryAudience: TargetAudience;
  audienceFitScore: number;
  fallbackMode?: boolean;
  audienceSharePct?: number;
  businessClusterDetected?: boolean;
}): LocationAnalysis {
  return {
    evergreenIndex: p.evergreenIndex,
    scoreBand: (p.evergreenIndex >= 70 ? 'strong' : p.evergreenIndex >= 45 ? 'medium' : 'weak') as ScoreBand,
    locationScore: {
      location_score: p.evergreenIndex,
      rating: 'viable',
      breakdown: {
        demand_score: p.evergreenIndex,
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
    accessibilityStops: [],
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
    conclusion: '',
  };
}

function assertForbiddenVerdictPhrases(args: {
  verdictLabelRu: string;
  expectedVerdictTone: ResidentialDemoVerdictTone;
  expectedAudience: ResidentialDemoAudience;
}) {
  const { verdictLabelRu, expectedVerdictTone, expectedAudience } = args;

  if (expectedVerdictTone !== 'strong') {
    expect(verdictLabelRu).not.toContain('Сильная');
  }

  if (expectedAudience !== 'BUSINESS') {
    expect(verdictLabelRu).not.toContain('Сильная локация для командированных');
  }
  if (expectedAudience !== 'TOURIST') {
    expect(verdictLabelRu).not.toContain('Сильная туристическая локация');
  }
}

describe('RU residential golden regression matrix', () => {
  const cases: Array<{
    name: string;
    magnets: MagnetItem[];
    evergreenIndex: number;
    primaryAudience: TargetAudience;
    audienceFitScore: number;
    fallbackMode?: boolean;
    businessClusterDetected?: boolean;
    audienceSharePct?: number;
    expected: {
      displayScoreMin: number;
      displayScoreMax: number;
      displayAudience: ResidentialDemoAudience;
      verdictTone: ResidentialDemoVerdictTone;
      allowedPrimaryDriverCategories: string[];
      forbiddenPhrasesExtra?: string[];
    };
    extraAssertions?: (sanity: ReturnType<typeof applyResidentialDemoSanity>) => void;
  }> = [
    // 1) ordinary residential no magnets
    {
      name: 'ordinary residential — no magnets',
      magnets: [],
      evergreenIndex: 30,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 20,
      expected: {
        displayScoreMin: 30,
        displayScoreMax: 30,
        displayAudience: 'RESIDENTIAL',
        verdictTone: 'weak',
        allowedPrimaryDriverCategories: [],
      },
    },

    // 2) residential + weak offices/banks/insurance
    {
      name: 'residential — weak offices/banks/insurance only',
      magnets: [
        magnet({ categoryId: 'business', name: 'Ингосстрах', distance: 250, subType: 'office', weight: 4 }),
        magnet({ categoryId: 'business', name: 'Ренессанс страхование', distance: 480, subType: 'office', weight: 4 }),
        magnet({ categoryId: 'business', name: 'Слетать.ру', distance: 650, subType: 'office', weight: 3 }),
      ],
      evergreenIndex: 88,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 40,
      businessClusterDetected: true,
      expected: {
        displayScoreMin: 65,
        displayScoreMax: 65,
        displayAudience: 'RESIDENTIAL',
        verdictTone: 'medium',
        allowedPrimaryDriverCategories: [],
      },
    },

    // 3) residential + metro only
    {
      name: 'residential — metro only',
      magnets: [magnet({ categoryId: 'metro', name: 'Невский проспект', distance: 600, strengthClass: 'strong', weight: 9 })],
      evergreenIndex: 92,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 20,
      expected: {
        displayScoreMin: 80,
        displayScoreMax: 80,
        displayAudience: 'RESIDENTIAL',
        verdictTone: 'medium',
        allowedPrimaryDriverCategories: ['metro'],
      },
    },

    // 4) metro + weak offices + local shopping
    {
      name: 'metro + weak offices + local shopping',
      magnets: [
        magnet({ categoryId: 'metro', name: 'Комендантский проспект', distance: 850, strengthClass: 'strong', weight: 9 }),
        magnet({ categoryId: 'business', name: 'Ингосстрах', distance: 250, subType: 'office', weight: 4 }),
        magnet({ categoryId: 'business', name: 'Ренессанс страхование', distance: 310, subType: 'office', weight: 4 }),
        magnet({ categoryId: 'shopping_local', name: 'Пятёрочка', distance: 220 }),
      ],
      evergreenIndex: 92,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 62,
      businessClusterDetected: true,
      expected: {
        displayScoreMin: 70,
        displayScoreMax: 70,
        displayAudience: 'MIXED',
        verdictTone: 'medium',
        allowedPrimaryDriverCategories: ['metro'],
      },
    },

    // 5) hospital cluster
    {
      name: 'hospital cluster',
      magnets: [
        magnet({ categoryId: 'hospital', name: 'Городская больница №3', distance: 800, strengthClass: 'strong', weight: 7 }),
        magnet({ categoryId: 'metro', name: 'Гостиный двор', distance: 900, strengthClass: 'strong', weight: 9 }),
      ],
      evergreenIndex: 92,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 75,
      businessClusterDetected: false,
      expected: {
        displayScoreMin: 92,
        displayScoreMax: 92,
        displayAudience: 'BUSINESS',
        verdictTone: 'strong',
        allowedPrimaryDriverCategories: ['hospital'],
      },
    },

    // 6) university cluster
    {
      name: 'university cluster',
      magnets: [
        magnet({ categoryId: 'university', name: 'Санкт-Петербургский университет', distance: 900, strengthClass: 'strong', weight: 7 }),
        magnet({ categoryId: 'metro', name: 'Невский проспект', distance: 600, strengthClass: 'strong', weight: 9 }),
      ],
      evergreenIndex: 91,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 70,
      businessClusterDetected: false,
      expected: {
        displayScoreMin: 91,
        displayScoreMax: 91,
        displayAudience: 'MIXED',
        verdictTone: 'strong',
        allowedPrimaryDriverCategories: ['university', 'metro'],
      },
    },

    // 6b) Bolshokhtinsky-like: attraction + shopping + university + weak offices (no true business/transit anchor)
    {
      name: 'Bolshokhtinsky-like secondary cluster must not surface as strong BUSINESS',
      magnets: [
        magnet({ categoryId: 'attraction', name: 'Историко-мемориальный музей «Смольный»', distance: 650, strengthClass: 'strong', attractionScore: 4.6, weight: 6 }),
        magnet({ categoryId: 'university', name: 'Факультет Международных Отношений', distance: 780, strengthClass: 'strong', weight: 6 }),
        magnet({ categoryId: 'shopping_major', name: 'Охта', distance: 880, strengthClass: 'medium', weight: 5 }),
        magnet({ categoryId: 'attraction', name: 'Музей-квартира П. К. Козлова', distance: 740, strengthClass: 'strong', attractionScore: 4.4, weight: 6 }),
        // Weak “office” noise: should not become Tier-1 business and should not exempt Cap E.
        magnet({ categoryId: 'business', name: 'Офис продаж', distance: 320, subType: 'office', weight: 3 }),
        magnet({ categoryId: 'business', name: 'Bank branch', distance: 410, subType: 'bank', weight: 3 }),
      ],
      evergreenIndex: 86,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 55,
      businessClusterDetected: true,
      audienceSharePct: 65,
      expected: {
        displayScoreMin: 35,
        displayScoreMax: 55,
        displayAudience: 'RESIDENTIAL',
        verdictTone: 'weak',
        allowedPrimaryDriverCategories: ['attraction', 'shopping_major', 'university'],
        forbiddenPhrasesExtra: ['Сильная'],
      },
      extraAssertions: (sanity) => {
        expect(sanity.capApplied || sanity.capReasonsRu.length > 0).toBe(true);
        expect(sanity.displayAudience).not.toBe('BUSINESS');
      },
    },

    // 6c) Moscow City / Presnenskaya-like: CBD transit anchors must escape weak-office-only cap
    {
      name: 'CBD transit hub must not be weak-office-only capped (Moscow City-like)',
      magnets: [
        magnet({ categoryId: 'railway_station', name: 'Москва-Сити', distance: 520, strengthClass: 'strong', weight: 7 }),
        magnet({ categoryId: 'metro', name: 'Деловой центр', distance: 640, strengthClass: 'strong', weight: 9 }),
        magnet({ categoryId: 'attraction', name: 'Центр профориентации Московского метрополитена', distance: 700, strengthClass: 'medium', attractionScore: 3.4, weight: 4 }),
        // Generic office POIs: businessClusterDetected=true but should not trigger Cap D due to CBD context above.
        magnet({ categoryId: 'business', name: 'Офис', distance: 280, subType: 'office', weight: 4 }),
        magnet({ categoryId: 'business', name: 'Офис 2', distance: 360, subType: 'office', weight: 4 }),
      ],
      evergreenIndex: 70,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 65,
      businessClusterDetected: true,
      audienceSharePct: 70,
      expected: {
        displayScoreMin: 70,
        displayScoreMax: 70,
        displayAudience: 'BUSINESS',
        verdictTone: 'medium',
        allowedPrimaryDriverCategories: ['railway_station', 'metro'],
      },
      extraAssertions: (sanity) => {
        // Ensure the weak-office-only cap reason is NOT present.
        expect(sanity.capReasonsRu.join(' ')).not.toContain('локальные офисные точки');
      },
    },

    // 6d) Gorelovo-like: weak/cautious, no strong verdict
    {
      name: 'Gorelovo-like low-signal area stays weak/cautious',
      magnets: [
        magnet({ categoryId: 'shopping_local', name: 'Магазин у дома', distance: 250, weight: 2 }),
        magnet({ categoryId: 'education_local', name: 'Школа', distance: 450, weight: 2 }),
      ],
      evergreenIndex: 42,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 18,
      businessClusterDetected: false,
      expected: {
        displayScoreMin: 42,
        displayScoreMax: 42,
        displayAudience: 'RESIDENTIAL',
        verdictTone: 'weak',
        allowedPrimaryDriverCategories: [],
      },
    },

    // 7) real business center cluster
    {
      name: 'real business center cluster',
      magnets: [
        magnet({ categoryId: 'business', name: 'Бизнес-центр Сенатор', distance: 450, subType: 'office', weight: 6, strengthClass: 'strong' }),
        magnet({ categoryId: 'business', name: 'Технопарк Невский', distance: 700, subType: 'office', weight: 6, strengthClass: 'strong' }),
      ],
      evergreenIndex: 93,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 78,
      businessClusterDetected: true,
      expected: {
        displayScoreMin: 93,
        displayScoreMax: 93,
        displayAudience: 'BUSINESS',
        verdictTone: 'strong',
        allowedPrimaryDriverCategories: ['business'],
      },
    },

    // 8) railway station
    {
      name: 'railway station',
      magnets: [
        magnet({ categoryId: 'railway_station', name: 'Киевский вокзал', distance: 600, strengthClass: 'strong', weight: 7 }),
        magnet({ categoryId: 'metro', name: 'Невский проспект', distance: 950, strengthClass: 'strong', weight: 9 }),
        magnet({ categoryId: 'business', name: 'Ингосстрах', distance: 250, subType: 'office', weight: 4 }),
      ],
      evergreenIndex: 92,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 70,
      fallbackMode: false,
      businessClusterDetected: false,
      expected: {
        displayScoreMin: 92,
        displayScoreMax: 92,
        displayAudience: 'BUSINESS',
        verdictTone: 'strong',
        allowedPrimaryDriverCategories: ['railway_station'],
      },
    },

    // 9) airport
    {
      name: 'airport',
      magnets: [
        magnet({ categoryId: 'airport', name: 'Аэропорт Пулково', distance: 900, strengthClass: 'strong', weight: 7 }),
        magnet({ categoryId: 'metro', name: 'Комендантский проспект', distance: 800, strengthClass: 'strong', weight: 9 }),
        magnet({ categoryId: 'business', name: 'Ингосстрах', distance: 400, subType: 'office', weight: 4 }),
      ],
      evergreenIndex: 90,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 70,
      fallbackMode: false,
      businessClusterDetected: false,
      expected: {
        displayScoreMin: 90,
        displayScoreMax: 90,
        displayAudience: 'BUSINESS',
        verdictTone: 'strong',
        allowedPrimaryDriverCategories: ['airport'],
      },
    },

    // 10) tourist center
    {
      name: 'tourist center',
      magnets: [
        magnet({
          categoryId: 'attraction',
          name: 'Большой музей современного искусства',
          distance: 300,
          strengthClass: 'strong',
          attractionScore: 4.8,
          weight: 6,
        }),
        magnet({ categoryId: 'shopping_major', name: 'Торговый центр Невский', distance: 900, strengthClass: 'strong', weight: 5 }),
      ],
      evergreenIndex: 88,
      primaryAudience: 'TOURIST',
      audienceFitScore: 40,
      fallbackMode: false,
      businessClusterDetected: false,
      expected: {
        displayScoreMin: 88,
        displayScoreMax: 88,
        displayAudience: 'TOURIST',
        verdictTone: 'strong',
        allowedPrimaryDriverCategories: ['attraction'],
      },
    },

    // 11) industrial cluster — under the new residential policy heavy industry
    //     does NOT unlock BUSINESS or count as a Tier-1 business anchor.
    //     With only a metro Tier-1 + factories nearby, the industrial-edge cap
    //     fires: score ≤ 55, audience RESIDENTIAL, verdict cannot be "strong".
    {
      name: 'industrial cluster — must not surface as strong BUSINESS (new policy)',
      magnets: [
        magnet({ categoryId: 'business', name: 'Завод Север', distance: 400, subType: 'industrial', weight: 6, strengthClass: 'strong' }),
        magnet({ categoryId: 'business', name: 'Кампус производственный', distance: 800, subType: 'industrial', weight: 6, strengthClass: 'strong' }),
        magnet({ categoryId: 'metro', name: 'Невский проспект', distance: 600, strengthClass: 'strong', weight: 9 }),
        magnet({ categoryId: 'shopping_major', name: 'Ритейл-кластер', distance: 850, strengthClass: 'medium', weight: 4 }),
      ],
      evergreenIndex: 92,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 78,
      businessClusterDetected: true,
      expected: {
        displayScoreMin: 40,
        displayScoreMax: 55,
        displayAudience: 'RESIDENTIAL',
        verdictTone: 'weak',
        allowedPrimaryDriverCategories: ['metro'],
        forbiddenPhrasesExtra: ['Сильная', 'командированных'],
      },
      extraAssertions: (sanity) => {
        // Industrial business POIs must NOT qualify as Tier-1 business anchors.
        expect(sanity.tier1Magnets.some(m => m.categoryId === 'business')).toBe(false);
        // Industrial-edge cap reason must be present.
        expect(sanity.capReasonsRu.join(' ')).toContain('промышленные объекты');
      },
    },

    // 12) dense city center
    {
      name: 'dense city center',
      magnets: [
        magnet({ categoryId: 'metro', name: 'Невский проспект', distance: 300, strengthClass: 'strong', weight: 9 }),
        magnet({ categoryId: 'hospital', name: 'Городская больница №3', distance: 700, strengthClass: 'strong', weight: 7 }),
        magnet({
          categoryId: 'attraction',
          name: 'Музей истории города',
          distance: 400,
          strengthClass: 'strong',
          attractionScore: 4.6,
          weight: 6,
        }),
        magnet({ categoryId: 'shopping_major', name: 'Большой торговый центр', distance: 900, strengthClass: 'medium', weight: 4 }),
        magnet({ categoryId: 'business', name: 'Бизнес-центр Сенатор', distance: 600, subType: 'office', weight: 6, strengthClass: 'strong' }),
      ],
      evergreenIndex: 95,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 85,
      businessClusterDetected: true,
      expected: {
        displayScoreMin: 95,
        displayScoreMax: 95,
        displayAudience: 'BUSINESS',
        verdictTone: 'strong',
        allowedPrimaryDriverCategories: ['hospital', 'business', 'metro'],
      },
    },

    // 13) Komendantsky production magnet list (explicit regression)
    {
      name: 'Komendantsky production magnet list — dedupe & demotions',
      magnets: [
        // Metro station + entrances (must dedupe to 1 Tier-1 anchor)
        magnet({ categoryId: 'metro', name: 'Комендантский проспект', distance: 473, strengthClass: 'strong', weight: 9 }),
        magnet({ categoryId: 'metro', name: 'Вход 1', distance: 680, strengthClass: 'medium', weight: 9 }),
        magnet({ categoryId: 'metro', name: 'Вход 2', distance: 686, strengthClass: 'medium', weight: 9 }),

        // Minor tourist attraction (must NOT become Tier-1)
        magnet({ categoryId: 'attraction', name: 'Самолет - стрекоза', distance: 481, attractionScore: 2.1, strengthClass: 'weak', weight: 4 }),

        // Business offices — must be treated as weak unless name clearly indicates a real Tier-1 business magnet.
        magnet({ categoryId: 'business', name: 'Ингосстрах', distance: 3, subType: 'office', weight: 4 }),
        magnet({ categoryId: 'business', name: 'Ренессанс страхование', distance: 236, subType: 'office', weight: 4 }),
        magnet({ categoryId: 'business', name: 'Марио', distance: 282, subType: 'office', weight: 4 }),
        magnet({ categoryId: 'business', name: 'Ренессанс Страхование', distance: 412, subType: 'office', weight: 4 }),
        magnet({ categoryId: 'business', name: 'Слетать.ру', distance: 445, subType: 'office', weight: 3 }),

        // Shopping major nearby (should not by itself produce strong BUSINESS headline)
        magnet({ categoryId: 'shopping_major', name: 'Крокус', distance: 794, strengthClass: 'medium', weight: 4 }),
        magnet({ categoryId: 'shopping_major', name: 'Сабина', distance: 854, strengthClass: 'medium', weight: 4 }),

        // Local food/shop magnets (Tier-1 filter should ignore them)
        magnet({ categoryId: 'food', name: 'Локальное кафе', distance: 380 }),
        magnet({ categoryId: 'shopping_local', name: 'Локальный магазин', distance: 410 }),
      ],
      evergreenIndex: 93,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 62,
      fallbackMode: false,
      audienceSharePct: 70,
      businessClusterDetected: true,
      expected: {
        displayScoreMin: 70,
        displayScoreMax: 70,
        displayAudience: 'MIXED',
        verdictTone: 'medium',
        allowedPrimaryDriverCategories: ['metro', 'shopping_major'],
        forbiddenPhrasesExtra: [],
      },
      extraAssertions: (sanity) => {
        // Cap reason must explicitly reflect the “weak-office cluster” guard.
        expect(sanity.capReasonsRu.join(' ')).toContain(
          'Рядом есть локальные офисные точки, но сильный деловой магнит не подтверждён.',
        );

        // Metro dedupe: only the station counts as a single Tier-1 transport anchor.
        const metroTier1Names = sanity.tier1Magnets
          .filter(m => m.categoryId === 'metro')
          .map(m => m.name);
        expect(metroTier1Names).toHaveLength(1);
        expect(metroTier1Names[0]).toBe('Комендантский проспект');

        // Minor attraction demotion: "Самолет - стрекоза" must not be Tier-1.
        expect(sanity.tier1Magnets.some(m => m.categoryId === 'attraction' && m.name === 'Самолет - стрекоза')).toBe(false);

        // Generic offices must not become Tier-1 business magnets.
        expect(sanity.tier1Magnets.some(m => m.categoryId === 'business')).toBe(false);
      },
    },

    // 14) Мурино-style industrial-edge residential (Оборонная 37, Мурино).
    //     Factory POI nearby, residential character. The audience model may
    //     hard-lock BUSINESS via factory subtype weight, but the residential
    //     demo MUST cap to 40–55 and force RESIDENTIAL. No "Сильная локация
    //     для командированных" allowed.
    {
      name: 'Мурино-style industrial-edge residential — must score 40–55 RESIDENTIAL',
      magnets: [
        magnet({ categoryId: 'business', name: 'Производство Мурино', distance: 600, subType: 'factory', weight: 6, strengthClass: 'strong' }),
        magnet({ categoryId: 'metro', name: 'Девяткино', distance: 1400, strengthClass: 'strong', weight: 9 }),
        magnet({ categoryId: 'shopping_local', name: 'Магазин у дома', distance: 250, weight: 2 }),
      ],
      evergreenIndex: 71,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 60,
      audienceSharePct: 80,
      businessClusterDetected: false,
      expected: {
        displayScoreMin: 40,
        displayScoreMax: 55,
        displayAudience: 'RESIDENTIAL',
        verdictTone: 'weak',
        allowedPrimaryDriverCategories: ['metro'],
        forbiddenPhrasesExtra: ['Сильная', 'командированных'],
      },
      extraAssertions: (sanity) => {
        expect(sanity.capApplied).toBe(true);
        expect(sanity.capReasonsRu.join(' ')).toContain('промышленные объекты');
        expect(sanity.tier1Magnets.some(m => m.categoryId === 'business')).toBe(false);
      },
    },
  ];

  it.each(cases)('$name', (c) => {
    const analysis = fixture({
      evergreenIndex: c.evergreenIndex,
      magnets: c.magnets,
      primaryAudience: c.primaryAudience,
      audienceFitScore: c.audienceFitScore,
      fallbackMode: c.fallbackMode,
      audienceSharePct: c.audienceSharePct,
      businessClusterDetected: c.businessClusterDetected,
    });

    const sanity = applyResidentialDemoSanity(analysis);

    expect(sanity.displayScore).toBeGreaterThanOrEqual(c.expected.displayScoreMin);
    expect(sanity.displayScore).toBeLessThanOrEqual(c.expected.displayScoreMax);
    expect(sanity.displayAudience).toBe(c.expected.displayAudience);
    expect(sanity.verdictTone).toBe(c.expected.verdictTone);

    // Primary driver allowed: at least one Tier-1 anchor category must belong to the allowed list.
    if (c.expected.allowedPrimaryDriverCategories.length === 0) {
      expect(sanity.tier1Magnets).toHaveLength(0);
    } else {
      const tierCats = sanity.tier1Magnets.map(m => m.categoryId);
      const hasAllowed = tierCats.some(cat => c.expected.allowedPrimaryDriverCategories.includes(cat));
      expect(hasAllowed).toBe(true);
    }

    assertForbiddenVerdictPhrases({
      verdictLabelRu: sanity.verdictLabelRu,
      expectedVerdictTone: c.expected.verdictTone,
      expectedAudience: c.expected.displayAudience,
    });

    for (const forbidden of c.expected.forbiddenPhrasesExtra ?? []) {
      expect(sanity.verdictLabelRu).not.toContain(forbidden);
    }

    if (c.extraAssertions) c.extraAssertions(sanity);
  });
});

