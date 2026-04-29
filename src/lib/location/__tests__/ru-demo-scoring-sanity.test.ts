import { describe, it, expect } from 'vitest';
import { applyResidentialDemoSanity } from '../residential-demo-sanity';
import { getBand } from '../explanation';
import type {
  LocationAnalysis,
  MagnetItem,
  NeighborhoodEnvironmentLayer,
  ScoreBand,
  TargetAudience,
} from '../types';

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
      businessClusterDetected: false,
      primaryDriverLabel: '',
      lockedMode: false,
      demandFlowLabel: '',
    },
    neighborhoodEnvironment: baseEnv,
    heatmapPoints: [],
    conclusion: '',
  };
}

describe('applyResidentialDemoSanity — Komendantsky-like residential block', () => {
  // Address: Комендантский проспект, 23к1 / lat 60.014315 lon 30.253552
  const ingosstrah = magnet({
    categoryId: 'business',
    name: 'Ингосстрах',
    distance: 250,
    subType: 'office',
    weight: 4,
  });
  const kindergarten1 = magnet({ categoryId: 'education_local', name: 'Детский сад №42', distance: 180 });
  const kindergarten2 = magnet({ categoryId: 'education_local', name: 'Детский сад №77', distance: 320 });
  const supermarket = magnet({ categoryId: 'shopping_local', name: 'Пятёрочка', distance: 220 });

  it('caps inflated headline ≤ 70 and removes "Сильная" verdict', () => {
    const analysis = fixture({
      evergreenIndex: 95,
      magnets: [ingosstrah, kindergarten1, kindergarten2, supermarket],
      primaryAudience: 'BUSINESS',
      audienceFitScore: 28,
      audienceSharePct: 70,
    });

    const sanity = applyResidentialDemoSanity(analysis);

    expect(sanity.displayScore).toBeLessThanOrEqual(70);
    expect(sanity.verdictLabelRu).not.toContain('Сильная');
    expect(sanity.displayAudience).not.toBe('BUSINESS');
    expect(sanity.audienceLabelRu).not.toBe('Деловой');
    expect(sanity.capApplied).toBe(true);
    expect(sanity.capReasonsRu.join(' ')).toContain('Нет сильных магнитов спроса в радиусе 1 км');
    expect(sanity.tier1Count).toBe(0);
  });

  it('also caps to ≤ 65 when only office/insurance branch exists', () => {
    const analysis = fixture({
      evergreenIndex: 88,
      magnets: [ingosstrah, supermarket],
      primaryAudience: 'BUSINESS',
      audienceFitScore: 25,
      audienceSharePct: 80,
    });

    const sanity = applyResidentialDemoSanity(analysis);

    expect(sanity.displayScore).toBeLessThanOrEqual(65);
    expect(sanity.displayAudience).toBe('RESIDENTIAL');
  });
});

describe('applyResidentialDemoSanity — Komendantsky 23к1 weak-office cluster', () => {
  // Real coords: lat 60.014315, lon 30.253552
  it('caps score <= 70 and downgrades BUSINESS when weak office cluster + metro is present', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'business', name: 'Ингосстрах', distance: 250, subType: 'office', weight: 4 }),
      magnet({ categoryId: 'business', name: 'Ренессанс страхование', distance: 310, subType: 'office', weight: 4 }),
      magnet({ categoryId: 'business', name: 'Слетать.ру', distance: 280, subType: 'travel_agency', weight: 3 }),
      magnet({ categoryId: 'business', name: 'Сбербанк', distance: 410, subType: 'bank', weight: 3 }),
      magnet({
        categoryId: 'metro',
        name: 'Комендантский проспект',
        distance: 850,
        weight: 9,
        strengthClass: 'strong',
      }),
      magnet({ categoryId: 'education_local', name: 'Школа №555', distance: 200 }),
      magnet({ categoryId: 'education_local', name: 'Детский сад №42', distance: 180 }),
    ];

    const analysis = fixture({
      evergreenIndex: 99,
      magnets,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 62,
      audienceSharePct: 70,
    });
    analysis.audienceAnalysis!.businessClusterDetected = true;

    const sanity = applyResidentialDemoSanity(analysis);

    expect(sanity.displayScore).toBeLessThanOrEqual(70);
    expect(sanity.displayAudience).not.toBe('BUSINESS');
    expect(sanity.verdictLabelRu).not.toContain('Сильная');
    expect(sanity.verdictLabelRu).not.toBe('Сильная локация для командированных');
    expect(getBand(sanity.displayScore)).not.toBe('strong');
    expect(sanity.capReasonsRu.join(' ')).toContain(
      'Рядом есть локальные офисные точки, но сильный деловой магнит не подтверждён.',
    );
  });
});

describe('applyResidentialDemoSanity — real strong location', () => {
  it('preserves headline when ≥2 tier-1 magnets are present', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'metro', name: 'Невский проспект', distance: 350, weight: 9, strengthClass: 'strong' }),
      magnet({ categoryId: 'metro', name: 'Гостиный двор', distance: 600, weight: 9, strengthClass: 'strong' }),
      magnet({ categoryId: 'hospital', name: 'Городская больница №3', distance: 800, weight: 7, strengthClass: 'strong' }),
      magnet({
        categoryId: 'business',
        name: 'Бизнес-центр Сенатор',
        distance: 450,
        subType: 'office',
        weight: 6,
        strengthClass: 'strong',
      }),
    ];
    const analysis = fixture({
      evergreenIndex: 92,
      magnets,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 75,
      audienceSharePct: 65,
    });

    const sanity = applyResidentialDemoSanity(analysis);

    expect(sanity.displayScore).toBe(92);
    expect(sanity.tier1Count).toBeGreaterThanOrEqual(2);
    expect(sanity.capApplied).toBe(false);
    expect(sanity.displayAudience).toBe('BUSINESS');
    expect(sanity.verdictLabelRu).toContain('Сильная');
  });
});

describe('applyResidentialDemoSanity — single tier-1 hospital', () => {
  it('caps strong band > 80 to 80 with one tier-1 magnet', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'hospital', name: 'Поликлиника №112', distance: 700, weight: 7, strengthClass: 'strong' }),
    ];
    const analysis = fixture({
      evergreenIndex: 86,
      magnets,
      primaryAudience: 'TOURIST',
      audienceFitScore: 40,
      audienceSharePct: 35,
    });

    const sanity = applyResidentialDemoSanity(analysis);

    expect(sanity.displayScore).toBeLessThanOrEqual(80);
    expect(sanity.tier1Count).toBe(1);
    expect(sanity.verdictLabelRu).not.toContain('Сильная');
  });
});
