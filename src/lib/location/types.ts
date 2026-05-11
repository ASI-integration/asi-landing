// ── Gravity / Evergreen engine — shared types ─────────────────────────────────
// Map/OSM data types live here alongside ASI interpretation types.
// Keep them clearly separated in comments: real-world vs ASI layer.

import type { MagnetDiagnosticsLayer } from './magnet-diagnostics';
import type { LocationScoringTrace } from './location-scoring-trace';

// ── Real-world / map layer ────────────────────────────────────────────────────

export type PermanenceType = 'permanent' | 'semi' | 'temporary';

/** Catchment / scope level of a demand object */
export type ScopeLevel = 'local' | 'district' | 'city' | 'regional' | 'federal';

/** Strength class: drives peripheral penalty and cluster qualification */
export type StrengthClass = 'strong' | 'medium' | 'weak';

export interface MagnetCategory {
  id: string;
  /** English display label (default for API / global site) */
  label: string;
  /** Russian label for /ru UI */
  labelRu: string;
  icon: string;            // short badge text
  weight: number;          // 1–10
  permanenceType: PermanenceType;
  scopeLevel: ScopeLevel;
  strengthClass: StrengthClass;
}

export interface OSMElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** A real-world demand magnet detected near the subject property */
export interface MagnetItem {
  categoryId: string;
  categoryLabel: string;
  icon: string;
  name: string;
  lat: number;
  lon: number;
  distance: number;        // meters from subject
  weight: number;
  permanenceType: PermanenceType;
  scopeLevel: ScopeLevel;
  strengthClass: StrengthClass;
  attractionScore: number; // ASI computed gravity score
  /**
   * Sub-type for business magnets: 'factory' | 'industrial' | 'office' | 'commercial' | 'bank'.
   * Undefined for non-business categories.
   */
  subType?: string;
  /**
   * Only on `strategicTransportHub`: narrative/scoring band for hubs detected beyond the primary radius.
   */
  strategicReachBand?: 'secondary' | 'strategic';
  /**
   * Only on `specializedMedicalAnchor`: distance band for large healthcare POIs beyond ordinary hospital radius.
   */
  specializedMedicalReachBand?: 'primary' | 'secondary';
}

/** A nearby short-term rental competitor detected in OSM */
export interface CompetitorItem {
  name: string;
  lat: number;
  lon: number;
  distance: number;        // meters from subject
}

/** Bus/tram/platform stops — used for small accessibility bonus only, not demand magnets */
export interface AccessibilityStopItem {
  name: string;
  distance: number;
}

// ── Target audience layer ─────────────────────────────────────────────────────

/** Primary guest audience driving the location's rental demand */
export type TargetAudience = 'BUSINESS' | 'TOURIST' | 'FAMILY';

/** Dominant character of the location based on surrounding magnet mix */
export type LocationType = 'URBAN_BUSINESS' | 'TOURIST_CLUSTER' | 'MIXED';

/** A nearby magnet classified as business- or tourist-oriented */
export interface PrimaryMagnet {
  type: 'business' | 'tourist';
  name: string;
  categoryId: string;
  /** Mirrors MagnetItem.subType — 'factory' | 'industrial' | 'office' | 'commercial' | 'bank' */
  subType?: string;
  weight: number;
  distance: number;
  /** Pre-computed relevance: exponential-decay score × sub-type weight */
  relevanceScore: number;
}

/** Audience fit analysis attached to every LocationAnalysis */
export interface AudienceAnalysis {
  primaryAudience: TargetAudience;
  locationType: LocationType;
  /** 0–100: how well the location serves its primary audience */
  audienceFitScore: number;
  primaryMagnets: PrimaryMagnet[];
  /** true when TOURIST mode was activated automatically due to missing business magnets */
  fallbackMode: boolean;
  /**
   * Share of business demand in the overall audience signal (0–100).
   * E.g. 72 means 72 % of distance-weighted magnet pull comes from business objects.
   */
  audienceSharePct: number;
  /** true when ≥ 2 business magnets are detected within 1 km (cluster effect) */
  businessClusterDetected: boolean;
  /**
   * Russian-language primary driver label shown in the UI.
   * E.g. "Основной драйвер: деловой поток — Полиграфмаш (300 м, завод)"
   */
  primaryDriverLabel: string;
  /**
   * true when mode was hard-locked by the 65 % share threshold,
   * rather than falling back to the default BUSINESS→TOURIST chain.
   */
  lockedMode: boolean;
  /**
   * Demand-flow consistency label (Russian).
   * "устойчивый поток" — strong, close, clustered business magnets.
   * "поток ограничен" — otherwise.
   * "туристический поток" — when primaryAudience is TOURIST.
   */
  demandFlowLabel: string;
}

