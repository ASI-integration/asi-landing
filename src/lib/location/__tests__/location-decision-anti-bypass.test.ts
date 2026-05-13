import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('location decision anti-bypass guards', () => {
  it('LocationIntelligenceDemo does not import scoring implementation modules directly', () => {
    const demoPath = fileURLToPath(new URL('../../../components/LocationIntelligenceDemo.tsx', import.meta.url));
    const src = readFileSync(demoPath, 'utf8');
    expect(src).not.toMatch(/from ['"]@\/lib\/location\/location-score['"]/);
    expect(src).not.toMatch(/from ['"]@\/lib\/location\/gravity-scoring['"]/);
    expect(src).not.toMatch(/computeLocationScoreFeatures/);
  });

  it('RU residential UI reads score/headline/verdict from LocationDecision and LocationPublicSummary', () => {
    const demoPath = fileURLToPath(new URL('../../../components/LocationIntelligenceDemo.tsx', import.meta.url));
    const src = readFileSync(demoPath, 'utf8');
    expect(src).toContain('residentialLocationDecision?.finalScore');
    expect(src).toContain('residentialPublicSummary?.headlineRu');
    expect(src).toContain('residentialPublicSummary.audienceVerdictRu');
    expect(src).toContain('residentialPublicSummary?.publicDrivers');
    expect(src).not.toMatch(/analysis\.scoringTrace\?\.publicBullets[\s\S]{0,240}isRuResidentialDemo/);
    expect(src).not.toMatch(/demandKernelV1[\s\S]{0,240}audienceVerdictRu/);
  });

  it('demo-public-copy does not define DemandSignal or invent typed demand signals', () => {
    const p = fileURLToPath(new URL('../demo-public-copy.ts', import.meta.url));
    const src = readFileSync(p, 'utf8');
    expect(src).not.toContain('DemandSignal');
    expect(src).not.toMatch(/type:\s*['"]tourist_demand['"]/);
  });

  it('unified-report does not classify OSM via classifyElement directly (report stays projection)', () => {
    const p = fileURLToPath(new URL('../unified-report.ts', import.meta.url));
    const src = readFileSync(p, 'utf8');
    expect(src).not.toContain('classifyElement');
  });

  it('standalone-report delegates free bullets to scoring trace / kernel projection path', () => {
    const p = fileURLToPath(new URL('../standalone-report.ts', import.meta.url));
    const src = readFileSync(p, 'utf8');
    expect(src).toContain('enrichAnalysisWithReportProjection');
    expect(src).toContain('publicBullets');
  });

  it('cache module does not import LocationDecision kernel', () => {
    const p = fileURLToPath(new URL('../cache.ts', import.meta.url));
    const src = readFileSync(p, 'utf8');
    expect(src).not.toContain('location-decision-kernel');
    expect(src).not.toContain('buildLocationDecision');
  });
});
