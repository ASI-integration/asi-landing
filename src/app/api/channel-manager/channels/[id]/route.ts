import { NextResponse } from 'next/server';
import { readJsonObject, requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { channelManagerApiErrorResponse, parseUpdateChannelInput } from '@/lib/channel-manager/api';
import { updateChannel } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const input = parseUpdateChannelInput(await readJsonObject(req));
  if (!input) {
    return NextResponse.json({ ok: false, error: 'channel_patch_required' }, { status: 400 });
  }

  try {
    const channel = await updateChannel(auth.ctx, params.id, input);
    return NextResponse.json({ ok: true, channel });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}
