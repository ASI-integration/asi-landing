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
export { buildCommercialReport, isCanonicalLocationReportPayload, isLocationCommercialReport } from './standalone-report';
export { buildLocationStandaloneReport } from './standalone-report';
export { buildFastReportPreview, sampleFullLocationReportRu } from './report-contract';
export {
  buildExpressLocationReport,
  buildFullLocationReport,
  locationReportInputFromLegacy,
} from './unified-report';
export {
  buildLocationReportPermalink,
  createPreviewReportInput,
  createReportStateRecord,
  LOCATION_REPORT_PRODUCT_PATH,
  LOCATION_REPORT_SAMPLE_PATH,
} from './report-state';

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
export { patchLegacyLocationAnalysis, emptyFootTrafficSummary } from './foot-traffic';
export { buildLocationScoreOutput, withAdjustedLocationScoreHeadline } from './location-score';
export { computeNeighborhoodEnvironmentCommercialModifier } from './neighborhood-environment-commercial-modifier';
export { computeTerritorialScoringModifier } from './territorial-scoring-modifier';
export type {
  TerritorialScoringModifierContribution,
  TerritorialScoringModifierReason,
  TerritorialScoringModifierSnapshot,
} from './territorial-scoring-modifier';
export { buildNeighborhoodEnvironmentLayer, emptyNeighborhoodEnvironmentLayer, mergeNeighborhoodEnvironmentLayer } from './neighborhood-environment';
export {
  applyLocationDataIntegrityGate,
  locationDemoPresentationBlocked,
  locationDemoIncompleteUserMessage,
  LOCATION_DEMO_INCOMPLETE_RU,
  LOCATION_DEMO_INCOMPLETE_EN,
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

export type {
  LocationStandaloneReport,
  LocationStandaloneReportMode,
  LocationStandaloneReportSectionId,
  LocationCommercialReport,
} from './standalone-report';
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
  UrbanDevelopmentForecastConfidence,
  UrbanDevelopmentForecastContributingSignalRef,
  UrbanDevelopmentForecastLevel,
  UrbanDevelopmentForecastScore,
  UrbanDevelopmentSignals,
} from './unified-report';
export type {
  PlannedConstructionProject,
  PlannedInfrastructureChange,
  UrbanDevelopmentSignalsSnapshot,
  UrbanDevelopmentSourceReference,
  UrbanDevelopmentSourceType,
  ZoningPlanningNote,
} from './data-sources/urban-development';
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

export {
  buildLocationDecision,
  attachLocationDecisionToAnalysis,
  ruResidentialLocationDecisionForDemo,
} from './location-decision-kernel';
export type { LocationDecisionBuildInput } from './location-decision-kernel';
export {
  RU_RESIDENTIAL_NEUTRAL_EVIDENCE_LINE_RU,
  formatRuResidentialEvidenceRowRu,
  resolveRuResidentialDemandHeadlineRu,
  buildRuResidentialPublicEvidenceLines,
  ruResidentialDemandSignalsIncludeTouristEvidence,
} from './ru-residential-ui-projection';
export type {
  LocationDecision,
  LocationUiProjection,
  MagnetFact,
  DemandSignal,
  LocationEvidenceItem,
  LocationPublicClaim,
  LocationPublicClaimTrace,
  LocationPublicSummary,
  LocationPublicDriverRow,
  LocationPublicSummaryDemandType,
} from './location-decision-contract';
export {
  buildLocationPublicSummary,
  selectStrictPublicSummaryDrivers,
  applyVerdictContradictionGuards,
  strongBusinessContributionFromDrivers,
} from './location-public-summary';
export {
  lintPublicClaimSurfaceRu,
  publicDemandProfileHeadline,
  validatePublicClaimPipeline,
} from './location-public-claims';
export { formatLocationDemandKernelDebug } from './location-scoring-debug';
