// Public API of the location gravity engine

export type {
  DemandType,
  PermanenceType,
  MagnetCategory,
  OSMElement,
  MagnetItem,
  CompetitorItem,
  GravityExplanation,
  FootTrafficSummary,
  FootTrafficModifierTier,
  HeatmapPoint,
  ScoreBand,
  Band,
  LocationAnalysis,
  LocationScoreOutput,
  AnalysisFreshness,
  AnalysisMeta,
  AccessibilityStopItem,
  // Audience layer
  TargetAudience,
  LocationType,
  PrimaryMagnet,
  AudienceAnalysis,
} from './types';

export type {
  LocationReportOutput,
  LocationReportPreview,
  LocationReportFull,
  LockedField,
} from './location-report-paywall';

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
export type { OsmFetchResult } from './overpass';

// ── Provider interfaces ────────────────────────────────────────────────────────
export type { MagnetProvider, MagnetFetchResult, GeocodingProvider, GeocodeResult, MapDisplayProvider } from './providers/types';
export { osmOverpassProvider } from './providers/osm-overpass';
export { nominatimGeocodingProvider, geocodeWithFallback } from './providers/geocoding';
export type { GeocodeAttemptStatus } from './providers/geocoding';

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

export { buildLocationScoreOutput } from './location-score';

export {
  detectLocationType,
  classifyPrimaryMagnets,
  calculateAudienceFitScore,
  buildAudienceAnalysis,
} from './audience-scoring';

export { getBand, bandFromScoreBand, generateConclusion } from './explanation';

export { computeHeatmap, projectToSVG } from './heatmap';
export type { ProjectedPoint } from './heatmap';

export {
  patchLegacyLocationAnalysis,
  emptyFootTrafficSummary,
} from './foot-traffic';
export type { FootTrafficHeatmapFactors } from './foot-traffic';

export { fetchCompetitorData } from './competitors';
export type {
  MarketListing,
  CompetitorMarketData,
  CompetitorFetchOptions,
} from './competitors';

export {
  wrapLocationReport,
  toLocationReportPreview,
  toLocationReportFull,
} from './location-report-paywall';
