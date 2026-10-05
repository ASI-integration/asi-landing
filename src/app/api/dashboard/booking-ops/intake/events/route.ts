import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { requireBookingOpsApiAccount } from '../../access';
import { listInboundIntakeEventsEnriched } from '@/lib/booking-ops/real-booking-intake-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const account = await requireBookingOpsApiAccount(auth.session);
  if (!account.ok) return account.response;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 30) || 30, 1), 100);
  const events = await listInboundIntakeEventsEnriched(limit, account.accountId);

  return NextResponse.json({
    ok: true,
    events,
    refreshedAt: new Date().toISOString(),
  });
}
