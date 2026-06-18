import type {
  AdapterCredentials,
  AdapterResult,
  AvailabilitySyncPayload,
  ChannelAdapter,
  RateSyncPayload,
  RestrictionSyncPayload,
} from './adapters';
import type {
  ChannelListing,
  ChannelManagerChannel,
  ChannelReservation,
  InventoryDay,
} from './types';

export const BRONEVIK_MTS_TRAVEL_ENV_VARS = [
  'BRONEVIK_MTS_TRAVEL_API_BASE_URL',
  'BRONEVIK_MTS_TRAVEL_CLIENT_ID',
  'BRONEVIK_MTS_TRAVEL_CLIENT_SECRET',
  'BRONEVIK_MTS_TRAVEL_PARTNER_ID',
  'BRONEVIK_MTS_TRAVEL_SANDBOX_HOTEL_ID',
] as const;

export const BRONEVIK_MTS_TRAVEL_OPTIONAL_ENV_VARS = [
  'BRONEVIK_MTS_TRAVEL_SIGNATURE_KEY',
  'BRONEVIK_MTS_TRAVEL_IP_ALLOWLIST_NOTE',
] as const;

const SECRET_ENV_NAMES = new Set<string>([
  'BRONEVIK_MTS_TRAVEL_CLIENT_SECRET',
  'BRONEVIK_MTS_TRAVEL_SIGNATURE_KEY',
]);

export type BronevikMtsTravelEnvVar = (typeof BRONEVIK_MTS_TRAVEL_ENV_VARS)[number];

export interface BronevikMtsTravelCredentialStatus {
  ok: boolean;
  mode: 'sandbox_shadow_read_only';
  sandboxConfirmed: true;
  missing: string[];
  present: string[];
  maskedValues: Record<string, string>;
}

export interface BronevikMissingMapping {
  field: string;
  label: string;
  impact: 'blocks_payload' | 'blocks_send' | 'needs_confirmation';
}

export interface BronevikDryRunPreview {
  channel: 'bronevik_mts_travel';
  mode: 'sandbox_shadow_dry_run';
  externalCalls: 0;
  realOtaChanged: false;
  credentials: BronevikMtsTravelCredentialStatus;
  mapping: {
    property: {
      asiPropertyId: string;
      externalHotelId: string | null;
    };
    unitCategory: {
      asiUnitKey: string;
      externalRoomCategoryId: string | null;
    };
    ratePlan: {
      asiRatePlanId: string | null;
      externalRatePlanId: string | null;
    };
    inventoryDays: Array<{
      date: string;
      availableUnits: number;
      externalHotelId: string | null;
      externalRoomCategoryId: string | null;
      externalRatePlanId: string | null;
    }>;
    reservation: {
      externalBookingId: string | null;
      guestName: string | null;
      checkInDate: string | null;
      checkOutDate: string | null;
      quantity: number | null;
      status: ChannelReservation['status'] | null;
    };
    restrictions: {
      minStay: number | null;
      maxStay: number | null;
      closedToArrival: boolean | null;
      closedToDeparture: boolean | null;
      stopSale: boolean | null;
    };
  };
  payload: {
    availability: Array<{
      hotelId: string | null;
      roomCategoryId: string | null;
      ratePlanId: string | null;
      date: string;
      available: number;
      stopSale: boolean;
    }>;
    rates: Array<Record<string, never>>;
    restrictions: Array<Record<string, never>>;
    reservations: Array<Record<string, unknown>>;
  };
  missingMappings: BronevikMissingMapping[];
  notes: string[];
}

export interface BuildBronevikDryRunPreviewInput {
  channel: ChannelManagerChannel;
  listing: ChannelListing | null;
  propertyId: string;
  unitKey: string;
  inventoryDays: InventoryDay[];
  reservation?: ChannelReservation | null;
  env?: Record<string, string | undefined>;
}

export function loadBronevikMtsTravelCredentials(
  env: Record<string, string | undefined> = process.env,
): AdapterCredentials {
  return {
    values: Object.fromEntries(
      [...BRONEVIK_MTS_TRAVEL_ENV_VARS, ...BRONEVIK_MTS_TRAVEL_OPTIONAL_ENV_VARS].map((name) => [
        name,
        env[name],
      ]),
    ),
  };
}

