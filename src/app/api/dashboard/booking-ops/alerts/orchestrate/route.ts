import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { orchestrateAllRelevantOpsAlerts, orchestrateBookingAutomationAndAlertsForBooking, orchestrateOpsAlertsForProperty } from '@/lib/booking-ops/ops-alert-orchestrator';
import { resolveReservationAccess } from '@/lib/reservations/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let accountId: string;
  try {
    accountId = (await resolveReservationAccess(auth.session)).accountId;
    if (accountId === 'legacy') throw new Error('account_workspace_unavailable');
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'account_workspace_unavailable' }, { status: 503 });
  }
  const body = await request.json().catch(() => ({})) as { bookingId?: string; propertyId?: string; now?: string; dryRun?: boolean; maxActions?: number };
  const result = body.bookingId
    ? await orchestrateBookingAutomationAndAlertsForBooking({ bookingId: body.bookingId, now: body.now, expectedAccountId: accountId, dryRun: body.dryRun === true, maxActions: body.maxActions })
    : body.propertyId
      ? await orchestrateOpsAlertsForProperty(body.propertyId, body.now, accountId)
      : await orchestrateAllRelevantOpsAlerts(body.now, 'manual', accountId);
  return NextResponse.json({ ok: result.errors.length === 0, result }, { status: result.errors.length ? 400 : 200 });
}
