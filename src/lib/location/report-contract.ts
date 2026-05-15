import type {
  AudienceAnalysis,
  LocationAnalysis,
  LocationScoreBreakdown,
  LocationScoreOutput,
  RecommendedStrategy,
} from './types';

export type ReportLocale = 'ru' | 'en';
export type ReportMode = 'residential' | 'commercial';
export type ReportLifecycleStatus = 'preview' | 'processing' | 'ready' | 'failed';
export type ReportSource = 'demo' | 'paid' | 'admin';
export type DataQualityLevel = 'low' | 'medium' | 'high';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type RiskSeverity = 'low' | 'medium' | 'high';
export type RecommendationPriority = 'now' | 'next' | 'later';

export interface ReportInput {
  address: string;
  locale: ReportLocale;
  mode: ReportMode;
  objectType?: 'apartment' | 'apart_hotel' | 'mini_hotel' | 'commercial_space' | 'other';
  objectContext?: {
    rooms?: number;
    bedrooms?: number;
    areaSqm?: number;
    floor?: number;
    currentUse?: string;
    targetUse?: string;
  };
  coordinates?: {
    lat: number;
    lon: number;
  };
  requestedAtIso: string;
}

export interface Confidence {
  level: ConfidenceLevel;
  dataQuality: DataQualityLevel;
  reasons: string[];
  limitations: string[];
  sourceNotes: string[];
}

export interface ReportSection {
  id: string;
  title: string;
  summary?: string;
  items?: string[];
  confidence?: ConfidenceLevel;
  isPreviewOnly?: boolean;
}

export interface MagnetImpact {
  categoryId: string;
  name: string;
  distanceM: number | null;
  impactLevel: 'primary' | 'secondary' | 'context';
  impactType: 'demand_driver' | 'accessibility' | 'friction' | 'mixed';
  explanation: string;
  source: 'osm' | 'user' | 'demo';
}

export interface AudienceFit {
  primaryAudience: 'business' | 'tourist' | 'family' | 'mixed' | 'unknown';
  score: number | null;
  audienceSharePct?: number;
  demandFlowLabel?: string;
  drivers: string[];
  caveats: string[];
  confidence: ConfidenceLevel;
}

export interface CompetitionSummary {
  competitorCount: number | null;
  pressureLevel: 'low' | 'medium' | 'high' | 'unknown';
  visibleDataOnly: boolean;
  notes: string[];
  confidence: ConfidenceLevel;
}

export interface IncomeEstimate {
  strategy: RecommendedStrategy | 'other';
  label: string;
  amountMonthly: number | null;
  rangeMonthly?: {
    low: number;
    high: number;
  };
  currency: 'RUB' | 'USD';
  basis: 'estimate' | 'sample' | 'unavailable';
}

export interface IncomePotential {
  estimates: IncomeEstimate[];
  recommendedStrategy: RecommendedStrategy | null;
  assumptions: string[];
  limitations: string[];
  confidence: ConfidenceLevel;
}

export interface RiskItem {
  title: string;
  severity: RiskSeverity;
  description: string;
  validationNeeded: string;
  source: 'engine' | 'osm' | 'user' | 'demo';
}

export interface RecommendationItem {
  title: string;
  priority: RecommendationPriority;
  rationale: string;
  action: string;
  confidence: ConfidenceLevel;
}

/** Подпись в платном отчёте: слой градоразвития пока без живых источников (сигналы пустые). */
export const URBAN_DEVELOPMENT_LIVE_SOURCES_DISCLAIMER_RU =
  'Сигналы градостроительного развития пока не подключены к живым источникам. В будущем блок будет учитывать закупки, проекты планировки и инфраструктурные изменения.';

export interface UrbanDevelopmentForecastDigest {
  score: number;
  level: 'low' | 'moderate' | 'high' | 'very_high';
  confidence: 'low' | 'medium' | 'high';
  reasonsRu: string[];
  contributingSignalCount: number;
}