// ── ASI interpretation layer ──────────────────────────────────────────────────

export type FootTrafficModifierTier = 'weak' | 'moderate' | 'strong';

/** Foot-traffic modifier — human-readable labels (English from engine; /ru UI translates if needed). */
export interface FootTrafficSummary {
  modifierTier: FootTrafficModifierTier;
  /** Rounded index points added on top of magnet line (capped). */
  boostPoints: number;
  movementDensity: string;
  zoneActivity: string;
  flowStability: string;
  flowCharacter: string;
  transitVsTarget: {
    transitShare: number;
    localActiveShare: number;
    destinationShare: number;
  };
  /** Internal 0–1 for heatmap shaping (not for literal UI display). */
  stability01: number;
  concentration01: number;
}

export interface GravityExplanation {
  dominantMagnets: string[];
  strongestZoneLabel: string;
  competitorPressureLevel: 'low' | 'medium' | 'high';
  demandDistribution: 'concentrated' | 'split' | 'weak';
  demandType: DemandType;
  clusterDetected: boolean;
  clusterSize: number;
  scoreBreakdown: {
    attraction: number;
    competitorPressure: number;
    clusterBonus: number;
    trafficBoost: number;
  };
}

/** Normalized intensity point for heatmap rendering */
export interface HeatmapPoint {
  lat: number;
  lon: number;
  /** 0–1 normalized influence intensity */
  intensity: number;
  type: 'magnet' | 'competitor';
  categoryId: string;
}

export type ScoreBand = 'strong' | 'medium' | 'weak' | 'none';

/** Demand-type classification: which category of visitor/tenant driver dominates */
export type DemandType = 'tourism-led' | 'business-led' | 'transport-led' | 'mixed';

// ── Explainable location score (v1) ────────────────────────────────────────────

export type LocationScoreRating = 'exceptional' | 'strong' | 'viable' | 'weak' | 'risky';
export type RecommendedStrategy = 'short_term' | 'hybrid' | 'mid_term';

// ── Residential analysis layer ────────────────────────────────────────────────

/**
 * Residential audience classification — livability-first, not demand-first.
 * premium_comfort: quiet, low-friction, comfort-sensitive guests.
 * mixed_use_adjacent: near commercial activity, moderate friction acceptable.
 * standard_residential: typical urban STR profile.
 */
export type ResidentialAudienceType =
  | 'premium_comfort'
  | 'mixed_use_adjacent'
  | 'standard_residential';

/**
 * Residential-specific strategy — finer than the commercial RecommendedStrategy.
 * selective_premium_short_term: premium/quiet STR targeting.
 * cautious_manual_only: noisy/risky location, manual pricing only.
 */
export type ResidentialStrategy =
  | 'short_term'
  | 'selective_premium_short_term'
  | 'hybrid'
  | 'mid_term'
  | 'cautious_manual_only';

/** How much operator automation is safe for this location. */
export type OperationalSuitability = 'full_auto' | 'semi_auto' | 'manual';

/** Honest signal-quality confidence for the residential interpretation layer. */
export type ResidentialAnalysisConfidence = 'high' | 'medium' | 'low';

export interface ResidentialAnalysisOutput {
  /** Residential audience classification (not a commercial demand type). */
  residentialAudienceType: ResidentialAudienceType;
  /** Residential-aware strategy recommendation. */
  residentialStrategy: ResidentialStrategy;
  /** How safely this location can be operated in automated mode. */
  operationalSuitability: OperationalSuitability;
  /** Honest confidence in the above outputs given available signal strength. */
  confidence: ResidentialAnalysisConfidence;
  /**
   * Short reasons behind the confidence rating — surfaces weak signals,
   * fallback mode, data sparsity, or conflicting indicators.
   */
  confidenceReasons: string[];
  /**
   * Non-empty only when residentialAudienceType === 'premium_comfort'.
   * Lists concrete livability-positive signals detected.
   */
  premiumComfortSignals: string[];
  /** One-line RU operational guidance for this location. */
  operationalNoteRu: string;
  /** RU rationale for the strategy (2–4 short sentences: strengths, blockers, confidence). */
  strategyRationaleRu: string;
}

export interface LocationScoreBreakdown {
  demand_score: number;        // 0–100
  supply_score: number;        // 0–100
  magnet_score: number;        // 0–100
  seasonality_score: number;   // 0–100
  audience_fit_score: number;  // 0–100 NEW: audience-specific proximity fit
  accessibility_score: number; // 0–100 NEW: metro + transit access
}

