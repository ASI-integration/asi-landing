import { describe, expect, it, vi } from 'vitest';
import { projectChannelNet, type BookingSnapshot, type FeeRule } from '../ledger';

const snapshot: BookingSnapshot = Object.freeze({
  accountId: 'synthetic-account', propertyId: 'synthetic-property',
  bookingId: 'synthetic-booking', provider: 'ota-a', currency: 'RUB',
  bookedOn: '2026-11-01', revisionDate: '2026-11-02',
  status: 'confirmed', grossMinor: 100_000, refundedMinor: 10_000,
});
const rule: FeeRule = Object.freeze({
  ruleId: 'synthetic-rule', provider: 'ota-a', currency: 'RUB',
  validFrom: '2026-01-01', validTo: null, commissionBps: 1500,
  fixedMinor: 200, base: 'gross_less_refunds',
  collection: 'withheld_from_payout', chargeOnCancellation: false,
});

describe('provisional channel net comparison using explicit costs', () => {
  it('compares net after refunds, OTA fees and distinct Channel Manager costs', () => {
    const a = projectChannelNet({ snapshot, rules: [rule],
      proposedGrossMinor: 100_000, channelManagerAllocatedMinor: 1_000 });
    const b = projectChannelNet({ snapshot: { ...snapshot, provider: 'ota-b' },
      rules: [{ ...rule, provider: 'ota-b', commissionBps: 1000, fixedMinor: 0,
        collection: 'separate_invoice' }],
      proposedGrossMinor: 100_000, channelManagerAllocatedMinor: 8_000 });

    expect(a).toEqual({ provider: 'ota-a', currency: 'RUB', grossMinor: 100_000,
      expectedCommissionMinor: 13_700, expectedNetMinor: 75_300 });
    expect(b).toEqual({ provider: 'ota-b', currency: 'RUB', grossMinor: 100_000,
      expectedCommissionMinor: 9_000, expectedNetMinor: 73_000 });
    // Lower OTA commission alone does not imply a higher provisional net.
    expect(a.expectedNetMinor).toBeGreaterThan(b.expectedNetMinor);
  });

  it.each(['RUB', 'USD'])('preserves %s and rejects a rule in another currency', (currency) => {
    const input = { snapshot: { ...snapshot, currency },
      rules: [{ ...rule, currency }], proposedGrossMinor: 100_000,
      channelManagerAllocatedMinor: 1_000 };
    expect(projectChannelNet(input)).toMatchObject({ currency, expectedNetMinor: 75_300 });
    expect(() => projectChannelNet({ ...input,
      rules: [{ ...rule, currency: currency === 'RUB' ? 'USD' : 'RUB' }],
    })).toThrow('fee_rule_missing');
  });

  it.each(['RUB', 'USD'])(
    'compares different proposed prices in %s without ranking by gross revenue',
    (currency) => {
      const a = projectChannelNet({ snapshot: { ...snapshot, currency },
        rules: [{ ...rule, currency }], proposedGrossMinor: 100_000,
        channelManagerAllocatedMinor: 1_000 });
      const b = projectChannelNet({ snapshot: { ...snapshot, currency, provider: 'ota-b' },
        rules: [{ ...rule, currency, provider: 'ota-b', commissionBps: 2000,
          fixedMinor: 0, collection: 'separate_invoice' }],
        proposedGrossMinor: 110_000, channelManagerAllocatedMinor: 8_000 });

      expect(a).toEqual({ provider: 'ota-a', currency, grossMinor: 100_000,
        expectedCommissionMinor: 13_700, expectedNetMinor: 75_300 });
      expect(b).toEqual({ provider: 'ota-b', currency, grossMinor: 110_000,
        expectedCommissionMinor: 20_000, expectedNetMinor: 72_000 });
      expect(b.grossMinor).toBeGreaterThan(a.grossMinor);
      expect(a.expectedNetMinor).toBeGreaterThan(b.expectedNetMinor);
    },
  );

  it('selects only the matching provider, currency and booking-date fee rule', () => {
    const unrelatedRules: readonly FeeRule[] = [
      { ...rule, ruleId: 'other-provider', provider: 'ota-b', commissionBps: 0 },
      { ...rule, ruleId: 'other-currency', currency: 'USD', commissionBps: 0 },
      { ...rule, ruleId: 'expired', validTo: '2026-10-31', commissionBps: 0 },
      { ...rule, ruleId: 'future', validFrom: '2026-11-02', commissionBps: 0 },
    ];
    const input = { snapshot, proposedGrossMinor: 100_000,
      channelManagerAllocatedMinor: 1_000 };

    expect(projectChannelNet({ ...input, rules: [...unrelatedRules, rule] }))
      .toEqual({ provider: 'ota-a', currency: 'RUB', grossMinor: 100_000,
        expectedCommissionMinor: 13_700, expectedNetMinor: 75_300 });
    expect(() => projectChannelNet({ ...input, rules: unrelatedRules }))
      .toThrow('fee_rule_missing');
    expect(() => projectChannelNet({ ...input,
      rules: [rule, { ...rule, ruleId: 'overlapping', commissionBps: 0 }],
    })).toThrow('ambiguous_fee_rule');
  });

  it('rejects a proposed price below existing refunds instead of projecting income', () => {
    expect(() => projectChannelNet({ snapshot, rules: [rule],
      proposedGrossMinor: 9_999, channelManagerAllocatedMinor: 1_000,
    })).toThrow('refund_exceeds_projected_gross');
  });

  it('keeps a loss visible when explicit Channel Manager costs exceed the remaining net', () => {
    expect(projectChannelNet({ snapshot, rules: [rule], proposedGrossMinor: 100_000,
      channelManagerAllocatedMinor: 80_000 }).expectedNetMinor).toBe(-3_700);
  });

  it.each(['withheld_from_payout', 'separate_invoice'] as const)(
    'deducts the OTA fee exactly once for %s and the explicit CM cost separately',
    (collection) => {
      const input = { snapshot, rules: [{ ...rule, collection }],
        proposedGrossMinor: 100_000, channelManagerAllocatedMinor: 0 };
      const withoutCm = projectChannelNet(input);
      const withCm = projectChannelNet({ ...input, channelManagerAllocatedMinor: 1_234 });

      expect(withoutCm).toEqual({ provider: 'ota-a', currency: 'RUB', grossMinor: 100_000,
        expectedCommissionMinor: 13_700, expectedNetMinor: 76_300 });
      expect(withCm).toEqual({ ...withoutCm, expectedNetMinor: 75_066 });
      expect(withoutCm.expectedNetMinor - withCm.expectedNetMinor).toBe(1_234);
    },
  );

  it.each([
    { base: 'gross', commission: 1_701, net: 7_303 },
    { base: 'gross_less_refunds', commission: 1_551, net: 7_453 },
  ] as const)('uses the explicit $base fee basis and rounds half-up in minor units',
    ({ base, commission, net }) => {
      expect(projectChannelNet({
        snapshot: { ...snapshot, refundedMinor: 1_000 },
        rules: [{ ...rule, base }], proposedGrossMinor: 10_005,
        channelManagerAllocatedMinor: 1,
      })).toEqual({ provider: 'ota-a', currency: 'RUB', grossMinor: 10_005,
        expectedCommissionMinor: commission, expectedNetMinor: net });
    });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid explicit CM cost %s instead of producing a channel ranking',
    (channelManagerAllocatedMinor) => {
      expect(() => projectChannelNet({ snapshot, rules: [rule],
        proposedGrossMinor: 100_000, channelManagerAllocatedMinor,
      })).toThrow('invalid_money_minor');
    },
  );

  it('repeats the shadow calculation without mutating inputs or making a live request', () => {
    const request = vi.fn(() => { throw new Error('live request forbidden'); });
    vi.stubGlobal('fetch', request);
    try {
      const input = Object.freeze({ snapshot, rules: Object.freeze([rule]),
        proposedGrossMinor: 120_000, channelManagerAllocatedMinor: 1_000 });
      const before = JSON.stringify(input);
      const first = projectChannelNet(input);
      expect(first).toEqual({ provider: 'ota-a', currency: 'RUB', grossMinor: 120_000,
        expectedCommissionMinor: 16_700, expectedNetMinor: 92_300 });
      expect(projectChannelNet(input)).toEqual(first);
      expect(JSON.stringify(input)).toBe(before);
      expect(request).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
