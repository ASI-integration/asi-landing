import { describe, it, expect } from 'vitest';
import { buildResidentialAnalysis } from '../residential-analysis';
import type {
  LocationAnalysis,
  NeighborhoodEnvironmentLayer,
  MagnetItem,
  ScoreBand,
} from '../types';

const mockMagnet: MagnetItem = {
  categoryId: 'mock',
  categoryLabel: 'mock',
  icon: '•',
  name: 'mock',
  lat: 0,
  lon: 0,
  distance: 300,
  weight: 5,
  permanenceType: 'permanent',
  scopeLevel: 'local',
  strengthClass: 'medium',
  attractionScore: 5,
};

function analysisFixture(p: {
  locationScore: number;
  demandScore: number;
  seasonalityScore: number;
  audienceFitScore: number;
  evergreenIndex: number;
  stability01: number;
  magnetCount: number;
  isFallbackMode: boolean;
  competitorPressureLevel: 'low' | 'medium' | 'high';
  env: NeighborhoodEnvironmentLayer;
}): LocationAnalysis {
  const {
    locationScore,
    demandScore,
    seasonalityScore,
    audienceFitScore,
    evergreenIndex,
    stability01,
    magnetCount,
    isFallbackMode,
    competitorPressureLevel,
    env,
  } = p;

  return {
    evergreenIndex,
    scoreBand: 'medium' as ScoreBand,
    locationScore: {
      location_score: locationScore,
      rating: 'viable',
      breakdown: {
        demand_score: demandScore,
        supply_score: 50,
        magnet_score: 50,
        seasonality_score: seasonalityScore,
        audience_fit_score: audienceFitScore,
        accessibility_score: 50,
      },
      estimated_monthly_income: { short_term: 0, mid_term: 0, hybrid: 0 },
      income_model: { base_adr_rub: 0, base_occupancy_pct: 0 },
      top_positive_factors: [],
      top_negative_factors: [],
      recommended_strategy: 'hybrid',
    },
    magnets: Array.from({ length: magnetCount }, () => ({ ...mockMagnet })),
    magnetCountByCategory: {},
    accessibilityStops: [],
    competitors: [],
    gravityExplanation: {
      dominantMagnets: [],
      strongestZoneLabel: '',
      competitorPressureLevel,
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
      stability01,
      concentration01: 0.5,
    },
    audienceAnalysis: {
      primaryAudience: 'BUSINESS',
      locationType: 'MIXED',
      audienceFitScore,
      primaryMagnets: [],
      fallbackMode: isFallbackMode,
      audienceSharePct: 50,
      businessClusterDetected: false,
      primaryDriverLabel: '',
      lockedMode: false,
      demandFlowLabel: '',
    },
    neighborhoodEnvironment: env,
    heatmapPoints: [],
    conclusion: '',
  };
}

describe('residential pass-4 edge hardening', () => {
  it('uses inclusive classic STR demand floor (72), avoiding a dead zone vs seasonal lift', () => {
    const env: NeighborhoodEnvironmentLayer = {
      environmentalFrictionScore: 28,
      concernLevel: 'moderate',
      concernLabelEn: 'moderate',
      concernLabelRu: 'moderate',
      reasonsEn: [],
      reasonsRu: [],
      environmentNarrativeEn: '',
      environmentNarrativeRu: '',
      confidence: 'high',
      breakdown: {
        majorRoads01: 0.48,
        industrial01: 0.15,
        aviation01: 0.06,
        nightlife01: 0.26,
        transitCorridor01: 0.32,
        harshUrbanStack01: 0.36,
      },
    };
    const out = buildResidentialAnalysis(
      analysisFixture({
        locationScore: 68,
        demandScore: 72,
        seasonalityScore: 75,
        audienceFitScore: 55,
        evergreenIndex: 65,
        stability01: 0.55,
        magnetCount: 7,
        isFallbackMode: false,
        competitorPressureLevel: 'medium',
        env,
      }),
    );
    expect(out.residentialStrategy).toBe('short_term');
    expect(out.residentialAudienceType).toBe('mixed_use_adjacent');
  });

  it('does not apply seasonal STR lift when location and evergreen are structurally weak', () => {
    const env: NeighborhoodEnvironmentLayer = {
      environmentalFrictionScore: 18,
      concernLevel: 'low',
      concernLabelEn: 'low',
      concernLabelRu: 'low',
      reasonsEn: [],
      reasonsRu: [],
      environmentNarrativeEn: '',
      environmentNarrativeRu: '',
      confidence: 'high',
      breakdown: {
        majorRoads01: 0.22,
        industrial01: 0.06,
        aviation01: 0.04,
        nightlife01: 0.12,
        transitCorridor01: 0.12,
        harshUrbanStack01: 0.14,
      },
    };
    const out = buildResidentialAnalysis(
      analysisFixture({
        locationScore: 42,
        demandScore: 69,
        seasonalityScore: 94,
        audienceFitScore: 35,
        evergreenIndex: 40,
        stability01: 0.36,
        magnetCount: 4,
        isFallbackMode: false,
        competitorPressureLevel: 'low',
        env,
      }),
    );
    expect(out.residentialStrategy).toBe('hybrid');
    expect(out.residentialAudienceType).toBe('standard_residential');
  });

  it('keeps resort seasonal short_term when structure clears pass-4 floors (R27 regression)', () => {
    const env: NeighborhoodEnvironmentLayer = {
      environmentalFrictionScore: 18,
      concernLevel: 'low',
      concernLabelEn: 'low',
      concernLabelRu: 'low',
      reasonsEn: [],
      reasonsRu: [],
      environmentNarrativeEn: '',
      environmentNarrativeRu: '',
      confidence: 'high',
      breakdown: {
        majorRoads01: 0.2,
        industrial01: 0.08,
        aviation01: 0.06,
        nightlife01: 0.25,
        transitCorridor01: 0.15,
        harshUrbanStack01: 0.2,
      },
    };
    const out = buildResidentialAnalysis(
      analysisFixture({
        locationScore: 65,
        demandScore: 70,
        seasonalityScore: 92,
        audienceFitScore: 65,
        evergreenIndex: 65,
        stability01: 0.38,
        magnetCount: 6,
        isFallbackMode: false,
        competitorPressureLevel: 'medium',
        env,
      }),
    );
    expect(out.residentialStrategy).toBe('short_term');
    expect(out.operationalSuitability).toBe('semi_auto');
  });
});
