import { describe, expect, it } from 'vitest';
import type { LocationAnalysis, MagnetItem, NeighborhoodEnvironmentLayer } from '../types';
import { buildCommercialFormatFit } from '../commercial-format-fit';
import {
  computeFrontageAccessibilityScore,
  evaluateStreetRetailSuitability,
  MANUAL_CHECK_FLOOR_AND_FRONTAGE_RU,
  MANUAL_CHECK_FRONTAGE_RU,
  parseRetailPremisesFromObjectContext,
} from '../street-retail-suitability';

const envStub: NeighborhoodEnvironmentLayer = {
  environmentalFrictionScore: 20,
  concernLevel: 'low',
  concernLabelEn: 'low',
  concernLabelRu: 'низкий',
  reasonsEn: [],
  reasonsRu: [],
  environmentNarrativeEn: '',
  environmentNarrativeRu: '',
  confidence: 'high',
  breakdown: {
    industrial01: 0.1,
    transitCorridor01: 0.1,
    majorRoads01: 0.1,
    nightlife01: 0,
    aviation01: 0,
    harshUrbanStack01: 0,
  },
};

function magnet(partial: Partial<MagnetItem> & Pick<MagnetItem, 'categoryId'>): MagnetItem {
  const categoryId = partial.categoryId;
  return {
    categoryLabel: partial.categoryLabel ?? categoryId,
    name: partial.name ?? 'Anchor',
    icon: partial.icon ?? '•',
    distance: partial.distance ?? 200,
    lat: partial.lat ?? 55.75,
    lon: partial.lon ?? 37.61,
    weight: partial.weight ?? 5,
    strengthClass: partial.strengthClass ?? 'medium',
    permanenceType: partial.permanenceType ?? 'permanent',
    attractionScore: partial.attractionScore ?? 12,
    scopeLevel: partial.scopeLevel ?? 'local',
    ...partial,
    categoryId,
  };
}

function strongFlowAnalysis(): LocationAnalysis {
  return {
    evergreenIndex: 72,
    scoreBand: 'strong',
    magnets: [magnet({ categoryId: 'shopping_major', name: 'ТЦ' })],
    magnetCountByCategory: {},
    accessibilityStops: [],
    competitors: [],
    gravityExplanation: {
      dominantMagnets: [],
      strongestZoneLabel: '',
      competitorPressureLevel: 'medium',
      demandDistribution: 'concentrated',
      demandType: 'tourism-led',
      clusterDetected: true,
      clusterSize: 4,
      scoreBreakdown: { attraction: 40, competitorPressure: 5, clusterBonus: 8, trafficBoost: 6 },
    },
    demandType: 'tourism-led',
    strongestMagnets: [],
    clusterZones: [],
    splitDemand: false,
    competitorPressure: 5,
    footTraffic: {
      modifierTier: 'strong',
      boostPoints: 8,
      movementDensity: 'high',
      zoneActivity: 'busy',
      flowStability: 'stable',
      flowCharacter: 'destination-led footfall',
      transitVsTarget: { transitShare: 0.2, localActiveShare: 0.25, destinationShare: 0.55 },
      stability01: 0.7,
      concentration01: 0.6,
    },
    audienceAnalysis: {
      primaryAudience: 'TOURIST',
      locationType: 'MIXED',
      audienceFitScore: 70,
      primaryMagnets: [],
      fallbackMode: false,
      audienceSharePct: 60,
      businessClusterDetected: false,
      primaryDriverLabel: '',
      lockedMode: false,
      demandFlowLabel: '',
    },
    neighborhoodEnvironment: envStub,
    heatmapPoints: [],
    conclusion: '',
  };
}

const confirmedStreetPremises = {
  floor: 1,
  firstLine: true,
  directStreetEntrance: true,
  signVisibility: 'good',
  pedestrianFlowBarrierFree: true,
  parkingOrTransitProximity: true,
};

describe('street-retail suitability gates', () => {
  it('non-first-line cannot get high retail fit solely from strong area flow', () => {
    const fit = buildCommercialFormatFit(strongFlowAnalysis(), {
      objectContext: { firstLine: false, floor: 1, directStreetEntrance: true },
    });
    const retail = fit.entries.find(e => e.format === 'retail');
    expect(retail?.fitLevel).not.toBe('high');
    expect(retail?.limitingFactorsRu.some(l => /первая линия/i.test(l))).toBe(true);
    expect(fit.streetRetailSuitability?.strongStreetRetailAllowed).toBe(false);
  });

  it('missing frontage data adds manual-check warning', () => {
    const suit = evaluateStreetRetailSuitability(strongFlowAnalysis(), { floor: 1 });
    expect(suit.manualCheckWarningsRu).toContain(MANUAL_CHECK_FRONTAGE_RU);
    const fit = buildCommercialFormatFit(strongFlowAnalysis(), { objectContext: { floor: 1 } });
    const retail = fit.entries.find(e => e.format === 'retail');
    expect(retail?.fitLevel).not.toBe('high');
    expect(retail?.limitingFactorsRu).toEqual(
      expect.arrayContaining([MANUAL_CHECK_FRONTAGE_RU]),
    );
  });

  it('basement cannot get high retail fit from strong area flow alone', () => {
    const fit = buildCommercialFormatFit(strongFlowAnalysis(), {
      objectContext: { floorLevel: 'подвал', firstLine: true, directStreetEntrance: true },
    });
    const retail = fit.entries.find(e => e.format === 'retail');
    expect(retail?.fitLevel).not.toBe('high');
    expect(fit.streetRetailSuitability?.floorClass).toBe('below_street');
  });

  it('unknown floor adds floor manual-check warning', () => {
    const suit = evaluateStreetRetailSuitability(strongFlowAnalysis(), {});
    expect(suit.manualCheckWarningsRu).toContain(MANUAL_CHECK_FLOOR_AND_FRONTAGE_RU);
  });

  it('confirmed street-level / first floor with frontage can reach high retail fit', () => {
    const fit = buildCommercialFormatFit(strongFlowAnalysis(), {
      objectContext: confirmedStreetPremises,
    });
    const retail = fit.entries.find(e => e.format === 'retail');
    expect(retail?.fitLevel).toBe('high');
    expect(fit.streetRetailSuitability?.strongStreetRetailAllowed).toBe(true);
  });

  it('no-step entrance improves frontage score only when explicitly known', () => {
    const base = parseRetailPremisesFromObjectContext({
      ...confirmedStreetPremises,
      accessibleEntranceNoSteps: 'unknown',
    });
    const withSteps = parseRetailPremisesFromObjectContext({
      ...confirmedStreetPremises,
      accessibleEntranceNoSteps: false,
    });
    const noSteps = parseRetailPremisesFromObjectContext({
      ...confirmedStreetPremises,
      accessibleEntranceNoSteps: true,
    });

    const scoreBase = computeFrontageAccessibilityScore(base)!;
    const scoreFalse = computeFrontageAccessibilityScore(withSteps)!;
    const scoreNoSteps = computeFrontageAccessibilityScore(noSteps)!;

    expect(scoreFalse).toBe(scoreBase);
    expect(scoreNoSteps).toBeGreaterThan(scoreBase);
  });

  it('semi-basement / цоколь is capped below strong street-retail', () => {
    for (const floorLevel of ['полуподвал', 'цоколь', 'semi-basement']) {
      const fit = buildCommercialFormatFit(strongFlowAnalysis(), {
        objectContext: { floorLevel, firstLine: true, directStreetEntrance: true },
      });
      expect(fit.entries.find(e => e.format === 'retail')?.fitLevel).not.toBe('high');
    }
  });
});
