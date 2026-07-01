import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getOwnerSetupStatus } from '@/lib/booking-ops/owner-object-setup-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { leadId: string } };

function safeOwnerSetupResponse(status: Awaited<ReturnType<typeof getOwnerSetupStatus>>) {
  return {
    ok: true,
    ownerSetup: status.ownerSetup,
    propertySetups: status.propertySetups.map((p) => ({
      ...p,
      metadata: {
        channel_handoff_status: p.channelHandoffStatus,
        base_price_label: p.metadata.base_price_label ?? null,
        photos_placeholder: p.metadata.photos_placeholder ?? null,
      },
    })),
    blockers: status.blockers,
    communicationCount: status.communications.length,
    nextAction: status.blockers?.nextAction ?? null,
  };
}

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const status = await getOwnerSetupStatus({ leadId: context.params.leadId });
  return NextResponse.json(safeOwnerSetupResponse(status));
}
