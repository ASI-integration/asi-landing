export type ChannelManagerApiStatus =
  | 'confirmed'
  | 'unknown'
  | 'unavailable'
  | 'partner_access_required';

export type ChannelManagerSupportedFeatures = {
  propertyExport: boolean;
  rates: boolean;
  availability: boolean;
  bookingsImport: boolean;
  messages: boolean;
};

export type ChannelManagerRegistryEntry = {
  id: string;
  name: string;
  displayName: string;
  apiStatus: ChannelManagerApiStatus;
  apiNotes: string;
  supportedFeatures: ChannelManagerSupportedFeatures;
  requiresOperator: boolean;
  ownerAccessRequired: boolean;
  publicLabel: string;
};

const UNKNOWN_FEATURES: ChannelManagerSupportedFeatures = {
  propertyExport: false,
  rates: false,
  availability: false,
  bookingsImport: false,
  messages: false,
};

export const CHANNEL_MANAGER_REGISTRY: ChannelManagerRegistryEntry[] = [
  {
    id: 'bnovo',
    name: 'bnovo',
    displayName: 'Bnovo',
    apiStatus: 'partner_access_required',
    apiNotes: 'В проекте есть выбор Bnovo в потоке подключения; публичный API для ASI не подтверждён в коде.',
    supportedFeatures: UNKNOWN_FEATURES,
    requiresOperator: true,
    ownerAccessRequired: true,
    publicLabel: 'Bnovo',
  },
  {
    id: 'realtycalendar',
    name: 'realtycalendar',
    displayName: 'RealtyCalendar',
    apiStatus: 'partner_access_required',
    apiNotes: 'В проекте есть выбор RealtyCalendar в потоке подключения; публичный API для ASI не подтверждён в коде.',
    supportedFeatures: UNKNOWN_FEATURES,
    requiresOperator: true,
    ownerAccessRequired: true,
    publicLabel: 'RealtyCalendar',
  },
  {
    id: 'travelline',
    name: 'travelline',
    displayName: 'TravelLine',
    apiStatus: 'partner_access_required',
    apiNotes: 'Упоминается в продуктовых материалах; прямое API-подключение ASI в коде не подтверждено.',
    supportedFeatures: UNKNOWN_FEATURES,
    requiresOperator: true,
    ownerAccessRequired: true,
    publicLabel: 'TravelLine',
  },
  {
    id: 'kontur_hotel',
    name: 'kontur_hotel',
    displayName: 'Контур.Отель',
    apiStatus: 'unknown',
    apiNotes: 'Нет подтверждённой интеграции в коде проекта.',
    supportedFeatures: UNKNOWN_FEATURES,
    requiresOperator: true,
    ownerAccessRequired: true,
    publicLabel: 'Контур.Отель',
  },
  {
    id: 'shelter',
    name: 'shelter',
    displayName: 'Shelter',
    apiStatus: 'unknown',
    apiNotes: 'Нет подтверждённой интеграции в коде проекта.',
    supportedFeatures: UNKNOWN_FEATURES,
    requiresOperator: true,
    ownerAccessRequired: true,
    publicLabel: 'Shelter',
  },
  {
    id: 'other',
    name: 'other',
    displayName: 'Другое',
    apiStatus: 'unknown',
    apiNotes: 'Менеджер каналов не из списка — нужна ручная проверка оператором.',
    supportedFeatures: UNKNOWN_FEATURES,
    requiresOperator: true,
    ownerAccessRequired: true,
    publicLabel: 'Другой менеджер каналов',
  },
  {
    id: 'unknown_later',
    name: 'unknown_later',
    displayName: 'Не помню / уточню позже',
    apiStatus: 'unknown',
    apiNotes: 'Владелец уточнит менеджер каналов позже.',
    supportedFeatures: UNKNOWN_FEATURES,
    requiresOperator: true,
    ownerAccessRequired: false,
    publicLabel: 'Уточнит позже',
  },
];

export function getChannelManagerById(id: string): ChannelManagerRegistryEntry | undefined {
  return CHANNEL_MANAGER_REGISTRY.find((entry) => entry.id === id);
}

export function channelManagerDisplayName(id: string | undefined): string | null {
  if (!id) return null;
  return getChannelManagerById(id)?.displayName ?? null;
}
