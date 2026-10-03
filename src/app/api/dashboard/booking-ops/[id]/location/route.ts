import { NextResponse } from 'next/server';
import {
  requireCrmOperatorSession,
  requireOpsAdminSession,
} from '@/lib/crm/api-auth';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { sameIdentity } from '@/lib/platform/decision';
import { adaptResidentialLocationDecision } from '@/lib/platform/location-decision';
import { resolveResidentialBookingIdentity } from '@/lib/platform/residential-booking-scope';
import {
  readResidentialPropertySpatialSnapshot,
  refreshResidentialPropertySpatialSnapshot,
} from '@/lib/location/residential-property-spatial-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

function bookingError(code: string): NextResponse | null {
  if (code === 'booking_not_found') {
    return NextResponse.json({ ok: false, message: 'Бронирование не найдено.' }, { status: 404 });
  }
  if (code === 'booking_scope_mismatch' || code === 'reservation_account_not_found') {
    return NextResponse.json({ ok: false, message: 'Нет доступа к бронированию.' }, { status: 403 });
  }
  if (code === 'booking_scope_unavailable') {
    return NextResponse.json(
      { ok: false, message: 'Не удалось подтвердить область бронирования.' },
      { status: 409 },
    );
  }
  return null;
}

function refreshError(code: string): NextResponse {
  const booking = bookingError(code);
  if (booking) return booking;
  if (code === 'property_location_missing') {
    return NextResponse.json({ ok: false, message: 'Объект не найден.' }, { status: 404 });
  }
  if (code === 'property_location_incomplete' || code === 'property_location_changed') {
    return NextResponse.json(
      { ok: false, message: 'Адрес объекта нужно проверить перед обновлением геоданных.' },
      { status: 409 },
    );
  }
  if (code === 'property_geocode_unavailable' || code === 'property_spatial_provider_unavailable') {
    return NextResponse.json(
      { ok: false, message: 'Геоданные временно недоступны.' },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { ok: false, message: 'Не удалось обновить геоданные объекта.' },
    { status: 500 },
  );
}

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  try {
    const access = await resolveReservationAccess(auth.session);
    const identity = await resolveResidentialBookingIdentity(context.params.id, access.accountId);
    const snapshot = await readResidentialPropertySpatialSnapshot(identity);
    const currentIdentity = await resolveResidentialBookingIdentity(context.params.id, access.accountId);
    if (!sameIdentity(identity, currentIdentity)) {
      return NextResponse.json(
        { ok: false, message: 'Состояние бронирования изменилось. Повторите запрос.' },
        { status: 409 },
      );
    }
    const platformDecision = adaptResidentialLocationDecision(identity, snapshot, Date.now());
    return NextResponse.json({
      ok: true,
      spatialValidation: snapshot.available ? snapshot.value : null,
      platformDecision,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    return bookingError(code)
      ?? NextResponse.json({ ok: false, message: 'Не удалось загрузить геоданные объекта.' }, { status: 500 });
  }
}

export async function POST(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  try {
    const access = await resolveReservationAccess(auth.session);
    const identity = await resolveResidentialBookingIdentity(context.params.id, access.accountId);
    const snapshot = await refreshResidentialPropertySpatialSnapshot(identity);
    const currentIdentity = await resolveResidentialBookingIdentity(context.params.id, access.accountId);
    if (!sameIdentity(identity, currentIdentity)) {
      return NextResponse.json(
        { ok: false, message: 'Состояние бронирования изменилось. Повторите запрос.' },
        { status: 409 },
      );
    }
    const platformDecision = adaptResidentialLocationDecision(identity, snapshot, Date.now());
    return NextResponse.json({
      ok: true,
      spatialValidation: snapshot.available ? snapshot.value : null,
      platformDecision,
    });
  } catch (error) {
    return refreshError(error instanceof Error ? error.message : '');
  }
}
