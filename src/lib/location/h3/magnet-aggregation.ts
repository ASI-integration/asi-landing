import {
  cellToBoundary,
  cellToLatLng,
  isValidCell,
} from 'h3-js';
import type { H3Index } from 'h3-js';
import type { LocationAnalysis, MagnetItem } from '../types';
import {
  DEFAULT_H3_RESOLUTION,
  h3CellFromLatLng,
  normalizeH3Resolution,
  type H3Coordinate,
} from './geo-index';

export type H3MagnetAggregationCategory =
  | 'transport'
  | 'medical'
  | 'education'
  | 'business'
  | 'tourism';

export type H3MagnetCategoryCounts = Record<H3MagnetAggregationCategory, number>;

export interface H3MagnetAggregationOptions {
  resolution?: number;
  maxDistanceMeters?: number;
  includeBoundaries?: boolean;
}

export interface H3MagnetDensityCell {
  cell: H3Index;
  center: H3Coordinate;
  totalCount: number;
  counts: H3MagnetCategoryCounts;
  dominantCategory: H3MagnetAggregationCategory | null;
  attractionScoreSum: number;
  intensity: number;
  magnetNames: string[];
  boundary?: H3Coordinate[];
}

export interface H3MagnetDensitySummary {
  resolution: number;
  originCell: H3Index | null;
  totalInputMagnets: number;
  countedMagnets: number;
  duplicateMagnets: number;
  cellCount: number;
  categoryTotals: H3MagnetCategoryCounts;
  maxCellCount: number;
  maxCellAttractionScore: number;
  cells: H3MagnetDensityCell[];
}

const AGGREGATION_CATEGORIES: H3MagnetAggregationCategory[] = [
  'transport',
  'medical',
  'education',
  'business',
  'tourism',
];

const CATEGORY_ID_TO_AGGREGATION_CATEGORY: Record<string, H3MagnetAggregationCategory | undefined> = {
  metro: 'transport',
  airport: 'transport',
  railway_station: 'transport',
  strategicTransportHub: 'transport',
  hospital: 'medical',
  specializedMedicalAnchor: 'medical',
  university: 'education',
  education_local: 'education',
  business: 'business',
  convention: 'business',
  attraction: 'tourism',
  entertainment: 'tourism',
  shopping_major: 'tourism',
  stadium: 'tourism',
  major_hotel: 'tourism',
  mid_hotel: 'tourism',
};

function emptyCategoryCounts(): H3MagnetCategoryCounts {
  return {
    transport: 0,
    medical: 0,
    education: 0,
    business: 0,
    tourism: 0,
  };
}

export function h3AggregationCategoryForMagnet(
  magnet: Pick<MagnetItem, 'categoryId'>,
): H3MagnetAggregationCategory | null {
  return CATEGORY_ID_TO_AGGREGATION_CATEGORY[magnet.categoryId] ?? null;
}

function normalizeMagnetName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function magnetDeduplicationKey(args: {
  magnet: MagnetItem;
  category: H3MagnetAggregationCategory;
  cell: H3Index;
}): string {
  const { magnet, category, cell } = args;
  return [
    cell,
    category,
    magnet.categoryId,
    magnet.subType ?? '',
    normalizeMagnetName(magnet.name),
  ].join('|');
}

function h3CellCenter(cell: H3Index): H3Coordinate | null {
  if (!isValidCell(cell)) return null;
  const [lat, lon] = cellToLatLng(cell);
  return { lat, lon };
}

function h3CellBoundary(cell: H3Index): H3Coordinate[] {
  if (!isValidCell(cell)) return [];
  return cellToBoundary(cell).map(([lat, lon]) => ({ lat, lon }));
}

