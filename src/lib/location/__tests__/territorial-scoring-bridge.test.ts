import { describe, expect, it } from 'vitest';
import type { MagnetItem } from '../types';
import {
  TERRITORIAL_SCORING_BRIDGE_VERSION,
  buildTerritorialScoringBridgeSignals,
  buildTerritorialScoringSignalsForAnalysis,
} from '../territorial-scoring-bridge';

const ORIGIN = { lat: 55.7522, lon: 37.6156 };

function magnet(
  partial: Partial<MagnetItem> & Pick<MagnetItem, 'categoryId' | 'name'>,
): MagnetItem {
  return {
    categoryLabel: partial.categoryId,
    icon: '+',
    lat: ORIGIN.lat,
    lon: ORIGIN.lon,
    distance: 120,
    weight: 5,
    permanenceType: 'permanent',
    scopeLevel: 'district',
    strengthClass: 'medium',
    attractionScore: 4,
    ...partial,
  };
}

describe('territorial scoring bridge', () => {
  it('emits stable normalized signals without score weights', () => {
    const signals = buildTerritorialScoringBridgeSignals({
      countedSignals: 8,
      coverageUnits: 10,
      coverageRadiusMeters: 1200.4,
      diversityScore: 1.2,
      businessSuitabilityScore: 0.63,
      transportBalanceScore: -0.2,
      monoFunctional: {
        detected: false,
        dominantShare: 0.82,
        dominantCategory: 'business',
      },
      deadZone: {
        gapRatio: 0.18,
        emptyUnitRatio: 0.1,
        lowDensityUnitRatio: 0.08,
      },
    });

    expect(signals.version).toBe(TERRITORIAL_SCORING_BRIDGE_VERSION);
    expect(signals.signalQuality).toBe('high');
    expect(signals.coverageRadiusMeters).toBe(1200);
    expect(signals.diversity).toEqual({ value: 1, level: 'strong' });
    expect(signals.businessSuitability).toEqual({ value: 0.63, level: 'moderate' });
    expect(signals.transportBalance).toEqual({ value: 0, level: 'none' });
    expect(signals.monoFunctionalPenalty.value).toBe(0);
  });

  it('exposes mono-functional and dead-zone penalty intensities as normalized signals', () => {
    const signals = buildTerritorialScoringBridgeSignals({
      countedSignals: 4,
      coverageUnits: 6,
      coverageRadiusMeters: null,
      diversityScore: 0.22,
      businessSuitabilityScore: 0.35,
      transportBalanceScore: 0.12,
      monoFunctional: {
        detected: true,
        dominantShare: 0.74,
        dominantCategory: 'transport',
      },
      deadZone: {
        gapRatio: 0.68,
        emptyUnitRatio: 0.5,
        lowDensityUnitRatio: 0.18,
      },
      flags: {
        transportOverDominated: true,
        lowSignal: false,
      },
    });

    expect(signals.signalQuality).toBe('medium');
    expect(signals.monoFunctionalPenalty).toMatchObject({
      value: 0.74,
      level: 'high',
      detected: true,
      dominantCategory: 'transport',
    });
    expect(signals.deadZonePenalty).toMatchObject({
      value: 0.68,
      level: 'high',
      gapRatio: 0.68,
      emptyUnitRatio: 0.5,
      lowDensityUnitRatio: 0.18,
    });
    expect(signals.flags.transportOverDominated).toBe(true);
  });

  it('suppresses dead-zone penalty for strong diversity and healthy business context', () => {
    const signals = buildTerritorialScoringBridgeSignals({
      countedSignals: 9,
      coverageUnits: 16,
      coverageRadiusMeters: 1200,
      diversityScore: 0.78,
      businessSuitabilityScore: 0.72,
      transportBalanceScore: 0.58,
      monoFunctional: {
        detected: false,
        dominantShare: 0.34,
        dominantCategory: null,
      },
      deadZone: {
        gapRatio: 0.92,
        emptyUnitRatio: 0.78,
        lowDensityUnitRatio: 0.14,
      },
      flags: {
        hasBusinessCore: true,
        hasTransportAccess: true,
      },
    });

    expect(signals.deadZonePenalty.value).toBeLessThanOrEqual(0.18);
    expect(signals.deadZonePenalty.level).toBe('low');
  });

  it('suppresses dead-zone penalty for strong business suitability without mono-functional evidence', () => {
    const signals = buildTerritorialScoringBridgeSignals({
      countedSignals: 7,
      coverageUnits: 14,
      coverageRadiusMeters: 1200,
      diversityScore: 0.42,
      businessSuitabilityScore: 0.74,
      transportBalanceScore: 0.18,
      monoFunctional: {
        detected: false,
        dominantShare: 0.48,
        dominantCategory: 'business',
      },
      deadZone: {
        gapRatio: 0.91,
        emptyUnitRatio: 0.76,
        lowDensityUnitRatio: 0.15,
      },
      flags: {
        hasBusinessCore: true,
      },
    });

    expect(signals.deadZonePenalty.value).toBeLessThanOrEqual(0.24);
    expect(signals.deadZonePenalty.level).toBe('low');
  });

  it('preserves strong dead-zone penalty for sparse low-signal territory', () => {
    const signals = buildTerritorialScoringBridgeSignals({
      countedSignals: 1,
      coverageUnits: 12,
      coverageRadiusMeters: 1200,
      diversityScore: 0.05,
      businessSuitabilityScore: 0.04,
      transportBalanceScore: 0,
      monoFunctional: {
        detected: false,
        dominantShare: 0,
        dominantCategory: null,
      },
      deadZone: {
        gapRatio: 0.78,
        emptyUnitRatio: 0.72,
        lowDensityUnitRatio: 0.06,
      },
      flags: {
        lowSignal: true,
      },
    });

    expect(signals.deadZonePenalty.value).toBeGreaterThanOrEqual(0.9);
    expect(signals.deadZonePenalty.level).toBe('high');
  });

  it('does not convert missing territorial evidence into a dead-zone penalty', () => {
    const signals = buildTerritorialScoringBridgeSignals({
      countedSignals: 0,
      coverageUnits: 30,
      coverageRadiusMeters: 1200,
      diversityScore: 0,
      businessSuitabilityScore: 0,
      transportBalanceScore: 0,
      monoFunctional: {
        detected: false,
        dominantShare: 0,
        dominantCategory: null,
      },
      deadZone: {
        gapRatio: 1,
        emptyUnitRatio: 1,
        lowDensityUnitRatio: 0,
      },
      flags: {
        lowSignal: true,
      },
    });

    expect(signals.signalQuality).toBe('none');
    expect(signals.deadZonePenalty).toMatchObject({ value: 0, level: 'none' });
  });

  it('calibrates deterministic dead-zone bridge fixtures without live Overpass', () => {
    const noEvidence = buildTerritorialScoringBridgeSignals({
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
    const denseMixedDiverse = buildTerritorialScoringBridgeSignals({
      countedSignals: 8,
      coverageUnits: 11,
      coverageRadiusMeters: 1200,
      diversityScore: 0.86,
      businessSuitabilityScore: 0.64,
      transportBalanceScore: 0.36,
      monoFunctional: { detected: false, dominantShare: 0.25, dominantCategory: null },
      deadZone: { gapRatio: 0.92, emptyUnitRatio: 0.86, lowDensityUnitRatio: 0.06 },
    });
    const businessSuitableDiverse = buildTerritorialScoringBridgeSignals({
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
    const transportDiverse = buildTerritorialScoringBridgeSignals({
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
    const levittownLikeSparseMonoFunctional = buildTerritorialScoringBridgeSignals({
      countedSignals: 3,
      coverageUnits: 12,
      coverageRadiusMeters: 1200,
      diversityScore: 0,
      businessSuitabilityScore: 0.18,
      transportBalanceScore: 0,
      monoFunctional: { detected: true, dominantShare: 1, dominantCategory: 'tourism' },
      deadZone: { gapRatio: 0.6, emptyUnitRatio: 0.9, lowDensityUnitRatio: 0 },
    });

    expect(noEvidence.deadZonePenalty.value).toBe(0);
    expect(denseMixedDiverse.deadZonePenalty.value).toBeLessThanOrEqual(0.22);
    expect(denseMixedDiverse.deadZonePenalty.level).toBe('low');
    expect(businessSuitableDiverse.deadZonePenalty.value).toBeLessThanOrEqual(0.22);
    expect(businessSuitableDiverse.deadZonePenalty.level).toBe('low');
    expect(transportDiverse.deadZonePenalty.value).toBeLessThanOrEqual(0.18);
    expect(transportDiverse.deadZonePenalty.level).toBe('low');
    expect(levittownLikeSparseMonoFunctional.deadZonePenalty.value).toBeGreaterThanOrEqual(0.4);
    expect(levittownLikeSparseMonoFunctional.deadZonePenalty.level).toBe('moderate');
  });

  it('hides raw H3 internals behind the analysis bridge helper', () => {
    const signals = buildTerritorialScoringSignalsForAnalysis({
      analysis: {
        magnets: [
          magnet({ name: 'Office A', categoryId: 'business' }),
          magnet({ name: 'Office B', categoryId: 'convention', lat: ORIGIN.lat + 0.001 }),
          magnet({ name: 'Metro A', categoryId: 'metro', lon: ORIGIN.lon + 0.001 }),
          magnet({ name: 'Hotel A', categoryId: 'major_hotel', lat: ORIGIN.lat + 0.002 }),
          magnet({ name: 'University A', categoryId: 'university', lon: ORIGIN.lon + 0.002 }),
        ],
      },
      lat: ORIGIN.lat,
      lon: ORIGIN.lon,
      options: {
        coverageRadiusMeters: 800,
      },
    });

    expect(signals.countedSignals).toBe(5);
    expect(signals.diversity.value).toBeGreaterThan(0);
    expect(signals.businessSuitability.value).toBeGreaterThan(0);
    expect(signals.transportBalance.value).toBeGreaterThan(0);

    const serialized = JSON.stringify(signals);
    expect(serialized).not.toContain('h3');
    expect(serialized).not.toContain('cell');
    expect(serialized).not.toContain('sampleGapCells');
  });
});
