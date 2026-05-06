import type {
  LocationAnalysis,
  RecommendedStrategy,
  ResidentialAnalysisConfidence,
  ResidentialAudienceType,
  ResidentialStrategy,
  SpatialTier,
} from './types';
import type { CommercialFormatFitEntry, CommercialOverallVerdict } from './commercial-format-fit';
import { buildCommercialFormatFit } from './commercial-format-fit';
import { createDisabledSpatialFoundation } from './spatial-foundation';
import {
  filterResidentialPrimeMagnets,
  type PrimeMagnetAnchorType,
  type ResidentialMarketMode,
} from './residential-prime-magnets';
import {
  buildLocationDisplayModel,
  type LocationDisplayModel,
} from './location-display-model';
import {
  hasObjectParamsForIncome,
  type LocationReportIntake,
} from './report-intake';

export type LocationStandaloneReportSectionId =
  | 'summary'
  | 'business_fit'
  | 'magnets'
  | 'competition'
  | 'risks'
  | 'recommendations'
  | 'income_strategy'
  | 'residential_analysis'
  | 'next_step';

export type LocationStandaloneVerdict = 'стоит' | 'осторожно' | 'не стоит';

export type LocationStandaloneReportListItem = {
  title: string;
  explanation: string;
};

export type LocationStandaloneReport = {
  version: 'v1';
  address: string;
  generated_at_iso: string;
  /** Public display score from the canonical display model, never derived in UI. */
  location_score: number | null;
  display_model?: LocationDisplayModel;
  report_intake?: LocationReportIntake | null;
  fields_used: string[];
  data_sources: Array<{ field: string; source: string }>;
  sections: Array<
    | {
        id: 'summary';
        verdict: LocationStandaloneVerdict;
        display_audience?: LocationDisplayModel['displayAudience'];
        verdict_label_ru?: string;
        cap_reasons?: string[];
        short_reason: string;
        location_score: number | null;
        drivers: string[];
        income_rub_month: number | null;
        income_range_rub: { low: number; high: number } | null;
        income_confidence: 'high' | 'medium' | 'low' | null;
        income_note: string | null;
        recommended_strategy: RecommendedStrategy | null;
      }
    | {
        id: 'business_fit';
        business_fit_verdict: 'fit' | 'not_fit' | 'unknown';
        primary_magnets: Array<{ title: string; distance_m: number; anchor_type?: PrimeMagnetAnchorType }>;
        note: string | null;
      }
    | {
        id: 'magnets';
        primary: Array<{
          category_id: string;
          name: string;
          distance_m: number;
          anchor_type: PrimeMagnetAnchorType;
          anchor_label_ru: string;
          category_label_ru: string;
        }>;
        secondary: Array<{
          category_id: string;
          name: string;
          distance_m: number;
          anchor_type: PrimeMagnetAnchorType;
          anchor_label_ru: string;
          category_label_ru: string;
        }>;
        /** Present when no prime magnets passed the residential filter. */
        no_magnets_note?: string;
      }
    | {
        id: 'competition';
        competitor_count: number;
        pressure_level: LocationAnalysis['gravityExplanation']['competitorPressureLevel'];
      }
    | {
        id: 'risks';
        items: LocationStandaloneReportListItem[];
      }
    | {
        id: 'recommendations';
        location_action: string;
        best_rental_strategy: string;
        target_audience: string;
        avoid: string;
      }
    | {
        id: 'income_strategy';
        recommended_strategy: RecommendedStrategy | null;
        monthly_income_rub: {
          short_term: number | null;
          hybrid: number | null;
          mid_term: number | null;
        };
        income_range_rub: { low: number; high: number } | null;
        income_confidence: 'high' | 'medium' | 'low' | null;
        income_note: string | null;
        positioning_hint: string | null;
        assumptions: LocationStandaloneReportListItem[];
      }
    | {
        id: 'residential_analysis';
        residentialAudienceType: ResidentialAudienceType | null;
        residentialStrategy: ResidentialStrategy | null;
        confidence: ResidentialAnalysisConfidence | null;
        strategyRationaleRu: string | null;
        operationalNoteRu: string | null;
      }
    | {
        id: 'next_step';
        cta: 'save_or_discuss';
      }
  >;
};

