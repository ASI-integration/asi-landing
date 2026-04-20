/**
 * Foot-traffic layer — confirming / amplifying modifier on top of magnet gravity.
 * Uses only OSM-backed signals (no external mobility feeds).
 */

import type { MagnetItem, GravityExplanation, FootTrafficSummary, LocationAnalysis } from './types';
import { createDisabledSpatialFoundation } from './spatial-foundation';
import { mergeNeighborhoodEnvironmentLayer } from './neighborhood-environment';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Cached rows or older clients may omit foot-traffic; keep UI/runtime stable. */
export function emptyFootTrafficSummary(): FootTrafficSummary {
  return {
    modifierTier: 'weak',
    boostPoints: 0,
    movementDensity: 'low',
    zoneActivity: 'calm',
    flowStability: 'unstable',
    flowCharacter: 'transit-heavy footfall',
    transitVsTarget: { transitShare: 0, localActiveShare: 0, destinationShare: 0 },
    stability01: 0.2,
    concentration01: 0.25,
  };
}

const RU_DENSITY: Record<string, string> = {
  низкая: 'low', умеренная: 'moderate', высокая: 'high',
};
const RU_ACTIVITY: Record<string, string> = {
  спокойная: 'calm', умеренная: 'moderate', 'оживлённая': 'busy',
};
const RU_STABILITY: Record<string, string> = {
  нестабильная: 'unstable', средняя: 'moderate', устойчивая: 'stable',
};
const RU_FLOW: Record<string, string> = {
  'преобладает целевой поток': 'destination-led footfall',
  'смесь целевого и транзитного потока': 'mixed destination and transit',
  'заметный транзитный поток': 'transit-heavy footfall',
};

function normalizeFootTrafficFields(ft: FootTrafficSummary | null | undefined): FootTrafficSummary {
  const base = emptyFootTrafficSummary();
  if (!ft) return base;
  const legacy = ft as FootTrafficSummary & {
    movementDensityRu?: string;
    zoneActivityRu?: string;
    flowStabilityRu?: string;
    flowCharacterRu?: string;
  };
  if (typeof legacy.movementDensity === 'string' && !legacy.movementDensityRu) {
    return {
      modifierTier: ft.modifierTier ?? base.modifierTier,
      boostPoints: ft.boostPoints ?? base.boostPoints,
      movementDensity: legacy.movementDensity,
      zoneActivity: legacy.zoneActivity ?? base.zoneActivity,
      flowStability: legacy.flowStability ?? base.flowStability,
      flowCharacter: legacy.flowCharacter ?? base.flowCharacter,
      transitVsTarget: ft.transitVsTarget ?? base.transitVsTarget,
      stability01: ft.stability01 ?? base.stability01,
      concentration01: ft.concentration01 ?? base.concentration01,
    };
  }
  return {
    ...base,
    ...ft,
    movementDensity: RU_DENSITY[legacy.movementDensityRu ?? ''] ?? legacy.movementDensity ?? base.movementDensity,
    zoneActivity: RU_ACTIVITY[legacy.zoneActivityRu ?? ''] ?? legacy.zoneActivity ?? base.zoneActivity,
    flowStability: RU_STABILITY[legacy.flowStabilityRu ?? ''] ?? legacy.flowStability ?? base.flowStability,
    flowCharacter: RU_FLOW[legacy.flowCharacterRu ?? ''] ?? legacy.flowCharacter ?? base.flowCharacter,
  };
}

export function normalizeCompetitorPressureLevel(
  v: string | undefined,
): GravityExplanation['competitorPressureLevel'] {
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  if (v === 'низкое') return 'low';
  if (v === 'среднее') return 'medium';
  if (v === 'высокое') return 'high';
  return 'low';
}

export function patchLegacyLocationAnalysis(a: LocationAnalysis): LocationAnalysis {
  const ge = a.gravityExplanation;
  const sb = ge?.scoreBreakdown ?? { attraction: 0, competitorPressure: 0, clusterBonus: 0, trafficBoost: 0 };
  return {
    ...a,
    spatialFoundation: a.spatialFoundation ?? createDisabledSpatialFoundation(),
    neighborhoodEnvironment: mergeNeighborhoodEnvironmentLayer(a.neighborhoodEnvironment),
    footTraffic: normalizeFootTrafficFields(a.footTraffic),
    gravityExplanation: {
      dominantMagnets: ge?.dominantMagnets ?? [],
      strongestZoneLabel: ge?.strongestZoneLabel ?? '',
      competitorPressureLevel: normalizeCompetitorPressureLevel(ge?.competitorPressureLevel as string),
      demandDistribution: ge?.demandDistribution ?? 'weak',
      demandType: ge?.demandType ?? 'mixed',
      clusterDetected: ge?.clusterDetected ?? false,
      clusterSize: ge?.clusterSize ?? 0,
      scoreBreakdown: {
        attraction: sb.attraction,
        competitorPressure: sb.competitorPressure,
        clusterBonus: sb.clusterBonus,
        trafficBoost: typeof sb.trafficBoost === 'number' ? sb.trafficBoost : 0,
      },
    },
  };
}