export interface LocationScoreOutput {
  /** 0–100 overall location score */
  location_score: number;
  rating: LocationScoreRating;
  breakdown: LocationScoreBreakdown;
  estimated_monthly_income: {
    short_term: number;
    mid_term: number;
    hybrid: number;
  };
  /** Raw inputs behind the income estimate — exposed for UI explainability only */
  income_model: {
    /** Base ADR in RUB before strategy multiplier, rounded to nearest 100 */
    base_adr_rub: number;
    /** Base occupancy 0–100 before strategy multiplier */
    base_occupancy_pct: number;
  };
  top_positive_factors: string[];
  top_negative_factors: string[];
  recommended_strategy: RecommendedStrategy;
}

export interface Band {
  label: string;
  scoreBand: ScoreBand;
  textColor: string;
  stroke: string;
  border: string;
  bg: string;
  bar: string;
}

// ── Cache / freshness layer ───────────────────────────────────────────────────

/** How current a cached analysis result is */
export type AnalysisFreshness = 'fresh' | 'stale';

/** Metadata attached to every analysis API response */
export interface AnalysisMeta {
  freshness: AnalysisFreshness;
  /** ISO timestamp of the last successful live fetch */
  updatedAt: string;
  /** Provider that produced the result, e.g. 'osm-overpass' */
  source: string;
  /** true when the response body came from cache, not a live fetch */
  cached: boolean;
  /** Stale cache returned while a background live refresh is in flight */
  refreshing?: boolean;
  /** Live fetch used a reduced Overpass query after primary queries failed */
  usedFallbackQuery?: boolean;
  /**
   * Confidence in this analysis given available signals.
   * This is not a "model accuracy" claim — it is a surface for demos and validation harnesses.
   */
  confidence?: 'high' | 'medium' | 'low';
  /**
   * Human-readable warnings about weak or missing inputs.
   * Clients should display these verbatim (demo) or log them (validation).
   */
  warnings?: Array<{
    code:
      | 'osm_sparse'
      | 'osm_provider_unavailable'
      | 'osm_fallback_query'
      | 'geocode_fallback'
      | 'competitor_data_unavailable';
    message: string;
  }>;
}

/** Concern tier for the neighborhood environment / livability-friction layer (not commercial strength). */
export type NeighborhoodEnvironmentConcernLevel = 'low' | 'moderate' | 'elevated' | 'high';

/**
 * MVP environmental friction layer — neutral infrastructure proxies only.
 * Not merged into commercial scoring; safe to use later as an optional modifier.
 */
export interface NeighborhoodEnvironmentLayer {
  /** 0–100 — higher = more environmental friction / livability stress. */
  environmentalFrictionScore: number;
  concernLevel: NeighborhoodEnvironmentConcernLevel;
  /** Human-readable tier label (EN). */
  concernLabelEn: string;
  /** Human-readable tier label (RU). */
  concernLabelRu: string;
  /** Short explainability bullets (EN). */
  reasonsEn: string[];
  /** Short explainability bullets (RU). */
  reasonsRu: string[];
  /**
   * One neutral synthesis line for UI — not merged into commercial scoring;
   * distinguishes strong-but-busy vs calmer vs patchy micro-location signals.
   */
  environmentNarrativeEn: string;
  environmentNarrativeRu: string;
  /** Map/OSM coverage confidence for this sub-model. */
  confidence: 'high' | 'medium' | 'low';
  /** Normalised 0–1 sub-components for debugging / future UI. */
  breakdown: {
    majorRoads01: number;
    industrial01: number;
    aviation01: number;
    nightlife01: number;
    transitCorridor01: number;
    harshUrbanStack01: number;
  };
}

/** Soft post-layer on headline `location_score` only; `evergreenIndex` unchanged. */
export interface NeighborhoodEnvironmentCommercialModifierSnapshot {
  /** False when master switch off (`ASI_NEIGHBORHOOD_ENV_SCORE_MODIFIER=0`). */
  layerEnabled: boolean;
  /** True when the headline score was reduced. */
  applied: boolean;
  baseLocationScore: number;
  adjustedLocationScore: number;
  pointsRemoved: number;
  /** Intended nominal reduction before point cap (e.g. 0.045 ≈ 4.5%). */
  nominalReductionFraction: number;
  concernLevel: NeighborhoodEnvironmentConcernLevel;
  neighborhoodConfidence: NeighborhoodEnvironmentLayer['confidence'];
  osmElementCount: number;
  /** Sparse fetch — numeric modifier skipped. */
  osmCoverageOkForPenalty: boolean;
  skipReason:
    | null
    | 'layer_disabled'
    | 'concern_below_elevated'
    | 'neighborhood_confidence_low'
    | 'osm_too_sparse'
    | 'no_numeric_change';
  /** High environment concern but neighborhood sub-model confidence is low — no penalty. */
  warningOnlyHighConcernLowConfidence: boolean;
  /**
   * True when base headline was ≥70 and reduction was capped so the adjusted score
   * does not drop below 70 in a single pass (preserves the "strong" rating band).
   */
  strongBandFloorApplied: boolean;
  explainEn: string;
  explainRu: string;
}

