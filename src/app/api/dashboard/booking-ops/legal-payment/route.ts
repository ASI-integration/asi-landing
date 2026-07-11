import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { getBookingOpsRecord } from '@/lib/booking-ops/repository';
import {
  getLegalPaymentStatus,
  initializeLegalPaymentForBooking,
  markContractSent,
  markContractSigned,
  markDepositReceived,
  markDocumentsReceived,
  markMvdReportAccepted,
  markMvdReportSubmitted,
  prepareContract,
  prepareMvdReport,
  rejectGuestDocuments,
  requestDeposit,
  requestGuestDocuments,
  verifyGuestDocuments,
  waiveDeposit,
} from '@/lib/booking-ops/legal-payment-autopilot';
import { emitLifecycleForAction } from '@/lib/booking-ops/lifecycle-entry-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = [
  'initialize',
  'request_documents',
  'documents_received',
  'verify_documents',
  'reject_documents',
  'prepare_contract',
  'contract_sent',
  'contract_signed',
  'request_deposit',
  'deposit_received',
  'waive_deposit',
  'prepare_mvd_report',
  'mvd_report_submitted',
  'mvd_report_accepted',
] as const;

type LegalPaymentAction = (typeof ACTIONS)[number];

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function isAction(value: unknown): value is LegalPaymentAction {
  return (ACTIONS as readonly string[]).includes(text(value));
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

async function requireBooking(bookingId: unknown): Promise<
  | { ok: true; id: string }
  | { ok: false; response: NextResponse }
> {
  const id = text(bookingId);
  if (!id) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, message: 'Не указана бронь.' }, { status: 400 }),
    };
  }
  const record = await getBookingOpsRecord(id);
  if (!record) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, message: 'Запись не найдена.' }, { status: 404 }),
    };
  }
  return { ok: true, id: record.id };
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const bookingId = new URL(req.url).searchParams.get('bookingId');
  const booking = await requireBooking(bookingId);
  if (!booking.ok) return booking.response;

  const status = await getLegalPaymentStatus(booking.id);
  return NextResponse.json({ ok: true, status });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const booking = await requireBooking(body.bookingId ?? body.booking_id);
  if (!booking.ok) return booking.response;

  const action = body.action;
  if (!isAction(action)) {
    return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
  }

  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata as Record<string, unknown>
    : {};

  try {
    const status = await runAction(action, booking.id, body, metadata);
    await emitLifecycleForAction({ bookingId: booking.id, action, actorId: auth.session.email ?? auth.session.userId ?? null, source: 'legal_payment', payload: metadata });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Действие не выполнено.' },
      { status: 500 },
    );
  }
}

async function runAction(
  action: LegalPaymentAction,
  bookingId: string,
  body: Record<string, unknown>,
  metadata: Record<string, unknown>,
) {
  switch (action) {
    case 'initialize':
      return initializeLegalPaymentForBooking(bookingId);
    case 'request_documents':
      return requestGuestDocuments(bookingId, parseStringList(body.requiredDocuments), metadata);
    case 'documents_received':
      return markDocumentsReceived(bookingId, metadata);
    case 'verify_documents':
      return verifyGuestDocuments(bookingId, metadata);
    case 'reject_documents':
      return rejectGuestDocuments(bookingId, text(body.reason), metadata);
    case 'prepare_contract':
      return prepareContract(bookingId, text(body.templateKey ?? body.template_key) || undefined, metadata);
    case 'contract_sent':
      return markContractSent(bookingId, metadata);
    case 'contract_signed':
      return markContractSigned(bookingId, metadata);
    case 'request_deposit':
      return requestDeposit(bookingId, Number(body.amount), text(body.currency) || 'RUB', metadata);
    case 'deposit_received':
      return markDepositReceived(bookingId, metadata);
    case 'waive_deposit':
      return waiveDeposit(bookingId, text(body.reason), metadata);
    case 'prepare_mvd_report':
      return prepareMvdReport(bookingId, metadata);
    case 'mvd_report_submitted':
      return markMvdReportSubmitted(bookingId, metadata);
    case 'mvd_report_accepted':
      return markMvdReportAccepted(bookingId, metadata);
  }
}
