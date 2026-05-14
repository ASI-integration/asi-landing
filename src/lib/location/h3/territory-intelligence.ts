import type { H3Index } from 'h3-js';
import type { LocationAnalysis } from '../types';
import {
  DEFAULT_H3_RESOLUTION,
  h3CoverageCellsForRadius,
  normalizeH3Resolution,
  type H3Coordinate,
} from './geo-index';
import {
  buildH3MagnetDensitySummary,
  type H3MagnetAggregationOptions,
  type H3MagnetCategoryCounts,
  type H3MagnetDensityCell,
  type H3MagnetDensitySummary,
} from './magnet-aggregation';

export type H3TerritoryFunctionality = 'mixed' | 'mono_functional' | 'low_signal';
export type H3BusinessTravelerSignalLevel = 'weak' | 'moderate' | 'strong';

export interface H3TerritoryIntelligenceOptions extends H3MagnetAggregationOptions {
  coverageRadiusMeters?: number;
  coverageCells?: readonly H3Index[];
  lowDensityCellThreshold?: number;
  monoFunctionalShareThreshold?: number;
  maxExposedGapCells?: number;
}

export interface H3MonoFunctionalSignal {
  detected: boolean;
  category: keyof H3MagnetCategoryCounts | null;
  dominantShare: number;
  monoFunctionalCellCount: number;
  monoFunctionalCells: Array<{
    cell: H3Index;
    category: keyof H3MagnetCategoryCounts;
    share: number;
    totalCount: number;
  }>;
}

export interface H3DeadZoneSignal {
  coverageCellCount: number;
  occupiedCellCount: number;
  emptyCellCount: number;
  emptyCellRatio: number;
  lowDensityCellCount: number;
  lowDensityCellRatio: number;
  gapCellCount: number;
  gapRatio: number;
  sampleGapCells: H3Index[];
}

export interface H3BusinessTravelerSuitabilitySignals {
  level: H3BusinessTravelerSignalLevel;
  score: number;
  businessMagnetShare: number;
  transportAccessShare: number;
  businessTransportBalanceScore: number;
  mixedContextSupportScore: number;
  deadZoneFrictionScore: number;
  hasBusinessCore: boolean;
  hasTransportAccess: boolean;
  transportOverDominated: boolean;
}

export interface H3TerritoryComparisonVector {
  resolution: number;
  coverageRadiusMeters: number | null;
  coverageCellCount: number;
  countedMagnets: number;
  occupiedCellRatio: number;
  magnetDensityPerCell: number;
  categoryDiversityScore: number;
  topCategoryShare: number;
  transportDominanceRatio: number;
  deadZoneRatio: number;
  businessTravelerSuitabilityScore: number;
}

export interface H3TerritoryIntelligence {
  resolution: number;
  coverageRadiusMeters: number | null;
  countedMagnets: number;
  categoryTotals: H3MagnetCategoryCounts;
  categoryShares: H3MagnetCategoryCounts;
  categoryDiversityScore: number;
  topCategory: keyof H3MagnetCategoryCounts | null;
  topCategoryShare: number;
  functionality: H3TerritoryFunctionality;
  monoFunctional: H3MonoFunctionalSignal;
  transportDominanceRatio: number;
  deadZones: H3DeadZoneSignal;
  businessTravelerSuitability: H3BusinessTravelerSuitabilitySignals;
  comparisonVector: H3TerritoryComparisonVector;
}

const DEFAULT_TERRITORY_COVERAGE_RADIUS_M = 1_200;
const DEFAULT_LOW_DENSITY_CELL_THRESHOLD = 1;
const DEFAULT_MONO_FUNCTIONAL_SHARE_THRESHOLD = 0.7;
const DEFAULT_MAX_EXPOSED_GAP_CELLS = 12;

function roundRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, value) * 100) / 100;
}

function categoryKeys(counts: H3MagnetCategoryCounts): Array<keyof H3MagnetCategoryCounts> {
  return Object.keys(counts) as Array<keyof H3MagnetCategoryCounts>;
}

function categoryShares(counts: H3MagnetCategoryCounts, total: number): H3MagnetCategoryCounts {
  const shares = {} as H3MagnetCategoryCounts;
  for (const category of categoryKeys(counts)) {
    shares[category] = total > 0 ? roundRatio(counts[category] / total) : 0;
  }
  return shares;
}

