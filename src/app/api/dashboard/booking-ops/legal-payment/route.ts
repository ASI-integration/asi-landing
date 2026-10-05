import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsApiAccess } from '../access';
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

type ExpectedScope = { accountId: string; propertyId: string };

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const bookingId = new URL(req.url).searchParams.get('bookingId');
  const access = await requireBookingOpsApiAccess(auth.session, text(bookingId));
  if (!access.ok) return access.response;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
  const status = await getLegalPaymentStatus(access.bookingId, expectedScope);
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

  const access = await requireBookingOpsApiAccess(auth.session, text(body.bookingId ?? body.booking_id));
  if (!access.ok) return access.response;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };

  const action = body.action;
  if (!isAction(action)) {
    return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
  }

  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata as Record<string, unknown>
    : {};

  try {
    const status = await runAction(action, access.bookingId, body, metadata, expectedScope);
    await emitLifecycleForAction({ bookingId: access.bookingId, expectedScope, action, actorId: auth.session.email ?? auth.session.userId ?? null, source: 'legal_payment', payload: metadata });
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
  expectedScope: ExpectedScope,
) {
  switch (action) {
    case 'initialize':
      return initializeLegalPaymentForBooking(bookingId, expectedScope);
    case 'request_documents':
      return requestGuestDocuments(bookingId, parseStringList(body.requiredDocuments), metadata, expectedScope);
    case 'documents_received':
      return markDocumentsReceived(bookingId, metadata, expectedScope);
    case 'verify_documents':
      return verifyGuestDocuments(bookingId, metadata, expectedScope);
    case 'reject_documents':
      return rejectGuestDocuments(bookingId, text(body.reason), metadata, expectedScope);
    case 'prepare_contract':
      return prepareContract(bookingId, text(body.templateKey ?? body.template_key) || undefined, metadata, expectedScope);
    case 'contract_sent':
      return markContractSent(bookingId, metadata, expectedScope);
    case 'contract_signed':
      return markContractSigned(bookingId, metadata, expectedScope);
    case 'request_deposit':
      return requestDeposit(bookingId, Number(body.amount), text(body.currency) || 'RUB', metadata, expectedScope);
    case 'deposit_received':
      return markDepositReceived(bookingId, metadata, expectedScope);
    case 'waive_deposit':
      return waiveDeposit(bookingId, text(body.reason), metadata, expectedScope);
    case 'prepare_mvd_report':
      return prepareMvdReport(bookingId, metadata, expectedScope);
    case 'mvd_report_submitted':
      return markMvdReportSubmitted(bookingId, metadata, expectedScope);
    case 'mvd_report_accepted':
      return markMvdReportAccepted(bookingId, metadata, expectedScope);
  }
}
