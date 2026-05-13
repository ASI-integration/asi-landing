import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { buildLocationDecision } from '../location-decision-kernel';
import {
  applyVerdictContradictionGuards,
  buildLocationPublicSummary,
  strongBusinessContributionFromDrivers,
} from '../location-public-summary';
import type { MagnetFact } from '../location-decision-contract';
import type { LocationDemandScoredDriver, LocationDemandScoringKernelResult } from '../location-scoring-contract';

const ORIGIN = { lat: 44.495, lon: 34.166 }; // Crimea-ish coords — fixture only

function node(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

function medicalFact(id: string, name: string, distanceMeters: number): MagnetFact {
  return {
    id,
    name,
    category: 'Больница',
    tier: 'primary',
    role: 'medical_demand',
    distanceMeters,
    evidenceSource: 'classified_magnet',
    includedInScore: true,
    includedInPublicReport: true,
    explanationRu: '',
    explanationEn: '',
  };
}

function medicalDriver(mf: MagnetFact, index: number): LocationDemandScoredDriver {
  return {
    magnetFactId: mf.id,
    evidenceId: `ev:${mf.id}`,
    sourceName: mf.name,
    category: mf.category,
    driverKind: 'real_demand_driver',
    resolvedTier: 1,
    scaleClass: 'verified_major',
    demandTypeVote: 'medical',
    distanceMeters: mf.distanceMeters,
    baseWeight: 1,
    distanceCoefficient: 1,
    scaleCoefficient: 1,
    confidenceCoefficient: 1,
    finalContribution: 2 - index * 0.1,
    accepted: true,
    reason: 'test',
    publicDisplayEligible: true,
  };
}

function fakeKernel(drivers: LocationDemandScoredDriver[]): LocationDemandScoringKernelResult {
  return {
    acceptedDrivers: drivers,
    rejectedDrivers: [],
    scoredDrivers: drivers,
    dominantDemandType: 'medical',
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
    kernelEvidenceScore: 72,
    blendedPublicScore: 72,
    cityScale: 'unknown',
    populationTier: 'unknown',
    marketGravityCoefficient: 1,
    specialMarketFlags: [],
    scoreCapReason: null,
    warnings: [],
    debugTrace: [],
  };
}

describe('LocationPublicSummary — live screenshot regressions', () => {
  it('A Yalta-style: hotel + nightclub + phone repair — no strong tourist headline; no junk in publicDrivers', () => {
    const els: OSMElement[] = [
      node(1, 0.001, 0.001, { tourism: 'hotel', name: 'Resort Hotel Y' }),
      node(2, 0.0012, 0.0011, { amenity: 'nightclub', name: 'Club Neon' }),
      node(3, 0.0015, 0.0014, { shop: 'mobile_phone', name: 'Ремонт телефонов Смарт' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    const s = decision.publicSummary;
    expect(s).not.toBeNull();
    expect(s!.headlineRu).not.toMatch(/Сильная\s+туристическ/i);
    expect(s!.headlineRu).not.toMatch(/туристическ(?:ий|ого)\s+и\s+событийн/i);
    expect(s!.publicDrivers.every(d => !/отель|hotel|nightclub|клуб\s+neon|ремонт\s+телефон/i.test(d.textRu))).toBe(
      true,
    );
  });

  it('B Rostov-style: hospitals + hotel + generic office + recruitment — medical/mixed primary; no tourist headline; verdict aligned', () => {
    const els: OSMElement[] = [
      node(10, 0.0028, 0.0026, { amenity: 'hospital', name: 'Городская клиническая больница №4' }),
      node(11, 0.0031, 0.0029, { amenity: 'hospital', name: 'Областной онкологический диспансер' }),
      node(12, 0.002, 0.0024, { tourism: 'hotel', name: 'Hotel Rostov Inn' }),
      node(13, 0.0024, 0.0023, { office: 'yes', name: 'Офис Торговый дом' }),
      node(14, 0.0022, 0.0025, { office: 'yes', name: 'Кадровое агентство Успех' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    const s = decision.publicSummary!;
    expect(s.primaryDemandType).not.toBe('tourist');
    expect(s.headlineRu).not.toMatch(/туристическ/i);
    expect(s.publicDrivers.every(d => !/отель|hotel|инн|кадров|агентств|офис\s+—/i.test(d.textRu))).toBe(true);
    if (s.primaryDemandType === 'medical' || s.primaryDemandType === 'mixed') {
      expect(s.audienceVerdictRu).not.toMatch(/туристическ/i);
    }
  });

  it('groups repeated medical public bullets into human copy', () => {
    const analysis = buildAnalysis([], ORIGIN.lat, ORIGIN.lon);
    const magnetFacts: MagnetFact[] = [
      medicalFact('mf:0:hospital:240', 'Федеральный кардиологический центр', 240),
      medicalFact('mf:1:hospital:280', 'Областной онкологический диспансер', 280),
      medicalFact('mf:2:hospital:320', 'Перинатальный центр', 320),
    ];
    const strictDrivers = magnetFacts.map((mf, i) => medicalDriver(mf, i));
    const summary = buildLocationPublicSummary({
      analysis,
      magnets: [],
      magnetFacts,
      kernel: fakeKernel(strictDrivers),
      demandSignals: [],
      finalScore: 72,
      scoreBand: 'strong',
      baseWarnings: [],
      strictDrivers,
    });
    const texts = summary.publicDrivers.map(d => d.textRu);
    const joined = texts.join('\n');
    expect(joined).not.toContain('усиливает медицинский спрос');
    expect(texts.some(t => t.startsWith('Рядом есть несколько медицинских учреждений'))).toBe(true);
    expect(texts).toContain('Они могут давать небольшой дополнительный спрос, но сами по себе не делают локацию сильной.');
  });

  it('limits one or two medical objects to a cautious single public bullet', () => {
    const els: OSMElement[] = [
      node(30, 0.0018, 0.0016, { amenity: 'hospital', name: 'Больница' }),
      node(31, 0.0021, 0.0019, { amenity: 'clinic', name: 'Диспансер' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    const medicalTexts = decision.publicSummary!.publicDrivers
      .map(d => d.textRu)
      .filter(t => /медицинск|спрос/i.test(t));
    expect(medicalTexts).toEqual([
      'Поблизости есть медицинские учреждения, но этого недостаточно для сильного вывода по спросу.',
    ]);
  });

  it('C contradiction guard: tourist primary + business verdict without strong business mass → adjusted', () => {
    const fakeDrivers = [
      { demandTypeVote: 'tourist' as const, accepted: true, driverKind: 'real_demand_driver' as const, finalContribution: 1.2 },
    ] as unknown as import('../location-scoring-contract').LocationDemandScoredDriver[];
    const out = applyVerdictContradictionGuards({
      baseVerdict: 'Сильная локация для командированных',
      primary: 'tourist',
      secondaries: [],
      strictDrivers: fakeDrivers,
    });
    expect(out.warnings.length).toBeGreaterThan(0);
    expect(out.verdict).not.toMatch(/командированных/i);
    expect(strongBusinessContributionFromDrivers(fakeDrivers)).toBeLessThan(0.42);
  });

  it('C contradiction guard: business mass high enough → командированных kept', () => {
    const fakeDrivers = [
      {
        demandTypeVote: 'corporate/business' as const,
        accepted: true,
        driverKind: 'real_demand_driver' as const,
        finalContribution: 2,
      },
    ] as unknown as import('../location-scoring-contract').LocationDemandScoredDriver[];
    const out = applyVerdictContradictionGuards({
      baseVerdict: 'Сильная локация для командированных',
      primary: 'tourist',
      secondaries: ['corporate/business'],
      strictDrivers: fakeDrivers,
    });
    expect(out.verdict).toMatch(/командированных/i);
  });
});
