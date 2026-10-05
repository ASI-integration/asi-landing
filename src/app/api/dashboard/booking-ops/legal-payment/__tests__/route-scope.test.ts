import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), lifecycle: vi.fn(),
  initialize: vi.fn(), documents: vi.fn(), received: vi.fn(), verify: vi.fn(),
  reject: vi.fn(), contract: vi.fn(), sent: vi.fn(), signed: vi.fn(),
  deposit: vi.fn(), paid: vi.fn(), waive: vi.fn(), mvd: vi.fn(),
  submitted: vi.fn(), accepted: vi.fn(), status: vi.fn(),
}));
vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: mocks.auth, requireOpsAdminSession: mocks.auth,
}));
vi.mock('../../access', () => ({ requireBookingOpsApiAccess: mocks.access }));
vi.mock('@/lib/booking-ops/lifecycle-entry-adapter', () => ({ emitLifecycleForAction: mocks.lifecycle }));
vi.mock('@/lib/booking-ops/legal-payment-autopilot', () => ({
  initializeLegalPaymentForBooking: mocks.initialize, requestGuestDocuments: mocks.documents,
  markDocumentsReceived: mocks.received, verifyGuestDocuments: mocks.verify,
  rejectGuestDocuments: mocks.reject, prepareContract: mocks.contract,
  markContractSent: mocks.sent, markContractSigned: mocks.signed,
  requestDeposit: mocks.deposit, markDepositReceived: mocks.paid, waiveDeposit: mocks.waive,
  prepareMvdReport: mocks.mvd, markMvdReportSubmitted: mocks.submitted,
  markMvdReportAccepted: mocks.accepted, getLegalPaymentStatus: mocks.status,
}));
import { GET, POST } from '../route';
const canonical = { ok: true, bookingId: 'canonical-booking', accountId: 'account-a', propertyId: 'property-a' };
const scope = { accountId: canonical.accountId, propertyId: canonical.propertyId };
const cases = [
  ['initialize', mocks.initialize], ['request_documents', mocks.documents],
  ['documents_received', mocks.received], ['verify_documents', mocks.verify],
  ['reject_documents', mocks.reject], ['prepare_contract', mocks.contract],
  ['contract_sent', mocks.sent], ['contract_signed', mocks.signed],
  ['request_deposit', mocks.deposit], ['deposit_received', mocks.paid],
  ['waive_deposit', mocks.waive], ['prepare_mvd_report', mocks.mvd],
  ['mvd_report_submitted', mocks.submitted], ['mvd_report_accepted', mocks.accepted],
] as const;
function request(action: string) {
  return new Request('http://localhost/api/dashboard/booking-ops/legal-payment', {
    method: 'POST', body: JSON.stringify({
      action, bookingId: 'requested-booking', accountId: 'attacker', propertyId: 'attacker',
      metadata: { accountId: 'attacker', propertyId: 'attacker' },
    }),
  });
}
describe('legal-payment shared canonical route access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ session: { userId: 'operator' } });
    mocks.access.mockResolvedValue(canonical);
  });
  it.each(cases)('binds %s and its lifecycle side effect to canonical scope', async (action, mutation) => {
    expect((await POST(request(action))).status).toBe(200);
    const args = mutation.mock.calls[0];
    expect(args[0]).toBe(canonical.bookingId);
    expect(args.at(-1)).toEqual(scope);
    expect(mocks.lifecycle).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: canonical.bookingId, expectedScope: scope,
    }));
  });
  it('scopes the status read that can initialize lifecycle', async () => {
    expect((await GET(new Request('http://localhost/?bookingId=requested-booking'))).status).toBe(200);
    expect(mocks.status).toHaveBeenCalledWith(canonical.bookingId, scope);
  });
  it.each([403, 409])('denies inaccessible/unbound requests with %s before mutation', async status => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ ok: false }, { status }) });
    expect((await POST(request('initialize'))).status).toBe(status);
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.lifecycle).not.toHaveBeenCalled();
  });
});
