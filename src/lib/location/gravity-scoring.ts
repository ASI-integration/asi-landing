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
import { classifyElement } from './overpass-classify';
import { computeHeatmap } from './heatmap';
import { generateConclusion } from './explanation';
import { computeFootTrafficLayer, emptyFootTrafficSummary, type FootTrafficHeatmapFactors } from './foot-traffic';
import { buildLocationScoreOutput, withAdjustedLocationScoreHeadline } from './location-score';
import { computeNeighborhoodEnvironmentCommercialModifier } from './neighborhood-environment-commercial-modifier';
import { buildAudienceAnalysis } from './audience-scoring';
import { buildNeighborhoodEnvironmentLayer } from './neighborhood-environment';
import { applySpatialFoundationLayer } from './spatial-foundation';
import { buildResidentialAnalysis } from './residential-analysis';
import {
  STRATEGIC_TRANSPORT_FETCH_RADIUS_M,
  STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M,
  resolveStrategicHubSubtype,
  strategicHubWeightTierMultiplier,
  strategicReachBandFromDistance,
} from './strategic-transport-hub';
import {
  SPECIALIZED_MEDICAL_FETCH_RADIUS_M,
  ORDINARY_HOSPITAL_SCORING_RADIUS_M,
  qualifiesSpecializedMedicalAnchor,
  inferSpecializedMedicalSubType,
  specializedMedicalReachBandFromDistance,
  specializedMedicalWeightTierMultiplier,
} from './specialized-medical-anchor';
import { emptyMagnetDiagnostics, type MagnetDiagnosticCandidate } from './magnet-diagnostics';

export type BuildAnalysisOptions = {
  /**
   * When true, applies barrier + corridor stub heuristics to magnet attraction before scoring.
   * Default false — keeps legacy residential / paywalled report behaviour unless explicitly enabled.
   */
  spatialFoundation?: boolean;
};

// ── Business subType weight adjustments ──────────────────────────────────────
// Generic/unnamed offices, industrial landuse, and commercial zones score
// significantly lower than named office buildings as STR demand drivers.

function effectiveBusinessWeight(baseWeight: number, subType: string | undefined): number {
  switch (subType) {
    case 'office_anon': return baseWeight * 0.45; // unnamed office node — minimal signal
    case 'industrial':  return baseWeight * 0.55; // landuse=industrial — limited STR demand
    case 'factory':     return baseWeight * 0.55; // man_made=works / building=industrial
    case 'commercial':  return baseWeight * 0.65; // landuse=commercial — retail strip noise
    case 'bank':        return baseWeight * 0.55; // single bank branch — not a demand cluster
    default:            return baseWeight * 0.72;   // named office: ~4.0 (was 5.5) — curbs suburban/rural inflation
  }
}

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

  // Strong airport pull only — micro-heliports / distant GA strips should not flip the whole zone.
  const ap = byCat.airport ?? 0;
  if (ap > 0 && (ap / total >= 0.11 || ap >= 9)) return 'transport-led';

  const stratHubPull = (byCat.strategicTransportHub ?? 0) * 0.52;
  const transport =
    (byCat.metro ?? 0) +
    (byCat.railway_station ?? 0) +
    stratHubPull;
  // Hospital, convention, major_hotel contribute to business demand
  const business =
    (byCat.business ?? 0) +
    (byCat.hospital ?? 0) * 0.6 +
    (byCat.specializedMedicalAnchor ?? 0) * 0.28 +
    (byCat.convention ?? 0) * 0.8 +
    (byCat.major_hotel ?? 0) * 0.4;
  const tourism =
    (byCat.attraction ?? 0) +
    (byCat.entertainment ?? 0) +
    (byCat.shopping_major ?? 0) +
    (byCat.stadium ?? 0) * 0.5;

  const shares = {
    transport: transport / total,
    business: business / total,
    tourism: tourism / total,
  };

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
 * Pick 1–3 "main magnets" with guaranteed coverage of the most impactful categories.
 *
 * Priority order for first slots:
 *   airport (very strong) > metro (transport-led) > hospital > major_hotel >
 *   railway_station > business > attraction > convention > university
 *
 * Then fill remaining slots by attractionScore, preferring category diversity.
 *
 * Airports: only “material” hubs (see isMaterialAirportMagnet) may occupy the first slot.
 */
function isMaterialAirportMagnet(m: MagnetItem | null): boolean {
  if (!m || m.categoryId !== 'airport') return false;
  if (m.attractionScore >= 3.8) return true;
  return m.distance <= 2200 && m.attractionScore >= 2;
}

