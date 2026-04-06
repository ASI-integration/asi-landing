import type { ReactNode } from 'react';
import type { FootTrafficSummary, GravityExplanation } from '@/lib/location/types';
import { MAGNET_CATEGORIES } from '@/lib/location/config';

export type LocDemoLocale = 'en' | 'ru';

const FOOT_EN_TO_RU: Record<string, string> = {
  low: 'низкая',
  moderate: 'умеренная',
  high: 'высокая',
  calm: 'спокойная',
  busy: 'оживлённая',
  unstable: 'нестабильная',
  stable: 'устойчивая',
  'destination-led footfall': 'преобладает целевой поток',
  'mixed destination and transit': 'смесь целевого и транзитного потока',
  'transit-heavy footfall': 'заметный транзитный поток',
};

export function footTrafficForLocale(ft: FootTrafficSummary, locale: LocDemoLocale): FootTrafficSummary {
  if (locale === 'en') return ft;
  return {
    ...ft,
    movementDensity: FOOT_EN_TO_RU[ft.movementDensity] ?? ft.movementDensity,
    zoneActivity: FOOT_EN_TO_RU[ft.zoneActivity] ?? ft.zoneActivity,
    flowStability: FOOT_EN_TO_RU[ft.flowStability] ?? ft.flowStability,
    flowCharacter: FOOT_EN_TO_RU[ft.flowCharacter] ?? ft.flowCharacter,
  };
}

export function competitorLabel(level: GravityExplanation['competitorPressureLevel'], locale: LocDemoLocale): string {
  if (locale === 'ru') {
    const m = { low: 'низкое', medium: 'среднее', high: 'высокое' } as const;
    return m[level];
  }
  const m = { low: 'Low', medium: 'Medium', high: 'High' } as const;
  return m[level];
}

export function magnetCategoryLabel(categoryId: string, locale: LocDemoLocale): string {
  const cat = MAGNET_CATEGORIES.find(c => c.id === categoryId);
  if (!cat) return categoryId;
  return locale === 'ru' ? cat.labelRu : cat.label;
}

export const LOC_COPY: Record<
  LocDemoLocale,
  {
    mapLoadingTitle: string;
    mapLoadingSub: string;
    mapTitle2gis: string;
    mapTitleOsm: string;
    heatmapHeader: string;
    heatmapSub: string;
    heatmapAria: string;
    legendMagnets: string;
    legendCompetitors: string;
    legendSubject: string;
    heatmapCaption: ReactNode;
    heatmapCounts: (nMag: number, nComp: number) => string;
    zoneActivityLine: (zone: string, stab: string) => string;
    addressLocked: string;
    addressPlaceholder: string;
    changeAddressAria: string;
    addrNotFound: string;
    suggestUnavailable: string;
    evergreenLine1: string;
    evergreenLine2: string;
    analysisHeader: string;
    keyZone: string;
    topMagnet: string;
    competitors: string;
    cluster: string;
    nearbySuffix: (n: number) => string;
    density: string;
    zoneActivity: string;
    stability: string;
    targetFlow: string;
    magnetsAround: string;
    significantCount: (n: number) => string;
    showMoreMagnets: (n: number) => string;
    collapse: string;
    noOsm: string;
    loadingSteps: string[];
    runStarted: string;
    sectionTitle: string;
    sectionLead: string;
    sectionSub1: string;
    sectionSub2: string;
    envMapTitle: string;
    tags: string[];
    tryAnother: string;
    asiPanelTitle: string;
    addrChosenLog: (s: string) => string;
    pickAddressErr: string;
    submitIdle: string;
    osmNote: string;
    strategyTitle: string;
    strategyMidTerm: string[];
    strategyHybrid: string[];
    strategyShortTerm: string[];
  }
