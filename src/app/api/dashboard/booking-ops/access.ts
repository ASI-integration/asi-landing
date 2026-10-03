import { NextResponse } from 'next/server';
import {
  requireBookingOpsPropertyAccess,
  requireBookingOpsRouteAccess,
  resolveBookingOpsAccount,
} from '@/lib/booking-ops/route-access';
import { resolveReservationAccess } from '@/lib/reservations/access';

type Session = Parameters<typeof resolveReservationAccess>[0];

function responseFor(code: string): NextResponse {
  if (code === 'booking_not_found') {
    return NextResponse.json({ ok: false, message: 'Бронирование не найдено.' }, { status: 404 });
  }
  if (code === 'booking_scope_mismatch'
    || code === 'reservation_account_not_found'
    || code === 'property_scope_mismatch') {
    return NextResponse.json({ ok: false, message: 'Нет доступа к бронированию.' }, { status: 403 });
  }
  if (code === 'property_id_required') {
    return NextResponse.json({ ok: false, message: 'Не указан объект.' }, { status: 400 });
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
