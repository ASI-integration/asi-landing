import type {
  UrbanDevelopmentConfidence,
  UrbanDevelopmentGeoSignalPrecision,
  UrbanDevelopmentLifecycleStage,
  UrbanDevelopmentSignal,
  UrbanDevelopmentSignalType,
  UrbanDevelopmentSourceKind,
} from './urban-development';

export type UrbanDevelopmentForecastLevel = 'low' | 'moderate' | 'high' | 'very_high';

export type UrbanDevelopmentForecastConfidence = 'low' | 'medium' | 'high';

/** Traceability entry for signals that materially influenced the forecast. */
export interface UrbanDevelopmentForecastContributingSignalRef {
  kind: UrbanDevelopmentSourceKind;
  signalType: UrbanDevelopmentSignalType;
  externalId?: string;
}

export interface UrbanDevelopmentForecastScore {
  score: number;
  level: UrbanDevelopmentForecastLevel;
  confidence: UrbanDevelopmentForecastConfidence;
  reasonsRu: string[];
  contributingSignals: UrbanDevelopmentForecastContributingSignalRef[];
}

const STAGE_WEIGHT: Record<UrbanDevelopmentLifecycleStage, number> = {
  planning: 0.22,
  design: 0.45,
  procurement: 0.72,
  construction_preparation: 1,
};

const GEO_WEIGHT: Record<UrbanDevelopmentGeoSignalPrecision, number> = {
  exact_address: 1,
  district_level: 0.75,
  city_level: 0.5,
  region_level: 0.28,
  text_hint_only: 0.14,
  unknown: 0.05,
};

const CONF_WEIGHT: Record<UrbanDevelopmentConfidence, number> = {
  high: 1,
  medium: 0.65,
  low: 0.35,
};

function lifecycleWeight(s: UrbanDevelopmentSignal): number {
  if (s.lifecycleStage) return STAGE_WEIGHT[s.lifecycleStage];
  if (s.status === 'procurement') return STAGE_WEIGHT.procurement;
  if (s.status === 'in_design') return STAGE_WEIGHT.design;
  return STAGE_WEIGHT.planning;
}

function geoWeight(s: UrbanDevelopmentSignal): number {
  const g = s.geoPrecision ?? 'unknown';
  return GEO_WEIGHT[g];
}

function confidenceWeight(s: UrbanDevelopmentSignal): number {
  return CONF_WEIGHT[s.confidence];
}

function typeMultiplier(signalType: UrbanDevelopmentSignalType): number {
  switch (signalType) {
    case 'road_project':
    case 'transport_hub':
      return 1.08;
    case 'social_infrastructure':
      return 1.06;
    case 'krt':
    case 'integrated_territory_development':
      return 1.07;
    case 'design_documentation':
    case 'engineering_survey':
      return 1.04;
    case 'government_procurement':
      return 1.02;
    case 'transit_change':
      return 1.05;
    case 'infrastructure_plan_doc':
    case 'street_grid_plan':
      return 1.03;
    default:
      return 1;
  }
}

/** Raw contribution of one signal on a 0–100-like scale before stacking. */
function rawContribution(s: UrbanDevelopmentSignal): number {
  const base = 85;
  return Math.min(
    100,
    base * lifecycleWeight(s) * geoWeight(s) * confidenceWeight(s) * typeMultiplier(s.signalType),
  );
}

function forecastLevel(score: number): UrbanDevelopmentForecastLevel {
  if (score >= 72) return 'very_high';
  if (score >= 48) return 'high';
  if (score >= 26) return 'moderate';
  return 'low';
}

function forecastConfidence(params: {
  score: number;
  signals: UrbanDevelopmentSignal[];
  contributing: UrbanDevelopmentForecastContributingSignalRef[];
}): UrbanDevelopmentForecastConfidence {
  const { score, signals, contributing } = params;
  if (contributing.length === 0 || score < 12) return 'low';

  const geoOk = (p: UrbanDevelopmentGeoSignalPrecision | undefined) =>
    p === 'exact_address' || p === 'district_level';

  const strongGeoCount = signals.filter(x => geoOk(x.geoPrecision)).length;
  const highConfCount = signals.filter(x => x.confidence === 'high').length;

  if (score >= 52 && (strongGeoCount >= 2 || (highConfCount >= 1 && strongGeoCount >= 1))) return 'high';
  if (score >= 28 && contributing.length >= 1) return 'medium';
  return 'low';
}

