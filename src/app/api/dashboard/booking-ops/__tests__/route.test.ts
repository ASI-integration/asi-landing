import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/crm/access', () => ({
  isOpsAdminEmail: vi.fn(() => true),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => ({ session: { email: 'ops@asi.test' } })),
  requireOpsAdminSession: vi.fn(async () => ({ session: { email: 'ops@asi.test' } })),
}));

vi.mock('@/lib/booking-ops/repository', () => ({
  listBookingOpsRecords: vi.fn(async () => ({ ok: true, records: [] })),
  getBookingOpsRecord: vi.fn(async () => ({
    id: 'ops-route',
    bookingId: 'reservation-route',
    guestIntake: null,
  })),
}));

vi.mock('@/lib/booking-ops/lifecycle', () => ({
  syncLifecycleFromBookingOpsRecord: vi.fn(async () => undefined),
  getLifecycleStatus: vi.fn(async () => ({
    ok: true,
    lifecycle: {
      bookingId: 'ops-route',
      gates: [],
      readinessScore: 0,
      currentActiveGate: null,
      blockedGates: [],
      completedGates: [],
      nextRequiredGates: [],
      exceptions: [],
    },
  })),
}));

vi.mock('@/lib/booking-ops/legal-payment-autopilot', () => ({
  getLegalPaymentStatus: vi.fn(async () => ({
    bookingId: 'ops-route',
    documents: [],
    contract: null,
    deposit: null,
    mvdReport: null,
    blockers: [],
    communications: [],
    lifecycle: null,
  })),
  initializeLegalPaymentForBooking: vi.fn(),
  requestGuestDocuments: vi.fn(),
  markDocumentsReceived: vi.fn(),
  verifyGuestDocuments: vi.fn(),
  rejectGuestDocuments: vi.fn(),
  prepareContract: vi.fn(),
  markContractSent: vi.fn(),
  markContractSigned: vi.fn(),
  requestDeposit: vi.fn(),
  markDepositReceived: vi.fn(),
  waiveDeposit: vi.fn(),
  prepareMvdReport: vi.fn(),
  markMvdReportSubmitted: vi.fn(),
  markMvdReportAccepted: vi.fn(),
}));

describe('Booking Ops dashboard routes', () => {
  it('list route returns 200', async () => {
    const route = await import('../route');
    const response = await route.GET();
    expect(response.status).toBe(200);
  });

  it('lifecycle route returns 200', async () => {
    const route = await import('../[id]/lifecycle/route');
    const response = await route.GET(new Request('https://asi.test'), {
      params: { id: 'ops-route' },
    });
    expect(response.status).toBe(200);
  });

  it('legal/payment route rejects invalid actions', async () => {
    const route = await import('../legal-payment/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'bad_action' }),
    }));
    expect(response.status).toBe(400);
  });
});
