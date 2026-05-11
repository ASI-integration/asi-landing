import { describe, expect, it } from 'vitest';
import { buildAnalysis } from '../gravity-scoring';
import type { OSMElement } from '../types';
import type { LocationDecision } from '../location-decision-contract';
import {
  attachLocationDecisionToAnalysis,
  buildLocationDecision,
  ruResidentialLocationDecisionForDemo,
} from '../location-decision-kernel';
import { publicDemandProfileHeadline } from '../location-public-claims';
import { runLocationDemandScoringKernel } from '../location-scoring-kernel';
import { canonicalFactsFromMagnetsFallback, magnetItemToMagnetFact } from '../location-decision-rules';

const ORIGIN = { lat: 55.7522, lon: 37.6156 };

function node(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

describe('demand scoring kernel v1 regressions', () => {
  it('A: weak airport + rail context — airport not Tier 1 without scale proof; score blended down vs engine-only', () => {
    const els: OSMElement[] = [
      node(1, 0.018, 0.016, { aeroway: 'aerodrome', name: 'Аэропорт Малый Фикстура' }),
      node(2, 0.004, 0.003, { railway: 'halt', name: 'Остановочный пункт Юг' }),
      node(3, 0.003, 0.0035, { amenity: 'bus_station', name: 'Автостанция Центральная' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const traceScore = analysis.scoringTrace!.finalScore;
    const magnetFacts = analysis.magnets.map((m, idx) => magnetItemToMagnetFact(m, idx, analysis.magnets));
    const kernel = runLocationDemandScoringKernel({
      magnets: analysis.magnets,
      magnetFacts,
      canonicalFacts: canonicalFactsFromMagnetsFallback(analysis.magnets),
      engineFinalScore: traceScore,
    });
    const airport = kernel.scoredDrivers.find(d => d.sourceName.includes('Аэропорт'));
    expect(airport?.resolvedTier).not.toBe(1);
    expect(airport?.scaleClass === 'unknown' || airport?.driverKind === 'unknown_uncapped').toBe(true);
    expect(kernel.blendedPublicScore).toBeLessThanOrEqual(traceScore);
    expect(airport?.reason).toContain('transport_anchor_unknown_scale');
  });

  it('B: Saransk-style generic services + theatre + industrial — noise rejects; theatre local; score not driven by retail telecom', () => {
    const els: OSMElement[] = [
      node(1, 0.0011, 0.0012, { shop: 'convenience', name: 'СДЭК Фикстура' }),
      node(2, 0.0014, 0.0011, { office: 'yes', name: 'Салон Мегафон' }),
      node(3, 0.004, 0.0041, { amenity: 'theatre', name: 'Городской театр' }),
      node(4, 0.007, 0.0065, { landuse: 'industrial', name: 'Промзона Юг' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const magnetFacts = analysis.magnets.map((m, idx) => magnetItemToMagnetFact(m, idx, analysis.magnets));
    const kernel = runLocationDemandScoringKernel({
      magnets: analysis.magnets,
      magnetFacts,
      canonicalFacts: canonicalFactsFromMagnetsFallback(analysis.magnets),
      engineFinalScore: analysis.scoringTrace!.finalScore,
    });
    const sdek = kernel.scoredDrivers.find(d => d.sourceName.includes('СДЭК'));
    const meg = kernel.scoredDrivers.find(d => d.sourceName.includes('Мегафон'));
    expect(sdek?.driverKind).toBe('noise');
    expect(meg?.driverKind).toBe('noise');
    const theatre = kernel.scoredDrivers.find(d => d.sourceName.includes('театр'));
    expect(theatre?.driverKind).toBe('local_interest');

    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    expect(decision.publicClaims.every(c => !/СДЭК|Мегафон/i.test(c.textRu))).toBe(true);
    expect(decision.demandKernelV1?.dominantDemandType).not.toBe('tourist');
  });

  it('C: Novosibirsk-style medical cluster + hotel + weak attraction + BC office — medical/mixed, not tourist', () => {
    const els: OSMElement[] = [
      node(1, 0.003, 0.0028, {
        amenity: 'hospital',
        name: 'Областная клиническая больница Фикстура',
      }),
      node(2, 0.0035, 0.003, {
        amenity: 'hospital',
        name: 'Городская больница № 40',
      }),
      node(3, 0.002, 0.0025, { tourism: 'hotel', name: 'Отель Командированные', stars: '4' }),
      node(4, 0.004, 0.0042, { tourism: 'museum', name: 'Музей истории завода' }),
      node(5, 0.0025, 0.0022, { office: 'yes', name: 'БЦ Северный' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });

    const headline = publicDemandProfileHeadline(decision, 'ru');
    expect(headline).not.toMatch(/туристическ/i);

    const dom = decision.demandKernelV1?.dominantDemandType;
    expect(dom === 'medical' || dom === 'mixed' || dom === 'corporate/business').toBe(true);

    const top = decision.evidenceItems[0]?.objectName ?? '';
    expect(/больниц|клиническ/i.test(top)).toBe(true);

    expect(decision.demandSignals.every(s => !String(s.type).includes('tourist_demand'))).toBe(true);
  });

  it('demo resolver prefers API-attached locationDecision (raw OSM tags) over client-only rebuild', () => {
    const els: OSMElement[] = [
      node(1, 0.018, 0.016, { aeroway: 'aerodrome', name: 'Аэропорт Малый Фикстура' }),
      node(2, 0.004, 0.003, { railway: 'halt', name: 'Остановочный пункт Юг' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const merged = attachLocationDecisionToAnalysis(analysis, {
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    const attached = merged.locationDecision;
    expect(attached).toBeDefined();

    const resolved = ruResidentialLocationDecisionForDemo({
      analysis: merged,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    expect(resolved).toBe(attached);

    const { locationDecision: _drop, ...withoutAttached } = merged;
    const rebuilt = ruResidentialLocationDecisionForDemo({
      analysis: withoutAttached,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    expect(rebuilt).not.toBe(attached);
    expect(rebuilt.demandKernelV1).not.toBeNull();
    expect(Math.round(rebuilt.finalScore ?? NaN)).toBe(
      Math.round(rebuilt.demandKernelV1!.blendedPublicScore),
    );
  });

  it('demand headline never uses magnet-role fallback when kernel v1 is present (weak/unclear)', () => {
    const stubKernel = {
      acceptedDrivers: [],
      rejectedDrivers: [],
      scoredDrivers: [],
      dominantDemandType: 'weak/unclear' as const,
      scoreBreakdown: {
        rawSumBeforeCaps: 0,
        cappedSupportingInfra: 0,
        cappedLocalInterest: 0,
        cappedHotels: 0,
        cappedGenericBusiness: 0,
        cappedTourismWithoutAnchor: 0,
        cappedNoTier1Penalty: 0,
        cappedSmallCitySparse: 0,
        finalWeightedSum: 0,
      },
      kernelEvidenceScore: 30,
      blendedPublicScore: 31,
      warnings: [],
      debugTrace: [],
    };
    const decision = {
      demandKernelV1: stubKernel,
      demandSignals: [
        {
          id: 'ds:noise_tourist_proxy',
          type: 'tourist_demand',
          strength: 'strong' as const,
          evidenceFactIds: ['mf:tourist'],
          reason: 'legacy-ranked',
          publicLabelRu: 'туристический',
          internalReason: 'test',
        },
      ],
      magnetFacts: [
        {
          id: 'mf:tourist',
          role: 'tourist_demand',
          name: 'Fake attraction',
        },
      ],
    } as unknown as LocationDecision;

    const headline = publicDemandProfileHeadline(decision, 'ru');
    expect(headline).not.toMatch(/туристическ/i);
    expect(headline).toContain('ограничен');
  });
});
