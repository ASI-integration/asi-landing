// Client-safe public API for Location Intelligence UI.
//
// IMPORTANT: do not export any server-only modules here (Overpass fetch, disk cache, fs/path, etc).

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

export { buildCommercialFormatFit, FIT_LEVEL_LABEL_RU, FIT_LEVEL_COLOR } from './commercial-format-fit';
export { buildCommercialReport, isLocationCommercialReport } from './standalone-report';
export { buildLocationStandaloneReport } from './standalone-report';

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

export { getBand, bandFromScoreBand, generateConclusion, accessVerdictRu } from './explanation';
export { computeHeatmap, projectToSVG } from './heatmap';
export { patchLegacyLocationAnalysis, emptyFootTrafficSummary } from './foot-traffic';
export { buildLocationScoreOutput, withAdjustedLocationScoreHeadline } from './location-score';
export { computeNeighborhoodEnvironmentCommercialModifier } from './neighborhood-environment-commercial-modifier';
export { buildNeighborhoodEnvironmentLayer, emptyNeighborhoodEnvironmentLayer, mergeNeighborhoodEnvironmentLayer } from './neighborhood-environment';
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
  ResidentialAudienceType,
  ResidentialStrategy,
  OperationalSuitability,
  ResidentialAnalysisConfidence,
  ResidentialAnalysisOutput,
} from './types';

export type { LocationStandaloneReport, LocationStandaloneReportSectionId, LocationCommercialReport } from './standalone-report';
export {
  LOCATION_REPORT_OBJECT_TYPES,
  LOCATION_REPORT_OBJECT_STATUSES,
  LOCATION_REPORT_INTENDED_STRATEGIES,
  LOCATION_REPORT_RENOVATION_LEVELS,
  LOCATION_REPORT_PARKING_VALUES,
  LOCATION_REPORT_MODULES,
  LOCATION_REPORT_INCOME_DISCLAIMER_RU,
} from './report-intake';
export type {
  LocationReportIntake,
  LocationReportModule,
  LocationReportObjectParams,
} from './report-intake';
