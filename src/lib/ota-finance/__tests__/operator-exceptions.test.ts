import { describe, expect, it } from 'vitest';
import {
  OtaFinanceError, reconcileOtaBooking,
  type CashMovement, type FeeRule, type ReconcileInput,
} from '../ledger';

const scope = {
  accountId: 'operator-account', propertyId: 'property-1', bookingId: 'booking-1',
  provider: 'ota-a', currency: 'RUB',
};
const fee: FeeRule = {
  ruleId: 'contract-2026', provider: scope.provider, currency: scope.currency,
  validFrom: '2026-01-01', validTo: null,
  commissionBps: 1500, fixedMinor: 200, base: 'gross_less_refunds',
  collection: 'withheld_from_payout', chargeOnCancellation: false,
};
const movement = (
  eventId: string, kind: CashMovement['kind'], amountMinor: number,
): CashMovement => ({ ...scope, eventId, kind, amountMinor, settledOn: '2026-11-15' });

function reconcile(overrides: Partial<ReconcileInput> = {}) {
  return reconcileOtaBooking({
    snapshot: {
      ...scope, bookedOn: '2026-11-01', revisionDate: '2026-11-02',
      status: 'completed', grossMinor: 100_000, refundedMinor: 0,
    },
    rules: [fee], movements: [movement('payout-1', 'payout_received', 84_800)],
    asOfDate: '2026-11-16', expectedPayoutOn: '2026-11-14', expectedFeeOn: null,
    channelManagerAllocatedMinor: 500,
    ...overrides,
  });
}