function topCategoryFromShares(shares: H3MagnetCategoryCounts): {
  category: keyof H3MagnetCategoryCounts | null;
  share: number;
} {
  let category: keyof H3MagnetCategoryCounts | null = null;
  let share = 0;
  for (const key of categoryKeys(shares)) {
    if (shares[key] > share) {
      category = key;
      share = shares[key];
    }
  }
  return { category, share };
}

function categoryDiversityScore(counts: H3MagnetCategoryCounts, total: number): number {
  if (total <= 1) return 0;
  const keys = categoryKeys(counts);
  const entropy = keys.reduce((sum, category) => {
    const count = counts[category];
    if (count <= 0) return sum;
    const probability = count / total;
    return sum - probability * Math.log(probability);
  }, 0);

  return roundRatio(entropy / Math.log(keys.length));
}

function dominantShareForCell(cell: H3MagnetDensityCell): {
  category: keyof H3MagnetCategoryCounts | null;
  share: number;
} {
  if (cell.totalCount <= 0) return { category: null, share: 0 };
  const shares = categoryShares(cell.counts, cell.totalCount);
  return topCategoryFromShares(shares);
}

function buildMonoFunctionalSignal(args: {
  summary: H3MagnetDensitySummary;
  shares: H3MagnetCategoryCounts;
  threshold: number;
}): H3MonoFunctionalSignal {
  const top = topCategoryFromShares(args.shares);
  const monoFunctionalCells = args.summary.cells
    .map(cell => {
      const dominant = dominantShareForCell(cell);
      if (!dominant.category || dominant.share < args.threshold || cell.totalCount < 2) return null;
      return {
        cell: cell.cell,
        category: dominant.category,
        share: dominant.share,
        totalCount: cell.totalCount,
      };
    })
    .filter((cell): cell is NonNullable<typeof cell> => cell !== null);

  const detected =
    args.summary.countedMagnets >= 3 &&
    top.category != null &&
    top.share >= args.threshold;

  return {
    detected,
    category: top.category,
    dominantShare: top.share,
    monoFunctionalCellCount: monoFunctionalCells.length,
    monoFunctionalCells,
  };
}

function buildDeadZoneSignal(args: {
  summary: H3MagnetDensitySummary;
  coverageCells: readonly H3Index[];
  lowDensityCellThreshold: number;
  maxExposedGapCells: number;
}): H3DeadZoneSignal {
  const occupiedCells = new Set(args.summary.cells.map(cell => cell.cell));
  const coverageCells = args.coverageCells.length > 0
    ? Array.from(new Set(args.coverageCells))
    : args.summary.cells.map(cell => cell.cell);
  const coverageCellSet = new Set(coverageCells);
  const coverageCellCount = coverageCells.length;
  const emptyCells = coverageCells.filter(cell => !occupiedCells.has(cell));
  const lowDensityCells = args.summary.cells.filter(
    cell => coverageCellSet.has(cell.cell) && cell.totalCount <= args.lowDensityCellThreshold,
  );
  const gapCellCount = emptyCells.length + lowDensityCells.length;
  const emptyCellRatio = coverageCellCount > 0 ? roundRatio(emptyCells.length / coverageCellCount) : 0;
  const lowDensityCellRatio = coverageCellCount > 0 ? roundRatio(lowDensityCells.length / coverageCellCount) : 0;
  const weightedGapRatio = roundRatio(emptyCellRatio * 0.65 + lowDensityCellRatio * 0.35);

  return {
    coverageCellCount,
    occupiedCellCount: args.summary.cells.filter(cell => coverageCellSet.has(cell.cell)).length,
    emptyCellCount: emptyCells.length,
    emptyCellRatio,
    lowDensityCellCount: lowDensityCells.length,
    lowDensityCellRatio,
    gapCellCount,
    gapRatio: weightedGapRatio,
    sampleGapCells: [...emptyCells, ...lowDensityCells.map(cell => cell.cell)].slice(0, args.maxExposedGapCells),
  };
}