export interface FastReportPreview {
  version: 'fast-report-preview-v1';
  reportId?: string;
  status: Extract<ReportLifecycleStatus, 'preview'>;
  source: Extract<ReportSource, 'demo'>;
  createdAtIso: string;
  input: ReportInput;
  addressSummary: string;
  overallScore: number | null;
  demandExplanation: string;
  topDemandDrivers: MagnetImpact[];
  mainRisks: RiskItem[];
  incomePotentialPreview: IncomePotential | null;
  fullReportCta: {
    label: string;
    href: string;
    note: string;
  };
  confidence: Confidence;
}

export interface FullLocationReport {
  version: 'full-location-report-v1';
  reportId: string;
  status: Extract<ReportLifecycleStatus, 'ready'>;
  source: ReportSource;
  isSample: boolean;
  createdAtIso: string;
  updatedAtIso?: string;
  input: ReportInput;
  executiveSummary: {
    verdict: string;
    summary: string;
    keyDrivers: string[];
    keyRisks: string[];
  };
  overallScore: number | null;
  scoreBreakdown: Partial<LocationScoreBreakdown> | null;
  demandDrivers: string[];
  primaryMagnets: MagnetImpact[];
  secondaryMagnets: MagnetImpact[];
  audienceFit: AudienceFit;
  competition: CompetitionSummary;
  incomePotential: IncomePotential;
  risks: RiskItem[];
  recommendations: RecommendationItem[];
  otaChannelStrategyNote: string;
  nextSteps: string[];
  confidence: Confidence;
  sections: ReportSection[];
  /** Ранний слой «прогноз развития района» (не входит в основной score). Опционально для обратной совместимости. */
  urbanDevelopmentForecast?: UrbanDevelopmentForecastDigest;
}

export interface ReportStateRecord<TReport = FastReportPreview | FullLocationReport> {
  reportId?: string;
  requestId?: string;
  status: ReportLifecycleStatus;
  source: ReportSource;
  createdAtIso: string;
  updatedAtIso?: string;
  permalink?: string;
  input?: ReportInput;
  report?: TReport;
  error?: string;
}

function audienceFromAnalysis(audience?: AudienceAnalysis): AudienceFit {
  if (!audience) {
    return {
      primaryAudience: 'unknown',
      score: null,
      drivers: [],
      caveats: ['Audience fit was not available in the analysis payload.'],
      confidence: 'low',
    };
  }

  const primaryAudience =
    audience.primaryAudience === 'BUSINESS'
      ? 'business'
      : audience.primaryAudience === 'TOURIST'
        ? 'tourist'
        : audience.primaryAudience === 'FAMILY'
          ? 'family'
          : 'mixed';

  return {
    primaryAudience,
    score: audience.audienceFitScore,
    audienceSharePct: audience.audienceSharePct,
    demandFlowLabel: audience.demandFlowLabel,
    drivers: [
      audience.primaryDriverLabel,
      audience.businessClusterDetected ? 'Business cluster detected in the weighted signal mix.' : '',
    ].filter(Boolean),
    caveats: audience.fallbackMode
      ? ['Audience mode used fallback logic because stronger primary magnets were limited.']
      : [],
    confidence: audience.lockedMode || audience.businessClusterDetected ? 'medium' : 'low',
  };
}

function incomeFromScore(score?: LocationScoreOutput): IncomePotential | null {
  if (!score) return null;
  return {
    recommendedStrategy: score.recommended_strategy,
    estimates: [
      {
        strategy: 'short_term',
        label: 'Short-term rental',
        amountMonthly: score.estimated_monthly_income.short_term,
        currency: 'RUB',
        basis: 'estimate',
      },
      {
        strategy: 'hybrid',
        label: 'Hybrid',
        amountMonthly: score.estimated_monthly_income.hybrid,
        currency: 'RUB',
        basis: 'estimate',
      },
      {
        strategy: 'mid_term',
        label: 'Mid-term rental',
        amountMonthly: score.estimated_monthly_income.mid_term,
        currency: 'RUB',
        basis: 'estimate',
      },
    ],
    assumptions: [
      `Base ADR proxy: ${score.income_model.base_adr_rub} RUB.`,
      `Base occupancy proxy: ${score.income_model.base_occupancy_pct}%.`,
    ],
    limitations: [
      'Income is an estimate for comparing scenarios, not a guarantee.',
      'Final result depends on object quality, seasonality, pricing, channels, reviews, and operations.',
    ],
    confidence: 'medium',
  };
}

