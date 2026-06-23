import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { isOpsAdminEmail } from '@/lib/crm/access';
import { createPilotBooking, listPilotBookings } from '@/lib/bookings/repository';
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';
import type { BookingChannel, BookingStatus } from '@/lib/bookings/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const includeTest = url.searchParams.get('includeTest') === '1';

  const bookings = await listPilotBookings({ includeTest });
  return NextResponse.json({ ok: true, bookings, isOpsAdmin: isOpsAdminEmail(auth.session.email) });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const result = await createPilotBooking({
    propertyId: String(body.propertyId ?? body.property_id ?? ''),
    guestName: body.guestName != null ? String(body.guestName) : null,
    guestContact: body.guestContact != null ? String(body.guestContact) : null,
    checkIn: body.checkIn != null ? String(body.checkIn) : null,
    checkOut: body.checkOut != null ? String(body.checkOut) : null,
    channel: body.channel as BookingChannel | undefined,
    status: body.status as BookingStatus | undefined,
    comment: body.comment != null ? String(body.comment) : null,
    reservationRef: body.reservationRef != null ? String(body.reservationRef) : null,
    pilotAcceptanceMarker: body.pilotAcceptanceMarker != null ? String(body.pilotAcceptanceMarker) : null,
  });

  if (!result.ok || !result.booking) {
    return NextResponse.json(
      { ok: false, message: result.error ?? 'Не удалось создать бронь.' },
      { status: 400 },
    );
  }

  const sync = await syncAutoOpsTasks();
  return NextResponse.json({ ok: true, booking: result.booking, created: result.created, sync });
}
