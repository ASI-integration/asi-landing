import { gridDisk, latLngToCell } from 'h3-js';
import type { LocationAnalysis, MagnetItem } from '../types';

export type H3DiagnosticsResolution = 8 | 9 | 10;
export type H3ClusterType = 'medical' | 'transport' | 'tourism' | 'business';
export type H3ClusterConfidence = 'none' | 'low' | 'medium' | 'high';

export interface H3DiagnosticPoi {
  id?: string;
  name: string;
  categoryId: string;
  subType?: string;
  lat: number;
  lon: number;
  distanceMeters?: number;
  attractionScore?: number;
}

export interface H3DiagnosticContext {
  source?: string;
  rawObjectsCount?: number;
  confidence?: 'high' | 'medium' | 'low';
  usedFallbackQuery?: boolean;
}

export interface H3DiagnosticsInput {
  lat: number;
  lon: number;
  pois: readonly H3DiagnosticPoi[];
  context?: H3DiagnosticContext;
  resolution?: H3DiagnosticsResolution;
}

export interface H3CategoryDensityCell {
  total: number;
  categories: Record<string, number>;
  clusterTypes: Partial<Record<H3ClusterType, number>>;
}

export interface H3ClusterEvidenceSummary {
  type: H3ClusterType;
  poiCount: number;
  occupiedCellCount: number;
  strongestCellCount: number;
  score: number;
  confidence: H3ClusterConfidence;
  evidenceNames: string[];
}

export interface H3PoiCellAssignment {
  name: string;
  categoryId: string;
  clusterTypes: H3ClusterType[];
  clusterQuality: Partial<Record<H3ClusterType, number>>;
  cell: string;
  distanceMeters?: number;
}

export interface H3Diagnostics {
  resolution: H3DiagnosticsResolution;
  centerCell: string;
  neighboringCells: string[];
  ringCells: string[];
  poiCountByCell: Record<string, number>;
  categoryDensityByCell: Record<string, H3CategoryDensityCell>;
  poiCells: H3PoiCellAssignment[];
  medicalClusterScore: number;
  transportClusterScore: number;
  tourismClusterScore: number;
  businessClusterScore: number;
  isolatedPoiPenaltySignal: number;
  clusterConfidence: H3ClusterConfidence;
  dominantClusterTypes: H3ClusterType[];
  evidenceSummary: H3ClusterEvidenceSummary[];
  context?: H3DiagnosticContext;
}

const DEFAULT_RESOLUTION: H3DiagnosticsResolution = 9;
const CLUSTER_TYPES: H3ClusterType[] = ['medical', 'transport', 'tourism', 'business'];

const CATEGORY_CLUSTER_TYPES: Record<string, H3ClusterType[]> = {
  hospital: ['medical'],
  specializedMedicalAnchor: ['medical'],
  metro: ['transport'],
  airport: ['transport'],
  railway_station: ['transport'],
  strategicTransportHub: ['transport'],
  attraction: ['tourism'],
  entertainment: ['tourism'],
  shopping_major: ['tourism'],
  stadium: ['tourism'],
  major_hotel: ['tourism'],
  mid_hotel: ['tourism'],
  business: ['business'],
  convention: ['business'],
  university: ['business'],
  civic: ['business'],
};

function normalizeResolution(resolution: H3DiagnosticsInput['resolution']): H3DiagnosticsResolution {
  return resolution === 8 || resolution === 10 ? resolution : DEFAULT_RESOLUTION;
}

