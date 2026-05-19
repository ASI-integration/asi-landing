import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { buildLocationDecision } from '../location-decision-kernel';
import {
  applyCityLevelStrategicVerdictGuard,
  buildLocationPublicSummary,
  selectStrictPublicSummaryDrivers,
} from '../location-public-summary';
import {
  buildPortCityStrategicContextCopyRu,
  CITY_LEVEL_STRATEGIC_ANCHOR_DEFAULTS,
  inferPublicScoreConfidence,
  portCityStrategicEvidenceItem,
  portCityStrategicMagnetFact,
} from '../location-evidence-anchor';
import { formatPublicEvidenceLineRu } from '../location-decision-rules';
import { formatRuResidentialEvidenceRowRu } from '../ru-residential-ui-projection';
import { publicScoreRange, publicScorePresentationFromDecision } from '../location-score-public';
import { buildFreeLocationReportViewModel } from '../free-report-renderer';
import type { LocationDemandScoringKernelResult } from '../location-scoring-contract';

const NOVOROSSIYSK = { lat: 44.7212, lon: 37.7704 };

function osmAt(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return {
    type: 'way',
    id,
    center: { lat: NOVOROSSIYSK.lat + dLat, lon: NOVOROSSIYSK.lon + dLon },
    tags,
  };
}

