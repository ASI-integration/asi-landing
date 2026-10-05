import { NextResponse } from 'next/server';
import {
  requireBookingOpsPropertyAccess,
  requireBookingOpsRouteAccess,
  resolveBookingOpsAccount,
} from '@/lib/booking-ops/route-access';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { supabase } from '@/lib/supabase';

type Session = Parameters<typeof resolveReservationAccess>[0];

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function responseFor(code: string): NextResponse {
  if (code === 'booking_not_found') {
    return NextResponse.json({ ok: false, message: 'Бронирование не найдено.' }, { status: 404 });
  }
  if (code === 'communication_not_found') {
    return NextResponse.json({ ok: false, message: 'Коммуникация не найдена.' }, { status: 404 });
  }
  if (code === 'delivery_not_found') {
    return NextResponse.json({ ok: false, message: 'Доставка не найдена.' }, { status: 404 });
  }
  if (code === 'availability_check_not_found') {
    return NextResponse.json({ ok: false, message: 'Проверка доступности не найдена.' }, { status: 404 });
  }
  if (code === 'availability_hold_not_found') {
    return NextResponse.json({ ok: false, message: 'Удержание доступности не найдено.' }, { status: 404 });
  }
  if (code === 'availability_block_not_found') {
    return NextResponse.json({ ok: false, message: 'Блокировка доступности не найдена.' }, { status: 404 });
  }
  if (code === 'booking_scope_mismatch'
    || code === 'reservation_account_not_found'
    || code === 'property_scope_mismatch') {
    return NextResponse.json({ ok: false, message: 'Нет доступа к бронированию.' }, { status: 403 });
  }
  if (code === 'property_id_required') {
    return NextResponse.json({ ok: false, message: 'Не указан объект.' }, { status: 400 });
  }
  if (code === 'scope_not_account_bound') {
    return NextResponse.json(
      { ok: false, message: 'Этот уровень автоотправки пока не привязан к подтверждённой области аккаунта.' },
      { status: 409 },
    );
  }
  if (code === 'account_workspace_unavailable') {
    return NextResponse.json({ ok: false, message: code }, { status: 503 });
  }
  return NextResponse.json(
    { ok: false, message: 'Не удалось подтвердить область бронирования.' },
    { status: 409 },
  );
}

export async function requireBookingOpsApiAccount(session: Session) {
  try {
    return { ok: true as const, ...(await resolveBookingOpsAccount(session)) };
  } catch (error) {
    return {
      ok: false as const,
      response: responseFor(error instanceof Error ? error.message : ''),
    };
  }
}

export async function requireBookingOpsApiAccess(session: Session, bookingId: string) {
  try {
    return { ok: true as const, ...(await requireBookingOpsRouteAccess(session, bookingId)) };
  } catch (error) {
    return {
      ok: false as const,
      response: responseFor(error instanceof Error ? error.message : ''),
    };
  }
}

export async function requireBookingOpsApiPropertyAccess(session: Session, propertyId: string) {
  try {
    return { ok: true as const, ...(await requireBookingOpsPropertyAccess(session, propertyId)) };
  } catch (error) {
    return {
      ok: false as const,
      response: responseFor(error instanceof Error ? error.message : ''),
    };
  }
}

async function resolveAvailabilityPropertySetup(propertySetupId: string): Promise<string> {
  const result = await supabase
    .from('booking_property_setup_profiles')
    .select('property_id')
    .eq('id', propertySetupId)
    .maybeSingle();
  if (result.error) throw new Error('property_scope_unavailable');
  const propertyId = text(result.data?.property_id);
  if (!propertyId) throw new Error('property_scope_mismatch');
  return propertyId;
}

