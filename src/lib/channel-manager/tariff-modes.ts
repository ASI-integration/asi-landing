export type ChannelManagerTariffMode = 'manual' | 'assisted' | 'autopilot';

export type ChannelManagerFeature =
  | 'detailedChannels'
  | 'compactChannels'
  | 'readinessChecklist'
  | 'manualActions'
  | 'updateInstructions'
  | 'preparedChanges'
  | 'reviewActions'
  | 'updateQueue'
  | 'activityLog'
  | 'errors'
  | 'warnings'
  | 'recommendations'
  | 'priceRecommendations'
  | 'objectDataLink'
  | 'futureExport'
  | 'systemStatus'
  | 'activeChannels'
  | 'criticalErrors'
  | 'importantActions'
  | 'ownerLimits'
  | 'priceLimits'
  | 'pauseStub'
  | 'handoffStub';

export type ChannelManagerBlock =
  | 'channels'
  | 'readiness'
  | 'updates'
  | 'activity'
  | 'alerts'
  | 'recommendations'
  | 'manualActions'
  | 'preparedChanges'
  | 'systemStatus'
  | 'autopilotLimits'
  | 'objectData';

export type ChannelManagerConnectionType =
  | 'Ручное ведение'
  | 'Полуавтомат'
  | 'Через внешний менеджер каналов'
  | 'Подготовлен к API'
  | 'Активный API';

export type ChannelManagerChannelStatus =
  | 'Не подключен'
  | 'Черновик'
  | 'Требует настройки'
  | 'Готов к ручной публикации'
  | 'Активен вручную'
  | 'Ошибка'
  | 'Отключён';

export type ChannelManagerReadinessStatus = 'done' | 'missing' | 'review' | 'not_required';

export type ChannelManagerChecklistItem = {
  label: string;
  status: ChannelManagerReadinessStatus;
};

export type ChannelManagerMockChannel = {
  name: string;
  status: ChannelManagerChannelStatus;
  connectionType: Exclude<ChannelManagerConnectionType, 'Активный API'>;
  readiness: string;
  lastUpdate: string;
  hasErrors: boolean;
  warningMessages: string[];
  nextManualAction: string;
  checklist: ChannelManagerChecklistItem[];
};

export type ChannelManagerManualActionStatus =
  | 'Ожидает выполнения'
  | 'В работе'
  | 'Выполнено'
  | 'Требует проверки'
  | 'Ошибка';

export type ChannelManagerManualAction = {
  id: string;
  channel: string;
  actionType: string;
  priority: 'Высокий' | 'Средний' | 'Низкий';
  status: ChannelManagerManualActionStatus;
  hint: string;
};

export type ChannelManagerTransferItem = {
  id: string;
  title: string;
  status: ChannelManagerReadinessStatus;
  text: string;
};

export type ChannelManagerManualLogItem = {
  id: string;
  dateTime: string;
  channel: string;
  action: string;
  result: string;
  actor: 'Оператор' | 'Система';
  comment: string;
};

export type ChannelManagerModeConfig = {
  id: ChannelManagerTariffMode;
  label: string;
  shortLabel: string;
  summary: string;
  features: ChannelManagerFeature[];
  visibleBlocks: ChannelManagerBlock[];
};

export const CHANNEL_MANAGER_MODES: Record<ChannelManagerTariffMode, ChannelManagerModeConfig> = {
  manual: {
    id: 'manual',
    label: 'Ручной режим',
    shortLabel: 'Ручной',
    summary: 'Максимум деталей, чек-листы, инструкции и ручные действия для команды.',
    features: [
      'detailedChannels',
      'readinessChecklist',
      'manualActions',
      'updateInstructions',
      'updateQueue',
      'activityLog',
      'errors',
      'recommendations',
      'objectDataLink',
      'futureExport',
    ],
    visibleBlocks: [
      'channels',
      'readiness',
      'manualActions',
      'updates',
      'activity',
      'alerts',
      'recommendations',
      'objectData',
    ],
  },
  assisted: {
    id: 'assisted',
    label: 'Полуавтомат',
    shortLabel: 'Полуавтомат',
    summary: 'ASI готовит изменения, владелец проверяет и подтверждает перед отправкой.',
    features: [
      'compactChannels',
      'preparedChanges',
      'reviewActions',
      'updateQueue',
      'warnings',
      'activityLog',
      'objectDataLink',
      'priceRecommendations',
    ],
    visibleBlocks: [
      'channels',
      'preparedChanges',
      'updates',
      'alerts',
      'activity',
      'recommendations',
      'objectData',
    ],
  },
  autopilot: {
    id: 'autopilot',
    label: 'Автопилот',
    shortLabel: 'Автопилот',
    summary: 'Система показывает статус, важные события, ограничения и критические ошибки.',
    features: [
      'systemStatus',
      'activeChannels',
      'criticalErrors',
      'importantActions',
      'ownerLimits',
      'priceLimits',
      'pauseStub',
      'handoffStub',
    ],
    visibleBlocks: ['systemStatus', 'channels', 'alerts', 'activity', 'autopilotLimits', 'objectData'],
  },
};

