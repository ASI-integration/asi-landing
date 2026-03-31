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
  label: string;           // Russian UI label
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

// ── ASI interpretation layer ──────────────────────────────────────────────────

export type FootTrafficModifierTier = 'weak' | 'moderate' | 'strong';

/** Foot-traffic modifier — human face in Russian only (see demo copy). */
export interface FootTrafficSummary {
  modifierTier: FootTrafficModifierTier;
  /** Rounded index points added on top of magnet line (capped). */
  boostPoints: number;
  movementDensityRu: string;
  zoneActivityRu: string;
  flowStabilityRu: string;
  flowCharacterRu: string;
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
  competitorPressureLevel: 'низкое' | 'среднее' | 'высокое';
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

  /** Поток людей: подтверждает сильную локацию только вместе с магнитами. */
  footTraffic: FootTrafficSummary;

  // Computed visualization data
  heatmapPoints: HeatmapPoint[];

  // Human-readable output
  conclusion: string;
}
