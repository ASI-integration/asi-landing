import { describe, expect, it } from 'vitest';
import { evaluatePropertyPermission, type PropertyPermission, type PropertyRoleEvidence } from '../property-role-access';

const userId = '11111111-1111-4111-8111-111111111111';
const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const propertyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fixture(accountRole: string, grantRole: string, changes: Partial<PropertyRoleEvidence> = {}): PropertyRoleEvidence {
  return { userId, accountId, propertyId, accountRole, grantRole,
    grantUserId: userId, grantAccountId: accountId, grantPropertyId: propertyId, ...changes };
}

describe('strict role and property isolation', () => {
  it.each([
    ['owner', 'owner', 'view_owner_finance', true],
    ['owner', 'owner', 'manage_property', true],
    ['manager', 'manager', 'view_owner_finance', false],
    ['manager', 'manager', 'manage_property', true],
    ['operator', 'operator', 'perform_task', true],
    ['operator', 'operator', 'manage_property', false],
    ['operator', 'operator', 'view_owner_finance', false],
    ['operator', 'owner', 'view_owner_finance', false],
    ['manager', 'owner', 'view_owner_finance', false],
    ['owner', 'operator', 'view_owner_finance', false],
  ] as [string, string, PropertyPermission, boolean][])(
    '%s membership / %s grant / %s = %s',
    (member, grant, permission, expected) => {
      expect(evaluatePropertyPermission(fixture(member, grant), permission)).toBe(expected);
    },
  );

  it('denies cross-account access even for an owner', () => {
    expect(evaluatePropertyPermission(fixture('owner', 'owner', {
      grantAccountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }), 'view_owner_finance')).toBe(false);
  });
  it('denies a grant on a different property', () => {
    expect(evaluatePropertyPermission(fixture('owner', 'owner', {
      grantPropertyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }), 'view_owner_finance')).toBe(false);
  });
  it('denies a grant of another user', () => {
    expect(evaluatePropertyPermission(fixture('owner', 'owner', {
      grantUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    }), 'view_owner_finance')).toBe(false);
  });
  it('denies missing or unknown identity and role', () => {
    expect(evaluatePropertyPermission(fixture('owner', 'owner', { userId: 'legacy' }), 'view_owner_finance')).toBe(false);
    expect(evaluatePropertyPermission(fixture('owner', 'admin'), 'manage_property')).toBe(false);
    expect(evaluatePropertyPermission(fixture('admin', 'owner'), 'view_owner_finance')).toBe(false);
  });
  it('denies workers access to a property when no explicit grant exists', () => {
    expect(evaluatePropertyPermission(fixture('operator', 'operator', { grantRole: null }), 'perform_task')).toBe(false);
  });
});
