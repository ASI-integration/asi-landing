import { NextResponse } from 'next/server';
import { optionalString, readJsonObject, requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { channelManagerApiErrorResponse } from '@/lib/channel-manager/api';
import { modifyChannelReservationDates } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(req);
  const reservationId = optionalString(body.reservationId);
  const checkInDate = optionalString(body.checkInDate);
  const checkOutDate = optionalString(body.checkOutDate);
  if (!reservationId || !checkInDate || !checkOutDate) {
    return NextResponse.json({ ok: false, error: 'reservation_id_and_dates_required' }, { status: 400 });
  }

  try {
    const result = await modifyChannelReservationDates(auth.ctx, reservationId, checkInDate, checkOutDate);
    return NextResponse.json({ ok: result.available, result }, { status: result.available ? 200 : 409 });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}