export function getBronevikMtsTravelCredentialStatus(
  credentials: AdapterCredentials = loadBronevikMtsTravelCredentials(),
): BronevikMtsTravelCredentialStatus {
  const missing = BRONEVIK_MTS_TRAVEL_ENV_VARS.filter((name) => !credentials.values[name]?.trim());
  const present = [...BRONEVIK_MTS_TRAVEL_ENV_VARS, ...BRONEVIK_MTS_TRAVEL_OPTIONAL_ENV_VARS].filter((name) =>
    Boolean(credentials.values[name]?.trim()),
  );

  return {
    ok: missing.length === 0,
    mode: 'sandbox_shadow_read_only',
    sandboxConfirmed: true,
    missing,
    present,
    maskedValues: Object.fromEntries(
      [...BRONEVIK_MTS_TRAVEL_ENV_VARS, ...BRONEVIK_MTS_TRAVEL_OPTIONAL_ENV_VARS].map((name) => [
        name,
        maskCredentialValue(name, credentials.values[name]),
      ]),
    ),
  };
}

export function maskCredentialValue(name: string, value: string | undefined): string {
  if (!value?.trim()) return 'не задано';
  if (SECRET_ENV_NAMES.has(name)) return 'задано: ***';
  return 'задано';
}

export function buildBronevikMtsTravelDryRunPreview(
  input: BuildBronevikDryRunPreviewInput,
): BronevikDryRunPreview {
  const credentials = getBronevikMtsTravelCredentialStatus(loadBronevikMtsTravelCredentials(input.env));
  const externalHotelId = input.env?.BRONEVIK_MTS_TRAVEL_SANDBOX_HOTEL_ID?.trim() || null;
  const externalRoomCategoryId = isSyntheticExternalId(input.listing?.externalListingId)
    ? null
    : input.listing?.externalListingId ?? null;
  const externalRatePlanId = null;
  const reservation = input.reservation ?? null;

  const missingMappings: BronevikMissingMapping[] = [];
  if (!credentials.ok) {
    missingMappings.push({
      field: 'credentials',
      label: 'Не все доступы для тестовой среды заданы в env.',
      impact: 'blocks_send',
    });
  }
  if (!externalHotelId) {
    missingMappings.push({
      field: 'property.external_hotel_id',
      label: 'Нужен внешний ID отеля Bronevik / МТС Travel.',
      impact: 'blocks_payload',
    });
  }
  if (!externalRoomCategoryId) {
    missingMappings.push({
      field: 'unit.external_room_category_id',
      label: 'Нужен внешний ID категории номера.',
      impact: 'blocks_payload',
    });
  }
  missingMappings.push(
    {
      field: 'rate_plan.external_rate_plan_id',
      label: 'Нужен внешний ID тарифного плана.',
      impact: 'blocks_payload',
    },
    {
      field: 'rates.nightly_price',
      label: 'В текущей модели доступности нет цены по дню.',
      impact: 'needs_confirmation',
    },
    {
      field: 'restrictions.min_max_cta_ctd_stop_sale',
      label: 'Нужны поля ограничений: мин./макс. срок, закрытие заезда/выезда, стоп-продажа.',
      impact: 'needs_confirmation',
    },
    {
      field: 'reservation.lifecycle_fields',
      label: 'Нужно подтвердить поля брони, изменений и отмен в закрытой документации.',
      impact: 'needs_confirmation',
    },
  );

  const inventoryDays = input.inventoryDays.map((day) => ({
    date: day.day,
    availableUnits: day.availableUnits,
    externalHotelId,
    externalRoomCategoryId,
    externalRatePlanId,
  }));

  return {
    channel: 'bronevik_mts_travel',
    mode: 'sandbox_shadow_dry_run',
    externalCalls: 0,
    realOtaChanged: false,
    credentials,
    mapping: {
      property: {
        asiPropertyId: input.propertyId,
        externalHotelId,
      },
      unitCategory: {
        asiUnitKey: input.unitKey,
        externalRoomCategoryId,
      },
      ratePlan: {
        asiRatePlanId: null,
        externalRatePlanId,
      },
      inventoryDays,
      reservation: {
        externalBookingId: reservation?.externalBookingId ?? null,
        guestName: reservation?.guestName ?? null,
        checkInDate: reservation?.checkInDate ?? null,
        checkOutDate: reservation?.checkOutDate ?? null,
        quantity: reservation?.quantity ?? null,
        status: reservation?.status ?? null,
      },
      restrictions: {
        minStay: null,
        maxStay: null,
        closedToArrival: null,
        closedToDeparture: null,
        stopSale: null,
      },
    },
    payload: {
      availability: inventoryDays.map((day) => ({
        hotelId: day.externalHotelId,
        roomCategoryId: day.externalRoomCategoryId,
        ratePlanId: day.externalRatePlanId,
        date: day.date,
        available: day.availableUnits,
        stopSale: day.availableUnits <= 0,
      })),
      rates: [],
      restrictions: [],
      reservations: reservation
        ? [
            {
              externalBookingId: reservation.externalBookingId,
              checkInDate: reservation.checkInDate,
              checkOutDate: reservation.checkOutDate,
              quantity: reservation.quantity,
              status: reservation.status,
            },
          ]
        : [],
    },
    missingMappings,
    notes: [
      'Тестовая среда подтверждена research-документом, но конкретные endpoints выдаются после NDA.',
      'Предпросмотр не отправляется наружу и не меняет данные площадки.',
      'iCal не используется.',
    ],
  };
}

