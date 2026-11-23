import { describe, expect, it } from 'vitest';
import {
  reconcileOtaBooking, type BookingSnapshot, type CashMovement, type FeeRule,
} from '../ledger';

const snapshot: BookingSnapshot = Object.freeze({
  accountId: 'revision-account', propertyId: 'revision-property',
  bookingId: 'revision-booking', provider: 'offline-ota', currency: 'RUB',
  bookedOn: '2026-11-01', revisionDate: '2026-11-02',
  status: 'confirmed', grossMinor: 100_000, refundedMinor: 0,
});
// Synthetic contract terms, not an assertion about any real provider's policy.
const rule: FeeRule = Object.freeze({
  ruleId: 'original-contract', provider: snapshot.provider, currency: 'RUB',
  validFrom: '2026-01-01', validTo: '2026-11-10',
  commissionBps: 1500, fixedMinor: 200, base: 'gross_less_refunds',
  collection: 'withheld_from_payout', chargeOnCancellation: false,
});
const movement = (
  kind: CashMovement['kind'], amountMinor: number, eventId: string,
  settledOn = '2026-11-06',
): CashMovement => Object.freeze({ ...snapshot, kind, amountMinor, eventId, settledOn });
const history = Object.freeze([movement('payout_received', 84_800, 'original-payout')]);

function position(
  revision: BookingSnapshot, movements: readonly CashMovement[] = history,
  policy: FeeRule = rule,
) {
  return reconcileOtaBooking({
    snapshot: revision, movements, rules: Object.freeze([policy]),
    asOfDate: '2026-11-20', expectedPayoutOn: '2026-11-18',
    expectedFeeOn: '2026-11-18', channelManagerAllocatedMinor: 500,
  });
}

