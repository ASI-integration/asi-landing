import { NextResponse } from 'next/server';
import { requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { channelManagerApiErrorResponse } from '@/lib/channel-manager/api';
import { healthCheckChannel } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const result = await healthCheckChannel(auth.ctx, params.id);
    return NextResponse.json({ ok: result.ok, result });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}