export const CHANNEL_MANAGER_MOCK_CHANNELS: ChannelManagerMockChannel[] = [
  {
    name: 'Островок',
    status: 'Готов к ручной публикации',
    connectionType: 'Полуавтомат',
    readiness: '9 из 11 шагов',
    lastUpdate: 'Сегодня, 10:20',
    hasErrors: false,
    warningMessages: ['Календарь доступности требует сверки перед публикацией.'],
    nextManualAction: 'Закрыть занятые даты на площадке и проверить базовую цену.',
    checklist: [
      { label: 'Основные данные объекта', status: 'done' },
      { label: 'Фото', status: 'done' },
      { label: 'Описание', status: 'done' },
      { label: 'Правила проживания', status: 'done' },
      { label: 'Условия заселения', status: 'done' },
      { label: 'Wi-Fi', status: 'done' },
      { label: 'Базовые цены', status: 'review' },
      { label: 'Календарь доступности', status: 'review' },
      { label: 'Ограничения', status: 'done' },
      { label: 'Комиссии/сборы', status: 'done' },
      { label: 'Условия отмены', status: 'missing' },
    ],
  },
  {
    name: 'Яндекс Путешествия',
    status: 'Требует настройки',
    connectionType: 'Подготовлен к API',
    readiness: '7 из 11 шагов',
    lastUpdate: 'Вчера, 18:40',
    hasErrors: false,
    warningMessages: ['Цены подготовлены, но не подтверждены вручную.'],
    nextManualAction: 'Обновить цены и проверить условия отмены в личном кабинете площадки.',
    checklist: [
      { label: 'Основные данные объекта', status: 'done' },
      { label: 'Фото', status: 'done' },
      { label: 'Описание', status: 'done' },
      { label: 'Правила проживания', status: 'review' },
      { label: 'Условия заселения', status: 'done' },
      { label: 'Wi-Fi', status: 'done' },
      { label: 'Базовые цены', status: 'review' },
      { label: 'Календарь доступности', status: 'missing' },
      { label: 'Ограничения', status: 'done' },
      { label: 'Комиссии/сборы', status: 'not_required' },
      { label: 'Условия отмены', status: 'missing' },
    ],
  },
  {
    name: 'Авито',
    status: 'Черновик',
    connectionType: 'Ручное ведение',
    readiness: '6 из 11 шагов',
    lastUpdate: '2 дня назад',
    hasErrors: false,
    warningMessages: ['Описание и ограничения ещё нужно перенести вручную.'],
    nextManualAction: 'Скопировать описание объекта и заполнить ограничения.',
    checklist: [
      { label: 'Основные данные объекта', status: 'done' },
      { label: 'Фото', status: 'review' },
      { label: 'Описание', status: 'missing' },
      { label: 'Правила проживания', status: 'done' },
      { label: 'Условия заселения', status: 'done' },
      { label: 'Wi-Fi', status: 'done' },
      { label: 'Базовые цены', status: 'missing' },
      { label: 'Календарь доступности', status: 'not_required' },
      { label: 'Ограничения', status: 'missing' },
      { label: 'Комиссии/сборы', status: 'not_required' },
      { label: 'Условия отмены', status: 'not_required' },
    ],
  },
  {
    name: 'Суточно',
    status: 'Готов к ручной публикации',
    connectionType: 'Полуавтомат',
    readiness: '9 из 11 шагов',
    lastUpdate: 'Сегодня, 09:15',
    hasErrors: false,
    warningMessages: ['Фото нужно просмотреть после ручной загрузки.'],
    nextManualAction: 'Проверить порядок фото и правила проживания.',
    checklist: [
      { label: 'Основные данные объекта', status: 'done' },
      { label: 'Фото', status: 'review' },
      { label: 'Описание', status: 'done' },
      { label: 'Правила проживания', status: 'review' },
      { label: 'Условия заселения', status: 'done' },
      { label: 'Wi-Fi', status: 'done' },
      { label: 'Базовые цены', status: 'done' },
      { label: 'Календарь доступности', status: 'done' },
      { label: 'Ограничения', status: 'done' },
      { label: 'Комиссии/сборы', status: 'not_required' },
      { label: 'Условия отмены', status: 'missing' },
    ],
  },
  {
    name: 'Циан',
    status: 'Не подключен',
    connectionType: 'Ручное ведение',
    readiness: '4 из 11 шагов',
    lastUpdate: 'Нет обновлений',
    hasErrors: false,
    warningMessages: ['Канал не выбран для публикации.'],
    nextManualAction: 'Проверить, нужен ли канал для текущего объекта.',
    checklist: [
      { label: 'Основные данные объекта', status: 'done' },
      { label: 'Фото', status: 'missing' },
      { label: 'Описание', status: 'missing' },
      { label: 'Правила проживания', status: 'review' },
      { label: 'Условия заселения', status: 'done' },
      { label: 'Wi-Fi', status: 'done' },
      { label: 'Базовые цены', status: 'missing' },
      { label: 'Календарь доступности', status: 'not_required' },
      { label: 'Ограничения', status: 'missing' },
      { label: 'Комиссии/сборы', status: 'not_required' },
      { label: 'Условия отмены', status: 'not_required' },
    ],
  },
  {
    name: 'Прямой сайт',
    status: 'Активен вручную',
    connectionType: 'Ручное ведение',
    readiness: '10 из 11 шагов',
    lastUpdate: 'Сегодня, 11:05',
    hasErrors: false,
    warningMessages: [],
    nextManualAction: 'Проверить текст краткого описания после обновления карточки объекта.',
    checklist: [
      { label: 'Основные данные объекта', status: 'done' },
      { label: 'Фото', status: 'done' },
      { label: 'Описание', status: 'done' },
      { label: 'Правила проживания', status: 'done' },
      { label: 'Условия заселения', status: 'done' },
      { label: 'Wi-Fi', status: 'done' },
      { label: 'Базовые цены', status: 'done' },
      { label: 'Календарь доступности', status: 'done' },
      { label: 'Ограничения', status: 'review' },
      { label: 'Комиссии/сборы', status: 'not_required' },
      { label: 'Условия отмены', status: 'done' },
    ],
  },
  {
    name: 'Внешний менеджер каналов',
    status: 'Отключён',
    connectionType: 'Через внешний менеджер каналов',
    readiness: 'Ожидает выбора системы',
    lastUpdate: 'Нет обновлений',
    hasErrors: false,
    warningMessages: ['Система не выбрана. Сверка календаря выполняется вручную.'],
    nextManualAction: 'Выбрать внешний менеджер или оставить ручную сверку календаря.',
    checklist: [
      { label: 'Основные данные объекта', status: 'done' },
      { label: 'Фото', status: 'not_required' },
      { label: 'Описание', status: 'not_required' },
      { label: 'Правила проживания', status: 'review' },
      { label: 'Условия заселения', status: 'review' },
      { label: 'Wi-Fi', status: 'not_required' },
      { label: 'Базовые цены', status: 'review' },
      { label: 'Календарь доступности', status: 'missing' },
      { label: 'Ограничения', status: 'review' },
      { label: 'Комиссии/сборы', status: 'missing' },
      { label: 'Условия отмены', status: 'not_required' },
    ],
  },
];

