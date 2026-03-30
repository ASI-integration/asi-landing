// Public API of the location gravity engine

export type {
  PermanenceType,
  MagnetCategory,
  OSMElement,
  MagnetItem,
  CompetitorItem,
  GravityExplanation,
  HeatmapPoint,
  ScoreBand,
  Band,
  LocationAnalysis,
} from './types';

export {
  MAGNET_CATEGORIES,
  CATEGORY_RADIUS,
  CATEGORY_MAX_SHOW,
  COMPETITOR_RADIUS,
  PERMANENCE_MULTIPLIER,
  GRAVITY_CONFIG,
  CATEGORY_COLOR,
} from './config';

export { fetchOsmData, classifyElement } from './overpass';

export {
  haversineMeters,
  formatDist,
  distanceDecaySmooth,
  calcMagnetAttraction,
  calcCompetitorPressure,
  calcClusterBonus,
  detectDemandDistribution,
  detectClusterZones,
  calcEvergreenIndex,
  buildAnalysis,
} from './gravity-scoring';

export { getBand, bandFromScoreBand, generateConclusion } from './explanation';

export { computeHeatmap, projectToSVG } from './heatmap';
export type { ProjectedPoint } from './heatmap';