function isSyntheticExternalId(value: string | undefined): boolean {
  return !value || value.includes(':');
}

export class BronevikMtsTravelRealAdapter implements ChannelAdapter {
  readonly code = 'bronevik_mts_travel' as const;

  async pushAvailability(payload: AvailabilitySyncPayload): Promise<AdapterResult> {
    return this.blockedDryRunResult(`Предпросмотр доступности подготовлен: ${payload.days.length} дн.`);
  }

  async pushRates(payload: RateSyncPayload): Promise<AdapterResult> {
    return this.blockedDryRunResult(`Предпросмотр цен подготовлен: ${payload.dateFrom} - ${payload.dateTo}.`);
  }

  async pushRestrictions(payload: RestrictionSyncPayload): Promise<AdapterResult> {
    return this.blockedDryRunResult(`Предпросмотр ограничений подготовлен: ${payload.dateFrom} - ${payload.dateTo}.`);
  }

  async pullReservations(): Promise<{ ok: boolean; reservations: ChannelReservation[]; message: string }> {
    const credentials = getBronevikMtsTravelCredentialStatus();
    if (!credentials.ok) {
      return {
        ok: false,
        reservations: [],
        message: 'Для чтения тестовых броней нужны доступы Bronevik / МТС Travel.',
      };
    }
    return {
      ok: true,
      reservations: [],
      message: 'Контур чтения подготовлен, внешний вызов отключен до подтверждения sandbox-документации.',
    };
  }

  async handleReservationWebhook(): Promise<AdapterResult> {
    return this.blockedDryRunResult('Входящее событие брони может обрабатываться только через sandbox/shadow.');
  }

  async handleCancellationWebhook(): Promise<AdapterResult> {
    return this.blockedDryRunResult('Входящее событие отмены может обрабатываться только через sandbox/shadow.');
  }

  async handleModificationWebhook(): Promise<AdapterResult> {
    return this.blockedDryRunResult('Входящее событие изменения может обрабатываться только через sandbox/shadow.');
  }

  async validateCredentials(credentials: AdapterCredentials): Promise<AdapterResult> {
    const status = getBronevikMtsTravelCredentialStatus(credentials);
    return {
      ok: status.ok,
      message: status.ok
        ? 'Доступы для sandbox заданы. Внешняя проверка отключена до подтверждения документации.'
        : `Не хватает доступов: ${status.missing.join(', ')}.`,
      externalCalls: 0,
      details: {
        credentials: status,
      },
    };
  }

  async healthCheck(): Promise<AdapterResult> {
    const credentials = loadBronevikMtsTravelCredentials();
    const status = getBronevikMtsTravelCredentialStatus(credentials);
    return {
      ok: status.ok,
      message: status.ok
        ? 'Bronevik / МТС Travel готов к sandbox/shadow проверке. Внешних вызовов не было.'
        : 'Bronevik / МТС Travel ожидает доступы для sandbox. Внешних вызовов не было.',
      externalCalls: 0,
      details: {
        credentials: status,
        sandbox: true,
        activeModeAllowed: false,
      },
    };
  }

  private blockedDryRunResult(message: string): AdapterResult {
    return {
      ok: true,
      message,
      externalCalls: 0,
      details: {
        outbound: 'shadow_mode_external_send_blocked',
        realOtaChanged: false,
      },
    };
  }
}
