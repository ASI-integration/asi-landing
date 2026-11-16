/**
 * OTA Finance V1: pure, read-only accrual and settlement reconciliation.
 * No external provider API, bank operation, ledger write, or OTA rate publication.
 * All money is integer minor units (kopecks/cents); percentages are integer basis points.
 */
export type FeeCollection = 'withheld_from_payout' | 'separate_invoice';
export type CommissionBase = 'gross' | 'gross_less_refunds';
export type BookingStatus = 'confirmed' | 'completed' | 'cancelled';
export type CashKind =
  | 'payout_received'
  | 'payout_adjustment_credit'
  | 'payout_adjustment_debit'
  | 'refund_debit'
  | 'separate_fee_paid';

export type Scope = Readonly<{
  accountId: string; propertyId: string; bookingId: string;
  provider: string; currency: string;
}>;
export type BookingSnapshot = Scope & Readonly<{
  bookedOn: string;
  revisionDate: string; // state of this revision as of local booking-accounting date
  status: BookingStatus;
  grossMinor: number;
  refundedMinor: number;
}>;
export type FeeRule = Readonly<{
  ruleId: string; provider: string; currency: string;
  validFrom: string; validTo: string | null;
  commissionBps: number; fixedMinor: number;
  base: CommissionBase; collection: FeeCollection;
  chargeOnCancellation: boolean;
}>;
export type CashMovement = Scope & Readonly<{
  eventId: string; kind: CashKind; amountMinor: number;
  settledOn: string; // actual cleared date, not an anticipated payout date
}>;
export type ReconcileInput = Readonly<{
  snapshot: BookingSnapshot;
  rules: readonly FeeRule[];
  movements: readonly CashMovement[];
  asOfDate: string;
  expectedPayoutOn: string | null;
  expectedFeeOn: string | null;
  channelManagerAllocatedMinor: number;
}>;
export type DueStatus = 'settled' | 'pending' | 'overdue' | 'unscheduled' | 'overpaid';
export type BookingPosition = Readonly<{
  bookingId: string; provider: string; currency: string; asOfDate: string;
  ruleId: string; feeCollection: FeeCollection;
  grossMinor: number; refundsMinor: number; netGuestRevenueMinor: number;
  otaCommissionMinor: number; channelManagerAllocatedMinor: number;
  expectedPayoutMinor: number; expectedSeparateFeeMinor: number;
  actualPayoutMinor: number; separateFeePaidMinor: number;
  payoutDifferenceMinor: number; feeUnpaidMinor: number;
  expectedNetAfterCostsMinor: number; clearedOtaCashMinor: number;
  cashDifferenceMinor: number;
  payoutStatus: DueStatus; feeStatus: DueStatus;
  ignoredFutureMovementIds: readonly string[];
  processedMovementCount: number;
  warnings: readonly string[];
  hasUnknownTaxOrProcessingCharges: true;
}>;
export type InvoiceAllocation = Readonly<{
  invoiceId: string; accountId: string; propertyId: string; currency: string;
  invoiceOn: string; periodFrom: string; periodTo: string;
  costMinor: number;
  basis: 'equal_booking' | 'occupied_nights' | 'booking_gross';
}>;
export type AllocationItem = Readonly<{
  bookingId: string; weight: number; // explicit basis-specific weight; never inferred
}>;
export type AllocationResult = Readonly<{
  invoiceId: string; currency: string;
  allocatedMinor: number; unallocatedMinor: number;
  perBooking: readonly Readonly<{ bookingId: string; amountMinor: number }>[];
}>;

