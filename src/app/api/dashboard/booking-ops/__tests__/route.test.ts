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

vi.mock('@/lib/booking-ops/pre-checkin-control-center', () => ({
  getPreCheckinStatus: vi.fn(async () => ({
    bookingId: 'ops-route',
    status: 'ready_for_checkin',
    readinessScore: 100,
    hardBlockers: [],
    warnings: [],
    requiredActions: [],
    timeline: [],
    topBlocker: null,
    lifecycleScore: 100,
    lastRecomputedAt: '2026-06-30T10:00:00.000Z',
    metadata: {},
  })),
  listBookingsByReadinessStatus: vi.fn(async () => []),
  recomputeBookingCheckinReadiness: vi.fn(async () => ({
    bookingId: 'ops-route',
    status: 'ready_for_checkin',
    readinessScore: 100,
    hardBlockers: [],
    warnings: [],
    requiredActions: [],
    timeline: [],
    topBlocker: null,
    lifecycleScore: 100,
    lastRecomputedAt: '2026-06-30T10:00:00.000Z',
    metadata: {},
  })),
  runPreCheckinAction: vi.fn(async () => ({
    bookingId: 'ops-route',
    status: 'ready_for_checkin',
    readinessScore: 100,
    hardBlockers: [],
    warnings: [],
    requiredActions: [],
    timeline: [],
    topBlocker: null,
    lifecycleScore: 100,
    lastRecomputedAt: '2026-06-30T10:00:00.000Z',
    metadata: {},
  })),
  PRE_CHECKIN_READINESS_STATUSES: [
    'ready_for_checkin',
    'needs_attention',
    'blocked',
    'overdue',
    'checked_in',
    'closed',
  ],
}));

vi.mock('@/lib/booking-ops/checkin-execution-autopilot', () => ({
  getCheckinExecutionStatus: vi.fn(async () => ({
    bookingId: 'ops-route',
    status: 'ready_to_send_instructions',
    execution: null,
    instructionsStatus: 'not_prepared',
    arrivalStatus: 'unknown',
    accessStatus: 'unknown',
    lifecycleReady: true,
    lifecycle: null,
    preCheckin: { status: 'ready_for_checkin' },
    blockers: [],
    communications: [],
    nextAction: 'Подготовить или поставить инструкции в очередь',
    updatedAt: '2026-06-30T10:00:00.000Z',
  })),
  runCheckinExecutionAction: vi.fn(async () => ({
    bookingId: 'ops-route',
    status: 'instructions_queued',
    execution: null,
    instructionsStatus: 'queued',
    arrivalStatus: 'unknown',
    accessStatus: 'unknown',
    lifecycleReady: true,
    lifecycle: null,
    preCheckin: { status: 'ready_for_checkin' },
    blockers: [],
    communications: [],
    nextAction: 'Проверить черновик и отметить отправку',
    updatedAt: '2026-06-30T10:00:00.000Z',
  })),
}));

vi.mock('@/lib/booking-ops/instay-checkout-autopilot', () => ({
  getInStayCheckoutStatus: vi.fn(async () => ({
    bookingId: 'ops-route',
    status: 'in_stay',
    execution: null,
    checkoutInstructionsStatus: 'not_prepared',
    checkoutConfirmationStatus: 'not_requested',
    inspectionStatus: 'not_started',
    depositReturnStatus: 'not_ready',
    closureStatus: 'open',
    openIssuesCount: 0,
    openIssues: [],
    lifecycle: null,
    blockers: [],
    communications: [],
    nextAction: 'Следить за проживанием и готовить выезд',
    updatedAt: '2026-06-30T10:00:00.000Z',
  })),
  runInStayCheckoutAction: vi.fn(async () => ({
    bookingId: 'ops-route',
    status: 'checkout_instructions_queued',
    execution: null,
    checkoutInstructionsStatus: 'queued',
    checkoutConfirmationStatus: 'not_requested',
    inspectionStatus: 'not_started',
    depositReturnStatus: 'not_ready',
    closureStatus: 'open',
    openIssuesCount: 0,
    openIssues: [],
    lifecycle: null,
    blockers: [],
    communications: [],
    nextAction: 'Проверить черновик и отметить отправку',
    updatedAt: '2026-06-30T10:00:00.000Z',
  })),
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

  it('pre-checkin recompute endpoint returns readiness', async () => {
    const route = await import('../pre-checkin/recompute/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route' }),
    }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.readiness.status).toBe('ready_for_checkin');
  });

  it('pre-checkin API returns 401 when unauthenticated', async () => {
    const auth = await import('@/lib/crm/api-auth');
    vi.mocked(auth.requireCrmOperatorSession).mockResolvedValueOnce({
      error: Response.json({ ok: false }, { status: 401 }) as never,
    });
    const route = await import('../pre-checkin/route');
    const response = await route.GET(new Request('https://asi.test?bookingId=ops-route'));
    expect(response.status).toBe(401);
  });

  it('check-in execution API returns 401 when unauthenticated', async () => {
    const auth = await import('@/lib/crm/api-auth');
    vi.mocked(auth.requireCrmOperatorSession).mockResolvedValueOnce({
      error: Response.json({ ok: false }, { status: 401 }) as never,
    });
    const route = await import('../checkin-execution/route');
    const response = await route.GET(new Request('https://asi.test?bookingId=ops-route'));
    expect(response.status).toBe(401);
  });

  it('check-in execution API rejects invalid action', async () => {
    const route = await import('../checkin-execution/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'bad_action' }),
    }));
    expect(response.status).toBe(400);
  });

  it('instay-checkout API returns 401 when unauthenticated', async () => {
    const auth = await import('@/lib/crm/api-auth');
    vi.mocked(auth.requireCrmOperatorSession).mockResolvedValueOnce({
      error: Response.json({ ok: false }, { status: 401 }) as never,
    });
    const route = await import('../instay-checkout/route');
    const response = await route.GET(new Request('https://asi.test?bookingId=ops-route'));
    expect(response.status).toBe(401);
  });

  it('instay-checkout API rejects invalid action', async () => {
    const route = await import('../instay-checkout/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'bad_action' }),
    }));
    expect(response.status).toBe(400);
  });
});
