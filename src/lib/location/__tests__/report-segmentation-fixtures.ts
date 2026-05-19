import type { LocationAnalysis, MagnetItem, NeighborhoodEnvironmentLayer } from '../types';

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

export function strongFlowAnalysis(): LocationAnalysis {
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
