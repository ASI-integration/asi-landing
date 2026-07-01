import { NextResponse } from 'next/server';
import {
  checkWebIntakeRateLimit,
  processInboundBookingRequest,
  validatePublicWebIntakePayload,
} from '@/lib/booking-ops/real-booking-intake-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientKey(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')?.trim()
    ?? 'anonymous';
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!checkWebIntakeRateLimit(clientKey(req))) {
    return NextResponse.json(
      { ok: false, message: 'Слишком много запросов. Попробуйте позже.' },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const validationError = validatePublicWebIntakePayload(body);
  if (validationError) {
    return NextResponse.json({ ok: false, message: validationError }, { status: 400 });
  }

  const result = await processInboundBookingRequest(body, 'web');

  return NextResponse.json({
    ok: result.intakeStatus !== 'failed',
    result: {
      intakeId: result.intakeId,
      bookingId: result.bookingId,
      intakeStatus: result.intakeStatus,
      missingRequiredFields: result.missingRequiredFields,
      nextRequiredActions: result.nextRequiredActions,
      safeSummary: result.safeSummary,
      duplicateOfBookingId: result.duplicateOfBookingId,
    },
  }, { status: result.intakeStatus === 'failed' ? 500 : 201 });
}
