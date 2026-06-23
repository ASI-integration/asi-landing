import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { getPilotBooking, updatePilotBooking } from '@/lib/bookings/repository';
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';
import type { BookingChannel, BookingStatus } from '@/lib/bookings/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  const booking = await getPilotBooking(context.params.id);
  if (!booking) {
    return NextResponse.json({ ok: false, message: 'Бронь не найдена.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, booking });
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const result = await updatePilotBooking(context.params.id, {
    propertyId: body.propertyId != null ? String(body.propertyId) : undefined,
    guestName: body.guestName != null ? String(body.guestName) : undefined,
    guestContact: body.guestContact != null ? String(body.guestContact) : undefined,
    checkIn: body.checkIn != null ? String(body.checkIn) : undefined,
    checkOut: body.checkOut != null ? String(body.checkOut) : undefined,
    channel: body.channel as BookingChannel | undefined,
    status: body.status as BookingStatus | undefined,
    comment: body.comment != null ? String(body.comment) : undefined,
  });

  if (!result.ok || !result.booking) {
    return NextResponse.json(
      { ok: false, message: result.error ?? 'Не удалось обновить бронь.' },
      { status: 400 },
    );
  }

  const sync = await syncAutoOpsTasks();
  return NextResponse.json({ ok: true, booking: result.booking, sync });
}
