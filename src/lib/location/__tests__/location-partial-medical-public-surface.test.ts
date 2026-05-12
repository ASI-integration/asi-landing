import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { buildLocationDecision } from '../location-decision-kernel';

const ORIGIN = { lat: 55.75, lon: 37.62 };

function node(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

describe('partial cartographic preview + generic medical public surface', () => {
  it.each([
    [
      'Россия, Красноярский край, Норильск, Ленинский проспект, 19',
      [
        { amenity: 'hospital', name: 'Норильская городская больница №2' },
        { amenity: 'university', name: 'Ленинградский государственный университет им. А. С. Пушкина' },
        { amenity: 'university', name: 'Московский институт предпринимательства и права, филиал' },
        { amenity: 'hospital', name: 'Полярная медицина' },
        { amenity: 'hospital' },
      ],
    ],
    [
      'Россия, Красноярский край, Норильск, Талнахская улица, 64',
      [
        { amenity: 'university', name: 'Московский институт предпринимательства и права, филиал' },
        { amenity: 'university', name: 'Ленинградский государственный университет им. А. С. Пушкина' },
        { amenity: 'hospital', name: 'Детская поликлиника' },
        { amenity: 'hospital' },
        { aeroway: 'aerodrome', name: 'Аэропорт Валёк' },
      ],
    ],
  ])('Norilsk live-100 case is remote industrial, not million-plus: %s', (address, tagsList) => {
    const els = tagsList.map((tags, idx) =>
      node(900 + idx, 0.003 + idx * 0.001, 0.002 + idx * 0.001, tags as unknown as Record<string, string>),
    );
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const tr = analysis.scoringTrace;
    if (tr) tr.finalScore = 90;
    const decision = buildLocationDecision({
      analysis,
      inputAddress: address,
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    expect(decision.publicSummary?.cityScale).toBe('medium_city');
    expect(decision.demandKernelV1?.cityScaleInferenceProvenance).toMatch(/ru_market_context:Норильск/);
    expect(decision.publicSummary?.specialMarketFlags).toEqual(
      expect.arrayContaining(['major_industrial_employer', 'shift_worker_demand']),
    );
    expect(decision.finalScore).not.toBeNull();
    expect(decision.finalScore!).toBeLessThan(89);
  });

  it('full-data generic medical-primary result cannot score 85+', () => {
    const els: OSMElement[] = [
      node(950, 0.002, 0.002, { amenity: 'hospital' }),
      node(951, 0.0025, 0.0022, { amenity: 'hospital' }),
      node(952, 0.003, 0.0024, { amenity: 'clinic', name: 'Клиника' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const tr = analysis.scoringTrace;
    if (tr) tr.finalScore = 96;
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Россия, Москва, Кантемировская улица, 16к1',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    expect(decision.publicSummary?.primaryDemandType).toBe('medical');
    expect(decision.finalScore).not.toBeNull();
    expect(decision.finalScore!).toBeLessThan(85);
    expect(decision.warnings).toEqual(expect.arrayContaining([expect.stringContaining('medical_primary_high_score_cap')]));
  });

  it('commander verdict cannot appear from medical-led score plus one industrial object', () => {
    const els: OSMElement[] = [
      node(960, 0.002, 0.002, { amenity: 'hospital', name: 'Детская больница №38' }),
      node(961, 0.0025, 0.0022, { amenity: 'hospital', name: 'Больница №85' }),
      node(962, 0.003, 0.0024, { amenity: 'hospital', name: 'Психиатрическая больница № 14' }),
      node(963, 0.0022, 0.0026, {
        landuse: 'industrial',
        name: 'ВНИИА им. Духова, площадка Москворечье',
      }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const tr = analysis.scoringTrace;
    if (tr) tr.finalScore = 98;
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Россия, Москва, Кантемировская улица, 16к1',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    expect(decision.publicSummary?.audienceVerdictRu).not.toMatch(/Сильная локация для командированных/);
  });

  it('commander verdict cannot appear from ordinary institute cluster without business travel evidence', () => {
    const els: OSMElement[] = [
      node(970, 0.002, 0.002, { amenity: 'university', name: 'Балтийский институт психологии' }),
      node(971, 0.0025, 0.0022, { amenity: 'university', name: 'Калининградский институт туризма' }),
      node(972, 0.003, 0.0024, { amenity: 'hospital', name: 'МедЭксперт' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const tr = analysis.scoringTrace;
    if (tr) tr.finalScore = 82;
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Россия, Калининград, улица Горького, 162',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    expect(decision.publicSummary?.cityScale).toBe('large_regional');
    expect(decision.publicSummary?.audienceVerdictRu).not.toMatch(/Сильная локация для командированных/);
  });

  it('spb_008_parkhomenko_15-like partial 94 caps at 70 even with named anchors', () => {
    const els: OSMElement[] = [
      node(101, 0.005, 0.004, { amenity: 'university', name: 'Университет' }),
      node(102, 0.006, 0.0042, { amenity: 'university', name: 'Университет' }),
      node(103, 0.004, 0.003, {
        amenity: 'hospital',
        name: 'Лечебно-реабилитационный центр Федерального центра сердца',
      }),
      node(104, 0.0045, 0.0032, { amenity: 'hospital', name: 'Детская городская больница святой Ольги' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const tr = analysis.scoringTrace;
    if (tr) tr.finalScore = 94;
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Россия, Санкт-Петербург, проспект Пархоменко, 15',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
      partialCartographicPreview: true,
    });
    const diag = decision.publicSummary?.presentationDiagnostics;
    expect(decision.finalScore).not.toBeNull();
    expect(decision.finalScore!).toBeLessThanOrEqual(70);
    expect(diag?.partialCartographicPreview).toBe(true);
    expect(diag?.partialDataScoreCapApplied).toBe(true);
    expect(diag?.partialDataScoreCapReason).toContain('partial_verified_anchor_without_strong_cluster_evidence');
    expect(diag?.scoreBeforePartialDataCap).toBeGreaterThan(70);
    expect(diag?.scoreAfterPartialDataCap).toBeLessThanOrEqual(70);
  });

  it('novosib_017_krasny_50-like partial 90 caps at 70', () => {
    const els: OSMElement[] = [
      node(111, 0.0025, 0.002, { amenity: 'hospital', name: 'Городская клиническая больница №1' }),
      node(112, 0.003, 0.0022, { amenity: 'hospital', name: 'Областная клиническая больница' }),
      node(113, 0.0035, 0.0024, { amenity: 'hospital', name: 'Перинатальный центр' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const tr = analysis.scoringTrace;
    if (tr) tr.finalScore = 90;
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Россия, Новосибирск, Красный проспект, 50',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
      partialCartographicPreview: true,
    });
    expect(decision.finalScore).not.toBeNull();
    expect(decision.finalScore!).toBeLessThanOrEqual(70);
    expect(decision.publicSummary?.presentationDiagnostics?.partialDataScoreCapApplied).toBe(true);
  });

  it('vladivostok_080_russkaya_46-like partial 83 caps at 70', () => {
    const els: OSMElement[] = [
      node(121, 0.0025, 0.002, { amenity: 'hospital', name: 'Краевая клиническая больница' }),
      node(122, 0.003, 0.0022, { amenity: 'hospital', name: 'Медицинский центр ДВФУ' }),
      node(123, 0.001, 0.001, { railway: 'station', name: 'Станция' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const tr = analysis.scoringTrace;
    if (tr) tr.finalScore = 83;
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Россия, Владивосток, Русская улица, 46',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
      partialCartographicPreview: true,
    });
    expect(decision.finalScore).not.toBeNull();
    expect(decision.finalScore!).toBeLessThanOrEqual(70);
    expect(decision.publicSummary?.presentationDiagnostics?.scoreAfterPartialDataCap).toBeLessThanOrEqual(70);
  });

  it('caps public headline score when preview is partial and only generic hospitals surface', () => {
    const els: OSMElement[] = [
      node(1, 0.004, 0.003, { amenity: 'hospital' }),
      node(2, 0.0045, 0.0032, { amenity: 'hospital' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const tr = analysis.scoringTrace;
    if (tr) tr.finalScore = 92;
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
      partialCartographicPreview: true,
    });
    expect(decision.finalScore).not.toBeNull();
    expect(decision.finalScore!).toBeLessThanOrEqual(65);
    expect(decision.publicSummary?.presentationDiagnostics?.partialDataScoreCapApplied).toBe(true);
    expect(decision.publicSummary?.presentationDiagnostics?.partialDataScoreCapReason).toContain(
      'partial_generic_medical_public_drivers',
    );
    expect(decision.publicSummary?.presentationDiagnostics?.verifiedMajorMedicalAnchorCount).toBe(0);
    expect(decision.publicSummary?.headlineRu).not.toMatch(/медицинским якорем/i);
    expect(decision.publicSummary?.audienceVerdictRu).not.toMatch(/Сильная локация для командированных/);
  });

  it('does not emit commander-strong verdict from generic hospitals alone (no partial flag)', () => {
    const els: OSMElement[] = [
      node(10, 0.004, 0.003, { amenity: 'hospital' }),
      node(11, 0.0045, 0.0032, { amenity: 'hospital' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const tr = analysis.scoringTrace;
    if (tr) tr.finalScore = 88;
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    expect(decision.publicSummary?.audienceVerdictRu).not.toMatch(/Сильная локация для командированных/);
  });

  it('keeps strong medical headline for named hospitals without partial preview', () => {
    const els: OSMElement[] = [
      node(20, 0.004, 0.003, { amenity: 'hospital', name: 'Городская клиническая больница №4' }),
      node(21, 0.0045, 0.0032, { amenity: 'hospital', name: 'Областной онкологический диспансер' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    const ps = decision.publicSummary;
    expect(ps?.primaryDemandType).toBe('medical');
    expect(ps?.headlineRu).toMatch(/медицинск/i);
    expect(ps?.headlineRu).not.toMatch(/якор/i);
    expect(ps?.presentationDiagnostics?.genericMedicalSuppressed).toBe(false);
  });

  it('when score is blocked for incomplete data, partial path never surfaces 80+', () => {
    const els: OSMElement[] = [node(30, 0.004, 0.003, { amenity: 'hospital', name: 'Федеральный центр' })];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    analysis.analysisIntegrity = {
      analysisIncomplete: true,
      scoreBlockedDueToIncompleteData: true,
      reasons: ['score_blocked_due_to_incomplete_data'],
    };
    const tr = analysis.scoringTrace;
    if (tr) tr.finalScore = 95;
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
      partialCartographicPreview: true,
    });
    expect(decision.finalScore).not.toBeNull();
    expect(decision.finalScore!).toBeLessThanOrEqual(79);
  });

  it('verified named major anchors get higher partial cap only with strong regional medical evidence', () => {
    const els: OSMElement[] = [
      node(40, 0.003, 0.0025, { amenity: 'hospital', name: 'Федеральный научный медицинский центр' }),
      node(41, 0.0035, 0.0029, { amenity: 'hospital', name: 'Краевой онкологический диспансер' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const tr = analysis.scoringTrace;
    if (tr) tr.finalScore = 95;
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Россия, Ставрополь, улица Доваторцев, 1',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
      partialCartographicPreview: true,
    });
    const diag = decision.publicSummary?.presentationDiagnostics;
    expect(decision.finalScore).not.toBeNull();
    expect(decision.finalScore!).toBeLessThanOrEqual(79);
    expect(decision.finalScore!).toBeGreaterThan(70);
    expect(diag?.partialDataScoreCapApplied).toBe(true);
    expect(diag?.partialDataScoreCapReason).toContain('partial_strong_regional_medical_cluster_lift');
  });
});
