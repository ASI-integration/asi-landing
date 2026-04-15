/**
 * Gravity / Evergreen scoring engine — pure functions, no I/O.
 *
 * Internal model based on location analysis methodology.
 * Public attribution: methodology inspired by Yaroslav Strigunov’s location course.
 */

import type {
  MagnetItem,
  CompetitorItem,
  GravityExplanation,
  LocationAnalysis,
  OSMElement,
  ScoreBand,
  AccessibilityStopItem,
  FootTrafficSummary,
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
import { computeFootTrafficLayer, emptyFootTrafficSummary, type FootTrafficHeatmapFactors } from './foot-traffic';
import { buildLocationScoreOutput } from './location-score';
import { buildAudienceAnalysis } from './audience-scoring';

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
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
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

/** True magnets that can form a demand zone — not pure neighborhood filler (weak/local) */
function isDestinationMagnet(m: MagnetItem): boolean {
  return m.strengthClass === 'strong' || m.strengthClass === 'medium';
}

/** Cluster bonus: only when several *destination* magnets sit near the subject */
export function calcClusterBonus(magnets: MagnetItem[]): { bonus: number; clusterSize: number } {
  const nearby = magnets.filter(
    m => m.distance <= GRAVITY_CONFIG.clusterRadius && isDestinationMagnet(m),
  );
  const clusterSize = nearby.length;
  if (clusterSize < GRAVITY_CONFIG.clusterMinMagnets) return { bonus: 0, clusterSize: 0 };
  const bonus = Math.min(
    GRAVITY_CONFIG.clusterBonusMax,
    (clusterSize - GRAVITY_CONFIG.clusterMinMagnets + 1) * 1.9,
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
  const nearby = magnets.filter(
    m => m.distance <= GRAVITY_CONFIG.clusterRadius && isDestinationMagnet(m),
  );
  if (nearby.length < GRAVITY_CONFIG.clusterMinMagnets) return [];
  return [nearby];
}

function calcAccessibilityBonus(stopCount: number): number {
  if (stopCount <= 0) return 0;
  return Math.min(
    GRAVITY_CONFIG.accessibilityBonusMax,
    Math.log1p(stopCount) * GRAVITY_CONFIG.accessibilityBonusScale,
  );
}

// ── Demand type inference + "main magnets" selection ──────────────────────────

function sumAttractionByCategory(magnets: MagnetItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of magnets) {
    out[m.categoryId] = (out[m.categoryId] ?? 0) + (Number.isFinite(m.attractionScore) ? m.attractionScore : 0);
  }
  return out;
}

function inferDemandType(magnets: MagnetItem[]): GravityExplanation['demandType'] {
  if (magnets.length === 0) return 'mixed';
  const byCat = sumAttractionByCategory(magnets);
  const total = Object.values(byCat).reduce((s, v) => s + v, 0);
  if (total <= 0) return 'mixed';

  const transport =
    (byCat.metro ?? 0) +
    (byCat.railway_station ?? 0);
  const business = (byCat.business ?? 0);
  const tourism =
    (byCat.attraction ?? 0) +
    (byCat.entertainment ?? 0) +
    (byCat.shopping_major ?? 0);

  const shares = {
    transport: transport / total,
    business: business / total,
    tourism: tourism / total,
  };

  // "Led" requires a clear dominant share; otherwise classify as mixed.
  // Thresholds tuned to avoid over-triggering transport-led on one small station.
  if (shares.transport >= 0.45 && shares.transport >= shares.business + 0.10 && shares.transport >= shares.tourism + 0.10) return 'transport-led';
  if (shares.business >= 0.48 && shares.business >= shares.transport + 0.08 && shares.business >= shares.tourism + 0.08) return 'business-led';
  if (shares.tourism >= 0.48 && shares.tourism >= shares.transport + 0.08 && shares.tourism >= shares.business + 0.08) return 'tourism-led';
  return 'mixed';
}

function bestByCategory(magnets: MagnetItem[], categoryId: string): MagnetItem | null {
  let best: MagnetItem | null = null;
  for (const m of magnets) {
    if (m.categoryId !== categoryId) continue;
    if (!best || m.attractionScore > best.attractionScore) best = m;
  }
  return best;
}

function isMetroRelevant(metro: MagnetItem | null): boolean {
  if (!metro) return false;
  // Metro is only "main block" eligible when it's realistically usable without a car.
  return metro.distance <= 1500;
}

/**
 * Pick 1–3 "main magnets" with guaranteed category coverage:
 * - transport hub (railway_station) when present and especially for transport-led
 * - business magnet
 * - metro (only when relevant/usable)
 *
 * Then fill remaining slots by attractionScore, preferring category diversity.
 */
function pickMainMagnets(magnets: MagnetItem[], demandType: GravityExplanation['demandType']): MagnetItem[] {
  if (magnets.length === 0) return [];

  const sorted = [...magnets].sort((a, b) => b.attractionScore - a.attractionScore);
  const rail = bestByCategory(magnets, 'railway_station');
  const metroBest = bestByCategory(magnets, 'metro');
  const business = bestByCategory(magnets, 'business');

  const picked: MagnetItem[] = [];
  const seen = new Set<string>();
  const add = (m: MagnetItem | null) => {
    if (!m) return;
    const key = `${m.categoryId}:${m.name}:${Math.round(m.distance)}`;
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(m);
  };

  // 1) Scenario-driven first slot
  if (demandType === 'transport-led') {
    add(rail ?? (isMetroRelevant(metroBest) ? metroBest : null));
  }

  // 2) Strategic category coverage
  add(business);
  if (isMetroRelevant(metroBest)) add(metroBest);
  add(rail);

  // Trim to 3 with diversity-first ordering.
  const uniq = picked.filter((m, idx, arr) => idx === arr.findIndex(o => o.categoryId === m.categoryId || `${o.categoryId}:${o.name}` === `${m.categoryId}:${m.name}`));
  const out: MagnetItem[] = [];
  const usedCats = new Set<string>();
  for (const m of uniq) {
    if (out.length >= 3) break;
    if (!usedCats.has(m.categoryId) || out.length === 0) {
      out.push(m);
      usedCats.add(m.categoryId);
    }
  }

  // Fill remaining with best scores, but avoid ending up with 3 same-category items
  for (const m of sorted) {
    if (out.length >= 3) break;
    if (out.some(x => x.categoryId === m.categoryId && x.name === m.name)) continue;
    const wouldBeAllBusiness = out.length === 2 && out.every(x => x.categoryId === 'business') && m.categoryId === 'business';
    if (wouldBeAllBusiness) {
      // Try to find any non-business alternative; if none, accept business.
      const alt = sorted.find(x => x.categoryId !== 'business' && !out.some(o => o.categoryId === x.categoryId && o.name === x.name));
      if (alt) {
        out.push(alt);
        continue;
      }
    }
    out.push(m);
  }

  return out.slice(0, 3);
}

// ── Composite evergreen index ─────────────────────────────────────────────────

export function calcEvergreenIndex(
  magnets: MagnetItem[],
       competitors: CompetitorItem[],
       accessibilityStopCount: number = 0,
): {
  index: number;
  gravityExplanation: GravityExplanation;
  competitorPressureValue: number;
  footTraffic: FootTrafficSummary;
  heatmapFactors: FootTrafficHeatmapFactors;
} {
  const empty: GravityExplanation = {
    dominantMagnets: [],
    strongestZoneLabel: '',
    competitorPressureLevel: 'low',
    demandDistribution: 'weak',
    demandType: 'mixed',
    clusterDetected: false,
    clusterSize: 0,
    scoreBreakdown: { attraction: 0, competitorPressure: 0, clusterBonus: 0, trafficBoost: 0 },
  };
  const accessibilityBonus = calcAccessibilityBonus(accessibilityStopCount);
  const emptyFactors: FootTrafficHeatmapFactors = {
    stability01: 0.2,
    concentration01: 0.25,
    destinationShare: 0,
    neighborDensityByKey: new Map(),
  };
  if (magnets.length === 0) {
    const competitorPressureValue = calcCompetitorPressure(competitors);
    const rawScore = -competitorPressureValue + accessibilityBonus;
    const index = Math.max(5, Math.min(100, Math.round(rawScore)));
    return {
      index,
      competitorPressureValue,
      footTraffic: emptyFootTrafficSummary(),
      heatmapFactors: emptyFactors,
      gravityExplanation: {
        ...empty,
        competitorPressureLevel:
          competitorPressureValue < 6 ? 'low' : competitorPressureValue < 14 ? 'medium' : 'high',
        scoreBreakdown: {
          attraction: 0,
          competitorPressure: Math.round(competitorPressureValue),
          clusterBonus: 0,
          trafficBoost: 0,
        },
      },
    };
  }

  const totalAttraction = magnets.reduce((s, m) => s + m.attractionScore, 0);
  const competitorPressureValue = calcCompetitorPressure(competitors);
  const { bonus: clusterBonus, clusterSize } = calcClusterBonus(magnets);

  const rawBaseScore =
    totalAttraction * GRAVITY_CONFIG.scoreScale
    - competitorPressureValue
    + clusterBonus
    + accessibilityBonus;

  const demandDistribution = detectDemandDistribution(magnets);
  const clusterDetected = clusterSize >= GRAVITY_CONFIG.clusterMinMagnets;
  const baseAttractionScaled = totalAttraction * GRAVITY_CONFIG.scoreScale;

  const { summary: footTraffic, boostRaw, factors: heatmapFactors } = computeFootTrafficLayer(
    magnets,
    accessibilityStopCount,
    { clusterDetected, clusterSize, demandDistribution },
    baseAttractionScaled,
  );

  const rawScore = rawBaseScore + boostRaw;
  // Cap at 100 — the previous 96 ceiling collapsed all strong locations to the same score.
  const index = Math.max(5, Math.min(100, Math.round(rawScore)));

  const sorted = [...magnets].sort((a, b) => b.attractionScore - a.attractionScore);
  const dominantMagnets = sorted.slice(0, 3).map(m => m.name);
  const strongestZoneLabel = sorted[0]?.categoryLabel ?? '';
  const competitorPressureLevel: GravityExplanation['competitorPressureLevel'] =
    competitorPressureValue < 6 ? 'low' : competitorPressureValue < 14 ? 'medium' : 'high';
  const demandType = inferDemandType(magnets);

  return {
    index,
    competitorPressureValue,
    footTraffic,
    heatmapFactors,
    gravityExplanation: {
      dominantMagnets,
      strongestZoneLabel,
      competitorPressureLevel,
      demandDistribution,
      demandType,
      clusterDetected,
      clusterSize,
      scoreBreakdown: {
        attraction: Math.round(totalAttraction * GRAVITY_CONFIG.scoreScale),
        competitorPressure: Math.round(competitorPressureValue),
        clusterBonus: Math.round(clusterBonus),
        trafficBoost: boostRaw,
      },
    },
  };
}

// ── Main analysis builder ─────────────────────────────────────────────────────

function dedupeAccessibilityStops(stops: AccessibilityStopItem[]): AccessibilityStopItem[] {
  const seen = new Set<string>();
  const out: AccessibilityStopItem[] = [];
  const sorted = [...stops].sort((a, b) => a.distance - b.distance);
  for (const s of sorted) {
    const key = `${s.name}|${Math.round(s.distance / 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Build the full LocationAnalysis from raw OSM elements + subject coordinates */
export function buildAnalysis(elements: OSMElement[], lat: number, lon: number): LocationAnalysis {
  const byCategory: Record<string, MagnetItem[]> = {};
  const competitors: CompetitorItem[] = [];
  const accessibilityStops: AccessibilityStopItem[] = [];

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

    if (classified.categoryId === 'accessibility_stop') {
      accessibilityStops.push({ name: classified.name, distance: dist });
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
      subType: classified.subType,
      lat: elLat,
      lon: elLon,
      distance: dist,
      weight: cat.weight,
      permanenceType: cat.permanenceType,
      scopeLevel: cat.scopeLevel,
      strengthClass: cat.strengthClass,
      attractionScore: calcMagnetAttraction(cat.weight, cat.permanenceType, dist),
    });
  }

  const foodItems = byCategory.food;
  if (foodItems && foodItems.length > 0) {
    const clusteredCount = foodItems.filter(
      f => f.distance <= GRAVITY_CONFIG.foodClusterRadius,
    ).length;
    if (clusteredCount >= GRAVITY_CONFIG.foodClusterMinCount) {
      const w = GRAVITY_CONFIG.foodClusterWeight;
      for (const item of foodItems) {
        if (item.distance > GRAVITY_CONFIG.foodClusterRadius + 90) continue;
        item.weight = w;
        item.strengthClass = 'medium';
        item.scopeLevel = 'district';
        item.attractionScore = calcMagnetAttraction(w, item.permanenceType, item.distance);
      }
    }
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

  const accessibilityDeduped = dedupeAccessibilityStops(accessibilityStops);
  const {
    index: evergreenIndex,
    gravityExplanation,
    competitorPressureValue,
    footTraffic,
    heatmapFactors,
  } =
    calcEvergreenIndex(magnets, competitors, accessibilityDeduped.length);

  const scoreBand: ScoreBand =
    evergreenIndex >= 70 ? 'strong' : evergreenIndex >= 45 ? 'medium' : evergreenIndex > 0 ? 'weak' : 'none';

  const sorted = [...magnets].sort((a, b) => b.attractionScore - a.attractionScore);
  const strongestMagnets = pickMainMagnets(magnets, gravityExplanation.demandType);
  const clusterZones = detectClusterZones(magnets);

  const audienceAnalysis = buildAudienceAnalysis(magnets);

  const conclusion = generateConclusion(
    evergreenIndex, magnets, competitors, magnetCountByCategory, gravityExplanation, 'en', audienceAnalysis,
  );

  const heatmapPoints = computeHeatmap(magnets, competitors, heatmapFactors);

  // Avoid false "metro nearby": count metro as accessible only when usable without a car.
  // This flag feeds scoring/accessibility copy, so it must be strict.
  const hasMetro = magnets.some(m => m.categoryId === 'metro' && m.distance <= 1500);
  const attractionCount = magnetCountByCategory.attraction ?? 0;
  const locationScore = buildLocationScoreOutput({
    evergreenIndex,
    gravityExplanation,
    competitorPressure: competitorPressureValue,
    magnetCount: magnets.length,
    hasMetro,
    attractionCount,
    footTraffic,
    audienceAnalysis,
    accessibilityStopCount: accessibilityDeduped.length,
  });

  return {
    evergreenIndex,
    scoreBand,
    locationScore,
    magnets,
    magnetCountByCategory,
    accessibilityStops: accessibilityDeduped.slice(0, 12),
    competitors,
    gravityExplanation,
    demandType: gravityExplanation.demandType,
    strongestMagnets,
    clusterZones,
    splitDemand: gravityExplanation.demandDistribution === 'split',
    competitorPressure: competitorPressureValue,
    footTraffic,
    audienceAnalysis,
    heatmapPoints,
    conclusion,
  };
}
