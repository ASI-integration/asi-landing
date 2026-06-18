import { NextResponse } from 'next/server';
import { optionalString, readJsonObject, requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { channelManagerApiErrorResponse } from '@/lib/channel-manager/api';
import { cancelChannelReservation, modifyChannelReservationDates } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(req);
  const checkInDate = optionalString(body.checkInDate);
  const checkOutDate = optionalString(body.checkOutDate);
  if (!checkInDate || !checkOutDate) {
    return NextResponse.json({ ok: false, error: 'dates_required' }, { status: 400 });
  }

  try {
    const result = await modifyChannelReservationDates(auth.ctx, params.id, checkInDate, checkOutDate);
    return NextResponse.json({ ok: result.available, result }, { status: result.available ? 200 : 409 });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const result = await cancelChannelReservation(auth.ctx, params.id);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}
