import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  prepare: vi.fn(),
  scope: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => ({
    session: { userId: 'user-1', email: 'ops@asi.test' },
  })),
  requireOpsAdminSession: vi.fn(async () => ({
    session: { userId: 'user-1', email: 'ops@asi.test' },
  })),
}));

vi.mock('@/lib/reservations/access', () => ({
  resolveReservationAccess: vi.fn(async () => ({
    accountId: 'account-1',
    actorId: 'user-1',
    operatorRole: 'operator',
    isOpsAdmin: true,
  })),
}));

vi.mock('@/lib/platform/residential-booking-scope', () => ({
  resolveResidentialBookingIdentity: mocks.scope,
}));

vi.mock('@/lib/booking-ops/communication-orchestrator', () => ({
  listBookingOpsCommunicationsForRecord: mocks.list,
  syncBookingOpsCommunications: vi.fn(),
}));

vi.mock('@/lib/communication/booking-knowledge-boundary', () => ({
  prepareBookingCommunication: mocks.prepare,
}));

vi.mock('@/lib/booking-ops/repository', () => ({
  getBookingOpsRecord: vi.fn(),
}));

vi.mock('@/lib/booking-ops/tasks', () => ({
  listBookingOpsTasksForRecord: vi.fn(),
}));

vi.mock('@/lib/booking-ops/guest-intake-autopilot', () => ({
  syncGuestIntakeAutopilot: vi.fn(),
}));

const now = () => new Date().toISOString();
const intent = (actorType: 'guest' | 'admin', id: string) => ({
  id,
  bookingOpsRecordId: 'ops-route',
  bookingId: 'source-booking-1',
  relatedTaskId: null,
  actorType,
  actorLabel: actorType === 'guest' ? 'Гость' : 'Оператор',
  purpose: 'request_arrival_time',
  channel: actorType === 'guest' ? 'telegram' : 'internal',
  status: 'draft_ready',
  messageText: 'draft',
  messageTemplateKey: 'test.v1',
  metadata: {},
  createdAt: now(),
  updatedAt: now(),
  supersededAt: null,
});
describe('Booking Ops communications PlatformDecision GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({
      kind: 'identified',
      accountId: 'account-1',
      propertyId: 'property-1',
      bookingId: 'ops-route',
    });
    mocks.list.mockResolvedValue({
      ok: true,
      communications: [intent('guest', 'communication-1'), intent('admin', 'communication-2')],
    });
    mocks.prepare.mockImplementation(async () => {
      const observedAt = now();
      const scope = {
        accountId: 'account-1',
        propertyId: 'property-1',
        bookingId: 'ops-route',
      };
      return {
        text: 'verified',
        reviewRequired: false,
        summary: 'booking_status: verified',
        result: {
          ready: true,
          scope,
          decisions: [{
            key: 'booking_status',
            use: 'automatic',
            reason: 'verified',
            fact: {
              key: 'booking_status',
              value: 'Подтверждено',
              scope,
              origin: 'canonical',
              source: 'booking_ops_records',
              reference: 'ops-route',
              observedAt,
              verified: true,
              sensitivity: 'normal',
            },
          }],
        },
      };
    });
  });

  it('returns account-scoped advisory decisions only for guest intents', async () => {
    const route = await import('../[id]/communications/route');
    const response = await route.GET(new Request('https://asi.test'), {
      params: { id: 'ops-route' },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.scope).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenCalledWith('ops-route');
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledWith({
      recordId: 'ops-route',
      accountId: 'account-1',
      propertyId: 'property-1',
      purpose: 'request_arrival_time',
    });
    expect(payload.platformDecisions).toHaveLength(1);
    expect(payload.platformDecisions[0]).toMatchObject({
      communicationId: 'communication-1',
      decision: {
        version: 'platform-decision-v0',
        topic: 'communication',
        status: 'allowed',
        identity: {
          kind: 'identified',
          accountId: 'account-1',
          propertyId: 'property-1',
          bookingId: 'ops-route',
        },
        permission: {
          automaticActionAllowed: false,
          executionAuthority: 'domain_revalidation_required',
        },
      },
    });
    expect(payload.platformDecisions[0].decision.permission.allowedActions)
      .toEqual(['prepare_operator_draft']);
    expect(payload.platformDecisions[0].decision.permission.forbiddenActions)
      .toContain('send_guest_automatically');
  });
  it('fails foreign account scope before communications or fact resolution', async () => {
    mocks.scope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const route = await import('../[id]/communications/route');
    const response = await route.GET(new Request('https://asi.test'), {
      params: { id: 'ops-route' },
    });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.message).toBe('Нет доступа к бронированию.');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('returns an unavailable advisory decision when authoritative facts cannot be resolved', async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      communications: [intent('guest', 'communication-1')],
    });
    mocks.prepare.mockResolvedValue({
      text: 'review',
      reviewRequired: true,
      summary: 'booking_status: dependency_failed',
      result: {
        ready: false,
        decisions: [{ key: 'booking_status', use: 'unusable', reason: 'dependency_failed' }],
      },
    });

    const route = await import('../[id]/communications/route');
    const payload = await (await route.GET(new Request('https://asi.test'), {
      params: { id: 'ops-route' },
    })).json();

    expect(payload.platformDecisions[0].decision).toMatchObject({
      topic: 'communication',
      status: 'unavailable',
      trust: 'unavailable',
      evidence: [],
      permission: {
        automaticActionAllowed: false,
        executionAuthority: 'domain_revalidation_required',
      },
    });
    expect(payload.platformDecisions[0].decision.permission.allowedActions)
      .not.toContain('prepare_operator_draft');
  });
});
