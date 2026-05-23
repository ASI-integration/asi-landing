/** Static RU labels for premium PDF layout (separate from scoring data). */

export const PREMIUM_PDF_BRAND = 'ASI · Анализ локации';

export const PREMIUM_PDF_COVER = {
  title: 'Отчёт по посуточной аренде',
  subtitle: 'Аналитика локации для решения о запуске',
  reportKindPaid: 'Полный отчёт',
  reportKindFree: 'Краткий обзор',
  disclaimerRu:
    'Оценки и прогнозы основаны на открытых данных и модели ASI. Перед запуском проверьте объект, дом и конкурентов на месте — отчёт не заменяет юридическую и финансовую экспертизу.',
} as const;

export const PREMIUM_PDF_PAGES = {
  summary: {
    eyebrow: 'Кратко',
    title: 'Итог по объекту',
    conclusionTitle: 'Общий вывод',
    strengthsTitle: 'Сильные стороны локации',
    risksTitle: 'Главные риски',
    audienceTitle: 'Кому подойдёт объект',
  },
  transport: {
    eyebrow: 'Доступность',
    title: 'Транспорт и выезд',
    linesTitle: 'Что важно для гостей',
    balanceTitle: 'Баланс района',
  },
  magnets: {
    eyebrow: 'Спрос',
    title: 'Магниты рядом',
    primaryTitle: 'Главные точки притяжения',
    secondaryTitle: 'Дополнительно рядом',
  },
  demand: {
    eyebrow: 'Аудитория',
    title: 'Спрос и гости',
    explanationTitle: 'Кто будет бронировать',
    segmentsTitle: 'Подходящие сегменты',
    incomeTitle: 'Ориентир по доходу',
    strategyTitle: 'Рекомендуемый сценарий',
  },
  verdict: {
    eyebrow: 'Главный вывод',
    title: 'Вердикт по локации',
    driversTitle: 'Что поддерживает спрос',
    audienceTitle: 'Кому подходит',
    incomeTitle: 'Ориентир по доходу',
    strategyTitle: 'Рекомендуемый сценарий',
  },
  score: {
    eyebrow: 'Оценка локации',
    title: 'Балл и сильные стороны',
    overallLabel: 'Итоговый балл',
    dimensionsTitle: 'Из чего складывается оценка',
    competitionTitle: 'Конкуренция рядом',
  },
  urban: {
    eyebrow: 'Развитие района',
    title: 'Что может измениться вокруг',
    forecastLabel: 'Индикатор развития',
    levelLabel: 'Ожидаемый эффект',
    signalsLabel: 'Подтверждённых сигналов',
    reasonsTitle: 'На что опирается прогноз',
  },
  risks: {
    eyebrow: 'Запуск',
    title: 'Риски и следующий шаг',
    risksTitle: 'Что проверить до старта',
    launchTitle: 'Рекомендация по запуску',
    confidenceTitle: 'Уверенность вывода',
    recommendationsTitle: 'Итоговое решение',
    stepsTitle: 'Шаги на ближайшие недели',
  },
} as const;

/** Fixed page count for premium PDF (cover → summary → sections → risks). */
export const PREMIUM_PDF_PAGE_COUNT = 8;

export const PREMIUM_PDF_SCORE_DIMENSION_LABELS: Record<string, string> = {
  demand_score: 'Спрос',
  supply_score: 'Предложение и конкуренция',
  magnet_score: 'Точки притяжения',
  seasonality_score: 'Сезонность',
  audience_fit_score: 'Аудитория',
  accessibility_score: 'Транспорт',
};

export const PLACEHOLDER_BADGE_RU = 'Заглушка';
