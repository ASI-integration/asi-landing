import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import {
  getOwnerObjectSetupBlockers,
  getPropertySetupById,
} from '@/lib/booking-ops/owner-object-setup-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const propertySetupId = url.searchParams.get('propertySetupId')?.trim();
  if (!propertySetupId) {
    return NextResponse.json({ ok: false, message: 'Укажите propertySetupId.' }, { status: 400 });
  }

  const propertySetup = await getPropertySetupById(propertySetupId);
  if (!propertySetup) {
    return NextResponse.json({ ok: false, message: 'Профиль объекта не найден.' }, { status: 404 });
  }

  const blockers = await getOwnerObjectSetupBlockers({ propertySetupId });

  return NextResponse.json({
    ok: true,
    propertySetup: {
      ...propertySetup,
      metadata: {
        channel_handoff_status: propertySetup.channelHandoffStatus,
        base_price_label: propertySetup.metadata.base_price_label ?? null,
      },
    },
    blockers,
    nextAction: blockers?.nextAction ?? null,
  });
}
