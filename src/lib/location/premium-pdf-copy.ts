/** Static RU labels for premium PDF layout (separate from scoring data). */

export const PREMIUM_PDF_BRAND = 'ASI · Анализ локации';

export const PREMIUM_PDF_COVER = {
  title: 'Отчёт по посуточной аренде',
  subtitle: 'Аналитика локации для решения о запуске',
  reportKindPaid: 'Полный отчёт',
  reportKindFree: 'Краткий обзор',
} as const;

export const PREMIUM_PDF_PAGES = {
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
  },
} as const;

export const PREMIUM_PDF_SCORE_DIMENSION_LABELS: Record<string, string> = {
  demand_score: 'Спрос',
  supply_score: 'Предложение и конкуренция',
  magnet_score: 'Точки притяжения',
  seasonality_score: 'Сезонность',
  audience_fit_score: 'Аудитория',
  accessibility_score: 'Транспорт',
};

export const PLACEHOLDER_BADGE_RU = 'Заглушка';
