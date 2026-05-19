import type { LocationAnalysis, RecommendedStrategy } from './types';
import type { UnifiedLocationReport } from './unified-report';
import type {
  LocationStandaloneReport,
  StrLocationReportProjection,
} from './standalone-report';

/** Stable DOM anchors for paid-only premium sections (tests + TOC). */
export const PREMIUM_PAID_SECTION_ANCHORS = {
  executiveSummary: 'premium-executive-summary',
  audienceFit: 'premium-audience-fit',
  primeMagnets: 'premium-prime-magnets',
  competition: 'premium-competition',
  revenueScenarios: 'premium-revenue-scenarios',
  futureDevelopment: 'premium-future-development',
  risks: 'premium-risks',
  launchStrategy: 'premium-launch-strategy',
  finalRecommendation: 'premium-final-recommendation',
} as const;

export const PREMIUM_PAID_SECTION_TITLES_RU = {
  executiveSummary: 'Общий вывод по объекту',
  audienceFit: 'Кому подойдёт объект',
  primeMagnets: 'Магниты спроса рядом',
  competition: 'Конкуренция рядом',
  revenueScenarios: 'Доходность: осторожный / базовый / сильный сценарий',
  futureDevelopment: 'Будущее района и горизонт до 10 лет',
  risks: 'Риски объекта',
  launchStrategy: 'Рекомендации по запуску',
  finalRecommendation: 'Итоговое решение: брать / не брать / проверять глубже',
} as const;

export type PremiumRevenueScenarioId = 'cautious' | 'base' | 'strong';

export type PremiumRevenueScenario = {
  id: PremiumRevenueScenarioId;
  titleRu: string;
  occupancyLabelRu: string;
  nightlyRateLabelRu: string;
  monthlyRevenueLabelRu: string;
  conditionRu: string;
  ownerMeaningRu: string;
};

export type PremiumFutureDevelopmentItem = {
  text: string;
  isPlaceholder: boolean;
};

export type PremiumFutureDevelopmentSlot = {
  id: string;
  titleRu: string;
  items: PremiumFutureDevelopmentItem[];
  ownerMeaningRu: string;
};

export type PremiumPaidReportContent = {
  version: 'premium-paid-report-v1';
  executiveSummary: {
    headlineRu: string;
    bulletsRu: string[];
    ownerMeaningRu: string;
  };
  audienceFit: {
    suitableForRu: string[];
    explanationRu: string;
    ownerMeaningRu: string;
  };
  primeDemandMagnets: {
    primaryLinesRu: string[];
    secondaryLinesRu: string[];
    ownerMeaningRu: string;
  };
  competitionAnalysis: {
    competitorCount: number;
    pressureLabelRu: string;
    notesRu: string[];
    ownerMeaningRu: string;
  };
  revenueScenarios: PremiumRevenueScenario[];
  futureAreaDevelopment: {
    summaryRu: string;
    forecastScore: number | null;
    forecastLevelRu: string | null;
    slots: PremiumFutureDevelopmentSlot[];
    ownerMeaningRu: string;
  };
  risks: {
    itemsRu: string[];
    ownerMeaningRu: string;
  };
  launchStrategy: {
    stepsRu: string[];
    ownerMeaningRu: string;
  };
  finalRecommendation: {
    verdictRu: string;
    actionRu: string;
    ownerMeaningRu: string;
  };
};

function roundRub(n: number): number {
  return Math.max(0, Math.round(n / 500) * 500);
}