function calibrateDeadZoneRatio(args: {
  signal: H3DeadZoneSignal;
  countedMagnets: number;
  diversityScore: number;
  monoFunctional: H3MonoFunctionalSignal;
  businessTravelerSuitability: H3BusinessTravelerSuitabilitySignals;
}): number {
  const { signal, businessTravelerSuitability } = args;
  let ratio = signal.gapRatio;

  if (args.countedMagnets <= 0) {
    return 0;
  }

  if (args.countedMagnets >= 6 && args.diversityScore >= 0.45) {
    ratio *= 0.55;
  }

  if (args.diversityScore >= 0.67) {
    ratio = Math.min(ratio, 0.22);
  }

  if (businessTravelerSuitability.score >= 0.67 && !args.monoFunctional.detected) {
    ratio = Math.min(ratio, 0.24);
  }

  if (
    businessTravelerSuitability.hasTransportAccess &&
    businessTravelerSuitability.businessTransportBalanceScore >= 0.4 &&
    args.diversityScore >= 0.55
  ) {
    ratio = Math.min(ratio, 0.18);
  }

  if (
    args.countedMagnets <= 2 &&
    args.diversityScore < 0.25 &&
    businessTravelerSuitability.score < 0.35
  ) {
    ratio = Math.max(ratio, Math.min(1, signal.gapRatio + 0.15));
  }

  return roundRatio(ratio);
}

function businessTravelerLevel(score: number): H3BusinessTravelerSignalLevel {
  if (score >= 0.68) return 'strong';
  if (score >= 0.42) return 'moderate';
  return 'weak';
}

function buildBusinessTravelerSignals(args: {
  summary: H3MagnetDensitySummary;
  shares: H3MagnetCategoryCounts;
  diversityScore: number;
  deadZoneRatio: number;
}): H3BusinessTravelerSuitabilitySignals {
  const businessMagnetShare = args.shares.business;
  const transportAccessShare = args.shares.transport;
  const businessPresenceScore = roundRatio(Math.min(1, args.summary.categoryTotals.business / 4));
  const transportPresenceScore = roundRatio(Math.min(1, args.summary.categoryTotals.transport / 3));
  const businessTransportBalanceScore = roundRatio(
    Math.min(businessMagnetShare, transportAccessShare) / 0.22,
  );
  const mixedContextSupportScore = args.diversityScore;
  const deadZoneFrictionScore = roundRatio(1 - args.deadZoneRatio);
  const transportOverDominated =
    transportAccessShare >= 0.55 &&
    args.summary.categoryTotals.business < 2;
  const score = roundRatio(
    businessPresenceScore * 0.3 +
    transportPresenceScore * 0.22 +
    businessTransportBalanceScore * 0.18 +
    mixedContextSupportScore * 0.18 +
    deadZoneFrictionScore * 0.12 -
    (transportOverDominated ? 0.16 : 0),
  );

  return {
    level: businessTravelerLevel(score),
    score,
    businessMagnetShare,
    transportAccessShare,
    businessTransportBalanceScore,
    mixedContextSupportScore,
    deadZoneFrictionScore,
    hasBusinessCore: args.summary.categoryTotals.business >= 2 || businessMagnetShare >= 0.3,
    hasTransportAccess: args.summary.categoryTotals.transport >= 1,
    transportOverDominated,
  };
}

function coverageCellsForSummary(args: {
  summary: H3MagnetDensitySummary;
  origin?: H3Coordinate;
  options?: H3TerritoryIntelligenceOptions;
}): { coverageRadiusMeters: number | null; coverageCells: H3Index[] } {
  if (args.options?.coverageCells) {
    return {
      coverageRadiusMeters: args.options.coverageRadiusMeters ?? null,
      coverageCells: Array.from(args.options.coverageCells),
    };
  }

  const coverageRadiusMeters = args.options?.coverageRadiusMeters ?? DEFAULT_TERRITORY_COVERAGE_RADIUS_M;
  if (!args.origin) {
    return {
      coverageRadiusMeters: null,
      coverageCells: args.summary.cells.map(cell => cell.cell),
    };
  }

  const coverage = h3CoverageCellsForRadius(args.origin, coverageRadiusMeters, {
    analysisType: 'magnets',
    resolution: args.summary.resolution,
  });

  return {
    coverageRadiusMeters,
    coverageCells: coverage?.cells ?? args.summary.cells.map(cell => cell.cell),
  };
}

