import { NextResponse } from 'next/server';
import { opsFoundationApiErrorResponse, optionalString } from '@/lib/ops-foundation/api';
import { ChannelManagerUnavailableError } from './repository';
import type {
  ChannelCode,
  CreateChannelReservationInput,
  CreateShadowBookingEventInput,
  SetInventoryInput,
  ShadowBookingEventType,
  SyncMode,
  UpdateChannelInput,
} from './types';

export function channelManagerApiErrorResponse(err: unknown): NextResponse {
  if (err instanceof ChannelManagerUnavailableError) {
    return NextResponse.json(
      { ok: false, error: 'channel_manager_unavailable', detail: err.message },
      { status: 503 },
    );
  }
  if (err instanceof Error && [
    'non_api_channels_cannot_use_active_auto_sell',
    'active_mode_requires_availability_push',
    'auto_sell_requires_active_mode',
    'real_ota_adapter_active_mode_disabled',
    'channel_not_found',
    'channel_shadow_mode_required',
  ].includes(err.message)) {
    return NextResponse.json({ ok: false, error: err.message, detail: err.message }, { status: 400 });
  }
  return opsFoundationApiErrorResponse(err);
}

export function parseSetInventoryInput(body: Record<string, unknown>): SetInventoryInput | null {
  const propertyId = optionalString(body.propertyId);
  const day = optionalString(body.day);
  const totalUnits = numberFromBody(body.totalUnits);
  const manualBlockedUnits = numberFromBody(body.manualBlockedUnits);
  if (!propertyId || !day || totalUnits === undefined || manualBlockedUnits === undefined) return null;

  return {
    propertyId,
    unitKey: optionalString(body.unitKey),
    day,
    totalUnits,
    manualBlockedUnits,
  };
}

export function parseCreateChannelReservationInput(
  body: Record<string, unknown>,
): CreateChannelReservationInput | null {
  const propertyId = optionalString(body.propertyId);
  const guestName = optionalString(body.guestName);
  const checkInDate = optionalString(body.checkInDate);
  const checkOutDate = optionalString(body.checkOutDate);
  if (!propertyId || !guestName || !checkInDate || !checkOutDate) return null;

  return {
    propertyId,
    unitKey: optionalString(body.unitKey),
    channelCode: optionalString(body.channelCode) as ChannelCode | undefined,
    externalBookingId: optionalString(body.externalBookingId),
    idempotencyKey: optionalString(body.idempotencyKey),
    guestName,
    checkInDate,
    checkOutDate,
    quantity: numberFromBody(body.quantity),
    totalAmount: numberFromBody(body.totalAmount),
    guestType: optionalString(body.guestType),
    confirmationMode: body.confirmationMode === 'pending' ? 'pending' : 'confirm',
  };
}

export function parseCreateShadowBookingEventInput(
  body: Record<string, unknown>,
): CreateShadowBookingEventInput | null {
  const input = parseCreateChannelReservationInput(body);
  if (!input) return null;

  const eventType = optionalString(body.eventType);
  if (eventType && !['reservation_created', 'reservation_cancelled', 'reservation_modified'].includes(eventType)) {
    return null;
  }

  const externalAvailabilityByDay = recordOfNumbers(body.externalAvailabilityByDay);

  return {
    ...input,
    eventType: eventType as ShadowBookingEventType | undefined,
    externalAvailabilityByDay,
  };
}

export function parseUpdateChannelInput(body: Record<string, unknown>): UpdateChannelInput | null {
  const input: UpdateChannelInput = {};
  const syncMode = optionalString(body.syncMode);
  if (syncMode) {
    if (!['disabled', 'read_only', 'shadow', 'active'].includes(syncMode)) return null;
    input.syncMode = syncMode as SyncMode;
  }

  for (const key of ['isEnabled', 'isAutoSellEnabled', 'isOverbookingProtectionEnabled'] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'boolean') return null;
      input[key] = body[key];
    }
  }

  return Object.keys(input).length > 0 ? input : null;
}

export function numberFromBody(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function recordOfNumbers(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const numberValue = numberFromBody(raw);
    if (numberValue !== undefined) result[key] = numberValue;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
