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
  'Подробный отчёт добавит конкурентов, экономику, цену, риски, транспорт, коммерческий потенциал и рекомендации по запуску.';

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

export const paidLocationReportStructureSections = [
  {
    id: 'executiveSummary',
    titleRu: 'Краткий вывод для владельца',
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
    id: 'primeDemandMagnets',
    titleRu: 'Главные магниты спроса',
    summaryRu: 'Точки притяжения с дистанцией и типом.',
    scopeSectionIds: ['magnetsByCategory'],
    disclosure: 'paid_detail',
  },
  {
    id: 'competitionAnalysis',
    titleRu: 'Конкуренция',
    summaryRu: 'Давление конкурентов и что проверить на площадках.',
    scopeSectionIds: ['competitors'],
    disclosure: 'paid_detail',
  },
  {
    id: 'revenueScenarios',
    titleRu: 'Сценарии дохода',
    summaryRu: 'Осторожный, базовый и сильный сценарий с условиями.',
    scopeSectionIds: ['revenueScenarios', 'strategy'],
    disclosure: 'paid_detail',
  },
  {
    id: 'futureAreaDevelopment',
    titleRu: 'Как может измениться район',
    summaryRu: 'ЖК, дороги, инфраструктура, кластеры, транспорт, госзакупки.',
    scopeSectionIds: ['urbanDevelopmentForecast', 'fullUrbanDevelopmentRadar'],
    disclosure: 'paid_detail',
  },
  {
    id: 'risks',
    titleRu: 'Риски',
    summaryRu: 'Что проверить вручную до вложений.',
    scopeSectionIds: ['risks'],
    disclosure: 'paid_detail',
  },
  {
    id: 'launchStrategy',
    titleRu: 'Как запускать',
    summaryRu: 'Практические шаги на первые недели.',
    scopeSectionIds: ['strategy'],
    disclosure: 'paid_detail',
  },
  {
    id: 'finalRecommendation',
    titleRu: 'Итоговая рекомендация',
    summaryRu: 'Делать, отложить или зайти осторожно.',
    scopeSectionIds: ['finalRecommendation'],
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
    id: 'objectEnvironment',
    titleRu: 'Среда вокруг объекта',
    summaryRu: 'Окружение, сервисы и качество данных.',
    scopeSectionIds: ['medical', 'education', 'retailAndEvents', 'dataFreshness', 'sourceEvidence'],
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
    return {
      version: 'location-report-structure-v1',
      mode: 'free',
      titleRu: 'Отчёт по локации',
      sections: freeLocationReportStructureSections,
      cta: FREE_LOCATION_REPORT_CTA,
      paidPreviewSections: paidLocationReportStructureSections.map(({ id, titleRu, summaryRu }) => ({
        id,
        titleRu,
        summaryRu,
      })),
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
