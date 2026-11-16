import { describe, expect, it } from 'vitest';
import {
  chooseFeeRule, commissionFor, OtaFinanceError, reconcileOtaBooking,
  type BookingSnapshot, type FeeRule, type ReconcileInput,
} from '../ledger';

// Fictional contract inputs, never provider defaults or live OTA data.
const snapshot: BookingSnapshot = {
  accountId: 'fixture-account', propertyId: 'fixture-property', bookingId: 'fixture-booking',
  provider: 'fixture-ota', currency: 'RUB', bookedOn: '2026-11-10',
  revisionDate: '2026-12-01', status: 'confirmed', grossMinor: 10_005, refundedMinor: 0,
};
const rule: FeeRule = {
  ruleId: 'fixture-contract', provider: 'fixture-ota', currency: 'RUB',
  validFrom: '2026-11-10', validTo: '2026-11-20', commissionBps: 1250, fixedMinor: 37,
  base: 'gross_less_refunds', collection: 'withheld_from_payout', chargeOnCancellation: false,
};
function reconcile(overrides: Partial<ReconcileInput> = {}) {
  return reconcileOtaBooking({
    snapshot, rules: [rule], movements: [], asOfDate: '2026-12-15',
    expectedPayoutOn: '2026-12-10', expectedFeeOn: '2026-12-20',
    channelManagerAllocatedMinor: 100, ...overrides,
  });
}
function expectCode(action: () => unknown, code: string) {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(OtaFinanceError);
  expect(caught).toHaveProperty('code', code);
}

