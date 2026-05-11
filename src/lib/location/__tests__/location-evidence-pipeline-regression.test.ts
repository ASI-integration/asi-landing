import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { buildLocationDecision } from '../location-decision-kernel';
import { enrichAnalysisWithReportProjection } from '../location-scoring-projection';
import { generalizeRuPublicScoreExplanation, normalizeRuDemoExplanationLines } from '../demo-public-copy';
import {
  lintPublicClaimSurfaceRu,
  publicDemandProfileHeadline,
  validatePublicClaimPipeline,
} from '../location-public-claims';

const ORIGIN = { lat: 55.7522, lon: 37.6156 };

function node(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

describe('canonical evidence pipeline regression', () => {
  it('does not leak demo-public-copy fallback text for ultra-short inputs', () => {
    expect(generalizeRuPublicScoreExplanation('abc')).toBe('');
    expect(normalizeRuDemoExplanationLines(['abc', '   ', 'short'], 5)).toEqual([]);
  });

  it('free projection does not fall back to unsourced sanitized scoring prose when kernel bullets empty', () => {
    const els: OSMElement[] = [
      node(1, 0.008, 0.007, { shop: 'supermarket', name: 'Only Weak Fixture' }),
      node(2, 0.0081, 0.0071, { amenity: 'cafe', name: 'Cafe Fixture' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const free = enrichAnalysisWithReportProjection(analysis, { reportMode: 'free' });
    expect(free.scoringTrace?.publicBullets ?? []).toEqual([]);
  });

  it('every emitted publicClaim traces to magnet + evidence ids with sane distances', () => {
    const els: OSMElement[] = [
      node(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Якорь Метро' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const d = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    expect(d.evidenceItems.length).toBeGreaterThan(0);
    expect(d.publicClaims.length).toBe(d.evidenceItems.length);
    for (const e of d.evidenceItems) {
      expect(e.evidenceId.startsWith('ev:')).toBe(true);
      expect(d.magnetFacts.some(m => m.id === e.factId)).toBe(true);
    }
    expect(validatePublicClaimPipeline(d)).toEqual([]);
    expect(lintPublicClaimSurfaceRu(d.publicClaims)).toEqual([]);
  });

  it('hotel cannot steer headline toward packaged tourism framing via lone attractions', () => {
    const els: OSMElement[] = [
      node(1, 0.004, 0.004, { tourism: 'museum', name: 'Нишевый музей' }),
      node(2, 0.0045, 0.0046, { tourism: 'hotel', name: 'Grand Hotel', stars: '5' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const d = buildLocationDecision({
      analysis,
      inputAddress: '',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    expect(publicDemandProfileHeadline(d, 'ru')).not.toMatch(/туристическим\s+и\s+событийным/i);
    expect(d.demandSignals.every(s => !s.internalReason.startsWith('tourist_demand'))).toBe(true);
  });

  it('rejects orphan evidence rows when validating mismatched fact ids', () => {
    const els: OSMElement[] = [
      node(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Trace Fixture' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const d = buildLocationDecision({
      analysis,
      inputAddress: '',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    const corruptedEvidence = [
      {
        ...d.evidenceItems[0]!,
        factId: 'mf:missing:metro:999',
        evidenceId: 'ev:mf:missing:metro:999',
      },
    ];
    const problems = validatePublicClaimPipeline({
      magnetFacts: d.magnetFacts,
      evidenceItems: corruptedEvidence,
      demandSignals: d.demandSignals,
      publicClaims: d.publicClaims,
    });
    expect(problems.some(p => p.startsWith('orphan_evidence:'))).toBe(true);
  });
});