function fmtRub(n: number): string {
  return `${roundRub(n).toLocaleString('ru-RU')} ₽`;
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

function monthlyFromAdrOcc(adr: number, occupancyPct: number): number {
  return roundRub((adr * (occupancyPct / 100)) * 30);
}

function pressureLabelRu(level: 'low' | 'medium' | 'high'): string {
  if (level === 'low') return 'низкое';
  if (level === 'medium') return 'среднее';
  return 'высокое';
}

function urbanLevelRu(level: 'low' | 'moderate' | 'high' | 'very_high'): string {
  if (level === 'low') return 'низкий';
  if (level === 'moderate') return 'умеренный';
  if (level === 'high') return 'высокий';
  return 'очень высокий';
}

function strategyConditionRu(strategy: RecommendedStrategy | null, scenario: PremiumRevenueScenarioId): string {
  if (scenario === 'cautious') {
    return 'Сработает, если загрузка ниже среднего по району или объект ещё без отзывов.';
  }
  if (scenario === 'strong') {
    return 'Реалистичен при сильной упаковке, хороших отзывах и попадании в пик спроса.';
  }
  if (strategy === 'short_term') return 'Базовый сценарий при посуточной аренде и нормальной загрузке по району.';
  if (strategy === 'hybrid') return 'Базовый сценарий при гибриде: посуточно в сезон, среднесрок в межсезонье.';
  if (strategy === 'mid_term') return 'Базовый сценарий при среднесрочной аренде без ежедневной уборки.';
  return 'Базовый сценарий при текущем уровне спроса и конкуренции.';
}

function buildRevenueScenarios(args: {
  analysis: LocationAnalysis;
  incomeRecommended: number | null;
  strategy: RecommendedStrategy | null;
}): PremiumRevenueScenario[] {
  const score = args.analysis.locationScore;
  const adr = score?.income_model.base_adr_rub ?? null;
  const occ = score?.income_model.base_occupancy_pct ?? null;

  let baseAdr = adr;
  let baseOcc = occ;
  let baseMonthly = args.incomeRecommended;

  if ((baseMonthly == null || baseMonthly <= 0) && baseAdr != null && baseOcc != null) {
    baseMonthly = monthlyFromAdrOcc(baseAdr, baseOcc);
  }
  if ((baseAdr == null || baseAdr <= 0) && baseMonthly != null && baseOcc != null && baseOcc > 0) {
    baseAdr = roundRub(baseMonthly / (30 * (baseOcc / 100)));
  }
  if ((baseOcc == null || baseOcc <= 0) && baseMonthly != null && baseAdr != null && baseAdr > 0) {
    baseOcc = Math.min(95, Math.round((baseMonthly / (baseAdr * 30)) * 100));
  }
  if (baseMonthly != null && baseMonthly > 0 && (baseAdr == null || baseOcc == null)) {
    baseOcc = baseOcc ?? 55;
    baseAdr = baseAdr ?? roundRub(baseMonthly / (30 * (baseOcc / 100)));
  }

  const hasNumbers = baseMonthly != null && baseMonthly > 0 && baseAdr != null && baseOcc != null;

  const scenarios: Array<{ id: PremiumRevenueScenarioId; titleRu: string; occMul: number; adrMul: number }> = [
    { id: 'cautious', titleRu: 'Осторожный', occMul: 0.72, adrMul: 0.88 },
    { id: 'base', titleRu: 'Базовый', occMul: 1, adrMul: 1 },
    { id: 'strong', titleRu: 'Сильный', occMul: 1.1, adrMul: 1.14 },
  ];

  return scenarios.map(def => {
    if (!hasNumbers || baseAdr == null || baseOcc == null || baseMonthly == null) {
      return {
        id: def.id,
        titleRu: def.titleRu,
        occupancyLabelRu: 'уточняется',
        nightlyRateLabelRu: 'уточняется',
        monthlyRevenueLabelRu: 'уточняется',
        conditionRu: strategyConditionRu(args.strategy, def.id),
        ownerMeaningRu:
          def.id === 'cautious'
            ? 'Закладывайте запас: если старт пойдёт медленнее, объект всё ещё может выйти в ноль.'
            : def.id === 'strong'
              ? 'Верхняя граница — если всё сложится удачно; не планируйте бюджет только от неё.'
              : 'Ориентир для сравнения с арендой и вложениями до покупки или запуска.',
      };
    }

    const occVal = Math.min(95, Math.max(15, baseOcc * def.occMul));
    const adrVal = Math.max(500, baseAdr * def.adrMul);
    const monthly = monthlyFromAdrOcc(adrVal, occVal);

    return {
      id: def.id,
      titleRu: def.titleRu,
      occupancyLabelRu: fmtPct(occVal),
      nightlyRateLabelRu: fmtRub(adrVal),
      monthlyRevenueLabelRu: `${fmtRub(monthly)} / мес`,
      conditionRu: strategyConditionRu(args.strategy, def.id),
      ownerMeaningRu:
        def.id === 'cautious'
          ? 'Нижняя планка: полезна для расчёта «хватит ли объекта пережить слабый старт».'
          : def.id === 'strong'
            ? 'Верхняя планка при удачном запуске — не считайте её гарантией.'
            : 'Рабочий ориентир: сравните с арендой, налогами и расходами на подготовку.',
    };
  });
}

const FUTURE_SLOT_DEFS: Array<{ id: string; titleRu: string; ownerMeaningRu: string }> = [
  {
    id: 'residentialComplexes',
    titleRu: 'Строящиеся ЖК',
    ownerMeaningRu: 'Новые дома рядом могут добавить арендаторов и гостей, но и конкуренцию — следите за сроками сдачи.',
  },
  {
    id: 'roadsJunctions',
    titleRu: 'Новые дороги и развязки',
    ownerMeaningRu: 'Удобный выезд часто поднимает привлекательность; шум у магистрали — наоборот.',
  },
  {
    id: 'socialInfra',
    titleRu: 'Школы, медицина, социнфраструктура',
    ownerMeaningRu: 'Социальные объекты тянут семейный и длительный спрос — полезно для среднесрока и «тихого» STR.',
  },
  {
    id: 'businessClusters',
    titleRu: 'Деловые кластеры',
    ownerMeaningRu: 'Офисы и деловые центры поддерживают командировки и будничную загрузку.',
  },
  {
    id: 'transportChanges',
    titleRu: 'Транспортные изменения',
    ownerMeaningRu: 'Метро, вокзалы и хабы напрямую влияют на то, кто будет бронировать жильё рядом.',
  },
  {
    id: 'procurementEarly',
    titleRu: 'Госзакупки и ранние признаки развития',
    ownerMeaningRu: 'Закупки на проектирование и стройку — ранний сигнал, что район могут менять в ближайшие годы.',
  },
];

const PLACEHOLDER_SLOT_LINE = 'Пока нет подтверждённых данных по этому блоку — отметим, когда появятся источники.';

function slotItems(lines: string[]): PremiumFutureDevelopmentItem[] {
  const cleaned = lines.map(l => l.trim()).filter(Boolean);
  if (!cleaned.length) {
    return [{ text: PLACEHOLDER_SLOT_LINE, isPlaceholder: true }];
  }
  return cleaned.map(text => ({ text, isPlaceholder: false }));
}

function buildFutureDevelopmentSlots(
  unified: UnifiedLocationReport | undefined,
  str: StrLocationReportProjection | undefined,
): PremiumFutureDevelopmentSlot[] {
  const urban = unified?.signals?.urbanDevelopment;
  const forecast = unified?.urbanDevelopmentForecastScore;

  const forecastReasons = forecast?.reasonsRu ?? [];

  const residentialComplexes = [
    ...(urban?.plannedConstructionProjects ?? [])
      .filter(p => p.category === 'residential' || p.category === 'mixed_use' || p.category === 'unknown')
      .map(p => p.title),
    ...forecastReasons.filter(line => /жил|квартал|жк|дом|застрой/i.test(line)),
  ];

  const roadsJunctions = [
    ...(urban?.roadTransportChanges ?? []).map(p => p.title),
    ...(urban?.infrastructurePlans ?? [])
      .filter(p => p.kind === 'road' || p.kind === 'rail' || p.kind === 'public_transport')
      .map(p => p.title),
    ...forecastReasons.filter(line => /дорог|развяз|магистрал/i.test(line)),
  ];

  const socialInfra = [
    ...(urban?.plannedConstructionProjects ?? [])
      .filter(p => p.category === 'public_space')
      .map(p => p.title),
    ...(str?.signalGroups.medicalUniversityTourismLocalRu ?? []).filter(line =>
      /школ|больниц|поликлин|университет|колледж|детск/i.test(line),
    ),
  ];

  const businessClusters = [...(str?.signalGroups.businessCorporateRu ?? [])];

  const transportChanges = [
    ...(str?.signalGroups.transportRu ?? []),
    ...(urban?.infrastructurePlans ?? [])
      .filter(p => p.kind === 'public_transport' || p.kind === 'rail')
      .map(p => p.title),
    ...forecastReasons.filter(line => /метро|вокзал|транспорт|хаб/i.test(line)),
  ];

  const procurementEarly = [
    ...forecastReasons.filter(line => /закупк|госзаказ|проектир|изыскан|тендер/i.test(line)),
    ...(forecast?.contributingSignals ?? [])
      .filter(s => s.kind === 'publicProcurement')
      .map(s => `Сигнал госзакупки (${s.signalType})`),
  ];

  const byId: Record<string, string[]> = {
    residentialComplexes,
    roadsJunctions,
    socialInfra,
    businessClusters,
    transportChanges,
    procurementEarly,
  };

  return FUTURE_SLOT_DEFS.map(def => ({
    id: def.id,
    titleRu: def.titleRu,
    ownerMeaningRu: def.ownerMeaningRu,
    items: slotItems(byId[def.id] ?? []).slice(0, 4),
  }));
}

function magnetLinesFromReport(report: LocationStandaloneReport): { primary: string[]; secondary: string[] } {
  const magnets = report.sections.find(s => s.id === 'magnets');
  if (!magnets || magnets.id !== 'magnets') {
    return { primary: [], secondary: [] };
  }
  const fmt = (name: string, dist: number, cat?: string) => {
    const d = dist < 1000 ? `${dist} м` : `${(dist / 1000).toFixed(1)} км`;
    return cat ? `${name} · ${cat} · ${d}` : `${name} · ${d}`;
  };
  return {
    primary: magnets.primary.map(m => fmt(m.name, m.distance_m, m.category_label_ru)),
    secondary: magnets.secondary.map(m => fmt(m.name, m.distance_m, m.category_label_ru)),
  };
}

export function buildPremiumPaidReportContent(args: {
  report: LocationStandaloneReport;
  analysis?: LocationAnalysis;
  strReport: StrLocationReportProjection;
}): PremiumPaidReportContent {
  const { report, strReport: str } = args;
  const summary = report.sections.find(s => s.id === 'summary');
  const competition = report.sections.find(s => s.id === 'competition');
  const income = report.sections.find(s => s.id === 'income_strategy');
  const unified = report.unifiedReport;
  const forecast = unified?.urbanDevelopmentForecastScore;

  const verdict =
    summary?.id === 'summary' ? summary.verdict : 'Вывод по локации сформирован по открытым данным.';
  const drivers =
    summary?.id === 'summary' && summary.drivers.length
      ? summary.drivers.slice(0, 3)
      : str.executiveConclusionRu
        ? [str.executiveConclusionRu]
        : [];

  const magnetLines = magnetLinesFromReport(report);
  const competitorCount =
    competition?.id === 'competition' ? competition.competitor_count : str.competitionOta.competitorCount;
  const pressure =
    competition?.id === 'competition' ? competition.pressure_level : str.competitionOta.pressureLevel;

  const recommended =
    income?.id === 'income_strategy' ? income.recommended_strategy : str.monetization.strategy;
  const incomeRecommended =
    summary?.id === 'summary'
      ? summary.income_rub_month
      : income?.id === 'income_strategy' && recommended
        ? income.monthly_income_rub[recommended]
        : str.monetization.monthlyIncomeRangeRub
          ? Math.round((str.monetization.monthlyIncomeRangeRub.low + str.monetization.monthlyIncomeRangeRub.high) / 2)
          : null;

  const analysis = args.analysis;
  const revenueScenarios = buildRevenueScenarios({
    analysis: analysis ?? ({} as LocationAnalysis),
    incomeRecommended,
    strategy: recommended ?? null,
  });

  const futureSlots = buildFutureDevelopmentSlots(unified, str);
  const hasLiveFutureSignals = futureSlots.some(slot => slot.items.some(item => !item.isPlaceholder));

  const launchSteps = uniqueLines([
    str.monetization.notesRu[0] ?? null,
    str.competitionOta.notesRu[0] ?? null,
    recommended
      ? `Зафиксируйте тестовый период 4–6 недель для сценария «${recommended === 'short_term' ? 'посуточно' : recommended === 'hybrid' ? 'гибрид' : 'среднесрок'}».`
      : 'Зафиксируйте тестовый период 4–6 недель и сравните факт с прогнозом.',
    'Соберите 3–5 конкурентов на площадках бронирования и задайте стартовую цену.',
    'Подготовьте фото, описание и правила для гостей до первого бронирования.',
  ]).slice(0, 4);

  const finalVerdict = str.executiveConclusionRu || verdict;
  const finalAction =
    str.recommendation === 'good'
      ? 'Можно переходить к подготовке объекта и тестовому запуску, если ручные проверки из списка рисков закрыты.'
      : str.recommendation === 'conditional'
        ? 'Запускайте только после проверки конкурентов, цены и ограничений дома — сначала осторожный сценарий дохода.'
        : 'Не вкладывайтесь в массовую посуточку без ниши, сильного объекта или запасного сценария (среднесрок / долгий горизонт).';

  return {
    version: 'premium-paid-report-v1',
    executiveSummary: {
      headlineRu: `${str.recommendationLabelRu.charAt(0).toUpperCase()}${str.recommendationLabelRu.slice(1)}.`,
      bulletsRu: uniqueLines([
        finalVerdict,
        ...drivers,
        str.audienceFit.explanationRu,
      ]).slice(0, 4),
      ownerMeaningRu:
        'Это главный ответ: стоит ли тратить время и деньги на этот адрес в посуточной или гибридной модели.',
    },
    audienceFit: {
      suitableForRu: str.audienceFit.suitableForRu,
      explanationRu: str.audienceFit.explanationRu,
      ownerMeaningRu:
        'Показывает, под какую аудиторию упаковывать объявление, фото и сервис — иначе конкуренты заберут нужный спрос.',
    },
    primeDemandMagnets: {
      primaryLinesRu: magnetLines.primary.length
        ? magnetLines.primary
        : str.signalGroups.medicalUniversityTourismLocalRu.slice(0, 3),
      secondaryLinesRu: magnetLines.secondary,
      ownerMeaningRu:
        'Магниты — причины, по которым люди вообще ищут жильё в этом месте. Без них придётся покупать спрос рекламой.',
    },
    competitionAnalysis: {
      competitorCount,
      pressureLabelRu: pressureLabelRu(pressure),
      notesRu: str.competitionOta.notesRu,
      ownerMeaningRu:
        'Чем выше давление, тем важнее цена, отзывы и отличие от соседей — иначе маржа уйдёт в борьбу за бронирование.',
    },
    revenueScenarios,
    futureAreaDevelopment: {
      summaryRu: hasLiveFutureSignals
        ? 'ASI смотрит не только на то, что есть рядом сейчас, но и на горизонт развития до 10 лет: стройки, дороги, транспорт, госзакупки, деловая активность и ранние признаки роста территории.'
        : 'ASI смотрит не только на то, что есть рядом сейчас, но и на горизонт развития до 10 лет: стройки, дороги, транспорт, госзакупки, деловая активность и ранние признаки роста территории. Ниже — блоки, куда будут попадать ЖК, дороги, соцобъекты и ранние закупки по мере появления данных.',
      forecastScore: forecast?.score ?? null,
      forecastLevelRu: forecast ? urbanLevelRu(forecast.level) : null,
      slots: futureSlots,
      ownerMeaningRu:
        'Важно для покупки жилья, покупки коммерческой недвижимости, аренды помещения и выбора стратегии: видно, может ли локация стать сильнее или слабее со временем.',
    },
    risks: {
      itemsRu: str.risksAndManualChecksRu,
      ownerMeaningRu:
        'Список того, что модель не видит сама: дом, соседи, сезон, юридические ограничения — проверьте до вложений.',
    },
    launchStrategy: {
      stepsRu: launchSteps,
      ownerMeaningRu:
        'Пошаговый маршрут: что сделать в первые недели, чтобы не запускаться вслепую.',
    },
    finalRecommendation: {
      verdictRu: finalVerdict,
      actionRu: finalAction,
      ownerMeaningRu:
        'Финальный ответ «делать / не делать / делать осторожно» с учётом спроса, конкуренции и рисков.',
    },
  };
}

function uniqueLines(lines: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const t = line?.replace(/\s+/g, ' ').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function listPremiumPaidSectionAnchorIds(): string[] {
  return Object.values(PREMIUM_PAID_SECTION_ANCHORS);
}