export const CHANNEL_MANAGER_MANUAL_ACTIONS: ChannelManagerManualAction[] = [
  {
    id: 'avito-description',
    channel: 'Авито',
    actionType: 'Скопировать описание',
    priority: 'Высокий',
    status: 'Ожидает выполнения',
    hint: 'Перенесите описание и проверьте, что текст не обрезан.',
  },
  {
    id: 'sutochno-photos',
    channel: 'Суточно',
    actionType: 'Проверить фото',
    priority: 'Средний',
    status: 'Требует проверки',
    hint: 'Сверьте обложку, порядок фото и подписи.',
  },
  {
    id: 'yandex-prices',
    channel: 'Яндекс Путешествия',
    actionType: 'Обновить цены',
    priority: 'Высокий',
    status: 'В работе',
    hint: 'Проверьте базовую цену и минимальный срок проживания.',
  },
  {
    id: 'ostrovok-calendar',
    channel: 'Островок',
    actionType: 'Закрыть занятые даты',
    priority: 'Высокий',
    status: 'Ожидает выполнения',
    hint: 'Сверьте календарь с текущими бронями перед публикацией.',
  },
  {
    id: 'cian-rules',
    channel: 'Циан',
    actionType: 'Проверить правила проживания',
    priority: 'Низкий',
    status: 'Ожидает выполнения',
    hint: 'Канал пока не подключен, но правила можно подготовить заранее.',
  },
  {
    id: 'external-calendar',
    channel: 'Внешний менеджер каналов',
    actionType: 'Сверить календарь',
    priority: 'Средний',
    status: 'Ошибка',
    hint: 'Система не выбрана, действие остаётся ручной задачей.',
  },
];

