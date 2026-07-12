import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { reconcileBookingLifecycle } from '@/lib/booking-ops/lifecycle-reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  try {
    const body = await req.json() as Record<string, unknown>;
    const bookingId = String(body.bookingOpsRecordId ?? '').trim();
    if (!bookingId) return NextResponse.json({ ok: false, message: 'bookingOpsRecordId_required' }, { status: 400 });
    const access = await resolveReservationAccess(auth.session);
    const result = await reconcileBookingLifecycle({ bookingId, accountId: access.accountId, actorId: access.actorId, dryRun: body.dryRun !== false });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'reconciliation_failed';
    return NextResponse.json({ ok: false, message }, { status: message.includes('account') ? 403 : message.includes('not_found') ? 404 : 400 });
  }
}
