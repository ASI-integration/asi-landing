import type {
  FutureTrajectoryDirection,
  FutureTrajectoryEvidence,
  FutureTrajectoryScore,
  PurchaseEarlyWarningSignal,
  PurchaseEarlyWarningSignalType,
  PurchaseHorizonYears,
  PurchaseSignalConfidence,
  PurchaseSignalGeoPrecision,
  PurchaseSignalImpact,
  PurchaseSignalStage,
  PurchaseTrajectoryConfidence,
} from './types';

const POSITIVE_SIGNAL_TYPES = new Set<PurchaseEarlyWarningSignalType>([
  'government_procurement_engineering_survey',
  'government_procurement_road_design',
  'government_procurement_school_design',
  'government_procurement_hospital_design',
  'government_procurement_interchange_design',
  'general_plan_or_land_use_rules',
  'territory_planning_project',
  'construction_permit',
  'cadastral_change',
  'new_residential_complex',
  'developer_activity',
  'transport_plan',
  'industrial_zone_reconstruction',
  'public_realm_improvement',
]);

const NEGATIVE_SIGNAL_TYPES = new Set<PurchaseEarlyWarningSignalType>([
  'highway_or_major_road_risk',
  'industrial_zone_risk',
  'noise_risk',
  'overbuilding_risk',
  'weak_social_infrastructure',
  'stalled_construction',
]);

const CONFIDENCE_WEIGHT: Record<PurchaseSignalConfidence, number> = {
  low: 0.35,
  medium: 0.65,
  high: 1,
};

const STAGE_WEIGHT: Record<PurchaseSignalStage, number> = {
  early_hint: 0.28,
  planning: 0.42,
  design: 0.58,
  procurement: 0.72,
  permit: 0.86,
  construction: 1,
  active: 0.82,
};

