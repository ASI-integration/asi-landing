import type { LocationAnalysis, OSMElement, RecommendedStrategy, SpatialTier } from './types';
import type { CommercialFormatFitEntry, CommercialOverallVerdict } from './commercial-format-fit';
import { buildCommercialFormatFit } from './commercial-format-fit';
import { createDisabledSpatialFoundation } from './spatial-foundation';
import {
  filterResidentialPrimeMagnets,
  type PrimeMagnetAnchorType,
  type ResidentialMarketMode,
} from './residential-prime-magnets';
import {
  buildFullLocationReport,
  locationReportInputFromLegacy,
  type UnifiedLocationReport,
} from './unified-report';
import {
  buildLocationReportResultMetadata,
  normalizeReportAddress,
  type LocationReportResultMetadata,
} from './report-result-metadata';
import { enrichAnalysisWithReportProjection } from './location-scoring-projection';

export type LocationStandaloneReportSectionId =
  | 'summary'
  | 'business_fit'
  | 'magnets'
  | 'competition'
  | 'income_strategy'
  | 'next_step';

export type LocationStandaloneReportMode = 'free' | 'paid';

export type StrLocationRecommendation = 'good' | 'conditional' | 'weak';
export type StrLocationAudience =
  | 'business'
  | 'tourists'
  | 'families'
  | 'medical'
  | 'mixed';

export type StrLocationReportProjection = {
  product: 'str-location-report';
  suitabilityScore: number | null;
  recommendation: StrLocationRecommendation;
  recommendationLabelRu: string;
  executiveConclusionRu: string;
  audienceFit: {
    primary: StrLocationAudience;
    suitableForRu: string[];
    explanationRu: string;
  };
  signalGroups: {
    businessCorporateRu: string[];
    transportRu: string[];
    medicalUniversityTourismLocalRu: string[];
  };
  territorialInterpretation: {
    summaryRu: string;
    signalQualityRu: string;
    diversityRu: string;
    businessSuitabilityRu: string;
    transportBalanceRu: string;
    countedSignals: number | null;
    coverageUnits: number | null;
  };
  weakZoneRisk: {
    level: 'low' | 'medium' | 'high' | 'unknown';
    summaryRu: string;
    gapRatio: number | null;
  };
  competitionOta: {
    pressureLevel: LocationAnalysis['gravityExplanation']['competitorPressureLevel'];
    competitorCount: number;
    notesRu: string[];
  };
  monetization: {
    strategy: RecommendedStrategy | null;
    monthlyIncomeRangeRub: { low: number; high: number } | null;
    notesRu: string[];
  };
  risksAndManualChecksRu: string[];
  confidence: {
    level: 'low' | 'medium' | 'high';
    reasonsRu: string[];
  };
};

export type LocationStandaloneReport = {
  version: 'v1';
  /**
   * Persisted tier for permalink payloads. Omitted on older rows — treat as paid/full.
   */
  reportMode?: LocationStandaloneReportMode;
  /** Прозрачность расчёта: время, адрес, режим, свежесть слоёв (без изменения scoring). */
  metadata?: LocationReportResultMetadata;
  /** Short teaser for `reportMode: 'free'` permalinks (RU copy). */
  free_brief?: string;
  /** Sellable RU short-term-rental report projection. Present on new paid STR reports. */
  strReport?: StrLocationReportProjection;
  address: string;
  generated_at_iso: string;
  unifiedReport?: UnifiedLocationReport;
  sections: Array<
    | {
        id: 'summary';
        verdict: string;
        drivers: string[];
        income_rub_month: number | null;
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
        id: 'income_strategy';
        recommended_strategy: RecommendedStrategy | null;
        monthly_income_rub: {
          short_term: number | null;
          hybrid: number | null;
          mid_term: number | null;
        };
        positioning_hint: string | null;
      }
    | {
        id: 'next_step';
        cta: 'get_full_breakdown';
      }
  >;
};

// ── Commercial standalone report ─────────────────────────────────────────────

