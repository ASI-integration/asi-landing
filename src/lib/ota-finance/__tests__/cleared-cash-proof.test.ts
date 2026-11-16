import { describe, expect, it } from 'vitest';
import {
  reconcileOtaBooking,
  type CashMovement,
  type ReconcileInput,
} from '../ledger';
import { OTA_CASH_CSV_HEADERS, parseOtaCashCsv } from '../statement-csv';

// Offline ledger regressions only: supplied dates are not proof from a bank.
const scope = {
  accountId: 'tenant-1', propertyId: 'property-1', bookingId: 'booking-1',
  provider: 'ota-a', currency: 'RUB',
};
const payout: CashMovement = {
  ...scope, eventId: 'payout-1', kind: 'payout_received',
  amountMinor: 100_000, settledOn: '2026-11-16',
};
function reconcile(overrides: Partial<ReconcileInput> = {}) {
  return reconcileOtaBooking({
    snapshot: {
      ...scope, bookedOn: '2026-11-01', revisionDate: '2026-11-02',
      status: 'confirmed', grossMinor: 100_000, refundedMinor: 0,
    },
    rules: [{
      ruleId: 'separate-2026', provider: scope.provider, currency: scope.currency,
      validFrom: '2026-01-01', validTo: null, commissionBps: 1500,
      fixedMinor: 0, base: 'gross_less_refunds', collection: 'separate_invoice',
      chargeOnCancellation: false,
    }],
    movements: [], asOfDate: '2026-11-16',
    expectedPayoutOn: '2026-11-14', expectedFeeOn: '2026-11-15',
    channelManagerAllocatedMinor: 0,
    ...overrides,
  });
}

function importStatement(movements: readonly CashMovement[]) {
  const lines = movements.map((movement) => [
    movement.accountId, movement.propertyId, movement.bookingId,
    movement.provider, movement.currency, movement.eventId,
    movement.kind, movement.amountMinor, movement.settledOn,
  ].join(','));
  return parseOtaCashCsv([OTA_CASH_CSV_HEADERS.join(','), ...lines].join('\n'), {
    ...scope, statementId: 'statement-1', asOfDate: '2026-11-16',
  });
}

