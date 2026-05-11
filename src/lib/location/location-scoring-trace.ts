import type { StrengthClass } from './types';

/** Diagnostics for evergreen raw line compression (does not include final 5–100 clamp). */
export interface EvergreenIndexDiagnostics {
  rawGravityScoreBeforeSoftCap: number;
  rawGravityScoreAfterSoftCap: number;
  softCapApplied: boolean;
}

/** Single magnet snapshot after classification + gravity preprocessing */
export interface LocationScoringClassifiedMagnet {
  categoryId: string;
  name: string;
  distanceM: number;
  attractionScore: number;
  strengthClass: StrengthClass;
}

/** Numeric inputs feeding composite location_score (floats where applicable) */
export interface LocationScoreFeatures {
  evergreenIndex: number;
  /** Scaled attraction line feeding magnet_score */
  attractionScaled: number;
  competitorPressure: number;
  magnet_score: number;
  demand_score: number;
  supply_score: number;
  accessibility_score: number;
  audience_fit_score: number;
  seasonality_score: number;
}

export type LocationScoringCapKind =
  | 'evergreen_soft_cap'
  | 'neighborhood_environment_headline';

export type LocationScoringCapPhase = 'evergreen_raw' | 'composite_headline';

export interface LocationScoringCapApplied {
  kind: LocationScoringCapKind;
  /** Where this cap sits relative to the headline composite */
  phase: LocationScoringCapPhase;
  /** Human-readable justification — mandatory for every cap */
  reason: string;
  scoreBefore?: number;
  scoreAfter?: number;
}

export interface LocationScoringEvidenceRef {
  id: string;
  group: string;
  evidenceType: string;
  title: string;
  detail?: string;
  distanceM?: number;
}

/**
 * Unified scoring contract — `finalScore` must be frozen before `publicBullets` / rich evidence text.
 */
export interface LocationScoringTrace {
  inputAddress?: string;
  coordinates: { lat: number; lon: number };
  selectedGeocodeResult?: string | null;
  rawObjectsCount: number;
  classifiedMagnets: LocationScoringClassifiedMagnet[];
  scoreFeatures: LocationScoreFeatures;
  /** Composite headline score before neighborhood-environment headline adjustment */
  baseScore: number;
  capsApplied: LocationScoringCapApplied[];
  /** Score wired to `LocationAnalysis.locationScore.location_score` */
  finalScore: number;
  evidence: LocationScoringEvidenceRef[];
  publicBullets: string[];
  removedPublicBullets: string[];
  warnings: string[];
}
