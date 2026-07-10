import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import {
  CheckinReadinessPrerequisiteError,
  getCheckinExecutionStatus,
  runCheckinExecutionAction,
} from '@/lib/booking-ops/checkin-execution-autopilot';
import {
  BOOKING_OPS_COMMUNICATION_CHANNELS,
  type BookingOpsCommunicationChannel,
} from '@/lib/booking-ops/types';

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

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const bookingId = text(new URL(req.url).searchParams.get('bookingId'));
  if (!bookingId) {
    return NextResponse.json({ ok: false, message: 'booking_id_required' }, { status: 400 });
  }

  try {
    const checkin = await getCheckinExecutionStatus(bookingId);
    return NextResponse.json({ ok: true, checkin });
  } catch (error) {
    if (error instanceof CheckinReadinessPrerequisiteError) {
      return NextResponse.json({
        ok: false,
        code: error.code,
        message: error.message,
        missingPrerequisites: error.missingPrerequisites,
      }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Не удалось загрузить заселение.';
    return NextResponse.json({ ok: false, message }, { status: statusForError(message) });
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
    const checkin = await runCheckinExecutionAction({
      bookingId,
      action,
      channel: normalizeChannel(body.channel),
      reason: body.reason,
      note: body.note,
      arrivalTime: body.arrivalTime ?? body.arrival_time,
      metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata as Record<string, unknown> : {},
    });
    return NextResponse.json({ ok: true, checkin });
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
    return NextResponse.json({ ok: false, message }, { status: statusForError(message) });
  }
}
