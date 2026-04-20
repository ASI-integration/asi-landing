/**
 * Commercial spatial foundation v1 — stub tier.
 * Barrier-aware attraction dampening + minimal corridor distance inflation.
 * No graph routing; safe geometric heuristics on OSM point samples.
 */

import type { OSMElement, MagnetItem, PermanenceType } from './types';
import type { SpatialFoundationSnapshot, BarrierKind } from './types';
import { GRAVITY_CONFIG, PERMANENCE_MULTIPLIER } from './config';

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

function distanceDecaySmooth(meters: number): number {
  const { distanceDecayRefDist, distanceDecayPower } = GRAVITY_CONFIG;
  return 1 / (1 + Math.pow(meters / distanceDecayRefDist, distanceDecayPower));
}

function calcMagnetAttraction(
  weight: number,
  permanenceType: PermanenceType,
  distance: number,
): number {
  return weight * PERMANENCE_MULTIPLIER[permanenceType] * distanceDecaySmooth(distance);
}

const BARRIER_MULT: Record<BarrierKind, number> = {
  water: 0.36,
  rail: 0.52,
  major_road: 0.70,
};

/** Max perpendicular distance (m) from subject→magnet segment to count a barrier point as “on path”. */
const BARRIER_CROSS_TRACK_MAX_M = 135;
/** Only dampen when the magnet is meaningfully far — micro-local stays stable. */
const BARRIER_MIN_MAGNET_DIST_M = 160;
/** Ignore crossings very close to subject or magnet endpoints (geometry noise). */
const BARRIER_T_MIN = 0.11;
const BARRIER_T_MAX = 0.91;

function elementCenter(el: OSMElement): { lat: number; lon: number } | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function barrierKindFromTags(tags: Record<string, string> | undefined): BarrierKind | null {
  if (!tags) return null;
  if (tags.natural === 'water' || tags.landuse === 'reservoir' || tags.waterway === 'riverbank')
    return 'water';
  if (tags.railway === 'rail') return 'rail';
  const hw = tags.highway;
  if (
    hw === 'motorway' || hw === 'motorway_link' ||
    hw === 'trunk' || hw === 'trunk_link' ||
    hw === 'primary' || hw === 'primary_link'
  )
    return 'major_road';
  return null;
}

function corridorHighway(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  const hw = tags.highway;
  return (
    hw === 'residential' || hw === 'secondary' || hw === 'tertiary' ||
    hw === 'living_street' || hw === 'pedestrian' || hw === 'unclassified' ||
    hw === 'service'
  );
}

function toPlanarMeters(originLat: number, originLon: number, lat: number, lon: number): { x: number; y: number } {
  const cosLat = Math.cos((originLat * Math.PI) / 180);
  const x = (lon - originLon) * 111320 * cosLat;
  const y = (lat - originLat) * 110540;
  return { x, y };
}

/**
 * Closest-point parameter t along segment S→M (planar local meters) and cross-track distance to B.
 */
export function closestPointOnSegmentPlanar(
  sLat: number,
  sLon: number,
  mLat: number,
  mLon: number,
  bLat: number,
  bLon: number,
): { t: number; crossTrackM: number; alongDistSM: number } {
  const s = toPlanarMeters(sLat, sLon, sLat, sLon);
  const m = toPlanarMeters(sLat, sLon, mLat, mLon);
  const b = toPlanarMeters(sLat, sLon, bLat, bLon);
  const vx = m.x - s.x;
  const vy = m.y - s.y;
  const len = Math.hypot(vx, vy);
  const len2 = vx * vx + vy * vy;
  const t = len2 < 1e-4 ? 0 : Math.max(0, Math.min(1, ((b.x - s.x) * vx + (b.y - s.y) * vy) / len2));
  const px = s.x + t * vx;
  const py = s.y + t * vy;
  const crossTrackM = Math.hypot(b.x - px, b.y - py);
  return { t, crossTrackM, alongDistSM: len };
}

export function collectBarrierSamples(elements: OSMElement[]): Array<{ lat: number; lon: number; kind: BarrierKind }> {
  const out: Array<{ lat: number; lon: number; kind: BarrierKind }> = [];
  for (const el of elements) {
    const kind = barrierKindFromTags(el.tags);
    if (!kind) continue;
    const c = elementCenter(el);
    if (!c) continue;
    out.push({ ...c, kind });
  }
  return out;
}

export function collectCorridorSamples(elements: OSMElement[]): Array<{ lat: number; lon: number }> {
  const out: Array<{ lat: number; lon: number }> = [];
  for (const el of elements) {
    if (!corridorHighway(el.tags)) continue;
    const c = elementCenter(el);
    if (!c) continue;
    out.push(c);
  }
  return out;
}

