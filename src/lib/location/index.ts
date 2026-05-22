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
export type {
  FreeLocationReportForbiddenField,
  FreeLocationReportSectionId,
  LocationReportScopeMode,
  PaidLocationReportSectionId,
  PlannedLocationReportSection,
  PlannedLocationReportSectionId,
  ReportScopeSectionStatus,
} from './report-scope-contract';
export {
  FREE_TOP_EVIDENCE_BULLETS_LIMIT,
  commercialFootTrafficPlannedSection,
  forbiddenFreeReportFields,
  freePdfSections,
  freeReportSections,
  isFreeReportFieldForbidden,
  isFreeReportSectionAllowed,
  locationReportScopeContract,
  paidPdfSections,
  paidReportSections,
  resolveCommercialFootTrafficSectionStatus,
} from './report-scope-contract';
export type {
  FreeLocationReportScopeSectionId,
  FreeLocationReportStructureSectionId,
  LocationReportStructureCta,
  LocationReportStructureMode,
  LocationReportStructureSection,
  LocationReportStructureViewModel,
  PaidLocationReportScopeSectionId,
  PaidLocationReportStructureSectionId,
} from './location-report-structure';
export {
  FREE_LOCATION_REPORT_CTA,
  FREE_PAID_REPORT_TEASER_RU,
  PAID_LOCATION_REPORT_CTA,
  buildLocationReportStructureViewModel,
  freeLocationReportStructureSections,
  getLocationReportScopeSectionIds,
  getLocationReportStructureSection,
  paidLocationReportStructureSections,
} from './location-report-structure';
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
export type {
  LocationSourceAccessClass,
  LocationSourceAdapterContract,
  LocationSourceAdapterStatus,
  LocationSourceFreshness,
  LocationSourceLayer,
} from './data-sources/source-adapter-registry';
export {
  LOCATION_SOURCE_ADAPTER_REGISTRY,
  SELECTIVE_LOCATION_SOURCE_PARSING_POLICY_RU,
  listLocationSourceAdaptersByLayer,
  sourceRegistryHasOnlyCanonicalUiAdapters,
} from './data-sources/source-adapter-registry';
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
  LOCATION_REPORT_STATUS_PATH,
} from './report-state';
export {
  REPORT_ARTIFACT_STATUS,
  REPORT_ARTIFACT_STATUSES,
  buildReportArtifactUrls,
  isReportArtifactStatus,
  normalizeReportArtifactStatus,
  reportArtifactWithSampleUrls,
} from './report-artifact';
export type {
  ReportArtifact,
  ReportArtifactMetadata,
  ReportArtifactStatus,
} from './report-artifact';
export {
  REPORT_SIGNAL_ADAPTER_REGISTRY,
  collectReportSignalsForLayers,
  getEnabledReportSignalAdaptersByLayer,
  getEnabledReportSignalAdaptersForLayers,
} from './report-signal-adapters';
export type {
  ReportSignal,
  ReportSignalAdapter,
  ReportSignalAdapterRegistry,
  ReportSignalAdapterSummary,
  ReportSignalCollectRequest,
  ReportSignalCollectionSummary,
  ReportSignalLayer,
  ReportSignalResult,
  ReportSignalResultStatus,
} from './report-signal-adapters';
export {
  buildLocationReportStatusHref,
  LOCATION_REPORT_STATUS_ACTIONS,
  LOCATION_REPORT_ARTIFACT_INITIAL_STATUS,
  LOCATION_REPORT_STATUS_INITIAL_STAGE,
  LOCATION_REPORT_STATUS_STAGE_CONFIG,
  LOCATION_REPORT_STATUS_STAGE_SEQUENCE,
} from './report-status-flow';
export type { LocationReportStatusStage } from './report-status-flow';
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
export type {
  RetailPremisesAttributes,
  RetailPremisesFloorClass,
  StreetRetailSuitabilityResult,
  TriState,
} from './street-retail-suitability';
export {
  RETAIL_FRONTAGE_METHODOLOGY_RU,
  RETAIL_FLOOR_LEVEL_METHODOLOGY_RU,
  RETAIL_TARGET_TRAFFIC_WARNING_RU,
  MANUAL_CHECK_FRONTAGE_RU,
  MANUAL_CHECK_FLOOR_AND_FRONTAGE_RU,
  computeAreaTargetFlowScore,
  computeFrontageAccessibilityScore,
  evaluateStreetRetailSuitability,
  isFrontageDataComplete,
  parseRetailPremisesFromObjectContext,
  streetRetailFitCap,
} from './street-retail-suitability';

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
  locationDemoAnalysisHasUsablePublicSummary,
  locationDemoPublicSummaryHasUsableDriverLines,
  resolveLocationDemoPublicScoreState,
} from './location-demo-public-score-state';
export type {
  LocationDemoPublicScoreMode,
  LocationDemoPublicScoreState,
} from './location-demo-public-score-state';
export {
  applyReportProjectionToTrace,
  enrichAnalysisWithReportProjection,
} from './location-scoring-projection';
export type { LocationReportPublicMode } from './location-scoring-projection';
export { LOCATION_SCORING_RUNTIME_EXPORT } from './location-scoring-rules';
export type {
  CanonicalCityScale,
  CanonicalDensityLevel,
  CanonicalLocationWeight,
  CanonicalLocationWeightInput,
  CanonicalRoleStrength,
  Level1EntityType,
  Level1MagnetClassification,
  Level1MagnetGroup,
  Level1MagnetGroupId,
} from './level1-magnet-taxonomy';
export {
  LEVEL1_MAGNET_RULES_RU,
  LEVEL1_MAGNET_TAXONOMY,
  MINOR_POI_BACKGROUND_CATEGORY_IDS,
  classifyLevel1Magnet,
  dedupeCanonicalMagnets,
  estimateCanonicalLocationWeight,
  isBackgroundMinorPoi,
} from './level1-magnet-taxonomy';