export function buildFastReportPreview(args: {
  input: ReportInput;
  analysis: LocationAnalysis;
  fullReportHref: string;
}): FastReportPreview {
  const { analysis, input } = args;
  const score = analysis.locationScore;
  const positives = score?.top_positive_factors ?? [];
  const negatives = score?.top_negative_factors ?? [];

  return {
    version: 'fast-report-preview-v1',
    status: 'preview',
    source: 'demo',
    createdAtIso: new Date().toISOString(),
    input,
    addressSummary: input.address,
    overallScore: score?.location_score ?? analysis.evergreenIndex ?? null,
    demandExplanation: analysis.conclusion,
    topDemandDrivers: (analysis.strongestMagnets ?? []).slice(0, 3).map(m => ({
      categoryId: m.categoryId,
      name: m.name,
      distanceM: Math.round(m.distance),
      impactLevel: 'primary',
      impactType: 'demand_driver',
      explanation: m.categoryLabel,
      source: 'osm',
    })),
    mainRisks: negatives.slice(0, 3).map((text, index) => ({
      title: `Risk ${index + 1}`,
      severity: 'medium',
      description: text,
      validationNeeded: 'Validate with object details and current market context before making an investment decision.',
      source: 'engine',
    })),
    incomePotentialPreview: incomeFromScore(score),
    fullReportCta: {
      label: input.locale === 'ru' ? 'Получить полный отчёт' : 'Request full report',
      href: args.fullReportHref,
      note: input.locale === 'ru'
        ? 'Полный отчёт глубже: структура спроса, магниты, конкуренция, стратегия и ограничения.'
        : 'The full report adds demand structure, magnets, competition, strategy, and limitations.',
    },
    confidence: {
      level: positives.length >= 2 ? 'medium' : 'low',
      dataQuality: 'medium',
      reasons: positives.slice(0, 3),
      limitations: [
        'Fast preview uses available open spatial data and may omit object-specific constraints.',
      ],
      sourceNotes: ['OpenStreetMap-derived spatial signals', 'ASI location interpretation layer'],
    },
  };
}

