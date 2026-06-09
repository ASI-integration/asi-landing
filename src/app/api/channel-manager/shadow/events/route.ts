import { NextResponse } from 'next/server';
import { readJsonObject, requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { channelManagerApiErrorResponse, parseCreateShadowBookingEventInput } from '@/lib/channel-manager/api';
import { createShadowBookingEvent } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const input = parseCreateShadowBookingEventInput(await readJsonObject(req));
  if (!input) {
    return NextResponse.json({ ok: false, error: 'shadow_event_payload_required' }, { status: 400 });
  }

  try {
    const result = await createShadowBookingEvent(auth.ctx, input);
    return NextResponse.json({ ok: true, result }, { status: result.idempotent ? 200 : 201 });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}