describe('isolated explicit OTA fee contracts', () => {
  it('does not fill a gap between contracts with either neighbouring rate', () => {
    const next: FeeRule = {
      ...rule, ruleId: 'fixture-after-gap', validFrom: '2026-11-22', validTo: null,
      commissionBps: 2000,
    };
    for (const rules of [[rule, next], [next, rule]]) {
      expectCode(() => reconcile({
        rules, snapshot: { ...snapshot, bookedOn: '2026-11-21' },
      }), 'fee_rule_missing');
    }
  });

  it.each([
    [{ ...rule, validFrom: '2026-11-21' }, 'invalid_rule_period'],
    [{ ...rule, validFrom: '2026-02-30' }, 'invalid_date'],
    [{ ...rule, validTo: '2026-11-31' }, 'invalid_date'],
  ])('rejects invalid contract dates %#', (invalidRule, code) => {
    expectCode(() => reconcile({ rules: [invalidRule] }), code);
  });

  it('rejects an absent percentage rather than substituting a provider rate', () => {
    // Simulate an incomplete runtime input crossing the typed boundary.
    const { commissionBps: _omitted, ...incomplete } = rule;
    expectCode(() => reconcile({ rules: [incomplete as FeeRule] }), 'invalid_commission_bps');
  });

  it('rejects malformed runtime percentages without coercing or defaulting them', () => {
    // Explicit zero remains valid below; null, strings and invalid numbers do not.
    for (const commissionBps of [null, '1250', NaN, Infinity, -1, 12.5, 10_001]) {
      const invalidRule = { ...rule, commissionBps } as unknown as FeeRule;
      expectCode(() => reconcile({ rules: [invalidRule] }), 'invalid_commission_bps');
    }
  });

  it.each([
    ['2026-11-09', false], ['2026-11-10', true],
    ['2026-11-20', true], ['2026-11-21', false],
  ] as const)('uses inclusive contract boundaries on %s', (bookedOn, matches) => {
    const booking = { ...snapshot, bookedOn };
    if (matches) expect(chooseFeeRule(booking, [rule])).toEqual(rule);
    else expectCode(() => chooseFeeRule(booking, [rule]), 'fee_rule_missing');
  });

  it('selects adjacent versions by booking date regardless of input order or later revision', () => {
    const next: FeeRule = {
      ...rule, ruleId: 'fixture-next', validFrom: '2026-11-21', validTo: null,
      commissionBps: 2000,
    };
    for (const rules of [[rule, next], [next, rule]]) {
      expect(reconcile({ rules }).otaCommissionMinor).toBe(1288);
      expect(reconcile({ rules, snapshot: { ...snapshot, bookedOn: '2026-11-21' } }))
        .toMatchObject({ ruleId: 'fixture-next', otaCommissionMinor: 2038 });
      expect(chooseFeeRule({ ...snapshot, bookedOn: '2030-01-01' }, rules)).toEqual(next);
    }
  });

  it('rejects a shared boundary instead of picking the first matching rule', () => {
    const overlap = { ...rule, ruleId: 'fixture-overlap', validFrom: rule.validTo!, validTo: null };
    for (const rules of [[rule, overlap], [overlap, rule]]) {
      expectCode(() => chooseFeeRule({ ...snapshot, bookedOn: '2026-11-20' }, rules),
        'ambiguous_fee_rule');
    }
  });

  it('matches a one-day contract only on that calendar date', () => {
    const oneDay: FeeRule = { ...rule, validTo: rule.validFrom };
    expect(reconcile({ rules: [oneDay] })).toMatchObject({
      ruleId: oneDay.ruleId, otaCommissionMinor: 1288,
    });
    for (const bookedOn of ['2026-11-09', '2026-11-11']) {
      expectCode(() => reconcile({
        rules: [oneDay], snapshot: { ...snapshot, bookedOn },
      }), 'fee_rule_missing');
    }
  });

  it('ignores overlapping dates for other providers and currencies without mixing their fees', () => {
    const otherProvider: FeeRule = {
      ...rule, ruleId: 'fixture-other-provider', provider: 'other-fixture-ota',
      commissionBps: 2500, fixedMinor: 900, collection: 'separate_invoice',
    };
    const otherCurrency: FeeRule = {
      ...rule, ruleId: 'fixture-other-currency', currency: 'USD',
      commissionBps: 3000, fixedMinor: 800, collection: 'separate_invoice',
    };
    for (const rules of [
      [otherProvider, rule, otherCurrency], [otherCurrency, rule, otherProvider],
    ]) {
      expect(reconcile({ rules })).toMatchObject({
        ruleId: rule.ruleId, feeCollection: 'withheld_from_payout',
        otaCommissionMinor: 1288, expectedPayoutMinor: 8717, expectedSeparateFeeMinor: 0,
      });
    }
  });

  it.each([
    ['no contracts', []],
    ['another provider', [{ ...rule, provider: 'other-fixture-ota' }]],
    ['another currency', [{ ...rule, currency: 'USD' }]],
    ['expired contract', [{ ...rule, validTo: '2026-11-09', validFrom: '2026-11-01' }]],
    ['future contract', [{ ...rule, validFrom: '2026-11-11' }]],
  ])('never guesses a provider percentage with %s', (_label, rules) => {
    expectCode(() => reconcile({ rules }), 'fee_rule_missing');
  });

  it.each([
    [10_003, 1287], // 1250.375 rounds down, then adds 37.
    [10_004, 1288], // 1250.5 rounds half up, then adds 37.
    [10_005, 1288],
  ])('rounds percentage plus one fixed fee for %i minor units', (grossMinor, expected) => {
    expect(commissionFor({ ...snapshot, grossMinor }, rule)).toBe(expected);
  });

  it('uses only the configured refund basis and preserves an explicit zero percentage', () => {
    const refunded = { ...snapshot, refundedMinor: 2000 };
    expect(commissionFor(refunded, rule)).toBe(1038);
    expect(commissionFor(refunded, { ...rule, base: 'gross' })).toBe(1288);
    expect(reconcile({ rules: [{ ...rule, commissionBps: 0 }] }).otaCommissionMinor).toBe(37);
    expect(reconcile({ rules: [{ ...rule, commissionBps: 0, fixedMinor: 0 }] }))
      .toMatchObject({ otaCommissionMinor: 0, expectedPayoutMinor: 10_005 });
  });

  it('keeps identical commission economics while separating payout and invoice balances', () => {
    const withheld = reconcile();
    const separate = reconcile({ rules: [{ ...rule, collection: 'separate_invoice' }] });
    expect(withheld).toMatchObject({
      otaCommissionMinor: 1288, expectedPayoutMinor: 8717, expectedSeparateFeeMinor: 0,
      feeUnpaidMinor: 0, feeStatus: 'settled', expectedNetAfterCostsMinor: 8617,
    });
    expect(separate).toMatchObject({
      otaCommissionMinor: 1288, expectedPayoutMinor: 10_005, expectedSeparateFeeMinor: 1288,
      feeUnpaidMinor: 1288, feeStatus: 'pending', expectedNetAfterCostsMinor: 8617,
    });
    const payout = {
      ...snapshot, eventId: 'fixture-payout', kind: 'payout_received' as const,
      amountMinor: 10_005, settledOn: '2026-12-10',
    };
    const fee = {
      ...snapshot, eventId: 'fixture-fee', kind: 'separate_fee_paid' as const,
      amountMinor: 1288, settledOn: '2026-12-12',
    };
    expect(reconcile({ rules: [{ ...rule, collection: 'separate_invoice' }], movements: [payout] }))
      .toMatchObject({ payoutStatus: 'settled', feeUnpaidMinor: 1288, cashDifferenceMinor: -1288 });
    const settled = reconcile({
      rules: [{ ...rule, collection: 'separate_invoice' }], movements: [payout, fee],
    });
    expect(settled).toMatchObject({
      payoutStatus: 'settled', feeStatus: 'settled', clearedOtaCashMinor: 8717,
      cashDifferenceMinor: 0,
    });
    expect(reconcile({ movements: [{ ...payout, amountMinor: 8717 }] }))
      .toMatchObject({ clearedOtaCashMinor: settled.clearedOtaCashMinor, cashDifferenceMinor: 0 });
    expectCode(() => reconcile({ movements: [fee] }), 'fee_payment_conflicts_with_withholding_rule');
  });

  it('rejects a future separate fee under withholding before filtering uncleared movements', () => {
    expectCode(() => reconcile({
      movements: [
        { ...snapshot, eventId: 'fixture-invalid-future-fee', kind: 'separate_fee_paid',
          amountMinor: 1288, settledOn: '2026-12-20' },
      ],
    }), 'fee_payment_conflicts_with_withholding_rule');
  });

  it('keeps a partial separate invoice balance independent of a settled gross payout', () => {
    const position = reconcile({
      rules: [{ ...rule, collection: 'separate_invoice' }],
      asOfDate: '2026-12-21',
      movements: [
        { ...snapshot, eventId: 'fixture-gross-payout', kind: 'payout_received',
          amountMinor: 10_005, settledOn: '2026-12-10' },
        { ...snapshot, eventId: 'fixture-partial-fee', kind: 'separate_fee_paid',
          amountMinor: 500, settledOn: '2026-12-12' },
      ],
    });
    expect(position).toMatchObject({
      otaCommissionMinor: 1288, expectedPayoutMinor: 10_005,
      payoutDifferenceMinor: 0, payoutStatus: 'settled',
      expectedSeparateFeeMinor: 1288, separateFeePaidMinor: 500,
      feeUnpaidMinor: 788, feeStatus: 'overdue',
      clearedOtaCashMinor: 9505, cashDifferenceMinor: -788,
      expectedNetAfterCostsMinor: 8617,
    });
  });

  it('recognizes a separate fee only when cleared, independently of the payout date', () => {
    const input: Partial<ReconcileInput> = {
      rules: [{ ...rule, collection: 'separate_invoice' }],
      movements: [
        { ...snapshot, eventId: 'fixture-dated-payout', kind: 'payout_received',
          amountMinor: 10_005, settledOn: '2026-12-10' },
        { ...snapshot, eventId: 'fixture-future-fee', kind: 'separate_fee_paid',
          amountMinor: 1288, settledOn: '2026-12-20' },
      ],
    };
    expect(reconcile({ ...input, asOfDate: '2026-12-19' })).toMatchObject({
      payoutStatus: 'settled', actualPayoutMinor: 10_005,
      separateFeePaidMinor: 0, feeUnpaidMinor: 1288, feeStatus: 'pending',
      clearedOtaCashMinor: 10_005, cashDifferenceMinor: -1288,
      processedMovementCount: 1, ignoredFutureMovementIds: ['fixture-future-fee'],
    });
    expect(reconcile({ ...input, asOfDate: '2026-12-20' })).toMatchObject({
      payoutStatus: 'settled', actualPayoutMinor: 10_005,
      separateFeePaidMinor: 1288, feeUnpaidMinor: 0, feeStatus: 'settled',
      clearedOtaCashMinor: 8717, cashDifferenceMinor: 0,
      processedMovementCount: 2, ignoredFutureMovementIds: [],
    });
  });
});
