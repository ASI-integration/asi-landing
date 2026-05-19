export type LocationReportStructureMode = 'free' | 'paid';

/** Customer-facing report chapters: housing / STR vs street-retail commercial. */
export type LocationReportSegmentId = 'residential_investment' | 'commercial_retail';
export type PublicPaidReportFeatureGroupId =
  | 'real_estate_rentals'
  | 'commercial_retail'
  | 'future_10_years';
export type PublicPaidReportFeatureVisualKind =
  | 'score'
  | 'audience'
  | 'map'
  | 'bars'
  | 'income'
  | 'risk'
  | 'plan'
  | 'timeline'
  | 'traffic'
  | 'storefront';

export const RESIDENTIAL_REPORT_SEGMENT_BADGE_RU = 'Подходит для недвижимости';
export const COMMERCIAL_REPORT_SEGMENT_BADGE_RU = 'Подходит для коммерции и ритейла';

export const RESIDENTIAL_REPORT_SEGMENT_INTRO_RU =
  'Эта часть показывает, насколько локация подходит для жилья, посуточной аренды и инвестиций. ASI смотрит на спрос, аудиторию, конкуренцию, доходность и развитие района на горизонте до 10 лет.';

export const COMMERCIAL_REPORT_SEGMENT_INTRO_RU =
  'Эта часть нужна для коммерческих помещений. Здесь ASI оценивает не просто район, а поток перед объектом: первая линия, вход с улицы, видимость, барьеры и подходит ли место под конкретный формат бизнеса.';

export const RESIDENTIAL_REPORT_GROUP_TITLE_RU = 'Недвижимость и аренда';
export const COMMERCIAL_REPORT_GROUP_TITLE_RU = 'Коммерция и ритейл';
export const FUTURE_REPORT_GROUP_TITLE_RU = 'Будущее района до 10 лет';

export const PUBLIC_PAID_REPORT_FEATURE_GROUPS: readonly {
  id: PublicPaidReportFeatureGroupId;
  titleRu: string;
  introRu: string;
}[] = [
  {
    id: 'real_estate_rentals',
    titleRu: RESIDENTIAL_REPORT_GROUP_TITLE_RU,
    introRu: 'Спрос на проживание, аудитории, доходность, конкуренция, риски и рекомендации.',
  },
  {
    id: 'commercial_retail',
    titleRu: COMMERCIAL_REPORT_GROUP_TITLE_RU,
    introRu: 'Коммерческий потенциал, целевой трафик, первая линия, вход и подходящие форматы бизнеса.',
  },
  {
    id: 'future_10_years',
    titleRu: FUTURE_REPORT_GROUP_TITLE_RU,
    introRu: 'Стройки, дороги, транспорт, госзакупки и ранние признаки роста территории.',
  },
] as const;

export interface LocationReportStructureSegmentGroup {
  id: LocationReportSegmentId;
  titleRu: string;
  badgeRu: string;
  introRu: string;
  sectionIds: readonly string[];
}

export const LOCATION_REPORT_SEGMENT_GROUPS: readonly Omit<
  LocationReportStructureSegmentGroup,
  'sectionIds'
>[] = [
  {
    id: 'residential_investment',
    titleRu: RESIDENTIAL_REPORT_GROUP_TITLE_RU,
    badgeRu: RESIDENTIAL_REPORT_SEGMENT_BADGE_RU,
    introRu: RESIDENTIAL_REPORT_SEGMENT_INTRO_RU,
  },
  {
    id: 'commercial_retail',
    titleRu: COMMERCIAL_REPORT_GROUP_TITLE_RU,
    badgeRu: COMMERCIAL_REPORT_SEGMENT_BADGE_RU,
    introRu: COMMERCIAL_REPORT_SEGMENT_INTRO_RU,
  },
] as const;