// ── Commercial standalone report ─────────────────────────────────────────────

export type LocationCommercialReport = {
  version: 'v2-commercial';
  address: string;
  generated_at_iso: string;
  report_intake?: LocationReportIntake | null;
  flow: {
    transitShare: number;
    localActiveShare: number;
    destinationShare: number;
    flowCharacter: string;
    modifierTier: string;
    flowConclusion: string;
  };
  formatFit: {
    overallVerdict: CommercialOverallVerdict;
    overallVerdictLabelRu: string;
    entries: Array<{
      format: string;
      formatLabelRu: string;
      fitLevel: 'high' | 'medium' | 'low' | 'poor';
      explanationRu: string;
      supportingFactorsRu: string[];
      limitingFactorsRu: string[];
    }>;
  };
  /** Spatial foundation v1 — explainability + UI tier (new reports always include this). */
  spatial?: {
    spatial_tier: SpatialTier;
    enabled: boolean;
    barrier_penalty_applied: boolean;
    corridor_snap_m: number | null;
    distance_inflation_m: number;
    barrier_kinds: string[];
    geometric_confidence_note_ru: string;
  };
  anchors: Array<{ categoryId: string; name: string; distance_m: number; icon: string }>;
  barriers: string[];
  competition: {
    competitor_count: number;
    pressure_level: 'low' | 'medium' | 'high';
  };
  recommendation: string;
};

export function isLocationCommercialReport(x: any): x is LocationCommercialReport {
  return Boolean(
    x &&
    x.version === 'v2-commercial' &&
    typeof x.address === 'string' &&
    typeof x.generated_at_iso === 'string' &&
    x.flow &&
    x.formatFit,
  );
}

function buildFlowConclusion(args: {
  transitShare: number;
  localActiveShare: number;
  destinationShare: number;
}): string {
  const { transitShare, localActiveShare, destinationShare } = args;
  if (destinationShare >= 0.45)
    return 'У точки есть сильный целевой поток — люди приходят сюда намеренно.';
  if (transitShare >= 0.50)
    return 'В локации преобладает транзитный поток — высокая проходимость, но низкая задерживаемость.';
  if (localActiveShare >= 0.40)
    return 'Активная локальная аудитория — жители и работающие рядом.';
  return 'Поток смешанный: часть людей проходит транзитом, часть приходит целенаправленно.';
}

function buildBarriersRu(analysis: LocationAnalysis): string[] {
  const barriers: string[] = [];
  const env = analysis.neighborhoodEnvironment;
  if ((env.breakdown.industrial01 ?? 0) > 0.4)
    barriers.push('Промышленная инфраструктура снижает потребительский контекст');
  if ((env.breakdown.majorRoads01 ?? 0) > 0.55)
    barriers.push('Перегруженные магистрали затрудняют пешеходный подход');
  if ((env.breakdown.nightlife01 ?? 0) > 0.45)
    barriers.push('Ночная активность — возможные конфликты формата');
  if ((env.breakdown.aviation01 ?? 0) > 0.4)
    barriers.push('Близость авиационных объектов (шум)');
  if (analysis.gravityExplanation.competitorPressureLevel === 'high')
    barriers.push('Высокая конкурентная плотность');
  return barriers;
}