export async function requireBookingOpsApiAvailabilityScopeAccess(
  session: Session,
  scope: { bookingId?: string | null; propertyId?: string | null; propertySetupId?: string | null },
) {
  try {
    const bookingId = text(scope.bookingId);
    const requestedPropertyId = text(scope.propertyId);
    const propertySetupId = text(scope.propertySetupId);
    const setupPropertyId = propertySetupId
      ? await resolveAvailabilityPropertySetup(propertySetupId)
      : '';

    if (bookingId) {
      const access = await requireBookingOpsRouteAccess(session, bookingId);
      if (requestedPropertyId && requestedPropertyId !== access.propertyId) {
        throw new Error('property_scope_mismatch');
      }
      if (setupPropertyId && setupPropertyId !== access.propertyId) {
        throw new Error('property_scope_mismatch');
      }
      return {
        ok: true as const,
        ...access,
        propertySetupId: propertySetupId || null,
      };
    }

    const propertyId = requestedPropertyId || setupPropertyId;
    if (!propertyId) throw new Error('property_id_required');
    if (requestedPropertyId && setupPropertyId && requestedPropertyId !== setupPropertyId) {
      throw new Error('property_scope_mismatch');
    }
    return {
      ok: true as const,
      ...(await requireBookingOpsPropertyAccess(session, propertyId)),
      bookingId: null,
      propertySetupId: propertySetupId || null,
    };
  } catch (error) {
    return {
      ok: false as const,
      response: responseFor(error instanceof Error ? error.message : ''),
    };
  }
}

type AvailabilityStoredScope = {
  account_id?: unknown;
  booking_id?: unknown;
  property_id?: unknown;
  property_setup_id?: unknown;
};

async function resolveAvailabilityStoredScopeAccess(session: Session, row: AvailabilityStoredScope) {
  const account = await resolveBookingOpsAccount(session);
  const storedAccountId = text(row.account_id);
  if (storedAccountId && storedAccountId !== account.accountId) {
    throw new Error('booking_scope_mismatch');
  }

  const bookingId = text(row.booking_id);
  const storedPropertyId = text(row.property_id);
  const propertySetupId = text(row.property_setup_id);
  if (bookingId) {
    const access = await requireBookingOpsRouteAccess(session, bookingId);
    if (storedPropertyId && storedPropertyId !== access.propertyId) {
      throw new Error('property_scope_mismatch');
    }
    if (propertySetupId) {
      const setupPropertyId = await resolveAvailabilityPropertySetup(propertySetupId);
      if (setupPropertyId !== access.propertyId) throw new Error('property_scope_mismatch');
    }
    return {
      ...access,
      propertySetupId: propertySetupId || null,
    };
  }

  const propertyId = storedPropertyId || (propertySetupId
    ? await resolveAvailabilityPropertySetup(propertySetupId)
    : '');
  if (!propertyId) throw new Error('property_scope_mismatch');
  return {
    ...(await requireBookingOpsPropertyAccess(session, propertyId)),
    bookingId: null,
    propertySetupId: propertySetupId || null,
  };
}

export async function requireBookingOpsApiAvailabilityCheckAccess(session: Session, checkId: string) {
  try {
    const id = text(checkId);
    if (!id) throw new Error('availability_check_not_found');

    const result = await supabase
      .from('booking_overbooking_conflict_checks')
      .select('id,account_id,booking_id,property_id,property_setup_id')
      .eq('id', id)
      .maybeSingle();
    if (result.error) throw new Error('booking_scope_unavailable');
    if (!result.data) throw new Error('availability_check_not_found');

    return {
      ok: true as const,
      ...(await resolveAvailabilityStoredScopeAccess(session, result.data)),
      checkId: id,
    };
  } catch (error) {
    return {
      ok: false as const,
      response: responseFor(error instanceof Error ? error.message : ''),
    };
  }
}

export async function requireBookingOpsApiAvailabilityHoldAccess(session: Session, holdId: string) {
  try {
    const id = text(holdId);
    if (!id) throw new Error('availability_hold_not_found');
    const result = await supabase
      .from('booking_availability_holds')
      .select('id,account_id,booking_id,property_id,property_setup_id')
      .eq('id', id)
      .maybeSingle();
    if (result.error) throw new Error('booking_scope_unavailable');
    if (!result.data) throw new Error('availability_hold_not_found');
    return {
      ok: true as const,
      ...(await resolveAvailabilityStoredScopeAccess(session, result.data)),
      holdId: id,
    };
  } catch (error) {
    return {
      ok: false as const,
      response: responseFor(error instanceof Error ? error.message : ''),
    };
  }
}

