import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { buildLocationDecision } from '../location-decision-kernel';

const ORIGIN = { lat: 55.75, lon: 37.62 };

function node(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

describe('partial cartographic preview + generic medical public surface', () => {
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
    expect(ps?.headlineRu).toMatch(/медицинским якорем/i);
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
});
