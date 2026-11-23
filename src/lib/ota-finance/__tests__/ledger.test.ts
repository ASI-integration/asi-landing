import { describe, expect, it } from 'vitest';
import {
  allocateChannelManagerInvoice, chooseFeeRule, commissionFor,
  projectChannelNet, reconcileOtaBooking, type BookingSnapshot,
  type FeeRule, type CashMovement, type InvoiceAllocation,
} from '../ledger';

const scope = {
  accountId:'tenant-1',propertyId:'property-1',bookingId:'booking-1',
  provider:'ota-a',currency:'RUB',
};
const snapshot: BookingSnapshot = {
  ...scope, bookedOn:'2026-11-01',revisionDate:'2026-11-02',
  status:'confirmed',grossMinor:100_000,refundedMinor:0,
};
const withheld: FeeRule = {
  ruleId:'ota-a-2026',provider:'ota-a',currency:'RUB',
  validFrom:'2026-01-01',validTo:null,
  commissionBps:1500,fixedMinor:200,
  base:'gross_less_refunds',collection:'withheld_from_payout',
  chargeOnCancellation:false,
};
const separate: FeeRule = {
  ...withheld,ruleId:'ota-b-2026',provider:'ota-b',
  commissionBps:2250, fixedMinor:100,
  collection:'separate_invoice',chargeOnCancellation:true,
};
const cash = (kind:CashMovement['kind'],amountMinor:number,settledOn:string,eventId:string):CashMovement =>
  ({...scope,kind,amountMinor,settledOn,eventId});