const GEO_WEIGHT: Record<PurchaseSignalGeoPrecision, number> = {
  exact_address: 1,
  nearby: 0.86,
  district: 0.68,
  city: 0.38,
  unknown: 0.12,
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function signalImpact(signal: PurchaseEarlyWarningSignal): PurchaseSignalImpact {
  if (signal.impact !== 'mixed') return signal.impact;
  if (NEGATIVE_SIGNAL_TYPES.has(signal.type)) return 'negative';
  if (POSITIVE_SIGNAL_TYPES.has(signal.type)) return 'positive';
  return 'mixed';
}

function horizonWeight(signal: PurchaseEarlyWarningSignal, horizon: PurchaseHorizonYears): number {
  if (signal.horizonYears && signal.horizonYears !== horizon) {
    const diff = Math.abs(signal.horizonYears - horizon);
    return diff >= 7 ? 0.45 : diff >= 3 ? 0.68 : 0.82;
  }

  if (horizon === 3) return signal.stage === 'construction' || signal.stage === 'permit' ? 1 : 0.72;
  if (horizon === 5) return 0.9;
  return signal.stage === 'early_hint' || signal.stage === 'planning' ? 1 : 0.82;
}

function rawSignalWeight(signal: PurchaseEarlyWarningSignal, horizon: PurchaseHorizonYears): number {
  const confidence = CONFIDENCE_WEIGHT[signal.confidence];
  const stage = STAGE_WEIGHT[signal.stage ?? 'planning'];
  const geo = GEO_WEIGHT[signal.geoPrecision ?? 'unknown'];
  return 72 * confidence * stage * geo * horizonWeight(signal, horizon);
}

function confidenceFromSignals(signals: PurchaseEarlyWarningSignal[]): PurchaseTrajectoryConfidence {
  const strongSignals = signals.filter(
    s =>
      s.confidence === 'high' &&
      (s.geoPrecision === 'exact_address' || s.geoPrecision === 'nearby' || s.geoPrecision === 'district'),
  );
  if (strongSignals.length >= 2) return 'high';
  if (signals.some(s => s.confidence !== 'low')) return 'medium';
  return 'low';
}

function direction(args: {
  currentScore: number;
  futureUpsideScore: number;
  declineRiskScore: number;
  confidence: PurchaseTrajectoryConfidence;
}): FutureTrajectoryDirection {
  const net = args.futureUpsideScore - args.declineRiskScore;
  if (args.declineRiskScore >= 72 && args.confidence !== 'low') return 'high_risk';
  if (args.declineRiskScore >= 58 && net <= -18) return 'declining';
  if (args.futureUpsideScore >= 58 && net >= 18) return 'strengthening';
  if (args.confidence === 'low' && Math.abs(net) < 28) return 'uncertain';
  if (args.currentScore >= 58 && Math.abs(net) < 18) return 'stable';
  if (net <= -12) return 'declining';
  if (net >= 12) return 'strengthening';
  return 'uncertain';
}

function evidenceLabel(signal: PurchaseEarlyWarningSignal): string {
  if (signal.title?.trim()) return signal.title.trim();
  switch (signal.type) {
    case 'government_procurement_engineering_survey':
      return 'Госзакупка на инженерные изыскания';
    case 'government_procurement_road_design':
      return 'Госзакупка на проектирование дороги';
    case 'government_procurement_school_design':
      return 'Госзакупка на проектирование школы';
    case 'government_procurement_hospital_design':
      return 'Госзакупка на проектирование больницы';
    case 'government_procurement_interchange_design':
      return 'Госзакупка на проектирование развязки';
    case 'general_plan_or_land_use_rules':
      return 'Генплан или ПЗЗ';
    case 'territory_planning_project':
      return 'Проект планировки территории';
    case 'construction_permit':
      return 'Разрешение на строительство';
    case 'cadastral_change':
      return 'Кадастровые изменения';
    case 'new_residential_complex':
      return 'Новый жилой комплекс';
    case 'developer_activity':
      return 'Девелоперская активность';
    case 'transport_plan':
      return 'Транспортные планы';
    case 'industrial_zone_reconstruction':
      return 'Реконструкция промзоны';
    case 'public_realm_improvement':
      return 'Благоустройство';
    case 'highway_or_major_road_risk':
      return 'Риск крупной дороги или трассы';
    case 'industrial_zone_risk':
      return 'Промышленный риск';
    case 'noise_risk':
      return 'Шумовой риск';
    case 'overbuilding_risk':
      return 'Риск переуплотнения';
    case 'weak_social_infrastructure':
      return 'Слабая социальная инфраструктура';
    case 'stalled_construction':
      return 'Долгострой';
  }
}

export function computeFutureTrajectoryScore(args: {
  currentScore: number;
  signals?: PurchaseEarlyWarningSignal[];
  horizon?: PurchaseHorizonYears;
}): FutureTrajectoryScore {
  const horizon = args.horizon ?? 5;
  const signals = args.signals ?? [];

  let positive = 0;
  let negative = 0;
  const evidence: FutureTrajectoryEvidence[] = [];

  for (const signal of signals) {
    const raw = rawSignalWeight(signal, horizon);
    const impact = signalImpact(signal);
    if (impact === 'positive') positive += raw;
    else if (impact === 'negative') negative += raw;
    else {
      positive += raw * 0.45;
      negative += raw * 0.45;
    }

    if (raw >= 5) {
      evidence.push({
        type: signal.type,
        impact,
        confidence: signal.confidence,
        label: evidenceLabel(signal),
      });
    }
  }

  const futureUpsideScore = clampScore(positive);
  const declineRiskScore = clampScore(negative);
  const confidence = signals.length > 0 ? confidenceFromSignals(signals) : 'low';

  return {
    direction: direction({
      currentScore: args.currentScore,
      futureUpsideScore,
      declineRiskScore,
      confidence,
    }),
    currentScore: clampScore(args.currentScore),
    futureUpsideScore,
    declineRiskScore,
    confidence,
    horizon,
    evidence,
  };
}
