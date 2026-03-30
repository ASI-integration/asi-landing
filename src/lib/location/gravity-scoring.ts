/**
 * Gravity / Evergreen scoring engine — pure functions, no I/O.
 *
 * Internal model based on location analysis methodology.
 * Public attribution: методика курса Ярослава Стригунова.
 */

import type {
  MagnetItem,
  CompetitorItem,
  GravityExplanation,
  LocationAnalysis,
  OSMElement,
  ScoreBand,
} from './types';
import {
  MAGNET_CATEGORIES,
  CATEGORY_MAX_SHOW,
  PERMANENCE_MULTIPLIER,
  GRAVITY_CONFIG,
} from './config';
import { classifyElement } from './overpass';
import { computeHeatmap } from './heatmap';
import { generateConclusion } from './explanation';

// ── Distance helpers ──────────────────────────────────────────────────────────

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDist(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} м` : `${(m / 1000).toFixed(1)} км`;
}

/** Smooth distance decay: 1 / (1 + (dist/refDist)^power)
 *  0m → 1.0 | refDist → ~0.5 | 2×refDist → ~0.2 */
export function distanceDecaySmooth(meters: number): number {
  const { distanceDecayRefDist, distanceDecayPower } = GRAVITY_CONFIG;
  return 1 / (1 + Math.pow(meters / distanceDecayRefDist, distanceDecayPower));
}

// ── Per-object scoring ────────────────────────────────────────────────────────

/** Per-magnet attraction: category weight × permanence multiplier × distance decay */
export function calcMagnetAttraction(
  weight: number,
  permanenceType: MagnetItem['permanenceType'],
  distance: number,
): number {
  return weight * PERMANENCE_MULTIPLIER[permanenceType] * distanceDecaySmooth(distance);
}

/** Competitor pressure: distance-decayed sum amplified by close-competitor density */
export function calcCompetitorPressure(competitors: CompetitorItem[]): number {
  if (competitors.length === 0) return 0;
  let pressure = 0;
  for (const c of competitors) {
    pressure += GRAVITY_CONFIG.competitorBaseWeight * distanceDecaySmooth(c.distance);
  }
  const closeCount = competitors.filter(c => c.distance <= GRAVITY_CONFIG.competitorCloseRadius).length;
  const densityMul = 1 + Math.min(closeCount * GRAVITY_CONFIG.competitorDensityGain, GRAVITY_CONFIG.competitorDensityMax);
  return Math.min(pressure * densityMul, GRAVITY_CONFIG.competitorPressureMax);
}

/** Cluster bonus: dense magnet groups signal a strong demand zone */
export function calcClusterBonus(magnets: MagnetItem[]): { bonus: number; clusterSize: number } {
  const nearby = magnets.filter(m => m.distance <= GRAVITY_CONFIG.clusterRadius);
  const clusterSize = nearby.length;
  if (clusterSize < GRAVITY_CONFIG.clusterMinMagnets) return { bonus: 0, clusterSize };
  const bonus = Math.min(
    GRAVITY_CONFIG.clusterBonusMax,
    (clusterSize - GRAVITY_CONFIG.clusterMinMagnets + 1) * 2.5,
  );
  return { bonus, clusterSize };
}

/** Demand distribution: concentrated around one type, split across zones, or too weak */
export function detectDemandDistribution(magnets: MagnetItem[]): 'concentrated' | 'split' | 'weak' {
  if (magnets.length < 2) return 'weak';
  const total = magnets.reduce((s, m) => s + m.attractionScore, 0);
  if (total === 0) return 'weak';
  const byCategory: Record<string, number> = {};
  for (const m of magnets) {
    byCategory[m.categoryId] = (byCategory[m.categoryId] ?? 0) + m.attractionScore;
  }
  const maxShare = Math.max(...Object.values(byCategory)) / total;
  if (maxShare >= 0.55) return 'concentrated';
  if (Object.keys(byCategory).length >= 3) return 'split';
  return 'weak';
}

// ── Cluster zone detection ────────────────────────────────────────────────────

/** Group magnets into spatial clusters (each cluster = array of MagnetItems) */
export function detectClusterZones(magnets: MagnetItem[]): MagnetItem[][] {
  if (magnets.length < GRAVITY_CONFIG.clusterMinMagnets) return [];
  const nearby = magnets.filter(m => m.distance <= GRAVITY_CONFIG.clusterRadius);
  if (nearby.length < GRAVITY_CONFIG.clusterMinMagnets) return [];
  // Simple single-zone approach: all close magnets form one cluster
  return [nearby];
}

// ── Composite evergreen index ─────────────────────────────────────────────────

export function calcEvergreenIndex(
  magnets: MagnetItem[],
  competitors: CompetitorItem[],
): { index: number; gravityExplanation: GravityExplanation; competitorPressureValue: number } {
  const empty: GravityExplanation = {
    dominantMagnets: [],
    strongestZoneLabel: '',
    competitorPressureLevel: 'низкое',
    demandDistribution: 'weak',
    clusterDetected: false,
    clusterSize: 0,
    scoreBreakdown: { attraction: 0, competitorPressure: 0, clusterBonus: 0 },
  };
  if (magnets.length === 0) return { index: 0, gravityExplanation: empty, competitorPressureValue: 0 };

  const totalAttraction = magnets.reduce((s, m) => s + m.attractionScore, 0);
  const competitorPressureValue = calcCompetitorPressure(competitors);
  const { bonus: clusterBonus, clusterSize } = calcClusterBonus(magnets);

  const rawScore =
    totalAttraction * GRAVITY_CONFIG.scoreScale
    - competitorPressureValue
    + clusterBonus;

  const index = Math.max(5, Math.min(96, Math.round(rawScore)));

  const sorted = [...magnets].sort((a, b) => b.attractionScore - a.attractionScore);
  const dominantMagnets = sorted.slice(0, 3).map(m => m.name);
  const strongestZoneLabel = sorted[0]?.categoryLabel ?? '';
  const demandDistribution = detectDemandDistribution(magnets);
  const competitorPressureLevel: GravityExplanation['competitorPressureLevel'] =
    competitorPressureValue < 6 ? 'низкое' : competitorPressureValue < 14 ? 'среднее' : 'высокое';

  return {
    index,
    competitorPressureValue,
    gravityExplanation: {
      dominantMagnets,
      strongestZoneLabel,
      competitorPressureLevel,
      demandDistribution,
      clusterDetected: clusterSize >= GRAVITY_CONFIG.clusterMinMagnets,
      clusterSize,
      scoreBreakdown: {
        attraction: Math.round(totalAttraction * GRAVITY_CONFIG.scoreScale),
        competitorPressure: Math.round(competitorPressureValue),
        clusterBonus: Math.round(clusterBonus),
      },
    },
  };
}

// ── Main analysis builder ─────────────────────────────────────────────────────

/** Build the full LocationAnalysis from raw OSM elements + subject coordinates */
export function buildAnalysis(elements: OSMElement[], lat: number, lon: number): LocationAnalysis {
  const byCategory: Record<string, MagnetItem[]> = {};
  const competitors: CompetitorItem[] = [];

  for (const el of elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (!elLat || !elLon) continue;

    const classified = classifyElement(el);
    if (!classified) continue;

    const dist = haversineMeters(lat, lon, elLat, elLon);

    if (classified.categoryId === 'competitor') {
      competitors.push({ name: classified.name, lat: elLat, lon: elLon, distance: dist });
      continue;
    }

    const cat = MAGNET_CATEGORIES.find(c => c.id === classified.categoryId);
    if (!cat) continue;

    if (!byCategory[classified.categoryId]) byCategory[classified.categoryId] = [];
    byCategory[classified.categoryId].push({
      categoryId: cat.id,
      categoryLabel: cat.label,
      icon: cat.icon,
      name: classified.name,
      lat: elLat,
      lon: elLon,
      distance: dist,
      weight: cat.weight,
      permanenceType: cat.permanenceType,
      attractionScore: calcMagnetAttraction(cat.weight, cat.permanenceType, dist),
    });
  }

  // Sort each category by distance; slice to maxShow
  const magnets: MagnetItem[] = [];
  const magnetCountByCategory: Record<string, number> = {};

  for (const cat of MAGNET_CATEGORIES) {
    const items = (byCategory[cat.id] ?? []).sort((a, b) => a.distance - b.distance);
    magnetCountByCategory[cat.id] = items.length;
    magnets.push(...items.slice(0, CATEGORY_MAX_SHOW[cat.id] ?? 3));
  }

  competitors.sort((a, b) => a.distance - b.distance);

  const { index: evergreenIndex, gravityExplanation, competitorPressureValue } =
    calcEvergreenIndex(magnets, competitors);

  const scoreBand: ScoreBand =
    evergreenIndex >= 70 ? 'strong' : evergreenIndex >= 45 ? 'medium' : evergreenIndex > 0 ? 'weak' : 'none';

  const sorted = [...magnets].sort((a, b) => b.attractionScore - a.attractionScore);
  const strongestMagnets = sorted.slice(0, 3);
  const clusterZones = detectClusterZones(magnets);

  const conclusion = generateConclusion(
    evergreenIndex, magnets, competitors, magnetCountByCategory, gravityExplanation,
  );

  const heatmapPoints = computeHeatmap(magnets, competitors);

  return {
    evergreenIndex,
    scoreBand,
    magnets,
    magnetCountByCategory,
    competitors,
    gravityExplanation,
    strongestMagnets,
    clusterZones,
    splitDemand: gravityExplanation.demandDistribution === 'split',
    competitorPressure: competitorPressureValue,
    heatmapPoints,
    conclusion,
  };
}
