import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { processInboundBookingRequest } from '@/lib/booking-ops/real-booking-intake-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const expected = process.env.BOOKING_OPS_INBOUND_INTAKE_SECRET?.trim()
    || process.env.BOOKING_OPS_AUTO_SEND_RUNNER_SECRET?.trim()
    || process.env.CRON_SECRET?.trim();
  const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, message: 'Нет доступа.' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const result = await processInboundBookingRequest(body, 'telegram');

  return NextResponse.json({
    ok: result.intakeStatus !== 'failed',
    result: {
      intakeId: result.intakeId,
      bookingId: result.bookingId,
      guestId: result.guestId,
      intakeStatus: result.intakeStatus,
      initializedModules: result.initializedModules,
      createdCommunicationIntents: result.createdCommunicationIntents.length,
      missingRequiredFields: result.missingRequiredFields,
      nextRequiredActions: result.nextRequiredActions,
      safeSummary: result.safeSummary,
      duplicateOfBookingId: result.duplicateOfBookingId,
    },
  }, { status: result.intakeStatus === 'failed' ? 500 : 201 });
}
