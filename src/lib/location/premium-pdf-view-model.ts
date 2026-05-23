import { URBAN_DEVELOPMENT_LIVE_SOURCES_DISCLAIMER_RU } from './report-contract';
import { PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU } from './location-report-engine';
import type { GeneratedLocationReportDocument } from './location-report-engine';
import type { LocationStandaloneReport, StrLocationReportProjection } from './standalone-report';
import type { LocationScoreBreakdown } from './types';
import { PREMIUM_PDF_SCORE_DIMENSION_LABELS } from './premium-pdf-copy';
import type { PremiumFutureDevelopmentSlot, PremiumRevenueScenario } from './premium-paid-report-content';
import { buildPremiumPaidReportContent } from './premium-paid-report-content';

export type PremiumPdfTextField = {
  value: string;
  isPlaceholder: boolean;
};

export type PremiumPdfNumberField = {
  value: number;
  isPlaceholder: boolean;
};

export type PremiumPdfScoreDimension = {
  id: string;
  labelRu: string;
  score: number;
  isPlaceholder: boolean;
};

export type PremiumPdfViewModel = {
  reportId: string;
  reportMode: 'free' | 'paid';
  address: string;
  calculatedAtRu: string;
  cover: {
    title: string;
    subtitle: string;
    reportKindLabel: string;
  };
  verdict: {
    headline: PremiumPdfTextField;
    recommendationLabel: PremiumPdfTextField;
    drivers: PremiumPdfTextField[];
    audienceSummary: PremiumPdfTextField;
    audienceBullets: PremiumPdfTextField[];
    monthlyIncomeLabel: PremiumPdfTextField;
    strategyLabel: PremiumPdfTextField;
  };
  score: {
    overall: PremiumPdfNumberField;
    dimensions: PremiumPdfScoreDimension[];
    competitionPressure: PremiumPdfTextField;
    competitorCount: PremiumPdfNumberField;
  };
  urban: {
    forecastScore: PremiumPdfNumberField;
    levelLabel: PremiumPdfTextField;
    confidenceLabel: PremiumPdfTextField;
    signalCount: PremiumPdfNumberField;
    reasons: PremiumPdfTextField[];
    disclaimerRu: string | null;
    showLiveSourcesDisclaimer: boolean;
  };
  risks: {
    items: PremiumPdfTextField[];
    launchRecommendation: PremiumPdfTextField;
    launchSteps: PremiumPdfTextField[];
    confidenceLabel: PremiumPdfTextField;
    confidenceNotes: PremiumPdfTextField[];
  };
  revenueScenarios: PremiumRevenueScenario[];
  futureDevelopmentSlots: PremiumFutureDevelopmentSlot[];
  finalRecommendation: PremiumPdfTextField;
  location: {
    coordinatesLabel: PremiumPdfTextField | null;
    mapUnavailableNotice: PremiumPdfTextField | null;
  };
};

function textField(value: string | null | undefined, placeholder: string): PremiumPdfTextField {
  if (!value?.trim()) return { value: placeholder, isPlaceholder: true };
  return { value: value.trim(), isPlaceholder: false };
}

function numberField(value: number | null | undefined, placeholder: number): PremiumPdfNumberField {
  if (value == null || !Number.isFinite(value)) {
    return { value: placeholder, isPlaceholder: true };
  }
  return { value, isPlaceholder: false };
}

function listField(values: string[] | undefined, placeholders: string[]): PremiumPdfTextField[] {
  const cleaned = (values ?? []).map(v => v.trim()).filter(Boolean);
  if (cleaned.length) {
    return cleaned.map(value => ({ value, isPlaceholder: false }));
  }
  return placeholders.map(value => ({ value, isPlaceholder: true }));
}

function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pickSummary(report: LocationStandaloneReport) {
  const summary = report.sections.find(s => s.id === 'summary');
  return summary?.id === 'summary' ? summary : null;
}

function strategyLabelRu(strategy: string | null | undefined): string | null {
  if (strategy === 'short_term') return 'Посуточная аренда';
  if (strategy === 'hybrid') return 'Гибрид: посуточно + среднесрок';
  if (strategy === 'mid_term') return 'Среднесрочная аренда';
  if (strategy === 'selective_premium_short_term') return 'Избирательная посуточная аренда';
  return strategy ?? null;
}

function pressureLabelRu(level: string | null | undefined): string | null {
  if (level === 'low') return 'Низкое';
  if (level === 'medium') return 'Среднее';
  if (level === 'high') return 'Высокое';
  return null;
}

