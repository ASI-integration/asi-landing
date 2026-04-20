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
  if (!cat) {
    // Never leak technical category ids into UI.
    return locale === 'ru' ? 'Точка спроса' : 'Demand driver';
  }
  const label = locale === 'ru' ? cat.labelRu : cat.label;
  return label?.trim() ? label : (locale === 'ru' ? 'Точка спроса' : 'Demand driver');
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
    tagTooltips: string[];
    mapFeedback: {
      showingProperty: string;
      showingNearbyPlaces: string;
      openingFullMap: string;
    };
    openInGoogleMaps: string;
    openInAppleMaps: string;
    routeTransit: string;
    openMapNewTab: string;
    tryAnother: string;
    asiPanelTitle: string;
    addrChosenLog: (s: string) => string;
    pickAddressErr: string;
    submitIdle: string;
    /** Shown on the idle map when no coordinates are pinned yet */
    idleMapAnalysisLead: string;
    /** After failed POST /api/location-geocode from the main CTA */
    fallbackGeocodeFailed: string;
    /** Main CTA label while plain geocoding runs (no list selection yet) */
    submitGeocodingAddress: string;
    osmNote: string;
    strategyTitle: string;
    strategyMidTerm: string[];
    strategyHybrid: string[];
    strategyShortTerm: string[];
    marketSnapshotTitle: string;
    marketRows: {
      locationScore: string;
      demandLevel: string;
      demandStability: string;
      competitors500m: string;
      avgAdr: string;
      estOccupancy: string;
      revpar: string;
      strategy: string;
    };
    marketTooltips: {
      demandStability: string;
      avgAdr: string;
      revpar: string;
    };
    incomeTitle: string;
    incomeSuffix: string;
    incomeDisclaimer1: string;
    incomeDisclaimer2: string;
    incomeDisclaimer3: string;
    incomeStrategyLabel: (strategy: 'short_term' | 'hybrid' | 'mid_term') => string;
    ctaBlock: {
      title: string;
      body: string;
      button: string;
      note: string;
    };
    analysisFreshness: {
      justUpdated: string;
      updatedMinutesAgo: (m: number) => string;
      updatedHoursAgo: (h: number) => string;
      updatedOn: (iso: string) => string;
      dataCurrent: string;
      dataUpdating: string;
      snapshotStale: string;
      simplifiedMode: string;
      sourceOpenStreetMap: string;
      sourceCache: string;
      sourceCacheUpdating: string;
      sourceFresh: string;
    };
    envBlockTitle: string;
    envLayerLead: string;
    envLayerScoreLabel: string;
    envConfidence: (c: 'high' | 'medium' | 'low') => string;
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
    evergreenLine1: 'Location',
    evergreenLine2: 'Score',
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
    tagTooltips: [
      'Show exact property location on the map',
      'View nearby transport options (roads, public transit)',
      'Show nearby demand generators (restaurants, stores, hotels)',
      'Open full interactive map in a new tab',
    ],
    mapFeedback: {
      showingProperty: 'Showing property location...',
      showingNearbyPlaces: 'Showing nearby places...',
      openingFullMap: 'Opening full map...',
    },
    openInGoogleMaps: 'Open in Google Maps',
    openInAppleMaps: 'Open in Apple Maps',
    routeTransit: 'Transit directions',
    openMapNewTab: 'Open full map (new tab)',
    tryAnother: 'Try another address',
    asiPanelTitle: 'ASI · Location analysis',
    addrChosenLog: s => `address selected · ${s}`,
    pickAddressErr:
      'Enter at least 2 characters. Pick a suggestion, or tap Analyze to resolve what you typed.',
    submitIdle: 'Analyze location',
    idleMapAnalysisLead:
      'Pick a suggestion from the list, or tap Analyze — we will try to geocode the address you typed.',
    fallbackGeocodeFailed:
      'Could not resolve that address. Add a city or pick a suggestion when available.',
    submitGeocodingAddress: 'Resolving address…',
    osmNote: 'Uses live OpenStreetMap data',
    strategyTitle: 'Recommended Strategy',
    strategyMidTerm: [
      'Best use: Mid-term rentals (1–3 months)',
      'Target audience: contractors, relocations, temporary stays',
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
    marketSnapshotTitle: 'Market Snapshot',
    marketRows: {
      locationScore: 'Location Score',
      demandLevel: 'Demand Level',
      demandStability: 'Demand Stability',
      competitors500m: 'Competitors (500m)',
      avgAdr: 'Avg ADR',
      estOccupancy: 'Est. Occupancy',
      revpar: 'RevPAR',
      strategy: 'Strategy',
    },
    marketTooltips: {
      demandStability: 'How consistent demand is over time, adjusted for seasonality and competition',
      avgAdr: 'Average daily rate based on nearby listings',
      revpar: 'Revenue per available rental night',
    },
    incomeTitle: 'Estimated Monthly Income',
    incomeSuffix: '/ mo',
    incomeDisclaimer1: 'Before expenses and management fees',
    incomeDisclaimer2: 'Estimated using market data (Zillow, Airbnb comps, local demand signals)',
    incomeDisclaimer3: 'Range varies by occupancy, seasonality, and pricing strategy',
    incomeStrategyLabel: (s) =>
      s === 'short_term' ? 'short-term rental model'
      : s === 'hybrid'   ? 'hybrid (short + mid-term) model'
      :                    'mid-term rental model',
    ctaBlock: {
      title: 'Want a full breakdown?',
      body: 'Get detailed revenue model, pricing strategy, and demand analysis for this location.',
      button: 'Start analyzing properties',
      note: 'First report free',
    },
    analysisFreshness: {
      justUpdated: 'Just updated',
      updatedMinutesAgo: (m) => `Updated ${m} min ago`,
      updatedHoursAgo: (h) => `Updated ${h} h ago`,
      updatedOn: (iso) => `Updated ${new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      dataCurrent: 'Data current',
      dataUpdating: 'Data updating',
      snapshotStale: 'Snapshot slightly stale',
      simplifiedMode: 'simplified mode',
      sourceOpenStreetMap: 'OpenStreetMap',
      sourceCache: 'cache',
      sourceCacheUpdating: 'cache (updating)',
      sourceFresh: 'fresh data',
    },
    envBlockTitle: 'Comfort & surroundings',
    envLayerLead:
      'Neutral OSM infrastructure cues only — not the commercial location score (roads, industry, aviation, transit density, nightlife).',
    envLayerScoreLabel: 'Environmental load',
    envConfidence: (c) =>
      c === 'high' ? 'High map coverage confidence'
      : c === 'medium' ? 'Medium map coverage confidence'
      : 'Low map coverage confidence',
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
    evergreenLine1: 'Индекс',
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
    sectionTitle: 'Оцените потенциал вашего объекта',
    sectionLead:
      'Введите адрес — система покажет реальный спрос, конкурентов и ориентир по доходу на основе фактических данных, а не усреднённых отчётов.',
    sectionSub1:
      'Подходит для инвесторов, управляющих и собственников,\nкоторые принимают решения на основе цифр',
    sectionSub2: '',
    envMapTitle: 'Карта окружения',
    tags: ['Показать объект', 'Места рядом'],
    tagTooltips: [
      'Показать точку объекта на карте',
      'Показать теплокарту влияния рядом',
    ],
    mapFeedback: {
      showingProperty: 'Показываем объект на карте…',
      showingNearbyPlaces: 'Показываем теплокарту…',
      openingFullMap: 'Открываем карту…',
    },
    openInGoogleMaps: 'Открыть в Google Maps',
    openInAppleMaps: 'Открыть в Apple Maps',
    routeTransit: 'Маршрут (общественный транспорт)',
    openMapNewTab: 'Открыть карту (в новой вкладке)',
    tryAnother: 'Проверить другой адрес',
    asiPanelTitle: 'ASI · Анализ локации',
    addrChosenLog: s => `адрес выбран · ${s}`,
    pickAddressErr:
      'Введите не короче 2 символов: выберите подсказку или нажмите «Рассчитать локацию», чтобы искать по тексту.',
    submitIdle: 'Рассчитать локацию',
    idleMapAnalysisLead:
      'Выберите подсказку из списка или нажмите «Рассчитать локацию» — мы попробуем найти координаты по введённому адресу.',
    fallbackGeocodeFailed:
      'Не удалось найти координаты. Уточните адрес (добавьте город) или выберите подсказку, если она появится.',
    submitGeocodingAddress: 'Ищем координаты…',
    osmNote: 'Используются реальные данные OpenStreetMap',
    strategyTitle: 'Рекомендуемая стратегия',
    strategyMidTerm: [
      'Лучше всего: среднесрочная аренда (1–3 месяца)',
      'Целевая аудитория: командированные, переезды, временное проживание',
      'Контракты с корпоративными клиентами — ключ к стабильной загрузке',
    ],
    strategyHybrid: [
      'Комбинируйте посуточную и среднесрочную аренду',
      'В будни — деловые гости, в выходные — досуговый сегмент',
      'Скидки при длительном проживании для корпоративных бронирований',
    ],
    strategyShortTerm: [
      'Сильная локация для делового потока и командированных',
      'Основной спрос формируется за счёт деловых магнитов',
      'Фокус на корпоративных каналах, загрузке и динамическом ценообразовании',
    ],
    marketSnapshotTitle: 'Снимок рынка',
    marketRows: {
      locationScore: 'Индекс локации',
      demandLevel: 'Профиль спроса',
      demandStability: 'Устойчивость спроса',
      competitors500m: 'Конкуренты (500 м)',
      avgAdr: 'Средний ADR',
      estOccupancy: 'Оценка загрузки',
      revpar: 'RevPAR',
      strategy: 'Стратегия',
    },
    marketTooltips: {
      demandStability: 'Насколько спрос стабилен во времени с учётом сезонности и конкуренции',
      avgAdr: 'Средняя цена ночи по ближайшим размещениям',
      revpar: 'Доход на доступную ночь аренды',
    },
    incomeTitle: 'Оценка дохода в месяц',
    incomeSuffix: '/ мес',
    incomeDisclaimer1: 'До расходов и комиссий управления',
    incomeDisclaimer2: 'Оценка по рыночным данным (аналоги STR-объектов в России, сигналы спроса)',
    incomeDisclaimer3: 'Диапазон зависит от загрузки, сезонности и стратегии ценообразования',
    incomeStrategyLabel: (s) =>
      s === 'short_term' ? 'посуточная аренда'
      : s === 'hybrid'   ? 'гибридная модель (посуточная + среднесрочная)'
      :                    'среднесрочная аренда',
    ctaBlock: {
      title: 'Хотите подробный расчёт?',
      body: 'Сделаем модель дохода, стратегию цен и разбор спроса по этой локации.',
      button: 'Получить разбор',
      note: 'Первый разбор — бесплатно',
    },
    analysisFreshness: {
      justUpdated: 'только что обновлено',
      updatedMinutesAgo: (m) => `обновлено ${m} мин назад`,
      updatedHoursAgo: (h) => `обновлено ${h} ч назад`,
      updatedOn: (iso) => `обновлено ${new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      dataCurrent: 'данные актуальны',
      dataUpdating: 'данные обновляются',
      snapshotStale: 'снимок немного устарел',
      simplifiedMode: 'упрощённый режим',
      sourceOpenStreetMap: 'OpenStreetMap',
      sourceCache: 'кэш',
      sourceCacheUpdating: 'кэш (обновляется)',
      sourceFresh: 'свежие данные',
    },
    envBlockTitle: 'Комфорт и среда',
    envLayerLead:
      'Нейтральные признаки по OpenStreetMap, отдельно от коммерческого индекса: магистрали, промзона и логистика, авиация, транзит, ночные заведения.',
    envLayerScoreLabel: 'Нагрузка среды',
    envConfidence: (c) =>
      c === 'high' ? 'Высокая уверенность по данным карты'
      : c === 'medium' ? 'Средняя уверенность по данным карты'
      : 'Низкая уверенность по данным карты',
  },
};

