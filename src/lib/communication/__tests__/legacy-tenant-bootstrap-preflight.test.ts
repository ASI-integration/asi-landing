import { describe, expect, it } from 'vitest';

import {
  applyBootstrap,
  evaluateBootstrapReadiness,
  parseBootstrapOptions,
} from '../../../../scripts/legacy-tg-first-tenant-bootstrap.mjs';

const userId = '44444444-4444-4444-8444-444444444444';
const expected = {
  userId,
  accountId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
  legacyPropertyId: 'test-prop-tg-live',
};

type BootstrapState = {
  expected: typeof expected;
  userRows: Array<Record<string, string>>;
  accountRows: Array<Record<string, string>>;
  membershipRows: Array<Record<string, string>>;
  userMembershipRows: Array<Record<string, string>>;
  propertyRows: Array<Record<string, string>>;
  legacyPropertyRows: Array<Record<string, string>>;
  legacyReservationRows: Array<Record<string, string>>;
  bindingRows: Array<Record<string, string>>;
};

function state(overrides: Partial<Omit<BootstrapState, 'expected'>> = {}): BootstrapState {
  return {
    expected,
    userRows: [],
    accountRows: [],
    membershipRows: [],
    userMembershipRows: [],
    propertyRows: [],
    legacyPropertyRows: [],
    legacyReservationRows: [],
    bindingRows: [],
    ...overrides,
  };
}