export interface LocationReportStructureSection<ScopeSectionId extends string = string> {
  id: string;
  titleRu: string;
  summaryRu: string;
  scopeSectionIds: readonly ScopeSectionId[];
  disclosure: 'public_summary' | 'paid_detail' | 'cta';
  /** Paid inventory only — separates housing/STR from street-retail blocks. */
  segment?: LocationReportSegmentId;
  /** Public paid-inventory card metadata. Describes value without exposing paid data. */
  publicFeatureTitle?: string;
  publicFeatureDescription?: string;
  publicFeatureGroup?: PublicPaidReportFeatureGroupId;
  visualKind?: PublicPaidReportFeatureVisualKind;
}

export interface LocationReportStructureCta {
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}

export const FREE_LOCATION_REPORT_CTA: LocationReportStructureCta = {
  primaryLabel: 'Получить полный отчёт',
  primaryHref: '/dashboard/reports',
} as const;

export const PAID_LOCATION_REPORT_CTA: LocationReportStructureCta = {
  primaryLabel: 'Подключить управление',
  primaryHref: '/ru#contact',
  secondaryLabel: 'Обсудить объект',
  secondaryHref: '/ru#contact',
} as const;

export const FREE_PAID_REPORT_TEASER_RU =
  'Подробный отчёт добавит конкурентов, экономику, цену, риски, транспорт, коммерческий потенциал, рекомендации по запуску и горизонт развития до 10 лет.';

export const PAID_REPORT_TEN_YEAR_HORIZON_RU =
  'ASI смотрит не только на то, что есть рядом сейчас, но и на горизонт развития до 10 лет: стройки, дороги, транспорт, госзакупки, деловая активность и ранние признаки роста территории.';

export const PAID_REPORT_TEN_YEAR_HORIZON_WHY_RU = [
  'Для покупки квартиры это помогает понять, может ли район стать сильнее или слабее со временем.',
  'Для покупки коммерческой недвижимости это показывает будущий поток, конкуренцию и инфраструктурные риски.',
  'Для аренды коммерческого помещения это помогает оценить, хватит ли спроса не только сейчас, но и после изменений района.',
  'Для выбора стратегии это помогает сравнить посуточную, среднесрочную и коммерческую модель.',
] as const;

export const freeLocationReportStructureSections = [
  {
    id: 'shortAddressConclusion',
    titleRu: 'Краткий вывод по адресу',
    summaryRu: 'Короткий публичный вывод по адресу и времени расчёта.',
    scopeSectionIds: ['addressAndCalculatedAt', 'shortVerdict'],
    disclosure: 'public_summary',
  },
  {
    id: 'publicLocationStatus',
    titleRu: 'Общий балл / статус локации',
    summaryRu: 'Публичный балл и понятный статус без раскрытия формулы расчёта.',
    scopeSectionIds: ['publicScore'],
    disclosure: 'public_summary',
  },
  {
    id: 'topResultReasons',
    titleRu: '3-5 главных причин результата',
    summaryRu: 'Ограниченный список публичных причин результата.',
    scopeSectionIds: ['topEvidenceBullets'],
    disclosure: 'public_summary',
  },
  {
    id: 'keyMagnetsPreview',
    titleRu: 'Ключевые магниты',
    summaryRu: 'Краткое упоминание ключевых магнитов без полного раскрытия логики.',
    scopeSectionIds: ['topEvidenceBullets'],
    disclosure: 'public_summary',
  },
  {
    id: 'generalRecommendation',
    titleRu: 'Общая рекомендация',
    summaryRu: 'Первичная рекомендация как фильтр перед подробным разбором.',
    scopeSectionIds: ['shortRecommendation'],
    disclosure: 'public_summary',
  },
  {
    id: 'orderDetailedReportCta',
    titleRu: 'Хотите подробный разбор объекта?',
    summaryRu: 'Переход к платному подробному отчёту.',
    scopeSectionIds: ['paidReportTeaser', 'CTA'],
    disclosure: 'cta',
  },
] as const satisfies readonly LocationReportStructureSection[];

export type PublicPaidReportGalleryItem = {
  id: string;
  segment: LocationReportSegmentId;
  titleRu: string;
  summaryRu: string;
};

