import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/crm/access', () => ({
  isOpsAdminEmail: vi.fn(() => true),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => ({ session: { userId: 'user-1', email: 'ops@asi.test' } })),
  requireOpsAdminSession: vi.fn(async () => ({ session: { userId: 'user-1', email: 'ops@asi.test' } })),
}));

vi.mock('@/lib/reservations/access', () => ({
  resolveReservationAccess: vi.fn(async () => ({
    accountId: 'account-1', actorId: 'user-1', operatorRole: 'operator', isOpsAdmin: true,
  })),
}));

vi.mock('@/lib/platform/residential-booking-scope', () => ({
  resolveResidentialBookingIdentity: vi.fn(async () => ({
    kind: 'identified', accountId: 'account-1', propertyId: 'property-1', bookingId: 'ops-route',
  })),
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

vi.mock('@/lib/booking-ops/guest-legal-deposit-mvd-execution', () => ({
  readCheckinInstructionsGuard: vi.fn(async () => ({
    block: false,
    reason: null,
    readiness: {
      bookingId: 'ops-route',
      propertyId: 'property-1',
      status: 'ready_for_checkin',
      blockers: [],
      lastCheckedAt: new Date().toISOString(),
    },
  })),
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
    lastRecomputedAt: new Date().toISOString(),
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
    lastRecomputedAt: new Date().toISOString(),
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
    lastRecomputedAt: new Date().toISOString(),
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

vi.mock('@/lib/booking-ops/checkin-execution-autopilot', () => {
  const snapshot = () => {
    const now = new Date().toISOString();
    return {
      bookingId: 'ops-route',
      status: 'ready_to_send_instructions',
      execution: null,
      instructionsStatus: 'not_prepared',
      arrivalStatus: 'unknown',
      accessStatus: 'ready',
      lifecycleReady: true,
      lifecycle: null,
      preCheckin: {
        bookingId: 'ops-route',
        status: 'ready_for_checkin',
        readinessScore: 100,
        hardBlockers: [],
        warnings: [],
        requiredActions: [],
        timeline: [],
        topBlocker: null,
        lifecycleScore: 100,
        lastRecomputedAt: now,
        metadata: {},
      },
      blockers: [],
      communications: [],
      nextAction: 'Подготовить или поставить инструкции в очередь',
      updatedAt: now,
    };
  };
  return {
    getCheckinExecutionStatus: vi.fn(async () => snapshot()),
    readCheckinExecutionStatus: vi.fn(async () => snapshot()),
    runCheckinExecutionAction: vi.fn(async () => ({ ...snapshot(), status: 'instructions_queued', instructionsStatus: 'queued' })),
  };
});

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
    updatedAt: new Date().toISOString(),
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
    updatedAt: new Date().toISOString(),
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

  it('single pre-checkin read returns an account-scoped advisory PlatformDecision', async () => {
    const route = await import('../pre-checkin/route');
    const response = await route.GET(new Request('https://asi.test?bookingId=ops-route'));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.platformDecision).toMatchObject({
      version: 'platform-decision-v0',
      identity: { kind: 'identified', accountId: 'account-1', propertyId: 'property-1', bookingId: 'ops-route' },
      topic: 'pre_checkin',
      permission: { automaticActionAllowed: false, executionAuthority: 'domain_revalidation_required' },
    });
    expect(payload.platformDecision.permission.forbiddenActions).toContain('send_guest_automatically');
  });

  it('stale pre-checkin readiness fails closed instead of proposing release work', async () => {
    const preCheckin = await import('@/lib/booking-ops/pre-checkin-control-center');
    vi.mocked(preCheckin.getPreCheckinStatus).mockResolvedValueOnce({
      bookingId: 'ops-route', status: 'ready_for_checkin', readinessScore: 100,
      hardBlockers: [], warnings: [], requiredActions: [], timeline: [], topBlocker: null,
      lifecycleScore: 100, lastRecomputedAt: '2026-01-01T00:00:00.000Z', metadata: {},
    } as never);
    const route = await import('../pre-checkin/route');
    const payload = await (await route.GET(new Request('https://asi.test?bookingId=ops-route'))).json();
    expect(payload.platformDecision.status).toBe('unavailable');
    expect(payload.platformDecision.permission.allowedActions).not.toContain('prepare_operator_draft');
  });

  it('scope failures are generic and do not load readiness', async () => {
    const scope = await import('@/lib/platform/residential-booking-scope');
    const preCheckin = await import('@/lib/booking-ops/pre-checkin-control-center');
    vi.mocked(scope.resolveResidentialBookingIdentity).mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    vi.mocked(preCheckin.getPreCheckinStatus).mockClear();
    const route = await import('../pre-checkin/route');
    const response = await route.GET(new Request('https://asi.test?bookingId=ops-route'));
    const payload = await response.json();
    expect(response.status).toBe(403);
    expect(payload.message).toBe('Нет доступа к бронированию.');
    expect(payload.message).not.toContain('booking_scope');
    expect(preCheckin.getPreCheckinStatus).not.toHaveBeenCalled();
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

  it('check-in GET uses the pure read path and returns an advisory decision', async () => {
    const checkinModule = await import('@/lib/booking-ops/checkin-execution-autopilot');
    vi.mocked(checkinModule.getCheckinExecutionStatus).mockClear();
    vi.mocked(checkinModule.readCheckinExecutionStatus).mockClear();

    const route = await import('../checkin-execution/route');
    const response = await route.GET(new Request('https://asi.test?bookingId=ops-route'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(checkinModule.readCheckinExecutionStatus).toHaveBeenCalledWith('ops-route');
    expect(checkinModule.getCheckinExecutionStatus).not.toHaveBeenCalled();
    expect(payload.platformDecision).toMatchObject({
      version: 'platform-decision-v0',
      topic: 'checkin',
      identity: { kind: 'identified', accountId: 'account-1', propertyId: 'property-1', bookingId: 'ops-route' },
      permission: { automaticActionAllowed: false, executionAuthority: 'domain_revalidation_required' },
    });
    expect(payload.platformDecision.permission.allowedActions).not.toContain('release_instructions');
    expect(payload.platformDecision.permission.forbiddenActions).toContain('send_guest_automatically');
  });

  it('check-in execution API rejects invalid action', async () => {
    const route = await import('../checkin-execution/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'bad_action' }),
    }));
    expect(response.status).toBe(400);
  });

  it('instay-checkout GET returns advisory in-stay, checkout, deposit and incident decisions', async () => {
    const route = await import('../instay-checkout/route');
    const response = await route.GET(new Request('https://asi.test?bookingId=ops-route'));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.platformDecisions.inStay.topic).toBe('in_stay');
    expect(payload.platformDecisions.checkout.topic).toBe('checkout');
    expect(payload.platformDecisions.deposit.topic).toBe('deposit');
    expect(payload.platformDecisions.incidents).toEqual([]);
    expect(payload.platformDecisions.closeout).toBeUndefined();
    for (const decision of [
      payload.platformDecisions.inStay,
      payload.platformDecisions.checkout,
      payload.platformDecisions.deposit,
    ]) {
      expect(decision.permission.automaticActionAllowed).toBe(false);
      expect(decision.permission.executionAuthority).toBe('domain_revalidation_required');
      expect(decision.permission.forbiddenActions).toContain('send_guest_automatically');
    }
  });

  it('maps canonical open stay issues to advisory incident decisions', async () => {
    const instay = await import('@/lib/booking-ops/instay-checkout-autopilot');
    const updatedAt = new Date().toISOString();
    vi.mocked(instay.getInStayCheckoutStatus).mockResolvedValueOnce({
      bookingId: 'ops-route',
      status: 'guest_issue_open',
      execution: null,
      checkoutInstructionsStatus: 'not_prepared',
      checkoutConfirmationStatus: 'not_requested',
      inspectionStatus: 'not_started',
      depositReturnStatus: 'not_ready',
      closureStatus: 'open',
      openIssuesCount: 1,
      openIssues: [{
        id: '11111111-1111-4111-8111-111111111111',
        bookingId: 'ops-route',
        issueType: 'access_issue',
        severity: 'high',
        status: 'open',
        source: 'operator',
        description: null,
        resolution: null,
        assignedToType: null,
        assignedToRef: null,
        openedAt: updatedAt,
        resolvedAt: null,
        metadata: {},
        createdAt: updatedAt,
        updatedAt,
      }],
      lifecycle: null,
      blockers: [],
      communications: [],
      nextAction: 'Разобрать проблему гостя',
      updatedAt,
    } as never);

    const route = await import('../instay-checkout/route');
    const response = await route.GET(new Request('https://asi.test?bookingId=ops-route'));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.platformDecisions.incidents).toHaveLength(1);
    expect(payload.platformDecisions.incidents[0]).toMatchObject({
      topic: 'incident',
      status: 'review_required',
      identity: { kind: 'identified', accountId: 'account-1', propertyId: 'property-1', bookingId: 'ops-route' },
      evidence: [{ source: 'stay_issue', recordId: '11111111-1111-4111-8111-111111111111' }],
      permission: { automaticActionAllowed: false, executionAuthority: 'domain_revalidation_required' },
    });
    expect(payload.platformDecisions.incidents[0].permission.allowedActions)
      .toEqual(expect.arrayContaining(['request_operator_review', 'remediate']));
    expect(payload.platformDecisions.incidents[0].permission.forbiddenActions)
      .toEqual(expect.arrayContaining(['resolve_incident', 'send_guest_automatically']));
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

  it('auto-send policy API returns 401 when unauthenticated', async () => {
    const auth = await import('@/lib/crm/api-auth');
    vi.mocked(auth.requireOpsAdminSession).mockResolvedValueOnce({
      error: Response.json({ ok: false }, { status: 401 }) as never,
    });
    const route = await import('../[id]/communications/[communicationId]/auto-send/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ action: 'block_auto_send' }),
    }), {
      params: { id: 'ops-route', communicationId: 'communication-route' },
    });
    expect(response.status).toBe(401);
  });
});