function urbanLevelRu(level: string | null | undefined): string | null {
  if (level === 'low') return 'Низкий';
  if (level === 'moderate') return 'Умеренный';
  if (level === 'high') return 'Высокий';
  if (level === 'very_high') return 'Очень высокий';
  return null;
}

function urbanConfidenceRu(level: string | null | undefined): string | null {
  if (level === 'high') return 'Высокая';
  if (level === 'medium') return 'Средняя';
  if (level === 'low') return 'Низкая';
  return null;
}

function confidenceLabelRu(level: string | null | undefined): string | null {
  if (level === 'high') return 'Высокая';
  if (level === 'medium') return 'Средняя';
  if (level === 'low') return 'Низкая';
  return null;
}

function buildScoreDimensions(
  breakdown: Partial<LocationScoreBreakdown> | null | undefined,
): PremiumPdfScoreDimension[] {
  const keys = Object.keys(PREMIUM_PDF_SCORE_DIMENSION_LABELS) as (keyof LocationScoreBreakdown)[];
  const rows: PremiumPdfScoreDimension[] = [];

  for (const id of keys) {
    const raw = breakdown?.[id];
    const hasValue = typeof raw === 'number' && Number.isFinite(raw);
    rows.push({
      id,
      labelRu: PREMIUM_PDF_SCORE_DIMENSION_LABELS[id] ?? id,
      score: hasValue ? Math.round(raw) : 0,
      isPlaceholder: !hasValue,
    });
  }

  return rows;
}

function launchStepsFromStr(str: StrLocationReportProjection | undefined): string[] {
  if (!str) return [];
  const steps: string[] = [];
  if (str.monetization.strategy) {
    steps.push(`Сфокусироваться на сценарии: ${strategyLabelRu(str.monetization.strategy) ?? str.monetization.strategy}.`);
  }
  if (str.monetization.notesRu[0]) steps.push(str.monetization.notesRu[0]);
  if (str.competitionOta.notesRu[0]) steps.push(str.competitionOta.notesRu[0]);
  return steps.slice(0, 3);
}

