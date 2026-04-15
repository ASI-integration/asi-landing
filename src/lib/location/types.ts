// ── Gravity / Evergreen engine — shared types ─────────────────────────────────
// Map/OSM data types live here alongside ASI interpretation types.
// Keep them clearly separated in comments: real-world vs ASI layer.

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
}

/** Full structured output of the gravity engine */
export interface LocationAnalysis {
  // Score
  evergreenIndex: number;
  scoreBand: ScoreBand;
  /** Explainable composite score (0–100), stable output contract for production-shaping */
  locationScore?: LocationScoreOutput;

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

  // Computed visualization data
  heatmapPoints: HeatmapPoint[];

  // Human-readable output
  conclusion: string;
}