export const sampleFullLocationReportRu: FullLocationReport = {
  version: 'full-location-report-v1',
  reportId: 'sample-location-report',
  status: 'ready',
  source: 'demo',
  isSample: true,
  createdAtIso: '2026-05-09T09:00:00.000Z',
  input: {
    address: 'Демо-адрес: центральная городская зона',
    locale: 'ru',
    mode: 'residential',
    objectType: 'apartment',
    objectContext: {
      rooms: 2,
      currentUse: 'Демо-объект для структуры отчёта',
    },
    requestedAtIso: '2026-05-09T09:00:00.000Z',
  },
  executiveSummary: {
    verdict: 'Демонстрационный пример: отчёт показывает спрос, риски и сценарии монетизации до решения.',
    summary:
      'Это sample-отчёт с безопасными демонстрационными данными. Он показывает коммерческую структуру будущего платного отчёта, а не описывает реальный адрес.',
    keyDrivers: [
      'Рядом показан крупный транспортный якорь как пример устойчивого источника доступности.',
      'В sample-структуре есть деловой и образовательный контекст как пример разных типов спроса.',
      'Конкурентное давление отмечено как среднее, чтобы показать логику упаковки и каналов.',
    ],
    keyRisks: [
      'Данные sample не являются реальными магнитами рядом с адресом.',
      'Доходный диапазон в примере нужен только для демонстрации формата вывода.',
    ],
  },
  overallScore: 74,
  scoreBreakdown: {
    demand_score: 76,
    supply_score: 61,
    magnet_score: 79,
    seasonality_score: 68,
    audience_fit_score: 72,
    accessibility_score: 81,
  },
  demandDrivers: [
    'Спрос вероятнее смешанный: краткосрочные поездки, деловые визиты и среднесрочное проживание.',
    'Транспортная доступность поддерживает гибридную стратегию, если объект хорошо упакован.',
    'Нужна валидация сезонности и актуальных цен по объектам-аналогам перед запуском.',
  ],
  primaryMagnets: [
    {
      categoryId: 'metro',
      name: 'Демо: крупный транспортный узел',
      distanceM: 420,
      impactLevel: 'primary',
      impactType: 'accessibility',
      explanation: 'Пример транспортного якоря; в реальном отчёте берётся из фактических OSM-сигналов.',
      source: 'demo',
    },
    {
      categoryId: 'business',
      name: 'Демо: деловой кластер',
      distanceM: 760,
      impactLevel: 'primary',
      impactType: 'demand_driver',
      explanation: 'Пример делового спроса; не является заявлением о реальном соседнем объекте.',
      source: 'demo',
    },
    {
      categoryId: 'university',
      name: 'Демо: образовательный кампус',
      distanceM: 980,
      impactLevel: 'primary',
      impactType: 'demand_driver',
      explanation: 'Пример среднесрочного и гостевого спроса, требующий проверки в реальном отчёте.',
      source: 'demo',
    },
  ],
  secondaryMagnets: [
    {
      categoryId: 'shopping_major',
      name: 'Демо: крупная торговая зона',
      distanceM: 1150,
      impactLevel: 'secondary',
      impactType: 'mixed',
      explanation: 'Контекстная зона спроса; в реальном отчёте её значимость зависит от масштаба и дистанции.',
      source: 'demo',
    },
  ],
  audienceFit: {
    primaryAudience: 'mixed',
    score: 72,
    audienceSharePct: 58,
    demandFlowLabel: 'смешанный устойчивый поток',
    drivers: [
      'Деловой и транспортный контекст в sample-структуре поддерживает гибридный сценарий.',
      'Туристический спрос не заявлен как основной без дополнительных подтверждений.',
    ],
    caveats: [
      'Для реального адреса нужно подтвердить качество объекта, входную группу, этаж, шум и состояние дома.',
    ],
    confidence: 'medium',
  },
  competition: {
    competitorCount: 14,
    pressureLevel: 'medium',
    visibleDataOnly: true,
    notes: [
      'Число в sample-отчёте демонстрационное.',
      'В реальном отчёте competition summary отражает доступные данные и может быть неполным.',
    ],
    confidence: 'medium',
  },
  incomePotential: {
    recommendedStrategy: 'hybrid',
    estimates: [
      {
        strategy: 'short_term',
        label: 'Посуточно',
        amountMonthly: null,
        rangeMonthly: { low: 140000, high: 190000 },
        currency: 'RUB',
        basis: 'sample',
      },
      {
        strategy: 'hybrid',
        label: 'Гибрид',
        amountMonthly: null,
        rangeMonthly: { low: 120000, high: 170000 },
        currency: 'RUB',
        basis: 'sample',
      },
      {
        strategy: 'mid_term',
        label: 'Среднесрок',
        amountMonthly: null,
        rangeMonthly: { low: 95000, high: 135000 },
        currency: 'RUB',
        basis: 'sample',
      },
    ],
    assumptions: [
      'Диапазоны sample показывают формат вывода, а не прогноз по реальному адресу.',
      'Фактическая оценка зависит от объекта, календаря, каналов, комиссий, сезона и качества управления.',
    ],
    limitations: [
      'Не является гарантией дохода.',
      'Не включает индивидуальные расходы собственника, ремонт, налоги и комиссии.',
    ],
    confidence: 'medium',
  },
  risks: [
    {
      title: 'Конкуренция может сжать маржу',
      severity: 'medium',
      description: 'При средней и высокой плотности объектов важны упаковка, отзывы, динамическая цена и каналы.',
      validationNeeded: 'Проверить актуальные аналоги, фото, цены, календарь и качество отзывов.',
      source: 'demo',
    },
    {
      title: 'Состояние объекта может изменить вывод',
      severity: 'high',
      description: 'Локация не компенсирует слабый ремонт, плохую шумоизоляцию или неудобный доступ.',
      validationNeeded: 'Добавить параметры объекта и провести ручной review.',
      source: 'demo',
    },
    {
      title: 'Открытые данные могут быть неполными',
      severity: 'medium',
      description: 'OSM не гарантирует полноту по всем POI и конкурентам.',
      validationNeeded: 'Сверить адрес с полевым осмотром и маркетплейсами.',
      source: 'demo',
    },
  ],
  recommendations: [
    {
      title: 'Проверить гибридную стратегию',
      priority: 'now',
      rationale: 'Sample-сигналы показывают баланс краткосрочного и среднесрочного спроса.',
      action: 'Сравнить календарь посуточной аренды с месячной ставкой и сезонными провалами.',
      confidence: 'medium',
    },
    {
      title: 'Собрать объектный контекст',
      priority: 'now',
      rationale: 'Без параметров объекта нельзя честно уточнять доходность.',
      action: 'Добавить площадь, планировку, ремонт, этаж, фото, ограничения дома и текущие расходы.',
      confidence: 'high',
    },
    {
      title: 'Подготовить каналовую стратегию',
      priority: 'next',
      rationale: 'При средней конкуренции канал продаж влияет на реализуемый доход.',
      action: 'Разделить OTA, прямые обращения и B2B/среднесрок, затем проверить economics по комиссиям.',
      confidence: 'medium',
    },
  ],
  otaChannelStrategyNote:
    'OTA-каналы полезны для старта и проверки спроса, но итоговая стратегия должна учитывать комиссии, повторные бронирования, прямые каналы и среднесрочные заявки.',
  nextSteps: [
    'Запустить быстрый preview по реальному адресу.',
    'Добавить параметры объекта и ограничения.',
    'Получить полный отчёт и PDF/печать для партнёров.',
  ],
  confidence: {
    level: 'medium',
    dataQuality: 'medium',
    reasons: [
      'Sample показывает структуру deliverable без утверждений о реальном адресе.',
      'В реальном отчёте confidence зависит от плотности OSM, геокодинга, конкурентов и объектного контекста.',
    ],
    limitations: [
      'Данные на этой странице демонстрационные.',
      'Нельзя использовать sample как инвестиционную рекомендацию.',
    ],
    sourceNotes: [
      'Demo data only',
      'Production reports should use persisted reportId and analysis outputs.',
    ],
  },
  sections: [
    { id: 'executive_summary', title: 'Executive summary' },
    { id: 'score_breakdown', title: 'Score breakdown' },
    { id: 'demand_drivers', title: 'Demand drivers' },
    { id: 'magnets', title: 'Primary and secondary magnets' },
    { id: 'audience_fit', title: 'Target audience fit' },
    { id: 'competition', title: 'Competition overview' },
    { id: 'income_potential', title: 'Income potential' },
    { id: 'urban_development_forecast', title: 'Urban development forecast' },
    { id: 'risks', title: 'Risks and limitations' },
    { id: 'recommended_strategy', title: 'Recommended strategy' },
    { id: 'next_steps', title: 'Next steps' },
  ],
  urbanDevelopmentForecast: {
    score: 78,
    level: 'high',
    confidence: 'medium',
    contributingSignalCount: 1,
    reasonsRu: [
      'Демо-сигнал инфраструктуры: подготовка к строительству и высокая географическая привязка усиливают ожидание изменений в окружении.',
      'Это иллюстрация слоя прогноза на fixture/sample данных, а не вывод по живым госисточникам.',
    ],
  },
};
