import type {
  ChannelCapability,
  ChannelCode,
  ChannelManagerChannel,
  ChannelOperation,
  ChannelReservation,
  InventoryDay,
} from './types';
import { BronevikMtsTravelRealAdapter } from './bronevik-mts-real-adapter';

export interface AvailabilitySyncPayload {
  channel: ChannelManagerChannel;
  listingId?: string;
  propertyId: string;
  unitKey: string;
  days: InventoryDay[];
}

export interface RateSyncPayload {
  propertyId: string;
  unitKey: string;
  dateFrom: string;
  dateTo: string;
  priceByDay: Record<string, number>;
}

export interface RestrictionSyncPayload {
  propertyId: string;
  unitKey: string;
  dateFrom: string;
  dateTo: string;
  minStay?: number;
  closedToArrival?: boolean;
}

export interface AdapterCredentials {
  values: Record<string, string | undefined>;
}

export type AdapterResult = {
  ok: boolean;
  message: string;
  externalCalls: number;
  details?: Record<string, unknown>;
};

export interface ChannelAdapter {
  code: ChannelCode;
  pushAvailability(payload: AvailabilitySyncPayload): Promise<AdapterResult>;
  pushRates(payload: RateSyncPayload): Promise<AdapterResult>;
  pushRestrictions(payload: RestrictionSyncPayload): Promise<AdapterResult>;
  pullReservations(): Promise<{ ok: boolean; reservations: ChannelReservation[]; message: string }>;
  handleReservationWebhook(payload: Record<string, unknown>): Promise<AdapterResult>;
  handleCancellationWebhook(payload: Record<string, unknown>): Promise<AdapterResult>;
  handleModificationWebhook(payload: Record<string, unknown>): Promise<AdapterResult>;
  validateCredentials(credentials: AdapterCredentials): Promise<AdapterResult>;
  healthCheck(): Promise<AdapterResult>;
}

const apiOperations: ChannelOperation[] = [
  'availability_push',
  'rates_push',
  'restrictions_push',
  'dry_run_preview',
  'booking_pull',
  'booking_webhook',
  'cancellation_webhook',
  'modification_webhook',
];

export const channelRegistry: ChannelCapability[] = [
  {
    code: 'yandex_travel',
    displayName: 'Яндекс Путешествия',
    integrationType: 'api',
    status: 'mocked',
    notes: 'API-кандидат. Нужны договор, доступы и документация перед реальным подключением.',
    requiredCredentials: ['client_id', 'client_secret', 'hotel_id'],
    supportedOperations: apiOperations,
    riskLevel: 'medium',
    reliabilityLevel: 80,
    commissionPercent: 15,
  },
  {
    code: 'ostrovok',
    displayName: 'Островок',
    integrationType: 'api',
    status: 'mocked',
    notes: 'API-кандидат для будущего прямого подключения.',
    requiredCredentials: ['api_key', 'hotel_id'],
    supportedOperations: apiOperations,
    riskLevel: 'medium',
    reliabilityLevel: 82,
    commissionPercent: 16,
  },
  {
    code: 'sutochno',
    displayName: 'Суточно.ру',
    integrationType: 'api',
    status: 'mocked',
    notes: 'API-кандидат. На этапе MVP используется только внутренний тестовый контур.',
    requiredCredentials: ['api_key', 'landlord_id'],
    supportedOperations: apiOperations,
    riskLevel: 'medium',
    reliabilityLevel: 72,
    commissionPercent: 12,
  },
  {
    code: 'avito_travel',
    displayName: 'Авито Путешествия',
    integrationType: 'api',
    status: 'mocked',
    notes: 'API-кандидат. Вариант через iCal запрещён для боевого auto-sell.',
    requiredCredentials: ['client_id', 'client_secret', 'profile_id'],
    supportedOperations: apiOperations,
    riskLevel: 'high',
    reliabilityLevel: 68,
    commissionPercent: 10,
  },
  {
    code: 'one_zero_one_hotels',
    displayName: '101 Hotels',
    integrationType: 'api',
    status: 'mocked',
    notes: 'API-кандидат. Требуется подтверждение формата интеграции.',
    requiredCredentials: ['api_key', 'hotel_id'],
    supportedOperations: apiOperations,
    riskLevel: 'medium',
    reliabilityLevel: 70,
    commissionPercent: 15,
  },
  {
    code: 'bronevik_mts_travel',
    displayName: 'Броневик / МТС Travel',
    integrationType: 'partner_channel_manager_api',
    status: 'sandbox',
    notes: 'Первый реальный OTA-контур: только sandbox/shadow/read-only, без отправки изменений.',
    requiredCredentials: [
      'BRONEVIK_MTS_TRAVEL_API_BASE_URL',
      'BRONEVIK_MTS_TRAVEL_CLIENT_ID',
      'BRONEVIK_MTS_TRAVEL_CLIENT_SECRET',
      'BRONEVIK_MTS_TRAVEL_PARTNER_ID',
      'BRONEVIK_MTS_TRAVEL_SANDBOX_HOTEL_ID',
    ],
    supportedOperations: apiOperations,
    riskLevel: 'low',
    reliabilityLevel: 78,
    commissionPercent: 14,
  },
  {
    code: 'cian_daily',
    displayName: 'Циан посуточно',
    integrationType: 'api',
    status: 'planned',
    notes: 'API-кандидат, требуется ручная проверка доступности и правил подключения.',
    requiredCredentials: ['api_key', 'profile_id'],
    supportedOperations: ['availability_push', 'booking_webhook', 'cancellation_webhook'],
    riskLevel: 'high',
    reliabilityLevel: 60,
    commissionPercent: 11,
  },
];