// These are operator review signals from the pure ledger seam. No handoff delivery
// or guest communication is invoked or simulated by these tests.
describe('OTA finance exceptions for operator review', () => {
  it('flags an outstanding payout with no schedule instead of inventing a due date', () => {
    const position = reconcile({ movements: [], expectedPayoutOn: null });
    expect(position.warnings).toContain('payout_schedule_not_provided');
    expect(position.payoutStatus).toBe('unscheduled');
    expect(position.payoutDifferenceMinor).toBe(84_800);

    const scheduled = reconcile({ movements: [], expectedPayoutOn: '2026-11-20' });
    expect(scheduled.warnings).not.toContain('payout_schedule_not_provided');
    expect(scheduled.payoutStatus).toBe('pending');
  });

  it('keeps the missing schedule warning even when cleared cash matches', () => {
    const position = reconcile({ expectedPayoutOn: null });
    expect(position.payoutStatus).toBe('settled');
    expect(position.payoutDifferenceMinor).toBe(0);
    expect(position.warnings).toContain('payout_schedule_not_provided');
  });

  it('refuses an unknown OTA fee rather than treating it as zero cost', () => {
    expect(() => reconcile({ rules: [] })).toThrow(OtaFinanceError);
    expect(() => reconcile({ rules: [] })).toThrow('fee_rule_missing');
    expect(() => reconcile({ rules: [{ ...fee, validTo: '2026-10-31' }] }))
      .toThrow('fee_rule_missing');
  });

  it.each([
    { label: 'another provider', rule: { ...fee, provider: 'ota-b' } },
    { label: 'another currency', rule: { ...fee, currency: 'USD' } },
    { label: 'a future contract', rule: { ...fee, validFrom: '2026-11-02' } },
  ])('keeps the fee unknown with only $label available', ({ rule }) => {
    expect(() => reconcile({ rules: [rule] })).toThrowError(
      new OtaFinanceError('fee_rule_missing'),
    );
  });

  it('preserves unknown tax and processing cost flags despite a settled payout', () => {
    const position = reconcile();
    expect(position.payoutStatus).toBe('settled');
    expect(position.cashDifferenceMinor).toBe(0);
    expect(position.hasUnknownTaxOrProcessingCharges).toBe(true);
    expect(position.warnings).toContain('taxes_merchant_processing_costs_not_modelled');
  });

  it.each([
    { kind: 'payout_adjustment_debit' as const, difference: 1_000, status: 'overdue' },
    { kind: 'payout_adjustment_credit' as const, difference: -1_000, status: 'overpaid' },
  ])('retains an unreconciled $kind for operator review', ({ kind, difference, status }) => {
    const position = reconcile({ movements: [
      movement('payout-1', 'payout_received', 84_800),
      movement('adjustment-1', kind, 1_000),
    ] });
    expect(position.payoutDifferenceMinor).toBe(difference);
    expect(position.cashDifferenceMinor).toBe(difference);
    expect(position.payoutStatus).toBe(status);
    expect(position.processedMovementCount).toBe(2);
  });

  it('clears the discrepancy only when a balancing adjustment is present', () => {
    const position = reconcile({ movements: [
      movement('payout-1', 'payout_received', 84_800),
      movement('debit-1', 'payout_adjustment_debit', 1_000),
      movement('credit-1', 'payout_adjustment_credit', 1_000),
    ] });
    expect(position.payoutDifferenceMinor).toBe(0);
    expect(position.cashDifferenceMinor).toBe(0);
    expect(position.payoutStatus).toBe('settled');
  });

  it('retains the residual adjustment when a partial credit is imported twice', () => {
    const credit = movement('partial-credit', 'payout_adjustment_credit', 400);
    const position = reconcile({ movements: [
      movement('payout-1', 'payout_received', 84_800),
      movement('debit-1', 'payout_adjustment_debit', 1_000),
      credit,
      { ...credit },
    ] });
    expect(position.actualPayoutMinor).toBe(84_200);
    expect(position.payoutDifferenceMinor).toBe(600);
    expect(position.cashDifferenceMinor).toBe(600);
    expect(position.payoutStatus).toBe('overdue');
    expect(position.processedMovementCount).toBe(3);
  });

  it('does not clear an operator discrepancy with a future balancing adjustment', () => {
    const position = reconcile({ movements: [
      movement('payout-1', 'payout_received', 84_800),
      movement('debit-1', 'payout_adjustment_debit', 1_000),
      { ...movement('future-credit', 'payout_adjustment_credit', 1_000),
        settledOn: '2026-11-17' },
    ] });
    expect(position.payoutDifferenceMinor).toBe(1_000);
    expect(position.cashDifferenceMinor).toBe(1_000);
    expect(position.payoutStatus).toBe('overdue');
    expect(position.processedMovementCount).toBe(2);
    expect(position.ignoredFutureMovementIds).toEqual(['future-credit']);
  });

  it.each([
    { accountId: 'other-account' },
    { propertyId: 'other-property' },
    { bookingId: 'other-booking' },
    { provider: 'other-ota' },
    { currency: 'USD' },
  ])('rejects a balancing adjustment outside the operator scope: %j', (otherScope) => {
    const movements = [
      movement('payout-1', 'payout_received', 84_800),
      movement('debit-1', 'payout_adjustment_debit', 1_000),
      movement('credit-1', 'payout_adjustment_credit', 1_000),
    ];
    // The same-scope control really balances; only the foreign identity is invalid.
    expect(reconcile({ movements }).payoutDifferenceMinor).toBe(0);
    expect(() => reconcile({ movements: [
      ...movements.slice(0, 2),
      { ...movements[2], ...otherScope },
    ] })).toThrowError(new OtaFinanceError('cash_event_scope_mismatch'));
  });

  it('preserves simultaneous review signals instead of hiding them behind payout status', () => {
    const position = reconcile({
      expectedPayoutOn: null,
      channelManagerAllocatedMinor: 0,
      movements: [
        movement('payout-1', 'payout_received', 84_800),
        movement('debit-1', 'payout_adjustment_debit', 1_000),
      ],
    });
    expect(position.warnings).toEqual([
      'payout_schedule_not_provided',
      'channel_manager_cost_may_be_unallocated',
      'taxes_merchant_processing_costs_not_modelled',
    ]);
    expect(position.hasUnknownTaxOrProcessingCharges).toBe(true);
    expect(position.payoutStatus).toBe('unscheduled');
    expect(position.payoutDifferenceMinor).toBe(1_000);
    expect(position.cashDifferenceMinor).toBe(1_000);
  });

  it('flags a possibly missing Channel Manager allocation even with settled OTA cash', () => {
    const missing = reconcile({ channelManagerAllocatedMinor: 0 });
    expect(missing.payoutStatus).toBe('settled');
    expect(missing.warnings).toContain('channel_manager_cost_may_be_unallocated');
    expect(missing.expectedNetAfterCostsMinor).toBe(84_800);

    const allocated = reconcile();
    expect(allocated.warnings).not.toContain('channel_manager_cost_may_be_unallocated');
    expect(allocated.expectedNetAfterCostsMinor).toBe(84_300);
    expect(allocated.expectedPayoutMinor).toBe(missing.expectedPayoutMinor);
    expect(allocated.cashDifferenceMinor).toBe(0);
  });

  it('keeps missing cost and fee schedule visible when a separately invoiced payout settles', () => {
    const position = reconcile({
      rules: [{ ...fee, collection: 'separate_invoice' }],
      movements: [movement('payout-1', 'payout_received', 100_000)],
      channelManagerAllocatedMinor: 0,
    });
    expect(position.payoutStatus).toBe('settled');
    expect(position.payoutDifferenceMinor).toBe(0);
    expect(position.feeStatus).toBe('unscheduled');
    expect(position.feeUnpaidMinor).toBe(15_200);
    expect(position.cashDifferenceMinor).toBe(-15_200);
    expect(position.warnings).toContain('separate_fee_schedule_not_provided');
    expect(position.warnings).toContain('channel_manager_cost_may_be_unallocated');
    expect(position.hasUnknownTaxOrProcessingCharges).toBe(true);
  });
});
