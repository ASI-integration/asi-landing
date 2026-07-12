import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { recordBookingOpsEvent } from '@/lib/booking-ops/events';
import { bootstrapBookingLifecycle, getBookingLifecycleSummary } from '@/lib/booking-ops/lifecycle-autopilot-service';
import { getBookingOpsRecord } from '@/lib/booking-ops/repository';

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
  const record = await getBookingOpsRecord(bookingOpsRecordId);
  if (!record) return NextResponse.json({ ok: false, message: 'booking_not_found' }, { status: 404 });
  const actorId = auth.session.email ?? auth.session.userId ?? null;
  const outcome = await bootstrapBookingLifecycle({ bookingId: record.id, objectId: record.propertyId, actorId });
  await recordBookingOpsEvent({
    bookingOpsRecordId: record.id,
    eventType: 'booking_updated',
    title: 'OPS v16 lifecycle bootstrap',
    description: outcome.duplicate ? 'Lifecycle bootstrap was already present.' : 'Lifecycle bootstrap was initialized.',
    actorType: 'admin',
    metadata: { domainEventId: outcome.eventId, duplicate: outcome.duplicate, messagingDisabled: true },
    dedupeKey: `ops-v16-bootstrap:${record.id}`,
  });
  return NextResponse.json({ ok: true, bootstrap: outcome, lifecycle: await getBookingLifecycleSummary(record.id) });
}