export const protectedNonApiChannelCapabilities: ChannelCapability[] = [
  {
    code: 'manual',
    displayName: 'Ручной канал',
    integrationType: 'manual',
    status: 'disabled',
    notes: 'Не участвует в боевом auto-sell и автоматической защите от овербукинга.',
    requiredCredentials: [],
    supportedOperations: [],
    riskLevel: 'high',
    reliabilityLevel: 30,
    commissionPercent: 0,
  },
  {
    code: 'email_parsing',
    displayName: 'Парсинг почты',
    integrationType: 'email_parsing',
    status: 'disabled',
    notes: 'Не допускается в боевой контур из-за риска задержек и неоднозначных данных.',
    requiredCredentials: [],
    supportedOperations: [],
    riskLevel: 'high',
    reliabilityLevel: 20,
    commissionPercent: 0,
  },
  {
    code: 'ical',
    displayName: 'iCal',
    integrationType: 'ical',
    status: 'disabled',
    notes: 'Не используется как равноправный канал для предотвращения овербукинга.',
    requiredCredentials: [],
    supportedOperations: [],
    riskLevel: 'high',
    reliabilityLevel: 15,
    commissionPercent: 0,
  },
];

export const allChannelCapabilities = [...channelRegistry, ...protectedNonApiChannelCapabilities];

class ApiLikeChannelAdapter implements ChannelAdapter {
  constructor(
    public readonly code: ChannelCode,
    private readonly displayName: string,
  ) {}

  async pushAvailability(payload: AvailabilitySyncPayload): Promise<AdapterResult> {
    return this.mockResult(`Доступность подготовлена для ${this.displayName}: ${payload.days.length} дн.`);
  }

  async pushRates(payload: RateSyncPayload): Promise<AdapterResult> {
    return this.mockResult(`Цены подготовлены для ${this.displayName}: ${payload.dateFrom} - ${payload.dateTo}.`);
  }

  async pushRestrictions(payload: RestrictionSyncPayload): Promise<AdapterResult> {
    return this.mockResult(`Ограничения подготовлены для ${this.displayName}: ${payload.dateFrom} - ${payload.dateTo}.`);
  }

  async pullReservations(): Promise<{ ok: boolean; reservations: ChannelReservation[]; message: string }> {
    return {
      ok: true,
      reservations: [],
      message: `Тестовое получение броней для ${this.displayName} выполнено без внешних вызовов.`,
    };
  }

  async handleReservationWebhook(): Promise<AdapterResult> {
    return this.mockResult(`Тестовое событие новой брони принято для ${this.displayName}.`);
  }

  async handleCancellationWebhook(): Promise<AdapterResult> {
    return this.mockResult(`Тестовое событие отмены принято для ${this.displayName}.`);
  }