export const PUBLIC_PAID_REPORT_GALLERY_ITEMS: readonly PublicPaidReportGalleryItem[] = [
  {
    id: 'executiveSummary',
    segment: 'residential_investment',
    titleRu: 'Общий вывод по объекту',
    summaryRu: 'Показывает, подходит ли адрес для аренды, проживания или покупки.',
  },
  {
    id: 'audienceFit',
    segment: 'residential_investment',
    titleRu: 'Кому подойдёт объект',
    summaryRu: 'Показывает, подходит ли адрес для аренды, проживания или покупки.',
  },
  {
    id: 'primeDemandMagnets',
    segment: 'residential_investment',
    titleRu: 'Магниты спроса рядом',
    summaryRu: 'Показывает, подходит ли адрес для аренды, проживания или покупки.',
  },
  {
    id: 'competitionAnalysis',
    segment: 'residential_investment',
    titleRu: 'Конкуренция рядом',
    summaryRu: 'Показывает, подходит ли адрес для аренды, проживания или покупки.',
  },
  {
    id: 'revenueScenarios',
    segment: 'residential_investment',
    titleRu: 'Доходность и сценарии',
    summaryRu: 'Показывает, подходит ли адрес для аренды, проживания или покупки.',
  },
  {
    id: 'futureAreaDevelopment',
    segment: 'residential_investment',
    titleRu: 'Будущее района',
    summaryRu: 'Показывает, подходит ли адрес для аренды, проживания или покупки.',
  },
  {
    id: 'risks',
    segment: 'residential_investment',
    titleRu: 'Риски объекта',
    summaryRu: 'Показывает, подходит ли адрес для аренды, проживания или покупки.',
  },
  {
    id: 'commercialTargetTraffic',
    segment: 'commercial_retail',
    titleRu: 'Целевой поток для бизнеса',
    summaryRu:
      'Показывает, где рядом с объектом есть целевой поток для бизнеса. Для ритейла дополнительно проверяются первая линия, этаж и вход.',
  },
] as const;

export const PUBLIC_PAID_REPORT_GALLERY_SECTION_IDS = PUBLIC_PAID_REPORT_GALLERY_ITEMS.map(
  item => item.id,
);

