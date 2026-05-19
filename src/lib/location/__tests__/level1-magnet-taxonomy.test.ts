import { describe, expect, it } from 'vitest';
import type { MagnetItem } from '../types';
import {
  LEVEL1_MAGNET_RULES_RU,
  LEVEL1_MAGNET_TAXONOMY,
  classifyLevel1Magnet,
  dedupeCanonicalMagnets,
  estimateCanonicalLocationWeight,
  isBackgroundMinorPoi,
} from '../level1-magnet-taxonomy';
import { filterResidentialPrimeMagnets } from '../residential-prime-magnets';
import { buildAudienceAnalysis } from '../audience-scoring';
import { generateConclusion } from '../explanation';

function magnet(p: Partial<MagnetItem> & Pick<MagnetItem, 'categoryId' | 'name' | 'distance'>): MagnetItem {
  return {
    categoryLabel: p.categoryId,
    icon: '*',
    lat: 0,
    lon: 0,
    weight: p.weight ?? 5,
    permanenceType: p.permanenceType ?? 'permanent',
    scopeLevel: p.scopeLevel ?? 'city',
    strengthClass: p.strengthClass ?? 'medium',
    attractionScore: p.attractionScore ?? 4,
    ...p,
  };
}

function gravityStub() {
  return {
    dominantMagnets: [],
    strongestZoneLabel: '',
    competitorPressureLevel: 'low' as const,
    demandDistribution: 'weak' as const,
    demandType: 'mixed' as const,
    clusterDetected: false,
    clusterSize: 0,
    scoreBreakdown: { attraction: 0, competitorPressure: 0, clusterBonus: 0, trafficBoost: 0 },
  };
}

