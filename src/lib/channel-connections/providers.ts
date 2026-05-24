import type { ChannelManagerProvider, ChannelManagerProviderCode } from './types';

export const CHANNEL_MANAGER_PROVIDER_CODES: readonly ChannelManagerProviderCode[] = [
  'realtycalendar',
  'bnovo',
  'travelline',
  'manual_import',
  'future',
] as const;

export const CHANNEL_MANAGER_PROVIDERS: readonly ChannelManagerProvider[] = [
  {
    code: 'realtycalendar',
    displayName: 'RealtyCalendar',
    primaryMarket: 'ru',
    availability: 'coming_soon',
  },
  {
    code: 'bnovo',
    displayName: 'Bnovo',
    primaryMarket: 'ru',
    availability: 'coming_soon',
  },
  {
    code: 'travelline',
    displayName: 'TravelLine',
    primaryMarket: 'ru',
    availability: 'coming_soon',
  },
  {
    code: 'manual_import',
    displayName: 'Ручной импорт',
    primaryMarket: 'ru',
    availability: 'manual',
  },
  {
    code: 'future',
    displayName: 'Другой провайдер',
    primaryMarket: 'ru',
    availability: 'on_request',
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