export const paidLocationReportStructureSections = [
  {
    id: 'executiveSummary',
    segment: 'residential_investment',
    titleRu: 'Общий вывод по объекту',
    summaryRu: 'Главный ответ по адресу простыми словами.',
    scopeSectionIds: ['executiveSummary', 'fullScoreExplanation'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает главный ответ: стоит ли рассматривать объект дальше и какой сценарий выглядит сильнее.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'score',
  },
  {
    id: 'audienceFit',
    segment: 'residential_investment',
    titleRu: 'Кому подойдёт объект',
    summaryRu: 'Профиль гостей и сценарии бронирований.',
    scopeSectionIds: ['targetAudiences', 'business'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, под какую аудиторию готовить объект: гостей, арендаторов, семьи или деловые поездки.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'audience',
  },
  {
    id: 'businessTravelDemand',
    segment: 'residential_investment',
    titleRu: 'Деловой и командировочный спрос',
    summaryRu: 'Командировки, подрядчики, деловые поездки и корпоративный спрос.',
    scopeSectionIds: ['business'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, есть ли рядом источники стабильных поездок: БЦ, порты, вокзалы, промышленные и административные зоны.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'audience',
  },
  {
    id: 'touristDemand',
    segment: 'residential_investment',
    titleRu: 'Туристический спрос',
    summaryRu: 'Туристические и событийные сценарии спроса.',
    scopeSectionIds: ['retailAndEvents'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, может ли объект получать спрос от туристов, событий и мест притяжения рядом.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'map',
  },
  {
    id: 'familyDemand',
    segment: 'residential_investment',
    titleRu: 'Семейный спрос',
    summaryRu: 'Сценарии семейных поездок, длительности проживания и инфраструктуры.',
    scopeSectionIds: ['education', 'medical'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, подходит ли район для семейных поездок, лечения, учёбы и спокойного проживания.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'audience',
  },
  {
    id: 'midTermRental',
    segment: 'residential_investment',
    titleRu: 'Среднесрочная аренда',
    summaryRu: 'Когда объект может работать на сроках от нескольких недель до нескольких месяцев.',
    scopeSectionIds: ['targetAudiences', 'strategy', 'business'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, есть ли смысл запускать объект не только посуточно, но и на несколько недель или месяцев.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'bars',
  },
  {
    id: 'transportAccessibility',
    segment: 'residential_investment',
    titleRu: 'Транспортная доступность',
    summaryRu: 'Транспортные сигналы и удобство доступа.',
    scopeSectionIds: ['transport'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, насколько удобно добираться до объекта и влияет ли это на спрос.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'map',
  },
  {
    id: 'transportHubs',
    segment: 'residential_investment',
    titleRu: 'Аэропорты, вокзалы, порты и крупные узлы',
    summaryRu: 'Крупные транспортные и логистические точки, влияющие на спрос.',
    scopeSectionIds: ['transport', 'business'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, дают ли крупные транспортные узлы поток гостей, подрядчиков и командировок.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'map',
  },
  {
    id: 'primeDemandMagnets',
    segment: 'residential_investment',
    titleRu: 'Магниты спроса рядом',
    summaryRu: 'Точки притяжения с дистанцией и типом.',
    scopeSectionIds: ['magnetsByCategory'],
    disclosure: 'paid_detail',
    publicFeatureTitle: 'Точки спроса рядом',
    publicFeatureDescription: 'Показывает, какие места рядом могут регулярно приводить гостей и арендаторов.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'map',
  },
  {
    id: 'medicalEducationAnchors',
    segment: 'residential_investment',
    titleRu: 'Медицинские и образовательные якоря',
    summaryRu: 'Крупная медицина, университеты, кампусы и научные центры как устойчивые причины спроса.',
    scopeSectionIds: ['medical', 'education', 'magnetsByCategory'],
    disclosure: 'paid_detail',
    publicFeatureTitle: 'Медицина и образование рядом',
    publicFeatureDescription: 'Показывает, поддерживают ли спрос больницы, университеты, кампусы и учебные центры.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'map',
  },
  {
    id: 'businessAdminAnchors',
    segment: 'residential_investment',
    titleRu: 'Деловые и административные якоря',
    summaryRu: 'Бизнес-центры, деловые районы, выставочные площадки и административные кластеры.',
    scopeSectionIds: ['business', 'magnetsByCategory'],
    disclosure: 'paid_detail',
    publicFeatureTitle: 'Деловые точки спроса',
    publicFeatureDescription: 'Показывает, есть ли рядом офисы, выставки, деловые районы и учреждения, которые дают будничный спрос.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'audience',
  },
  {
    id: 'industrialLogisticsAnchors',
    segment: 'residential_investment',
    titleRu: 'Промышленные и логистические якоря',
    summaryRu: 'Заводы, промышленные парки, портовые и логистические кластеры с устойчивым деловым спросом.',
    scopeSectionIds: ['business', 'transport', 'magnetsByCategory'],
    disclosure: 'paid_detail',
    publicFeatureTitle: 'Промышленные и логистические точки спроса',
    publicFeatureDescription: 'Показывает, может ли объект получать спрос от сотрудников, подрядчиков и логистики рядом.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'audience',
  },
  {
    id: 'competitionAnalysis',
    segment: 'residential_investment',
    titleRu: 'Конкуренция рядом',
    summaryRu: 'Давление конкурентов и что проверить на площадках.',
    scopeSectionIds: ['competitors'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, насколько плотный рынок вокруг объекта и что важно проверить перед запуском.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'bars',
  },
  {
    id: 'competitorMap',
    segment: 'residential_investment',
    titleRu: 'Карта конкурентов',
    summaryRu: 'Как конкуренты распределены вокруг объекта.',
    scopeSectionIds: ['competitors', 'fullUrbanDevelopmentRadar'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, где вокруг объекта сосредоточены альтернативы и как это влияет на позиционирование.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'map',
  },
  {
    id: 'marketSaturation',
    segment: 'residential_investment',
    titleRu: 'Насыщенность рынка',
    summaryRu: 'Насколько плотная конкуренция и где может быть место для объекта.',
    scopeSectionIds: ['competitors'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, есть ли место для нового объекта или рынок уже требует сильного отличия.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'bars',
  },
  {
    id: 'revenueCautious',
    segment: 'residential_investment',
    titleRu: 'Доходность: осторожный сценарий',
    summaryRu: 'Нижняя планка для слабого старта или неполной загрузки.',
    scopeSectionIds: ['revenueScenarios'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает нижнюю планку, чтобы не принимать решение только по оптимистичным ожиданиям.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'income',
  },
  {
    id: 'revenueBase',
    segment: 'residential_investment',
    titleRu: 'Доходность: базовый сценарий',
    summaryRu: 'Рабочий ориентир при нормальной упаковке и цене.',
    scopeSectionIds: ['revenueScenarios'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает реалистичный сценарий дохода без завышенных ожиданий.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'income',
  },
  {
    id: 'revenueScenarios',
    segment: 'residential_investment',
    titleRu: 'Доходность: сильный сценарий',
    summaryRu: 'Верхняя граница при удачном запуске и сильной упаковке.',
    scopeSectionIds: ['revenueScenarios', 'strategy'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает верхнюю границу, если объект хорошо упакован и попадает в сильный спрос.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'income',
  },
  {
    id: 'risks',
    segment: 'residential_investment',
    titleRu: 'Риски объекта',
    summaryRu: 'Что проверить вручную до вложений.',
    scopeSectionIds: ['risks'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, какие ограничения и слабые места стоит проверить до сделки или запуска.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'risk',
  },
  {
    id: 'launchStrategy',
    segment: 'residential_investment',
    titleRu: 'Рекомендации по запуску',
    summaryRu: 'Практические шаги на первые недели.',
    scopeSectionIds: ['strategy'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, с каких действий начать, чтобы тестировать объект не вслепую.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'plan',
  },
  {
    id: 'listingPositioning',
    segment: 'residential_investment',
    titleRu: 'Позиционирование объявления',
    summaryRu: 'Как описывать объект под нужную аудиторию и спрос.',
    scopeSectionIds: ['strategy', 'targetAudiences'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, как подать объект под нужную аудиторию, а не просто перечислить характеристики.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'plan',
  },
  {
    id: 'objectImprovements',
    segment: 'residential_investment',
    titleRu: 'Что улучшить в объекте',
    summaryRu: 'Какие доработки могут повысить привлекательность и доходность.',
    scopeSectionIds: ['strategy', 'risks'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, какие улучшения могут усилить привлекательность до запуска или покупки.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'plan',
  },
  {
    id: 'futureAreaDevelopment',
    segment: 'residential_investment',
    titleRu: 'Будущее района',
    summaryRu: PAID_REPORT_TEN_YEAR_HORIZON_RU,
    scopeSectionIds: ['urbanDevelopmentForecast', 'fullUrbanDevelopmentRadar'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, может ли территория стать сильнее за счёт строек, дорог, транспорта и госзакупок.',
    publicFeatureGroup: 'future_10_years',
    visualKind: 'timeline',
  },
  {
    id: 'newResidentialProjects',
    segment: 'residential_investment',
    titleRu: 'Стройки и новые ЖК',
    summaryRu: 'Новые дома, кварталы и стройки, которые могут изменить спрос и конкуренцию.',
    scopeSectionIds: ['urbanDevelopmentForecast'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, какие стройки могут добавить спрос, конкуренцию или изменить окружение.',
    publicFeatureGroup: 'future_10_years',
    visualKind: 'timeline',
  },
  {
    id: 'roadTransportChanges',
    segment: 'residential_investment',
    titleRu: 'Дороги, развязки, транспортные изменения',
    summaryRu: 'Транспортные изменения, которые могут усилить или ослабить точку.',
    scopeSectionIds: ['urbanDevelopmentForecast', 'transport'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, какие дороги, развязки и транспортные планы могут изменить удобство района.',
    publicFeatureGroup: 'future_10_years',
    visualKind: 'timeline',
  },
  {
    id: 'procurementEarlySignals',
    segment: 'residential_investment',
    titleRu: 'Госзакупки и ранние признаки развития территории',
    summaryRu: 'Ранние сигналы проектов, планов и деловой активности.',
    scopeSectionIds: ['urbanDevelopmentForecast', 'sourceEvidence'],
    disclosure: 'paid_detail',
    publicFeatureTitle: 'Госзакупки и ранние сигналы роста',
    publicFeatureDescription: 'Показывает ранние признаки будущих изменений, пока они ещё не видны на карте района.',
    publicFeatureGroup: 'future_10_years',
    visualKind: 'timeline',
  },
  {
    id: 'tenYearDevelopmentHorizon',
    segment: 'residential_investment',
    titleRu: 'Горизонт развития до 10 лет',
    summaryRu: PAID_REPORT_TEN_YEAR_HORIZON_RU,
    scopeSectionIds: ['urbanDevelopmentForecast', 'fullUrbanDevelopmentRadar', 'sourceEvidence'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает долгий контекст: что может усилить или ослабить объект в ближайшие годы.',
    publicFeatureGroup: 'future_10_years',
    visualKind: 'timeline',
  },
  {
    id: 'commercialPotential',
    segment: 'commercial_retail',
    titleRu: 'Коммерческий потенциал локации',
    summaryRu: 'Оценка потенциала для коммерческих помещений и street-retail — отдельно от жилья и посуточной аренды.',
    scopeSectionIds: ['business', 'retailAndEvents'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, есть ли у места потенциал для коммерции отдельно от жилья и посуточной аренды.',
    publicFeatureGroup: 'commercial_retail',
    visualKind: 'traffic',
  },
  {
    id: 'targetTrafficHeatmap',
    segment: 'commercial_retail',
    titleRu: 'Карта целевого трафика',
    summaryRu: 'Тепловая карта и индекс целевого трафика в зоне объекта — оценка потока, не точный подсчёт людей.',
    scopeSectionIds: ['retailAndEvents'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, где рядом с объектом выше вероятность целевого потока для бизнеса.',
    publicFeatureGroup: 'commercial_retail',
    visualKind: 'traffic',
  },
  {
    id: 'h3TrafficHexes',
    segment: 'commercial_retail',
    titleRu: 'H3-гексы целевого потока',
    summaryRu: 'Разбивка зоны на гексы: где потенциал выше и где слабее — для коммерции на первой линии.',
    scopeSectionIds: ['retailAndEvents'],
    disclosure: 'paid_detail',
    publicFeatureTitle: 'Зоны целевого потока',
    publicFeatureDescription: 'Показывает соседние зоны вокруг объекта: где поток сильнее, а где слабее.',
    publicFeatureGroup: 'commercial_retail',
    visualKind: 'traffic',
  },
  {
    id: 'streetFrontageEntrance',
    segment: 'commercial_retail',
    titleRu: 'Первая линия и вход',
    summaryRu: 'Первая линия, вход с улицы, видимость вывески и доступность — требует ручной проверки входной группы.',
    scopeSectionIds: ['retailAndEvents'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, насколько важны первая линия, вход с улицы, видимость и удобство подхода.',
    publicFeatureGroup: 'commercial_retail',
    visualKind: 'storefront',
  },
  {
    id: 'businessFormatFit',
    segment: 'commercial_retail',
    titleRu: 'Подходящие форматы бизнеса',
    summaryRu: 'Какие форматы (ритейл, HoReCa, сервис) лучше сочетаются с потоком и ограничениями помещения.',
    scopeSectionIds: ['retailAndEvents', 'business'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, какие форматы бизнеса лучше подходят под поток, окружение и помещение.',
    publicFeatureGroup: 'commercial_retail',
    visualKind: 'storefront',
  },
  {
    id: 'retailPremisesConstraints',
    segment: 'commercial_retail',
    titleRu: 'Ограничения помещения',
    summaryRu: 'Этаж, цоколь, ступеньки, видимость и барьеры — что может снизить потенциал street-retail.',
    scopeSectionIds: ['retailAndEvents', 'risks'],
    disclosure: 'paid_detail',
    publicFeatureDescription: 'Показывает, что может снизить потенциал: этаж, цоколь, ступеньки, вход и видимость.',
    publicFeatureGroup: 'commercial_retail',
    visualKind: 'risk',
  },
  {
    id: 'finalRecommendation',
    segment: 'residential_investment',
    titleRu: 'Итоговое решение: брать / не брать / проверять глубже',
    summaryRu: 'Финальный ответ с учётом спроса, конкуренции, экономики, рисков и горизонта развития.',
    scopeSectionIds: ['finalRecommendation'],
    disclosure: 'paid_detail',
    publicFeatureTitle: 'Итоговое решение по объекту',
    publicFeatureDescription: 'Показывает итоговую логику решения: покупать, запускать, менять формат или проверять глубже.',
    publicFeatureGroup: 'real_estate_rentals',
    visualKind: 'score',
  },
  {
    id: 'managementNextStepCta',
    titleRu: 'Следующий шаг',
    summaryRu: 'CTA: подключить управление или обсудить объект.',
    scopeSectionIds: ['nextStepCTA'],
    disclosure: 'cta',
  },
] as const satisfies readonly LocationReportStructureSection[];

export type FreeLocationReportStructureSectionId =
  (typeof freeLocationReportStructureSections)[number]['id'];
export type PaidLocationReportStructureSectionId =
  (typeof paidLocationReportStructureSections)[number]['id'];
export type FreeLocationReportScopeSectionId =
  (typeof freeLocationReportStructureSections)[number]['scopeSectionIds'][number];
export type PaidLocationReportScopeSectionId =
  (typeof paidLocationReportStructureSections)[number]['scopeSectionIds'][number];

export type LocationReportPaidPreviewSection = Pick<
  LocationReportStructureSection,
  'id' | 'titleRu' | 'summaryRu'
> & {
  segment?: LocationReportSegmentId;
};

export type PublicPaidReportFeature = {
  id: string;
  titleRu: string;
  descriptionRu: string;
  group: PublicPaidReportFeatureGroupId;
  visualKind: PublicPaidReportFeatureVisualKind;
};

export interface LocationReportStructureViewModel {
  version: 'location-report-structure-v1';
  mode: LocationReportStructureMode;
  titleRu: string;
  sections: readonly LocationReportStructureSection[];
  cta: LocationReportStructureCta;
  paidPreviewSections?: readonly LocationReportPaidPreviewSection[];
  segmentGroups?: readonly LocationReportStructureSegmentGroup[];
}

type PaidStructureSection = (typeof paidLocationReportStructureSections)[number];

function paidSectionSegment(section: PaidStructureSection): LocationReportSegmentId | undefined {
  return 'segment' in section ? section.segment : undefined;
}

function publicFeatureGroupForSection(
  section: LocationReportStructureSection,
): PublicPaidReportFeatureGroupId {
  if (section.publicFeatureGroup) return section.publicFeatureGroup;
  return section.segment === 'commercial_retail' ? 'commercial_retail' : 'real_estate_rentals';
}

function publicFeatureVisualKindForSection(
  section: LocationReportStructureSection,
): PublicPaidReportFeatureVisualKind {
  if (section.visualKind) return section.visualKind;
  return publicFeatureGroupForSection(section) === 'future_10_years' ? 'timeline' : 'score';
}

function toPublicPaidReportFeature(section: PaidStructureSection): PublicPaidReportFeature | null {
  if (section.disclosure !== 'paid_detail') return null;
  const meta: LocationReportStructureSection = section;
  return {
    id: section.id,
    titleRu: meta.publicFeatureTitle ?? meta.titleRu,
    descriptionRu: meta.publicFeatureDescription ?? meta.summaryRu,
    group: publicFeatureGroupForSection(meta),
    visualKind: publicFeatureVisualKindForSection(meta),
  };
}

export function getPublicPaidReportFeatureInventory(): PublicPaidReportFeature[] {
  return paidLocationReportStructureSections
    .map(toPublicPaidReportFeature)
    .filter((item): item is PublicPaidReportFeature => item !== null);
}

export function buildLocationReportSegmentGroups(): LocationReportStructureSegmentGroup[] {
  return LOCATION_REPORT_SEGMENT_GROUPS.map(meta => ({
    ...meta,
    sectionIds: paidLocationReportStructureSections
      .filter(
        section =>
          paidSectionSegment(section) === meta.id && section.disclosure === 'paid_detail',
      )
      .map(section => section.id),
  }));
}

export function getPaidReportStructureSectionsForSegment(
  segment: LocationReportSegmentId,
): readonly LocationReportStructureSection[] {
  return paidLocationReportStructureSections.filter(
    section => paidSectionSegment(section) === segment,
  );
}

function collectScopeSectionIds(
  sections: readonly LocationReportStructureSection[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const id of section.scopeSectionIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function getLocationReportScopeSectionIds(
  mode: 'free',
): FreeLocationReportScopeSectionId[];
export function getLocationReportScopeSectionIds(
  mode: 'paid',
): PaidLocationReportScopeSectionId[];
export function getLocationReportScopeSectionIds(
  mode: LocationReportStructureMode,
): string[] {
  return collectScopeSectionIds(
    mode === 'free' ? freeLocationReportStructureSections : paidLocationReportStructureSections,
  );
}

export function getLocationReportStructureSection(
  mode: 'free',
  id: FreeLocationReportStructureSectionId,
): (typeof freeLocationReportStructureSections)[number];
export function getLocationReportStructureSection(
  mode: 'paid',
  id: PaidLocationReportStructureSectionId,
): (typeof paidLocationReportStructureSections)[number];
export function getLocationReportStructureSection(
  mode: LocationReportStructureMode,
  id: string,
): LocationReportStructureSection {
  const section = (mode === 'free' ? freeLocationReportStructureSections : paidLocationReportStructureSections)
    .find(item => item.id === id);
  if (!section) throw new Error(`Unknown ${mode} location report structure section: ${id}`);
  return section;
}

export function buildLocationReportStructureViewModel(
  mode: 'free',
): LocationReportStructureViewModel;
export function buildLocationReportStructureViewModel(
  mode: 'paid',
): LocationReportStructureViewModel;
export function buildLocationReportStructureViewModel(
  mode: LocationReportStructureMode,
): LocationReportStructureViewModel {
  if (mode === 'free') {
    return {
      version: 'location-report-structure-v1',
      mode: 'free',
      titleRu: 'Отчёт по локации',
      sections: freeLocationReportStructureSections,
      cta: FREE_LOCATION_REPORT_CTA,
      paidPreviewSections: PUBLIC_PAID_REPORT_GALLERY_ITEMS.map(item => ({
        id: item.id,
        titleRu: item.titleRu,
        summaryRu: item.summaryRu,
        segment: item.segment,
      })),
      segmentGroups: buildLocationReportSegmentGroups(),
    };
  }

  return {
    version: 'location-report-structure-v1',
    mode: 'paid',
    titleRu: 'Отчёт по локации',
    sections: paidLocationReportStructureSections,
    cta: PAID_LOCATION_REPORT_CTA,
    segmentGroups: buildLocationReportSegmentGroups(),
  };
}
