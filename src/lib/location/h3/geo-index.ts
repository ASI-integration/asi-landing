import {
  UNITS,
  getHexagonEdgeLengthAvg,
  gridDisk,
  isValidCell,
  latLngToCell,
} from 'h3-js';
import type { H3Index } from 'h3-js';

export const DEFAULT_H3_RESOLUTION = 9;
export const DEFAULT_H3_MAX_RING_SIZE = 12;
export const DEFAULT_H3_MAX_CELLS = 600;

export type H3CoverageAnalysisType = 'magnets' | 'competition' | 'transport' | 'heatmap';

export interface H3CoverageProfile {
  resolution: number;
  maxRingSize: number;
  maxCellCount: number;
}

export const H3_COVERAGE_PROFILES: Record<H3CoverageAnalysisType, H3CoverageProfile> = {
  magnets: {
    resolution: DEFAULT_H3_RESOLUTION,
    maxRingSize: DEFAULT_H3_MAX_RING_SIZE,
    maxCellCount: DEFAULT_H3_MAX_CELLS,
  },
  competition: {
    resolution: 10,
    maxRingSize: 14,
    maxCellCount: 600,
  },
  transport: {
    resolution: 8,
    maxRingSize: 16,
    maxCellCount: 900,
  },
  heatmap: {
    resolution: DEFAULT_H3_RESOLUTION,
    maxRingSize: DEFAULT_H3_MAX_RING_SIZE,
    maxCellCount: DEFAULT_H3_MAX_CELLS,
  },
};

export interface H3Coordinate {
  lat: number;
  lon: number;
}

export interface H3CoverageOptions {
  analysisType?: H3CoverageAnalysisType;
  resolution?: number;
  maxRingSize?: number;
  maxCellCount?: number;
}

export interface H3RadiusCoverage {
  centerCell: H3Index;
  analysisType: H3CoverageAnalysisType;
  resolution: number;
  radiusMeters: number;
  requestedRingSize: number;
  ringSize: number;
  cells: H3Index[];
  capped: boolean;
}

export function isValidH3Coordinate(coord: H3Coordinate): boolean {
  return (
    Number.isFinite(coord.lat) &&
    Number.isFinite(coord.lon) &&
    coord.lat >= -90 &&
    coord.lat <= 90 &&
    coord.lon >= -180 &&
    coord.lon <= 180
  );
}

export function normalizeH3Resolution(resolution = DEFAULT_H3_RESOLUTION): number {
  if (!Number.isInteger(resolution) || resolution < 0 || resolution > 15) {
    return DEFAULT_H3_RESOLUTION;
  }

  return resolution;
}

export function h3CellFromLatLng(coord: H3Coordinate, resolution = DEFAULT_H3_RESOLUTION): H3Index | null {
  if (!isValidH3Coordinate(coord)) return null;

  try {
    return latLngToCell(coord.lat, coord.lon, normalizeH3Resolution(resolution));
  } catch {
    return null;
  }
}

export function h3DiskCells(centerCell: string | null | undefined, ringSize = 1): H3Index[] {
  if (!centerCell || !isValidCell(centerCell)) return [];

  const safeRingSize = normalizeRingSize(ringSize);
  try {
    return gridDisk(centerCell, safeRingSize);
  } catch {
    return [];
  }
}

export function h3NeighborCells(centerCell: string | null | undefined): H3Index[] {
  if (!centerCell) return [];

  return h3DiskCells(centerCell, 1).filter(cell => cell !== centerCell);
}

export function h3RingCells(centerCell: string | null | undefined, ringSize = 1): H3Index[] {
  if (!centerCell) return [];

  const safeRingSize = normalizeRingSize(ringSize);
  if (safeRingSize === 0) return [centerCell].filter(isValidCell);

  const outerDisk = h3DiskCells(centerCell, safeRingSize);
  const innerDisk = new Set(h3DiskCells(centerCell, safeRingSize - 1));
  return outerDisk.filter(cell => !innerDisk.has(cell));
}

export function h3CoverageCellsForRadius(
  coord: H3Coordinate,
  radiusMeters: number,
  options: H3CoverageOptions = {},
): H3RadiusCoverage | null {
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0) return null;

  const analysisType = normalizeH3CoverageAnalysisType(options.analysisType);
  const profile = H3_COVERAGE_PROFILES[analysisType];
  const resolution = normalizeH3Resolution(options.resolution ?? profile.resolution);
  const centerCell = h3CellFromLatLng(coord, resolution);
  if (!centerCell) return null;

  const requestedRingSize = approximateRingSizeForRadius(radiusMeters, resolution);
  const maxRingSize = normalizeRingSize(options.maxRingSize ?? profile.maxRingSize);
  const maxCells = normalizeMaxCellCount(options.maxCellCount ?? profile.maxCellCount);
  const maxRingForCells = maxRingSizeForCellCount(maxCells);
  const ringSize = Math.min(requestedRingSize, maxRingSize, maxRingForCells);

  return {
    centerCell,
    analysisType,
    resolution,
    radiusMeters,
    requestedRingSize,
    ringSize,
    cells: h3DiskCells(centerCell, ringSize),
    capped: ringSize < requestedRingSize,
  };
}

/**
 * Scoring integration note: future soft evidence gates can consume these cells
 * to group magnets spatially, while keeping current magnet weights and final
 * score logic unchanged until scoring integration is explicitly enabled.
 */
export function approximateRingSizeForRadius(radiusMeters: number, resolution = DEFAULT_H3_RESOLUTION): number {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return 0;

  const safeResolution = normalizeH3Resolution(resolution);
  try {
    const edgeLengthMeters = getHexagonEdgeLengthAvg(safeResolution, UNITS.m);
    const centerSpacingMeters = edgeLengthMeters * Math.sqrt(3);
    return normalizeRingSize(Math.ceil(radiusMeters / centerSpacingMeters));
  } catch {
    return 0;
  }
}

function normalizeRingSize(ringSize: number): number {
  if (!Number.isFinite(ringSize) || ringSize <= 0) return 0;
  return Math.floor(ringSize);
}

function normalizeH3CoverageAnalysisType(
  analysisType: H3CoverageOptions['analysisType'],
): H3CoverageAnalysisType {
  return analysisType && analysisType in H3_COVERAGE_PROFILES ? analysisType : 'magnets';
}

function normalizeMaxCellCount(maxCellCount: number): number {
  if (!Number.isFinite(maxCellCount) || maxCellCount < 1) return 1;
  return Math.floor(maxCellCount);
}

function maxRingSizeForCellCount(maxCellCount: number): number {
  if (maxCellCount <= 1) return 0;

  return Math.floor((-3 + Math.sqrt(12 * maxCellCount - 3)) / 6);
}