export class OtaFinanceError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'OtaFinanceError'; }
}
const MAX_MINOR = 1_000_000_000_000;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const kinds: readonly string[] = [
  'payout_received', 'payout_adjustment_credit', 'payout_adjustment_debit',
  'refund_debit', 'separate_fee_paid',
];
function requireValid(ok: boolean, code: string): void { if (!ok) throw new OtaFinanceError(code); }
function assertId(value: unknown): void {
  requireValid(typeof value === 'string' && ID.test(value), 'invalid_id');
}
function assertMoney(value: unknown): asserts value is number {
  requireValid(typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= 0 && value <= MAX_MINOR, 'invalid_money_minor');
}
function assertDate(value: unknown): asserts value is string {
  requireValid(typeof value === 'string' && DATE.test(value), 'invalid_date');
  const d = new Date(value + 'T00:00:00Z');
  requireValid(!Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value, 'invalid_date');
}
function safe(b: bigint): number {
  requireValid(b <= BigInt(Number.MAX_SAFE_INTEGER) && b >= BigInt(-Number.MAX_SAFE_INTEGER),
    'money_overflow');
  return Number(b);
}
function assertScope(scope: Scope): void {
  assertId(scope.accountId); assertId(scope.propertyId);
  assertId(scope.bookingId); assertId(scope.provider);
  requireValid(CURRENCY.test(scope.currency), 'invalid_currency');
}
function assertRule(rule: FeeRule): void {
  assertId(rule.ruleId); assertId(rule.provider);
  requireValid(CURRENCY.test(rule.currency), 'invalid_currency');
  assertDate(rule.validFrom);
  if (rule.validTo != null) {
    assertDate(rule.validTo);
    requireValid(rule.validTo >= rule.validFrom, 'invalid_rule_period');
  }
  requireValid(Number.isSafeInteger(rule.commissionBps) &&
    rule.commissionBps >= 0 && rule.commissionBps <= 10000, 'invalid_commission_bps');
  assertMoney(rule.fixedMinor);
  requireValid(rule.base === 'gross' || rule.base === 'gross_less_refunds', 'invalid_fee_basis');
  requireValid(rule.collection === 'withheld_from_payout' ||
    rule.collection === 'separate_invoice', 'invalid_fee_collection');
  requireValid(typeof rule.chargeOnCancellation === 'boolean', 'invalid_cancel_policy');
}
export function chooseFeeRule(snapshot: BookingSnapshot, rules: readonly FeeRule[]): FeeRule {
  assertScope(snapshot); assertDate(snapshot.bookedOn);
  const found = rules.filter(rule => {
    assertRule(rule);
    return rule.provider === snapshot.provider && rule.currency === snapshot.currency &&
      rule.validFrom <= snapshot.bookedOn &&
      (rule.validTo == null || snapshot.bookedOn <= rule.validTo);
  });
  requireValid(found.length === 1, found.length ? 'ambiguous_fee_rule' : 'fee_rule_missing');
  return found[0];
}
export function commissionFor(snapshot: BookingSnapshot, rule: FeeRule): number {
  assertScope(snapshot); assertRule(rule);
  assertMoney(snapshot.grossMinor); assertMoney(snapshot.refundedMinor);
  requireValid(snapshot.refundedMinor <= snapshot.grossMinor, 'refund_exceeds_gross');
  requireValid(['confirmed', 'completed', 'cancelled'].includes(snapshot.status), 'invalid_booking_status');
  requireValid(rule.provider === snapshot.provider && rule.currency === snapshot.currency &&
    snapshot.bookedOn >= rule.validFrom &&
    (rule.validTo == null || snapshot.bookedOn <= rule.validTo), 'fee_rule_scope_mismatch');
  if (snapshot.status === 'cancelled' && !rule.chargeOnCancellation) return 0;
  const basis = rule.base === 'gross' ? snapshot.grossMinor :
    snapshot.grossMinor - snapshot.refundedMinor;
  // Half-up to minor units using BigInt (no floating-point commission drift).
  return safe((BigInt(basis) * BigInt(rule.commissionBps) + BigInt(5000)) / BigInt(10000) +
    BigInt(rule.fixedMinor));
}
function balanceStatus(balance: number, due: string | null, asOf: string): DueStatus {
  if (balance === 0) return 'settled';
  if (balance < 0) return 'overpaid';
  if (due == null) return 'unscheduled';
  return asOf > due ? 'overdue' : 'pending';
}
export function reconcileOtaBooking(input: ReconcileInput): BookingPosition {
  const { snapshot, movements } = input;
  assertScope(snapshot); assertDate(snapshot.bookedOn); assertDate(snapshot.revisionDate);
  assertDate(input.asOfDate);
  requireValid(input.asOfDate >= snapshot.revisionDate, 'snapshot_from_future');
  if (input.expectedPayoutOn != null) assertDate(input.expectedPayoutOn);
  if (input.expectedFeeOn != null) assertDate(input.expectedFeeOn);
  assertMoney(input.channelManagerAllocatedMinor);
  const rule = chooseFeeRule(snapshot, input.rules);
  const commission = commissionFor(snapshot, rule);
  const netGuest = snapshot.grossMinor - snapshot.refundedMinor;
  const expectedPayout = netGuest - (rule.collection === 'withheld_from_payout' ? commission : 0);
  requireValid(expectedPayout >= 0, 'fee_exceeds_collectible_payout');
  const separateFee = rule.collection === 'separate_invoice' ? commission : 0;
  const seen = new Map<string, string>();
  const future: string[] = [];
  let actualPayout = BigInt(0), actualFeePaid = BigInt(0), processed = 0;
  for (const m of movements) {
    assertScope(m); assertId(m.eventId); assertMoney(m.amountMinor); assertDate(m.settledOn);
    requireValid(kinds.includes(m.kind), 'invalid_cash_event_kind');
    requireValid(['accountId','propertyId','bookingId','provider','currency']
      .every(key => m[key as keyof Scope] === snapshot[key as keyof Scope]), 'cash_event_scope_mismatch');
    requireValid(!(m.kind === 'separate_fee_paid' && rule.collection !== 'separate_invoice'),
      'fee_payment_conflicts_with_withholding_rule');
    const fingerprint = JSON.stringify([m.accountId,m.propertyId,m.bookingId,m.provider,m.currency,
      m.kind,m.amountMinor,m.settledOn]);
    const previous = seen.get(m.eventId);
    requireValid(previous == null || previous === fingerprint, 'conflicting_cash_event_id');
    if (previous != null) continue;
    seen.set(m.eventId,fingerprint);
    if (m.settledOn > input.asOfDate) { future.push(m.eventId); continue; }
    processed += 1;
    const amount = BigInt(m.amountMinor);
    if (m.kind === 'payout_received' || m.kind === 'payout_adjustment_credit') actualPayout += amount;
    else if (m.kind === 'separate_fee_paid') actualFeePaid += amount;
    else actualPayout -= amount;
  }
  const clearedOtaCash = safe(actualPayout - actualFeePaid);
  const expectedNet = safe(BigInt(netGuest) - BigInt(commission) - BigInt(input.channelManagerAllocatedMinor));
  const actualPayoutNumber = safe(actualPayout);
  const feePaidNumber = safe(actualFeePaid);
  const payoutDifference = safe(BigInt(expectedPayout) - actualPayout);
  const feeUnpaid = safe(BigInt(separateFee) - actualFeePaid);
  const cashDifference = safe(BigInt(netGuest) - BigInt(commission) -
    (actualPayout - actualFeePaid));
  const warnings = [
    ...(input.expectedPayoutOn == null ? ['payout_schedule_not_provided'] : []),
    ...(separateFee > 0 && input.expectedFeeOn == null ? ['separate_fee_schedule_not_provided'] : []),
    ...(input.channelManagerAllocatedMinor === 0 ? ['channel_manager_cost_may_be_unallocated'] : []),
    'taxes_merchant_processing_costs_not_modelled',
  ];
  return {
    bookingId: snapshot.bookingId, provider: snapshot.provider, currency: snapshot.currency,
    asOfDate: input.asOfDate, ruleId: rule.ruleId, feeCollection: rule.collection,
    grossMinor: snapshot.grossMinor, refundsMinor: snapshot.refundedMinor,
    netGuestRevenueMinor: netGuest, otaCommissionMinor: commission,
    channelManagerAllocatedMinor: input.channelManagerAllocatedMinor,
    expectedPayoutMinor: expectedPayout, expectedSeparateFeeMinor: separateFee,
    actualPayoutMinor: actualPayoutNumber, separateFeePaidMinor: feePaidNumber,
    payoutDifferenceMinor: payoutDifference, feeUnpaidMinor: feeUnpaid,
    expectedNetAfterCostsMinor: expectedNet, clearedOtaCashMinor: clearedOtaCash,
    cashDifferenceMinor: cashDifference,
    payoutStatus: balanceStatus(payoutDifference, input.expectedPayoutOn, input.asOfDate),
    feeStatus: balanceStatus(feeUnpaid, input.expectedFeeOn, input.asOfDate),
    ignoredFutureMovementIds: future,
    processedMovementCount: processed,
    warnings, hasUnknownTaxOrProcessingCharges: true,
  };
}
/** Allocate one CM invoice only among explicitly selected same-account/property booking weights. */
export function allocateChannelManagerInvoice(
  invoice: InvoiceAllocation, items: readonly AllocationItem[],
): AllocationResult {
  assertId(invoice.invoiceId); assertId(invoice.accountId); assertId(invoice.propertyId);
  requireValid(CURRENCY.test(invoice.currency), 'invalid_currency');
  assertDate(invoice.invoiceOn); assertDate(invoice.periodFrom); assertDate(invoice.periodTo);
  requireValid(invoice.periodTo >= invoice.periodFrom, 'invalid_invoice_period');
  assertMoney(invoice.costMinor);
  requireValid(['equal_booking','occupied_nights','booking_gross'].includes(invoice.basis),
    'invalid_allocation_basis');
  const seen = new Set<string>();
  for (const item of items) {
    assertId(item.bookingId);
    requireValid(!seen.has(item.bookingId), 'duplicate_allocation_booking');
    seen.add(item.bookingId);
    requireValid(Number.isSafeInteger(item.weight) && item.weight >= 0 &&
      item.weight <= MAX_MINOR, 'invalid_allocation_weight');
    if (invoice.basis === 'equal_booking') requireValid(item.weight === 1, 'equal_booking_weight_must_be_one');
  }
  const totalWeight = items.reduce((a,item) => a + BigInt(item.weight),BigInt(0));
  if (totalWeight === BigInt(0)) return { invoiceId: invoice.invoiceId, currency: invoice.currency,
    allocatedMinor: 0, unallocatedMinor: invoice.costMinor,
    perBooking: items.map(item=>({bookingId:item.bookingId,amountMinor:0})) };
  const shares = items.map(item=>{
    const numerator = BigInt(invoice.costMinor) * BigInt(item.weight);
    return { bookingId:item.bookingId, amount: numerator / totalWeight, remainder:numerator % totalWeight };
  });
  const residual = BigInt(invoice.costMinor) - shares.reduce((a,b)=>a+b.amount,BigInt(0));
  const byRemainder = [...shares].sort((a,b)=>
    (a.remainder === b.remainder ? a.bookingId.localeCompare(b.bookingId) :
      a.remainder > b.remainder ? -1 : 1));
  for (let i=0;i<Number(residual);i+=1) byRemainder[i].amount += BigInt(1);
  const perBooking = shares.map(s=>({bookingId:s.bookingId,amountMinor:safe(s.amount)}))
    .sort((a,b)=>a.bookingId.localeCompare(b.bookingId));
  return { invoiceId:invoice.invoiceId,currency:invoice.currency,
    allocatedMinor:invoice.costMinor,unallocatedMinor:0,perBooking };
}
/** Non-publishing price/channel simulation: no real payment or OTA rate mutation. */
export function projectChannelNet(input: Readonly<{
  snapshot: BookingSnapshot; rules: readonly FeeRule[];
  proposedGrossMinor: number; channelManagerAllocatedMinor: number;
}>): Readonly<{ provider: string; currency: string; grossMinor: number;
  expectedCommissionMinor: number; expectedNetMinor: number }> {
  assertMoney(input.proposedGrossMinor); assertMoney(input.channelManagerAllocatedMinor);
  requireValid(input.proposedGrossMinor >= input.snapshot.refundedMinor,'refund_exceeds_projected_gross');
  const alternative = { ...input.snapshot, grossMinor:input.proposedGrossMinor };
  const commission = commissionFor(alternative,chooseFeeRule(alternative,input.rules));
  return { provider:alternative.provider,currency:alternative.currency,
    grossMinor:input.proposedGrossMinor,expectedCommissionMinor:commission,
    expectedNetMinor:safe(BigInt(input.proposedGrossMinor)-BigInt(alternative.refundedMinor)-
      BigInt(commission)-BigInt(input.channelManagerAllocatedMinor)) };
}
