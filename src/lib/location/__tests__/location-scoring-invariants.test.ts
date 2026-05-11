import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import {
  generalizeRuPublicScoreExplanation,
  normalizeRuDemoExplanationLines,
  sanitizeRuPublicFactor,
} from '../demo-public-copy';
import {
  applyReportProjectionToTrace,
  enrichAnalysisWithReportProjection,
} from '../location-scoring-projection';
import { filterResidentialPrimeMagnets } from '../residential-prime-magnets';

const ORIGIN = { lat: 55.7522, lon: 37.6156 };

function syntheticNode(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

describe('location scoring invariants', () => {
  it('public copy filtering does not change trace.finalScore', () => {
    const els: OSMElement[] = [
      syntheticNode(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Metro Fixture' }),
      syntheticNode(2, 0.0025, 0.002, { tourism: 'museum', name: 'Museum Fixture' }),
      syntheticNode(3, 0.003, 0.0015, { office: 'yes', name: 'Office Tower Fixture' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const trace = analysis.scoringTrace!;
    const before = trace.finalScore;
    const raw = [...(analysis.locationScore!.top_positive_factors ?? [])];
    normalizeRuDemoExplanationLines(raw, 6);
    sanitizeRuPublicFactor('Модель ограничила ответ');
    expect(analysis.scoringTrace!.finalScore).toBe(before);
  });

  it('evidence / prime projection does not mutate headline score', () => {
    const els: OSMElement[] = [
      syntheticNode(1, 0.004, 0.002, { amenity: 'hospital', name: 'Hospital Fixture' }),
      syntheticNode(2, 0.003, 0.003, { shop: 'supermarket', name: 'Market Fixture' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const scoreBefore = analysis.locationScore!.location_score;
    filterResidentialPrimeMagnets(analysis.magnets, { market: 'RU' });
    applyReportProjectionToTrace(analysis.scoringTrace!, 'paid_factors', analysis.locationScore!);
    expect(analysis.locationScore!.location_score).toBe(scoreBefore);
  });

  it('free and paid report projection share finalScore for identical scoring input', () => {
    const els: OSMElement[] = [
      syntheticNode(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Metro Fixture' }),
      syntheticNode(2, 0.0035, 0.002, { university: 'yes', name: 'University Fixture' }),
    ];
    const base = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const paid = enrichAnalysisWithReportProjection(base, { reportMode: 'paid' });
    const free = enrichAnalysisWithReportProjection(base, { reportMode: 'free' });
    expect(paid.scoringTrace!.finalScore).toBe(base.scoringTrace!.finalScore);
    expect(free.scoringTrace!.finalScore).toBe(base.scoringTrace!.finalScore);
    expect(free.scoringTrace!.publicBullets.join('|')).not.toEqual(paid.scoringTrace!.publicBullets.join('|'));
  });

  it('UI demo file does not blend weighted composite formula', () => {
    const demoPath = fileURLToPath(new URL('../../../components/LocationIntelligenceDemo.tsx', import.meta.url));
    const src = readFileSync(demoPath, 'utf8');
    expect(src).not.toMatch(/0\.40\s*\*\s*audience|LOCATION_SCORE_COMPONENT_WEIGHTS|computeLocationScoreFeatures/);
  });

  it('caps recorded after base composite only adjust headline with explicit reasons', () => {
    const els: OSMElement[] = [
      syntheticNode(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Metro Fixture' }),
      syntheticNode(2, 0.004, 0.004, { landuse: 'industrial', name: 'Industrial Belt Fixture' }),
      syntheticNode(3, 0.0045, 0.0042, { landuse: 'industrial', name: 'Industrial Belt 2' }),
      syntheticNode(4, 0.0048, 0.0041, { landuse: 'industrial', name: 'Industrial Belt 3' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const trace = analysis.scoringTrace!;
    expect(trace.finalScore).toBe(analysis.locationScore!.location_score);
    for (const cap of trace.capsApplied) {
      expect(cap.reason.trim().length).toBeGreaterThan(8);
      if (cap.kind === 'neighborhood_environment_headline') {
        expect(trace.finalScore).toBeLessThanOrEqual(trace.baseScore);
      }
    }
    const evergreenCap = trace.capsApplied.find(c => c.kind === 'evergreen_soft_cap');
    if (evergreenCap) {
      expect(evergreenCap.phase).toBe('evergreen_raw');
    }
    const envCap = trace.capsApplied.find(c => c.kind === 'neighborhood_environment_headline');
    if (envCap) {
      expect(envCap.phase).toBe('composite_headline');
      expect(envCap.scoreBefore).toBeDefined();
      expect(envCap.scoreAfter).toBeDefined();
    }
  });

  it('non-empty magnet fixtures are not collapsed to near-zero headline scores', () => {
    const els: OSMElement[] = [
      syntheticNode(1, 0.008, 0.007, { shop: 'supermarket', name: 'Corner Fixture' }),
      syntheticNode(2, 0.0081, 0.0071, { amenity: 'cafe', name: 'Cafe Fixture' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    expect(analysis.magnets.length).toBeGreaterThan(0);
    expect(analysis.scoringTrace!.finalScore).toBeGreaterThan(12);
  });

  it('generalized ultra-short public lines are dropped (no invented map claims)', () => {
    expect(generalizeRuPublicScoreExplanation('abc')).toBe('');
  });

  it('golden fixture module avoids Cyrillic street literals used as regression exceptions', () => {
    const goldenPath = fileURLToPath(new URL('./location-scoring-golden-fixtures.test.ts', import.meta.url));
    const goldenSrc = readFileSync(goldenPath, 'utf8').toLowerCase();
    const banned = '\u043f\u0430\u0440\u0445\u043e\u043c\u0435\u043d\u043a\u043e'; // пархоменко
    expect(goldenSrc).not.toContain(banned);
  });
});