export function nearestCorridorMeters(
  lat: number,
  lon: number,
  corridorPoints: Array<{ lat: number; lon: number }>,
): number | null {
  if (corridorPoints.length === 0) return null;
  let best = Infinity;
  for (const p of corridorPoints) {
    const d = haversineMeters(lat, lon, p.lat, p.lon);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : null;
}

/** Exported for unit tests — multiplier in (0,1] applied to base attraction after corridor inflation. */
export function stubBarrierMultiplierForMagnet(args: {
  subjectLat: number;
  subjectLon: number;
  magnet: Pick<MagnetItem, 'lat' | 'lon' | 'distance'>;
  barriers: Array<{ lat: number; lon: number; kind: BarrierKind }>;
}): { mult: number; crossedKinds: BarrierKind[] } {
  const { subjectLat, subjectLon, magnet, barriers } = args;
  if (magnet.distance < BARRIER_MIN_MAGNET_DIST_M) return { mult: 1, crossedKinds: [] };

  const dSm = haversineMeters(subjectLat, subjectLon, magnet.lat, magnet.lon);
  if (dSm < BARRIER_MIN_MAGNET_DIST_M) return { mult: 1, crossedKinds: [] };

  let mult = 1;
  const crossed = new Set<BarrierKind>();

  for (const b of barriers) {
    const dSb = haversineMeters(subjectLat, subjectLon, b.lat, b.lon);
    if (dSb > dSm * 0.995) continue;

    const { t, crossTrackM } = closestPointOnSegmentPlanar(
      subjectLat, subjectLon, magnet.lat, magnet.lon, b.lat, b.lon,
    );
    if (t < BARRIER_T_MIN || t > BARRIER_T_MAX) continue;
    if (crossTrackM > BARRIER_CROSS_TRACK_MAX_M) continue;

    const km = BARRIER_MULT[b.kind];
    mult = Math.min(mult, km);
    crossed.add(b.kind);
  }

  return { mult: mult > 0 ? mult : 1, crossedKinds: [...crossed] };
}

function corridorInflationMeters(corridorSnapM: number | null): number {
  if (corridorSnapM == null || !Number.isFinite(corridorSnapM)) return 0;
  return Math.min(95, Math.round(corridorSnapM * 0.32));
}

export function createDisabledSpatialFoundation(): SpatialFoundationSnapshot {
  return {
    spatialTier: 'stub',
    enabled: false,
    barrierPenaltyApplied: false,
    penalizedMagnetCount: 0,
    corridorSnapM: null,
    barrierKindsDetected: [],
    distanceInflationM: 0,
    geometricConfidenceNoteRu:
      'Пространственный слой для этого анализа не активирован — оценка магнитов по прямой без коррекции барьеров.',
  };
}

/**
 * Mutates `magnet.attractionScore` when enabled; always returns a snapshot for API/UI.
 */
export function applySpatialFoundationLayer(args: {
  magnets: MagnetItem[];
  elements: OSMElement[];
  subjectLat: number;
  subjectLon: number;
  enabled: boolean;
}): SpatialFoundationSnapshot {
  const { magnets, elements, subjectLat, subjectLon, enabled } = args;

  if (!enabled) {
    return createDisabledSpatialFoundation();
  }

  const barriers = collectBarrierSamples(elements);
  const corridorPts = collectCorridorSamples(elements);
  const corridorSnapM = nearestCorridorMeters(subjectLat, subjectLon, corridorPts);
  const inflation = corridorInflationMeters(corridorSnapM);

  const kindsSet = new Set<BarrierKind>();
  for (const b of barriers) kindsSet.add(b.kind);

  let penalized = 0;
  let anyBarrierMult = false;

  for (const m of magnets) {
    const { mult, crossedKinds } = stubBarrierMultiplierForMagnet({
      subjectLat,
      subjectLon,
      magnet: m,
      barriers,
    });
    if (mult < 0.999) anyBarrierMult = true;
    if (mult < 0.999) penalized += 1;

    const effDist = m.distance + inflation;
    const base = calcMagnetAttraction(m.weight, m.permanenceType, effDist);
    m.attractionScore = base * mult;
  }

  return {
    spatialTier: 'stub',
    enabled: true,
    barrierPenaltyApplied: anyBarrierMult,
    penalizedMagnetCount: penalized,
    corridorSnapM,
    barrierKindsDetected: [...kindsSet],
    distanceInflationM: inflation,
    geometricConfidenceNoteRu:
      'Геометрия пешеходного доступа — черновик (stub): барьеры и «коридор» оценены по открытым данным без построения графа улиц. Подтвердите реальный маршрут на месте.',
  };
}
