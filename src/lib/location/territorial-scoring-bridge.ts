import type { LocationAnalysis } from './types';
import {
  buildH3TerritoryIntelligenceForAnalysis,
  type H3TerritoryIntelligence,
} from './h3';

export const TERRITORIAL_SCORING_BRIDGE_VERSION = 'territorial-scoring-bridge-v1' as const;

export type TerritorialSignalLevel = 'none' | 'weak' | 'moderate' | 'strong';
export type TerritorialPenaltyLevel = 'none' | 'low' | 'moderate' | 'high';
export type TerritorialSignalQuality = 'none' | 'low' | 'medium' | 'high';
export type TerritorialSignalCategory =
  | 'transport'
  | 'medical'
  | 'education'
  | 'business'
  | 'tourism';

export interface TerritorialNormalizedSignal {
  /** Normalized 0-1 signal strength. This is not a final score contribution. */
  value: number;
  level: TerritorialSignalLevel;
}

export interface TerritorialNormalizedPenalty {
  /** Normalized 0-1 penalty intensity. Downstream scoring weight is intentionally undefined. */
  value: number;
  level: TerritorialPenaltyLevel;
}

export interface TerritorialScoringBridgeSource {
  countedSignals: number;
  coverageUnits: number;
  coverageRadiusMeters: number | null;
  diversityScore: number;
  businessSuitabilityScore: number;
  transportBalanceScore: number;
  monoFunctional: {
    detected: boolean;
    dominantShare: number;
    dominantCategory: TerritorialSignalCategory | null;
  };
  deadZone: {
    gapRatio: number;
    emptyUnitRatio: number;
    lowDensityUnitRatio: number;
  };
  flags?: {
    hasBusinessCore?: boolean;
    hasTransportAccess?: boolean;
    transportOverDominated?: boolean;
    lowSignal?: boolean;
  };
}

export interface TerritorialScoringBridgeSignals {
  version: typeof TERRITORIAL_SCORING_BRIDGE_VERSION;
  signalQuality: TerritorialSignalQuality;
  countedSignals: number;
  coverageUnits: number;
  coverageRadiusMeters: number | null;
  diversity: TerritorialNormalizedSignal;
  businessSuitability: TerritorialNormalizedSignal;
  transportBalance: TerritorialNormalizedSignal;
  monoFunctionalPenalty: TerritorialNormalizedPenalty & {
    detected: boolean;
    dominantShare: number;
    dominantCategory: TerritorialSignalCategory | null;
  };
  deadZonePenalty: TerritorialNormalizedPenalty & {
    gapRatio: number;
    emptyUnitRatio: number;
    lowDensityUnitRatio: number;
  };
  flags: {
    hasBusinessCore: boolean;
    hasTransportAccess: boolean;
    transportOverDominated: boolean;
    lowSignal: boolean;
  };
}

export interface TerritorialScoringBridgeAnalysisOptions {
  coverageRadiusMeters?: number;
  maxDistanceMeters?: number;
}

function normalized01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function signalLevel(value: number): TerritorialSignalLevel {
  if (value <= 0) return 'none';
  if (value >= 0.67) return 'strong';
  if (value >= 0.4) return 'moderate';
  return 'weak';
}

function penaltyLevel(value: number): TerritorialPenaltyLevel {
  if (value <= 0) return 'none';
  if (value >= 0.67) return 'high';
  if (value >= 0.4) return 'moderate';
  return 'low';
}

function signal(value: number): TerritorialNormalizedSignal {
  const normalized = normalized01(value);
  return {
    value: normalized,
    level: signalLevel(normalized),
  };
}

function penalty(value: number): TerritorialNormalizedPenalty {
  const normalized = normalized01(value);
  return {
    value: normalized,
    level: penaltyLevel(normalized),
  };
}

function signalQuality(args: { countedSignals: number; coverageUnits: number }): TerritorialSignalQuality {
  if (args.countedSignals <= 0) return 'none';
  if (args.countedSignals >= 6 && args.coverageUnits >= 4) return 'high';
  if (args.countedSignals >= 3) return 'medium';
  return 'low';
}

function calibratedDeadZonePenaltyValue(source: TerritorialScoringBridgeSource): number {
  const raw = normalized01(source.deadZone.gapRatio);
  const diversity = normalized01(source.diversityScore);
  const businessSuitability = normalized01(source.businessSuitabilityScore);
  const transportBalance = normalized01(source.transportBalanceScore);
  const countedSignals = Math.max(0, Math.floor(source.countedSignals));
  const coverageUnits = Math.max(0, Math.floor(source.coverageUnits));
  const densityPerUnit = coverageUnits > 0 ? countedSignals / coverageUnits : 0;
  const hasTransportAccess = source.flags?.hasTransportAccess === true;
  const lowSignal = source.flags?.lowSignal === true || countedSignals <= 2;
  let value = raw;

  if (countedSignals <= 0) {
    return 0;
  }

  if (countedSignals >= 6 && diversity >= 0.45) {
    value *= 0.55;
  }

  if (densityPerUnit >= 0.18 && diversity >= 0.4) {
    value *= 0.7;
  }

  if (diversity >= 0.67) {
    value = Math.min(value, 0.22);
  }

  if (businessSuitability >= 0.67 && !source.monoFunctional.detected) {
    value = Math.min(value, 0.24);
  }

  if (hasTransportAccess && transportBalance >= 0.4 && diversity >= 0.55) {
    value = Math.min(value, 0.18);
  }

  if (lowSignal && diversity < 0.25 && businessSuitability < 0.35) {
    value = Math.max(value, Math.min(1, raw + 0.15));
  }

  return normalized01(value);
}