describe('city-level strategic anchor SSOT', () => {
  it('city-level strategic anchor does not render «0 м» in canonical formatters', () => {
    const copy = buildPortCityStrategicContextCopyRu('Новороссийск', 'sufficient');
    const mf = portCityStrategicMagnetFact({
      id: 'mf:test:port_city',
      cityName: 'Новороссийск',
      explanationRu: copy,
    });
    const ev = portCityStrategicEvidenceItem({
      evidenceId: 'ev:test:port_city',
      factId: mf.id,
      publicExplanationRu: copy,
    });

    expect(mf.distanceMeters).toBeNull();
    expect(mf).toMatchObject(CITY_LEVEL_STRATEGIC_ANCHOR_DEFAULTS);
    expect(formatPublicEvidenceLineRu(mf)).toBe(copy);
    expect(formatRuResidentialEvidenceRowRu(ev)).toBe(copy);
    expect(formatRuResidentialEvidenceRowRu(ev)).not.toMatch(/\b0\s*м\b/);
  });

  it('city-level anchor is excluded from local distance scoring fields on magnet fact', () => {
    const mf = portCityStrategicMagnetFact({
      id: 'mf:test',
      cityName: 'Астрахань',
      explanationRu: buildPortCityStrategicContextCopyRu('Астрахань'),
    });
    expect(mf.contributesToLocalDistanceScore).toBe(false);
    expect(mf.isNearbyPoi).toBe(false);
    expect(mf.includedInScore).toBe(false);
  });

  it('Novorossiysk OSM-missing port uses city strategic copy in decision and free report', () => {
    const elements: OSMElement[] = [
      osmAt(1, 0.002, 0.002, {
        name: 'Онкологический диспансер',
        amenity: 'hospital',
        healthcare: 'hospital',
      }),
    ];
    const analysis = buildAnalysis(elements, NOVOROSSIYSK.lat, NOVOROSSIYSK.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Новороссийск, улица Советов, 10',
      coordinates: NOVOROSSIYSK,
      rawElements: elements,
      locale: 'ru',
    });
    const freeReport = buildFreeLocationReportViewModel({
      address: 'Новороссийск, улица Советов, 10',
      decision,
      analysis,
    });

    const confidence = decision.publicSummary?.publicScoreConfidence ?? 'requires_full_check';
    const expected = buildPortCityStrategicContextCopyRu('Новороссийск', confidence);
    expect(decision.publicSummary?.publicDrivers[0]?.textRu).toBe(expected);
    expect(freeReport.topEvidenceBullets[0]?.isCityLevelStrategic).toBe(true);
    if (confidence === 'sufficient') {
      expect(freeReport.shortRecommendation).toContain('деловым и командировочным спросом');
    } else {
      expect(freeReport.shortRecommendation).toContain('не хватает данных');
    }
  });

  it('weak OSM coverage with city-level port only does not show harsh low % range', () => {
    const elements: OSMElement[] = [];
    const analysis = buildAnalysis(elements, NOVOROSSIYSK.lat, NOVOROSSIYSK.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Новороссийск',
      coordinates: NOVOROSSIYSK,
      rawElements: elements,
      locale: 'ru',
    });

    const label = publicScorePresentationFromDecision(decision)?.labelRu ?? '';
    expect(decision.publicSummary?.publicScoreConfidence).toBe('requires_full_check');
    expect(label).toBe('Потенциал требует уточнения');
    expect(label).not.toMatch(/требует полной проверки|данных недостаточно/i);
    expect(publicScoreRange(18, { confidence: 'requires_full_check' })?.labelRu).toBe(
      'Потенциал требует уточнения',
    );
  });

  it('strong city-level factor blocks «Слабый спрос» verdict copy', () => {
    const guarded = applyCityLevelStrategicVerdictGuard({
      verdict: 'Слабый спрос — нужен точечный сценарий',
      hasCityLevelStrategicAnchor: true,
      strictDrivers: [],
      specialMarketFlags: ['port_or_logistics_gateway'],
      magnets: [],
      publicScoreConfidence: 'sufficient',
    });
    expect(guarded).toContain('городской фактор спроса');
    expect(guarded).not.toMatch(/Слабый спрос/i);
  });

  it('city-level strategic only with strong preliminary score uses sufficient confidence', () => {
    expect(
      inferPublicScoreConfidence({
        score: 70,
        partialCartographicPreview: false,
        cityLevelStrategicOnly: true,
        strictPublicDriverCount: 0,
        classifiedMagnetCount: 0,
      }),
    ).toBe('sufficient');
    expect(buildPortCityStrategicContextCopyRu('Новороссийск', 'sufficient')).toContain(
      'Полный отчёт покажет, какой формат запуска',
    );
    expect(buildPortCityStrategicContextCopyRu('Новороссийск', 'sufficient')).not.toMatch(
      /проверить|полной карте/i,
    );
  });

  it('public score range appears only when confidence is sufficient', () => {
    expect(publicScoreRange(72, { confidence: 'sufficient' })?.labelRu).toMatch(/Предварительный потенциал:/);
    expect(publicScoreRange(72, { confidence: 'requires_full_check' })?.labelRu).toBe(
      'Потенциал требует уточнения',
    );
    expect(publicScoreRange(22, { confidence: 'sufficient' })?.labelRu).toBe(
      'Предварительный потенциал: ограниченный',
    );
  });

  it('medical duplicates stay deduped in analysis magnets', () => {
    const elements: OSMElement[] = [
      osmAt(11, 0.001, 0.001, {
        name: 'Онкологический диспансер',
        amenity: 'hospital',
        healthcare: 'hospital',
      }),
      osmAt(12, 0.00101, 0.00101, {
        name: 'ГБУЗ Онкологический диспансер',
        amenity: 'hospital',
        healthcare: 'hospital',
      }),
    ];
    const analysis = buildAnalysis(elements, NOVOROSSIYSK.lat, NOVOROSSIYSK.lon);
    expect(analysis.magnets.filter(m => /онколог/i.test(m.name))).toHaveLength(1);
  });

  it('raw weak POIs do not become prime public reasons when gated by strict driver selection', () => {
    const elements: OSMElement[] = [
      osmAt(20, 0.0003, 0.0003, { shop: 'mobile_phone', name: 'Ремонт телефонов' }),
      osmAt(21, 0.0004, 0.0004, { amenity: 'nightclub', name: 'Club' }),
    ];
    const analysis = buildAnalysis(elements, NOVOROSSIYSK.lat, NOVOROSSIYSK.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Новороссийск',
      coordinates: NOVOROSSIYSK,
      rawElements: elements,
      locale: 'ru',
    });
    const kernel = decision.demandKernelV1 as LocationDemandScoringKernelResult;
    const strict = selectStrictPublicSummaryDrivers({
      kernel,
      magnets: analysis.magnets,
      demandSignals: decision.demandSignals,
    });
    const summary = buildLocationPublicSummary({
      analysis,
      magnets: analysis.magnets,
      magnetFacts: decision.magnetFacts,
      kernel,
      demandSignals: decision.demandSignals,
      finalScore: decision.finalScore,
      scoreBand: decision.scoreBand,
      baseWarnings: [],
      strictDrivers: strict,
      inferredCityName: 'Новороссийск',
    });
    const joined = summary.publicDrivers.map(d => d.textRu).join(' ');
    expect(joined).not.toMatch(/ремонт телефон|nightclub|ночн/i);
  });
});