describe('first canonical tenant bootstrap preflight', () => {
  it('reports empty public.users as BLOCKED with every missing prerequisite explicit', () => {
    const result = evaluateBootstrapReadiness(state());

    expect(result.deployment_readiness).toBe('BLOCKED');
    expect(result.checks).toMatchObject({
      canonical_user_exists: { status: 'FAIL' },
      canonical_account_exists: { status: 'FAIL' },
      operator_membership_exists: { status: 'FAIL' },
      canonical_property_exists: { status: 'FAIL' },
      legacy_property_exists: { status: 'FAIL' },
      legacy_reservation_matches_property: { status: 'FAIL' },
      legacy_tg_property_binding_exists: { status: 'FAIL' },
      account_property_relationship_consistent: { status: 'FAIL' },
    });
  });

  it.each([
    ['user without account', {
      userRows: [{ id: userId }],
    }],
    ['user and account without membership', {
      userRows: [{ id: userId }],
      accountRows: [{ id: expected.accountId }],
    }],
    ['user, account, and membership without property', {
      userRows: [{ id: userId }],
      accountRows: [{ id: expected.accountId }],
      membershipRows: [{ account_id: expected.accountId, user_id: userId, role: 'owner' }],
    }],
    ['canonical property without bridge', {
      userRows: [{ id: userId }],
      accountRows: [{ id: expected.accountId }],
      membershipRows: [{ account_id: expected.accountId, user_id: userId, role: 'owner' }],
      propertyRows: [{ id: expected.propertyId, account_id: expected.accountId }],
      legacyPropertyRows: [{ property_id: expected.legacyPropertyId }],
      legacyReservationRows: [{ id: 'reservation', property_id: expected.legacyPropertyId }],
    }],
  ])('keeps partial bootstrap BLOCKED: %s', (_label, partial) => {
    expect(evaluateBootstrapReadiness(state(partial)).deployment_readiness).toBe('BLOCKED');
  });

  it('reports READY only for the complete same-account persisted bootstrap', () => {
    const result = evaluateBootstrapReadiness(state({
      userRows: [{ id: userId }],
      accountRows: [{ id: expected.accountId }],
      membershipRows: [{ account_id: expected.accountId, user_id: userId, role: 'owner' }],
      propertyRows: [{ id: expected.propertyId, account_id: expected.accountId }],
      legacyPropertyRows: [{ property_id: expected.legacyPropertyId }],
      legacyReservationRows: [{ id: 'reservation', property_id: expected.legacyPropertyId }],
      bindingRows: [{
        legacy_property_id: expected.legacyPropertyId,
        account_id: expected.accountId,
        canonical_property_id: expected.propertyId,
      }],
    }));

    expect(result.deployment_readiness).toBe('READY');
    expect(Object.values(result.checks).every((check) => check.status === 'PASS')).toBe(true);
  });

  it('blocks a cross-account canonical property or ambiguous legacy reservation', () => {
    const base = {
      userRows: [{ id: userId }],
      accountRows: [{ id: expected.accountId }],
      membershipRows: [{ account_id: expected.accountId, user_id: userId, role: 'owner' }],
      propertyRows: [{ id: expected.propertyId, account_id: '33333333-3333-4333-8333-333333333333' }],
      legacyPropertyRows: [{ property_id: expected.legacyPropertyId }],
      legacyReservationRows: [
        { id: 'reservation-a', property_id: expected.legacyPropertyId },
        { id: 'reservation-b', property_id: expected.legacyPropertyId },
      ],
      bindingRows: [{
        legacy_property_id: expected.legacyPropertyId,
        account_id: expected.accountId,
        canonical_property_id: expected.propertyId,
      }],
    };
    const result = evaluateBootstrapReadiness(state(base));

    expect(result.deployment_readiness).toBe('BLOCKED');
    expect(result.checks.legacy_reservation_matches_property.status).toBe('FAIL');
    expect(result.checks.account_property_relationship_consistent.status).toBe('FAIL');
  });

  it('requires explicit UUIDs and a separate typed confirmation for apply mode', () => {
    const common = [
      '--account-id', expected.accountId,
      '--user-id', userId,
      '--property-id', expected.propertyId,
      '--legacy-property-id', expected.legacyPropertyId,
      '--reservation-id', 'legacy-reservation-1',
    ];

    expect(parseBootstrapOptions(common)).toMatchObject({ apply: false });
    expect(() => parseBootstrapOptions([...common, '--apply'])).toThrow(/--confirm/u);
    expect(() => parseBootstrapOptions([
      ...common,
      '--apply',
      '--confirm', 'FIRST_TENANT_BOOTSTRAP_V1',
      '--account-name', 'First canonical account',
      '--property-name', 'Legacy Telegram property',
    ])).not.toThrow();
  });

  function applyOptions() {
    return parseBootstrapOptions([
      '--apply', '--confirm', 'FIRST_TENANT_BOOTSTRAP_V1',
      '--account-id', expected.accountId,
      '--user-id', userId,
      '--role', 'owner',
      '--property-id', expected.propertyId,
      '--property-name', 'Legacy Telegram property',
      '--property-status', 'active',
      '--legacy-property-id', expected.legacyPropertyId,
      '--reservation-id', 'legacy-reservation-1',
    ]);
  }

  function bootstrapClient(overrides: Partial<Omit<BootstrapState, 'expected'>> = {}) {
    const persisted = state({
      userRows: [{ id: userId }],
      accountRows: [{ id: expected.accountId, name: 'Auth-created account' }],
      membershipRows: [{ account_id: expected.accountId, user_id: userId, role: 'owner' }],
      userMembershipRows: [{ account_id: expected.accountId, user_id: userId, role: 'owner' }],
      legacyPropertyRows: [{ property_id: expected.legacyPropertyId }],
      legacyReservationRows: [{ id: 'legacy-reservation-1', property_id: expected.legacyPropertyId }],
      ...overrides,
    });
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        const normalizedSql = sql.replace(/\s+/gu, ' ').trim();
        if (/^(BEGIN|COMMIT|ROLLBACK)$/u.test(normalizedSql)) return { rows: [] };
        if (normalizedSql.includes('FROM public.users')) return { rows: persisted.userRows };
        if (normalizedSql.includes('FROM public.accounts')) return { rows: persisted.accountRows };
        if (normalizedSql.includes('FROM public.account_members WHERE account_id')) {
          return { rows: persisted.membershipRows };
        }
        if (normalizedSql.includes('FROM public.account_members WHERE user_id')) {
          return { rows: persisted.userMembershipRows };
        }
        if (normalizedSql.includes('FROM public.properties')) return { rows: persisted.propertyRows };
        if (normalizedSql.includes('FROM public.tg_property_knowledge')) return { rows: persisted.legacyPropertyRows };
        if (normalizedSql.includes('FROM public.tg_guest_reservations')) {
          return { rows: persisted.legacyReservationRows };
        }
        if (normalizedSql.includes('FROM public.legacy_tg_property_bindings')) {
          return { rows: persisted.bindingRows };
        }
        if (normalizedSql.startsWith('INSERT INTO public.properties')) {
          persisted.propertyRows = [{
            id: expected.propertyId,
            account_id: expected.accountId,
            name: 'Legacy Telegram property',
            status: 'active',
          }];
          return { rows: [] };
        }
        if (normalizedSql.startsWith('INSERT INTO public.legacy_tg_property_bindings')) {
          persisted.bindingRows = [{
            legacy_property_id: expected.legacyPropertyId,
            account_id: expected.accountId,
            canonical_property_id: expected.propertyId,
          }];
          return { rows: [] };
        }
        throw new Error(`Unexpected SQL: ${normalizedSql}`);
      },
    };
    return { client, queries };
  }

  it('aborts apply before account, property, or binding writes when the explicit user is missing', async () => {
    const { client, queries } = bootstrapClient({ userRows: [] });

    await expect(applyBootstrap(client, applyOptions())).rejects.toThrow(/canonical user/u);
    expect(queries.some((sql) => /INSERT INTO/u.test(sql))).toBe(false);
  });

  it('reuses auth-created account and membership rows idempotently', async () => {
    const complete = {
      propertyRows: [{
        id: expected.propertyId,
        account_id: expected.accountId,
        name: 'Legacy Telegram property',
        status: 'active',
      }],
      bindingRows: [{
        legacy_property_id: expected.legacyPropertyId,
        account_id: expected.accountId,
        canonical_property_id: expected.propertyId,
      }],
    };
    const { client, queries } = bootstrapClient(complete);

    await expect(applyBootstrap(client, applyOptions())).resolves.toMatchObject({
      deployment_readiness: 'READY',
    });
    expect(queries.some((sql) => /INSERT INTO public\.(accounts|account_members)/u.test(sql))).toBe(false);
  });

  it.each([
    ['account id', {
      accountRows: [],
      membershipRows: [],
      userMembershipRows: [{
        account_id: '33333333-3333-4333-8333-333333333333',
        user_id: userId,
        role: 'owner',
      }],
    }],
    ['membership role', {
      membershipRows: [{ account_id: expected.accountId, user_id: userId, role: 'manager' }],
      userMembershipRows: [{ account_id: expected.accountId, user_id: userId, role: 'manager' }],
    }],
  ])('fails closed before property or binding writes for conflicting owner-supplied %s', async (_label, conflict) => {
    const { client, queries } = bootstrapClient(conflict);

    await expect(applyBootstrap(client, applyOptions())).rejects.toThrow(/conflict/u);
    expect(queries.some((sql) => /INSERT INTO public\.(properties|legacy_tg_property_bindings)/u.test(sql))).toBe(false);
  });
});
