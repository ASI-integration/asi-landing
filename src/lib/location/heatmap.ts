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

/**
 * Compute heatmap points from detected magnets and competitors.
 *
 * Magnet points: intensity = attractionScore / maxAttraction
 * Competitor points: intensity = per-competitor pressure / maxCompPressure
 *
 * Both scales are independent so magnets and competitors are separately
 * normalised — each fills the 0–1 range for its own type.
 */
export function computeHeatmap(
  magnets: MagnetItem[],
  competitors: CompetitorItem[],
): HeatmapPoint[] {
  const points: HeatmapPoint[] = [];

  // ── Magnet influence points ──────────────────────────────────────────────
  if (magnets.length > 0) {
    const maxAttraction = Math.max(...magnets.map(m => m.attractionScore), 0.001);
    for (const m of magnets) {
      points.push({
        lat:       m.lat,
        lon:       m.lon,
        intensity: m.attractionScore / maxAttraction,
        type:      'magnet',
        categoryId: m.categoryId,
      });
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
