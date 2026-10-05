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
  requireBookingOpsRecordScope: vi.fn(async () => ({
    id: 'ops-route',
    bookingId: 'reservation-route',
    propertyId: 'property-1',
    guestIntake: null,
  })),
  updateBookingOpsRecord: vi.fn(async () => ({ ok: true, record: { id: 'ops-route' } })),
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
    CheckinReadinessPrerequisiteError: class CheckinReadinessPrerequisiteError extends Error {
      code = 'checkin_readiness_prerequisites_incomplete';
      missingPrerequisites: unknown[] = [];
    },
    getCheckinExecutionStatus: vi.fn(async () => snapshot()),
    readCheckinExecutionStatus: vi.fn(async () => snapshot()),
    runCheckinExecutionAction: vi.fn(async () => ({ ...snapshot(), status: 'instructions_queued', instructionsStatus: 'queued' })),
  };
});

vi.mock('@/lib/booking-ops/instay-checkout-autopilot', () => {
  const snapshot = () => ({
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
  });
  return {
    BookingClosePrerequisiteError: class BookingClosePrerequisiteError extends Error {
      code = 'booking_close_prerequisites_incomplete';
      missingPrerequisites: unknown[] = [];
    },
    getInStayCheckoutStatus: vi.fn(async () => snapshot()),
    readInStayCheckoutStatus: vi.fn(async () => snapshot()),
    readBookingClosePrerequisites: vi.fn(async () => ([
      { key: 'guest_not_checked_out', category: 'lifecycle', message: 'Guest check-out is not completed.' },
      { key: 'post_checkout_inspection_incomplete', category: 'lifecycle', message: 'Post-checkout inspection is not completed.' },
      { key: 'deposit_return_incomplete', category: 'deposit', message: 'Deposit return is incomplete.' },
    ])),
    runInStayCheckoutAction: vi.fn(async () => ({
      ...snapshot(),
      status: 'checkout_instructions_queued',
      checkoutInstructionsStatus: 'queued',
      nextAction: 'Проверить черновик и отметить отправку',
    })),
  };
});

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

  it('legal/payment reads reject foreign tenant before domain status read', async () => {
    const scope = await import('@/lib/platform/residential-booking-scope');
    const legal = await import('@/lib/booking-ops/legal-payment-autopilot');
    vi.mocked(legal.getLegalPaymentStatus).mockClear();
    vi.mocked(scope.resolveResidentialBookingIdentity)
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    const route = await import('../legal-payment/route');
    const response = await route.GET(new Request('https://asi.test?bookingId=ops-route'));

    expect(response.status).toBe(403);
    expect(legal.getLegalPaymentStatus).not.toHaveBeenCalled();
  });

  it('legal/payment mutations reject foreign tenant before domain action', async () => {
    const scope = await import('@/lib/platform/residential-booking-scope');
    const legal = await import('@/lib/booking-ops/legal-payment-autopilot');
    vi.mocked(legal.initializeLegalPaymentForBooking).mockClear();
    vi.mocked(scope.resolveResidentialBookingIdentity)
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    const route = await import('../legal-payment/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'initialize' }),
    }));

    expect(response.status).toBe(403);
    expect(legal.initializeLegalPaymentForBooking).not.toHaveBeenCalled();
  });

  it('pre-checkin recompute endpoint returns readiness', async () => {
    const route = await import('../pre-checkin/recompute/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route' }),
    }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    const preCheckin = await import('@/lib/booking-ops/pre-checkin-control-center');
    expect(preCheckin.recomputeBookingCheckinReadiness).toHaveBeenCalledWith(
      'ops-route',
      { expectedScope: { accountId: 'account-1', propertyId: 'property-1' } },
    );
    expect(payload.readiness.status).toBe('ready_for_checkin');
    expect(payload.platformDecision).toMatchObject({
      topic: 'pre_checkin',
      identity: { accountId: 'account-1', propertyId: 'property-1', bookingId: 'ops-route' },
      permission: { automaticActionAllowed: false, executionAuthority: 'domain_revalidation_required' },
    });
  });

  it('pre-checkin mutation rejects foreign tenant before domain recompute', async () => {
    const scope = await import('@/lib/platform/residential-booking-scope');
    const preCheckin = await import('@/lib/booking-ops/pre-checkin-control-center');
    vi.mocked(preCheckin.recomputeBookingCheckinReadiness).mockClear();
    vi.mocked(scope.resolveResidentialBookingIdentity)
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    const route = await import('../pre-checkin/recompute/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route' }),
    }));

    expect(response.status).toBe(403);
    expect(preCheckin.recomputeBookingCheckinReadiness).not.toHaveBeenCalled();
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

  it('pre-checkin list is restricted to the authenticated account', async () => {
    const preCheckin = await import('@/lib/booking-ops/pre-checkin-control-center');
    vi.mocked(preCheckin.listBookingsByReadinessStatus).mockClear();
    const route = await import('../pre-checkin/route');

    const response = await route.GET(new Request('https://asi.test?status=needs_attention&limit=25'));

    expect(response.status).toBe(200);
    expect(preCheckin.listBookingsByReadinessStatus).toHaveBeenCalledWith({
      accountId: 'account-1',
      status: 'needs_attention',
      limit: 25,
    });
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

  it('check-in mutation returns a post-action advisory decision', async () => {
    const checkin = await import('@/lib/booking-ops/checkin-execution-autopilot');
    vi.mocked(checkin.runCheckinExecutionAction).mockClear();
    vi.mocked(checkin.readCheckinExecutionStatus).mockClear();

    const route = await import('../checkin-execution/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'prepare_instructions' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(checkin.runCheckinExecutionAction).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'ops-route',
      action: 'prepare_instructions',
      expectedScope: { accountId: 'account-1', propertyId: 'property-1' },
    }));
    expect(checkin.readCheckinExecutionStatus).toHaveBeenCalledWith('ops-route');
    expect(payload.platformDecision).toMatchObject({
      topic: 'checkin',
      identity: { accountId: 'account-1', propertyId: 'property-1', bookingId: 'ops-route' },
      permission: { automaticActionAllowed: false, executionAuthority: 'domain_revalidation_required' },
    });
  });

  it('check-in mutation rejects foreign tenant before domain action', async () => {
    const scope = await import('@/lib/platform/residential-booking-scope');
    const checkin = await import('@/lib/booking-ops/checkin-execution-autopilot');
    vi.mocked(checkin.runCheckinExecutionAction).mockClear();
    vi.mocked(scope.resolveResidentialBookingIdentity)
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    const route = await import('../checkin-execution/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'prepare_instructions' }),
    }));

    expect(response.status).toBe(403);
    expect(checkin.runCheckinExecutionAction).not.toHaveBeenCalled();
  });

  it('check-in keeps a successful mutation successful when advisory projection fails', async () => {
    const checkin = await import('@/lib/booking-ops/checkin-execution-autopilot');
    vi.mocked(checkin.readCheckinExecutionStatus)
      .mockRejectedValueOnce(new Error('injected_projection_failure'));

    const route = await import('../checkin-execution/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'prepare_instructions' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.platformDecision).toMatchObject({
      topic: 'checkin',
      status: 'unavailable',
      permission: { automaticActionAllowed: false, executionAuthority: 'domain_revalidation_required' },
    });
  });

  it('check-in returns state_changed after a successful action when booking ownership changes', async () => {
    const scope = await import('@/lib/platform/residential-booking-scope');
    const checkin = await import('@/lib/booking-ops/checkin-execution-autopilot');
    vi.mocked(checkin.runCheckinExecutionAction).mockClear();
    vi.mocked(scope.resolveResidentialBookingIdentity)
      .mockResolvedValueOnce({
        kind: 'identified',
        accountId: 'account-1',
        propertyId: 'property-1',
        bookingId: 'ops-route',
      })
      .mockResolvedValueOnce({
        kind: 'identified',
        accountId: 'account-1',
        propertyId: 'property-2',
        bookingId: 'ops-route',
      });

    const route = await import('../checkin-execution/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'prepare_instructions' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(checkin.runCheckinExecutionAction).toHaveBeenCalled();
    expect(payload.platformDecision).toMatchObject({
      topic: 'checkin',
      status: 'unavailable',
      audit: { reasons: expect.arrayContaining(['state_changed']) },
    });
  });

  it('check-in execution API rejects invalid action', async () => {
    const route = await import('../checkin-execution/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'bad_action' }),
    }));
    expect(response.status).toBe(400);
  });

  it('instay-checkout GET uses pure reads and returns advisory stay, checkout, deposit and closeout decisions', async () => {
    const instay = await import('@/lib/booking-ops/instay-checkout-autopilot');
    vi.mocked(instay.getInStayCheckoutStatus).mockClear();
    vi.mocked(instay.readInStayCheckoutStatus).mockClear();
    const route = await import('../instay-checkout/route');
    const response = await route.GET(new Request('https://asi.test?bookingId=ops-route'));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.platformDecisions.inStay.topic).toBe('in_stay');
    expect(payload.platformDecisions.checkout.topic).toBe('checkout');
    expect(instay.readInStayCheckoutStatus).toHaveBeenCalledWith('ops-route');
    expect(instay.getInStayCheckoutStatus).not.toHaveBeenCalled();
    expect(payload.platformDecisions.deposit.topic).toBe('deposit');
    expect(payload.platformDecisions.closeout).toMatchObject({ topic: 'closeout', status: 'blocked' });
    expect(payload.platformDecisions.closeout.permission.allowedActions).not.toContain('close_booking');
    expect(payload.platformDecisions.incidents).toEqual([]);
    for (const decision of [
      payload.platformDecisions.inStay,
      payload.platformDecisions.checkout,
      payload.platformDecisions.deposit,
      payload.platformDecisions.closeout,
    ]) {
      expect(decision.permission.automaticActionAllowed).toBe(false);
      expect(decision.permission.executionAuthority).toBe('domain_revalidation_required');
      expect(decision.permission.forbiddenActions).toContain('send_guest_automatically');
    }
  });

  it('proposes close_booking only when pure canonical close prerequisites are empty', async () => {
    const instay = await import('@/lib/booking-ops/instay-checkout-autopilot');
    const updatedAt = new Date().toISOString();
    vi.mocked(instay.readInStayCheckoutStatus).mockResolvedValueOnce({
      bookingId: 'ops-route',
      status: 'ready_to_close',
      execution: null,
      checkoutInstructionsStatus: 'sent',
      checkoutConfirmationStatus: 'confirmed',
      inspectionStatus: 'done',
      depositReturnStatus: 'returned',
      closureStatus: 'ready_to_close',
      openIssuesCount: 0,
      openIssues: [],
      lifecycle: null,
      blockers: [],
      communications: [],
      nextAction: 'Закрыть бронь',
      updatedAt,
    } as never);
    vi.mocked(instay.readBookingClosePrerequisites).mockResolvedValueOnce([]);

    const route = await import('../instay-checkout/route');
    const response = await route.GET(new Request('https://asi.test?bookingId=ops-route'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.platformDecisions.closeout).toMatchObject({
      topic: 'closeout',
      status: 'allowed',
      permission: {
        automaticActionAllowed: false,
        executionAuthority: 'domain_revalidation_required',
      },
    });
    expect(payload.platformDecisions.closeout.permission.allowedActions).toContain('close_booking');
    expect(payload.platformDecisions.closeout.permission.forbiddenActions).toContain('send_guest_automatically');
  });

  it('maps canonical open stay issues to advisory incident decisions', async () => {
    const instay = await import('@/lib/booking-ops/instay-checkout-autopilot');
    const updatedAt = new Date().toISOString();
    vi.mocked(instay.readInStayCheckoutStatus).mockResolvedValueOnce({
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

  it('instay-checkout mutation returns fresh post-action advisory decisions', async () => {
    const instay = await import('@/lib/booking-ops/instay-checkout-autopilot');
    vi.mocked(instay.runInStayCheckoutAction).mockClear();
    vi.mocked(instay.readInStayCheckoutStatus).mockClear();

    const route = await import('../instay-checkout/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'prepare_checkout_instructions' }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(instay.runInStayCheckoutAction).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'ops-route',
      action: 'prepare_checkout_instructions',
      expectedScope: { accountId: 'account-1', propertyId: 'property-1' },
    }));
    expect(instay.readInStayCheckoutStatus).toHaveBeenCalledWith('ops-route');
    expect(payload.platformDecisions.inStay).toMatchObject({
      topic: 'in_stay',
      identity: { accountId: 'account-1', propertyId: 'property-1', bookingId: 'ops-route' },
      permission: { automaticActionAllowed: false, executionAuthority: 'domain_revalidation_required' },
    });
    expect(payload.platformDecisions.checkout.topic).toBe('checkout');
    expect(payload.platformDecisions.deposit.topic).toBe('deposit');
    expect(payload.platformDecisions.closeout.topic).toBe('closeout');
  });

  it('instay-checkout mutation rejects foreign tenant before domain action', async () => {
    const scope = await import('@/lib/platform/residential-booking-scope');
    const instay = await import('@/lib/booking-ops/instay-checkout-autopilot');
    vi.mocked(instay.runInStayCheckoutAction).mockClear();
    vi.mocked(scope.resolveResidentialBookingIdentity)
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    const route = await import('../instay-checkout/route');
    const response = await route.POST(new Request('https://asi.test', {
      method: 'POST',
      body: JSON.stringify({ bookingId: 'ops-route', action: 'prepare_checkout_instructions' }),
    }));

    expect(response.status).toBe(403);
    expect(instay.runInStayCheckoutAction).not.toHaveBeenCalled();
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