export function buildPremiumPdfViewModel(doc: GeneratedLocationReportDocument): PremiumPdfViewModel {
  const report = doc.persistedReport;
  const standalone = report.version === 'v1' ? (report as LocationStandaloneReport) : null;
  const str = standalone?.strReport;
  const summary = standalone ? pickSummary(standalone) : null;
  const unified = standalone?.unifiedReport;
  const urban = unified?.urbanDevelopmentForecastScore;
  const urbanNoLiveData =
    urban != null && urban.score === 0 && (urban.contributingSignals?.length ?? 0) === 0;

  const overallScore =
    str?.suitabilityScore ??
    unified?.overallScore ??
    doc.freeSummary.publicScore ??
    null;

  const competitionSection = standalone?.sections.find(s => s.id === 'competition');
  const competition =
    competitionSection?.id === 'competition'
      ? competitionSection
      : str
        ? { competitor_count: str.competitionOta.competitorCount, pressure_level: str.competitionOta.pressureLevel }
        : null;

  const incomeRub =
    summary?.income_rub_month ??
    str?.monetization.monthlyIncomeRangeRub?.high ??
    null;

  const monthlyIncomeLabel =
    incomeRub != null
      ? `≈ ${Math.round(incomeRub).toLocaleString('ru-RU')} ₽ / мес (оценка)`
      : str?.monetization.monthlyIncomeRangeRub
        ? `${Math.round(str.monetization.monthlyIncomeRangeRub.low).toLocaleString('ru-RU')}–${Math.round(str.monetization.monthlyIncomeRangeRub.high).toLocaleString('ru-RU')} ₽ / мес`
        : null;

  const launchRecommendation =
    str?.executiveConclusionRu ??
    doc.freeSummary.recommendationRu ??
    summary?.verdict ??
    null;

  const premiumPaid =
    standalone?.premiumPaidReport ??
    (standalone && str
      ? buildPremiumPaidReportContent({ report: standalone, strReport: str })
      : null);

  const reportMeta = standalone?.metadata;
  const coordinates = reportMeta?.coordinates;
  const coordinatesLabel =
    coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lon)
      ? `${coordinates.lat.toFixed(5)}, ${coordinates.lon.toFixed(5)}`
      : null;
  const mapUnavailable =
    reportMeta?.mapDisplay === 'unavailable'
    || (reportMeta?.providerWarningsRu?.length ?? 0) > 0;

  return {
    reportId: doc.reportId,
    reportMode: doc.reportMode,
    address: doc.inputAddress,
    calculatedAtRu: formatDateRu(doc.calculatedAt),
    cover: {
      title: 'Отчёт по посуточной аренде',
      subtitle: 'Аналитика локации для решения о запуске',
      reportKindLabel: doc.reportMode === 'paid' ? 'Полный отчёт' : 'Краткий обзор',
    },
    verdict: {
      headline: textField(
        str?.executiveConclusionRu ?? summary?.verdict ?? doc.freeSummary.conclusionRu,
        'Здесь будет главный вывод по локации после подключения полного расчёта.',
      ),
      recommendationLabel: textField(
        str?.recommendationLabelRu ?? null,
        'Предварительная оценка — уточните после проверки объекта',
      ),
      drivers: listField(
        summary?.drivers ?? doc.freeSummary.keyFactorsRu,
        [
          'Рядом есть транспорт или удобный выезд',
          'Смешанный спрос: гости разных сценариев',
          'Инфраструктура поддерживает краткосрочное размещение',
        ],
      ).slice(0, 3),
      audienceSummary: textField(
        str?.audienceFit.explanationRu ?? null,
        'Аудитория и сценарии гостей будут показаны здесь.',
      ),
      audienceBullets: listField(str?.audienceFit.suitableForRu, ['Командированные', 'Туристы', 'Семьи']).slice(0, 4),
      monthlyIncomeLabel: textField(monthlyIncomeLabel, 'Диапазон дохода появится после расчёта'),
      strategyLabel: textField(
        strategyLabelRu(summary?.recommended_strategy ?? str?.monetization.strategy ?? null),
        'Сценарий монетизации уточняется',
      ),
    },
    score: {
      overall: numberField(overallScore, 0),
      dimensions: buildScoreDimensions(unified?.scoreBreakdown ?? null),
      competitionPressure: textField(
        pressureLabelRu(
          competition && 'pressure_level' in competition ? competition.pressure_level : null,
        ),
        'Среднее',
      ),
      competitorCount: numberField(
        competition && 'competitor_count' in competition ? competition.competitor_count : null,
        0,
      ),
    },
    urban: {
      forecastScore: numberField(urban?.score ?? null, 0),
      levelLabel: textField(urbanLevelRu(urban?.level), 'Низкий'),
      confidenceLabel: textField(urbanConfidenceRu(urban?.confidence), 'Низкая'),
      signalCount: numberField(urban?.contributingSignals?.length ?? null, 0),
      reasons: listField(urban?.reasonsRu, [
        'Пока нет подключённых сигналов градостроительного развития для этого адреса.',
      ]),
      disclaimerRu: urbanNoLiveData ? URBAN_DEVELOPMENT_LIVE_SOURCES_DISCLAIMER_RU : null,
      showLiveSourcesDisclaimer: urbanNoLiveData,
    },
    risks: {
      items: listField(str?.risksAndManualChecksRu ?? doc.freeSummary.risksAndLimitsRu, [
        'Сравнить цены и загрузку похожих объектов на площадках бронирования',
        'Проверить правила дома, шум и подъезд для гостей',
        'Оценить сезонность и запасной сценарий на низкий сезон',
      ]).slice(0, 5),
      launchRecommendation: textField(
        launchRecommendation,
        'Сначала подтвердите спрос и конкуренцию, затем выберите сценарий запуска и тестовый период на 4–6 недель.',
      ),
      launchSteps: listField(launchStepsFromStr(str), [
        'Собрать 3–5 конкурентов и зафиксировать цену входа',
        'Подготовить фото, описание и правила для гостей',
        'Запустить тестовый период и сверить факт с прогнозом',
      ]),
      confidenceLabel: textField(confidenceLabelRu(str?.confidence.level), 'Средняя'),
      confidenceNotes: listField(str?.confidence.reasonsRu, [
        'Вывод основан на открытых данных; перед решением нужна ручная проверка.',
      ]).slice(0, 3),
    },
    revenueScenarios: premiumPaid?.revenueScenarios ?? [],
    futureDevelopmentSlots: premiumPaid?.futureAreaDevelopment.slots ?? [],
    finalRecommendation: textField(
      premiumPaid?.finalRecommendation.actionRu ?? launchRecommendation,
      'Сначала подтвердите спрос и конкуренцию, затем выберите сценарий запуска.',
    ),
    location: {
      coordinatesLabel: coordinatesLabel
        ? textField(coordinatesLabel, '—')
        : null,
      mapUnavailableNotice: mapUnavailable
        ? textField(
            reportMeta?.providerWarningsRu?.[0] ?? PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU,
            PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU,
          )
        : null,
    },
  };
}
