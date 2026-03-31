/**
 * Heatmap computation — derives a set of weighted influence points from
 * real OSM-detected magnets and competitors.
 *
 * Output is a normalized point cloud: each point has lat/lon + intensity 0–1.
 * The UI maps these to SVG circles / halos. No fake data, no decorative blobs.
 */

import type { MagnetItem, CompetitorItem, HeatmapPoint } from './types';
import { GRAVITY_CONFIG } from './config';
import { distanceDecaySmooth } from './gravity-scoring';
import type { FootTrafficHeatmapFactors } from './foot-traffic';

/**
 * Compute heatmap points from detected magnets and competitors.
 *
 * Magnet points: intensity = attractionScore / maxAttraction
 * Competitor points: intensity = per-competitor pressure / maxCompPressure
 *
 * Magnet intensities blend attraction with local concentration, stability, and
 * destination-aligned flow — so the halo reflects «живые» зоны у реальных магнитов,
 * not raw crowding alone.
 */
export function computeHeatmap(
  magnets: MagnetItem[],
  competitors: CompetitorItem[],
  traffic: FootTrafficHeatmapFactors | null = null,
): HeatmapPoint[] {
  const points: HeatmapPoint[] = [];

  // ── Magnet influence points ──────────────────────────────────────────────
  if (magnets.length > 0) {
    const maxAttraction = Math.max(...magnets.map(m => m.attractionScore), 0.001);
    const stab = traffic?.stability01 ?? 0.5;
    const destShare = traffic?.destinationShare ?? 0.45;
    for (const m of magnets) {
      const key = `${m.lat}|${m.lon}|${m.categoryId}`;
      const neigh = traffic?.neighborDensityByKey.get(key) ?? 0.35;
      const destW =
        m.strengthClass === 'strong' || m.strengthClass === 'medium'
          ? 0.92 + 0.08 * destShare
          : 0.72 + 0.2 * destShare;
      const flowBlend =
        (0.5 + 0.5 * stab) *
        (0.6 + 0.4 * neigh) *
        destW;
      points.push({
        lat:       m.lat,
        lon:       m.lon,
        intensity: (m.attractionScore / maxAttraction) * flowBlend,
        type:      'magnet',
        categoryId: m.categoryId,
      });
    }
    const maxI = Math.max(...points.filter(p => p.type === 'magnet').map(p => p.intensity), 0.001);
    for (const p of points) {
      if (p.type === 'magnet') p.intensity = p.intensity / maxI;
    }
  }

  // ── Competitor pressure points ───────────────────────────────────────────
  if (competitors.length > 0) {
    const pressures = competitors.map(c =>
      GRAVITY_CONFIG.competitorBaseWeight * distanceDecaySmooth(c.distance),
    );
    const maxPressure = Math.max(...pressures, 0.001);
    for (let i = 0; i < competitors.length; i++) {
      points.push({
        lat:       competitors[i].lat,
        lon:       competitors[i].lon,
        intensity: pressures[i] / maxPressure,
        type:      'competitor',
        categoryId: 'competitor',
      });
    }
  }

  return points;
}

// ── SVG projection helpers (used by the UI renderer) ─────────────────────────

export interface ProjectedPoint {
  x: number;
  y: number;
  intensity: number;
  type: 'magnet' | 'competitor' | 'subject';
  categoryId: string;
}

/**
 * Project lat/lon points onto a 2D SVG viewport.
 *
 * Uses a simple equirectangular projection (good enough for city-scale areas).
 * Returns normalised pixel coordinates (0..width, 0..height) with padding.
 */
export function projectToSVG(
  points: HeatmapPoint[],
  subjectLat: number,
  subjectLon: number,
  width: number,
  height: number,
  paddingFraction = 0.12,
): { projected: ProjectedPoint[]; subjectXY: { x: number; y: number } } {
  const allLats = [subjectLat, ...points.map(p => p.lat)];
  const allLons = [subjectLon, ...points.map(p => p.lon)];

  let minLat = Math.min(...allLats);
  let maxLat = Math.max(...allLats);
  let minLon = Math.min(...allLons);
  let maxLon = Math.max(...allLons);

  // Ensure a minimum span to avoid degenerate single-point layouts
  const minSpan = 0.004; // ~400m
  if (maxLat - minLat < minSpan) { const mid = (maxLat + minLat) / 2; minLat = mid - minSpan / 2; maxLat = mid + minSpan / 2; }
  if (maxLon - minLon < minSpan) { const mid = (maxLon + minLon) / 2; minLon = mid - minSpan / 2; maxLon = mid + minSpan / 2; }

  const latRange = maxLat - minLat;
  const lonRange = maxLon - minLon;
  const pad = paddingFraction;

  function project(lat: number, lon: number): { x: number; y: number } {
    const x = (lon - minLon) / lonRange * width * (1 - 2 * pad) + width * pad;
    const y = (1 - (lat - minLat) / latRange) * height * (1 - 2 * pad) + height * pad;
    return { x, y };
  }

  const projected: ProjectedPoint[] = points.map(p => ({
    ...project(p.lat, p.lon),
    intensity: p.intensity,
    type: p.type,
    categoryId: p.categoryId,
  }));

  return { projected, subjectXY: project(subjectLat, subjectLon) };
}