> = {
  en: {
    mapLoadingTitle: 'Analyzing location...',
    mapLoadingSub: 'Fetching real-world demand signals',
    mapTitle2gis: 'Property surroundings map — 2GIS',
    mapTitleOsm: 'Property surroundings map — OpenStreetMap',
    heatmapHeader: 'ASI · Influence map',
    heatmapSub: '· real values',
    heatmapAria: 'Location attraction heatmap',
    legendMagnets: 'Magnets',
    legendCompetitors: 'Competitors',
    legendSubject: 'Your property',
    heatmapCaption: (
      <>
        Heat intensity reflects magnets and the zone: density at real attraction points, flow stability, and how
        much movement looks like{' '}
        <span className="text-slate-400">destination visits</span> rather than only{' '}
        <span className="text-slate-400">through traffic</span>.
      </>
    ),
    heatmapCounts: (nMag, nComp) => `${nMag} magnets · ${nComp} competitors`,
    zoneActivityLine: (zone, stab) => `zone activity — ${zone} · stability — ${stab}`,
    addressLocked: 'Exact address selected',
    addressPlaceholder: 'Enter your property address',
    changeAddressAria: 'Change address',
    addrNotFound: 'No address found — try refining your query',
    suggestUnavailable: 'Suggestions temporarily unavailable',
    evergreenLine1: 'Evergreen',
    evergreenLine2: 'location index',
    analysisHeader: 'Analysis summary',
    keyZone: 'Key zone',
    topMagnet: 'Top magnet',
    competitors: 'Competitors',
    cluster: 'Cluster',
    nearbySuffix: n => `${n} nearby`,
    density: 'Density',
    zoneActivity: 'Zone activity',
    stability: 'Stability',
    targetFlow: 'Target flow',
    magnetsAround: 'Magnets around the property',
    significantCount: n => `${n} significant`,
    showMoreMagnets: n => `Show ${n} more magnets`,
    collapse: 'Collapse',
    noOsm: 'No OpenStreetMap objects were found for this address.',
    loadingSteps: [
      'Analyzing location...',
      'Evaluating demand...',
      'Calculating revenue...',
    ],
    runStarted: 'Run started',
    sectionTitle: 'Location analysis runs automatically',
    sectionLead:
      'Enter an address — magnets, competitors, and demand scores execute without a manual research stack.',
    sectionSub1: 'ASI runs the scoring pipeline; you get execution-ready signals, not a slide deck to interpret.',
    sectionSub2:
      'Surfaces where intent-aligned demand concentrates — inputs listing and pricing can act on.',
    envMapTitle: 'Surroundings map',
    tags: ['Show Property', 'Transport', 'Nearby Places', 'Open Map'],
    tryAnother: 'Try another address',
    asiPanelTitle: 'ASI · Location analysis',
    addrChosenLog: s => `address selected · ${s}`,
    pickAddressErr: 'Pick an exact address from the list',
    submitIdle: 'Analyze location',
    osmNote: 'Uses live OpenStreetMap data',
    strategyTitle: 'Recommended Strategy',
    strategyMidTerm: [
      'Best use: Mid-term rentals (1–3 months)',
      'Target: contractors, relocations, temporary stays',
      'Stabilize income instead of chasing nightly demand',
    ],
    strategyHybrid: [
      'Mix short-term and mid-term stays',
      'Adjust pricing seasonally',
      'Use discounts for longer stays',
    ],
    strategyShortTerm: [
      'Strong for daily rentals',
      'Focus on occupancy and pricing optimization',
      'Leverage peak seasons',
    ],
  },
  ru: {
    mapLoadingTitle: 'Анализируем локацию…',
    mapLoadingSub: 'Данные о реальном спросе',
    mapTitle2gis: 'Карта окружения объекта — 2GIS',
    mapTitleOsm: 'Карта окружения объекта — OpenStreetMap',
    heatmapHeader: 'ASI · Карта влияния',
    heatmapSub: '· реальные значения',
    heatmapAria: 'Карта притяжения локации',
    legendMagnets: 'Магниты',
    legendCompetitors: 'Конкуренты',
    legendSubject: 'Ваш объект',
    heatmapCaption: (
      <>
        Тепло карты связано с магнитами и зоной: плотность и концентрация у реальных точек притяжения,
        устойчивость потока и то, насколько движение похоже на{' '}
        <span className="text-slate-400">целевой приход</span>, а не только на{' '}
        <span className="text-slate-400">транзит</span>.
      </>
    ),
    heatmapCounts: (nMag, nComp) => `${nMag} магнитов · ${nComp} конкурентов`,
    zoneActivityLine: (zone, stab) => `активность зоны — ${zone} · устойчивость — ${stab}`,
    addressLocked: 'Точный адрес выбран',
    addressPlaceholder: 'Введите ваш адрес объекта',
    changeAddressAria: 'Изменить адрес',
    addrNotFound: 'Адрес не найден — попробуйте уточнить запрос',
    suggestUnavailable: 'Подсказки временно недоступны',
    evergreenLine1: 'Индекс вечной',
    evergreenLine2: 'локации',
    analysisHeader: 'Итог анализа',
    keyZone: 'Ключевая зона',
    topMagnet: 'Главный магнит',
    competitors: 'Конкуренты',
    cluster: 'Кластер',
    nearbySuffix: n => `${n} рядом`,
    density: 'Плотность',
    zoneActivity: 'Активность зоны',
    stability: 'Устойчивость',
    targetFlow: 'Целевой поток',
    magnetsAround: 'Магниты вокруг объекта',
    significantCount: n => `${n} значимых`,
    showMoreMagnets: n => `Показать ещё ${n} магнитов`,
    collapse: 'Свернуть',
    noOsm: 'По этому адресу объектов в базе OpenStreetMap не найдено.',
    loadingSteps: [
      'Анализируем локацию…',
      'Оцениваем спрос…',
      'Рассчитываем доход…',
    ],
    runStarted: 'расчёт запущен',
    sectionTitle: 'Анализ локации выполняется автоматически',
    sectionLead:
      'Введите адрес — магниты, конкуренты и оценка спроса считаются без ручного «исследования в Excel».',
    sectionSub1: 'ASI прогоняет расчёт; вы получаете сигналы для исполнения, а не презентацию для разбора.',
    sectionSub2:
      'Показывает, где сосредоточен целевой спрос — входы для объявлений и ценообразования.',
    envMapTitle: 'Карта окружения',
    tags: ['Показать объект', 'Транспорт', 'Места рядом', 'Открыть карту'],
    tryAnother: 'Проверить другой адрес',
    asiPanelTitle: 'ASI · Анализ локации',
    addrChosenLog: s => `адрес выбран · ${s}`,
    pickAddressErr: 'Выберите точный адрес из списка',
    submitIdle: 'Рассчитать локацию',
    osmNote: 'Используются реальные данные OpenStreetMap',
    strategyTitle: 'Рекомендуемая стратегия',
    strategyMidTerm: [
      'Лучше всего: среднесрочная аренда (1–3 месяца)',
      'Целевая аудитория: командировочные, переезды, временное проживание',
      'Стабилизируйте доход вместо погони за посуточным спросом',
    ],
    strategyHybrid: [
      'Комбинируйте краткосрочную и среднесрочную аренду',
      'Корректируйте цены по сезону',
      'Давайте скидки при длительном проживании',
    ],
    strategyShortTerm: [
      'Хорошие условия для посуточной аренды',
      'Фокус на загрузке и оптимизации цен',
      'Используйте пиковые сезоны',
    ],
  },
};

const MAGNET_WHY_EN: Record<string, string> = {
  metro:           'regional flow',
  railway_station: 'transit hub pull',
  attraction:      'tourism demand',
  university:      'education traffic',
  education_local: 'local schooling demand',
  entertainment:   'leisure footfall',
  shopping_major:  'retail traffic',
  shopping_local:  'neighborhood activity',
  business:        'business traffic',
  food:            'local dining activity',
};

const MAGNET_WHY_RU: Record<string, string> = {
  metro:           'региональный поток',
  railway_station: 'транспортный узел',
  attraction:      'туристический спрос',
  university:      'образовательный поток',
  education_local: 'локальный спрос',
  entertainment:   'досуговый трафик',
  shopping_major:  'торговый поток',
  shopping_local:  'жилая активность',
  business:        'деловой трафик',
  food:            'локальная активность',
};

export function magnetWhy(categoryId: string, locale: LocDemoLocale): string | undefined {
  const m = locale === 'ru' ? MAGNET_WHY_RU : MAGNET_WHY_EN;
  return m[categoryId];
}