function dominantCategory(counts: H3MagnetCategoryCounts): H3MagnetAggregationCategory | null {
  let best: H3MagnetAggregationCategory | null = null;
  let bestCount = 0;
  for (const category of AGGREGATION_CATEGORIES) {
    const count = counts[category];
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

export function buildH3MagnetDensitySummary(args: {
  origin?: H3Coordinate;
  magnets: readonly MagnetItem[];
  options?: H3MagnetAggregationOptions;
}): H3MagnetDensitySummary {
  const resolution = normalizeH3Resolution(args.options?.resolution ?? DEFAULT_H3_RESOLUTION);
  const maxDistanceMeters = args.options?.maxDistanceMeters;
  const includeBoundaries = args.options?.includeBoundaries === true;
  const originCell = args.origin ? h3CellFromLatLng(args.origin, resolution) : null;
  const categoryTotals = emptyCategoryCounts();
  const byCell = new Map<H3Index, {
    counts: H3MagnetCategoryCounts;
    totalCount: number;
    attractionScoreSum: number;
    magnetNames: string[];
  }>();
  const seen = new Set<string>();
  let countedMagnets = 0;
  let duplicateMagnets = 0;

  for (const magnet of args.magnets) {
    if (
      maxDistanceMeters != null &&
      Number.isFinite(maxDistanceMeters) &&
      magnet.distance > maxDistanceMeters
    ) {
      continue;
    }

    const category = h3AggregationCategoryForMagnet(magnet);
    if (!category) continue;

    const cell = h3CellFromLatLng({ lat: magnet.lat, lon: magnet.lon }, resolution);
    if (!cell) continue;

    const dedupeKey = magnetDeduplicationKey({ magnet, category, cell });
    if (seen.has(dedupeKey)) {
      duplicateMagnets += 1;
      continue;
    }
    seen.add(dedupeKey);

    let row = byCell.get(cell);
    if (!row) {
      row = {
        counts: emptyCategoryCounts(),
        totalCount: 0,
        attractionScoreSum: 0,
        magnetNames: [],
      };
      byCell.set(cell, row);
    }

    row.totalCount += 1;
    row.counts[category] += 1;
    row.attractionScoreSum += Number.isFinite(magnet.attractionScore) ? magnet.attractionScore : 0;
    if (row.magnetNames.length < 5) row.magnetNames.push(magnet.name);
    categoryTotals[category] += 1;
    countedMagnets += 1;
  }

  const maxCellCount = Math.max(...Array.from(byCell.values()).map(row => row.totalCount), 0);
  const maxCellAttractionScore = Math.max(...Array.from(byCell.values()).map(row => row.attractionScoreSum), 0);
  const cells = Array.from(byCell.entries())
    .map(([cell, row]): H3MagnetDensityCell | null => {
      const center = h3CellCenter(cell);
      if (!center) return null;
      return {
        cell,
        center,
        totalCount: row.totalCount,
        counts: row.counts,
        dominantCategory: dominantCategory(row.counts),
        attractionScoreSum: Math.round(row.attractionScoreSum * 100) / 100,
        intensity: maxCellAttractionScore > 0
          ? Math.round((row.attractionScoreSum / maxCellAttractionScore) * 100) / 100
          : 0,
        magnetNames: row.magnetNames,
        ...(includeBoundaries ? { boundary: h3CellBoundary(cell) } : {}),
      };
    })
    .filter((cell): cell is H3MagnetDensityCell => cell !== null)
    .sort((a, b) => {
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
      if (b.attractionScoreSum !== a.attractionScoreSum) return b.attractionScoreSum - a.attractionScoreSum;
      return a.cell.localeCompare(b.cell);
    });

  return {
    resolution,
    originCell,
    totalInputMagnets: args.magnets.length,
    countedMagnets,
    duplicateMagnets,
    cellCount: cells.length,
    categoryTotals,
    maxCellCount,
    maxCellAttractionScore: Math.round(maxCellAttractionScore * 100) / 100,
    cells,
  };
}

export function buildH3MagnetDensitySummaryForAnalysis(args: {
  analysis: Pick<LocationAnalysis, 'magnets'>;
  lat: number;
  lon: number;
  options?: H3MagnetAggregationOptions;
}): H3MagnetDensitySummary {
  return buildH3MagnetDensitySummary({
    origin: { lat: args.lat, lon: args.lon },
    magnets: args.analysis.magnets,
    options: args.options,
  });
}
