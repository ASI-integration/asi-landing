export type LocationReportStructureMode = 'free' | 'paid';

export interface LocationReportStructureSection<ScopeSectionId extends string = string> {
  id: string;
  titleRu: string;
  summaryRu: string;
  scopeSectionIds: readonly ScopeSectionId[];
  disclosure: 'public_summary' | 'paid_detail' | 'cta';
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

export const PUBLIC_PAID_REPORT_GALLERY_SECTION_IDS = [
  'executiveSummary',
  'audienceFit',
  'primeDemandMagnets',
  'competitionAnalysis',
  'revenueScenarios',
  'futureAreaDevelopment',
  'risks',
] as const;

export const paidLocationReportStructureSections = [
  {
    id: 'executiveSummary',
    titleRu: 'Общий вывод по объекту',
    summaryRu: 'Главный ответ по адресу простыми словами.',
    scopeSectionIds: ['executiveSummary', 'fullScoreExplanation'],
    disclosure: 'paid_detail',
  },
  {
    id: 'audienceFit',
    titleRu: 'Кому подойдёт объект',
    summaryRu: 'Профиль гостей и сценарии бронирований.',
    scopeSectionIds: ['targetAudiences', 'business'],
    disclosure: 'paid_detail',
  },
  {
    id: 'businessTravelDemand',
    titleRu: 'Деловой и командировочный спрос',
    summaryRu: 'Командировки, подрядчики, деловые поездки и корпоративный спрос.',
    scopeSectionIds: ['business'],
    disclosure: 'paid_detail',
  },
  {
    id: 'touristDemand',
    titleRu: 'Туристический спрос',
    summaryRu: 'Туристические и событийные сценарии спроса.',
    scopeSectionIds: ['retailAndEvents'],
    disclosure: 'paid_detail',
  },
  {
    id: 'familyDemand',
    titleRu: 'Семейный спрос',
    summaryRu: 'Сценарии семейных поездок, длительности проживания и инфраструктуры.',
    scopeSectionIds: ['education', 'medical'],
    disclosure: 'paid_detail',
  },
  {
    id: 'midTermRental',
    titleRu: 'Среднесрочная аренда',
    summaryRu: 'Когда объект может работать на сроках от нескольких недель до нескольких месяцев.',
    scopeSectionIds: ['targetAudiences', 'strategy', 'business'],
    disclosure: 'paid_detail',
  },
  {
    id: 'transportAccessibility',
    titleRu: 'Транспортная доступность',
    summaryRu: 'Транспортные сигналы и удобство доступа.',
    scopeSectionIds: ['transport'],
    disclosure: 'paid_detail',
  },
  {
    id: 'transportHubs',
    titleRu: 'Аэропорты, вокзалы, порты и крупные узлы',
    summaryRu: 'Крупные транспортные и логистические точки, влияющие на спрос.',
    scopeSectionIds: ['transport', 'business'],
    disclosure: 'paid_detail',
  },
  {
    id: 'primeDemandMagnets',
    titleRu: 'Магниты спроса рядом',
    summaryRu: 'Точки притяжения с дистанцией и типом.',
    scopeSectionIds: ['magnetsByCategory'],
    disclosure: 'paid_detail',
  },
  {
    id: 'medicalEducationAnchors',
    titleRu: 'Медицинские и образовательные якоря',
    summaryRu: 'Крупная медицина, университеты, кампусы и научные центры как устойчивые причины спроса.',
    scopeSectionIds: ['medical', 'education', 'magnetsByCategory'],
    disclosure: 'paid_detail',
  },
  {
    id: 'businessAdminAnchors',
    titleRu: 'Деловые и административные якоря',
    summaryRu: 'Бизнес-центры, деловые районы, выставочные площадки и административные кластеры.',
    scopeSectionIds: ['business', 'magnetsByCategory'],
    disclosure: 'paid_detail',
  },
  {
    id: 'industrialLogisticsAnchors',
    titleRu: 'Промышленные и логистические якоря',
    summaryRu: 'Заводы, промышленные парки, портовые и логистические кластеры с устойчивым деловым спросом.',
    scopeSectionIds: ['business', 'transport', 'magnetsByCategory'],
    disclosure: 'paid_detail',
  },
  {
    id: 'competitionAnalysis',
    titleRu: 'Конкуренция рядом',
    summaryRu: 'Давление конкурентов и что проверить на площадках.',
    scopeSectionIds: ['competitors'],
    disclosure: 'paid_detail',
  },
  {
    id: 'competitorMap',
    titleRu: 'Карта конкурентов',
    summaryRu: 'Как конкуренты распределены вокруг объекта.',
    scopeSectionIds: ['competitors', 'fullUrbanDevelopmentRadar'],
    disclosure: 'paid_detail',
  },
  {
    id: 'marketSaturation',
    titleRu: 'Насыщенность рынка',
    summaryRu: 'Насколько плотная конкуренция и где может быть место для объекта.',
    scopeSectionIds: ['competitors'],
    disclosure: 'paid_detail',
  },
  {
    id: 'revenueCautious',
    titleRu: 'Доходность: осторожный сценарий',
    summaryRu: 'Нижняя планка для слабого старта или неполной загрузки.',
    scopeSectionIds: ['revenueScenarios'],
    disclosure: 'paid_detail',
  },
  {
    id: 'revenueBase',
    titleRu: 'Доходность: базовый сценарий',
    summaryRu: 'Рабочий ориентир при нормальной упаковке и цене.',
    scopeSectionIds: ['revenueScenarios'],
    disclosure: 'paid_detail',
  },
  {
    id: 'revenueScenarios',
    titleRu: 'Доходность: сильный сценарий',
    summaryRu: 'Верхняя граница при удачном запуске и сильной упаковке.',
    scopeSectionIds: ['revenueScenarios', 'strategy'],
    disclosure: 'paid_detail',
  },
  {
    id: 'risks',
    titleRu: 'Риски объекта',
    summaryRu: 'Что проверить вручную до вложений.',
    scopeSectionIds: ['risks'],
    disclosure: 'paid_detail',
  },
  {
    id: 'launchStrategy',
    titleRu: 'Рекомендации по запуску',
    summaryRu: 'Практические шаги на первые недели.',
    scopeSectionIds: ['strategy'],
    disclosure: 'paid_detail',
  },
  {
    id: 'listingPositioning',
    titleRu: 'Позиционирование объявления',
    summaryRu: 'Как описывать объект под нужную аудиторию и спрос.',
    scopeSectionIds: ['strategy', 'targetAudiences'],
    disclosure: 'paid_detail',
  },
  {
    id: 'objectImprovements',
    titleRu: 'Что улучшить в объекте',
    summaryRu: 'Какие доработки могут повысить привлекательность и доходность.',
    scopeSectionIds: ['strategy', 'risks'],
    disclosure: 'paid_detail',
  },
  {
    id: 'futureAreaDevelopment',
    titleRu: 'Будущее района',
    summaryRu: PAID_REPORT_TEN_YEAR_HORIZON_RU,
    scopeSectionIds: ['urbanDevelopmentForecast', 'fullUrbanDevelopmentRadar'],
    disclosure: 'paid_detail',
  },
  {
    id: 'newResidentialProjects',
    titleRu: 'Стройки и новые ЖК',
    summaryRu: 'Новые дома, кварталы и стройки, которые могут изменить спрос и конкуренцию.',
    scopeSectionIds: ['urbanDevelopmentForecast'],
    disclosure: 'paid_detail',
  },
  {
    id: 'roadTransportChanges',
    titleRu: 'Дороги, развязки, транспортные изменения',
    summaryRu: 'Транспортные изменения, которые могут усилить или ослабить точку.',
    scopeSectionIds: ['urbanDevelopmentForecast', 'transport'],
    disclosure: 'paid_detail',
  },
  {
    id: 'procurementEarlySignals',
    titleRu: 'Госзакупки и ранние признаки развития территории',
    summaryRu: 'Ранние сигналы проектов, планов и деловой активности.',
    scopeSectionIds: ['urbanDevelopmentForecast', 'sourceEvidence'],
    disclosure: 'paid_detail',
  },
  {
    id: 'commercialPotential',
    titleRu: 'Коммерческий потенциал локации',
    summaryRu: 'Потенциал для коммерческого использования, сервиса или смешанной модели.',
    scopeSectionIds: ['business', 'retailAndEvents'],
    disclosure: 'paid_detail',
  },
  {
    id: 'tenYearDevelopmentHorizon',
    titleRu: 'Горизонт развития до 10 лет',
    summaryRu: PAID_REPORT_TEN_YEAR_HORIZON_RU,
    scopeSectionIds: ['urbanDevelopmentForecast', 'fullUrbanDevelopmentRadar', 'sourceEvidence'],
    disclosure: 'paid_detail',
  },
  {
    id: 'finalRecommendation',
    titleRu: 'Итоговое решение: брать / не брать / проверять глубже',
    summaryRu: 'Финальный ответ с учётом спроса, конкуренции, экономики, рисков и горизонта развития.',
    scopeSectionIds: ['finalRecommendation'],
    disclosure: 'paid_detail',
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

export interface LocationReportStructureViewModel {
  version: 'location-report-structure-v1';
  mode: LocationReportStructureMode;
  titleRu: string;
  sections: readonly LocationReportStructureSection[];
  cta: LocationReportStructureCta;
  paidPreviewSections?: readonly Pick<LocationReportStructureSection, 'id' | 'titleRu' | 'summaryRu'>[];
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
    const paidSectionById = new Map(
      paidLocationReportStructureSections.map(section => [section.id, section] as const),
    );
    return {
      version: 'location-report-structure-v1',
      mode: 'free',
      titleRu: 'Отчёт по локации',
      sections: freeLocationReportStructureSections,
      cta: FREE_LOCATION_REPORT_CTA,
      paidPreviewSections: PUBLIC_PAID_REPORT_GALLERY_SECTION_IDS.flatMap(id => {
        const section = paidSectionById.get(id);
        return section
          ? [{ id: section.id, titleRu: section.titleRu, summaryRu: section.summaryRu }]
          : [];
      }),
    };
  }

  return {
    version: 'location-report-structure-v1',
    mode: 'paid',
    titleRu: 'Отчёт по локации',
    sections: paidLocationReportStructureSections,
    cta: PAID_LOCATION_REPORT_CTA,
  };
}
