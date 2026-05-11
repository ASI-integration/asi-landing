import { describe, expect, it } from 'vitest';
import bundle from '../__fixtures__/golden-addresses.json';
import type { MagnetItem, OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { enrichAnalysisWithReportProjection } from '../location-scoring-projection';
import { buildLocationDecision } from '../location-decision-kernel';
import { magnetItemToMagnetFact } from '../location-decision-rules';
import { runLocationDemandScoringKernel } from '../location-scoring-kernel';

describe('small-city municipal hospital scale coerce', () => {
  it('forces weak_local scale so hospitals are not tier-1 public drivers', () => {
    const magnets: MagnetItem[] = [
      {
        categoryId: 'hospital',
        categoryLabel: 'H',
        icon: '+',
        name: 'Городская клиническая больница',
        lat: 0,
        lon: 0,
        distance: 1100,
        weight: 7,
        permanenceType: 'permanent',
        scopeLevel: 'city',
        strengthClass: 'strong',
        attractionScore: 4,
      },
    ];
    const magnetFacts = [magnetItemToMagnetFact(magnets[0]!, 0, magnets)];
    const out = runLocationDemandScoringKernel({
      magnets,
      magnetFacts,
      engineFinalScore: 70,
      cityScaleInference: {
        cityScale: 'small_city',
        populationTier: '30k-100k',
        marketGravityCoefficient: 0.7,
        specialMarketFlags: [],
        populationApprox: 30_000,
        inferredFrom: 'unit_test',
      },
    });
    const h = out.scoredDrivers[0];
    expect(h?.resolvedTier).not.toBe(1);
    expect(h?.scaleClass).toBe('weak_local');
    expect(h?.publicDisplayEligible).toBe(false);
  });

  it('golden lodeynoye replay: hospital magnets should not become tier-1 public drivers', () => {
    const c = bundle.cases.find((x: { id: string }) => x.id === 'lodeynoye_sparse')!;
    const { lat, lon, elements } = c.replay;
    const els = elements as unknown as OSMElement[];
    const analysis = buildAnalysis(els, lat, lon, {
      spatialFoundation: false,
      inputAddress: c.addressRu,
    });
    for (const m of analysis.magnets.filter(
      x => x.categoryId === 'hospital' || x.categoryId === 'specializedMedicalAnchor',
    )) {
      expect(m.name.length).toBeGreaterThan(3);
    }
    const projected = enrichAnalysisWithReportProjection(analysis, {
      reportMode: 'free',
      rawElements: els,
    });
    const trace = projected.scoringTrace!;
    const d = buildLocationDecision({
      analysis: projected,
      inputAddress: c.addressRu,
      coordinates: trace.coordinates!,
      rawElements: els,
      selectedGeocodeResult: c.addressRu,
      locale: 'ru',
    });
    const bad = d.demandKernelV1?.scoredDrivers.filter(
      x => x.demandTypeVote === 'medical' && x.resolvedTier === 1 && x.publicDisplayEligible,
    );
    expect(bad?.length ?? 0).toBe(0);
  });
});