function check(params: Partial<Parameters<typeof reconcileOtaBooking>[0]>={}) {
  return reconcileOtaBooking({
    snapshot,rules:[withheld],movements:[],asOfDate:'2026-11-16',
    expectedPayoutOn:'2026-11-20',expectedFeeOn:null,
    channelManagerAllocatedMinor:500,
    ...params,
  });
}
describe('OTA finance v1 ??? deterministic, non-writing calculation',()=>{
  it('correctly rounds percentage plus fixed fee in integer minor units',()=>{
    expect(commissionFor({...snapshot,grossMinor:10_005},withheld)).toBe(1701);
    expect(check().otaCommissionMinor).toBe(15_200);
  });
  it('withheld commissions reduce OTA payout; Channel Manager remains a distinct cost',()=>{
    const p=check();
    expect(p.expectedPayoutMinor).toBe(84_800);
    expect(p.expectedSeparateFeeMinor).toBe(0);
    expect(p.expectedNetAfterCostsMinor).toBe(84_300);
    expect(p.cashDifferenceMinor).toBe(84_800);
    expect(p.payoutStatus).toBe('pending');
  });
  it('a platform with separate later invoice pays gross first; fee remains due separately',()=>{
    const s={...snapshot,provider:'ota-b'};
    const m1={...cash('payout_received',100_000,'2026-11-10','pay-1'),provider:'ota-b'};
    const p=check({snapshot:s,rules:[separate],movements:[m1],
      expectedPayoutOn:'2026-11-10',expectedFeeOn:'2026-12-01'});
    expect(p.otaCommissionMinor).toBe(22_600);
    expect(p.expectedPayoutMinor).toBe(100_000);
    expect(p.payoutStatus).toBe('settled');
    expect(p.feeUnpaidMinor).toBe(22_600);
    expect(p.feeStatus).toBe('pending');
    expect(p.expectedNetAfterCostsMinor).toBe(76_900);
  });
  it('fees paid on a different date are reflected only after actual clearance',()=>{
    const s={...snapshot,provider:'ota-b'};
    const events=[
      {...cash('payout_received',100_000,'2026-11-03','pay-1'),provider:'ota-b'},
      {...cash('separate_fee_paid',22_600,'2026-12-05','fee-1'),provider:'ota-b'},
    ];
    const before=check({snapshot:s,rules:[separate],movements:events,
      expectedFeeOn:'2026-12-01',expectedPayoutOn:'2026-11-03',asOfDate:'2026-12-02'});
    expect(before.feeStatus).toBe('overdue');
    expect(before.ignoredFutureMovementIds).toEqual(['fee-1']);
    const after=check({snapshot:s,rules:[separate],movements:events,
      expectedFeeOn:'2026-12-01',expectedPayoutOn:'2026-11-03',asOfDate:'2026-12-06'});
    expect(after.feeUnpaidMinor).toBe(0);
    expect(after.feeStatus).toBe('settled');
    expect(after.clearedOtaCashMinor).toBe(77_400);
    expect(after.cashDifferenceMinor).toBe(0);
  });
  it('full refund changes the fee basis without rewriting old bank events',()=>{
    const revised={...snapshot,refundedMinor:100_000,revisionDate:'2026-11-14',status:'cancelled' as const};
    const movements=[
      cash('payout_received',84_800,'2026-11-06','pay-1'),
      cash('refund_debit',84_800,'2026-11-15','debit-1'),
    ];
    const p=check({snapshot:revised,movements,asOfDate:'2026-11-16'});
    expect(p.netGuestRevenueMinor).toBe(0);
    expect(p.otaCommissionMinor).toBe(0);
    expect(p.expectedPayoutMinor).toBe(0);
    expect(p.cashDifferenceMinor).toBe(0);
    expect(p.actualPayoutMinor).toBe(0);
  });
  it('partial refund adjusts percentage charged against net of refunds',()=>{
    const p=check({snapshot:{...snapshot,refundedMinor:20_000},movements:[
      cash('payout_received',67_800,'2026-11-16','pay-1'),
    ]});
    expect(p.otaCommissionMinor).toBe(12_200);
    expect(p.expectedPayoutMinor).toBe(67_800);
    expect(p.cashDifferenceMinor).toBe(0);
  });
  it('cancellation with chargeable fee can leave money owed to OTA',()=>{
    const s={...snapshot,provider:'ota-b',status:'cancelled' as const,refundedMinor:100_000};
    const p=check({snapshot:s,rules:[{...separate,base:'gross'}],channelManagerAllocatedMinor:0});
    expect(p.otaCommissionMinor).toBe(22_600);
    expect(p.expectedPayoutMinor).toBe(0);
    expect(p.expectedSeparateFeeMinor).toBe(22_600);
    expect(p.expectedNetAfterCostsMinor).toBe(-22_600);
  });
  it('respects the rule active on original booking date, not the payout date',()=>{
    const earlier={...withheld,validTo:'2026-11-14'};
    const later={...withheld,ruleId:'new-rate',validFrom:'2026-11-15',commissionBps:2000};
    expect(chooseFeeRule(snapshot,[later,earlier]).ruleId).toBe('ota-a-2026');
    expect(check({rules:[earlier,later],asOfDate:'2026-12-20'}).otaCommissionMinor).toBe(15_200);
  });
  it('overlapping fee schedules are an error, never a guessed default',()=>{
    expect(()=>chooseFeeRule(snapshot,[withheld,{...withheld,ruleId:'duplicate'}]))
      .toThrow('ambiguous_fee_rule');
  });
  it('missing fee schedule is an error, never an invented OTA rate',()=>{
    expect(()=>check({rules:[separate]})).toThrow('fee_rule_missing');
  });
  it('refuses a cash event from another property, account, provider or currency',()=>{
    for (const field of ['accountId','propertyId','provider','currency'] as const) {
      expect(()=>check({movements:[{...cash('payout_received',500,'2026-11-03','pay'),[field]:'wrong'}]}))
        .toThrow(field==='currency'?'invalid_currency':'cash_event_scope_mismatch');
    }
  });
  it('is idempotent for repeated identical payout identifiers',()=>{
    const row=cash('payout_received',84_800,'2026-11-10','same');
    const p=check({movements:[row,row]});
    expect(p.processedMovementCount).toBe(1);
    expect(p.cashDifferenceMinor).toBe(0);
  });
  it('blocks conflicting events sharing an identifier instead of overwriting money',()=>{
    expect(()=>check({movements:[
      cash('payout_received',100,'2026-11-10','same'),
      cash('payout_received',101,'2026-11-10','same'),
    ]})).toThrow('conflicting_cash_event_id');
  });
  it('rejects future booking revisions, impossible refunds and unsafe negative costs',()=>{
    expect(()=>check({snapshot:{...snapshot,revisionDate:'2026-12-01'}}))
      .toThrow('snapshot_from_future');
    expect(()=>check({snapshot:{...snapshot,refundedMinor:100_001}}))
      .toThrow('refund_exceeds_gross');
    expect(()=>check({channelManagerAllocatedMinor:-1})).toThrow('invalid_money_minor');
  });
  it('distinguishes pending, overdue, unscheduled and overpaid payouts',()=>{
    expect(check({asOfDate:'2026-11-21'}).payoutStatus).toBe('overdue');
    expect(check({expectedPayoutOn:null}).payoutStatus).toBe('unscheduled');
    expect(check({movements:[cash('payout_received',90_000,'2026-11-03','x')]}).payoutStatus)
      .toBe('overpaid');
  });
  it('refuses to treat fee payment as additional withholding for deducted-fee OTA',()=>{
    expect(()=>check({movements:[cash('separate_fee_paid',200,'2026-11-10','x')]}))
      .toThrow('fee_payment_conflicts_with_withholding_rule');
  });
  it('refuses a withheld commission larger than the post-refund payout',()=>{
    const fee={...withheld,commissionBps:10000,fixedMinor:100};
    expect(()=>check({rules:[fee]})).toThrow('fee_exceeds_collectible_payout');
  });
  it('reports missing taxes, PSP fees and Channel Manager inputs as explicit uncertainty',()=>{
    const p=check({channelManagerAllocatedMinor:0,expectedPayoutOn:null});
    expect(p.hasUnknownTaxOrProcessingCharges).toBe(true);
    expect(p.warnings).toContain('channel_manager_cost_may_be_unallocated');
    expect(p.warnings).toContain('taxes_merchant_processing_costs_not_modelled');
    expect(p.warnings).toContain('payout_schedule_not_provided');
  });
});
describe('OTA payout settlement edge cases and safe accounting boundaries', () => {
  it('balances separate provider adjustment credit/debit without inventing a second commission', () => {
    const movements = [
      cash('payout_received', 84_800, '2026-11-10', 'statement-original'),
      cash('payout_adjustment_credit', 2_700, '2026-11-12', 'statement-correction-credit'),
      cash('payout_adjustment_debit', 2_700, '2026-11-14', 'statement-correction-debit'),
    ];
    const position = check({ movements });
    expect(position.actualPayoutMinor).toBe(84_800);
    expect(position.cashDifferenceMinor).toBe(0);
    expect(position.otaCommissionMinor).toBe(15_200);
    expect(position.processedMovementCount).toBe(3);
  });
  it('does not count future bank clearing, even if a provider says payout was initiated', () => {
    const movements = [
      cash('payout_received', 84_800, '2026-11-22', 'pending-bank-clearance'),
    ];
    const today = check({ movements, asOfDate: '2026-11-21', expectedPayoutOn: '2026-11-20' });
    expect(today.payoutStatus).toBe('overdue');
    expect(today.actualPayoutMinor).toBe(0);
    expect(today.ignoredFutureMovementIds).toEqual(['pending-bank-clearance']);
    const posted = check({ movements, asOfDate: '2026-11-22', expectedPayoutOn: '2026-11-20' });
    expect(posted.payoutStatus).toBe('settled');
    expect(posted.cashDifferenceMinor).toBe(0);
  });
  it('refuses to attribute bank movements to a different reservation of the same property', () => {
    expect(() => check({ movements: [
      { ...cash('payout_received', 84_800, '2026-11-10', 'wrong-booking'), bookingId:'booking-2' },
    ] })).toThrow('cash_event_scope_mismatch');
  });
  it('treats the provider fee contract end date as inclusive, without overlapping a later version', () => {
    const old = { ...withheld, validTo: '2026-11-01' };
    const newVersion = { ...withheld, ruleId:'ota-a-next',validFrom:'2026-11-02',
      commissionBps: 1750 };
    expect(chooseFeeRule(snapshot, [newVersion, old]).ruleId).toBe('ota-a-2026');
    expect(check({ rules: [newVersion, old] }).otaCommissionMinor).toBe(15_200);
  });
});

