/**
 * RU-only copy for the polished demo result blocks.
 * These blocks are intentionally not bilingual — they replace internal-signal
 * views with market-facing trust copy on the /ru/location-analysis route.
 *
 * Kept in a pure .ts file (no JSX) so it can be imported by Vitest tests.
 */
export const RU_DEMO_COPY = {
  demoScoreLabel: 'Демо-оценка',

  marketEnvironmentTitle: 'Рыночное окружение',
  competitionLevelLabel: 'Уровень конкуренции',
  nearbyObjectsLabel: 'Объектов рядом',
  demandStabilityLabel: 'Устойчивость спроса',
  locationIndexLabel: 'Индекс локации',
  // TODO(future): hotel/open-market evidence provider — integrate Ostrovok/YandexTravel here when available
  // TODO(future): competitor price range provider — source attribution for full report
  marketEnvironmentNote:
    'Демо-оценка использует доступные рыночные сигналы. В полном отчёте ASI дополнительно проверяет гостиницы, объекты краткосрочного размещения и открытые ценовые ориентиры вокруг локации.',

  premiumTrustTitle: 'Не просто сравнение с соседями',
  premiumTrustBody:
    'Большинство оценок смотрит на цены рядом. ASI оценивает способность локации создавать спрос: кто будет жить, почему именно здесь, насколько поток устойчив и как конкуренция влияет на доход. Внешне это выглядит как простая оценка, внутри работает более глубокая модель рынка.',

  scoreExplanationTitle: 'Как рассчитана оценка',
  scoreExplanationBody:
    'Оценка основана на открытых рыночных сигналах: видимых ценах конкурентов, плотности объектов размещения, типе района, транспортной доступности и профиле спроса. Внутренняя модель дополнительно учитывает устойчивость спроса и качество локации.',

  revenueTitle: 'Оценка дохода',
  revenueDisclaimer:
    'Это ориентировочная демо-оценка, не гарантия дохода. Точный результат зависит от объекта, управления, сезона, цены и качества размещения.',
} as const;
