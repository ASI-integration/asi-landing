import { describe, expect, it } from 'vitest';
import type { LocationAnalysis, MagnetItem } from '../../types';
import {
  buildH3MagnetDensitySummary,
  buildH3MagnetDensitySummaryForAnalysis,
  h3AggregationCategoryForMagnet,
} from '../magnet-aggregation';

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

describe('H3 magnet aggregation', () => {
  it('aggregates nearby magnets into H3 cells with required category counts', () => {
    const summary = buildH3MagnetDensitySummary({
      origin: ORIGIN,
      magnets: [
        magnet({ name: 'Metro A', categoryId: 'metro', attractionScore: 9 }),
        magnet({ name: 'Hospital A', categoryId: 'hospital', attractionScore: 7 }),
        magnet({ name: 'University A', categoryId: 'university', attractionScore: 6 }),
        magnet({ name: 'Office A', categoryId: 'business', attractionScore: 5 }),
        magnet({ name: 'Museum A', categoryId: 'attraction', attractionScore: 8 }),
      ],
      options: { resolution: 9 },
    });

    expect(summary.resolution).toBe(9);
    expect(summary.countedMagnets).toBe(5);
    expect(summary.categoryTotals).toEqual({
      transport: 1,
      medical: 1,
      education: 1,
      business: 1,
      tourism: 1,
    });
    expect(summary.cells[0].totalCount).toBe(5);
    expect(summary.cells[0].counts.transport).toBe(1);
    expect(summary.cells[0].counts.tourism).toBe(1);
  });

  it('deduplicates the same magnet inside the same effective H3 cell', () => {
    const summary = buildH3MagnetDensitySummary({
      origin: ORIGIN,
      magnets: [
        magnet({ name: 'Metro A', categoryId: 'metro', distance: 90 }),
        magnet({ name: ' metro  a ', categoryId: 'metro', distance: 92 }),
        magnet({ name: 'Metro A', categoryId: 'metro', lat: ORIGIN.lat + 0.01, distance: 900 }),
      ],
      options: { resolution: 9 },
    });

    expect(summary.totalInputMagnets).toBe(3);
    expect(summary.countedMagnets).toBe(2);
    expect(summary.duplicateMagnets).toBe(1);
    expect(summary.categoryTotals.transport).toBe(2);
  });

  it('exposes heatmap-ready cell centers, optional boundaries, and normalized intensity', () => {
    const summary = buildH3MagnetDensitySummary({
      origin: ORIGIN,
      magnets: [
        magnet({ name: 'Mall A', categoryId: 'shopping_major', attractionScore: 10 }),
        magnet({ name: 'Office A', categoryId: 'business', lat: ORIGIN.lat + 0.01, attractionScore: 2 }),
      ],
      options: { resolution: 9, includeBoundaries: true },
    });

    expect(summary.cells).toHaveLength(2);
    expect(summary.cells[0].intensity).toBe(1);
    expect(summary.cells[0].center.lat).toEqual(expect.any(Number));
    expect(summary.cells[0].center.lon).toEqual(expect.any(Number));
    expect(summary.cells[0].boundary?.length).toBeGreaterThanOrEqual(6);
  });

  it('supports lightweight filtering by effective magnet distance', () => {
    const summary = buildH3MagnetDensitySummary({
      origin: ORIGIN,
      magnets: [
        magnet({ name: 'Hospital A', categoryId: 'hospital', distance: 300 }),
        magnet({ name: 'Airport B', categoryId: 'airport', distance: 3_500 }),
      ],
      options: { maxDistanceMeters: 1_000 },
    });

    expect(summary.countedMagnets).toBe(1);
    expect(summary.categoryTotals.medical).toBe(1);
    expect(summary.categoryTotals.transport).toBe(0);
  });

  it('builds from an analysis without mutating score fields', () => {
    const analysis = {
      evergreenIndex: 74,
      magnets: [
        magnet({ name: 'Office A', categoryId: 'business' }),
        magnet({ name: 'Museum A', categoryId: 'attraction' }),
      ],
    } as Pick<LocationAnalysis, 'evergreenIndex' | 'magnets'>;
    const beforeScore = analysis.evergreenIndex;

    const summary = buildH3MagnetDensitySummaryForAnalysis({
      analysis,
      lat: ORIGIN.lat,
      lon: ORIGIN.lon,
    });

    expect(summary.countedMagnets).toBe(2);
    expect(analysis.evergreenIndex).toBe(beforeScore);
  });

  it('keeps aggregation categories separate from unknown taxonomy ids', () => {
    expect(h3AggregationCategoryForMagnet({ categoryId: 'food' })).toBeNull();
    expect(h3AggregationCategoryForMagnet({ categoryId: 'business' })).toBe('business');
  });
});
