import { NextResponse } from 'next/server';
import { optionalString, requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { channelManagerApiErrorResponse } from '@/lib/channel-manager/api';
import { listSyncJobs } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const propertyId = optionalString(new URL(req.url).searchParams.get('propertyId'));
    const syncJobs = await listSyncJobs(auth.ctx, propertyId);
    return NextResponse.json({ ok: true, syncJobs });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}