function buildCommercialRecommendation(
  verdict: CommercialOverallVerdict,
  entries: CommercialFormatFitEntry[],
): string {
  const highFormats = entries.filter(e => e.fitLevel === 'high').map(e => e.formatLabelRu);
  const mediumFormats = entries.filter(e => e.fitLevel === 'medium').map(e => e.formatLabelRu);

  if (verdict === 'strong') {
    return `Сильная коммерческая точка. Форматы с высоким потенциалом: ${highFormats.join(', ')}. Подходит для запуска при правильном позиционировании.`;
  }
  if (verdict === 'selective') {
    const best = [...highFormats, ...mediumFormats].slice(0, 2);
    return `Точечный потенциал: выбор формата критичен. Приоритет: ${best.join(', ')}. Остальные форматы несут повышенный риск.`;
  }
  if (verdict === 'weak') {
    return 'Слабая коммерческая локация. Требует глубокого анализа концепции и целевой аудитории перед запуском.';
  }
  return 'Локация не рекомендуется для коммерческого использования без существенного обоснования.';
}

export function buildCommercialReport(args: {
  address: string;
  analysis: LocationAnalysis;
  reportIntake?: LocationReportIntake | null;
}): LocationCommercialReport {
  const { analysis } = args;
  const ft = analysis.footTraffic;
  const { transitShare, localActiveShare, destinationShare } = ft.transitVsTarget;
  const formatFit = buildCommercialFormatFit(analysis);

  const anchors = (analysis.strongestMagnets ?? []).slice(0, 5).map(m => ({
    categoryId: m.categoryId,
    name: m.name,
    distance_m: Math.round(m.distance),
    icon: m.icon,
  }));

  const sf = args.analysis.spatialFoundation ?? createDisabledSpatialFoundation();

  return {
    version: 'v2-commercial',
    address: args.address,
    generated_at_iso: new Date().toISOString(),
    report_intake: args.reportIntake ?? null,
    spatial: {
      spatial_tier: sf.spatialTier,
      enabled: sf.enabled,
      barrier_penalty_applied: sf.barrierPenaltyApplied,
      corridor_snap_m: sf.corridorSnapM,
      distance_inflation_m: sf.distanceInflationM,
      barrier_kinds: sf.barrierKindsDetected,
      geometric_confidence_note_ru: sf.geometricConfidenceNoteRu,
    },
    flow: {
      transitShare: Math.round(transitShare * 100) / 100,
      localActiveShare: Math.round(localActiveShare * 100) / 100,
      destinationShare: Math.round(destinationShare * 100) / 100,
      flowCharacter: ft.flowCharacter,
      modifierTier: ft.modifierTier,
      flowConclusion: buildFlowConclusion({ transitShare, localActiveShare, destinationShare }),
    },
    formatFit: {
      overallVerdict: formatFit.overallVerdict,
      overallVerdictLabelRu: formatFit.overallVerdictLabelRu,
      entries: formatFit.entries,
    },
    anchors,
    barriers: buildBarriersRu(analysis),
    competition: {
      competitor_count: analysis.competitors.length,
      pressure_level: analysis.gravityExplanation.competitorPressureLevel,
    },
    recommendation: buildCommercialRecommendation(formatFit.overallVerdict, formatFit.entries),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function isLocationStandaloneReportV1(x: any): x is LocationStandaloneReport {
  return Boolean(
    x &&
    x.version === 'v1' &&
    typeof x.address === 'string' &&
    typeof x.generated_at_iso === 'string' &&
    Array.isArray(x.sections),
  );
}

function strategyTitleRu(s: RecommendedStrategy): string {
  if (s === 'short_term') return 'Посуточная аренда (деловой фокус)';
  if (s === 'hybrid') return 'Гибрид (посуточно + среднесрок)';
  return 'Среднесрочная аренда';
}

function pickBusinessFitVerdict(
  analysis: LocationAnalysis,
  primeMagnets: ReturnType<typeof filterResidentialPrimeMagnets>,
  displayModel: LocationDisplayModel,
): {
  business_fit_verdict: 'fit' | 'not_fit' | 'unknown';
  note: string | null;
} {
  const aa = analysis.audienceAnalysis;
  if (!aa) return { business_fit_verdict: 'unknown', note: null };

  if (displayModel.displayAudience !== 'BUSINESS') {
    return {
      business_fit_verdict: 'not_fit',
      note: 'Публичная модель не подтверждает деловой сценарий: сильный деловой якорь спроса отсутствует.',
    };
  }

  // Use policy-filtered prime magnets (within 1.5 km) for business-fit determination
  const hasPrimaryAccess = primeMagnets.some(m => m.distance <= 1500);

  if (aa.primaryAudience === 'BUSINESS' && hasPrimaryAccess) {
    return { business_fit_verdict: 'fit', note: 'Подходит для делового потока и командированных.' };
  }

  if (aa.primaryAudience === 'BUSINESS' && !hasPrimaryAccess) {
    return {
      business_fit_verdict: 'not_fit',
      note: 'Деловой сценарий возможен, но первостепенные магниты слишком далеко (≥ 1.5 км).',
    };
  }

  return { business_fit_verdict: 'not_fit', note: 'По сигналам окружения деловой сценарий не доминирует.' };
}

function residentialStrategyTitleRu(s: ResidentialStrategy | RecommendedStrategy | null): string {
  if (s === 'selective_premium_short_term') return 'Избирательная посуточная аренда под premium-комфорт';
  if (s === 'cautious_manual_only') return 'Осторожный ручной режим';
  if (s === 'short_term') return 'Посуточная аренда';
  if (s === 'hybrid') return 'Гибрид: посуточно + среднесрок';
  if (s === 'mid_term') return 'Среднесрочная аренда';
  return 'Недостаточно данных для стратегии';
}

function residentialAudienceTitleRu(type: ResidentialAudienceType | null, analysis: LocationAnalysis): string {
  if (type === 'premium_comfort') return 'Гости, чувствительные к комфорту и тихой жилой среде';
  if (type === 'mixed_use_adjacent') return 'Гости, которым подходит смешанная среда рядом с коммерческой активностью';
  if (type === 'standard_residential') return 'Стандартная жилая аудитория краткосрочной/среднесрочной аренды';

  const primary = analysis.audienceAnalysis?.primaryAudience;
  if (primary === 'BUSINESS') return 'Деловая аудитория и командированные';
  if (primary === 'TOURIST') return 'Туристическая и leisure-аудитория';
  return 'Аудитория не подтверждена моделью';
}

function buildStandaloneVerdict(args: {
  displayModel: LocationDisplayModel;
  residentialConfidence: ResidentialAnalysisConfidence | null;
  competitorPressureLevel: LocationAnalysis['gravityExplanation']['competitorPressureLevel'];
}): { verdict: LocationStandaloneVerdict; shortReason: string } {
  const { displayModel, residentialConfidence, competitorPressureLevel } = args;
  const locationScore = displayModel.displayScore;

  if (typeof locationScore !== 'number' || !Number.isFinite(locationScore)) {
    return {
      verdict: 'осторожно',
      shortReason: 'Итоговый публичный score отсутствует в анализе, поэтому решение нужно подтверждать вручную.',
    };
  }

  const demand = args.displayModel.residentialSanityApplied ? locationScore : 100;
  const supply = args.displayModel.residentialSanityApplied ? locationScore : 100;
  const hasHardRisk =
    competitorPressureLevel === 'high' ||
    supply <= 45 ||
    demand <= 45 ||
    residentialConfidence === 'low' ||
    displayModel.verdictTone === 'weak';

  if (locationScore >= 72 && !hasHardRisk && displayModel.displayAudience !== 'RESIDENTIAL') {
    return {
      verdict: 'стоит',
      shortReason: displayModel.reportNarrative,
    };
  }

  if (locationScore < 48 || (locationScore < 55 && hasHardRisk)) {
    return {
      verdict: 'не стоит',
      shortReason: displayModel.reportNarrative,
    };
  }

  return {
    verdict: 'осторожно',
    shortReason: displayModel.reportNarrative,
  };
}

function buildRiskItems(args: {
  analysis: LocationAnalysis;
  primeMagnetCount: number;
  reportIntake?: LocationReportIntake | null;
}): LocationStandaloneReportListItem[] {
  const { analysis, primeMagnetCount } = args;
  const score = analysis.locationScore;
  const items: LocationStandaloneReportListItem[] = [];

  const push = (title: string, explanation: string) => {
    if (items.some(i => i.title === title && i.explanation === explanation)) return;
    items.push({ title, explanation });
  };

  for (const factor of (score?.top_negative_factors ?? []).slice(0, 4)) {
    push(factor, 'Негативный фактор из scoring-модели; учитывайте его в цене, упаковке и выборе стратегии.');
  }

  if (primeMagnetCount === 0 || (score?.breakdown.magnet_score ?? 100) <= 40 || analysis.magnets.length <= 2) {
    push(
      'Слабые магниты спроса',
      `Prime-магнитов в отчёте: ${primeMagnetCount}; общий счётчик магнитов анализа: ${analysis.magnets.length}. Спрос может быть менее устойчивым.`,
    );
  }

  if (analysis.gravityExplanation.competitorPressureLevel === 'high' || (score?.breakdown.supply_score ?? 100) <= 45) {
    push(
      'Высокая конкуренция',
      `Давление конкуренции: ${analysis.gravityExplanation.competitorPressureLevel}; supply_score: ${score?.breakdown.supply_score ?? 'нет данных'}/100.`,
    );
  }

  if ((score?.breakdown.demand_score ?? 100) <= 45) {
    push(
      'Низкий спрос',
      `Demand_score: ${score?.breakdown.demand_score ?? 'нет данных'}/100. Краткосрочная модель может не набрать стабильную загрузку.`,
    );
  }

  if ((score?.breakdown.audience_fit_score ?? 100) < 35 || analysis.audienceAnalysis?.fallbackMode) {
    push(
      'Аудитория не подтверждена',
      `Audience_fit_score: ${score?.breakdown.audience_fit_score ?? 'нет данных'}/100${analysis.audienceAnalysis?.fallbackMode ? '; включён fallback аудитории' : ''}.`,
    );
  }

  if (
    analysis.residentialAnalysis?.confidence !== 'high' ||
    analysis.neighborhoodEnvironment?.confidence === 'low'
  ) {
    push(
      'Ограничения данных',
      'Вывод основан на OSM-сигналах и модельных прокси спроса/дохода; ставки, состояние объекта и реальные бронирования нужно проверять отдельно.',
    );
  }

  if (args.reportIntake && !hasObjectParamsForIncome(args.reportIntake)) {
    push(
      'Нужны данные объекта',
      'Для более точной доходной вилки нужны площадь, ремонт, дом/этаж, фото-упаковка и фактическая цена входа или аренды.',
    );
  }

  return items;
}

function buildIncomeAssumptions(analysis: LocationAnalysis): LocationStandaloneReportListItem[] {
  const score = analysis.locationScore;
  return [
    {
      title: 'До расходов',
      explanation: 'Доход показан до расходов на управление, комиссии площадок, уборку, налоги, коммунальные платежи и простой.',
    },
    {
      title: 'Occupancy proxy',
      explanation: `Базовая загрузка берётся из income_model.base_occupancy_pct: ${score?.income_model.base_occupancy_pct ?? 'нет данных'}%. Это модельный прокси, а не фактическая статистика бронирований.`,
    },
    {
      title: 'ADR assumptions',
      explanation: `Базовый ADR берётся из income_model.base_adr_rub: ${score?.income_model.base_adr_rub ?? 'нет данных'} руб.; сценарии short_term/hybrid/mid_term применяют внутренние мультипликаторы модели.`,
    },
    {
      title: 'Ограничения данных',
      explanation: 'Расчёт не учитывает ремонт, класс объекта, фото, рейтинг, договорные ограничения и фактические ставки конкурентов из OTA.',
    },
  ];
}

function roundIncomeRub(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value / 5000) * 5000;
}

function buildIncomeRange(args: {
  displayScore: number | null;
  baseIncomeRub: number | null;
  reportIntake?: LocationReportIntake | null;
}): {
  range: { low: number; high: number } | null;
  confidence: 'high' | 'medium' | 'low' | null;
  note: string | null;
} {
  const { displayScore, baseIncomeRub, reportIntake } = args;
  if (baseIncomeRub == null || !Number.isFinite(baseIncomeRub) || baseIncomeRub <= 0) {
    return {
      range: null,
      confidence: 'low',
      note: 'Доходная вилка не рассчитана: не хватает базовых сигналов income-модели.',
    };
  }

  const hasObjectData = hasObjectParamsForIncome(reportIntake);
  const isCautiousScore = displayScore == null || displayScore <= 55;
  const lowMultiplier = isCautiousScore ? 0.55 : hasObjectData ? 0.8 : 0.65;
  const highMultiplier = isCautiousScore ? 0.9 : hasObjectData ? 1.2 : 1.1;
  const low = roundIncomeRub(baseIncomeRub * lowMultiplier);
  const high = Math.max(low + 5000, roundIncomeRub(baseIncomeRub * highMultiplier));

  if (isCautiousScore) {
    return {
      range: { low, high },
      confidence: 'low',
      note: 'Осторожная доходная вилка: локационный score средний или слабый, поэтому доходность нужно подтверждать объектом и реальными ставками конкурентов.',
    };
  }

  if (!hasObjectData) {
    return {
      range: { low, high },
      confidence: 'low',
      note: 'Нужны данные объекта для точнее расчёта: площадь, ремонт, дом, фото/упаковка и цена сильно меняют итоговую вилку.',
    };
  }

  return {
    range: { low, high },
    confidence: 'medium',
    note: 'Доход показан как вилка с уровнем уверенности, а не как гарантированная сумма.',
  };
}

function buildRecommendations(args: {
  analysis: LocationAnalysis;
  verdict: LocationStandaloneVerdict;
  risks: LocationStandaloneReportListItem[];
}): Extract<LocationStandaloneReport['sections'][number], { id: 'recommendations' }> {
  const { analysis, verdict, risks } = args;
  const score = analysis.locationScore;
  const residential = analysis.residentialAnalysis;
  const strategy = residential?.residentialStrategy ?? score?.recommended_strategy ?? null;
  const hasHighCompetition = risks.some(r => r.title === 'Высокая конкуренция');
  const hasLowDemand = risks.some(r => r.title === 'Низкий спрос' || r.title === 'Слабые магниты спроса');
  const hasAudienceRisk = risks.some(r => r.title === 'Аудитория не подтверждена');

  const location_action =
    verdict === 'стоит'
      ? 'Рассматривать локацию к запуску, но подтвердить объектные параметры: состояние, договор, ограничения дома и реальные ставки.'
      : verdict === 'не стоит'
        ? 'Не заходить без сильного дисконта или отдельного подтверждения спроса реальными бронированиями/конкурентными ставками.'
        : 'Переходить только через ручную валидацию: проверить конкурентов, целевую аудиторию, состояние объекта и минимальную доходность.';

  const avoidParts: string[] = [];
  if (hasHighCompetition) avoidParts.push('ценовой войны без отличимой упаковки');
  if (hasLowDemand) avoidParts.push('ставки только на чистую посуточку без запасного среднесрочного сценария');
  if (hasAudienceRisk) avoidParts.push('широкого позиционирования “для всех”');
  if (residential?.confidence === 'low') avoidParts.push('автоматического запуска без ручного контроля');

  return {
    id: 'recommendations',
    location_action,
    best_rental_strategy: residentialStrategyTitleRu(strategy),
    target_audience: residentialAudienceTitleRu(residential?.residentialAudienceType ?? null, analysis),
    avoid: avoidParts.length ? `Избегать: ${avoidParts.join('; ')}.` : 'Избегать запуска без проверки договора, состояния объекта, фото-упаковки и фактического конкурентного сета.',
  };
}

export function buildLocationStandaloneReport(args: {
  address: string;
  analysis: LocationAnalysis;
  /** Deprecated: public verdict is generated from LocationDisplayModel. */
  verdict?: string;
  /** Market mode for prime magnet selection. Defaults to 'RU'. */
  market?: ResidentialMarketMode;
  displayModel?: LocationDisplayModel;
  reportIntake?: LocationReportIntake | null;
}): LocationStandaloneReport {
  const { analysis } = args;
  const market = args.market ?? 'RU';
  const displayModel = args.displayModel ?? buildLocationDisplayModel(analysis, {
    locale: market === 'RU' ? 'ru' : 'en',
    mode: 'residential',
  });
  const score = analysis.locationScore;
  const drivers = displayModel.safeDrivers.length > 0
    ? displayModel.safeDrivers.map(d => d.labelRu).slice(0, 3)
    : (score?.top_positive_factors ?? []).slice(0, 3);

  const recommended = score?.recommended_strategy ?? null;
  const incomeRecommended =
    score && recommended
      ? (recommended === 'short_term'
          ? score.estimated_monthly_income.short_term
          : recommended === 'mid_term'
            ? score.estimated_monthly_income.mid_term
            : score.estimated_monthly_income.hybrid)
      : null;
  const incomeRange = buildIncomeRange({
    displayScore: displayModel.displayScore,
    baseIncomeRub: incomeRecommended,
    reportIntake: args.reportIntake ?? null,
  });

  // ── Residential prime magnets (policy-filtered) ───────────────────────────
  // Apply the closed allowlist + distance + persistence + market rules.
  // Primary: top 3 by default; secondary: items 4–5 (hard max 5 total).
  const primeMagnets = filterResidentialPrimeMagnets(analysis.magnets, {
    market,
    defaultTop: 3,
    hardMax: 5,
  });
  const primaryPrime = primeMagnets.slice(0, 3);
  const secondaryPrime = primeMagnets.slice(3, 5);

  // Business-fit section: use prime-filtered magnets within 1.5 km
  const businessFit = pickBusinessFitVerdict(analysis, primeMagnets, displayModel);
  const primaryMagnetRows = primaryPrime.map(m => ({
    title: `${m.categoryLabelRu}: ${m.name}`,
    distance_m: Math.round(m.distance),
    anchor_type: m.anchorType,
  }));

  const toMagnetRow = (m: (typeof primeMagnets)[number]) => ({
    category_id: m.categoryId,
    name: m.name,
    distance_m: Math.round(m.distance),
    anchor_type: m.anchorType,
    anchor_label_ru: m.anchorLabelRu,
    category_label_ru: m.categoryLabelRu,
  });

  const locationScore = displayModel.displayScore;
  const residential = analysis.residentialAnalysis;
  const { verdict, shortReason } = buildStandaloneVerdict({
    displayModel,
    residentialConfidence: residential?.confidence ?? null,
    competitorPressureLevel: analysis.gravityExplanation.competitorPressureLevel,
  });
  const risks = buildRiskItems({
    analysis,
    primeMagnetCount: primeMagnets.length,
    reportIntake: args.reportIntake ?? null,
  });
  const recommendations = buildRecommendations({ analysis, verdict, risks });

  return {
    version: 'v1',
    address: args.address,
    generated_at_iso: new Date().toISOString(),
    location_score: locationScore,
    display_model: displayModel,
    report_intake: args.reportIntake ?? null,
    fields_used: [
      'locationDisplayModel.displayScore',
      'locationDisplayModel.displayAudience',
      'locationDisplayModel.verdictLabelRu',
      'locationDisplayModel.safeDrivers',
      'locationDisplayModel.capReasons',
      'location_report_requests.report_intake',
      'analysis.locationScore.location_score',
      'analysis.locationScore.top_positive_factors',
      'analysis.locationScore.top_negative_factors',
      'analysis.locationScore.breakdown',
      'analysis.locationScore.income_model',
      'analysis.locationScore.estimated_monthly_income',
      'analysis.gravityExplanation.competitorPressureLevel',
      'analysis.competitors',
      'analysis.magnets',
      'analysis.audienceAnalysis',
      'analysis.neighborhoodEnvironment',
      'analysis.residentialAnalysis',
    ],
    data_sources: [
      { field: 'location_score', source: 'locationDisplayModel.displayScore from buildLocationDisplayModel()' },
      { field: 'summary.verdict / short_reason', source: 'locationDisplayModel + competition + residential confidence' },
      { field: 'risks', source: 'top_negative_factors + magnets + competition + score breakdown + data confidence' },
      { field: 'recommendations', source: 'generated from verdict, risks, residentialAnalysis and recommended strategy' },
      { field: 'income range', source: 'analysis.locationScore income estimate + locationDisplayModel.displayScore + report_intake object params' },
      { field: 'residential analysis', source: 'analysis.residentialAnalysis from buildResidentialAnalysis()' },
    ],
    sections: [
      {
        id: 'summary',
        verdict,
        display_audience: displayModel.displayAudience,
        verdict_label_ru: displayModel.verdictLabelRu,
        cap_reasons: displayModel.capReasons,
        short_reason: shortReason,
        location_score: locationScore,
        drivers,
        income_rub_month: null,
        income_range_rub: incomeRange.range,
        income_confidence: incomeRange.confidence,
        income_note: incomeRange.note,
        recommended_strategy: recommended,
      },
      {
        id: 'business_fit',
        business_fit_verdict: businessFit.business_fit_verdict,
        primary_magnets: primaryMagnetRows,
        note: businessFit.note,
      },
      {
        id: 'magnets',
        primary: primaryPrime.map(toMagnetRow),
        secondary: secondaryPrime.map(toMagnetRow),
        no_magnets_note:
          primeMagnets.length === 0
            ? 'В радиусе 1 км не обнаружено prime-магнитов, отвечающих требованиям устойчивого спроса.'
            : undefined,
      },
      {
        id: 'competition',
        competitor_count: analysis.competitors.length,
        pressure_level: analysis.gravityExplanation.competitorPressureLevel,
      },
      {
        id: 'risks',
        items: risks,
      },
      recommendations,
      {
        id: 'income_strategy',
        recommended_strategy: recommended,
        monthly_income_rub: {
          short_term: incomeRange.confidence === 'low' ? null : score?.estimated_monthly_income.short_term ?? null,
          hybrid: incomeRange.confidence === 'low' ? null : score?.estimated_monthly_income.hybrid ?? null,
          mid_term: incomeRange.confidence === 'low' ? null : score?.estimated_monthly_income.mid_term ?? null,
        },
        income_range_rub: incomeRange.range,
        income_confidence: incomeRange.confidence,
        income_note: incomeRange.note,
        positioning_hint: recommended
          ? `Рекомендуемая стратегия: ${strategyTitleRu(recommended)}. Доход трактуем как диапазон и проверяем по объекту.`
          : 'Доход трактуем как диапазон и проверяем по объекту.',
        assumptions: buildIncomeAssumptions(analysis),
      },
      {
        id: 'residential_analysis',
        residentialAudienceType: residential?.residentialAudienceType ?? null,
        residentialStrategy: residential?.residentialStrategy ?? null,
        confidence: residential?.confidence ?? null,
        strategyRationaleRu: residential?.strategyRationaleRu ?? null,
        operationalNoteRu: residential?.operationalNoteRu ?? null,
      },
      { id: 'next_step', cta: 'save_or_discuss' },
    ],
  };
}

