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
  AnalysisIntegritySnapshot,
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

export type {
  LocationReportDataFreshness,
  LocationReportResultMetadata,
  LocationReportSourceStatus,
} from './report-result-metadata';
export {
  buildLocationReportResultMetadata,
  clientFreshnessPlainTextRu,
  normalizeReportAddress,
  resolveProcurementSourceDisclosureStatus,
} from './report-result-metadata';
export type {
  LocationStandaloneReport,
  LocationStandaloneReportMode,
  LocationStandaloneReportSectionId,
} from './standalone-report';
export type { LocationCommercialReport, PersistableLocationReport } from './standalone-report';
export { isCanonicalLocationReportPayload, isLocationCommercialReport, buildCommercialReport } from './standalone-report';
export {
  buildFastReportPreview,
  sampleFullLocationReportRu,
  URBAN_DEVELOPMENT_LIVE_SOURCES_DISCLAIMER_RU,
} from './report-contract';
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
  UrbanDevelopmentGeoSignalPrecision,
  UrbanDevelopmentGeoPoint,
  UrbanDevelopmentLifecycleStage,
  UrbanDevelopmentManualCheck,
  UrbanDevelopmentSignal,
  UrbanDevelopmentSignalInput,
  UrbanDevelopmentSignalsSnapshot,
  UrbanDevelopmentSignalSourceProvenance,
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
  PUBLIC_PROCUREMENT_LIVE_PROBE_ADAPTER_OPTION_KEYS,
  PUBLIC_PROCUREMENT_LIVE_PROBE_ENV_KEY,
  PublicProcurementLiveClient,
  createPublicProcurementLiveProbeAdapter,
  isPublicProcurementLiveProbeEnabled,
  resolvePublicProcurementLiveProbeSourceAccessMode,
} from './data-sources/public-procurement/public-procurement-live-probe-adapter';
export type {
  PublicProcurementLiveProbeUrbanAdapter,
  PublicProcurementSourceAccessMode,
} from './data-sources/public-procurement/public-procurement-live-probe-adapter';
export type {
  UrbanDevelopmentForecastConfidence,
  UrbanDevelopmentForecastContributingSignalRef,
  UrbanDevelopmentForecastLevel,
  UrbanDevelopmentForecastScore,
} from './data-sources/urban-development-forecast-score';
export {
  computeUrbanDevelopmentForecastScore,
  emptyUrbanDevelopmentForecastScore,
} from './data-sources/urban-development-forecast-score';
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

export type {
  EvergreenIndexDiagnostics,
  LocationScoreFeatures,
  LocationScoringCapApplied,
  LocationScoringIntegritySnapshot,
  LocationScoringTrace,
} from './location-scoring-trace';
export { buildLocationScoringTrace } from './location-scoring-pipeline';

export {
  applyLocationDataIntegrityGate,
  evaluateLocationDataIntegrity,
  cacheEntryPassesDataIntegrity,
  locationDemoPresentationBlocked,
  locationDemoIncompleteUserMessage,
  LOCATION_DEMO_INCOMPLETE_RU,
  LOCATION_DEMO_INCOMPLETE_EN,
  isLikelyUrbanCoordinates,
} from './location-data-integrity';
export type {
  LocationDataIntegrityWarningCode,
  LocationDataIntegrityInput,
  LocationDataIntegrityResult,
  CacheEntryIntegrityProbe,
} from './location-data-integrity';
export {
  applyReportProjectionToTrace,
  enrichAnalysisWithReportProjection,
} from './location-scoring-projection';
export type { LocationReportPublicMode } from './location-scoring-projection';
export { LOCATION_SCORING_RUNTIME_EXPORT } from './location-scoring-rules';

export {
  buildLocationScoreOutput,
  computeLocationScoreFeatures,
  withAdjustedLocationScoreHeadline,
} from './location-score';
export type { LocationScoreComputationInput } from './location-score';

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
