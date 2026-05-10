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
export type { LocationCommercialReport, PersistableLocationReport } from './standalone-report';
export { isCanonicalLocationReportPayload, isLocationCommercialReport, buildCommercialReport } from './standalone-report';
export { buildFastReportPreview, sampleFullLocationReportRu } from './report-contract';
export {
  buildExpressLocationReport,
  buildFullLocationReport,
  locationReportInputFromLegacy,
} from './unified-report';
export type {
  AudienceFitSignals,
  CompetitionSignals,
  DataQuality,
  DecisionRecommendation,
  DemandSignals,
  EnvironmentalTrafficRiskSignals,
  EvidenceItem,
  HeatMapSignals,
  LocationReportContext,
  LocationReportInput,
  LocationReportSection,
  MagnetSignals,
  PricingSignals,
  ReportLevel,
  RiskSignals,
  SeasonalitySignals,
  SourceAvailability,
  TransportInfrastructureSignals,
  UnifiedLocationReport,
  UrbanDevelopmentSignals,
} from './unified-report';
export type {
  InfrastructurePlansUrbanDevelopmentAdapter,
  IntegratedDevelopmentUrbanDevelopmentAdapter,
  LandAuctionsUrbanDevelopmentAdapter,
  MasterPlanUrbanDevelopmentAdapter,
  PlannedConstructionProject,
  PlannedInfrastructureChange,
  PlanningProjectsUrbanDevelopmentAdapter,
  PublicHearingsUrbanDevelopmentAdapter,
  PublicProcurementUrbanDevelopmentAdapter,
  UrbanDevelopmentAdapter,
  UrbanDevelopmentBoundingBox,
  UrbanDevelopmentCollectInput,
  UrbanDevelopmentCollectionResult,
  UrbanDevelopmentCollectionStatus,
  UrbanDevelopmentConfidence,
  UrbanDevelopmentEvidence,
  UrbanDevelopmentGeoPoint,
  UrbanDevelopmentLifecycleStage,
  UrbanDevelopmentManualCheck,
  UrbanDevelopmentSignal,
  UrbanDevelopmentSignalInput,
  UrbanDevelopmentSignalsSnapshot,
  UrbanDevelopmentSignalStatus,
  UrbanDevelopmentSignalType,
  UrbanDevelopmentSourceKind,
  UrbanDevelopmentSourceReference,
  UrbanDevelopmentSourceType,
  UrbanDevelopmentTimeHorizon,
  ZoningPlanningNote,
  ZoningRulesUrbanDevelopmentAdapter,
} from './data-sources/urban-development';
export {
  collectUrbanDevelopmentSignals,
  getUrbanDevelopmentAdapters,
  normalizeUrbanDevelopmentSignals,
  urbanDevelopmentSnapshotFromSignals,
} from './data-sources/urban-development';
export {
  buildLocationReportPermalink,
  createPreviewReportInput,
  createReportStateRecord,
  LOCATION_REPORT_PRODUCT_PATH,
  LOCATION_REPORT_SAMPLE_PATH,
} from './report-state';
export type {
  AudienceFit,
  CompetitionSummary,
  Confidence,
  DataQualityLevel,
  FastReportPreview,
  FullLocationReport,
  IncomePotential,
  MagnetImpact,
  RecommendationItem,
  ReportInput,
  ReportLifecycleStatus,
  ReportMode,
  ReportSection,
  ReportSource,
  ReportStateRecord,
  RiskItem,
} from './report-contract';
export type { ReportPermalinkSurface } from './report-state';

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

export { buildResidentialAnalysis } from './residential-analysis';

export { applyResidentialDemoSanity } from './residential-demo-sanity';
export type {
  ResidentialDemoSanity,
  ResidentialDemoAudience,
  ResidentialDemoVerdictTone,
} from './residential-demo-sanity';