describe('offline booking revisions preserve historical movements', () => {
  it.each([
    { grossMinor: 120_000, commission: 18_200, payout: 101_800, difference: 17_000 },
    { grossMinor: 80_000, commission: 12_200, payout: 67_800, difference: -17_000 },
  ])('recalculates an amended total of $grossMinor under the original booking contract', ({
    grossMinor, commission, payout, difference,
  }) => {
    const before = position(snapshot);
    const revised = Object.freeze({ ...snapshot, grossMinor, revisionDate: '2026-11-15' });
    const laterRule: FeeRule = { ...rule, ruleId: 'later-contract',
      validFrom: '2026-11-11', validTo: null, commissionBps: 3000 };
    const result = reconcileOtaBooking({
      snapshot: revised, movements: history, rules: [laterRule, rule],
      asOfDate: '2026-11-20', expectedPayoutOn: '2026-11-18',
      expectedFeeOn: null, channelManagerAllocatedMinor: 500,
    });
    expect(result).toMatchObject({
      ruleId: 'original-contract', grossMinor, otaCommissionMinor: commission,
      expectedPayoutMinor: payout, actualPayoutMinor: 84_800,
      payoutDifferenceMinor: difference, processedMovementCount: 1,
    });
    expect(position(snapshot)).toEqual(before);
    expect(history).toEqual([movement('payout_received', 84_800, 'original-payout')]);
    expect(snapshot.grossMinor).toBe(100_000);
  });

  it.each(['confirmed', 'cancelled'] as const)(
    'rejects an amended total below an existing refund even when %s', (status) => {
      const policy = Object.freeze({ ...rule, collection: 'separate_invoice' as const });
      const refunded = Object.freeze({ ...snapshot, status, refundedMinor: 20_000,
        revisionDate: '2026-11-15' });
      const movements = Object.freeze([
        movement('payout_received', 100_000, 'gross-payout'),
        movement('refund_debit', 20_000, 'existing-refund', '2026-11-16'),
      ]);
      const before = position(refunded, movements, policy);
      const revised = Object.freeze({ ...refunded, grossMinor: 19_999,
        revisionDate: '2026-11-19' });
      // A cancellation waiver changes fees, never the refund validation contract.
      expect(() => position(revised, movements, policy)).toThrow('refund_exceeds_gross');
      // The exact boundary is valid; no historical refund is reduced to fit it.
      expect(position(Object.freeze({ ...revised, grossMinor: 20_000 }), movements, policy))
        .toMatchObject({ grossMinor: 20_000, refundsMinor: 20_000,
          netGuestRevenueMinor: 0, actualPayoutMinor: 80_000, processedMovementCount: 2 });
      expect(position(refunded, movements, policy)).toEqual(before);
      expect(movements).toEqual([
        movement('payout_received', 100_000, 'gross-payout'),
        movement('refund_debit', 20_000, 'existing-refund', '2026-11-16'),
      ]);
      expect(refunded.grossMinor).toBe(100_000);
      expect(refunded.refundedMinor).toBe(20_000);
    },
  );

  it.each([
    { base: 'gross_less_refunds' as const, commission: 12_200, payout: 67_800, credit: 3_000 },
    { base: 'gross' as const, commission: 15_200, payout: 64_800, credit: 0 },
  ])('uses the explicit $base policy for partial refunds and appends adjustments', ({
    base, commission, payout, credit,
  }) => {
    const revised = Object.freeze({ ...snapshot, refundedMinor: 20_000,
      revisionDate: '2026-11-15' });
    const policy = Object.freeze({ ...rule, base });
    const pending = position(revised, history, policy);
    expect(pending).toMatchObject({ actualPayoutMinor: 84_800,
      expectedPayoutMinor: payout, payoutDifferenceMinor: payout - 84_800 });
    const movements = Object.freeze([
      ...history, movement('refund_debit', 20_000, 'partial-refund', '2026-11-16'),
      ...(credit ? [movement('payout_adjustment_credit', credit, 'fee-credit', '2026-11-17')] : []),
    ]);
    expect(position(revised, movements, policy)).toMatchObject({
      netGuestRevenueMinor: 80_000, otaCommissionMinor: commission,
      expectedPayoutMinor: payout, actualPayoutMinor: payout,
      payoutDifferenceMinor: 0, cashDifferenceMinor: 0, payoutStatus: 'settled',
      processedMovementCount: movements.length,
    });
    expect(position(revised, history, policy)).toEqual(pending);
    expect(history[0].amountMinor).toBe(84_800);
  });

  it('waives cancellation fees on a full refund only under the explicit waiver policy', () => {
    const revised = Object.freeze({ ...snapshot, status: 'cancelled' as const,
      refundedMinor: 100_000, revisionDate: '2026-11-15' });
    const pending = position(revised);
    expect(pending).toMatchObject({ otaCommissionMinor: 0, expectedPayoutMinor: 0,
      actualPayoutMinor: 84_800, payoutDifferenceMinor: -84_800 });
    const movements = Object.freeze([
      ...history, movement('refund_debit', 100_000, 'full-refund', '2026-11-16'),
      movement('payout_adjustment_credit', 15_200, 'waived-fee-credit', '2026-11-17'),
    ]);
    expect(position(revised, movements)).toMatchObject({
      otaCommissionMinor: 0, actualPayoutMinor: 0, cashDifferenceMinor: 0,
      payoutStatus: 'settled', processedMovementCount: 3,
      expectedNetAfterCostsMinor: -500,
    });
    expect(position(revised)).toEqual(pending);
  });

  it.each([
    { base: 'gross' as const, fee: 15_200 },
    { base: 'gross_less_refunds' as const, fee: 200 },
  ])('retains the contracted $base cancellation fee after a full refund', ({ base, fee }) => {
    const policy = Object.freeze({ ...rule, base, collection: 'separate_invoice' as const,
      chargeOnCancellation: true });
    const revised = Object.freeze({ ...snapshot, status: 'cancelled' as const,
      refundedMinor: 100_000, revisionDate: '2026-11-15' });
    const original = Object.freeze([movement('payout_received', 100_000, 'gross-payout')]);
    const refunded = Object.freeze([
      ...original, movement('refund_debit', 100_000, 'full-refund', '2026-11-16'),
    ]);
    const unpaid = position(revised, refunded, policy);
    expect(unpaid).toMatchObject({
      otaCommissionMinor: fee, expectedPayoutMinor: 0, actualPayoutMinor: 0,
      expectedSeparateFeeMinor: fee, feeUnpaidMinor: fee, feeStatus: 'overdue',
      cashDifferenceMinor: -fee, expectedNetAfterCostsMinor: -fee - 500,
    });
    const settled = Object.freeze([
      ...refunded, movement('separate_fee_paid', fee, 'cancellation-fee', '2026-11-19'),
    ]);
    expect(position(revised, settled, policy)).toMatchObject({
      separateFeePaidMinor: fee, feeUnpaidMinor: 0, feeStatus: 'settled',
      clearedOtaCashMinor: -fee, cashDifferenceMinor: 0, processedMovementCount: 3,
    });
    expect(position(revised, refunded, policy)).toEqual(unpaid);
    expect(original).toEqual([movement('payout_received', 100_000, 'gross-payout')]);
  });

  it.each([
    { chargeOnCancellation: false, base: 'gross' as const, fee: 0, payout: 80_000 },
    { chargeOnCancellation: false, base: 'gross_less_refunds' as const, fee: 0, payout: 80_000 },
    { chargeOnCancellation: true, base: 'gross' as const, fee: 15_200, payout: 64_800 },
    { chargeOnCancellation: true, base: 'gross_less_refunds' as const, fee: 12_200, payout: 67_800 },
  ])('applies cancellation=$chargeOnCancellation with $base to a partial refund', ({
    chargeOnCancellation, base, fee, payout,
  }) => {
    const policy = Object.freeze({ ...rule, base, chargeOnCancellation });
    const revised = Object.freeze({ ...snapshot, status: 'cancelled' as const,
      refundedMinor: 20_000, revisionDate: '2026-11-15' });
    const before = position(snapshot, history, policy);
    const refund = movement('refund_debit', 20_000, 'cancelled-partial-refund', '2026-11-16');
    const refundOnly = Object.freeze([...history, refund]);
    expect(position(revised, refundOnly, policy)).toMatchObject({
      netGuestRevenueMinor: 80_000, otaCommissionMinor: fee,
      actualPayoutMinor: 64_800, expectedPayoutMinor: payout,
      payoutDifferenceMinor: payout - 64_800, processedMovementCount: 2,
    });
    // Reverse only the fee waived by this contract, through a new cash event.
    const credit = 15_200 - fee;
    const settled = Object.freeze([...refundOnly,
      ...(credit ? [movement('payout_adjustment_credit', credit, 'cancellation-credit',
        '2026-11-17')] : []),
    ]);
    expect(position(revised, settled, policy)).toMatchObject({
      actualPayoutMinor: payout, payoutDifferenceMinor: 0, cashDifferenceMinor: 0,
      payoutStatus: 'settled', expectedNetAfterCostsMinor: payout - 500,
      processedMovementCount: settled.length,
    });
    expect(position(snapshot, history, policy)).toEqual(before);
    expect(settled.slice(0, 2)).toEqual([history[0], refund]);
  });

  it.each([
    { base: 'gross' as const, fee: 15_200 },
    { base: 'gross_less_refunds' as const, fee: 200 },
  ])('does not infer a cancellation waiver from a full refund with $base', ({ base, fee }) => {
    const policy = Object.freeze({ ...rule, base, collection: 'separate_invoice' as const });
    const revised = Object.freeze({ ...snapshot, refundedMinor: 100_000,
      revisionDate: '2026-11-15' });
    const movements = Object.freeze([
      movement('payout_received', 100_000, 'gross-payout'),
      movement('refund_debit', 100_000, 'confirmed-full-refund', '2026-11-16'),
    ]);
    expect(position(revised, movements, policy)).toMatchObject({
      netGuestRevenueMinor: 0, otaCommissionMinor: fee,
      expectedPayoutMinor: 0, actualPayoutMinor: 0, payoutStatus: 'settled',
      expectedSeparateFeeMinor: fee, feeUnpaidMinor: fee, feeStatus: 'overdue',
      cashDifferenceMinor: -fee, processedMovementCount: 2,
    });
    expect(position(Object.freeze({ ...revised, status: 'cancelled' as const }),
      movements, policy)).toMatchObject({
      otaCommissionMinor: 0, expectedSeparateFeeMinor: 0, feeStatus: 'settled',
      cashDifferenceMinor: 0, processedMovementCount: 2,
    });
  });

  it('keeps an amendment correction uncleared until its own settlement date', () => {
    const revised = Object.freeze({ ...snapshot, grossMinor: 120_000,
      revisionDate: '2026-11-15' });
    const correction = movement('payout_adjustment_credit', 17_000,
      'amendment-credit', '2026-11-21');
    const movements = Object.freeze([...history, correction]);
    const before = position(snapshot);
    expect(position(revised, movements)).toMatchObject({
      otaCommissionMinor: 18_200, expectedPayoutMinor: 101_800,
      actualPayoutMinor: 84_800, payoutDifferenceMinor: 17_000,
      cashDifferenceMinor: 17_000, payoutStatus: 'overdue',
      processedMovementCount: 1, ignoredFutureMovementIds: ['amendment-credit'],
    });
    const cleared = reconcileOtaBooking({
      snapshot: revised, movements, rules: [rule], asOfDate: '2026-11-21',
      expectedPayoutOn: '2026-11-18', expectedFeeOn: null,
      channelManagerAllocatedMinor: 500,
    });
    expect(cleared).toMatchObject({
      actualPayoutMinor: 101_800, payoutDifferenceMinor: 0, cashDifferenceMinor: 0,
      payoutStatus: 'settled', processedMovementCount: 2, ignoredFutureMovementIds: [],
    });
    expect(movements).toEqual([...history, correction]);
    expect(position(snapshot)).toEqual(before);
  });

  it.each(['gross', 'gross_less_refunds'] as const)(
    'rejects a retained %s fee that cannot be withheld after a full refund', (base) => {
      const policy = Object.freeze({ ...rule, base, chargeOnCancellation: true });
      const revised = Object.freeze({ ...snapshot, status: 'cancelled' as const,
        refundedMinor: 100_000, revisionDate: '2026-11-15' });
      const before = position(snapshot, history, policy);
      // A retained fee requires an explicit collectible contract; the reconciler
      // must not silently waive it or switch collection to a separate invoice.
      expect(() => position(revised, history, policy))
        .toThrow('fee_exceeds_collectible_payout');
      expect(position(snapshot, history, policy)).toEqual(before);
      expect(history).toEqual([movement('payout_received', 84_800, 'original-payout')]);
    },
  );

  it.each([
    { accountId: 'other-account' },
    { propertyId: 'other-property' },
    { bookingId: 'other-booking' },
    { provider: 'other-ota' },
    { currency: 'USD' },
  ])('rejects a refund adjustment from a different scope: %j', (foreignScope) => {
    const revised = Object.freeze({ ...snapshot, refundedMinor: 20_000,
      revisionDate: '2026-11-15' });
    const before = position(revised);
    const foreignRefund = Object.freeze({
      ...movement('refund_debit', 20_000, 'foreign-refund', '2026-11-16'),
      ...foreignScope,
    });
    expect(() => position(revised, Object.freeze([...history, foreignRefund])))
      .toThrow('cash_event_scope_mismatch');
    expect(position(revised)).toEqual(before);
    expect(history).toEqual([movement('payout_received', 84_800, 'original-payout')]);
  });

  it('rejects rewriting an existing payout event while allowing an appended correction', () => {
    const revised = Object.freeze({ ...snapshot, grossMinor: 80_000,
      revisionDate: '2026-11-15' });
    const pending = position(revised);
    const rewritten = movement('payout_received', 67_800, 'original-payout');
    expect(() => position(revised, Object.freeze([...history, rewritten])))
      .toThrow('conflicting_cash_event_id');
    const correction = movement('payout_adjustment_debit', 17_000, 'amendment-debit',
      '2026-11-16');
    const corrected = Object.freeze([...history, correction]);
    const settled = position(revised, corrected);
    expect(settled).toMatchObject({
      expectedPayoutMinor: 67_800, actualPayoutMinor: 67_800,
      payoutDifferenceMinor: 0, cashDifferenceMinor: 0, processedMovementCount: 2,
    });
    // Replaying either historical event must not apply the correction twice.
    expect(position(revised, Object.freeze([...corrected, ...corrected]))).toEqual(settled);
    expect(position(revised)).toEqual(pending);
    expect(history).toEqual([movement('payout_received', 84_800, 'original-payout')]);
  });

});
