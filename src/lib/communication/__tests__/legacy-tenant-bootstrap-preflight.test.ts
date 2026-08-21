import { describe, expect, it } from 'vitest';

import {
  evaluateBootstrapReadiness,
  parseBootstrapOptions,
} from '../../../../scripts/legacy-tg-first-tenant-bootstrap.mjs';

const expected = {
  accountId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
  legacyPropertyId: 'test-prop-tg-live',
};

function state(overrides: Record<string, unknown> = {}) {
  return {
    expected,
    accountRows: [],
    membershipRows: [],
    propertyRows: [],
    legacyPropertyRows: [],
    legacyReservationRows: [],
    bindingRows: [],
    ...overrides,
  };
}

describe('first canonical tenant bootstrap preflight', () => {
  it('reports an empty canonical layer as BLOCKED with every missing prerequisite explicit', () => {
    const result = evaluateBootstrapReadiness(state());

    expect(result.deployment_readiness).toBe('BLOCKED');
    expect(result.checks).toMatchObject({
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
    ['account without membership or property', {
      accountRows: [{ id: expected.accountId }],
    }],
    ['account and membership without property', {
      accountRows: [{ id: expected.accountId }],
      membershipRows: [{ account_id: expected.accountId, user_id: 'operator', role: 'owner' }],
    }],
    ['canonical property without bridge', {
      accountRows: [{ id: expected.accountId }],
      membershipRows: [{ account_id: expected.accountId, user_id: 'operator', role: 'owner' }],
      propertyRows: [{ id: expected.propertyId, account_id: expected.accountId }],
      legacyPropertyRows: [{ property_id: expected.legacyPropertyId }],
      legacyReservationRows: [{ id: 'reservation', property_id: expected.legacyPropertyId }],
    }],
  ])('keeps partial bootstrap BLOCKED: %s', (_label, partial) => {
    expect(evaluateBootstrapReadiness(state(partial)).deployment_readiness).toBe('BLOCKED');
  });

  it('reports READY only for the complete same-account persisted bootstrap', () => {
    const result = evaluateBootstrapReadiness(state({
      accountRows: [{ id: expected.accountId }],
      membershipRows: [{ account_id: expected.accountId, user_id: 'operator', role: 'owner' }],
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
      accountRows: [{ id: expected.accountId }],
      membershipRows: [{ account_id: expected.accountId, user_id: 'operator', role: 'owner' }],
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
      '--user-id', '44444444-4444-4444-8444-444444444444',
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
});
