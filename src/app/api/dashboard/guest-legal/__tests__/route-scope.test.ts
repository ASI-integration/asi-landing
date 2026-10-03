import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), lifecycle: vi.fn(),
  flow: Object.fromEntries(["initializeGuestLegalExecution","recomputeGuestLegalReadiness","requestGuestDocumentsDraft","recordGuestDocumentsReceived","markGuestDocumentsNeedsReview","markGuestDocumentsVerifiedManual","createContractDraft","markContractSignedManual","createDepositRequestDraft","markDepositPaidManual","markDepositWaivedManual","createMvdDraft","markMvdNotRequired","markMvdSubmittedManual","markMvdAcceptedManual","blockGuestLegalFlow","addGuestLegalNote","getGuestLegalReadiness","buildLegalSummaryForBookingOps","explainGuestLegalReadiness","listGuestLegalEvents"].map(name => [name, vi.fn()])),
}));
vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: mocks.auth, requireOpsAdminSession: mocks.auth,
}));
vi.mock('@/app/api/dashboard/booking-ops/access', () => ({ requireBookingOpsApiAccess: mocks.access }));
vi.mock('@/lib/booking-ops/guest-legal-deposit-mvd-execution', () => mocks.flow);
vi.mock('@/lib/booking-ops/lifecycle-entry-adapter', () => ({ emitLifecycleForAction: mocks.lifecycle }));
import { POST } from '../action/route';
import { GET as status } from '../status/route';
import { GET as explain } from '../explain/route';
import { GET as events } from '../events/route';
const canonical = { ok: true, bookingId: 'canonical-booking', accountId: 'account-a', propertyId: 'property-a' };
const scope = { accountId: canonical.accountId, propertyId: canonical.propertyId };
const cases = [["initialize","initializeGuestLegalExecution"],["recompute_readiness","recomputeGuestLegalReadiness"],["create_documents_request_draft","requestGuestDocumentsDraft"],["record_documents_received","recordGuestDocumentsReceived"],["mark_documents_needs_review","markGuestDocumentsNeedsReview"],["mark_documents_verified_manual","markGuestDocumentsVerifiedManual"],["create_contract_draft","createContractDraft"],["mark_contract_signed_manual","markContractSignedManual"],["create_deposit_request_draft","createDepositRequestDraft"],["mark_deposit_paid_manual","markDepositPaidManual"],["mark_deposit_waived_manual","markDepositWaivedManual"],["create_mvd_draft","createMvdDraft"],["mark_mvd_not_required","markMvdNotRequired"],["mark_mvd_submitted_manual","markMvdSubmittedManual"],["mark_mvd_accepted_manual","markMvdAcceptedManual"],["block_legal_flow","blockGuestLegalFlow"],["add_note","addGuestLegalNote"]] as const;
function request(action: string) {
  return new Request('http://localhost/api/dashboard/guest-legal/action', {
    method: 'POST', body: JSON.stringify({
      action, bookingId: 'request-booking', accountId: 'attacker', propertyId: 'attacker',
      metadata: { accountId: 'attacker', propertyId: 'attacker' },
    }),
  });
}
describe('guest-legal canonical route scope', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ session: { userId: 'operator' } });
    mocks.access.mockResolvedValue(canonical);
    mocks.flow.getGuestLegalReadiness.mockResolvedValue({});
  });
  it.each(cases)('binds %s and lifecycle emission to canonical scope', async (action, fn) => {
    expect((await POST(request(action))).status).toBe(200);
    expect(mocks.flow[fn].mock.calls[0][0]).toBe(canonical.bookingId);
    expect(mocks.flow[fn].mock.calls[0].at(-1)).toEqual(scope);
    expect(mocks.lifecycle).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: canonical.bookingId, expectedScope: scope,
    }));
  });
  it.each([
    ['status', status, 'buildLegalSummaryForBookingOps'],
    ['explain', explain, 'explainGuestLegalReadiness'],
    ['events', events, 'listGuestLegalEvents'],
  ])('binds %s reads/recompute to canonical scope', async (_name, call, fn) => {
    expect((await call(new Request('http://localhost/?bookingId=request-booking'))).status).toBe(200);
    expect(mocks.flow[fn]).toHaveBeenCalledWith(canonical.bookingId, scope);
  });
  it.each([403, 409])('denies inaccessible/unbound mutations (%s) without side effects', async code => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ ok: false }, { status: code }) });
    expect((await POST(request('initialize'))).status).toBe(code);
    expect(mocks.flow.initializeGuestLegalExecution).not.toHaveBeenCalled();
    expect(mocks.lifecycle).not.toHaveBeenCalled();
  });
  it.each([status, explain, events])('denies cross-account reads before nested recompute', async call => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ ok: false }, { status: 403 }) });
    expect((await call(new Request('http://localhost/?bookingId=other-booking'))).status).toBe(403);
    for (const fn of Object.values(mocks.flow)) expect(fn).not.toHaveBeenCalled();
  });
});
