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
  | 'API-ready'
  | 'Активный API';

export type ChannelManagerChannelStatus =
  | 'Не подключен'
  | 'Черновик'
  | 'Требует настройки'
  | 'Готов'
  | 'Активен'
  | 'Ошибка'
  | 'Отключён';

export type ChannelManagerMockChannel = {
  name: string;
  status: ChannelManagerChannelStatus;
  connectionType: Exclude<ChannelManagerConnectionType, 'Активный API'>;
  readiness: string;
  lastUpdate: string;
  hasErrors: boolean;
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
    status: 'Готов',
    connectionType: 'Полуавтомат',
    readiness: '9 из 11 шагов',
    lastUpdate: 'Сегодня, 10:20',
    hasErrors: false,
  },
  {
    name: 'Яндекс Путешествия',
    status: 'Требует настройки',
    connectionType: 'API-ready',
    readiness: '7 из 11 шагов',
    lastUpdate: 'Вчера, 18:40',
    hasErrors: false,
  },
  {
    name: 'Авито',
    status: 'Черновик',
    connectionType: 'Ручное ведение',
    readiness: '6 из 11 шагов',
    lastUpdate: '2 дня назад',
    hasErrors: false,
  },
  {
    name: 'Суточно',
    status: 'Готов',
    connectionType: 'Полуавтомат',
    readiness: '9 из 11 шагов',
    lastUpdate: 'Сегодня, 09:15',
    hasErrors: false,
  },
  {
    name: 'Циан',
    status: 'Не подключен',
    connectionType: 'Ручное ведение',
    readiness: '4 из 11 шагов',
    lastUpdate: 'Нет обновлений',
    hasErrors: false,
  },
  {
    name: 'Прямой сайт',
    status: 'Активен',
    connectionType: 'Ручное ведение',
    readiness: '10 из 11 шагов',
    lastUpdate: 'Сегодня, 11:05',
    hasErrors: false,
  },
  {
    name: 'Внешний менеджер каналов',
    status: 'Отключён',
    connectionType: 'Через внешний менеджер каналов',
    readiness: 'Ожидает выбора системы',
    lastUpdate: 'Нет обновлений',
    hasErrors: false,
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
