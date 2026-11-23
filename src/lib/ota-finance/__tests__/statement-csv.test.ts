import { describe, expect, it } from 'vitest';
import { parseOtaCashCsv, OTA_CASH_CSV_HEADERS, OtaCashCsvError } from '../statement-csv';
import { reconcileOtaBooking, type BookingSnapshot, type FeeRule } from '../ledger';

const options = {
  accountId:'tenant-a',propertyId:'property-1',provider:'ota-a',
  currency:'RUB',statementId:'statement-2026-11',asOfDate:'2026-11-30',
};
const header=OTA_CASH_CSV_HEADERS.join(',');
const line=(args: Partial<Record<typeof OTA_CASH_CSV_HEADERS[number],string>>={})=>
  [
    args.account_id ?? options.accountId,
    args.property_id ?? options.propertyId,
    args.booking_id ?? 'booking-1',
    args.provider ?? options.provider,
    args.currency ?? options.currency,
    args.event_id ?? 'evt-1',
    args.kind ?? 'payout_received',
    args.amount_minor ?? '84800',
    args.settled_on ?? '2026-11-22',
  ].join(',');
const csv=(...lines:string[])=>header+'\n'+lines.join('\n')+'\n';
const fee:FeeRule={
  ruleId:'contract-a',provider:'ota-a',currency:'RUB',validFrom:'2026-01-01',validTo:null,
  commissionBps:1500,fixedMinor:200,base:'gross_less_refunds',
  collection:'withheld_from_payout',chargeOnCancellation:false,
};
const snapshot:BookingSnapshot={
  accountId:'tenant-a',propertyId:'property-1',bookingId:'booking-1',
  provider:'ota-a',currency:'RUB',
  bookedOn:'2026-11-01',revisionDate:'2026-11-21',
  status:'completed',grossMinor:100000,refundedMinor:0,
};
describe('OTA Finance normalized CSV ??? no side effects',()=>{
  it('imports an explicitly scoped, manually normalized cash row',()=>{
    const result=parseOtaCashCsv(csv(line()),options);
    expect(result.status).toBe('UNVERIFIED_OPERATOR_IMPORT');
    expect(result.provenance).toBe('OPERATOR_SUPPLIED_NORMALIZED_CSV');
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].amountMinor).toBe(84800);
    expect(result.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.notes).toContain('source_provenance_and_bank_clearance_not_verified');
  });
  it('reconciles a normalized line with expected cleared OTA cash without a DB write',()=>{
    const {rows}=parseOtaCashCsv(csv(line()),options);
    const position=reconcileOtaBooking({
      snapshot,rules:[fee],movements:rows,asOfDate:options.asOfDate,
      expectedPayoutOn:'2026-11-20',expectedFeeOn:null,channelManagerAllocatedMinor:500,
    });
    expect(position.otaCommissionMinor).toBe(15200);
    expect(position.actualPayoutMinor).toBe(84800);
    expect(position.expectedNetAfterCostsMinor).toBe(84300);
    expect(position.payoutStatus).toBe('settled');
    expect(position.hasUnknownTaxOrProcessingCharges).toBe(true);
  });
  it('accepts CRLF and UTF-8 BOM, preserving exact amount values',()=>{
    const text='\uFEFF'+csv(line({amount_minor:'0'})).replaceAll('\n','\r\n');
    expect(parseOtaCashCsv(text,options).rows[0].amountMinor).toBe(0);
  });
  it('accepts syntactically valid quoted fields with no ambiguous quote interpretation',()=>{
    const text=csv(line().replace('booking-1','"booking-1"'));
    expect(parseOtaCashCsv(text,options).rows[0].bookingId).toBe('booking-1');
  });
  it('deduplicates identical event identifiers before calculating cash totals',()=>{
    const result=parseOtaCashCsv(csv(line(),line()),options);
    expect(result.rowCount).toBe(1);
    expect(result.deduplicatedRowCount).toBe(1);
  });
  it('rejects a repeated identifier with a conflicting monetary value',()=>{
    expect(()=>parseOtaCashCsv(csv(line(),
      line({amount_minor:'84801'})),options)).toThrow('conflicting_statement_event_id');
  });
  it('rejects cross-account and cross-property data rather than silently reassigning it',()=>{
    for(const changed of [
      {account_id:'tenant-b'}, {property_id:'property-b'},
      {provider:'ota-b'}, {currency:'USD'},
    ]) {
      expect(()=>parseOtaCashCsv(csv(line(changed)),options))
        .toThrow('statement_scope_mismatch');
    }
  });
  it('refuses unknown extra columns, ensuring PII is not silently ingested',()=>{
    expect(()=>parseOtaCashCsv(header+',guest_email\n'+line()+',guest@example.com\n',options))
      .toThrow('csv_columns_not_normalized');
  });
  it('refuses missing fields rather than guessing the column position',()=>{
    expect(()=>parseOtaCashCsv(csv(line().replace(',84800,',',')),options))
      .toThrow('csv_wrong_number_of_columns');
  });
  it('refuses future cleared dates rather than claiming an OTA or bank payment succeeded',()=>{
    expect(()=>parseOtaCashCsv(csv(line({settled_on:'2026-12-01'})),options))
      .toThrow('bank_clearing_date_in_future');
  });
  it('rejects invented decimal money values, negatives and unsafe scientific notation',()=>{
    for(const amount_minor of ['84.80','-1','1e4','9999999999999','0001']) {
      expect(()=>parseOtaCashCsv(csv(line({amount_minor})),options))
        .toThrow(/invalid_minor_units|minor_units_exceed_safe_limit/);
    }
  });
  it('refuses unsupported kinds of transactions',()=>{
    expect(()=>parseOtaCashCsv(csv(line({kind:'automatic_bank_debit'})),options))
      .toThrow('unknown_cash_kind');
  });
  it('refuses a blank statement, even if the header exists',()=>{
    expect(()=>parseOtaCashCsv(header+'\n',options)).toThrow('empty_csv_statement');
  });
  it('does not allow a CSV record with embedded newlines or controls',()=>{
    expect(()=>parseOtaCashCsv(csv(line().replace('booking-1','"booking-\n1"')),options))
      .toThrow('csv_control_character_in_field');
  });
  it('rejects malformed quoted values without silently repairing evidence',()=>{
    expect(()=>parseOtaCashCsv(csv(line().replace('booking-1','"booking-1')),options))
      .toThrow('csv_unterminated_quote');
  });
  it('does not accept future as-of dates as corrupted calendars, or impossible leap dates',()=>{
    expect(()=>parseOtaCashCsv(csv(line({settled_on:'2026-02-30'})),options))
      .toThrow('invalid_settled_date');
    expect(()=>parseOtaCashCsv(csv(line()),{...options,asOfDate:'2026-11-31'}))
      .toThrow('invalid_settled_date');
  });
  it('refuses excessively large CSV payloads and more than 2000 rows',()=>{
    expect(()=>parseOtaCashCsv('x'.repeat(524289),options))
      .toThrow('csv_payload_too_large_or_invalid');
    const many=Array.from({length:2001},(_,i)=>line({event_id:'evt-'+i}));
    expect(()=>parseOtaCashCsv(csv(...many),options)).toThrow('too_many_csv_rows');
  });
  it('fails close on account identifiers or statement IDs containing unsafe characters',()=>{
    expect(()=>parseOtaCashCsv(csv(line()),{...options,statementId:'../../unsafe'}))
      .toThrow('invalid_import_identity');
  });
  it('preserves multiple bookings in the same scoped property but keeps their identities',()=>{
    const r=parseOtaCashCsv(csv(line({event_id:'evt-1'}),
      line({booking_id:'booking-2',event_id:'evt-2',amount_minor:'20000'})),options);
    expect(r.rows.map(x=>x.bookingId)).toEqual(['booking-1','booking-2']);
    expect(r.rows.map(x=>x.amountMinor)).toEqual([84800,20000]);
  });
});
