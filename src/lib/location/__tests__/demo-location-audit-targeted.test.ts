import { describe, expect, it } from 'vitest';
import type { AudienceAnalysis, LocationAnalysis, LocationScoreOutput, MagnetItem } from '../types';
import { emptyFootTrafficSummary } from '../foot-traffic';
import { normalizeRuDemoExplanationLines, gateRuDemoPublicPhrase } from '../demo-public-copy';
import {
  applyDemoFreeHeadlineCaps,
  buildDemoPublicEvidenceFlags,
  hasStrongConfirmedDemoAnchor,
} from '../demo-free-evidence';
import { buildDemoLocationDiagnosticsSnapshot } from '../demo-location-debug';

function minimalAnalysis(partial: Partial<LocationAnalysis>): LocationAnalysis {
  const baseScore: LocationScoreOutput = {
    location_score: 50,
    rating: 'viable',
    breakdown: {
      demand_score: 50,
      supply_score: 50,
      magnet_score: 50,
      seasonality_score: 50,
      audience_fit_score: 50,
      accessibility_score: 50,
    },
    estimated_monthly_income: { short_term: 1, mid_term: 1, hybrid: 1 },
    income_model: { base_adr_rub: 3000, base_occupancy_pct: 50 },
    top_positive_factors: [],
    top_negative_factors: [],
    recommended_strategy: 'hybrid',
  };

  const defaultGravity = {
    dominantMagnets: [] as string[],
    strongestZoneLabel: '',
    competitorPressureLevel: 'medium' as const,
    demandDistribution: 'weak' as const,
    demandType: 'mixed' as const,
    clusterDetected: false,
    clusterSize: 0,
    scoreBreakdown: {
      attraction: 10,
      competitorPressure: 10,
      clusterBonus: 0,
      trafficBoost: 0,
    },
  };

  return {
    evergreenIndex: partial.evergreenIndex ?? 50,
    scoreBand: 'medium',
    magnets: partial.magnets ?? [],
    magnetCountByCategory: partial.magnetCountByCategory ?? {},
    accessibilityStops: partial.accessibilityStops ?? [],
    competitors: partial.competitors ?? [],
    gravityExplanation: partial.gravityExplanation ?? defaultGravity,
    demandType: partial.demandType ?? 'mixed',
    strongestMagnets: partial.strongestMagnets ?? [],
    clusterZones: partial.clusterZones ?? [],
    splitDemand: false,
    competitorPressure: partial.competitorPressure ?? 20,
    footTraffic: {
      ...emptyFootTrafficSummary(),
      stability01: 0.5,
      modifierTier: 'moderate',
      transitVsTarget: { transitShare: 0.3, localActiveShare: 0.4, destinationShare: 0.3 },
      ...partial.footTraffic,
    },
    audienceAnalysis:
      partial.audienceAnalysis ??
      ({
        primaryAudience: 'TOURIST',
        locationType: 'MIXED',
        audienceFitScore: 50,
        demandFlowLabel: 'туристический поток',
        primaryDriverLabel: 'Тестовый драйвер',
        primaryMagnets: [],
        fallbackMode: false,
        audienceSharePct: 50,
        businessClusterDetected: false,
        lockedMode: false,
      } as AudienceAnalysis),
    neighborhoodEnvironment: partial.neighborhoodEnvironment ?? {
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
        majorRoads01: 0,
        industrial01: 0,
        aviation01: 0,
        nightlife01: 0,
        transitCorridor01: 0,
        harshUrbanStack01: 0,
      },
    },
    heatmapPoints: [],
    conclusion: '',
    locationScore: partial.locationScore ?? baseScore,
    strategicTransportHubMagnets: partial.strategicTransportHubMagnets ?? [],
    magnetDiagnostics: partial.magnetDiagnostics,
  };
}

const hubMagnet = (dist: number, band: MagnetItem['strategicReachBand']): MagnetItem => ({
  categoryId: 'strategicTransportHub',
  categoryLabel: 'Hub',
  icon: 'T',
  name: 'Test Hub',
  subType: 'railway_station',
  lat: 0,
  lon: 0,
  distance: dist,
  weight: 2,
  permanenceType: 'permanent',
  scopeLevel: 'city',
  strengthClass: 'medium',
  strategicReachBand: band,
  attractionScore: 4,
});

