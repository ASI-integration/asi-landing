import type { TerritorialScoringBridgeSignals } from './territorial-scoring-bridge';

export type TerritorialScoringModifierReason =
  | 'balanced_business_district'
  | 'territorial_diversity'
  | 'balanced_transport_access'
  | 'mono_functional_zone'
  | 'dead_zone'
  | 'transport_over_dominated_low_diversity';

export interface TerritorialScoringModifierContribution {
  reason: TerritorialScoringModifierReason;
  points: number;
  explainEn: string;
  explainRu: string;
}

export interface TerritorialScoringModifierSnapshot {
  applied: boolean;
  baseLocationScore: number;
  adjustedLocationScore: number;
  netPoints: number;
  positivePoints: number;
  negativePoints: number;
  maxPositivePoints: number;
  maxNegativePoints: number;
  signalQuality: TerritorialScoringBridgeSignals['signalQuality'];
  bridgeVersion: TerritorialScoringBridgeSignals['version'];
  contributions: TerritorialScoringModifierContribution[];
  skipReason: null | 'no_numeric_change';
  explainEn: string;
  explainRu: string;
}

const MAX_POSITIVE_POINTS = 4;
const MAX_NEGATIVE_POINTS = 6;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function roundedScore(n: number): number {
  return clamp(Math.round(n), 0, 100);
}

function canRewardSignalQuality(signalQuality: TerritorialScoringBridgeSignals['signalQuality']): boolean {
  return signalQuality === 'medium' || signalQuality === 'high';
}

function capContributionTotal(points: number, cap: number): number {
  return Math.min(cap, Math.max(0, points));
}

/**
 * Applies only normalized territorial bridge signals as a secondary headline modifier.
 *
 * The primary commercial score stays untouched up to this post-layer; this function
 * never reads magnets, H3 cells, raw OSM objects, or taxonomy internals.
 */
export function computeTerritorialScoringModifier(input: {
  baseLocationScore: number;
  territorialScoringSignals: TerritorialScoringBridgeSignals;
}): TerritorialScoringModifierSnapshot {
  const base = roundedScore(input.baseLocationScore);
  const s = input.territorialScoringSignals;
  const contributions: TerritorialScoringModifierContribution[] = [];
  const rewardEligible = canRewardSignalQuality(s.signalQuality);

  if (
    rewardEligible &&
    s.flags.hasBusinessCore &&
    s.businessSuitability.value >= 0.67 &&
    s.diversity.value >= 0.4 &&
    s.monoFunctionalPenalty.value < 0.55 &&
    s.deadZonePenalty.value < 0.45
  ) {
    contributions.push({
      reason: 'balanced_business_district',
      points: 2,
      explainEn: 'Territorial bridge confirms a business core with enough surrounding functional mix.',
      explainRu: 'Территориальный слой подтверждает деловое ядро и достаточную смесь функций вокруг.',
    });
  }

  if (
    rewardEligible &&
    s.diversity.value >= 0.67 &&
    s.monoFunctionalPenalty.value < 0.4 &&
    s.deadZonePenalty.value < 0.4
  ) {
    contributions.push({
      reason: 'territorial_diversity',
      points: 1,
      explainEn: 'High territorial diversity slightly supports score stability.',
      explainRu: 'Высокая функциональная разнообразность территории слегка поддерживает устойчивость балла.',
    });
  }

  if (
    rewardEligible &&
    s.flags.hasTransportAccess &&
    s.transportBalance.value >= 0.4 &&
    !s.flags.transportOverDominated
  ) {
    contributions.push({
      reason: 'balanced_transport_access',
      points: 1,
      explainEn: 'Transport access is present without dominating the whole area.',
      explainRu: 'Транспортная доступность есть, но она не доминирует над всем окружением.',
    });
  }

  if (s.monoFunctionalPenalty.detected && s.monoFunctionalPenalty.value >= 0.55) {
    contributions.push({
      reason: 'mono_functional_zone',
      points: -Math.min(4, Math.max(2, Math.round(s.monoFunctionalPenalty.value * 4))),
      explainEn: 'Mono-functional territorial pattern reduces resilience of the demand mix.',
      explainRu: 'Монофункциональная территория снижает устойчивость смеси спроса.',
    });
  }

  if (s.deadZonePenalty.value >= 0.4 || (s.flags.lowSignal && s.deadZonePenalty.value >= 0.25)) {
    contributions.push({
      reason: 'dead_zone',
      points: -Math.min(5, Math.max(2, Math.round(s.deadZonePenalty.value * 5))),
      explainEn: 'Dead-zone signal indicates weak nearby functional coverage.',
      explainRu: 'Сигнал dead-zone показывает слабое функциональное покрытие рядом.',
    });
  }

  if (s.flags.transportOverDominated && s.diversity.value < 0.4) {
    contributions.push({
      reason: 'transport_over_dominated_low_diversity',
      points: -3,
      explainEn: 'Transport dominates while territorial diversity is low.',
      explainRu: 'Транспорт доминирует, а разнообразие функций вокруг низкое.',
    });
  }

  const positivePoints = capContributionTotal(
    contributions.filter(c => c.points > 0).reduce((sum, c) => sum + c.points, 0),
    MAX_POSITIVE_POINTS,
  );
  const negativePoints = capContributionTotal(
    -contributions.filter(c => c.points < 0).reduce((sum, c) => sum + c.points, 0),
    MAX_NEGATIVE_POINTS,
  );
  const netPoints = clamp(positivePoints - negativePoints, -MAX_NEGATIVE_POINTS, MAX_POSITIVE_POINTS);
  const adjusted = roundedScore(base + netPoints);
  const applied = adjusted !== base;

  const explainEn = applied
    ? `Territorial signal adjustment: ${netPoints > 0 ? '+' : ''}${netPoints} pts (bounded to +${MAX_POSITIVE_POINTS}/-${MAX_NEGATIVE_POINTS}).`
    : 'Territorial signals produced no numeric headline adjustment.';
  const explainRu = applied
    ? `Мягкая территориальная корректировка: ${netPoints > 0 ? '+' : ''}${netPoints} к итоговому баллу (лимит +${MAX_POSITIVE_POINTS}/-${MAX_NEGATIVE_POINTS}).`
    : 'Территориальные сигналы не изменили итоговый балл.';

  return {
    applied,
    baseLocationScore: base,
    adjustedLocationScore: adjusted,
    netPoints,
    positivePoints,
    negativePoints,
    maxPositivePoints: MAX_POSITIVE_POINTS,
    maxNegativePoints: MAX_NEGATIVE_POINTS,
    signalQuality: s.signalQuality,
    bridgeVersion: s.version,
    contributions,
    skipReason: applied ? null : 'no_numeric_change',
    explainEn,
    explainRu,
  };
}
