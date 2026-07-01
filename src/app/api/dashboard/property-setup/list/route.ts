import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import {
  listPropertySetups,
  type PropertySetupStatus,
} from '@/lib/booking-ops/owner-object-setup-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const ownerSetupId = url.searchParams.get('ownerSetupId')?.trim() || undefined;
  const leadId = url.searchParams.get('leadId')?.trim() || undefined;
  const status = url.searchParams.get('status')?.trim() as PropertySetupStatus | undefined;
  const limitRaw = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;

  const records = await listPropertySetups({ ownerSetupId, leadId, status, limit });

  return NextResponse.json({
    ok: true,
    records: records.map((p) => ({
      ...p,
      metadata: {
        channel_handoff_status: p.channelHandoffStatus,
        base_price_label: p.metadata.base_price_label ?? null,
      },
    })),
  });
}
