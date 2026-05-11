/**
 * Deterministic demand scoring kernel v1 — contracts only.
 * LLM must not alter tiers/types produced here; copy layers explain fixed outputs.
 */

export type LocationDemandDriverKind =
  | 'real_demand_driver'
  | 'supporting_infrastructure'
  | 'local_interest'
  | 'noise'
  | 'unknown_uncapped';

/** Resolved anchor tier for STR demand (orthogonal to legacy MagnetTier labels). */
export type LocationDemandResolvedTier = 1 | 2 | 3;

export type LocationDemandKernelDemandType =
  | 'corporate/business'
  | 'medical'
  | 'transport'
  | 'industrial'
  | 'tourist'
  | 'education'
  | 'mixed'
  | 'weak/unclear';

export interface LocationDemandKernelScoreBreakdown {
  rawSumBeforeCaps: number;
  cappedSupportingInfra: number;
  cappedLocalInterest: number;
  cappedHotels: number;
  cappedGenericBusiness: number;
  cappedTourismWithoutAnchor: number;
  cappedNoTier1Penalty: number;
  /** Points trimmed from blended public score for sparse small-city guard */
  cappedSmallCitySparse: number;
  finalWeightedSum: number;
}

export type LocationDemandScaleClass = 'verified_major' | 'medium' | 'weak_local' | 'unknown';

export interface LocationDemandScoredDriver {
  magnetFactId: string;
  evidenceId: string;
  sourceName: string;
  category: string;
  driverKind: LocationDemandDriverKind;
  resolvedTier: LocationDemandResolvedTier;
  scaleClass: LocationDemandScaleClass;
  demandTypeVote: LocationDemandKernelDemandType | null;
  distanceMeters: number;
  baseWeight: number;
  distanceCoefficient: number;
  scaleCoefficient: number;
  confidenceCoefficient: number;
  finalContribution: number;
  accepted: boolean;
  reason: string;
  /** Populated by kernel v1 — OSM tag alignment / public-display gates (trace / locationClaimTrace). */
  tagAlignmentStatus?: string;
  publicDisplayEligible?: boolean;
  publicDisplayRejectReason?: string;
}

export interface SmallCitySparsePublicScoreGuard {
  readonly applied: boolean;
  readonly reason: string;
  readonly scoreBefore: number;
  readonly scoreAfter: number;
}

export interface LocationDemandScoringKernelResult {
  acceptedDrivers: LocationDemandScoredDriver[];
  rejectedDrivers: LocationDemandScoredDriver[];
  scoredDrivers: LocationDemandScoredDriver[];
  dominantDemandType: LocationDemandKernelDemandType;
  scoreBreakdown: LocationDemandKernelScoreBreakdown;
  /** 0–100 demand-anchor evidence headline derived deterministically from contributions */
  kernelEvidenceScore: number;
  /** Score blended with engine headline for published headline when integrity allows */
  blendedPublicScore: number;
  /** When set, explains sparse small-city headline score cap (non-UI diagnostics). */
  smallCitySparseScoreGuard?: SmallCitySparsePublicScoreGuard;
  warnings: string[];
  debugTrace: string[];
}

export interface LocationDemandKernelInput {
  magnets: readonly import('./types').MagnetItem[];
  magnetFacts: readonly import('./location-decision-contract').MagnetFact[];
  canonicalFacts?: readonly import('./location-decision-contract').CanonicalLocationFact[];
  engineFinalScore: number;
  analysisIncomplete?: boolean;
  scoreBlockedDueToIncompleteData?: boolean;
  /** Inferred from RU address for small-town demand safeguards */
  cityScaleTier?: import('./city-scale-from-address').InferredCityScaleTier;
}