function sourceFromTerritoryIntelligence(
  territory: H3TerritoryIntelligence,
): TerritorialScoringBridgeSource {
  return {
    countedSignals: territory.countedMagnets,
    coverageUnits: territory.deadZones.coverageCellCount,
    coverageRadiusMeters: territory.coverageRadiusMeters,
    diversityScore: territory.categoryDiversityScore,
    businessSuitabilityScore: territory.businessTravelerSuitability.score,
    transportBalanceScore: territory.businessTravelerSuitability.businessTransportBalanceScore,
    monoFunctional: {
      detected: territory.monoFunctional.detected,
      dominantShare: territory.monoFunctional.dominantShare,
      dominantCategory: territory.monoFunctional.category,
    },
    deadZone: {
      gapRatio: territory.deadZones.gapRatio,
      emptyUnitRatio: territory.deadZones.emptyCellRatio,
      lowDensityUnitRatio: territory.deadZones.lowDensityCellRatio,
    },
    flags: {
      hasBusinessCore: territory.businessTravelerSuitability.hasBusinessCore,
      hasTransportAccess: territory.businessTravelerSuitability.hasTransportAccess,
      transportOverDominated: territory.businessTravelerSuitability.transportOverDominated,
      lowSignal: territory.functionality === 'low_signal',
    },
  };
}

/**
 * Bridge layer for future scoring integration.
 *
 * It deliberately emits normalized signals and penalty intensities only. It does
 * not define final-score weights, score caps, or direct score mutations.
 */
export function buildTerritorialScoringBridgeSignals(
  source: TerritorialScoringBridgeSource,
): TerritorialScoringBridgeSignals {
  const countedSignals = Math.max(0, Math.floor(source.countedSignals));
  const coverageUnits = Math.max(0, Math.floor(source.coverageUnits));
  const monoFunctionalPenaltyValue = source.monoFunctional.detected
    ? source.monoFunctional.dominantShare
    : 0;
  const monoFunctionalPenalty = penalty(monoFunctionalPenaltyValue);
  const deadZonePenalty = penalty(calibratedDeadZonePenaltyValue(source));

  return {
    version: TERRITORIAL_SCORING_BRIDGE_VERSION,
    signalQuality: signalQuality({ countedSignals, coverageUnits }),
    countedSignals,
    coverageUnits,
    coverageRadiusMeters: Number.isFinite(source.coverageRadiusMeters)
      ? Math.max(0, Math.round(source.coverageRadiusMeters as number))
      : null,
    diversity: signal(source.diversityScore),
    businessSuitability: signal(source.businessSuitabilityScore),
    transportBalance: signal(source.transportBalanceScore),
    monoFunctionalPenalty: {
      ...monoFunctionalPenalty,
      detected: source.monoFunctional.detected,
      dominantShare: normalized01(source.monoFunctional.dominantShare),
      dominantCategory: source.monoFunctional.dominantCategory,
    },
    deadZonePenalty: {
      ...deadZonePenalty,
      gapRatio: normalized01(source.deadZone.gapRatio),
      emptyUnitRatio: normalized01(source.deadZone.emptyUnitRatio),
      lowDensityUnitRatio: normalized01(source.deadZone.lowDensityUnitRatio),
    },
    flags: {
      hasBusinessCore: source.flags?.hasBusinessCore === true,
      hasTransportAccess: source.flags?.hasTransportAccess === true,
      transportOverDominated: source.flags?.transportOverDominated === true,
      lowSignal: source.flags?.lowSignal === true,
    },
  };
}

export function buildTerritorialScoringSignalsForAnalysis(args: {
  analysis: Pick<LocationAnalysis, 'magnets'>;
  lat: number;
  lon: number;
  options?: TerritorialScoringBridgeAnalysisOptions;
}): TerritorialScoringBridgeSignals {
  const territory = buildH3TerritoryIntelligenceForAnalysis({
    analysis: args.analysis,
    lat: args.lat,
    lon: args.lon,
    options: {
      coverageRadiusMeters: args.options?.coverageRadiusMeters,
      maxDistanceMeters: args.options?.maxDistanceMeters,
    },
  });

  return buildTerritorialScoringBridgeSignals(sourceFromTerritoryIntelligence(territory));
}