export type LocationCommercialReport = {
  version: 'v2-commercial';
  address: string;
  generated_at_iso: string;
  unifiedReport?: UnifiedLocationReport;
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

export type PersistableLocationReport = LocationStandaloneReport | LocationCommercialReport;

/**
 * Canonical sellable report payloads must be versioned persisted reports.
 * Legacy /report/[id] generator output has no version field and must never
 * pass this guard as a commercial/location report.
 */
export function isCanonicalLocationReportPayload(x: any): x is PersistableLocationReport {
  return isLocationStandaloneReportV1(x) || isLocationCommercialReport(x);
}

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
}): LocationCommercialReport {
  const analysis = enrichAnalysisWithReportProjection(args.analysis, { reportMode: 'paid' });
  const generatedAtIso = new Date().toISOString();
  const unifiedReport = buildFullLocationReport(
    locationReportInputFromLegacy({
      address: args.address,
      locale: 'ru',
      mode: 'commercial',
      requestedAtIso: generatedAtIso,
    }),
    { analysis, generatedAtIso },
  );
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
    generated_at_iso: generatedAtIso,
    unifiedReport,
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
): {
  business_fit_verdict: 'fit' | 'not_fit' | 'unknown';
  note: string | null;
} {
  const aa = analysis.audienceAnalysis;
  if (!aa) return { business_fit_verdict: 'unknown', note: null };

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

function buildFreeBriefRu(args: { verdict: string }): string {
  return `${args.verdict} Это быстрая предварительная оценка по открытым данным.`.replace(/\s+/g, ' ').trim();
}

function levelRu(level: 'none' | 'weak' | 'moderate' | 'strong'): string {
  if (level === 'strong') return 'сильный';
  if (level === 'moderate') return 'средний';
  if (level === 'weak') return 'слабый';
  return 'нет сигнала';
}

function signalQualityRu(level: 'none' | 'low' | 'medium' | 'high'): string {
  if (level === 'high') return 'высокая';
  if (level === 'medium') return 'средняя';
  if (level === 'low') return 'низкая';
  return 'нет достаточных сигналов';
}

function strRecommendation(score: number | null): StrLocationRecommendation {
  if (score == null) return 'conditional';
  if (score >= 70) return 'good';
  if (score >= 45) return 'conditional';
  return 'weak';
}

function strRecommendationLabelRu(v: StrLocationRecommendation): string {
  if (v === 'good') return 'хорошо подходит для посуточной аренды';
  if (v === 'conditional') return 'подходит условно, нужна проверка модели';
  return 'слабая локация, не рекомендуется без сильного объекта';
}

function strAudienceFromDemandType(type: string | null | undefined): StrLocationAudience {
  if (type === 'corporate/business' || type === 'industrial') return 'business';
  if (type === 'tourist') return 'tourists';
  if (type === 'medical') return 'medical';
  if (type === 'mixed' || type === 'education' || type === 'transport') return 'mixed';
  return 'mixed';
}

function audienceLabelRu(v: StrLocationAudience): string {
  if (v === 'business') return 'командированные';
  if (v === 'tourists') return 'туристы';
  if (v === 'families') return 'семьи';
  if (v === 'medical') return 'медтуризм';
  return 'смешанный спрос';
}

function uniqueNonEmpty(lines: Array<string | null | undefined>, limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const t = line?.replace(/\s+/g, ' ').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

function magnetLine(m: Pick<LocationAnalysis['magnets'][number], 'name' | 'distance' | 'categoryLabel'>): string {
  const distance = Math.round(m.distance);
  return `${m.name} (${distance < 1000 ? `${distance} м` : `${(distance / 1000).toFixed(1)} км`})`;
}

function incomeRangeRub(value: number | null | undefined): { low: number; high: number } | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return {
    low: Math.max(0, Math.round((value * 0.82) / 5000) * 5000),
    high: Math.max(0, Math.round((value * 1.18) / 5000) * 5000),
  };
}

export function buildStrLocationReportProjection(analysis: LocationAnalysis): StrLocationReportProjection {
  const score =
    analysis.locationDecision?.finalScore ??
    analysis.locationScore?.location_score ??
    (Number.isFinite(analysis.evergreenIndex) ? Math.round(analysis.evergreenIndex) : null);
  const recommendation = strRecommendation(score);
  const publicSummary = analysis.locationDecision?.publicSummary;
  const primary = strAudienceFromDemandType(publicSummary?.primaryDemandType ?? null);
  const secondaryAudiences = (publicSummary?.secondaryDemandTypes ?? [])
    .map(strAudienceFromDemandType)
    .filter(v => v !== primary);
  const suitableForRu = uniqueNonEmpty(
    [
      audienceLabelRu(primary),
      ...secondaryAudiences.map(audienceLabelRu),
      analysis.audienceAnalysis?.primaryAudience === 'FAMILY' ? 'семьи' : null,
      (publicSummary?.secondaryDemandTypes?.length ?? 0) > 0 ? 'смешанный спрос' : null,
    ],
    5,
  );

  const byCat = (categories: string[]) =>
    analysis.magnets
      .filter(m => categories.includes(m.categoryId))
      .sort((a, b) => a.distance - b.distance)
      .map(magnetLine);
  const businessCorporateRu = uniqueNonEmpty(
    [
      ...byCat(['business', 'convention', 'major_hotel']),
      ...(analysis.locationDecision?.demandSignals ?? [])
        .filter(s => s.type.includes('business') || s.publicLabelRu.toLowerCase().includes('делов'))
        .map(s => s.publicLabelRu),
    ],
    5,
  );
  const transportRu = uniqueNonEmpty(
    [
      ...byCat(['metro', 'railway_station', 'airport', 'strategicTransportHub']),
      ...(analysis.accessibilityStops ?? []).slice(0, 3).map(s => `${s.name} (${Math.round(s.distance)} м)`),
    ],
    5,
  );
  const medicalUniversityTourismLocalRu = uniqueNonEmpty(
    [
      ...byCat(['hospital', 'specializedMedicalAnchor', 'university', 'attraction', 'stadium', 'shopping_major']),
      ...(analysis.strongestMagnets ?? [])
        .filter(m => ['hospital', 'specializedMedicalAnchor', 'university', 'attraction'].includes(m.categoryId))
        .map(magnetLine),
    ],
    6,
  );

  const territorial = analysis.territorialScoringSignals;
  const territorialInterpretation = territorial
    ? {
        summaryRu:
          territorial.signalQuality === 'none'
            ? 'В территориальной сетке анализа мало подтверждённых точек спроса, поэтому вывод требует ручной проверки.'
            : `Территориальная сетка анализа показывает ${signalQualityRu(territorial.signalQuality)} плотность сигналов: разнообразие окружения ${levelRu(territorial.diversity.level)}, деловой потенциал ${levelRu(territorial.businessSuitability.level)}.`,
        signalQualityRu: signalQualityRu(territorial.signalQuality),
        diversityRu: levelRu(territorial.diversity.level),
        businessSuitabilityRu: levelRu(territorial.businessSuitability.level),
        transportBalanceRu: levelRu(territorial.transportBalance.level),
        countedSignals: territorial.countedSignals,
        coverageUnits: territorial.coverageUnits,
      }
    : {
        summaryRu: 'Территориальная сетка анализа для этого отчёта недоступна; вывод опирается на найденные объекты спроса и конкуренцию.',
        signalQualityRu: 'нет достаточных сигналов',
        diversityRu: 'нет сигнала',
        businessSuitabilityRu: 'нет сигнала',
        transportBalanceRu: 'нет сигнала',
        countedSignals: null,
        coverageUnits: null,
      };

  const dead = territorial?.deadZonePenalty;
  const weakZoneLevel =
    !dead ? 'unknown' :
    dead.value >= 0.67 ? 'high' :
    dead.value >= 0.4 ? 'medium' :
    'low';
  const weakZoneRisk = {
    level: weakZoneLevel,
    summaryRu:
      weakZoneLevel === 'high'
        ? 'Есть выраженный риск слабой зоны: вокруг объекта мало устойчивых функций спроса, загрузка может зависеть от цены и качества объекта.'
        : weakZoneLevel === 'medium'
          ? 'Есть умеренный риск слабой зоны: спрос рядом неравномерный, перед запуском нужно проверить конкурентов и каналы продаж.'
          : weakZoneLevel === 'low'
            ? 'Риск слабой зоны низкий: рядом достаточно функций, которые могут поддерживать спрос.'
            : 'Недостаточно данных, чтобы уверенно оценить риск слабой зоны.',
    gapRatio: dead?.gapRatio ?? null,
  } as const;

  const recommended = analysis.locationScore?.recommended_strategy ?? null;
  const incomeValue =
    recommended && analysis.locationScore
      ? analysis.locationScore.estimated_monthly_income[recommended]
      : analysis.locationScore?.estimated_monthly_income.short_term;
  const competition = analysis.gravityExplanation.competitorPressureLevel;
  const competitionOta = {
    pressureLevel: competition,
    competitorCount: analysis.competitors.length,
    notesRu: uniqueNonEmpty(
      [
        analysis.competitors.length > 0
          ? `В открытых данных рядом найдено объектов размещения: ${analysis.competitors.length}. Это не полный срез площадок бронирования, но полезный индикатор давления.`
          : 'В открытых данных рядом не найдено плотного слоя объектов размещения; перед запуском всё равно нужно проверить площадки бронирования вручную.',
        competition === 'high'
          ? 'При высоком давлении важны упаковка объявления, отзывы, динамическая цена и отдельная стратегия каналов.'
          : competition === 'medium'
            ? 'Конкуренция есть, но локация может работать при чётком позиционировании и контроле цены.'
            : 'Низкое видимое давление может быть плюсом, но также требует проверки реального спроса на площадках.',
      ],
      3,
    ),
  };

  const riskCandidates = [
    ...(analysis.locationScore?.top_negative_factors ?? []),
    weakZoneRisk.level === 'high' || weakZoneRisk.level === 'medium' ? weakZoneRisk.summaryRu : null,
    competition === 'high' ? 'Высокая конкуренция: нужно сравнить качество и цены похожих объектов.' : null,
    analysis.neighborhoodEnvironment?.concernLevel === 'high' || analysis.neighborhoodEnvironment?.concernLevel === 'elevated'
      ? analysis.neighborhoodEnvironment.environmentNarrativeRu
      : null,
    analysis.magnets.length === 0 ? 'Не найдены сильные точки притяжения рядом; спрос нужно подтверждать вручную.' : null,
    'Проверьте фактические ставки, сезонность, состояние дома, ограничения по размещению гостей и правила площадок бронирования.',
  ];

  const confidenceLevel = analysis.residentialAnalysis?.confidence ?? (
    territorial?.signalQuality === 'high' ? 'high' :
    territorial?.signalQuality === 'medium' ? 'medium' :
    'low'
  );

  return {
    product: 'str-location-report',
    suitabilityScore: score,
    recommendation,
    recommendationLabelRu: strRecommendationLabelRu(recommendation),
    executiveConclusionRu:
      recommendation === 'good'
        ? 'Локация выглядит сильной для посуточной аренды: есть спросовые сигналы, которые можно превратить в понятное позиционирование объекта.'
        : recommendation === 'conditional'
          ? 'Локация может работать в посуточной аренде, но решение зависит от цены входа, качества объекта, каналов продаж и ручной проверки рисков.'
          : 'Локация выглядит слабой для массовой посуточной аренды. Заходить стоит только при сильном объекте, низкой цене входа или понятном нишевом спросе.',
    audienceFit: {
      primary,
      suitableForRu,
      explanationRu: publicSummary?.headlineRu ?? analysis.audienceAnalysis?.primaryDriverLabel ?? 'Профиль спроса смешанный; требуется проверка по фактическим каналам продаж.',
    },
    signalGroups: {
      businessCorporateRu,
      transportRu,
      medicalUniversityTourismLocalRu,
    },
    territorialInterpretation,
    weakZoneRisk,
    competitionOta,
    monetization: {
      strategy: recommended,
      monthlyIncomeRangeRub: incomeRangeRub(incomeValue),
      notesRu: [
        'Диапазон — ориентир для сравнения сценариев, а не обещание дохода.',
        'Фактическая выручка зависит от сезона, состояния объекта, отзывов, фото, цены, комиссий и качества управления.',
      ],
    },
    risksAndManualChecksRu: uniqueNonEmpty(riskCandidates, 7),
    confidence: {
      level: confidenceLevel,
      reasonsRu: uniqueNonEmpty(
        [
          ...(analysis.residentialAnalysis?.confidenceReasons ?? []),
          territorial
            ? `Качество территориальных сигналов: ${signalQualityRu(territorial.signalQuality)}.`
            : 'Территориальные сигналы недоступны.',
          analysis.locationDecision?.dataIntegrity.scoreBlockedDueToIncompleteData
            ? 'Часть данных карты была неполной, вывод нужно перепроверить вручную.'
            : null,
        ],
        4,
      ),
    },
  };
}


export function buildLocationStandaloneReport(args: {
  address: string;
  /** Исходный текст адреса пользователя; по умолчанию совпадает с `address`. */
  inputAddress?: string;
  /** Сырые объекты OSM того же прогона — улучшают canonicalFacts в Decision Kernel для free-проекции */
  rawOsmElements?: readonly OSMElement[];
  /** Для тестов окружения (ЕИС / procurement probe); в проде не передаётся. */
  metadataEnv?: Record<string, string | undefined>;
  analysis: LocationAnalysis;
  verdict: string;
  /** Market mode for prime magnet selection. Defaults to 'RU'. */
  market?: ResidentialMarketMode;
  /** Defaults to paid (full permalink payload including unifiedReport). */
  reportMode?: LocationStandaloneReportMode;
}): LocationStandaloneReport {
  const reportMode = args.reportMode ?? 'paid';
  const market = args.market ?? 'RU';
  const analysis = enrichAnalysisWithReportProjection(args.analysis, {
    reportMode,
    rawElements: args.rawOsmElements,
  });
  const generatedAtIso = new Date().toISOString();
  const score = analysis.locationScore;
  const reportVerdict =
    market === 'RU'
      ? (analysis.locationDecision?.publicSummary?.audienceVerdictRu ?? args.verdict)
      : args.verdict;
  const metadata = buildLocationReportResultMetadata({
    inputAddress: args.inputAddress?.trim() || args.address,
    normalizedAddress: normalizeReportAddress(args.address),
    reportMode,
    calculatedAtIso: generatedAtIso,
    env: args.metadataEnv,
  });

  if (reportMode === 'free') {
    const drivers =
      analysis.scoringTrace?.publicBullets?.length
        ? analysis.scoringTrace.publicBullets.slice(0, 5)
        : [];
    const free_brief = buildFreeBriefRu({ verdict: reportVerdict });
    return {
      version: 'v1',
      reportMode: 'free',
      metadata,
      free_brief,
      address: args.address,
      generated_at_iso: generatedAtIso,
      sections: [
        {
          id: 'summary',
          verdict: reportVerdict,
          drivers,
          income_rub_month: null,
          recommended_strategy: null,
        },
        { id: 'next_step', cta: 'get_full_breakdown' },
      ],
    };
  }

  const unifiedReport = buildFullLocationReport(
    locationReportInputFromLegacy({
      address: args.address,
      locale: market === 'RU' ? 'ru' : 'en',
      mode: 'residential',
      requestedAtIso: generatedAtIso,
    }),
    { analysis, generatedAtIso, market },
  );
  const drivers = (score?.top_positive_factors ?? []).slice(0, 3);

  const recommended = score?.recommended_strategy ?? null;
  const incomeRecommended =
    score && recommended
      ? (recommended === 'short_term'
          ? score.estimated_monthly_income.short_term
          : recommended === 'mid_term'
            ? score.estimated_monthly_income.mid_term
            : score.estimated_monthly_income.hybrid)
      : null;

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
  const businessFit = pickBusinessFitVerdict(analysis, primeMagnets);
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

  return {
    version: 'v1',
    reportMode: 'paid',
    metadata,
    strReport: buildStrLocationReportProjection(analysis),
    address: args.address,
    generated_at_iso: generatedAtIso,
    unifiedReport,
    sections: [
      {
        id: 'summary',
        verdict: reportVerdict,
        drivers,
        income_rub_month: incomeRecommended,
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
        id: 'income_strategy',
        recommended_strategy: recommended,
        monthly_income_rub: {
          short_term: score?.estimated_monthly_income.short_term ?? null,
          hybrid: score?.estimated_monthly_income.hybrid ?? null,
          mid_term: score?.estimated_monthly_income.mid_term ?? null,
        },
        positioning_hint: recommended ? `Рекомендуемая стратегия: ${strategyTitleRu(recommended)}.` : null,
      },
      { id: 'next_step', cta: 'get_full_breakdown' },
    ],
  };
}

export const sampleStrLocationStandaloneReportRu: LocationStandaloneReport = {
  version: 'v1',
  reportMode: 'paid',
  address: 'Санкт-Петербург, Невский проспект, 88',
  generated_at_iso: '2026-05-10T10:00:00.000Z',
  strReport: {
    product: 'str-location-report',
    suitabilityScore: 78,
    recommendation: 'good',
    recommendationLabelRu: 'хорошо подходит для посуточной аренды',
    executiveConclusionRu:
      'Пример показывает формат платного отчёта: локация выглядит сильной для посуточной аренды за счёт смешанного спроса, транспорта и туристических точек притяжения.',
    audienceFit: {
      primary: 'mixed',
      suitableForRu: ['командированные', 'туристы', 'семьи', 'смешанный спрос'],
      explanationRu:
        'Адрес находится в зоне, где деловой, туристический и транспортный спрос дополняют друг друга. Это снижает зависимость от одного сценария загрузки.',
    },
    signalGroups: {
      businessCorporateRu: [
        'Деловая активность в центральной части города',
        'Отели и апарт-форматы рядом подтверждают спрос на краткосрочное размещение',
      ],
      transportRu: ['Метро в пешей доступности', 'Удобный выезд к Московскому вокзалу'],
      medicalUniversityTourismLocalRu: [
        'Туристические маршруты центрального района',
        'Учебные и культурные объекты в зоне поездки',
        'Кафе, сервисы и повседневная инфраструктура рядом',
      ],
    },
    territorialInterpretation: {
      summaryRu:
        'Территориальная сетка анализа показывает плотное и разнообразное окружение: спрос не завязан только на одну точку.',
      signalQualityRu: 'высокая',
      diversityRu: 'сильный',
      businessSuitabilityRu: 'средний',
      transportBalanceRu: 'сильный',
      countedSignals: 12,
      coverageUnits: 8,
    },
    weakZoneRisk: {
      level: 'low',
      summaryRu: 'Риск слабой зоны низкий: рядом достаточно функций, которые могут поддерживать спрос.',
      gapRatio: 0.18,
    },
    competitionOta: {
      pressureLevel: 'medium',
      competitorCount: 14,
      notesRu: [
        'Видимое давление конкуренции среднее: объекту потребуется сильная упаковка, фото и понятное позиционирование.',
        'Перед покупкой или арендой нужно вручную проверить площадки бронирования, цены похожих объектов и сезонность.',
      ],
    },
    monetization: {
      strategy: 'short_term',
      monthlyIncomeRangeRub: { low: 165000, high: 245000 },
      notesRu: [
        'Диапазон — ориентир для сравнения сценариев, а не обещание дохода.',
        'Фактическая выручка зависит от сезона, состояния объекта, отзывов, фото, цены, комиссий и качества управления.',
      ],
    },
    risksAndManualChecksRu: [
      'Проверить фактические ставки и загрузку похожих объектов на площадках бронирования.',
      'Оценить шум, подъезд, входную группу и правила дома для гостей.',
      'Сравнить посуточный сценарий со среднесрочной арендой на низкий сезон.',
    ],
    confidence: {
      level: 'high',
      reasonsRu: [
        'В примере достаточно транспортных, туристических и сервисных сигналов.',
        'Конкуренция видима, поэтому вывод требует проверки цены и качества объекта.',
      ],
    },
  },
  unifiedReport: undefined,
  sections: [
    {
      id: 'summary',
      verdict: 'Демонстрационный пример полного отчёта по посуточной аренде.',
      drivers: [
        'Смешанный спрос: туристы, командированные и поездки выходного дня.',
        'Транспорт и центральная инфраструктура поддерживают загрузку.',
        'Конкуренция требует сильной упаковки объекта.',
      ],
      income_rub_month: 205000,
      recommended_strategy: 'short_term',
    },
    {
      id: 'business_fit',
      business_fit_verdict: 'fit',
      primary_magnets: [
        { title: 'Центральная деловая и сервисная зона', distance_m: 450 },
        { title: 'Крупный транспортный узел', distance_m: 900 },
      ],
      note: 'Подходит для командировок и коротких городских поездок.',
    },
    {
      id: 'magnets',
      primary: [
        {
          category_id: 'metro',
          name: 'Метро в пешей доступности',
          distance_m: 420,
          anchor_type: 'POSITIVE_DEMAND_ANCHOR',
          anchor_label_ru: 'Сильный спрос',
          category_label_ru: 'Транспорт',
        },
        {
          category_id: 'attraction',
          name: 'Центральные туристические маршруты',
          distance_m: 700,
          anchor_type: 'POSITIVE_DEMAND_ANCHOR',
          anchor_label_ru: 'Сильный спрос',
          category_label_ru: 'Туризм',
        },
      ],
      secondary: [],
    },
    {
      id: 'competition',
      competitor_count: 14,
      pressure_level: 'medium',
    },
    {
      id: 'income_strategy',
      recommended_strategy: 'short_term',
      monthly_income_rub: {
        short_term: 205000,
        hybrid: 185000,
        mid_term: 135000,
      },
      positioning_hint: 'Рекомендуемая стратегия: посуточная аренда с деловым и туристическим позиционированием.',
    },
    { id: 'next_step', cta: 'get_full_breakdown' },
  ],
};