export const CHANNEL_MANAGER_TRANSFER_ITEMS: ChannelManagerTransferItem[] = [
  {
    id: 'description',
    title: 'Описание объекта',
    status: 'done',
    text: 'Светлая квартира для краткосрочного проживания рядом с транспортом. Подходит для гостей, которым важны спокойный заезд, чистота и понятные правила.',
  },
  {
    id: 'short-description',
    title: 'Краткое описание',
    status: 'done',
    text: 'Уютный объект с самостоятельным заселением, Wi-Fi и базовыми удобствами для поездки.',
  },
  {
    id: 'rules',
    title: 'Правила проживания',
    status: 'review',
    text: 'Не курить в помещении. Соблюдать тишину после 22:00. Размещение с животными согласуется заранее.',
  },
  {
    id: 'check-in',
    title: 'Инструкция заселения',
    status: 'done',
    text: 'Инструкция отправляется гостю после подтверждения бронирования. Код доступа и детали входа нужно сверить перед заездом.',
  },
  {
    id: 'wifi',
    title: 'Wi-Fi и доступ',
    status: 'done',
    text: 'Wi-Fi готов к ручному переносу. Название сети и пароль хранятся в данных объекта.',
  },
  {
    id: 'base-prices',
    title: 'Базовые цены',
    status: 'review',
    text: 'Базовая цена подготовлена. Перед публикацией проверьте цену на самой площадке.',
  },
  {
    id: 'restrictions',
    title: 'Ограничения',
    status: 'missing',
    text: 'Откройте данные объекта, чтобы заполнить этот раздел.',
  },
];

export const CHANNEL_MANAGER_MANUAL_WARNINGS = [
  'Реальные отправки на площадки отключены',
  'Ручной режим не меняет данные на OTA автоматически',
  'Перед публикацией проверьте цены, календарь и правила на самой площадке',
  'Если данные объекта изменились, обновите их вручную на подключённых площадках',
];

export const CHANNEL_MANAGER_MANUAL_LOG: ChannelManagerManualLogItem[] = [
  {
    id: 'log-avito-prepared',
    dateTime: 'Сегодня, 10:20',
    channel: 'Авито',
    action: 'Подготовлены данные для ручного переноса на Авито',
    result: 'Ожидает выполнения',
    actor: 'Система',
    comment: 'Описание и правила готовы к копированию.',
  },
  {
    id: 'log-yandex-readiness',
    dateTime: 'Вчера, 18:40',
    channel: 'Яндекс Путешествия',
    action: 'Проверка готовности для Яндекс Путешествий',
    result: 'Требует проверки',
    actor: 'Оператор',
    comment: 'Цены нужно подтвердить в личном кабинете площадки.',
  },
  {
    id: 'log-price-confirmation',
    dateTime: 'Вчера, 17:10',
    channel: 'Островок',
    action: 'Обновление цен ожидает ручного подтверждения',
    result: 'В работе',
    actor: 'Система',
    comment: 'Отправка на площадку не выполнялась.',
  },
];

export function normalizeChannelManagerMode(value: string | string[] | undefined): ChannelManagerTariffMode {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'assisted' || raw === 'autopilot' || raw === 'manual') return raw;
  return 'manual';
}

export function channelManagerModeHasFeature(
  mode: ChannelManagerTariffMode,
  feature: ChannelManagerFeature,
): boolean {
  return CHANNEL_MANAGER_MODES[mode].features.includes(feature);
}

export function channelManagerModeShowsBlock(mode: ChannelManagerTariffMode, block: ChannelManagerBlock): boolean {
  return CHANNEL_MANAGER_MODES[mode].visibleBlocks.includes(block);
}
