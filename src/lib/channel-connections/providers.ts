import type { ChannelManagerProvider, ChannelManagerProviderCode } from './types';

export const CHANNEL_MANAGER_PROVIDER_CODES: readonly ChannelManagerProviderCode[] = [
  'realtycalendar',
  'bnovo',
  'sutochno',
  'yandex_travel',
  'ozon_travel',
  'avito',
  'cian',
  'hotels_101',
  'otello',
  'manual_import',
  'future',
] as const;

export const CHANNEL_MANAGER_PROVIDERS: readonly ChannelManagerProvider[] = [
  {
    code: 'realtycalendar',
    displayName: 'RealtyCalendar',
    primaryMarket: 'ru',
    availability: 'foundation',
    kind: 'channel_manager',
    description:
      'Первый слой подключения: структура объектов, календарь, брони и базовые статусы через доступы владельца или провайдера.',
  },
  {
    code: 'bnovo',
    displayName: 'Bnovo',
    primaryMarket: 'ru',
    availability: 'foundation',
    kind: 'channel_manager',
    description:
      'Подключение через действующий менеджер каналов, чтобы не перестраивать рабочий процесс объекта с нуля.',
  },
  {
    code: 'sutochno',
    displayName: 'Суточно',
    primaryMarket: 'ru',
    availability: 'on_request',
    kind: 'ota_adapter',
    description:
      'Адаптер площадки подключается по заявке, когда у владельца есть нужные доступы и подтверждение со стороны площадки.',
  },
  {
    code: 'yandex_travel',
    displayName: 'Яндекс.Путешествия',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'ota_adapter',
    description: 'Планируем адаптер для бронирований и сверки данных. Сейчас это не live-интеграция.',
  },
  {
    code: 'ozon_travel',
    displayName: 'Ozon Travel',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'ota_adapter',
    description: 'Планируем адаптер для российского OTA-контура после базовых подключений через менеджеры каналов.',
  },
  {
    code: 'avito',
    displayName: 'Авито',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'marketplace_adapter',
    description: 'Планируем адаптер для объявлений и заявок, чтобы снизить ручную работу по площадке.',
  },
  {
    code: 'cian',
    displayName: 'ЦИАН',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'marketplace_adapter',
    description: 'Планируем адаптер для объявлений и входящих заявок. Старт зависит от доступов и правил площадки.',
  },
  {
    code: 'hotels_101',
    displayName: '101Hotels',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'ota_adapter',
    description: 'Плейсхолдер в дорожной карте для будущего адаптера, без обещания live-подключения сейчас.',
  },
  {
    code: 'otello',
    displayName: 'Отелло',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'ota_adapter',
    description: 'Плейсхолдер в дорожной карте для будущего адаптера, без обещания live-подключения сейчас.',
  },
  {
    code: 'manual_import',
    displayName: 'Ручной импорт',
    primaryMarket: 'ru',
    availability: 'available',
    kind: 'manual',
    description: 'Доступный базовый путь: загрузить данные вручную или полуавтоматически, пока адаптеры готовятся.',
  },
  {
    code: 'future',
    displayName: 'Другой менеджер каналов',
    primaryMarket: 'ru',
    availability: 'on_request',
    kind: 'custom',
    description: 'Если у вас уже есть другой менеджер каналов, ASI сначала проверит возможность подключиться к нему.',
  },
] as const;

export function getChannelManagerProvider(
  code: ChannelManagerProviderCode,
): ChannelManagerProvider | undefined {
  return CHANNEL_MANAGER_PROVIDERS.find((p) => p.code === code);
}

export function isRuFirstProvider(code: ChannelManagerProviderCode): boolean {
  return code !== 'future';
}
