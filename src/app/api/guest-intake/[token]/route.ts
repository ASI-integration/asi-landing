import { NextResponse } from 'next/server';
import {
  loadGuestIntakeByToken,
  parseGuestIntakeSubmission,
  recordGuestIntakeLinkOpened,
  submitGuestIntake,
} from '@/lib/booking-ops/guest-intake-inbound';
import { GUEST_INTAKE_FIELD_LABELS_RU } from '@/lib/booking-ops/guest-intake-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { token: string } };

function publicRecordLabel(record: NonNullable<Awaited<ReturnType<typeof loadGuestIntakeByToken>>['record']>): string {
  return record.propertyLabel?.trim() || 'вашему объекту';
}

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const result = await recordGuestIntakeLinkOpened(context.params.token);
  if (!result.ok || !result.session || !result.record) {
    return NextResponse.json({ ok: false, message: 'Форма не найдена.' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    intake: {
      status: result.session.intakeStatus,
      missingFields: result.session.missingFields,
      validationErrors: result.session.validationErrors,
      fieldLabels: GUEST_INTAKE_FIELD_LABELS_RU,
      propertyLabel: publicRecordLabel(result.record),
      lastGuestActivityAt: result.session.lastGuestActivityAt,
      fallbackReason: result.session.fallbackReason,
    },
  });
}

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось прочитать данные.' }, { status: 400 });
  }

  const result = await submitGuestIntake({
    token: context.params.token,
    source: 'web',
    submission: parseGuestIntakeSubmission(body),
  });
  if (!result.ok || !result.session || !result.record) {
    const status = result.error === 'not_found' ? 404 : 500;
    return NextResponse.json(
      { ok: false, message: result.error ?? 'Не удалось сохранить данные.' },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    message: result.message,
    intake: {
      status: result.session.intakeStatus,
      missingFields: result.session.missingFields,
      validationErrors: result.validationErrors ?? result.session.validationErrors,
      fieldLabels: GUEST_INTAKE_FIELD_LABELS_RU,
      propertyLabel: publicRecordLabel(result.record),
      lastGuestActivityAt: result.session.lastGuestActivityAt,
      fallbackReason: result.session.fallbackReason,
    },
  });
}