export {
  buildLocationScoreOutput,
  computeLocationScoreFeatures,
  withAdjustedLocationScoreHeadline,
} from './location-score';
export type { LocationScoreComputationInput } from './location-score';

export { computeNeighborhoodEnvironmentCommercialModifier } from './neighborhood-environment-commercial-modifier';
export { computeTerritorialScoringModifier } from './territorial-scoring-modifier';
export type {
  TerritorialScoringModifierContribution,
  TerritorialScoringModifierReason,
  TerritorialScoringModifierSnapshot,
} from './territorial-scoring-modifier';

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
  H3_COVERAGE_PROFILES,
  buildH3TerritoryIntelligence,
  buildH3TerritoryIntelligenceForAnalysis,
  h3CoverageCellsForRadius,
} from './h3';
export type {
  H3CoverageAnalysisType,
  H3CoverageOptions,
  H3CoverageProfile,
  H3Coordinate,
  H3RadiusCoverage,
  H3BusinessTravelerSignalLevel,
  H3BusinessTravelerSuitabilitySignals,
  H3DeadZoneSignal,
  H3MonoFunctionalSignal,
  H3TerritoryComparisonVector,
  H3TerritoryFunctionality,
  H3TerritoryIntelligence,
  H3TerritoryIntelligenceOptions,
} from './h3';
export {
  TERRITORIAL_SCORING_BRIDGE_VERSION,
  buildTerritorialScoringBridgeSignals,
  buildTerritorialScoringSignalsForAnalysis,
} from './territorial-scoring-bridge';
export type {
  TerritorialNormalizedPenalty,
  TerritorialNormalizedSignal,
  TerritorialPenaltyLevel,
  TerritorialScoringBridgeAnalysisOptions,
  TerritorialScoringBridgeSignals,
  TerritorialScoringBridgeSource,
  TerritorialSignalCategory,
  TerritorialSignalLevel,
  TerritorialSignalQuality,
} from './territorial-scoring-bridge';

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

export {
  applyResidentialDemoSanity,
  computeResidentialDemoPresentation,
  applyResidentialDemoPresentationToAnalysis,
  cloneAnalysisForResidentialDemoPatch,
} from './residential-demo-sanity';
export type {
  ResidentialDemoSanity,
  ResidentialDemoAudience,
  ResidentialDemoVerdictTone,
} from './residential-demo-sanity';

export { publicLocationScore, scoreBandFromPublicScore } from './location-score-public';
export { buildLocationScoreCustodySnapshot, assertPublicScoreCustody } from './location-score-chain-of-custody';
export type { LocationScoreCustodySnapshot } from './location-score-chain-of-custody';

export {
  buildLocationDecision,
  attachLocationDecisionToAnalysis,
  ruResidentialLocationDecisionForDemo,
} from './location-decision-kernel';
export type { LocationDecisionBuildInput } from './location-decision-kernel';
export type {
  LocationDecision,
  LocationDecisionScoreBand,
  AddressIdentity,
  CanonicalLocationFact,
  MagnetFact,
  MagnetRole,
  MagnetTier,
  DemandSignal,
  LocationEvidenceItem,
  LocationUiProjection,
  LocationPublicReportSection,
  LocationDecisionRawObjectStats,
  LocationDecisionDataIntegrity,
  LocationPublicClaim,
  LocationPublicClaimTrace,
} from './location-decision-contract';
export {
  buildPublicClaimsRu,
  lintPublicClaimSurfaceRu,
  publicDemandProfileHeadline,
  validatePublicClaimPipeline,
} from './location-public-claims';
