import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { recordBookingOpsEvent } from '@/lib/booking-ops/events';
import { bootstrapBookingLifecycle, getBookingLifecycleSummary } from '@/lib/booking-ops/lifecycle-autopilot-service';
import { requireBookingOpsRecordScope } from '@/lib/booking-ops/repository';
import { requireBookingOpsRouteAccess } from '@/lib/booking-ops/route-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, message: 'invalid_json' }, { status: 400 }); }
  const bookingOpsRecordId = String(body.bookingOpsRecordId ?? '').trim();
  if (!bookingOpsRecordId) return NextResponse.json({ ok: false, message: 'booking_ops_record_id_required' }, { status: 400 });

  try {
    const access = await requireBookingOpsRouteAccess(auth.session, bookingOpsRecordId);
    const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
    const outcome = await bootstrapBookingLifecycle({
      bookingId: access.bookingId,
      objectId: access.propertyId,
      actorId: access.actorId,
    }, expectedScope);
    await requireBookingOpsRecordScope(access.bookingId, expectedScope);
    await recordBookingOpsEvent({
      bookingOpsRecordId: access.bookingId,
      eventType: 'booking_updated',
      title: 'OPS v16 lifecycle bootstrap',
      description: outcome.duplicate ? 'Lifecycle bootstrap was already present.' : 'Lifecycle bootstrap was initialized.',
      actorType: 'admin',
      metadata: { domainEventId: outcome.eventId, duplicate: outcome.duplicate, messagingDisabled: true },
      dedupeKey: `ops-v16-bootstrap:${access.bookingId}`,
    });
    const lifecycle = await getBookingLifecycleSummary(access.bookingId, expectedScope);
    return NextResponse.json({ ok: true, bootstrap: outcome, lifecycle });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'lifecycle_bootstrap_failed';
    const status = message.includes('scope') || message.includes('account') ? 403 : message.includes('not_found') ? 404 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