export function buildH3TerritoryIntelligence(args: {
  summary: H3MagnetDensitySummary;
  origin?: H3Coordinate;
  options?: H3TerritoryIntelligenceOptions;
}): H3TerritoryIntelligence {
  const summary = args.summary;
  const countedMagnets = summary.countedMagnets;
  const shares = categoryShares(summary.categoryTotals, countedMagnets);
  const top = topCategoryFromShares(shares);
  const diversityScore = categoryDiversityScore(summary.categoryTotals, countedMagnets);
  const monoFunctionalShareThreshold = roundRatio(
    args.options?.monoFunctionalShareThreshold ?? DEFAULT_MONO_FUNCTIONAL_SHARE_THRESHOLD,
  );
  const monoFunctional = buildMonoFunctionalSignal({
    summary,
    shares,
    threshold: monoFunctionalShareThreshold,
  });
  const coverage = coverageCellsForSummary({
    summary,
    origin: args.origin,
    options: args.options,
  });
  const rawDeadZones = buildDeadZoneSignal({
    summary,
    coverageCells: coverage.coverageCells,
    lowDensityCellThreshold: args.options?.lowDensityCellThreshold ?? DEFAULT_LOW_DENSITY_CELL_THRESHOLD,
    maxExposedGapCells: args.options?.maxExposedGapCells ?? DEFAULT_MAX_EXPOSED_GAP_CELLS,
  });
  const transportDominanceRatio = shares.transport;
  const businessTravelerSuitability = buildBusinessTravelerSignals({
    summary,
    shares,
    diversityScore,
    deadZoneRatio: rawDeadZones.gapRatio,
  });
  const deadZones = {
    ...rawDeadZones,
    gapRatio: calibrateDeadZoneRatio({
      signal: rawDeadZones,
      countedMagnets,
      diversityScore,
      monoFunctional,
      businessTravelerSuitability,
    }),
  };
  const coverageCellCount = deadZones.coverageCellCount;
  const occupiedCellRatio = coverageCellCount > 0 ? roundRatio(summary.cells.length / coverageCellCount) : 0;
  const magnetDensityPerCell = coverageCellCount > 0 ? roundMetric(countedMagnets / coverageCellCount) : 0;
  const functionality: H3TerritoryFunctionality =
    countedMagnets <= 1 ? 'low_signal' : monoFunctional.detected ? 'mono_functional' : 'mixed';

  return {
    resolution: normalizeH3Resolution(summary.resolution ?? DEFAULT_H3_RESOLUTION),
    coverageRadiusMeters: coverage.coverageRadiusMeters,
    countedMagnets,
    categoryTotals: summary.categoryTotals,
    categoryShares: shares,
    categoryDiversityScore: diversityScore,
    topCategory: top.category,
    topCategoryShare: top.share,
    functionality,
    monoFunctional,
    transportDominanceRatio,
    deadZones,
    businessTravelerSuitability,
    comparisonVector: {
      resolution: summary.resolution,
      coverageRadiusMeters: coverage.coverageRadiusMeters,
      coverageCellCount,
      countedMagnets,
      occupiedCellRatio,
      magnetDensityPerCell,
      categoryDiversityScore: diversityScore,
      topCategoryShare: top.share,
      transportDominanceRatio,
      deadZoneRatio: deadZones.gapRatio,
      businessTravelerSuitabilityScore: businessTravelerSuitability.score,
    },
  };
}

export function buildH3TerritoryIntelligenceForAnalysis(args: {
  analysis: Pick<LocationAnalysis, 'magnets'>;
  lat: number;
  lon: number;
  options?: H3TerritoryIntelligenceOptions;
}): H3TerritoryIntelligence {
  const resolution = normalizeH3Resolution(args.options?.resolution ?? DEFAULT_H3_RESOLUTION);
  const summary = buildH3MagnetDensitySummary({
    origin: { lat: args.lat, lon: args.lon },
    magnets: args.analysis.magnets,
    options: {
      resolution,
      maxDistanceMeters: args.options?.maxDistanceMeters,
      includeBoundaries: args.options?.includeBoundaries,
    },
  });

  return buildH3TerritoryIntelligence({
    summary,
    origin: { lat: args.lat, lon: args.lon },
    options: args.options,
  });
}