describe('canonical Level-1 magnet taxonomy', () => {
  it('contains all required Level-1 groups and representative entity types', () => {
    expect(LEVEL1_MAGNET_TAXONOMY.map(group => group.id)).toEqual([
      'transport_logistics',
      'medicine',
      'business_administration',
      'industry',
      'education_science',
      'retail_mixed_use',
      'tourism_events',
    ]);

    const allTypes = LEVEL1_MAGNET_TAXONOMY.flatMap(group => group.entityTypes);
    expect(allTypes).toEqual(expect.arrayContaining([
      'international_airport',
      'seaport',
      'bus_hub',
      'oncology_center',
      'major_business_center',
      'industrial_park',
      'major_university',
      'large_shopping_mall',
      'stadium',
      'major_cultural_institution',
    ]));
  });

  it('uses explicit fallback reasons when taxonomy scale is not confirmed', () => {
    expect(classifyLevel1Magnet(magnet({
      categoryId: 'business',
      name: 'Офис на первом этаже',
      distance: 400,
    }))).toMatchObject({
      isLevel1: false,
      reason: 'business_scale_not_confirmed',
    });
    expect(classifyLevel1Magnet(magnet({
      categoryId: 'shopping_major',
      name: 'Продуктовый магазин',
      distance: 300,
    }))).toMatchObject({
      isLevel1: false,
      reason: 'retail_scale_not_confirmed',
    });
    expect(classifyLevel1Magnet(magnet({
      categoryId: 'attraction',
      name: 'Памятник архитектуры',
      distance: 500,
    }))).toMatchObject({
      isLevel1: false,
      reason: 'tourist_scale_not_confirmed',
    });
  });

  it('keeps minor POIs as background environment, not prime magnets', () => {
    const minor = [
      magnet({ categoryId: 'food', name: 'Кафе у дома', distance: 90 }),
      magnet({ categoryId: 'shopping_local', name: 'Магазин у дома', distance: 120 }),
      magnet({ categoryId: 'hospital', name: 'Аптека', distance: 150 }),
    ];

    expect(minor.every(isBackgroundMinorPoi)).toBe(true);
    expect(minor.map(m => classifyLevel1Magnet(m).isLevel1)).toEqual([false, false, false]);
    expect(filterResidentialPrimeMagnets(minor)).toEqual([]);
    expect(LEVEL1_MAGNET_RULES_RU.join(' ')).toContain('Мелкие POI');
  });

  it('promotes airport, rail hub, bus hub, industrial cluster, and major medical center as Level-1 anchors', () => {
    expect(classifyLevel1Magnet(magnet({ categoryId: 'airport', name: 'Пулково', distance: 1400 })).groupId).toBe('transport_logistics');
    expect(classifyLevel1Magnet(magnet({ categoryId: 'railway_station', name: 'Московский вокзал', distance: 700 })).entityType).toBe('major_railway_station');
    expect(classifyLevel1Magnet(magnet({
      categoryId: 'strategicTransportHub',
      name: 'Автовокзал',
      distance: 2600,
      subType: 'bus_station',
    })).entityType).toBe('bus_hub');
    expect(classifyLevel1Magnet(magnet({
      categoryId: 'business',
      name: 'Индустриальный парк Северный',
      distance: 900,
      subType: 'industrial',
    })).groupId).toBe('industry');
    expect(classifyLevel1Magnet(magnet({
      categoryId: 'hospital',
      name: 'Федеральный онкологический центр',
      distance: 800,
    })).entityType).toBe('oncology_center');
  });

  it('prioritizes a major seaport over minor POIs in explanation', () => {
    const magnets = [
      magnet({
        categoryId: 'strategicTransportHub',
        name: 'Порт Новороссийск',
        distance: 2800,
        subType: 'port',
        strategicReachBand: 'secondary',
        attractionScore: 3.8,
      }),
      magnet({ categoryId: 'food', name: 'Кафе', distance: 90, attractionScore: 1 }),
      magnet({ categoryId: 'shopping_local', name: 'Магазин у дома', distance: 130, attractionScore: 1 }),
    ];
    const conclusion = generateConclusion(70, magnets, [], { strategicTransportHub: 1, food: 1, shopping_local: 1 }, gravityStub(), 'ru', buildAudienceAnalysis(magnets));

    expect(classifyLevel1Magnet(magnets[0]).entityType).toBe('seaport');
    expect(conclusion).toContain('Порт Новороссийск');
    expect(conclusion).not.toContain('Кафе');
    expect(conclusion).not.toContain('Магазин у дома');
  });

  it('deduplicates same-name same-distance medical anchors before rendering', () => {
    const deduped = dedupeCanonicalMagnets([
      magnet({ categoryId: 'hospital', name: 'ГБУЗ Онкологический диспансер', distance: 420 }),
      magnet({ categoryId: 'hospital', name: 'Онкологический диспансер', distance: 440 }),
      magnet({ categoryId: 'hospital', name: 'Перинатальный центр', distance: 900 }),
    ]);

    expect(deduped.map(m => m.name)).toEqual([
      'ГБУЗ Онкологический диспансер',
      'Перинатальный центр',
    ]);
  });

  it('weights the same anchor differently by city size, uniqueness, access, and economic role without changing finalScore', () => {
    const port = magnet({
      categoryId: 'strategicTransportHub',
      name: 'Порт Новороссийск',
      distance: 2800,
      subType: 'port',
      weight: 5.5,
    });

    const moscow = estimateCanonicalLocationWeight({
      magnet: port,
      cityScale: 'metropolis',
      populationDensity: 'high',
      competingLevel1AnchorCount: 18,
      uniqueness: 'ordinary',
      transportAccessibility: 'moderate',
      localEconomicRole: 'district_forming',
    });
    const novorossiysk = estimateCanonicalLocationWeight({
      magnet: port,
      cityScale: 'medium_city',
      populationDensity: 'medium',
      competingLevel1AnchorCount: 1,
      uniqueness: 'unique_in_city',
      transportAccessibility: 'strong',
      localEconomicRole: 'city_forming',
    });

    expect(novorossiysk.score).toBeGreaterThan(moscow.score);
    expect(novorossiysk.level).toBe('regional');
    expect(novorossiysk.factors).toContain('city_forming_anchor');
  });
});
