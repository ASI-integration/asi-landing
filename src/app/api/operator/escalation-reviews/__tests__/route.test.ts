import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { __resetEscalationReviewStoreForTests, createOrUpdateEscalationReview } from '@/lib/communication/operator-review';

const mocks = vi.hoisted(() => ({
  authStatus: 'allowed' as 'allowed' | 'unauthenticated' | 'forbidden',
  memberships: ['account-a'],
  propertyAccounts: {} as Record<string, string>,
  propertiesLookupShouldError: false,
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => {
    if (mocks.authStatus === 'unauthenticated') {
      return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
    }
    if (mocks.authStatus === 'forbidden') {
      return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { session: { userId: 'op_route_1', email: 'op@example.com' } };
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => table === 'account_members' ? ({
      select: () => ({
        eq: async () => ({ data: mocks.memberships.map((account_id) => ({ account_id })), error: null }),
      }),
    }) : table === 'properties' ? ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          limit: async () => (mocks.propertiesLookupShouldError
            ? { data: null, error: { message: 'simulated lookup failure' } }
            : { data: mocks.propertyAccounts[value] ? [{ account_id: mocks.propertyAccounts[value] }] : [], error: null }),
        }),
        in: async (_column: string, values: string[]) => (mocks.propertiesLookupShouldError
          ? { data: null, error: { message: 'simulated lookup failure' } }
          : {
              data: values.flatMap((value) => mocks.propertyAccounts[value]
                ? [{ id: value, account_id: mocks.propertyAccounts[value] }]
                : []),
              error: null,
            }),
      }),
    }) : table === 'booking_ops_records' || table === 'tg_guest_reservations' || table === 'legacy_tg_property_bindings' ? ({
      select: () => ({
        eq: () => ({ limit: async () => ({ data: [], error: null }) }),
        in: async () => ({ data: [], error: null }),
      }),
    }) : ({
      upsert: async () => ({ error: null }),
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }) }),
    }),
  },
}));

describe('GET /api/operator/escalation-reviews — list dependency-failure fail-closed regression', () => {
  beforeEach(() => {
    __resetEscalationReviewStoreForTests();
    mocks.authStatus = 'allowed';
    mocks.memberships = ['account-a'];
    mocks.propertyAccounts = {};
    mocks.propertiesLookupShouldError = false;
  });

  it('returns 200 with only the operator\'s own reviews when tenant resolution succeeds', async () => {
    const propertyId = '11111111-1111-4111-8111-111111111111';
    mocks.propertyAccounts[propertyId] = 'account-a';
    createOrUpdateEscalationReview({
      sessionId: 'sess_ok',
      channel: 'telegram',
      targetId: '1',
      propertyId,
      escalationReason: 'REQUIRES_OPERATOR',
    });

    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/api/operator/escalation-reviews'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reviews).toHaveLength(1);
  });

  it('fails closed with 503 (not 200 + empty list) when batch tenant resolution itself fails', async () => {
    const propertyId = '11111111-1111-4111-8111-111111111111';
    mocks.propertyAccounts[propertyId] = 'account-a';
    createOrUpdateEscalationReview({
      sessionId: 'sess_dependency_failure',
      channel: 'telegram',
      targetId: '1',
      propertyId,
      escalationReason: 'REQUIRES_OPERATOR',
    });

    // Simulate the properties table lookup itself failing (infra failure),
    // not "no reviews match".
    mocks.propertiesLookupShouldError = true;

    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/api/operator/escalation-reviews'));

    // Must NOT be a 200 with an empty (or any) list — that would silently
    // look like "no escalations need attention" when the truth is "we don't
    // know". Availability must never be preserved by weakening this signal.
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('returns 401 for an unauthenticated caller before any tenant resolution', async () => {
    mocks.authStatus = 'unauthenticated';
    const { GET } = await import('../route');
    const res = await GET(new NextRequest('http://localhost/api/operator/escalation-reviews'));
    expect(res.status).toBe(401);
  });
});
