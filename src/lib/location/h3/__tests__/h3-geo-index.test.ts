import { describe, expect, it } from 'vitest';
import {
  H3_COVERAGE_PROFILES,
  h3CellFromLatLng,
  h3CoverageCellsForRadius,
  h3NeighborCells,
  h3RingCells,
  isValidH3Coordinate,
} from '../geo-index';

const MOSCOW_CENTER = { lat: 55.7522, lon: 37.6156 };

describe('H3 geo-index utilities', () => {
  it('converts valid coordinates into a stable H3 cell', () => {
    expect(h3CellFromLatLng(MOSCOW_CENTER, 9)).toBe('8911aa7aaafffff');
  });

  it('handles invalid coordinates safely', () => {
    expect(isValidH3Coordinate({ lat: 91, lon: 37.6156 })).toBe(false);
    expect(h3CellFromLatLng({ lat: Number.NaN, lon: 37.6156 }, 9)).toBeNull();
    expect(h3CoverageCellsForRadius({ lat: 55.7522, lon: 181 }, 500, { resolution: 9 })).toBeNull();
    expect(h3NeighborCells('not-a-cell')).toEqual([]);
  });

  it('returns expected neighbor and ring structures', () => {
    const centerCell = h3CellFromLatLng(MOSCOW_CENTER, 9);
    const neighbors = h3NeighborCells(centerCell);
    const ringTwo = h3RingCells(centerCell, 2);

    expect(neighbors).toHaveLength(6);
    expect(neighbors).not.toContain(centerCell);
    expect(ringTwo).toHaveLength(12);
    expect(new Set(ringTwo).size).toBe(ringTwo.length);
  });

  it('approximates radius coverage without unbounded cell growth', () => {
    const coverage = h3CoverageCellsForRadius(MOSCOW_CENTER, 5_000, {
      resolution: 10,
      maxCellCount: 200,
    });

    expect(coverage).not.toBeNull();
    if (!coverage) throw new Error('Expected H3 coverage result');

    expect(coverage.cells.length).toBeLessThanOrEqual(200);
    expect(coverage.capped).toBe(true);
    expect(coverage.cells).toContain(coverage.centerCell);
  });

  it('uses the canonical magnets profile for a small city radius', () => {
    const coverage = h3CoverageCellsForRadius(MOSCOW_CENTER, 800, {
      analysisType: 'magnets',
    });

    expect(coverage).not.toBeNull();
    if (!coverage) throw new Error('Expected H3 coverage result');

    expect(coverage.analysisType).toBe('magnets');
    expect(coverage.resolution).toBe(H3_COVERAGE_PROFILES.magnets.resolution);
    expect(coverage.capped).toBe(false);
    expect(coverage.ringSize).toBeGreaterThanOrEqual(2);
    expect(coverage.cells).toContain(coverage.centerCell);
  });

  it('supports a large metro radius through the same coverage pipeline', () => {
    const coverage = h3CoverageCellsForRadius(MOSCOW_CENTER, 3_000, {
      analysisType: 'heatmap',
    });

    expect(coverage).not.toBeNull();
    if (!coverage) throw new Error('Expected H3 coverage result');

    expect(coverage.analysisType).toBe('heatmap');
    expect(coverage.resolution).toBe(H3_COVERAGE_PROFILES.heatmap.resolution);
    expect(coverage.capped).toBe(false);
    expect(coverage.cells.length).toBeGreaterThan(150);
    expect(coverage.cells.length).toBeLessThanOrEqual(H3_COVERAGE_PROFILES.heatmap.maxCellCount);
  });

  it('uses the transport profile for airport extended radius coverage', () => {
    const coverage = h3CoverageCellsForRadius(MOSCOW_CENTER, 8_000, {
      analysisType: 'transport',
    });

    expect(coverage).not.toBeNull();
    if (!coverage) throw new Error('Expected H3 coverage result');

    expect(coverage.analysisType).toBe('transport');
    expect(coverage.resolution).toBe(H3_COVERAGE_PROFILES.transport.resolution);
    expect(coverage.capped).toBe(false);
    expect(coverage.ringSize).toBeGreaterThanOrEqual(8);
    expect(coverage.cells.length).toBeLessThanOrEqual(H3_COVERAGE_PROFILES.transport.maxCellCount);
  });

  it('caps cell explosion for high-resolution extended coverage', () => {
    const coverage = h3CoverageCellsForRadius(MOSCOW_CENTER, 8_000, {
      analysisType: 'competition',
      maxCellCount: 180,
    });

    expect(coverage).not.toBeNull();
    if (!coverage) throw new Error('Expected H3 coverage result');

    expect(coverage.analysisType).toBe('competition');
    expect(coverage.resolution).toBe(H3_COVERAGE_PROFILES.competition.resolution);
    expect(coverage.capped).toBe(true);
    expect(coverage.requestedRingSize).toBeGreaterThan(coverage.ringSize);
    expect(coverage.cells.length).toBeLessThanOrEqual(180);
  });
});
