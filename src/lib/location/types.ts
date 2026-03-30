// ── Gravity / Evergreen engine — shared types ─────────────────────────────────
// Map/OSM data types live here alongside ASI interpretation types.
// Keep them clearly separated in comments: real-world vs ASI layer.

// ── Real-world / map layer ────────────────────────────────────────────────────

export type PermanenceType = 'permanent' | 'semi' | 'temporary';

export interface MagnetCategory {
  id: string;
  label: string;           // Russian UI label
  icon: string;            // short badge text
  weight: number;          // 1–10
  permanenceType: PermanenceType;
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
  attractionScore: number; // ASI computed gravity score
}

/** A nearby short-term rental competitor detected in OSM */
export interface CompetitorItem {
  name: string;
  lat: number;
  lon: number;
  distance: number;        // meters from subject
}

// ── ASI interpretation layer ──────────────────────────────────────────────────

export interface GravityExplanation {
  dominantMagnets: string[];
  strongestZoneLabel: string;
  competitorPressureLevel: 'низкое' | 'среднее' | 'высокое';
  demandDistribution: 'concentrated' | 'split' | 'weak';
  clusterDetected: boolean;
  clusterSize: number;
  scoreBreakdown: { attraction: number; competitorPressure: number; clusterBonus: number };
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

export interface Band {
  label: string;
  scoreBand: ScoreBand;
  textColor: string;
  stroke: string;
  border: string;
  bg: string;
  bar: string;
}

/** Full structured output of the gravity engine */
export interface LocationAnalysis {
  // Score
  evergreenIndex: number;
  scoreBand: ScoreBand;

  // Detected objects (real-world data)
  magnets: MagnetItem[];
  magnetCountByCategory: Record<string, number>;
  competitors: CompetitorItem[];

  // ASI interpretation
  gravityExplanation: GravityExplanation;
  strongestMagnets: MagnetItem[];
  clusterZones: MagnetItem[][];
  splitDemand: boolean;
  competitorPressure: number;

  // Computed visualization data
  heatmapPoints: HeatmapPoint[];

  // Human-readable output
  conclusion: string;
}