const MAGNET_WHY_EN: Record<string, string> = {
  metro:           'regional flow — reliable year-round demand',
  airport:         'air hub — strong traveler and business flow',
  attraction:      'tourist anchor — consistent leisure demand',
  hospital:        'medical cluster — steady staff & visitor demand',
  major_hotel:     'quality signal — commercially validated area',
  convention:      'conference hub — corporate demand spikes',
  university:      'education cluster — recurring semester demand',
  business:        'office / industrial zone — corporate travel flow',
  railway_station: 'transit hub — stable transport and business demand',
  entertainment:   'leisure venue — footfall driver',
  shopping_major:  'retail anchor — sustained visitor traffic',
  stadium:         'event venue — periodic occupancy spikes',
  education_local: 'local schooling demand',
  shopping_local:  'neighborhood activity',
  food:            'local dining cluster',
};

const MAGNET_WHY_RU: Record<string, string> = {
  metro:           'стабильный деловой и транзитный поток',
  airport:         'аэропорт — деловые и туристические гости',
  attraction:      'туристический якорь — постоянный спрос',
  hospital:        'медкластер — персонал и посетители',
  major_hotel:     'индикатор качества — подтверждённая ниша',
  convention:      'конгресс-центр — корпоративный поток',
  university:      'университет — образовательный спрос',
  business:        'деловая зона — командированные',
  railway_station: 'транспортный узел — деловой трафик',
  entertainment:   'досуговый трафик',
  shopping_major:  'торговый поток',
  stadium:         'стадион — периодические пики спроса',
  education_local: 'локальный спрос',
  shopping_local:  'жилая активность',
  food:            'кластер кафе / ресторанов',
};

export function magnetWhy(categoryId: string, locale: LocDemoLocale): string | undefined {
  const m = locale === 'ru' ? MAGNET_WHY_RU : MAGNET_WHY_EN;
  return m[categoryId];
}
