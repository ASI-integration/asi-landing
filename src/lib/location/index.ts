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
  NeighborhoodEnvironmentLayer,
  NeighborhoodEnvironmentConcernLevel,
  NeighborhoodEnvironmentCommercialModifierSnapshot,
  SpatialTier,
  BarrierKind,
  SpatialFoundationSnapshot,
  // Residential analysis layer
  ResidentialAudienceType,
  ResidentialStrategy,
  OperationalSuitability,
  ResidentialAnalysisConfidence,
  ResidentialAnalysisOutput,
} from './types';

export type {
  LocationReportOutput,
  LocationReportPreview,
  LocationReportFull,
  LockedField,
} from './location-report-paywall';

export type { LocationStandaloneReport, LocationStandaloneReportSectionId } from './standalone-report';
export type { LocationCommercialReport } from './standalone-report';
export { isLocationCommercialReport, buildCommercialReport } from './standalone-report';

export type {
  CommercialFormatType,
  CommercialFormatFitLevel,
  CommercialFormatFitEntry,
  CommercialFormatFit,
  CommercialOverallVerdict,
} from './commercial-format-fit';
export { buildCommercialFormatFit, FIT_LEVEL_LABEL_RU, FIT_LEVEL_COLOR } from './commercial-format-fit';

export {
  MAGNET_CATEGORIES,
  CATEGORY_RADIUS,
  CATEGORY_MAX_SHOW,
  COMPETITOR_RADIUS,
  PERMANENCE_MULTIPLIER,
  GRAVITY_CONFIG,
  CATEGORY_COLOR,
  NEIGHBORHOOD_ENV_SCORE_MODIFIER,
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
export type { BuildAnalysisOptions } from './gravity-scoring';

export { buildLocationScoreOutput, withAdjustedLocationScoreHeadline } from './location-score';

export { computeNeighborhoodEnvironmentCommercialModifier } from './neighborhood-environment-commercial-modifier';

export {
  detectLocationType,
  classifyPrimaryMagnets,
  calculateAudienceFitScore,
  buildAudienceAnalysis,
} from './audience-scoring';

export { getBand, bandFromScoreBand, generateConclusion, accessVerdictRu } from './explanation';

export { computeHeatmap, projectToSVG } from './heatmap';
export type { ProjectedPoint } from './heatmap';

export {
  patchLegacyLocationAnalysis,
  emptyFootTrafficSummary,
} from './foot-traffic';

export {
  buildNeighborhoodEnvironmentLayer,
  emptyNeighborhoodEnvironmentLayer,
  mergeNeighborhoodEnvironmentLayer,
} from './neighborhood-environment';
export type { NeighborhoodEnvironmentContext } from './neighborhood-environment';
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

export { buildLocationStandaloneReport, isLocationStandaloneReportV1 } from './standalone-report';
export type { PrimeMagnetAnchorType } from './residential-prime-magnets';
export {
  LOCATION_REPORT_OBJECT_TYPES,
  LOCATION_REPORT_OBJECT_STATUSES,
  LOCATION_REPORT_INTENDED_STRATEGIES,
  LOCATION_REPORT_RENOVATION_LEVELS,
  LOCATION_REPORT_PARKING_VALUES,
  LOCATION_REPORT_MODULES,
  LOCATION_REPORT_INCOME_DISCLAIMER_RU,
  validateLocationReportIntake,
} from './report-intake';
export type {
  LocationReportIntake,
  LocationReportModule,
  LocationReportObjectParams,
} from './report-intake';

export { buildResidentialAnalysis } from './residential-analysis';

export { applyResidentialDemoSanity } from './residential-demo-sanity';
export type {
  ResidentialDemoSanity,
  ResidentialDemoAudience,
  ResidentialDemoVerdictTone,
} from './residential-demo-sanity';

export { buildLocationDisplayModel } from './location-display-model';
export type {
  LocationDisplayModel,
  LocationDisplayAudience,
  LocationSafeDriver,
  BuildLocationDisplayModelOptions,
} from './location-display-model';