/** Spatial engine tier — v1 ships `stub` only; `graph` / `provider` reserved for Phase 2. */
export type SpatialTier = 'stub' | 'graph' | 'provider';

export type BarrierKind = 'water' | 'rail' | 'major_road';

/**
 * Commercial spatial foundation snapshot (stub geometry).
 * Attached to every `LocationAnalysis`; scoring uses it only when `enabled` is true.
 */
export interface SpatialFoundationSnapshot {
  spatialTier: SpatialTier;
  /** True when barrier/corridor heuristics were applied to magnet attraction scores. */
  enabled: boolean;
  /** Any magnet received a barrier multiplier below 1. */
  barrierPenaltyApplied: boolean;
  /** Magnets that received a barrier dampening (count, not deduped by object). */
  penalizedMagnetCount: number;
  /** Shortest distance from subject to a walkable-corridor OSM sample (m), if any. */
  corridorSnapM: number | null;
  /** Barrier classes detected in the fetch window (for UI / explainability). */
  barrierKindsDetected: BarrierKind[];
  /** Extra meters blended into decay distance before barrier multiplier (corridor offset). */
  distanceInflationM: number;
  /** RU copy for UI / report — clarifies stub vs future graph confidence. */
  geometricConfidenceNoteRu: string;
}

/** Full structured output of the gravity engine */
export interface LocationAnalysis {
  // Score
  evergreenIndex: number;
  scoreBand: ScoreBand;
  /** Explainable composite score (0–100), stable output contract for production-shaping */
  locationScore?: LocationScoreOutput;

  /**
   * End-to-end scoring audit trail — numeric headline finalized before public/evidence projection layers.
   * Older persisted payloads may omit this field; callers must not recompute headline score outside the gravity pipeline.
   */
  scoringTrace?: LocationScoringTrace;

  // Detected objects (real-world data)
  magnets: MagnetItem[];
  magnetCountByCategory: Record<string, number>;
  /** Public-transport stops near the property — informational + tiny accessibility bonus */
  accessibilityStops: AccessibilityStopItem[];
  competitors: CompetitorItem[];

  // ASI interpretation
  gravityExplanation: GravityExplanation;
  demandType: DemandType;
  strongestMagnets: MagnetItem[];
  clusterZones: MagnetItem[][];
  splitDemand: boolean;
  competitorPressure: number;

  /** Foot-traffic layer — confirms strong locations together with magnets. */
  footTraffic: FootTrafficSummary;

  /** Audience fit layer — classifies location by primary audience type */
  audienceAnalysis: AudienceAnalysis;

  /**
   * Livability / environmental friction — OSM-only, independent of commercial `evergreenIndex`.
   * Higher `environmentalFrictionScore` = more physical-environment stress (noise, traffic, industry, aviation).
   */
  neighborhoodEnvironment: NeighborhoodEnvironmentLayer;

  /**
   * Soft livability-friction adjustment applied after base `buildLocationScoreOutput`.
   * Present on fresh analyses; legacy cached payloads may omit it.
   */
  commercialNeighborhoodModifier?: NeighborhoodEnvironmentCommercialModifierSnapshot;

  /**
   * Spatial foundation v1 — barrier-aware magnet scoring + corridor inflation when enabled.
   * Legacy cache rows may omit this; clients should treat as disabled stub via patch helper.
   */
  spatialFoundation?: SpatialFoundationSnapshot;

  /**
   * Residential analysis layer — strategy, audience type, operational suitability,
   * and confidence for short-term rental use cases. Always present on fresh analyses.
   */
  residentialAnalysis?: ResidentialAnalysisOutput;

  // Computed visualization data
  heatmapPoints: HeatmapPoint[];

  /**
   * Major transport hubs beyond the ordinary magnet radius (airport/rail/port/bus/interchange),
   * scored and labeled separately from pedestrian-local magnets.
   * Older cached analyses omit this — treat as `[]`.
   */
  strategicTransportHubMagnets?: MagnetItem[];

  /**
   * Magnet pipeline diagnostics — internal/tests only; omit from user-facing API surfaces.
   */
  magnetDiagnostics?: MagnetDiagnosticsLayer;

  // Human-readable output
  conclusion: string;
}