export const FOOT_TRAFFIC_CONFIG = {
  /** Max raw index points traffic may add (before final clamp) */
  boostCap: 7.5,
  /** Base attraction (scaled) must reach this fraction of a typical mid score before traffic lifts much */
  plausibilityHalfAt: 26,
  /** Radius for local magnet density around each point (heatmap) */
  neighborRadiusM: 380,
} as const;

/** Internal bucket weights — not shown in UI */
function magnetFlowWeights(m: MagnetItem): { transit: number; local: number; destination: number } {
  switch (m.categoryId) {
    case 'metro':
      return { transit: 0.45, local: 0.1,  destination: 0.45 };
    case 'airport':
      // Airports are almost entirely transit-flow and destination arrivals
      return { transit: 0.65, local: 0.05, destination: 0.30 };
    case 'railway_station':
      return { transit: 0.4,  local: 0.05, destination: 0.55 };
    case 'hospital':
      // Stable destination flow: staff, patients, visitors — minimal transit share
      return { transit: 0.08, local: 0.22, destination: 0.70 };
    case 'major_hotel':
      // Hotel guests arrive for purpose; some local leisure/dining spill
      return { transit: 0.10, local: 0.25, destination: 0.65 };
    case 'convention':
      // Corporate events: nearly all destination-led flow
      return { transit: 0.10, local: 0.10, destination: 0.80 };
    case 'attraction':
    case 'university':
    case 'shopping_major':
      return { transit: 0.05, local: 0.10, destination: 0.85 };
    case 'stadium':
      // Event-driven: mostly destination; transit on event days
      return { transit: 0.20, local: 0.15, destination: 0.65 };
    case 'entertainment':
      return { transit: 0.08, local: 0.22, destination: 0.70 };
    case 'food':
    case 'shopping_local':
    case 'education_local':
      return { transit: 0.12, local: 0.68, destination: 0.20 };
    case 'business':
      return { transit: 0.18, local: 0.52, destination: 0.30 };
    default:
      return { transit: 0.20, local: 0.50, destination: 0.30 };
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function neighborDensityScores(magnets: MagnetItem[]): Map<string, number> {
  const R = FOOT_TRAFFIC_CONFIG.neighborRadiusM;
  const out = new Map<string, number>();
  for (const m of magnets) {
    let n = 0;
    for (const o of magnets) {
      if (o === m) continue;
      if (haversineMeters(m.lat, m.lon, o.lat, o.lon) <= R) n += 1;
    }
    out.set(`${m.lat}|${m.lon}|${m.categoryId}`, clamp01(n / 4));
  }
  return out;
}

function triadLabels(
  density01: number,
  activity01: number,
  stability01: number,
  destinationShare: number,
): Pick<FootTrafficSummary, 'movementDensity' | 'zoneActivity' | 'flowStability' | 'flowCharacter'> {
  const dens =
    density01 < 0.28 ? 'low' : density01 < 0.55 ? 'moderate' : 'high';
  const act =
    activity01 < 0.3 ? 'calm' : activity01 < 0.58 ? 'moderate' : 'busy';
  const stab =
    stability01 < 0.35 ? 'unstable' : stability01 < 0.65 ? 'moderate' : 'stable';
  let flow: string;
  if (destinationShare >= 0.46) {
    flow = 'destination-led footfall';
  } else if (destinationShare >= 0.3) {
    flow = 'mixed destination and transit';
  } else {
    flow = 'transit-heavy footfall';
  }
  return {
    movementDensity: dens,
    zoneActivity: act,
    flowStability: stab,
    flowCharacter: flow,
  };
}

export interface FootTrafficHeatmapFactors {
  stability01: number;
  concentration01: number;
  destinationShare: number;
  neighborDensityByKey: Map<string, number>;
}

export function buildHeatmapTrafficFactors(
  magnets: MagnetItem[],
  summary: FootTrafficSummary,
): FootTrafficHeatmapFactors {
  return {
    stability01: summary.stability01,
    concentration01: summary.concentration01,
    destinationShare: summary.transitVsTarget.destinationShare,
    neighborDensityByKey: neighborDensityScores(magnets),
  };
}

/** @param baseAttractionScaled — attraction * scoreScale (same units as index line before clamp) */
export function computeFootTrafficLayer(
  magnets: MagnetItem[],
  accessibilityStopCount: number,
  gravity: Pick<
    GravityExplanation,
    'clusterDetected' | 'clusterSize' | 'demandDistribution'
  >,
  baseAttractionScaled: number,
): { summary: FootTrafficSummary; boostRaw: number; factors: FootTrafficHeatmapFactors } {
  if (magnets.length === 0) {
    const empty = emptyFootTrafficSummary();
    return {
      summary: empty,
      boostRaw: 0,
      factors: {
        stability01: empty.stability01,
        concentration01: empty.concentration01,
        destinationShare: empty.transitVsTarget.destinationShare,
        neighborDensityByKey: new Map(),
      },
    };
  }

  let transit = Math.sqrt(accessibilityStopCount / 10);
  transit = clamp01(transit);
  let local = 0;
  let destination = 0;

  const maxA = Math.max(...magnets.map(m => m.attractionScore), 1e-6);
  for (const m of magnets) {
    const w = magnetFlowWeights(m);
    const n = m.attractionScore / maxA;
    transit += w.transit * n * 0.85;
    local += w.local * n;
    destination += w.destination * n;
  }

  // ── Flow-share computation (unclamped sums) ──────────────────────────────────
  // Do NOT clamp each component to [0,1] before normalising.
  // When 15+ magnets of mixed types are present every component accumulates
  // well above 1.0, clamp01 flattens all three to exactly 1.0, and after
  // normalisation every location shows 0.33 / 0.33 / 0.33 — destroying the
  // signal that distinguishes a transit hub from a tourist destination.
  // Using raw (floor-at-0) sums and a single normalisation preserves the
  // relative weight of dominant magnet types.
  const transitRaw  = Math.max(0, transit);
  const localRaw    = Math.max(0, local * 0.95);
  const destRaw     = Math.max(0, destination);
  const sumRaw      = transitRaw + localRaw + destRaw + 1e-4;
  const transitShare     = transitRaw / sumRaw;
  const localActiveShare = localRaw   / sumRaw;
  const destinationShare = destRaw    / sumRaw;

  // Clamped variants — used only for density/activity labels and boostRaw
  // to maintain backwards-compatible behaviour for the heatmap and score pipeline.
  const transitC = clamp01(transit);
  const localC   = clamp01(local * 0.95);
  const destC    = clamp01(destination);

  let stability01 =
    (gravity.clusterDetected ? 0.38 : 0.12) +
    (gravity.demandDistribution === 'concentrated' ? 0.34
      : gravity.demandDistribution === 'split' ? 0.18
      : 0.08);
  stability01 = clamp01(stability01 + Math.min(0.2, gravity.clusterSize * 0.04));

  const distances = magnets.map(m => m.distance).sort((a, b) => a - b);
  const median = distances[Math.floor(distances.length / 2)] ?? 500;
  const concentration01 = clamp01(1 - median / 900);

  const flowVolume01 = clamp01((transitC + localC + destC) / 2.2);
  const localPulse01 = clamp01(localC + Math.min(destC, localC) * 0.5);

  const labels = triadLabels(flowVolume01, localPulse01, stability01, destinationShare);

  const plausibility = clamp01(baseAttractionScaled / FOOT_TRAFFIC_CONFIG.plausibilityHalfAt);
  const intentAlignment = clamp01(0.28 + 0.72 * destinationShare);
  const antiTransitOnly = clamp01(0.35 + 0.65 * (destinationShare / (transitShare + 0.35)));

  let modifierTier: FootTrafficSummary['modifierTier'] = 'weak';
  if (destinationShare >= 0.5 && plausibility >= 0.18 && (gravity.clusterDetected || gravity.demandDistribution === 'concentrated')) {
    modifierTier = 'strong';
  } else if (destinationShare >= 0.36 && plausibility >= 0.12) {
    modifierTier = 'moderate';
  }

  const tierCore =
    modifierTier === 'strong' ? 6.2 : modifierTier === 'moderate' ? 3.5 : 1.1;
  let boostRaw =
    tierCore * plausibility * intentAlignment * antiTransitOnly * (0.55 + 0.45 * stability01);
  boostRaw *= 0.92 + 0.08 * concentration01;
  boostRaw = Math.min(boostRaw, FOOT_TRAFFIC_CONFIG.boostCap);
  if (plausibility < 0.06) boostRaw = 0;

  const roundedBoost = Math.round(boostRaw);
  const summary: FootTrafficSummary = {
    modifierTier,
    boostPoints: roundedBoost,
    ...labels,
    transitVsTarget: {
      transitShare: Math.round(transitShare * 100) / 100,
      localActiveShare: Math.round(localActiveShare * 100) / 100,
      destinationShare: Math.round(destinationShare * 100) / 100,
    },
    stability01,
    concentration01,
  };

  return {
    summary,
    boostRaw: roundedBoost,
    factors: buildHeatmapTrafficFactors(magnets, summary),
  };
}