describe('demo / free location audit (targeted)', () => {
  it('Parkhomenko-style output does not surface «крупный транспортный узел» without evidence', () => {
    const analysis = minimalAnalysis({ magnets: [], strategicTransportHubMagnets: [] });
    analysis.locationScore!.top_positive_factors = ['Крупный транспортный узел в транспортной доступности.'];

    const out = normalizeRuDemoExplanationLines([...analysis.locationScore!.top_positive_factors], {
      max: 5,
      analysis,
    });
    expect(out.join(' ')).not.toMatch(/крупный транспортный узел/i);
  });

  it('generic transport phrases require evidence', () => {
    const flagsOff = buildDemoPublicEvidenceFlags(minimalAnalysis({ magnets: [] }));
    expect(
      gateRuDemoPublicPhrase(
        'Крупный транспортный узел рядом — транспортная доступность усиливает спрос.',
        flagsOff,
      ),
    ).toBe(false);
    expect(gateRuDemoPublicPhrase('Есть крупные транспортные узлы в зоне доступности.', flagsOff)).toBe(false);

    const flagsWithMetro = buildDemoPublicEvidenceFlags(
      minimalAnalysis({
        magnets: [
          {
            categoryId: 'metro',
            categoryLabel: 'M',
            icon: 'M',
            name: 'Metro X',
            lat: 0,
            lon: 0,
            distance: 400,
            weight: 5,
            permanenceType: 'permanent',
            scopeLevel: 'district',
            strengthClass: 'strong',
            attractionScore: 10,
          },
        ],
      }),
    );
    expect(gateRuDemoPublicPhrase('Есть крупные транспортные узлы в зоне доступности.', flagsWithMetro)).toBe(true);
  });

  it('duplicate semantic transport bullets are collapsed', () => {
    const diag = {
      bulletsKept: [] as string[],
      bulletsRemovedByEvidenceGate: [] as string[],
      bulletsCollapsedSemanticDup: [] as string[],
    };
    normalizeRuDemoExplanationLines(
      [
        'Транспортный объект в зоне доступности, около 5.0 км.',
        'Транспортный объект в зоне доступности, около 6.0 км.',
      ],
      { max: 5, analysis: minimalAnalysis({ magnets: [] }), diagnostics: diag },
    );
    expect(diag.bulletsCollapsedSemanticDup.length).toBeGreaterThanOrEqual(1);
  });

  it('score ≥90 for demo/free is capped without strong confirmed anchor', () => {
    const weak = minimalAnalysis({
      evergreenIndex: 93,
      magnets: [],
    });
    weak.locationScore!.location_score = 93;

    const cap = applyDemoFreeHeadlineCaps(weak);
    expect(cap.capApplied).toBe(true);
    expect(cap.evergreenDisplay).toBeLessThanOrEqual(80);
    expect(hasStrongConfirmedDemoAnchor(weak)).toBe(false);
  });

  it('score ≥90 not capped when metro anchor passes diagnostics', () => {
    const strong = minimalAnalysis({
      evergreenIndex: 93,
      magnets: [
        {
          categoryId: 'metro',
          categoryLabel: 'M',
          icon: 'M',
          name: 'Метро Тест',
          lat: 0,
          lon: 0,
          distance: 700,
          weight: 6,
          permanenceType: 'permanent',
          scopeLevel: 'district',
          strengthClass: 'strong',
          attractionScore: 12,
        },
      ],
      magnetDiagnostics: {
        queriedCandidates: [],
        classifiedCandidates: [],
        surfacedMagnets: [
          {
            name: 'Метро Тест',
            distanceM: 700,
            classifiedCategoryId: 'metro',
          },
        ],
        suppressedMagnets: [],
      },
    });
    strong.locationScore!.location_score = 93;
    expect(hasStrongConfirmedDemoAnchor(strong)).toBe(true);
    expect(applyDemoFreeHeadlineCaps(strong).capApplied).toBe(false);
  });

  it('debug snapshot lists removals from evidence gate', () => {
    const scoreTemplate = minimalAnalysis({}).locationScore!;
    const a = minimalAnalysis({
      evergreenIndex: 70,
      locationScore: {
        ...scoreTemplate,
        top_positive_factors: ['Сильные сигналы спроса в зоне.'],
        breakdown: {
          ...scoreTemplate.breakdown,
          demand_score: 72,
        },
      },
      gravityExplanation: {
        dominantMagnets: [],
        strongestZoneLabel: '',
        competitorPressureLevel: 'medium',
        demandDistribution: 'weak',
        demandType: 'mixed',
        clusterDetected: false,
        clusterSize: 0,
        scoreBreakdown: {
          attraction: 20,
          competitorPressure: 10,
          clusterBonus: 0,
          trafficBoost: 0,
        },
      },
      magnets: Array.from({ length: 3 }).map((_, i) => ({
        categoryId: 'food',
        categoryLabel: 'F',
        icon: 'f',
        name: `Food ${i}`,
        lat: 0,
        lon: 0,
        distance: 200 + i * 50,
        weight: 1,
        permanenceType: 'temporary' as const,
        scopeLevel: 'local',
        strengthClass: 'weak' as const,
        attractionScore: 1,
      })),
    });

    const snap = buildDemoLocationDiagnosticsSnapshot({
      address: 'test',
      geocode: { lat: 1, lon: 2, displayName: 'x', geocodeDebug: { winnerTypes: ['street_address'] } },
      analysis: a,
    });
    expect(snap.rawPositiveFactors.join()).toContain('Сильные сигналы спроса');
    expect(snap.bulletsRemovedByEvidenceGate.length).toBeGreaterThanOrEqual(1);
  });

  it('normalize prefers evidence-backed strategic line over vague hub copy', () => {
    const analysis = minimalAnalysis({
      magnets: [hubMagnet(5200, 'strategic')],
      strategicTransportHubMagnets: [hubMagnet(5200, 'strategic')],
    });
    const out = normalizeRuDemoExplanationLines(['Ключевой транспортный якорь (ж/д).'], {
      max: 4,
      analysis,
    });
    expect(out.some(x => /Транспортный объект в зоне доступности, около/i.test(x))).toBe(true);
  });
});