export async function requireBookingOpsApiAvailabilityBlockAccess(session: Session, blockId: string) {
  try {
    const id = text(blockId);
    if (!id) throw new Error('availability_block_not_found');
    const result = await supabase
      .from('booking_availability_blocks')
      .select('id,account_id,property_id,property_setup_id')
      .eq('id', id)
      .maybeSingle();
    if (result.error) throw new Error('booking_scope_unavailable');
    if (!result.data) throw new Error('availability_block_not_found');
    return {
      ok: true as const,
      ...(await resolveAvailabilityStoredScopeAccess(session, result.data)),
      blockId: id,
    };
  } catch (error) {
    return {
      ok: false as const,
      response: responseFor(error instanceof Error ? error.message : ''),
    };
  }
}

async function resolveCommunicationBookingOpsRecordId(communicationId: string): Promise<string> {
  const result = await supabase
    .from('booking_ops_communication_intents')
    .select('booking_ops_record_id')
    .eq('id', communicationId)
    .maybeSingle();
  if (result.error) throw new Error('booking_scope_unavailable');
  const bookingId = String(result.data?.booking_ops_record_id ?? '').trim();
  if (!bookingId) throw new Error('communication_not_found');
  return bookingId;
}

export async function requireBookingOpsApiCommunicationAccess(session: Session, communicationId: string) {
  try {
    const bookingId = await resolveCommunicationBookingOpsRecordId(communicationId);
    return {
      ok: true as const,
      communicationId,
      ...(await requireBookingOpsRouteAccess(session, bookingId)),
    };
  } catch (error) {
    return {
      ok: false as const,
      response: responseFor(error instanceof Error ? error.message : ''),
    };
  }
}

export async function requireBookingOpsApiDeliveryAccess(session: Session, deliveryId: string) {
  try {
    const delivery = await supabase
      .from('booking_ops_communication_deliveries')
      .select('communication_intent_id')
      .eq('id', deliveryId)
      .maybeSingle();
    if (delivery.error) throw new Error('booking_scope_unavailable');
    const communicationId = String(delivery.data?.communication_intent_id ?? '').trim();
    if (!communicationId) throw new Error('delivery_not_found');
    const bookingId = await resolveCommunicationBookingOpsRecordId(communicationId);
    return {
      ok: true as const,
      deliveryId,
      communicationId,
      ...(await requireBookingOpsRouteAccess(session, bookingId)),
    };
  } catch (error) {
    return {
      ok: false as const,
      response: responseFor(error instanceof Error ? error.message : ''),
    };
  }
}

export async function requireBookingOpsApiAutoSendScopeAccess(
  session: Session,
  scopeType: 'owner' | 'property' | 'booking' | 'pilot',
  scopeRef: string,
) {
  try {
    const account = await resolveBookingOpsAccount(session);
    const ref = String(scopeRef ?? '').trim();
    if (!ref) throw new Error('booking_scope_unavailable');

    if (scopeType === 'property') {
      await requireBookingOpsPropertyAccess(session, ref);
      return { ok: true as const, ...account, scopeType, scopeRef: ref };
    }

    if (scopeType === 'booking') {
      const bySource = await supabase
        .from('booking_ops_records')
        .select('id')
        .eq('account_id', account.accountId)
        .eq('booking_id', ref)
        .limit(1)
        .maybeSingle();
      if (bySource.error) throw new Error('booking_scope_unavailable');
      if (!bySource.data) {
        const byId = await supabase
          .from('booking_ops_records')
          .select('id')
          .eq('account_id', account.accountId)
          .eq('id', ref)
          .maybeSingle();
        if (byId.error) throw new Error('booking_scope_unavailable');
        if (!byId.data) throw new Error('booking_scope_mismatch');
      }
      return { ok: true as const, ...account, scopeType, scopeRef: ref };
    }

    // Owner and pilot refs are legacy/free-form in this residential contour.
    // Do not let them authorize actual delivery until they have canonical account ownership.
    throw new Error('scope_not_account_bound');
  } catch (error) {
    return {
      ok: false as const,
      response: responseFor(error instanceof Error ? error.message : ''),
    };
  }
}