  async handleModificationWebhook(): Promise<AdapterResult> {
    return this.mockResult(`Тестовое событие изменения принято для ${this.displayName}.`);
  }

  async validateCredentials(credentials: AdapterCredentials): Promise<AdapterResult> {
    const hasAnyValue = Object.values(credentials.values).some((value) => Boolean(value?.trim()));
    return {
      ok: hasAnyValue,
      message: hasAnyValue
        ? `Тестовая проверка доступов для ${this.displayName} пройдена.`
        : `Для ${this.displayName} нужны реальные доступы перед подключением.`,
      externalCalls: 0,
    };
  }

  async healthCheck(): Promise<AdapterResult> {
    return this.mockResult(`Адаптер ${this.displayName} готов к shadow-проверке.`);
  }

  private mockResult(message: string): AdapterResult {
    return { ok: true, message, externalCalls: 0 };
  }
}

export class YandexTravelAdapter extends ApiLikeChannelAdapter {
  constructor() {
    super('yandex_travel', 'Яндекс Путешествия');
  }
}

export class OstrovokAdapter extends ApiLikeChannelAdapter {
  constructor() {
    super('ostrovok', 'Островок');
  }
}

export class SutochnoAdapter extends ApiLikeChannelAdapter {
  constructor() {
    super('sutochno', 'Суточно.ру');
  }
}

export class AvitoTravelAdapter extends ApiLikeChannelAdapter {
  constructor() {
    super('avito_travel', 'Авито Путешествия');
  }
}

export class OneZeroOneHotelsAdapter extends ApiLikeChannelAdapter {
  constructor() {
    super('one_zero_one_hotels', '101 Hotels');
  }
}

export class BronevikMtsTravelAdapter extends ApiLikeChannelAdapter {
  constructor() {
    super('bronevik_mts_travel', 'Броневик / МТС Travel');
  }
}

export class CianDailyAdapter extends ApiLikeChannelAdapter {
  constructor() {
    super('cian_daily', 'Циан посуточно');
  }
}

export class MockApiChannelAdapter extends ApiLikeChannelAdapter {
  constructor(code: ChannelCode = 'mock') {
    super(code, 'Тестовый API');
  }
}

export function getChannelAdapter(code: ChannelCode): ChannelAdapter {
  switch (code) {
    case 'yandex_travel':
      return new YandexTravelAdapter();
    case 'ostrovok':
      return new OstrovokAdapter();
    case 'sutochno':
      return new SutochnoAdapter();
    case 'avito_travel':
      return new AvitoTravelAdapter();
    case 'one_zero_one_hotels':
      return new OneZeroOneHotelsAdapter();
    case 'bronevik_mts_travel':
      return new BronevikMtsTravelRealAdapter();
    case 'cian_daily':
      return new CianDailyAdapter();
    default:
      return new MockApiChannelAdapter(code);
  }
}

export const defaultChannelSeed = allChannelCapabilities.map((channel) => ({
  code: channel.code,
  name: channel.displayName,
  adapterKind: channel.integrationType === 'manual'
    ? ('manual' as const)
    : channel.code === 'bronevik_mts_travel'
      ? ('api' as const)
      : ('mock' as const),
  status: channel.status,
  integrationType: channel.integrationType,
  syncMode: channel.code === 'bronevik_mts_travel' ? ('shadow' as const) : ('disabled' as const),
  isEnabled: channel.integrationType === 'api' || channel.integrationType === 'partner_channel_manager_api',
  isAutoSellEnabled: false,
  isOverbookingProtectionEnabled: false,
  reliabilityLevel: channel.reliabilityLevel,
  commissionPercent: channel.commissionPercent,
  supportsAvailabilityPush: channel.supportedOperations.includes('availability_push'),
  supportsRatesPush: channel.supportedOperations.includes('rates_push'),
  supportsRestrictionsPush: channel.supportedOperations.includes('restrictions_push'),
  supportsBookingPull: channel.supportedOperations.includes('booking_pull'),
  supportsBookingWebhook: channel.supportedOperations.includes('booking_webhook'),
  supportsCancellationWebhook: channel.supportedOperations.includes('cancellation_webhook'),
  supportsModificationWebhook: channel.supportedOperations.includes('modification_webhook'),
}));
