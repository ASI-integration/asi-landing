import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { sameIdentity } from '@/lib/platform/decision';
import { adaptResidentialOpsDecision } from '@/lib/platform/ops-decision';
import { resolveResidentialBookingIdentity } from '@/lib/platform/residential-booking-scope';
import {
  CheckinReadinessPrerequisiteError,
  readCheckinExecutionStatus,
  runCheckinExecutionAction,
} from '@/lib/booking-ops/checkin-execution-autopilot';
import {
  BOOKING_OPS_COMMUNICATION_CHANNELS,
  type BookingOpsCommunicationChannel,
} from '@/lib/booking-ops/types';
import { emitLifecycleForAction } from '@/lib/booking-ops/lifecycle-entry-adapter';
import { readCheckinInstructionsGuard } from '@/lib/booking-ops/guest-legal-deposit-mvd-execution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ACTIONS = new Set([
  'prepare_instructions',
  'queue_instructions',
  'mark_instructions_sent',
  'request_arrival_confirmation',
  'mark_arrival_confirmed',
  'mark_access_ready',
  'report_access_issue',
  'resolve_access_issue',
  'mark_guest_checked_in',
  'create_fallback',
  'add_note',
]);

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function statusForError(message: string): number {
  if (message === 'booking_id_required' || message === 'invalid_action') return 400;
  if (message === 'booking_not_found') return 404;
  return 500;
}

function normalizeChannel(value: unknown): BookingOpsCommunicationChannel | undefined {
  const raw = text(value);
  return (BOOKING_OPS_COMMUNICATION_CHANNELS as readonly string[]).includes(raw)
    ? raw as BookingOpsCommunicationChannel
    : undefined;
}

async function projectCheckinAfterAction(input: {
  bookingId: string;
  accountId: string;
  identity: Awaited<ReturnType<typeof resolveResidentialBookingIdentity>>;
  fallback: Awaited<ReturnType<typeof runCheckinExecutionAction>>;
}) {
  let checkin = input.fallback;
  let platformDecision = adaptResidentialOpsDecision(
    input.identity,
    'checkin',
    { available: false, reason: 'unavailable' },
    Date.now(),
  );
  try {
    const [current, legalGuard] = await Promise.all([
      readCheckinExecutionStatus(input.bookingId),
      readCheckinInstructionsGuard(input.bookingId),
    ]);
    const currentIdentity = await resolveResidentialBookingIdentity(input.bookingId, input.accountId);
    if (!sameIdentity(input.identity, currentIdentity)) {
      return {
        checkin,
        platformDecision: adaptResidentialOpsDecision(
          input.identity,
          'checkin',
          { available: false, reason: 'state_changed' },
          Date.now(),
        ),
      };
    }
    checkin = current;
    platformDecision = legalGuard
      ? adaptResidentialOpsDecision(input.identity, 'checkin', {
          available: true,
          identity: input.identity,
          observedAt: checkin.updatedAt,
          value: { kind: 'checkin', checkin, legalGuard },
        }, Date.now())
      : platformDecision;
  } catch {
    // The command already succeeded. Projection failure must not make the client retry the mutation.
  }
  return { checkin, platformDecision };
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const bookingId = text(new URL(req.url).searchParams.get('bookingId'));
  if (!bookingId) {
    return NextResponse.json({ ok: false, message: 'booking_id_required' }, { status: 400 });
  }

  try {
    const access = await resolveReservationAccess(auth.session);
    const identity = await resolveResidentialBookingIdentity(bookingId, access.accountId);
    const [checkin, legalGuard] = await Promise.all([
      readCheckinExecutionStatus(bookingId),
      readCheckinInstructionsGuard(bookingId),
    ]);
    const currentIdentity = await resolveResidentialBookingIdentity(bookingId, access.accountId);
    if (!sameIdentity(identity, currentIdentity)) {
      return NextResponse.json({ ok: false, message: 'Состояние бронирования изменилось. Повторите запрос.' }, { status: 409 });
    }
    const platformDecision = legalGuard
      ? adaptResidentialOpsDecision(identity, 'checkin', {
          available: true,
          identity,
          observedAt: checkin.updatedAt,
          value: { kind: 'checkin', checkin, legalGuard },
        }, Date.now())
      : adaptResidentialOpsDecision(identity, 'checkin', { available: false, reason: 'unavailable' }, Date.now());
    return NextResponse.json({ ok: true, checkin, platformDecision });
  } catch (error) {
    if (error instanceof CheckinReadinessPrerequisiteError) {
      return NextResponse.json({
        ok: false,
        code: error.code,
        message: error.message,
        missingPrerequisites: error.missingPrerequisites,
      }, { status: 400 });
    }
    const code = error instanceof Error ? error.message : '';
    if (code === 'booking_not_found') {
      return NextResponse.json({ ok: false, message: 'Бронирование не найдено.' }, { status: 404 });
    }
    if (code === 'booking_scope_mismatch' || code === 'reservation_account_not_found') {
      return NextResponse.json({ ok: false, message: 'Нет доступа к бронированию.' }, { status: 403 });
    }
    if (code === 'booking_scope_unavailable') {
      return NextResponse.json({ ok: false, message: 'Не удалось подтвердить область бронирования.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить заселение.' }, { status: statusForError(code) });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'invalid_json' }, { status: 400 });
  }

  const bookingId = text(body.bookingId ?? body.booking_id);
  const action = text(body.action);
  if (!bookingId) {
    return NextResponse.json({ ok: false, message: 'booking_id_required' }, { status: 400 });
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, message: 'invalid_action' }, { status: 400 });
  }

  try {
    const access = await resolveReservationAccess(auth.session);
    const identity = await resolveResidentialBookingIdentity(bookingId, access.accountId);
    const actionResult = await runCheckinExecutionAction({
      bookingId,
      action,
      channel: normalizeChannel(body.channel),
      reason: body.reason,
      note: body.note,
      arrivalTime: body.arrivalTime ?? body.arrival_time,
      metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata as Record<string, unknown> : {},
    });
    await emitLifecycleForAction({
      bookingId,
      action,
      actorId: auth.session.email ?? auth.session.userId ?? null,
      source: 'checkin_execution',
      payload: { arrivalTime: body.arrivalTime ?? body.arrival_time ?? null },
    });
    const projected = await projectCheckinAfterAction({
      bookingId,
      accountId: access.accountId,
      identity,
      fallback: actionResult,
    });
    return NextResponse.json({ ok: true, ...projected });
  } catch (error) {
    if (error instanceof CheckinReadinessPrerequisiteError) {
      return NextResponse.json({
        ok: false,
        code: error.code,
        message: error.message,
        missingPrerequisites: error.missingPrerequisites,
      }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Не удалось обновить заселение.';
    if (message === 'booking_scope_mismatch' || message === 'reservation_account_not_found') {
      return NextResponse.json({ ok: false, message: 'Нет доступа к бронированию.' }, { status: 403 });
    }
    if (message === 'booking_scope_unavailable') {
      return NextResponse.json({ ok: false, message: 'Не удалось подтвердить область бронирования.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, message }, { status: statusForError(message) });
  }
}