function signalRef(s: UrbanDevelopmentSignal): UrbanDevelopmentForecastContributingSignalRef {
  return {
    kind: s.kind,
    signalType: s.signalType,
    externalId: s.sourceProvenance?.externalId?.trim() || undefined,
  };
}

function reasonsForSignal(s: UrbanDevelopmentSignal, raw: number): string[] {
  const lines: string[] = [];
  if (raw < 2) return lines;

  if (s.signalType === 'design_documentation' || (s.kind === 'publicProcurement' && s.lifecycleStage === 'design')) {
    lines.push('Найдены закупки на проектную документацию');
  }
  else if (s.lifecycleStage === 'procurement' || s.status === 'procurement') {
    lines.push('Обнаружены признаки закупочной стадии по объекту развития');
  }

  if (s.signalType === 'road_project') {
    lines.push('Обнаружен признак подготовки строительства дороги');
  }

  switch (s.geoPrecision) {
    case 'district_level':
      lines.push('Сигнал привязан к району, а не к точному адресу');
      break;
    case 'city_level':
    case 'region_level':
      lines.push('География сигнала обобщена (город или регион)');
      break;
    case 'text_hint_only':
    case 'unknown':
      lines.push('География сигнала требует проверки');
      break;
    default:
      break;
  }

  if (s.signalType === 'social_infrastructure') {
    lines.push('Есть сигнал социальной инфраструктуры в перспективе развития');
  }
  if (s.signalType === 'transport_hub') {
    lines.push('Отмечается развитие транспортно-пересадочного узла или примыкающей инфраструктуры');
  }

  return lines;
}

function dedupeReasons(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    if (seen.has(l)) continue;
    seen.add(l);
    out.push(l);
    if (out.length >= 8) break;
  }
  return out;
}

export function emptyUrbanDevelopmentForecastScore(): UrbanDevelopmentForecastScore {
  return {
    score: 0,
    level: 'low',
    confidence: 'low',
    reasonsRu: ['Нет нормализованных сигналов градоразвития для прогноза.'],
    contributingSignals: [],
  };
}

/**
 * Прогнозный показатель развития района по urban-development сигналам.
 * Не связан с основным location score и не должен импортировать gravity/magnet слой.
 */
export function computeUrbanDevelopmentForecastScore(
  signals: UrbanDevelopmentSignal[],
): UrbanDevelopmentForecastScore {
  if (signals.length === 0) return emptyUrbanDevelopmentForecastScore();

  const rawScores = signals.map(rawContribution);
  const indexed = rawScores.map((raw, i) => ({ raw, signal: signals[i]!, i }));
  indexed.sort((a, b) => b.raw - a.raw);

  let stacked = 0;
  for (let k = 0; k < indexed.length; k++) {
    stacked += indexed[k]!.raw * Math.pow(0.52, k);
  }

  const score = Math.max(0, Math.min(100, Math.round(stacked)));

  const contributingSignals = signals
    .filter((_, i) => rawScores[i]! >= 1)
    .map(signalRef);

  const reasonsRu = dedupeReasons(
    indexed.flatMap(({ raw, signal }) => reasonsForSignal(signal, raw)),
  );

  const confidence = forecastConfidence({ score, signals, contributing: contributingSignals });

  const reasonsFinal =
    reasonsRu.length > 0
      ? reasonsRu
      : score >= 40
        ? ['Есть устойчивые признаки планируемого развития района.']
        : ['Мало устойчивых сигналов для детальных выводов о развитии района.'];

  return {
    score,
    level: forecastLevel(score),
    confidence,
    reasonsRu: reasonsFinal,
    contributingSignals,
  };
}
