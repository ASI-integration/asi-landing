import {describe,it,expect} from 'vitest';
import {
 minor677,selectContractRule677,computeBookingSettlement677,contractDraft677,
 resolveDeposit677,makeBalancedJournal677,reverseJournal677,reconcileThreeWay677,sha677,
 type ContractRule677,type Journal677,type BankLine677,
} from '../reconciliation-deposits-677';

const rule=(version:string,start:string,end:string|null):ContractRule677=>({
 version,validFrom:start,validUntil:end,currency:'RUB',
 commissionBasisPoints:1000,taxBasisPoints:500,ownerShareBasisPoints:7000,
 paymentModel:'OTA_COLLECT',
});
const rules=[rule('v1','2026-01-01','2026-11-19'),rule('v2','2026-11-19',null)];
const input={rules,stayDay:'2026-11-19',accountId:'synthetic_account',bookingId:'synthetic_booking',gross:BigInt('10001'),deposit:BigInt('3000')};
const expected=computeBookingSettlement677(input);
const evidence=sha677('synthetic bank proof');
const statement=(id:string,amountMinor:string,status:'posted'|'pending'|'reversed'='posted',flow:'guest_receipt'|'owner_payout'='guest_receipt'):BankLine677=>({
 statementId:'test-bank-statement',providerId:'test-acquirer',transactionId:id,
 accountId:input.accountId,bookingId:input.bookingId,flow,postedAt:'2026-11-20T12:00:00Z',currency:'RUB',
 amountMinor,status,evidenceHash:evidence,
});
describe('#677 money and contract versions',()=>{
 it('never stores minor currency units in binary float; rejects decimals and overflow',()=>{
  expect(minor677('10001')).toBe(BigInt('10001'));
  expect(minor677('-900')).toBe(-BigInt('900'));
  expect(()=>minor677('0.01')).toThrow('invalid_minor');
  expect(()=>minor677('9000000000000000001')).toThrow('minor_overflow');
 });
 it('contract validity uses exclusive date boundary and disallows invented fees',()=>{
  expect(selectContractRule677(rules,'2026-11-18').version).toBe('v1');
  expect(selectContractRule677(rules,'2026-11-19').version).toBe('v2');
  expect(()=>selectContractRule677([rule('overlap','2026-11-18',null),...rules],'2026-11-19')).toThrow('overlapping');
  expect(()=>computeBookingSettlement677({...input,rules:[{...rules[1],taxBasisPoints:null}]})).toThrow('unknown_rate');
 });
 it('rounds basis points in whole kopecks half-even and keeps expected vs owner accrued',()=>{
  expect(expected.expectedGrossMinor).toBe(BigInt('10001'));
  expect(expected.commissionMinor).toBe(BigInt('1000'));
  expect(expected.taxMinor).toBe(BigInt('500'));
  expect(expected.expectedBankMinor).toBe(BigInt('8501'));
  expect(expected.expectedOwnerMinor).toBe(BigInt('5951'));
  expect(expected.contractVersion).toBe('v2');
 });
 it('contract draft is reproducible and NEVER treated as signed',()=>{
  const c=contractDraft677({bookingId:'A',version:'v2',terms:'This is a synthetic contract draft for testing only',
   evidence:'synthetic owner consent not yet signed'});
  expect(c).toMatchObject({version:'v2',state:'draft',requiresHumanSignature:true});
  expect(c.termsHash).toHaveLength(64);
  expect(()=>contractDraft677({bookingId:'A',version:'v2',terms:'too short',evidence:'sample evidence'})).toThrow();
 });
});
describe('#677 escrow deposit no-charge and bank proof',()=>{
 const bank=(id:string,state:'received_bank_verified'|'retained_partially'|'retained_fully'|'refunded_bank_verified',amountMinor:string)=>({
  id,state,amountMinor,providerReference:'synthetic-statement',bankEvidenceHash:evidence,journalId:'synthetic-journal-'+id,reversalOf:null,
 });
 it('request is no-charge and proof is mandatory for received',()=>{
  const d=resolveDeposit677(BigInt('3000'),[{id:'r',state:'requested_no_charge',amountMinor:'3000',providerReference:null,bankEvidenceHash:null,journalId:null,reversalOf:null}]);
  expect(d).toMatchObject({state:'requested_no_charge',received:BigInt('0'),outstanding:BigInt('0')});
  expect(()=>resolveDeposit677(BigInt('3000'),[{...bank('p','received_bank_verified','3000'),bankEvidenceHash:null}])).toThrow('bank_proof');
 });
 it('received -> partial retention -> refund produces zero remaining escrow',()=>{
  const d=resolveDeposit677(BigInt('3000'),[bank('a','received_bank_verified','3000'),bank('b','retained_partially','900'),bank('c','refunded_bank_verified','2100')]);
  expect(d).toMatchObject({state:'refunded_bank_verified',received:BigInt('3000'),retained:BigInt('900'),refunded:BigInt('2100'),outstanding:BigInt('0')});
 });
 it('cannot retain more than received, over-receive, duplicate or claim full on partial',()=>{
  expect(()=>resolveDeposit677(BigInt('100'),[bank('a','received_bank_verified','100'),bank('b','retained_partially','100')])).toThrow('partial_invariant');
  expect(()=>resolveDeposit677(BigInt('100'),[bank('a','received_bank_verified','101')])).toThrow('overallocation');
  expect(()=>resolveDeposit677(BigInt('100'),[bank('a','received_bank_verified','100'),bank('a','refunded_bank_verified','100')])).toThrow('duplicate_event');
 });
});
describe('#677 immutable journals and three-sided settlement',()=>{
 const journal:Journal677={id:'j1',accountId:'tenant',bookingId:'booking',currency:'RUB',
  period:'2026-11',reference:'synthetic:statement:1',sourceHash:evidence,
  entries:[{account:'bank_clearing',debit:BigInt('8501'),credit:BigInt('0')},{account:'guest_receivable',debit:BigInt('0'),credit:BigInt('8501')}]};
 it('requires double-entry balancing and reversible equal-opposite postings',()=>{
  expect(makeBalancedJournal677(journal).id).toBe('j1');
  const r=reverseJournal677(journal,'j2');
  expect(r.reversalOf).toBe('j1');
  expect(r.entries).toEqual([{account:'bank_clearing',debit:BigInt('0'),credit:BigInt('8501')},
   {account:'guest_receivable',debit:BigInt('8501'),credit:BigInt('0')}]);
  expect(()=>makeBalancedJournal677({...journal,entries:[...journal.entries,{account:'owner_payable',debit:BigInt('1'),credit:BigInt('0')}]})).toThrow('unbalanced');
 });
 it('complete bank proof + owner-paid amount yields matched',()=>{
  expect(reconcileThreeWay677(expected,[statement('bank1','8501')],[statement('owner1','5951','posted','owner_payout')],false))
   .toMatchObject({status:'matched',differenceMinor:BigInt('0'),ownerOutstandingMinor:BigInt('0'),manualQueue:[]});
 });
 it('deduplicates replayed bank lines, flags partial/late/unmatched and unpaid owner',()=>{
  const partial=reconcileThreeWay677(expected,[statement('bank1','4000'),statement('bank1','4000')],[],false);
  expect(partial).toMatchObject({status:'partial',bankMatchedMinor:BigInt('4000'),differenceMinor:BigInt('4501'),ownerOutstandingMinor:BigInt('5951')});
  expect(partial.manualQueue).toContain('BANK_EXPECTED_MISMATCH');
  const unmatched=reconcileThreeWay677(expected,[statement('pending','8501','pending')],[],false);
  expect(unmatched.status).toBe('unmatched');
  expect(unmatched.manualQueue[0]).toContain('BANK_NOT_POSTED');
 });
 it('closed period differences require manual reversal instead of retroactive edit',()=>{
  const closed=reconcileThreeWay677(expected,[],[],true);
  expect(closed.status).toBe('closed_period_review');
  expect(closed.manualQueue).toContain('CLOSED_PERIOD_REVERSAL_ONLY');
 });
 it('bank evidence, currency/tenant separation and owner overpayment cannot be hidden',()=>{
  expect(()=>reconcileThreeWay677(expected,[{...statement('a','100'),currency:'USD' as 'RUB'}],[],false)).toThrow('bank_tenant_or_currency_mismatch');
  expect(()=>reconcileThreeWay677(expected,[{...statement('a','100'),evidenceHash:''}],[],false)).toThrow('bank_evidence_required');
  expect(reconcileThreeWay677(expected,[statement('bank1','8501')],[statement('overpaid','5952','posted','owner_payout')],false).manualQueue).toContain('OWNER_OVERPAID');
  expect(()=>reconcileThreeWay677(expected,[{...statement('alien','8501'),accountId:'other-tenant'}],[],false)).toThrow('bank_tenant_or_currency_mismatch');
  expect(()=>reconcileThreeWay677(expected,[statement('wrong-flow','8501','posted','owner_payout')],[],false)).toThrow('bank_receipt_direction_mismatch');
  expect(()=>reconcileThreeWay677(expected,[statement('bank1','8501')],[statement('outbound-missing','5951')],false)).toThrow('owner_payout_direction_mismatch');
 });
});
