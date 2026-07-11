import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { processInboundBookingRequest } from '@/lib/booking-ops/real-booking-intake-autopilot';
import { recordAndProcessBookingEvent } from '@/lib/booking-ops/lifecycle-autopilot-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const source = String(body.source ?? 'admin').trim() as 'admin' | 'web' | 'telegram';
  const allowedSources = new Set(['admin', 'web', 'telegram', 'email_placeholder', 'channel_manager_placeholder']);
  if (!allowedSources.has(source)) {
    return NextResponse.json({ ok: false, message: 'Недопустимый источник.' }, { status: 400 });
  }

  const result = await processInboundBookingRequest(body, source, {
    force: body.force === true,
    action: typeof body.action === 'string'
      ? body.action as 'process' | 'mark_duplicate' | 'attach_property' | 'attach_guest' | 'request_missing_data' | 'create_fallback'
      : 'process',
    attachPropertyId: typeof body.attachPropertyId === 'string' ? body.attachPropertyId : undefined,
    attachPropertyLabel: typeof body.attachPropertyLabel === 'string' ? body.attachPropertyLabel : undefined,
    attachGuestName: typeof body.attachGuestName === 'string' ? body.attachGuestName : undefined,
    attachGuestPhone: typeof body.attachGuestPhone === 'string' ? body.attachGuestPhone : undefined,
    attachGuestEmail: typeof body.attachGuestEmail === 'string' ? body.attachGuestEmail : undefined,
    attachGuestTelegram: typeof body.attachGuestTelegram === 'string' ? body.attachGuestTelegram : undefined,
    duplicateOfBookingId: typeof body.duplicateOfBookingId === 'string' ? body.duplicateOfBookingId : undefined,
    intakeEventId: typeof body.intakeEventId === 'string' ? body.intakeEventId : undefined,
  });

  if (result.bookingId && result.intakeStatus !== 'duplicate') {
    await recordAndProcessBookingEvent({
      id: result.intakeId, bookingId: result.bookingId, type: 'booking.received', actorType: 'operator',
      actorId: auth.session.email ?? auth.session.userId ?? null, source: `booking_intake:${source}`,
      correlationId: result.intakeId, payload: { intakeStatus: result.intakeStatus },
    });
  }

  return NextResponse.json({ ok: true, result }, { status: 200 });
}
