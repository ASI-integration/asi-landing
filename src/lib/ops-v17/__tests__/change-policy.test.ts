import { describe, expect, it } from 'vitest';
import { parseOwnerChange } from '../change-policy';

const id = '123e4567-e89b-42d3-a456-426614174000';

describe('owner internal change policy', () => {
  it('accepts only safe fields for internal onboarding changes', () => {
    expect(parseOwnerChange({
      requestId: id, section: 'operations',
      values: { checkInTime: '14:00', cleaningRule: 'После выезда' },
      expected: { checkInTime: '13:00' },
    })).toMatchObject({ section: 'operations', values: { checkInTime: '14:00' } });
  });

  it.each([
    { section: 'operations', values: { channelManager: 'enabled' } },
    { section: 'business', values: { accountId: 'victim' } },
    { section: 'owner', values: { paymentSecret: 'x' } },
    { section: 'properties', values: { name: 'my house' } },
    { section: 'operations', values: { checkInTime: '99:99' } },
    { section: 'owner', values: { email: 'not-an-email' } },
    { section: 'business', values: { name: 14 } },
    { section: 'business', values: {} },
  ])('rejects unsafe or invalid $section $values', ({ section, values }) => {
    expect(() => parseOwnerChange({ requestId: id, section, values, expected: {} })).toThrow();
  });

  it('accepts valid long Cyrillic cleaning and maintenance rules', () => {
    const longRule = 'У'.repeat(1900);
    const values = {
      cleaningRule: longRule,
      linenRule: longRule,
      inspectionRule: longRule,
      maintenanceRule: longRule,
      checkInTime: '14:30',
      checkOutTime: '12:00',
    };
    expect(parseOwnerChange({ requestId: id, section: 'operations', values, expected: values }).values.maintenanceRule).toBe(longRule);
  });

  it('rejects client-selected tenant and invalid nonce', () => {
    expect(() => parseOwnerChange({
      requestId: id, section: 'owner', values: { name: 'A' }, expected: {}, accountId: 'other-account',
    })).toThrow();
    expect(() => parseOwnerChange({
      requestId: 'not-a-uuid', section: 'owner', values: { name: 'A' }, expected: {},
    })).toThrow();
  });
});
