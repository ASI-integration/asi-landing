import { NextResponse } from 'next/server';
import { optionalString, readJsonObject, requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { channelManagerApiErrorResponse } from '@/lib/channel-manager/api';
import { cancelChannelReservation } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(req);
  const reservationId = optionalString(body.reservationId);
  if (!reservationId) {
    return NextResponse.json({ ok: false, error: 'reservation_id_required' }, { status: 400 });
  }

  try {
    const result = await cancelChannelReservation(auth.ctx, reservationId);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}
