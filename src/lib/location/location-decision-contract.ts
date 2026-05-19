/**
 * Location Decision Kernel — central contract for end-to-end location analysis.
 * Downstream layers consume LocationDecision; they must not invent magnets, demand, or scores.
 */

import type {
  LocationScoringIntegritySnapshot,
  LocationScoringTrace,
} from './location-scoring-trace';
import type {
  LocationDemandKernelDemandType,
  LocationDemandScoringKernelResult,
} from './location-scoring-contract';
import type { CityScale, PopulationTier, SpecialMarketFlag } from './city-scale-from-address';

/** Mirrors ScoreBand — kept local to avoid circular imports with types.ts */
export type LocationDecisionScoreBand = 'strong' | 'medium' | 'weak' | 'none';

export type LocationAnalysisSubjectType = 'address' | 'building' | 'poi' | 'ambiguous';

export interface AddressIdentity {
  subjectType: LocationAnalysisSubjectType;
  /** Canonical point the engine scored (building centroid / address geocode). */
  selectedAddressPoint: { lat: number; lon: number };
  /** POIs returned at the same coordinate — magnets only, never replace subject. */
  selectedPoiAtSameAddress: ReadonlyArray<{ name: string; categoryHint?: string }>;
  warnings: string[];
}

export interface CanonicalLocationFact {
  id: string;
  source: 'osm_overpass' | 'derived_magnet' | 'derived_competitor';
  name: string;
  category: string;
  subtype?: string;
  coordinates?: { lat: number; lon: number };
  distanceMeters?: number;
  confidence: 'high' | 'medium' | 'low';
  rawTags?: Record<string, string>;
  warnings: string[];
}

export type MagnetTier = 'primary' | 'secondary' | 'weak' | 'ignored';

/** Local map POI vs city-scale strategic context (no walking distance). */
export type LocationEvidenceAnchorKind = 'local_poi' | 'city_level_strategic';

export type MagnetRole =
  | 'accessibility'
  | 'business_demand'
  | 'medical_demand'
  | 'tourist_demand'
  | 'event_demand'
  | 'transport_anchor'
  | 'local_interest'
  | 'competitor'
  | 'environment_risk';

export interface MagnetFact {
  id: string;
  name: string;
  category: string;
  subtype?: string;
  tier: MagnetTier;
  role: MagnetRole;
  /** Null for city-level strategic anchors — never render as «0 м». */
  distanceMeters: number | null;
  anchorKind?: LocationEvidenceAnchorKind;
  isNearbyPoi?: boolean;
  contributesToLocalDistanceScore?: boolean;
  evidenceSource: 'classified_magnet' | 'strategic_hub_layer';
  includedInScore: boolean;
  includedInPublicReport: boolean;
  explanationRu: string;
  explanationEn: string;
  /** Internal scoring weight — never exposed in public copy */
  internalWeight?: number;
  /** Optional numeric contribution hint — internal only */
  scoreImpactHint?: number;
}

export type DemandSignalStrength = 'weak' | 'moderate' | 'strong';

export interface DemandSignal {
  id: string;
  type: string;
  strength: DemandSignalStrength;
  evidenceFactIds: string[];
  reason: string;
  publicLabelRu: string;
  internalReason: string;
}

export interface LocationEvidenceItem {
  /** Stable UI/trace id — pairs with {@link MagnetFact.id} via {@link factId}. */
  evidenceId: string;
  factId: string;
  objectName: string;
  typeRu: string;
  subtypeRu?: string;
  distanceMeters: number | null;
  anchorKind?: LocationEvidenceAnchorKind;
  isNearbyPoi?: boolean;
  contributesToLocalDistanceScore?: boolean;
  publicExplanationRu: string;
}

/** Trace bundle for every kernel-backed public bullet (RU copy surface). */
export interface LocationPublicClaimTrace {
  magnetFactId: string;
  evidenceId: string;
  demandSignalId: string | null;
  eligibilityReason: string;
}

export interface LocationPublicClaim {
  textRu: string;
  trace: LocationPublicClaimTrace;
}

export interface LocationPublicReportSection {
  id: string;
  titleRu: string;
  summaryRu?: string;
}

export interface LocationUiProjection {
  publicScore: number;
  scoreBand: LocationDecisionScoreBand;
  heroTitle: string;
  keyEvidenceBullets: string[];
  environmentSummary: string;
  strategySummary: string;
  warnings: string[];
}

