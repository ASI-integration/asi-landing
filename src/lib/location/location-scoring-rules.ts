/**
 * Runtime source of truth for location scoring policy (weights, caps, wording hooks).
 * Docs under docs/*.md are non-authoritative until mirrored here + tests.
 */

import {
  CATEGORY_MAX_SHOW,
  CATEGORY_RADIUS,
  GRAVITY_CONFIG,
  MAGNET_CATEGORIES,
  NEIGHBORHOOD_ENV_SCORE_MODIFIER,
  PERMANENCE_MULTIPLIER,
} from './config';

/** Composite location_score blend — single formula entry point for audits */
export const LOCATION_SCORE_COMPONENT_WEIGHTS = {
  audience_fit: 0.4,
  demand: 0.25,
  supply: 0.2,
  accessibility: 0.15,
} as const;

/** Inside evergreen raw line before mapping to 0–100 */
export const EVERGREEN_SOFT_CAP = {
  thresholdRaw: 80,
  /** Compress everything above threshold by this factor */
  compressionAbove: 0.6,
  /** Hard clamp on published evergreen index */
  minPublished: 5,
  maxPublished: 100,
} as const;

/** Evidence bundle IDs attached post-score (report layer); never affects numeric pipeline */
export const SCORING_EVIDENCE_GROUPS = {
  engine: 'engine',
  magnets: 'magnets',
  accessibility: 'accessibility',
} as const;

export const PUBLIC_COPY_POLICY = {
  /** Marker substring required on deliberately vague lines */
  lowConfidenceMarker: 'общая формулировка',
  /** Regex: bullet ties to on-map evidence when distance or transport context appears */
  evidenceDistancePattern: /\d+\s*(?:м|км)\b|\bметро\b|\bmetro\b/i,
} as const;

export const LOCATION_SCORING_RUNTIME_EXPORT = {
  magnetCategories: MAGNET_CATEGORIES,
  categoryRadiusM: CATEGORY_RADIUS,
  categoryMaxShow: CATEGORY_MAX_SHOW,
  gravity: GRAVITY_CONFIG,
  permanenceMultiplier: PERMANENCE_MULTIPLIER,
  neighborhoodEnvModifierCaps: NEIGHBORHOOD_ENV_SCORE_MODIFIER,
  evergreenSoftCap: EVERGREEN_SOFT_CAP,
  locationScoreWeights: LOCATION_SCORE_COMPONENT_WEIGHTS,
} as const;