const invoice: InvoiceAllocation = {
  invoiceId:'cm-inv-1',accountId:'tenant-1',propertyId:'property-1',
  currency:'RUB',invoiceOn:'2026-11-10',periodFrom:'2026-11-01',periodTo:'2026-11-30',
  costMinor:1001,basis:'equal_booking',
};
describe('Channel Manager subscription allocation v1',()=>{
  it('allocates every kopeck and deterministically distributes rounding remainders',()=>{
    const result=allocateChannelManagerInvoice(invoice,[
      {bookingId:'booking-c',weight:1},{bookingId:'booking-a',weight:1},
      {bookingId:'booking-b',weight:1},
    ]);
    expect(result.allocatedMinor).toBe(1001);
    expect(result.perBooking).toEqual([
      {bookingId:'booking-a',amountMinor:334},
      {bookingId:'booking-b',amountMinor:334},
      {bookingId:'booking-c',amountMinor:333},
    ]);
  });
  it('supports occupied-night weighting',()=>{
    const r=allocateChannelManagerInvoice({...invoice,costMinor:900,basis:'occupied_nights'},[
      {bookingId:'a',weight:2},{bookingId:'b',weight:1},
    ]);
    expect(r.perBooking).toEqual([
      {bookingId:'a',amountMinor:600},{bookingId:'b',amountMinor:300},
    ]);
  });
  it('supports gross revenue weighting rather than treating all bookings as equal',()=>{
    const r=allocateChannelManagerInvoice({...invoice,costMinor:300,basis:'booking_gross'},[
      {bookingId:'a',weight:10000},{bookingId:'b',weight:20000},
    ]);
    expect(r.perBooking).toEqual([
      {bookingId:'a',amountMinor:100},{bookingId:'b',amountMinor:200},
    ]);
  });
  it('leaves invoice unallocated when no bookings were eligible, rather than hiding the cost',()=>{
    const r=allocateChannelManagerInvoice(invoice,[]);
    expect(r.unallocatedMinor).toBe(1001);
    expect(r.allocatedMinor).toBe(0);
  });
  it('rejects duplicate allocation candidates and non-unit equal weights',()=>{
    expect(()=>allocateChannelManagerInvoice(invoice,[
      {bookingId:'a',weight:1},{bookingId:'a',weight:1},
    ])).toThrow('duplicate_allocation_booking');
    expect(()=>allocateChannelManagerInvoice(invoice,[{bookingId:'a',weight:3}]))
      .toThrow('equal_booking_weight_must_be_one');
  });
});
describe('Net pricing comparison without outbound price publication',()=>{
  it('shows high commission OTA can yield less money despite the same gross booking',()=>{
    const a=projectChannelNet({snapshot,rules:[withheld],proposedGrossMinor:100000,
      channelManagerAllocatedMinor:1000});
    const b=projectChannelNet({snapshot:{...snapshot,provider:'ota-b'},rules:[separate],
      proposedGrossMinor:100000,channelManagerAllocatedMinor:1000});
    expect(a.expectedNetMinor).toBe(83800);
    expect(b.expectedNetMinor).toBe(76400);
    expect(a.expectedNetMinor).toBeGreaterThan(b.expectedNetMinor);
  });
  it('never projects a refund greater than proposed gross income',()=>{
    expect(()=>projectChannelNet({snapshot:{...snapshot,refundedMinor:15000},rules:[withheld],
      proposedGrossMinor:10000,channelManagerAllocatedMinor:0}))
      .toThrow('refund_exceeds_projected_gross');
  });
});
