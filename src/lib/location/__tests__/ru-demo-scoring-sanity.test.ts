import { describe, it, expect } from 'vitest';
import {
  applyResidentialDemoSanity,
  computeResidentialDemoPresentation,
} from '../residential-demo-sanity';
import type {
  LocationAnalysis,
  MagnetItem,
  NeighborhoodEnvironmentLayer,
  ScoreBand,
  TargetAudience,
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
  /** Composite headline when it differs from internal evergreen feature */
  compositeHeadline?: number;
  magnets: MagnetItem[];
  primaryAudience: TargetAudience;
  audienceFitScore: number;
  fallbackMode?: boolean;
  audienceSharePct?: number;
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
    scoringTrace: mkTrace(p.evergreenIndex, headline),
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
    const { cappedHeadline } = computeResidentialDemoPresentation(analysis, analysis.scoringTrace!.finalScore);

    expect(cappedHeadline).toBeLessThanOrEqual(70);
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
    const { cappedHeadline } = computeResidentialDemoPresentation(analysis, analysis.scoringTrace!.finalScore);

    expect(cappedHeadline).toBeLessThanOrEqual(65);
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
    const { cappedHeadline } = computeResidentialDemoPresentation(analysis, analysis.scoringTrace!.finalScore);

    expect(cappedHeadline).toBeLessThanOrEqual(80);
    expect(sanity.displayAudience).not.toBe('BUSINESS');
    expect(sanity.verdictLabelRu).not.toContain('Сильная');
    expect(sanity.verdictLabelRu).not.toBe('Сильная локация для командированных');
    expect(sanity.capApplied).toBe(true);
    expect(sanity.capReasonsRu.join(' ')).toContain(
      'Рядом есть локальные офисные точки, но сильный деловой магнит не подтверждён.',
    );
  });
});

describe('applyResidentialDemoSanity — Komendantsky production magnet list', () => {
  it('caps score <= 70, dedupes metro, demotes minor attraction, and blocks BUSINESS', () => {
    // Address: Комендантский проспект / production-like magnet set
    const magnets: MagnetItem[] = [
      // Metro station + entrances (must dedupe to 1 Tier-1 anchor)
      magnet({ categoryId: 'metro', name: 'Комендантский проспект', distance: 473, weight: 9, strengthClass: 'strong' }),
      magnet({ categoryId: 'metro', name: 'Вход 1', distance: 680, weight: 9, strengthClass: 'medium' }),
      magnet({ categoryId: 'metro', name: 'Вход 2', distance: 686, weight: 9, strengthClass: 'medium' }),

      // Minor tourist attraction (must NOT become Tier-1)
      magnet({ categoryId: 'attraction', name: 'Самолет - стрекоза', distance: 481, attractionScore: 2.1, strengthClass: 'weak' }),

      // Business offices — subType=office must be treated as weak unless name clearly indicates a real Tier-1 business magnet.
      magnet({ categoryId: 'business', name: 'Ингосстрах', distance: 3, subType: 'office', weight: 4 }),
      magnet({ categoryId: 'business', name: 'Ренессанс страхование', distance: 236, subType: 'office', weight: 4 }),
      magnet({ categoryId: 'business', name: 'Марио', distance: 282, subType: 'office', weight: 4 }),
      magnet({ categoryId: 'business', name: 'Ренессанс Страхование', distance: 412, subType: 'office', weight: 4 }),
      magnet({ categoryId: 'business', name: 'Слетать.ру', distance: 445, subType: 'office', weight: 3 }),

      // Shopping major nearby (should not by itself produce strong BUSINESS headline)
      magnet({ categoryId: 'shopping_major', name: 'Крокус', distance: 794, weight: 4, strengthClass: 'medium' }),
      magnet({ categoryId: 'shopping_major', name: 'Сабина', distance: 854, weight: 4, strengthClass: 'medium' }),

      // Local food/shop magnets (Tier-1 filter should ignore them)
      magnet({ categoryId: 'food', name: 'Локальное кафе', distance: 380 }),
      magnet({ categoryId: 'shopping_local', name: 'Локальный магазин', distance: 410 }),
    ];

    const analysis = fixture({
      evergreenIndex: 93,
      compositeHeadline: 99,
      magnets,
      primaryAudience: 'BUSINESS',
      audienceFitScore: 62,
      audienceSharePct: 70,
    });
    analysis.audienceAnalysis!.businessClusterDetected = true;

    const sanity = applyResidentialDemoSanity(analysis);
    const { cappedHeadline } = computeResidentialDemoPresentation(analysis, analysis.scoringTrace!.finalScore);

    expect(cappedHeadline).toBeLessThanOrEqual(70);
    expect(sanity.displayAudience).not.toBe('BUSINESS');
    expect(sanity.verdictLabelRu).not.toBe('Сильная локация для командированных');
    expect(sanity.capApplied).toBe(true);
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
    expect(
      sanity.tier1Magnets.some(m => m.categoryId === 'attraction' && m.name === 'Самолет - стрекоза'),
    ).toBe(false);

    // Generic offices must not become Tier-1 business magnets.
    expect(sanity.tier1Magnets.some(m => m.categoryId === 'business')).toBe(false);
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
    const { cappedHeadline } = computeResidentialDemoPresentation(analysis, analysis.scoringTrace!.finalScore);

    expect(cappedHeadline).toBe(92);
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
    const { cappedHeadline } = computeResidentialDemoPresentation(analysis, analysis.scoringTrace!.finalScore);

    expect(cappedHeadline).toBeLessThanOrEqual(80);
    expect(sanity.tier1Count).toBe(1);
    expect(sanity.verdictLabelRu).not.toContain('Сильная');
  });
});
