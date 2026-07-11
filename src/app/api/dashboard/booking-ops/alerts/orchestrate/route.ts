import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { orchestrateAllRelevantOpsAlerts, orchestrateOpsAlertsForBooking, orchestrateOpsAlertsForProperty } from '@/lib/booking-ops/ops-alert-orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as { bookingId?: string; propertyId?: string; now?: string };
  const result = body.bookingId
    ? await orchestrateOpsAlertsForBooking(body.bookingId, body.now)
    : body.propertyId ? await orchestrateOpsAlertsForProperty(body.propertyId, body.now) : await orchestrateAllRelevantOpsAlerts(body.now, 'manual');
  return NextResponse.json({ ok: result.errors.length === 0, result }, { status: result.errors.length ? 400 : 200 });
}
