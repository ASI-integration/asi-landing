import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAnalysis } from '../gravity-scoring';
import type { OSMElement } from '../types';
import {
  cloneAnalysisForResidentialDemoPatch,
  applyResidentialDemoPresentationToAnalysis,
} from '../residential-demo-presentation';
import {
  assertPublicScoreCustody,
  buildLocationScoreCustodySnapshot,
} from '../location-score-chain-of-custody';
import { publicLocationScore, scoreBandFromPublicScore } from '../location-score-public';
import {
  enrichAnalysisWithReportProjection,
} from '../location-scoring-projection';

const ORIGIN = { lat: 55.7522, lon: 37.6156 };

function syntheticNode(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

describe('location score chain of custody', () => {
  it('custody snapshot fails when public headline diverges from finalScore', () => {
    const analysis = buildAnalysis(
      [
        syntheticNode(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Metro Fixture' }),
        syntheticNode(2, 0.0035, 0.002, { university: 'yes', name: 'University Fixture' }),
      ],
      ORIGIN.lat,
      ORIGIN.lon,
    );
    const snap = buildLocationScoreCustodySnapshot(analysis);
    expect(snap.publicScoreShown).toBe(snap.finalScore);
    expect(snap.scoreBandSource).toBe(snap.finalScore);
    assertPublicScoreCustody(analysis);

    const corrupted = cloneAnalysisForResidentialDemoPatch(analysis);
    corrupted.locationScore = { ...corrupted.locationScore!, location_score: 12 };
    expect(() => assertPublicScoreCustody(corrupted)).toThrow(/location score custody:/);
  });

  it('scoreBand on engine analysis tracks composite headline, not evergreen alone', () => {
    const els: OSMElement[] = [
      syntheticNode(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Metro Fixture' }),
      syntheticNode(2, 0.004, 0.004, { landuse: 'industrial', name: 'Industrial Belt Fixture' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const trace = analysis.scoringTrace!;
    expect(analysis.scoreBand).toBe(scoreBandFromPublicScore(trace.finalScore));
    if (trace.scoreFeatures.evergreenIndex !== trace.finalScore) {
      expect(publicLocationScore(analysis)).toBe(trace.finalScore);
    }
  });

  it('RU demo presentation mutates trace.finalScore and keeps custody', () => {
    const els: OSMElement[] = [
      syntheticNode(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Metro Fixture' }),
      syntheticNode(2, 0.004, 0.004, { landuse: 'industrial', name: 'Industrial Belt Fixture' }),
    ];
    const base = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const a = cloneAnalysisForResidentialDemoPatch(base);
    const b = cloneAnalysisForResidentialDemoPatch(base);
    applyResidentialDemoPresentationToAnalysis(a);
    applyResidentialDemoPresentationToAnalysis(b);
    expect(a.scoringTrace!.finalScore).toBe(b.scoringTrace!.finalScore);
    assertPublicScoreCustody(a);

    const demoCap = a.scoringTrace!.capsApplied.find(c => c.kind === 'ru_residential_demo_presentation');
    if (demoCap) {
      expect(demoCap.phase).toBe('composite_headline');
      expect(demoCap.scoreAfter).toBe(a.scoringTrace!.finalScore);
    }
  });

  it('free vs paid report projections keep identical finalScore for same scoring input', () => {
    const els: OSMElement[] = [
      syntheticNode(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Metro Fixture' }),
      syntheticNode(2, 0.0035, 0.002, { university: 'yes', name: 'University Fixture' }),
    ];
    const base = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const paid = enrichAnalysisWithReportProjection(base, { reportMode: 'paid' });
    const free = enrichAnalysisWithReportProjection(base, { reportMode: 'free' });
    expect(paid.scoringTrace!.finalScore).toBe(base.scoringTrace!.finalScore);
    expect(free.scoringTrace!.finalScore).toBe(base.scoringTrace!.finalScore);
  });

  it('LocationIntelligenceDemo binds ASI hero /100 to publicScore, not evergreenIndex', () => {
    const demoPath = fileURLToPath(new URL('../../../components/LocationIntelligenceDemo.tsx', import.meta.url));
    const src = readFileSync(demoPath, 'utf8');
    expect(src).toContain('{publicScore}');
    expect(src).toContain('/100');
    expect(src).not.toContain('EvergreenRing index={evergreenIndex}');
    expect(src).not.toContain('EvergreenRing index={analysis.evergreenIndex}');
    expect(src).not.toMatch(/text-\[56px\][\s\S]{0,120}\{evergreenIndex\}/);
  });

  it('demo module does not choose headline via Math.max/min across evergreen vs location_score', () => {
    const demoPath = fileURLToPath(new URL('../../../components/LocationIntelligenceDemo.tsx', import.meta.url));
    const src = readFileSync(demoPath, 'utf8');
    expect(src).not.toMatch(/Math\.max\([\s\S]{0,120}evergreenIndex[\s\S]{0,120}location_score/);
    expect(src).not.toMatch(/Math\.min\([\s\S]{0,120}evergreenIndex[\s\S]{0,120}location_score/);
  });
});
