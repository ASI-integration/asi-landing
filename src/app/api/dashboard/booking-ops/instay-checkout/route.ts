import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import {
  BookingClosePrerequisiteError,
  getInStayCheckoutStatus,
  runInStayCheckoutAction,
} from '@/lib/booking-ops/instay-checkout-autopilot';
import {
  BOOKING_OPS_COMMUNICATION_CHANNELS,
  type BookingOpsCommunicationChannel,
} from '@/lib/booking-ops/types';
import { emitLifecycleForAction } from '@/lib/booking-ops/lifecycle-entry-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ACTIONS = new Set([
  'open_support_window',
  'create_guest_issue',
  'triage_guest_issue',
  'resolve_guest_issue',
  'prepare_checkout_instructions',
  'queue_checkout_instructions',
  'mark_checkout_instructions_sent',
  'request_checkout_confirmation',
  'mark_guest_checked_out',
  'trigger_post_checkout_inspection',
  'mark_post_checkout_inspection_done',
  'mark_deposit_return_ready',
  'mark_booking_closed',
  'create_fallback',
  'add_note',
]);

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function statusForError(message: string): number {
  if (message === 'booking_id_required' || message === 'invalid_action' || message === 'issue_id_required') return 400;
  if (message.startsWith('booking_close_prerequisites_incomplete')) return 400;
  if (message === 'booking_not_found' || message === 'issue_not_found') return 404;
  if (message === 'guest_not_checked_in') return 400;
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
    const instayCheckout = await getInStayCheckoutStatus(bookingId);
    return NextResponse.json({ ok: true, instayCheckout });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось загрузить проживание.';
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
    const instayCheckout = await runInStayCheckoutAction({
      bookingId,
      action,
      channel: normalizeChannel(body.channel),
      reason: body.reason,
      note: body.note,
      issueId: body.issueId ?? body.issue_id,
      issueType: body.issueType ?? body.issue_type,
      severity: body.severity,
      description: body.description,
      resolution: body.resolution,
      result: body.result,
      actualCheckoutAt: body.actualCheckoutAt ?? body.actual_checkout_at,
      metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata as Record<string, unknown> : {},
    });
    await emitLifecycleForAction({ bookingId, action, actorId: auth.session.email ?? auth.session.userId ?? null, source: 'instay_checkout', payload: { actualCheckoutAt: body.actualCheckoutAt ?? body.actual_checkout_at ?? null } });
    return NextResponse.json({ ok: true, instayCheckout });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось обновить проживание.';
    if (error instanceof BookingClosePrerequisiteError) {
      return NextResponse.json({
        ok: false,
        message,
        code: error.code,
        missingPrerequisites: error.missingPrerequisites,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: false, message }, { status: statusForError(message) });
  }
}
