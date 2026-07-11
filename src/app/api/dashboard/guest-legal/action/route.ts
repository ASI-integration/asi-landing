import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  addGuestLegalNote,
  blockGuestLegalFlow,
  createContractDraft,
  createDepositRequestDraft,
  createMvdDraft,
  initializeGuestLegalExecution,
  markContractSignedManual,
  markDepositPaidManual,
  markDepositWaivedManual,
  markGuestDocumentsNeedsReview,
  markGuestDocumentsVerifiedManual,
  markMvdAcceptedManual,
  markMvdNotRequired,
  markMvdSubmittedManual,
  recomputeGuestLegalReadiness,
  recordGuestDocumentsReceived,
  requestGuestDocumentsDraft,
} from '@/lib/booking-ops/guest-legal-deposit-mvd-execution';
import { emitLifecycleForAction } from '@/lib/booking-ops/lifecycle-entry-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = [
  'initialize', 'recompute_readiness', 'create_documents_request_draft',
  'record_documents_received', 'mark_documents_needs_review', 'mark_documents_verified_manual',
  'create_contract_draft', 'mark_contract_signed_manual', 'create_deposit_request_draft',
  'mark_deposit_paid_manual', 'mark_deposit_waived_manual', 'create_mvd_draft',
  'mark_mvd_not_required', 'mark_mvd_submitted_manual', 'mark_mvd_accepted_manual',
  'block_legal_flow', 'add_note',
] as const;
type Action = (typeof ACTIONS)[number];

function text(value: unknown): string { return String(value ?? '').trim(); }
function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 }); }
  const action = text(body.action) as Action;
  if (!(ACTIONS as readonly string[]).includes(action)) return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
  const bookingId = text(body.bookingId ?? body.booking_id);
  const meta = metadata(body.metadata);
  try {
    const readiness = await runAction(action, bookingId, body, meta);
    await emitLifecycleForAction({ bookingId, action, actorId: auth.session.email ?? auth.session.userId ?? null, source: 'guest_legal', payload: meta });
    return NextResponse.json({ ok: true, readiness });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Действие не выполнено.' }, { status: 400 });
  }
}

async function runAction(action: Action, bookingId: string, body: Record<string, unknown>, meta: Record<string, unknown>) {
  switch (action) {
    case 'initialize': return initializeGuestLegalExecution(bookingId, meta);
    case 'recompute_readiness': return recomputeGuestLegalReadiness(bookingId, meta);
    case 'create_documents_request_draft': return requestGuestDocumentsDraft(bookingId, meta);
    case 'record_documents_received': return recordGuestDocumentsReceived(bookingId, {
      documentReceived: body.documentReceived !== false,
      documentType: text(body.documentType),
      maskedDocumentReference: text(body.maskedDocumentReference),
      missingFields: Array.isArray(body.missingFields) ? body.missingFields.map(text) : [],
      safeNotes: text(body.safeNotes),
    }, meta);
    case 'mark_documents_needs_review': return markGuestDocumentsNeedsReview(bookingId, text(body.reason), meta);
    case 'mark_documents_verified_manual': return markGuestDocumentsVerifiedManual(bookingId, meta);
    case 'create_contract_draft': return createContractDraft(bookingId, { ...meta, templateKey: text(body.templateKey) });
    case 'mark_contract_signed_manual': return markContractSignedManual(bookingId, meta);
    case 'create_deposit_request_draft': return createDepositRequestDraft(bookingId, { ...meta, amount: body.amount, currency: text(body.currency) });
    case 'mark_deposit_paid_manual': return markDepositPaidManual(bookingId, meta);
    case 'mark_deposit_waived_manual': return markDepositWaivedManual(bookingId, text(body.reason), meta);
    case 'create_mvd_draft': return createMvdDraft(bookingId, { ...meta, enoughData: body.enoughData !== false });
    case 'mark_mvd_not_required': return markMvdNotRequired(bookingId, text(body.reason), meta);
    case 'mark_mvd_submitted_manual': return markMvdSubmittedManual(bookingId, meta);
    case 'mark_mvd_accepted_manual': return markMvdAcceptedManual(bookingId, meta);
    case 'block_legal_flow': return blockGuestLegalFlow(bookingId, text(body.reason), meta);
    case 'add_note': return addGuestLegalNote(bookingId, text(body.note), meta);
  }
}
