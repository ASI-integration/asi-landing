import { NextResponse } from 'next/server';
import { readJsonObject, requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { channelManagerApiErrorResponse, parseCreateChannelReservationInput } from '@/lib/channel-manager/api';
import { createChannelReservation } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const input = parseCreateChannelReservationInput(await readJsonObject(req));
  if (!input) {
    return NextResponse.json({ ok: false, error: 'mock_reservation_payload_required' }, { status: 400 });
  }

  try {
    const result = await createChannelReservation(auth.ctx, {
      ...input,
      channelCode: input.channelCode ?? 'yandex_travel',
    });
    const ok = result.available || result.idempotent || result.status === 'pending';
    return NextResponse.json({ ok, result }, { status: ok ? 201 : 409 });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}
