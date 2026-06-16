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
      'Пилотный режим: фиксируем текущую структуру объектов, календарь, брони и базовые статусы.',
  },
  {
    code: 'bnovo',
    displayName: 'Bnovo',
    primaryMarket: 'ru',
    availability: 'foundation',
    kind: 'channel_manager',
    description:
      'Пилотный режим: проверяем, как работать через действующий менеджер каналов без перестройки процесса.',
  },
  {
    code: 'sutochno',
    displayName: 'Суточно',
    primaryMarket: 'ru',
    availability: 'on_request',
    kind: 'ota_adapter',
    description:
      'На пилоте подключается вручную после проверки объекта, доступов и текущей схемы работы.',
  },
  {
    code: 'yandex_travel',
    displayName: 'Яндекс.Путешествия',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'ota_adapter',
    description: 'Скоро: начнём с ручной сверки данных и 1-2 тестовых сценариев.',
  },
  {
    code: 'ozon_travel',
    displayName: 'Ozon Travel',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'ota_adapter',
    description: 'Скоро: подключение рассматривается после базовой проверки менеджера каналов.',
  },
  {
    code: 'avito',
    displayName: 'Авито',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'marketplace_adapter',
    description: 'Скоро: сначала фиксируем объявления и заявки вручную, затем выбираем тестовый сценарий.',
  },
  {
    code: 'cian',
    displayName: 'ЦИАН',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'marketplace_adapter',
    description: 'Скоро: старт зависит от текущих доступов, правил площадки и выбранного объекта.',
  },
  {
    code: 'hotels_101',
    displayName: '101Hotels',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'ota_adapter',
    description: 'Скоро: сейчас можно зафиксировать площадку в заявке и вернуться к ней после базового теста.',
  },
  {
    code: 'otello',
    displayName: 'Отелло',
    primaryMarket: 'ru',
    availability: 'planned',
    kind: 'ota_adapter',
    description: 'Скоро: сейчас можно зафиксировать площадку в заявке и вернуться к ней после базового теста.',
  },
  {
    code: 'manual_import',
    displayName: 'Ручной импорт',
    primaryMarket: 'ru',
    availability: 'available',
    kind: 'manual',
    description: 'Доступный базовый путь: загрузить данные вручную, пока подключения готовятся.',
  },
  {
    code: 'future',
    displayName: 'Другой менеджер каналов',
    primaryMarket: 'ru',
    availability: 'on_request',
    kind: 'custom',
    description: 'Если у вас уже есть другой менеджер каналов, сначала проверим его вручную.',
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