function roundSignal(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function confidenceFromScore(score: number): H3ClusterConfidence {
  if (score >= 0.72) return 'high';
  if (score >= 0.48) return 'medium';
  if (score >= 0.22) return 'low';
  return 'none';
}

function clusterTypesForCategory(categoryId: string): H3ClusterType[] {
  return CATEGORY_CLUSTER_TYPES[categoryId] ?? [];
}

function clusterQualityForPoi(type: H3ClusterType, poi: H3DiagnosticPoi): number {
  if (type === 'medical') return poi.categoryId === 'hospital' ? 1 : 0.82;
  if (type === 'transport') {
    if (poi.categoryId === 'strategicTransportHub') return 0.75;
    return 1;
  }
  if (type === 'tourism') {
    if (poi.categoryId === 'major_hotel') return 0.8;
    if (poi.categoryId === 'mid_hotel') return 0.45;
    if (poi.categoryId === 'shopping_major') return 0.6;
    return 0.9;
  }
  if (type === 'business') {
    if (poi.categoryId === 'convention') return 0.95;
    if (poi.categoryId === 'university') return 0.7;
    if (poi.categoryId === 'civic') return 0.45;
    switch (poi.subType) {
      case 'office': return 0.65;
      case 'office_anon': return 0.2;
      case 'bank': return 0.2;
      case 'commercial': return 0.25;
      case 'industrial': return 0.35;
      case 'factory': return 0.4;
      default: return 0.65;
    }
  }
  return 0.5;
}

function incrementRecord(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function buildClusterScore(args: {
  poiCount: number;
  occupiedCellCount: number;
  strongestCellCount: number;
  avgDistanceMeters: number | null;
  avgQuality: number;
}): number {
  if (args.poiCount <= 0) return 0;
  if (args.poiCount === 1) return roundSignal(0.14 * args.avgQuality);

  const countSignal = Math.min(1, (args.poiCount - 1) / 3);
  const cellSignal = args.strongestCellCount >= 2 ? 1 : Math.min(0.85, args.poiCount / Math.max(2, args.occupiedCellCount));
  const proximitySignal =
    args.avgDistanceMeters == null
      ? 0.45
      : Math.max(0.2, Math.min(1, 1 - args.avgDistanceMeters / 1600));

  const geometricSignal = countSignal * 0.5 + cellSignal * 0.32 + proximitySignal * 0.18;
  return roundSignal(geometricSignal * args.avgQuality);
}

function scoreIsolatedPoiPenalty(summary: readonly H3ClusterEvidenceSummary[], totalPoiCount: number): number {
  if (totalPoiCount === 0) return 0;
  const best = summary.reduce((max, row) => Math.max(max, row.score), 0);
  const maxTypeCount = summary.reduce((max, row) => Math.max(max, row.poiCount), 0);
  if (best >= 0.48) return roundSignal(0.1);
  if (maxTypeCount <= 1) return roundSignal(0.75);
  return roundSignal(0.4);
}

function toPoi(magnet: MagnetItem, index: number): H3DiagnosticPoi {
  return {
    id: `${magnet.categoryId}:${index}:${magnet.name}`,
    name: magnet.name,
    categoryId: magnet.categoryId,
    subType: magnet.subType,
    lat: magnet.lat,
    lon: magnet.lon,
    distanceMeters: magnet.distance,
    attractionScore: magnet.attractionScore,
  };
}

export function buildH3Diagnostics(input: H3DiagnosticsInput): H3Diagnostics {
  const resolution = normalizeResolution(input.resolution);
  const centerCell = latLngToCell(input.lat, input.lon, resolution);
  const ringCells = gridDisk(centerCell, 1);
  const neighboringCells = ringCells.filter(cell => cell !== centerCell);
  const ringSet = new Set(ringCells);
  const poiCountByCell: Record<string, number> = {};
  const categoryDensityByCell: Record<string, H3CategoryDensityCell> = {};
  const poiCells: H3PoiCellAssignment[] = [];

  for (const poi of input.pois) {
    if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lon)) continue;
    const cell = latLngToCell(poi.lat, poi.lon, resolution);
    const clusterTypes = clusterTypesForCategory(poi.categoryId);
    const clusterQuality = Object.fromEntries(
      clusterTypes.map(type => [type, clusterQualityForPoi(type, poi)]),
    ) as Partial<Record<H3ClusterType, number>>;

    incrementRecord(poiCountByCell, cell);
    if (!categoryDensityByCell[cell]) {
      categoryDensityByCell[cell] = { total: 0, categories: {}, clusterTypes: {} };
    }
    categoryDensityByCell[cell].total += 1;
    incrementRecord(categoryDensityByCell[cell].categories, poi.categoryId);
    for (const type of clusterTypes) {
      categoryDensityByCell[cell].clusterTypes[type] = (categoryDensityByCell[cell].clusterTypes[type] ?? 0) + 1;
    }

    poiCells.push({
      name: poi.name,
      categoryId: poi.categoryId,
      clusterTypes,
      clusterQuality,
      cell,
      ...(poi.distanceMeters != null ? { distanceMeters: Math.round(poi.distanceMeters) } : {}),
    });
  }

  const evidenceSummary = CLUSTER_TYPES.map(type => {
    const typedPois = poiCells.filter(poi => poi.clusterTypes.includes(type) && ringSet.has(poi.cell));
    const occupiedCells = new Set(typedPois.map(poi => poi.cell));
    const typedCountByCell = typedPois.reduce<Record<string, number>>((acc, poi) => {
      incrementRecord(acc, poi.cell);
      return acc;
    }, {});
    const strongestCellCount = Object.values(typedCountByCell).reduce((max, count) => Math.max(max, count), 0);
    const distances = typedPois
      .map(poi => poi.distanceMeters)
      .filter((distance): distance is number => typeof distance === 'number' && Number.isFinite(distance));
    const qualities = typedPois.map(poi => poi.clusterQuality[type] ?? 0.5);
    const avgQuality =
      qualities.length > 0
        ? qualities.reduce((sum, quality) => sum + quality, 0) / qualities.length
        : 0;
    const avgDistanceMeters =
      distances.length > 0
        ? distances.reduce((sum, distance) => sum + distance, 0) / distances.length
        : null;
    const score = buildClusterScore({
      poiCount: typedPois.length,
      occupiedCellCount: occupiedCells.size,
      strongestCellCount,
      avgDistanceMeters,
      avgQuality,
    });

    return {
      type,
      poiCount: typedPois.length,
      occupiedCellCount: occupiedCells.size,
      strongestCellCount,
      score,
      confidence: confidenceFromScore(score),
      evidenceNames: typedPois
        .slice()
        .sort((a, b) => (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER))
        .slice(0, 5)
        .map(poi => poi.name),
    };
  });

  const scoreByType = Object.fromEntries(evidenceSummary.map(row => [row.type, row.score])) as Record<H3ClusterType, number>;
  const maxScore = Math.max(...evidenceSummary.map(row => row.score), 0);
  const dominantClusterTypes = evidenceSummary
    .filter(row => row.score >= 0.48 && row.score >= maxScore - 0.08)
    .map(row => row.type);

  return {
    resolution,
    centerCell,
    neighboringCells,
    ringCells,
    poiCountByCell,
    categoryDensityByCell,
    poiCells,
    medicalClusterScore: scoreByType.medical,
    transportClusterScore: scoreByType.transport,
    tourismClusterScore: scoreByType.tourism,
    businessClusterScore: scoreByType.business,
    isolatedPoiPenaltySignal: scoreIsolatedPoiPenalty(evidenceSummary, poiCells.length),
    clusterConfidence: confidenceFromScore(maxScore),
    dominantClusterTypes,
    evidenceSummary,
    ...(input.context ? { context: input.context } : {}),
  };
}

export function buildH3DiagnosticsForAnalysis(args: {
  analysis: LocationAnalysis;
  lat: number;
  lon: number;
  context?: H3DiagnosticContext;
  resolution?: H3DiagnosticsResolution;
}): H3Diagnostics {
  return buildH3Diagnostics({
    lat: args.lat,
    lon: args.lon,
    pois: args.analysis.magnets.map(toPoi),
    context: args.context,
    resolution: args.resolution,
  });
}