/** Canonical RU residential demo public surface — single consumer for hero / demand / verdict / bullets / strategy. */
export type LocationPublicSummaryDemandType = LocationDemandKernelDemandType;

export interface LocationPublicDriverRow {
  textRu: string;
  trace: LocationPublicClaimTrace;
}

export interface LocationPublicRejectedRow {
  sourceName: string;
  reason: string;
}

export interface LocationPublicSummaryTrace {
  headlineReason: string;
  verdictReason: string;
  contradictionWarnings: string[];
}

/** RU residential demo / golden harness diagnostics — safe to log; not primary UI copy. */
export type LocationPublicScoreConfidence = 'sufficient' | 'requires_full_check' | 'insufficient_map_data';

export interface LocationPublicPresentationDiagnostics {
  partialCartographicPreview: boolean;
  partialDataScoreCapApplied: boolean;
  partialDataScoreCapReason: string | null;
  scoreBeforePartialDataCap: number | null;
  scoreAfterPartialDataCap: number | null;
  genericMedicalSuppressed: boolean;
  verifiedMajorMedicalAnchorCount: number;
  fallbackPoiCount?: number | null;
  fallbackMedicalPoiCount?: number | null;
  nearbyClusterDetected?: boolean;
  conservativeClusterFloorApplied?: boolean;
  clusterFloorReason?: string | null;
  hasCityLevelStrategicAnchor?: boolean;
  cityLevelStrategicAnchorOnly?: boolean;
}

export interface LocationPublicSummary {
  finalScore: number | null;
  scoreBand: LocationDecisionScoreBand;
  primaryDemandType: LocationPublicSummaryDemandType;
  secondaryDemandTypes: LocationPublicSummaryDemandType[];
  cityScale: CityScale;
  populationTier: PopulationTier;
  marketGravityCoefficient: number;
  specialMarketFlags: readonly SpecialMarketFlag[];
  /** Deterministic score cap reason when a city-scale guard reduced the headline score. */
  scoreCapReason: string | null;
  headlineRu: string;
  audienceVerdictRu: string;
  /** Canonical RU label for hero / free report score tile — respects confidence gates. */
  publicScoreLabelRu: string;
  publicScoreConfidence: LocationPublicScoreConfidence;
  publicDrivers: LocationPublicDriverRow[];
  supportingContext: string[];
  rejectedFromPublic: LocationPublicRejectedRow[];
  warnings: string[];
  debugTrace: string[];
  recommendedStrategyBulletsRu: string[];
  trace: LocationPublicSummaryTrace;
  presentationDiagnostics?: LocationPublicPresentationDiagnostics;
}

export interface LocationDecisionRawObjectStats {
  rawObjectsCount: number;
  classifiedMagnetCount: number;
  competitorCount: number;
}

export interface LocationDecisionDataIntegrity {
  analysisIncomplete?: boolean;
  scoreBlockedDueToIncompleteData?: boolean;
  integrityReasons: string[];
  traceIntegritySnapshot?: LocationScoringIntegritySnapshot;
}

/** Unified kernel output — single source of truth for analysis semantics */
export interface LocationDecision {
  inputAddress: string;
  addressIdentity: AddressIdentity;
  coordinates: { lat: number; lon: number };
  dataIntegrity: LocationDecisionDataIntegrity;
  rawObjectStats: LocationDecisionRawObjectStats;
  canonicalFacts: CanonicalLocationFact[];
  magnetFacts: MagnetFact[];
  /** Deterministic demand scoring v1 — ranks POIs before score / headline / public claims */
  demandKernelV1: LocationDemandScoringKernelResult | null;
  demandSignals: DemandSignal[];
  scoreTrace: LocationScoringTrace | null;
  finalScore: number | null;
  scoreBand: LocationDecisionScoreBand;
  evidenceItems: LocationEvidenceItem[];
  /** Kernel-backed bullets with MagnetFact / DemandSignal trace — preferred public surface. */
  publicClaims: LocationPublicClaim[];
  /** RU residential demo: sole source for public UI; {@link publicClaims} align with {@link LocationPublicSummary.publicDrivers}. */
  publicSummary: LocationPublicSummary | null;
  publicReportSections: LocationPublicReportSection[];
  uiProjection: LocationUiProjection;
  warnings: string[];
}