describe('offline cleared cash negative ledger regressions', () => {
  it.each(['2026-02-29', '2026-11-31', '2026-11-16T00:00:00Z', ''])(
    'rejects invalid clearing date %j', (settledOn) => {
      expect(() => reconcile({ movements: [{ ...payout, settledOn }] }))
        .toThrow('invalid_date');
    },
  );

  it('does not count a future payout or its duplicate before the clearing day', () => {
    const future = { ...payout, settledOn: '2026-11-17' };
    expect(reconcile({ movements: [future, { ...future }] })).toMatchObject({
      actualPayoutMinor: 0, clearedOtaCashMinor: 0, processedMovementCount: 0,
      payoutStatus: 'overdue', ignoredFutureMovementIds: ['payout-1'],
    });
    expect(reconcile({ movements: [future], asOfDate: '2026-11-17' }))
      .toMatchObject({ actualPayoutMinor: 100_000, processedMovementCount: 1 });
  });

  it('counts identical event IDs only once even when supplied as distinct objects', () => {
    expect(reconcile({ movements: [payout, { ...payout }] })).toMatchObject({
      actualPayoutMinor: 100_000, clearedOtaCashMinor: 100_000,
      processedMovementCount: 1, payoutDifferenceMinor: 0,
    });
  });

  it.each<Partial<CashMovement>>([
    { amountMinor: 100_001 },
    { kind: 'payout_adjustment_credit' },
    { settledOn: '2026-11-17' },
  ])('rejects conflicting event IDs with changed payload %j in either order', (change) => {
    const conflicting = { ...payout, ...change };
    for (const movements of [[payout, conflicting], [conflicting, payout]]) {
      expect(() => reconcile({ movements })).toThrow('conflicting_cash_event_id');
    }
  });

  it('keeps a separate invoice overdue when its fee payment has not cleared', () => {
    const fee: CashMovement = {
      ...payout, eventId: 'fee-1', kind: 'separate_fee_paid',
      amountMinor: 15_000, settledOn: '2026-11-17',
    };
    expect(reconcile({ movements: [payout, fee] })).toMatchObject({
      payoutStatus: 'settled', feeStatus: 'overdue', feeUnpaidMinor: 15_000,
      separateFeePaidMinor: 0, clearedOtaCashMinor: 100_000,
      ignoredFutureMovementIds: ['fee-1'],
    });
    expect(reconcile({ movements: [payout, fee], asOfDate: '2026-11-17' }))
      .toMatchObject({ feeStatus: 'settled', feeUnpaidMinor: 0,
        clearedOtaCashMinor: 85_000 });
  });

  it('does not infer received cash from an unknown payout schedule', () => {
    expect(reconcile({ expectedPayoutOn: null })).toMatchObject({
      payoutStatus: 'unscheduled', actualPayoutMinor: 0, clearedOtaCashMinor: 0,
      payoutDifferenceMinor: 100_000, processedMovementCount: 0,
      warnings: expect.arrayContaining(['payout_schedule_not_provided']),
    });
  });

  it('keeps the unpaid invoice balance overdue after a partial cleared fee payment', () => {
    const fee: CashMovement = {
      ...payout, eventId: 'partial-fee', kind: 'separate_fee_paid', amountMinor: 5_000,
    };
    const { rows } = importStatement([payout, fee, { ...fee }]);
    expect(reconcile({ movements: rows })).toMatchObject({
      payoutStatus: 'settled', feeStatus: 'overdue', feeUnpaidMinor: 10_000,
      separateFeePaidMinor: 5_000, clearedOtaCashMinor: 95_000,
      cashDifferenceMinor: -10_000, processedMovementCount: 2,
    });
  });

  it('does not mark an unpaid separate invoice overdue until after its due date', () => {
    expect(reconcile({ movements: [payout], expectedFeeOn: '2026-11-16' }))
      .toMatchObject({ feeStatus: 'pending', feeUnpaidMinor: 15_000 });
    expect(reconcile({ movements: [payout], asOfDate: '2026-11-17',
      expectedFeeOn: '2026-11-16' }))
      .toMatchObject({ feeStatus: 'overdue', feeUnpaidMinor: 15_000 });
  });

  it.each(['2026-02-29', '2026-11-31', '2026-11-16T00:00:00Z', ''])(
    'rejects invalid clearing date %j at CSV intake too', (settledOn) => {
      expect(() => importStatement([{ ...payout, settledOn }]))
        .toThrow('invalid_settled_date');
    },
  );

  it('rejects future clearing at intake and keeps same-day imported cash unverified', () => {
    expect(() => importStatement([{ ...payout, settledOn: '2026-11-17' }]))
      .toThrow('bank_clearing_date_in_future');
    const candidate = importStatement([payout, { ...payout }]);
    expect(candidate).toMatchObject({
      status: 'UNVERIFIED_OPERATOR_IMPORT', rowCount: 1, deduplicatedRowCount: 1,
      notes: expect.arrayContaining(['source_provenance_and_bank_clearance_not_verified']),
    });
    expect(reconcile({ movements: candidate.rows })).toMatchObject({
      actualPayoutMinor: 100_000, processedMovementCount: 1,
    });
  });

  it.each<Partial<CashMovement>>([
    { kind: 'payout_adjustment_credit' },
    { settledOn: '2026-11-15' },
    { bookingId: 'unknown-booking' },
  ])('rejects conflicting CSV event IDs with changed payload %j in either order', (change) => {
    const conflicting = { ...payout, ...change };
    for (const movements of [[payout, conflicting], [conflicting, payout]]) {
      expect(() => importStatement(movements)).toThrow('conflicting_statement_event_id');
    }
  });

  it('does not attribute an imported unknown booking payout to the current booking', () => {
    const candidate = importStatement([{ ...payout, bookingId: 'unknown-booking' }]);
    expect(candidate.rows[0].bookingId).toBe('unknown-booking');
    expect(() => reconcile({ movements: candidate.rows })).toThrow('cash_event_scope_mismatch');
  });

  it('rejects a foreign tenant CSV row before deduplication even with a matching event ID', () => {
    const foreign = { ...payout, accountId: 'tenant-2' };
    for (const movements of [[foreign], [payout, foreign], [foreign, payout]]) {
      expect(() => importStatement(movements)).toThrow('statement_scope_mismatch');
    }
  });

  it.each(['accountId', 'propertyId', 'bookingId', 'provider'] as const)(
    'rejects an unknown payout with another %s even when its event ID matches', (field) => {
      const foreign = { ...payout, [field]: 'other-scope' };
      for (const movements of [[foreign], [payout, foreign], [foreign, payout]]) {
        expect(() => reconcile({ movements })).toThrow('cash_event_scope_mismatch');
      }
    },
  );
});
