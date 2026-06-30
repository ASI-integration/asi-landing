import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  recomputeBookingCheckinReadiness,
  runPreCheckinAction,
} from '@/lib/booking-ops/pre-checkin-control-center';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const bookingId = text(body.bookingId ?? body.booking_id);
  if (!bookingId) {
    return NextResponse.json({ ok: false, message: 'Не указана бронь.' }, { status: 400 });
  }

  try {
    const readiness = body.action
      ? await runPreCheckinAction({
          bookingId,
          action: text(body.action),
          gateKey: body.gateKey ?? body.gate_key,
          reason: body.reason,
          note: body.note,
          metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : {},
        })
      : await recomputeBookingCheckinReadiness(bookingId);
    return NextResponse.json({
      ok: true,
      readiness,
      message: 'Контроль заезда пересчитан. Внешние сообщения не отправлялись.',
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Не удалось пересчитать контроль заезда.' },
      { status: 500 },
    );
  }
}