function pickMainMagnets(magnets: MagnetItem[], demandType: GravityExplanation['demandType']): MagnetItem[] {
  if (magnets.length === 0) return [];

  const sorted = [...magnets].sort((a, b) => b.attractionScore - a.attractionScore);

  const airportRaw   = bestByCategory(magnets, 'airport');
  const airport      = isMaterialAirportMagnet(airportRaw) ? airportRaw : null;
  const metroBest    = bestByCategory(magnets, 'metro');
  const hospital     = bestByCategory(magnets, 'hospital');
  const majorHotel   = bestByCategory(magnets, 'major_hotel');
  const rail         = bestByCategory(magnets, 'railway_station');
  const business     = bestByCategory(magnets, 'business');
  const convention   = bestByCategory(magnets, 'convention');

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
  if (airport) {
    add(airport);
  } else if (demandType === 'transport-led') {
    add(rail ?? (isMetroRelevant(metroBest) ? metroBest : null));
  }

  // 2) Strategic category coverage (order: high-value anchors first)
  add(hospital);
  add(majorHotel);
  add(business);
  if (isMetroRelevant(metroBest)) add(metroBest);
  add(rail);
  add(convention);

  // Trim to 3 with diversity-first ordering.
  const uniq = picked.filter((m, idx, arr) => idx === arr.findIndex(
    o => o.categoryId === m.categoryId || `${o.categoryId}:${o.name}` === `${m.categoryId}:${m.name}`,
  ));
  const out: MagnetItem[] = [];
  const usedCats = new Set<string>();
  for (const m of uniq) {
    if (out.length >= 3) break;
    if (!usedCats.has(m.categoryId) || out.length === 0) {
      out.push(m);
      usedCats.add(m.categoryId);
    }
  }

  // Fill remaining with best scores, but avoid same-category dominance
  for (const m of sorted) {
    if (out.length >= 3) break;
    if (out.some(x => x.categoryId === m.categoryId && x.name === m.name)) continue;
    const wouldBeAllBusiness = out.length === 2 && out.every(x => x.categoryId === 'business') && m.categoryId === 'business';
    if (wouldBeAllBusiness) {
      const alt = sorted.find(x => x.categoryId !== 'business' && !out.some(o => o.categoryId === x.categoryId && o.name === x.name));
      if (alt) { out.push(alt); continue; }
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
  // Soft cap above 80: compresses without flattening mid-range. Times Square (rawScore ~270) → still 100.
  const rawCapped = rawScore <= 80 ? rawScore : 80 + (rawScore - 80) * 0.60;
  const index = Math.max(5, Math.min(100, Math.round(rawCapped)));

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

function magnetDiagCandidate(
  el: OSMElement,
  dist: number,
  classified?: { categoryId: string; subType?: string; name: string },
): MagnetDiagnosticCandidate {
  return {
    osmType: el.type,
    osmId: el.id,
    name: classified?.name ?? el.tags?.name ?? '—',
    distanceM: Math.round(dist),
    tags: el.tags,
    classifiedCategoryId: classified?.categoryId,
    classifiedSubType: classified?.subType,
  };
}

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
export function buildAnalysis(
  elements: OSMElement[],
  lat: number,
  lon: number,
  options?: BuildAnalysisOptions,
): LocationAnalysis {
  const byCategory: Record<string, MagnetItem[]> = {};
  const competitors: CompetitorItem[] = [];
  const accessibilityStops: AccessibilityStopItem[] = [];
  const diag = emptyMagnetDiagnostics();

  const pushSpecializedMedicalMagnet = (
    el: OSMElement,
    elLat: number,
    elLon: number,
    dist: number,
    name: string,
    tags: Record<string, string>,
    classifiedSnapshot: { categoryId: string; subType?: string },
    explicitSubType?: string,
  ): void => {
    const specCat = MAGNET_CATEGORIES.find(c => c.id === 'specializedMedicalAnchor');
    const band = specializedMedicalReachBandFromDistance(dist);
    if (!specCat || !band) {
      diag.suppressedMagnets.push({
        ...magnetDiagCandidate(el, dist, { ...classifiedSnapshot, name }),
        reason: 'outside_radius',
        detail: 'specialized_medical_radius',
      });
      return;
    }
    const tierMul = specializedMedicalWeightTierMultiplier(band);
    const effectiveWeight = specCat.weight * tierMul;
    const subType = explicitSubType ?? inferSpecializedMedicalSubType(tags);
    if (!byCategory.specializedMedicalAnchor) byCategory.specializedMedicalAnchor = [];
    byCategory.specializedMedicalAnchor.push({
      categoryId: specCat.id,
      categoryLabel: specCat.label,
      icon: specCat.icon,
      name,
      subType,
      lat: elLat,
      lon: elLon,
      distance: dist,
      weight: effectiveWeight,
      permanenceType: specCat.permanenceType,
      scopeLevel: specCat.scopeLevel,
      strengthClass: specCat.strengthClass,
      specializedMedicalReachBand: band,
      attractionScore: calcMagnetAttraction(effectiveWeight, specCat.permanenceType, dist),
    });
  };

  for (const el of elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (!elLat || !elLon) continue;

    const dist = haversineMeters(lat, lon, elLat, elLon);
    diag.queriedCandidates.push(magnetDiagCandidate(el, dist));

    const classified = classifyElement(el);
    if (!classified) {
      diag.suppressedMagnets.push({
        ...magnetDiagCandidate(el, dist),
        reason: 'unknown_category',
        detail: 'classifyElement_null',
      });
      continue;
    }

    diag.classifiedCandidates.push(magnetDiagCandidate(el, dist, classified));

    if (classified.categoryId === 'competitor') {
      competitors.push({ name: classified.name, lat: elLat, lon: elLon, distance: dist });
      continue;
    }

    if (classified.categoryId === 'accessibility_stop') {
      accessibilityStops.push({ name: classified.name, distance: dist });
      continue;
    }

    const tags = el.tags ?? {};

    if (classified.categoryId === 'specializedMedicalAnchor') {
      pushSpecializedMedicalMagnet(
        el,
        elLat,
        elLon,
        dist,
        classified.name,
        tags,
        classified,
        classified.subType,
      );
      continue;
    }

    if (classified.categoryId === 'hospital') {
      if (dist > ORDINARY_HOSPITAL_SCORING_RADIUS_M) {
        if (dist <= SPECIALIZED_MEDICAL_FETCH_RADIUS_M && qualifiesSpecializedMedicalAnchor(tags)) {
          pushSpecializedMedicalMagnet(el, elLat, elLon, dist, classified.name, tags, classified);
        } else {
          diag.suppressedMagnets.push({
            ...magnetDiagCandidate(el, dist, classified),
            reason: 'outside_radius',
            detail: 'ordinary_hospital_beyond_local_radius',
          });
        }
        continue;
      }
    }

    const hubKind = resolveStrategicHubSubtype(classified, tags);
    if (
      hubKind &&
      dist > STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M &&
      dist <= STRATEGIC_TRANSPORT_FETCH_RADIUS_M
    ) {
      const stratCat = MAGNET_CATEGORIES.find(c => c.id === 'strategicTransportHub');
      const band = strategicReachBandFromDistance(dist);
      if (stratCat && band) {
        const tierMul = strategicHubWeightTierMultiplier(band);
        const effectiveWeight = stratCat.weight * tierMul;
        if (!byCategory.strategicTransportHub) byCategory.strategicTransportHub = [];
        byCategory.strategicTransportHub.push({
          categoryId: stratCat.id,
          categoryLabel: stratCat.label,
          icon: stratCat.icon,
          name: classified.name,
          subType: hubKind,
          lat: elLat,
          lon: elLon,
          distance: dist,
          weight: effectiveWeight,
          permanenceType: stratCat.permanenceType,
          scopeLevel: stratCat.scopeLevel,
          strengthClass: stratCat.strengthClass,
          strategicReachBand: band,
          attractionScore: calcMagnetAttraction(effectiveWeight, stratCat.permanenceType, dist),
        });
        continue;
      }
      diag.suppressedMagnets.push({
        ...magnetDiagCandidate(el, dist, classified),
        reason: 'low_priority',
        detail: 'strategic_hub_missing_band',
      });
      continue;
    }

    if (classified.categoryId === 'airport' && dist > STRATEGIC_TRANSPORT_FETCH_RADIUS_M) {
      diag.suppressedMagnets.push({
        ...magnetDiagCandidate(el, dist, classified),
        reason: 'outside_radius',
        detail: 'airport_beyond_strategic_fetch',
      });
      continue;
    }

    // Major hotels are BOTH a quality-proxy magnet AND count as competitor supply.
    // This ensures the hotel's presence lifts the location score while also
    // contributing to the competitor pressure calculation.
    if (classified.categoryId === 'major_hotel') {
      competitors.push({ name: classified.name, lat: elLat, lon: elLon, distance: dist });
      // Falls through to magnet processing below.
    }

    const cat = MAGNET_CATEGORIES.find(c => c.id === classified.categoryId);
    if (!cat) {
      diag.suppressedMagnets.push({
        ...magnetDiagCandidate(el, dist, classified),
        reason: 'unknown_category',
        detail: 'no_magnet_category_config',
      });
      continue;
    }

    if (!byCategory[classified.categoryId]) byCategory[classified.categoryId] = [];
    const effectiveWeight =
      classified.categoryId === 'business'
        ? effectiveBusinessWeight(cat.weight, classified.subType)
        : cat.weight;
    byCategory[classified.categoryId].push({
      categoryId: cat.id,
      categoryLabel: cat.label,
      icon: cat.icon,
      name: classified.name,
      subType: classified.subType,
      lat: elLat,
      lon: elLon,
      distance: dist,
      weight: effectiveWeight,
      permanenceType: cat.permanenceType,
      scopeLevel: cat.scopeLevel,
      strengthClass: cat.strengthClass,
      attractionScore: calcMagnetAttraction(effectiveWeight, cat.permanenceType, dist),
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

  for (const cat of MAGNET_CATEGORIES) {
    const items = (byCategory[cat.id] ?? []).sort((a, b) => a.distance - b.distance);
    const maxShow = CATEGORY_MAX_SHOW[cat.id] ?? 3;
    if (items.length <= maxShow) continue;
    for (const m of items.slice(maxShow)) {
      diag.suppressedMagnets.push({
        name: m.name,
        distanceM: Math.round(m.distance),
        classifiedCategoryId: m.categoryId,
        classifiedSubType: m.subType,
        reason: 'low_priority',
        detail: `category_max_show_${maxShow}`,
      });
    }
  }

  diag.surfacedMagnets = magnets.map(m => ({
    name: m.name,
    distanceM: Math.round(m.distance),
    classifiedCategoryId: m.categoryId,
    classifiedSubType: m.subType,
  }));

  competitors.sort((a, b) => a.distance - b.distance);

  const accessibilityDeduped = dedupeAccessibilityStops(accessibilityStops);

  const spatialFoundation = applySpatialFoundationLayer({
    magnets,
    elements,
    subjectLat: lat,
    subjectLon: lon,
    enabled: options?.spatialFoundation === true,
  });

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

  const neighborhoodEnvironment = buildNeighborhoodEnvironmentLayer(elements, lat, lon, {
    evergreenIndex,
  });

  const commercialNeighborhoodModifier = computeNeighborhoodEnvironmentCommercialModifier({
    baseLocationScore: locationScore.location_score,
    neighborhoodEnvironment,
    osmElementCount: elements.length,
  });
  const locationScoreAdjusted =
    commercialNeighborhoodModifier.applied
      ? withAdjustedLocationScoreHeadline(locationScore, commercialNeighborhoodModifier.adjustedLocationScore)
      : locationScore;

  // ── Debug diagnostics (gated by env flag) ──────────────────────────────────
  if (process.env.LOCATION_DEBUG === '1') {
    const majorHotelFound = magnets.filter(m => m.categoryId === 'major_hotel');
    const debugInfo = {
      evergreenIndex,
      scoreBand,
      magnetsByCategory: Object.fromEntries(
        MAGNET_CATEGORIES.map(c => [
          c.id,
          {
            count: magnetCountByCategory[c.id] ?? 0,
            baseWeight: c.weight,
            top: (magnets
              .filter(m => m.categoryId === c.id)
              .sort((a, b) => b.attractionScore - a.attractionScore)
              .slice(0, 2)
              .map(m => ({
                name: m.name,
                distM: Math.round(m.distance),
                attractionScore: +m.attractionScore.toFixed(2),
              }))),
          },
        ]),
      ),
      hotelProxyActive: majorHotelFound.length > 0,
      hotelProxyItems: majorHotelFound.map(m => ({ name: m.name, distM: Math.round(m.distance), score: +m.attractionScore.toFixed(2) })),
      competitorCount: competitors.length,
      scoreBreakdown: gravityExplanation.scoreBreakdown,
      topContributors: [...magnets]
        .sort((a, b) => b.attractionScore - a.attractionScore)
        .slice(0, 5)
        .map(m => ({ name: m.name, cat: m.categoryId, distM: Math.round(m.distance), score: +m.attractionScore.toFixed(2), strength: m.strengthClass })),
      weakCategoriesFiltered: ['food', 'shopping_local', 'education_local'].map(id => ({
        id,
        rawCount: magnetCountByCategory[id] ?? 0,
        inScoring: magnets.filter(m => m.categoryId === id).length,
      })),
    };
    console.info('[location-debug]', JSON.stringify(debugInfo, null, 2));
  }

  const strategicTransportHubMagnets = magnets.filter(m => m.categoryId === 'strategicTransportHub');

  const baseAnalysis = {
    evergreenIndex,
    scoreBand,
    locationScore: locationScoreAdjusted,
    magnets,
    strategicTransportHubMagnets,
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
    neighborhoodEnvironment,
    commercialNeighborhoodModifier,
    spatialFoundation,
    heatmapPoints,
    conclusion,
    magnetDiagnostics: diag,
  };

  return {
    ...baseAnalysis,
    residentialAnalysis: buildResidentialAnalysis(baseAnalysis),
  };
}
