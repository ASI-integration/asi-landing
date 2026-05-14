import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { buildTerritorialScoringBridgeSignals } from '../territorial-scoring-bridge';
import { computeTerritorialScoringModifier } from '../territorial-scoring-modifier';

const ORIGIN = { lat: 55.7522, lon: 37.6156 };

function modifierFor(
  source: Parameters<typeof buildTerritorialScoringBridgeSignals>[0],
  baseLocationScore = 70,
) {
  const territorialScoringSignals = buildTerritorialScoringBridgeSignals(source);
  return computeTerritorialScoringModifier({
    baseLocationScore,
    territorialScoringSignals,
  });
}

function syntheticNode(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

describe('territorial scoring modifier', () => {
  it('balanced business district adds the bounded positive modifier', () => {
    const mod = modifierFor({
      countedSignals: 9,
      coverageUnits: 8,
      coverageRadiusMeters: 900,
      diversityScore: 0.74,
      businessSuitabilityScore: 0.83,
      transportBalanceScore: 0.62,
      monoFunctional: {
        detected: false,
        dominantShare: 0.38,
        dominantCategory: null,
      },
      deadZone: {
        gapRatio: 0.12,
        emptyUnitRatio: 0.08,
        lowDensityUnitRatio: 0.04,
      },
      flags: {
        hasBusinessCore: true,
        hasTransportAccess: true,
      },
    });

    expect(mod.netPoints).toBe(4);
    expect(mod.adjustedLocationScore).toBe(74);
    expect(mod.contributions.map(c => c.reason)).toEqual([
      'balanced_business_district',
      'territorial_diversity',
      'balanced_transport_access',
    ]);
  });

  it('mono-functional office zone applies a small negative modifier', () => {
    const mod = modifierFor({
      countedSignals: 7,
      coverageUnits: 6,
      coverageRadiusMeters: 900,
      diversityScore: 0.18,
      businessSuitabilityScore: 0.84,
      transportBalanceScore: 0.2,
      monoFunctional: {
        detected: true,
        dominantShare: 0.82,
        dominantCategory: 'business',
      },
      deadZone: {
        gapRatio: 0.16,
        emptyUnitRatio: 0.1,
        lowDensityUnitRatio: 0.06,
      },
      flags: {
        hasBusinessCore: true,
        hasTransportAccess: false,
      },
    });

    expect(mod.netPoints).toBe(-3);
    expect(mod.adjustedLocationScore).toBe(67);
    expect(mod.contributions.map(c => c.reason)).toEqual(['mono_functional_zone']);
  });

  it('dead-zone residential area applies the stronger bounded downside', () => {
    const mod = modifierFor({
      countedSignals: 1,
      coverageUnits: 8,
      coverageRadiusMeters: 900,
      diversityScore: 0.08,
      businessSuitabilityScore: 0.05,
      transportBalanceScore: 0.03,
      monoFunctional: {
        detected: false,
        dominantShare: 0,
        dominantCategory: null,
      },
      deadZone: {
        gapRatio: 0.78,
        emptyUnitRatio: 0.54,
        lowDensityUnitRatio: 0.24,
      },
      flags: {
        lowSignal: true,
      },
    });

    expect(mod.signalQuality).toBe('low');
    expect(mod.netPoints).toBe(-5);
    expect(mod.adjustedLocationScore).toBe(65);
    expect(mod.contributions.map(c => c.reason)).toEqual(['dead_zone']);
  });

  it('does not apply dead-zone penalty to healthy mixed district despite high raw gaps', () => {
    const mod = modifierFor({
      countedSignals: 10,
      coverageUnits: 18,
      coverageRadiusMeters: 1200,
      diversityScore: 0.76,
      businessSuitabilityScore: 0.72,
      transportBalanceScore: 0.55,
      monoFunctional: {
        detected: false,
        dominantShare: 0.3,
        dominantCategory: null,
      },
      deadZone: {
        gapRatio: 0.94,
        emptyUnitRatio: 0.8,
        lowDensityUnitRatio: 0.14,
      },
      flags: {
        hasBusinessCore: true,
        hasTransportAccess: true,
      },
    });

    expect(mod.contributions.map(c => c.reason)).not.toContain('dead_zone');
    expect(mod.netPoints).toBeGreaterThanOrEqual(0);
  });

  it('strong transport plus diversity cannot become a dead-zone penalty', () => {
    const mod = modifierFor({
      countedSignals: 7,
      coverageUnits: 14,
      coverageRadiusMeters: 1200,
      diversityScore: 0.6,
      businessSuitabilityScore: 0.52,
      transportBalanceScore: 0.48,
      monoFunctional: {
        detected: false,
        dominantShare: 0.42,
        dominantCategory: null,
      },
      deadZone: {
        gapRatio: 0.88,
        emptyUnitRatio: 0.72,
        lowDensityUnitRatio: 0.16,
      },
      flags: {
        hasTransportAccess: true,
      },
    });

    expect(mod.contributions.map(c => c.reason)).not.toContain('dead_zone');
  });

  it('keeps final modifier behavior aligned with deterministic dead-zone fixtures', () => {
    const noEvidence = modifierFor({
      countedSignals: 0,
      coverageUnits: 12,
      coverageRadiusMeters: 1200,
      diversityScore: 0,
      businessSuitabilityScore: 0,
      transportBalanceScore: 0,
      monoFunctional: { detected: false, dominantShare: 0, dominantCategory: null },
      deadZone: { gapRatio: 1, emptyUnitRatio: 1, lowDensityUnitRatio: 0 },
      flags: { lowSignal: true },
    });
    const denseMixedDiverse = modifierFor({
      countedSignals: 8,
      coverageUnits: 11,
      coverageRadiusMeters: 1200,
      diversityScore: 0.86,
      businessSuitabilityScore: 0.64,
      transportBalanceScore: 0.36,
      monoFunctional: { detected: false, dominantShare: 0.25, dominantCategory: null },
      deadZone: { gapRatio: 0.92, emptyUnitRatio: 0.86, lowDensityUnitRatio: 0.06 },
    });
    const businessSuitableDiverse = modifierFor({
      countedSignals: 8,
      coverageUnits: 11,
      coverageRadiusMeters: 1200,
      diversityScore: 0.72,
      businessSuitabilityScore: 0.78,
      transportBalanceScore: 0.32,
      monoFunctional: { detected: false, dominantShare: 0.5, dominantCategory: 'business' },
      deadZone: { gapRatio: 0.9, emptyUnitRatio: 0.84, lowDensityUnitRatio: 0.06 },
      flags: { hasBusinessCore: true },
    });
    const transportDiverse = modifierFor({
      countedSignals: 8,
      coverageUnits: 11,
      coverageRadiusMeters: 1200,
      diversityScore: 0.7,
      businessSuitabilityScore: 0.62,
      transportBalanceScore: 0.48,
      monoFunctional: { detected: false, dominantShare: 0.38, dominantCategory: null },
      deadZone: { gapRatio: 0.9, emptyUnitRatio: 0.84, lowDensityUnitRatio: 0.06 },
      flags: { hasTransportAccess: true },
    });
    const levittownLikeSparseMonoFunctional = modifierFor({
      countedSignals: 3,
      coverageUnits: 12,
      coverageRadiusMeters: 1200,
      diversityScore: 0,
      businessSuitabilityScore: 0.18,
      transportBalanceScore: 0,
      monoFunctional: { detected: true, dominantShare: 1, dominantCategory: 'tourism' },
      deadZone: { gapRatio: 0.6, emptyUnitRatio: 0.9, lowDensityUnitRatio: 0 },
    });

    expect(noEvidence.contributions.map(c => c.reason)).not.toContain('dead_zone');
    expect(noEvidence.netPoints).toBe(0);
    expect(denseMixedDiverse.contributions.map(c => c.reason)).not.toContain('dead_zone');
    expect(businessSuitableDiverse.contributions.map(c => c.reason)).not.toContain('dead_zone');
    expect(transportDiverse.contributions.map(c => c.reason)).not.toContain('dead_zone');
    expect(levittownLikeSparseMonoFunctional.contributions.map(c => c.reason)).toContain('dead_zone');
    expect(levittownLikeSparseMonoFunctional.netPoints).toBeGreaterThanOrEqual(-6);
  });

  it('transport-heavy but low-diversity area is penalized without rewarding transit alone', () => {
    const mod = modifierFor({
      countedSignals: 5,
      coverageUnits: 6,
      coverageRadiusMeters: 900,
      diversityScore: 0.26,
      businessSuitabilityScore: 0.2,
      transportBalanceScore: 0.14,
      monoFunctional: {
        detected: false,
        dominantShare: 0.52,
        dominantCategory: 'transport',
      },
      deadZone: {
        gapRatio: 0.22,
        emptyUnitRatio: 0.14,
        lowDensityUnitRatio: 0.08,
      },
      flags: {
        hasTransportAccess: true,
        transportOverDominated: true,
      },
    });

    expect(mod.netPoints).toBe(-3);
    expect(mod.adjustedLocationScore).toBe(67);
    expect(mod.positivePoints).toBe(0);
    expect(mod.contributions.map(c => c.reason)).toEqual(['transport_over_dominated_low_diversity']);
  });

  it('caps territorial movement so scores cannot explode outside 0-100', () => {
    const balancedAtCeiling = modifierFor({
      countedSignals: 9,
      coverageUnits: 8,
      coverageRadiusMeters: 900,
      diversityScore: 1,
      businessSuitabilityScore: 1,
      transportBalanceScore: 1,
      monoFunctional: {
        detected: false,
        dominantShare: 0,
        dominantCategory: null,
      },
      deadZone: {
        gapRatio: 0,
        emptyUnitRatio: 0,
        lowDensityUnitRatio: 0,
      },
      flags: {
        hasBusinessCore: true,
        hasTransportAccess: true,
      },
    }, 98);
    const weakAtFloor = modifierFor({
      countedSignals: 2,
      coverageUnits: 8,
      coverageRadiusMeters: 900,
      diversityScore: 0.05,
      businessSuitabilityScore: 0.02,
      transportBalanceScore: 0,
      monoFunctional: {
        detected: true,
        dominantShare: 0.9,
        dominantCategory: 'transport',
      },
      deadZone: {
        gapRatio: 0.88,
        emptyUnitRatio: 0.64,
        lowDensityUnitRatio: 0.24,
      },
      flags: {
        transportOverDominated: true,
        lowSignal: true,
      },
    }, 3);

    expect(balancedAtCeiling.netPoints).toBeLessThanOrEqual(4);
    expect(balancedAtCeiling.adjustedLocationScore).toBe(100);
    expect(weakAtFloor.netPoints).toBeGreaterThanOrEqual(-6);
    expect(weakAtFloor.adjustedLocationScore).toBe(0);
  });

  it('pipeline records territorial signals and a separate trace modifier', () => {
    const analysis = buildAnalysis([
      syntheticNode(1, 0.001, 0.001, { office: 'yes', name: 'Office Fixture A' }),
      syntheticNode(2, 0.0012, 0.0011, { office: 'yes', name: 'Office Fixture B' }),
      syntheticNode(3, 0.0014, 0.0012, { office: 'yes', name: 'Office Fixture C' }),
      syntheticNode(4, 0.0016, 0.0013, { office: 'yes', name: 'Office Fixture D' }),
    ], ORIGIN.lat, ORIGIN.lon, { inputAddress: 'Fixture Office Zone, Moscow' });

    expect(analysis.territorialScoringSignals).toBeDefined();
    expect(analysis.commercialTerritorialModifier).toBeDefined();
    expect(analysis.locationScore!.location_score).toBe(analysis.scoringTrace!.finalScore);
    const territorialCap = analysis.scoringTrace!.capsApplied.find(c => c.kind === 'territorial_signals_headline');
    if (analysis.commercialTerritorialModifier!.applied) {
      expect(territorialCap).toBeDefined();
      expect(territorialCap!.scoreAfter).toBe(analysis.scoringTrace!.finalScore);
    }
  });

  it('scoring modifier source does not import raw H3 or gravity internals', () => {
    const modifierPath = fileURLToPath(new URL('../territorial-scoring-modifier.ts', import.meta.url));
    const gravityPath = fileURLToPath(new URL('../gravity-scoring.ts', import.meta.url));
    const src = readFileSync(modifierPath, 'utf8');
    const gravitySrc = readFileSync(gravityPath, 'utf8');
    expect(src).not.toMatch(/['"]\.\/h3['"]/);
    expect(src).not.toMatch(/['"]\.\/gravity-scoring['"]/);
    expect(src).toMatch(/territorialScoringSignals/);
    expect(gravitySrc).not.toMatch(/from ['"]\.\/h3['"]/);
    expect(gravitySrc).toMatch(/from ['"]\.\/territorial-scoring-bridge['"]/);
  });
});
