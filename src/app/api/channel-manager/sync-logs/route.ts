import { NextResponse } from 'next/server';
import { requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { channelManagerApiErrorResponse } from '@/lib/channel-manager/api';
import { listSyncLogs } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const syncLogs = await listSyncLogs(auth.ctx);
    return NextResponse.json({ ok: true, syncLogs });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}
