/**
 * P0 #677 — source-only, no-charge, no-send financial reconciliation core.
 * Every monetary value remains a bigint in minor currency units. No invented
 * tax/commission defaults; missing or overlapping contract rule blocks math.
 * This module never calls a payment provider, signs a contract or releases funds.
 */
import {createHash} from 'node:crypto';

export type MinorAmount677=bigint;
export type DepositState677='not_requested'|'requested_no_charge'|'received_bank_verified'
 |'retained_partially'|'retained_fully'|'refunded_bank_verified'|'disputed';
export type ContractState677='draft'|'sent_no_send'|'signed_verified'|'expired'|'blocked';
export type LedgerAccount677='bank_clearing'|'guest_receivable'|'provider_fee_expense'
 |'owner_payable'|'owner_paid'|'deposit_liability'|'deposit_retained_revenue'
 |'payout_clearing'|'reconciliation_suspense';
export type Entry677={account:LedgerAccount677;debit:MinorAmount677;credit:MinorAmount677};
export type Journal677={id:string;accountId:string;bookingId:string;currency:'RUB';
 period:string;reference:string;entries:readonly Entry677[];sourceHash:string;reversalOf?:string};
export type ContractRule677={
 version:string;validFrom:string;validUntil:string|null;
 currency:'RUB';commissionBasisPoints:number|null;taxBasisPoints:number|null;
 ownerShareBasisPoints:number|null; paymentModel:'OTA_COLLECT'|'DIRECT_COLLECT'|null;
};
export type ContractDraft677={
 bookingId:string;version:string;state:ContractState677;termsHash:string;
 evidenceHash:string;requiresHumanSignature:true;
};
export type BankLine677={
 statementId:string;providerId:string;transactionId:string;accountId:string;bookingId:string;
 flow:'guest_receipt'|'owner_payout';
 postedAt:string;currency:'RUB';amountMinor:string;status:'posted'|'pending'|'reversed';
 evidenceHash:string;
};
export type BookingExpected677={
 accountId:string;bookingId:string;currency:'RUB';contractVersion:string;
 expectedGrossMinor:bigint;depositMinor:bigint;
 expectedOwnerMinor:bigint;expectedBankMinor:bigint;
};

const money=/^-?(0|[1-9]\d{0,18})$/;
const max=BigInt('9000000000000000000');
export function minor677(input:string|bigint):bigint{
 const x=typeof input==='bigint'?input:(money.test(input)?BigInt(input):(()=>{throw Error('invalid_minor_amount')})());
 if(x < -max || x>max)throw Error('minor_overflow');
 return x;
}
export function requirePositive677(v:bigint):bigint {if(v<BigInt('0'))throw Error('negative_minor_denied');return minor677(v);}
export function sha677(value:string):string{return createHash('sha256').update(value,'utf8').digest('hex');}
function validDay(day:string):boolean{return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day+'T00:00:00Z')) && new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;}
function isRate(n:number|null):n is number{return n!==null && Number.isInteger(n)&&n>=0&&n<=10000;}
export function selectContractRule677(rules:readonly ContractRule677[],stayDay:string):ContractRule677{
 if(!validDay(stayDay))throw Error('invalid_stay_day');
 const active=rules.filter(r=>validDay(r.validFrom) && r.validFrom<=stayDay && (!r.validUntil || validDay(r.validUntil)&&stayDay<r.validUntil));
 if(active.length!==1)throw Error('contract_rule_missing_or_overlapping');
 const r=active[0];
 if(!r.version.trim()||!isRate(r.commissionBasisPoints)||!isRate(r.taxBasisPoints)||
    !isRate(r.ownerShareBasisPoints)||!r.paymentModel)throw Error('contract_rule_unknown_rate');
 return r;
}
function basisPointRoundHalfEven(amount:bigint,bps:number):bigint{
 const n=requirePositive677(amount)*BigInt(bps);
 const q=n/BigInt('10000'),rem=n%BigInt('10000');
 return rem>BigInt('5000') || (rem===BigInt('5000') && q%BigInt('2')===BigInt('1'))?q+BigInt('1'):q;
}
export function computeBookingSettlement677(input:{
 rules:readonly ContractRule677[];stayDay:string;accountId:string;bookingId:string;
 gross:bigint;deposit:bigint;
}):BookingExpected677 & {commissionMinor:bigint;taxMinor:bigint}{
 const r=selectContractRule677(input.rules,input.stayDay);
 const gross=requirePositive677(input.gross),deposit=requirePositive677(input.deposit);
 const commission=basisPointRoundHalfEven(gross,r.commissionBasisPoints!);
 const tax=basisPointRoundHalfEven(gross,r.taxBasisPoints!);
 const net=gross-commission-tax;
 if(net<BigInt('0'))throw Error('invalid_contract_deductions');
 const owner=basisPointRoundHalfEven(net,r.ownerShareBasisPoints!);
 if(owner>net)throw Error('owner_overallocation');
 const expectedBank=r.paymentModel==='OTA_COLLECT'?net: gross;
 return {accountId:input.accountId,bookingId:input.bookingId,currency:r.currency,contractVersion:r.version,
  expectedGrossMinor:gross,depositMinor:deposit,expectedBankMinor:expectedBank,
  expectedOwnerMinor:owner,commissionMinor:commission,taxMinor:tax};
}
export function contractDraft677(input:{
 bookingId:string;version:string;terms:string;evidence:string;state?:ContractState677;
}):ContractDraft677{
 if(!input.bookingId||!input.version||input.terms.length<20||input.evidence.length<10)throw Error('contract_draft_incomplete');
 // Hash of actual agreed, versioned text, no auto-sign or MVD send.
 return {bookingId:input.bookingId,version:input.version,state:input.state??'draft',
  termsHash:sha677(input.version+'\n'+input.terms),evidenceHash:sha677(input.evidence),requiresHumanSignature:true};
}
export type DepositEvent677={id:string;state:DepositState677;amountMinor:string;providerReference:string|null;
 bankEvidenceHash:string|null;journalId:string|null;reversalOf:string|null};
export function resolveDeposit677(expected:bigint,events:readonly DepositEvent677[]):{
 state:DepositState677;received:bigint;retained:bigint;refunded:bigint;outstanding:bigint;
}{
 expected=requirePositive677(expected);
 let received=BigInt('0'),retained=BigInt('0'),refunded=BigInt('0'),state:DepositState677='not_requested';
 const ids=new Set<string>();
 for(const e of events){
  if(!e.id||ids.has(e.id))throw Error('deposit_duplicate_event');
  ids.add(e.id);
  const v=requirePositive677(minor677(e.amountMinor));
  if(e.state==='requested_no_charge'){
   if(v!==expected||received!==BigInt('0'))throw Error('deposit_request_invalid');
  }else if(e.state==='received_bank_verified'){
   if(!e.bankEvidenceHash || !e.providerReference || !e.journalId || !/^[a-f0-9]{64}$/.test(e.bankEvidenceHash))throw Error('deposit_bank_proof_required');
   received+=v;
  }else if(e.state==='retained_partially'||e.state==='retained_fully'){
   if(!e.bankEvidenceHash||!e.providerReference||!e.journalId)throw Error('deposit_retention_journal_and_bank_proof_required');
   retained+=v;
   if(e.state==='retained_partially'&&retained>=received)throw Error('deposit_partial_invariant');
   if(e.state==='retained_fully'&&retained!==received)throw Error('deposit_full_invariant');
  }else if(e.state==='refunded_bank_verified'){
   if(!e.bankEvidenceHash||!e.providerReference||!e.journalId)throw Error('deposit_refund_journal_and_bank_proof_required');
   refunded+=v;
  }else if(e.state==='disputed'){
   if(!e.providerReference)throw Error('deposit_dispute_evidence_required');
  }else if(e.state!=='not_requested')throw Error('deposit_state_invalid');
  if(received>expected || retained+refunded>received)throw Error('deposit_overallocation');
  state=e.state;
 }
 return {state,received,retained,refunded,outstanding:received-retained-refunded};
}
export function makeBalancedJournal677(j:Journal677):Journal677{
 if(j.entries.length<2 || !j.id || !j.accountId || !j.bookingId || !j.reference ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(j.period) || !/^[a-f0-9]{64}$/.test(j.sourceHash))throw Error('journal_invalid');
 let debit=BigInt('0'),credit=BigInt('0');
 for(const e of j.entries){
  requirePositive677(e.debit);requirePositive677(e.credit);
  if((e.debit===BigInt('0'))===(e.credit===BigInt('0')))throw Error('journal_zero_or_double_sided');
  debit+=e.debit;credit+=e.credit;
 }
 if(debit!==credit)throw Error('journal_unbalanced');
 return j;
}
export function reverseJournal677(source:Journal677,newId:string):Journal677{
 const reversed={...source,id:newId,reference:'reversal:'+source.reference,sourceHash:sha677('reversal:'+source.id),
  reversalOf:source.id,entries:source.entries.map(e=>({...e,debit:e.credit,credit:e.debit}))};
 return makeBalancedJournal677(reversed);
}
export function reconcileThreeWay677(expected:BookingExpected677,lines:readonly BankLine677[],
 ownerPayoutBankLines:readonly BankLine677[],periodClosed:boolean):{
 status:'matched'|'partial'|'unmatched'|'overpaid'|'manual_review'|'closed_period_review';
 expectedBankMinor:bigint;bankMatchedMinor:bigint;ownerOwedMinor:bigint;ownerPaidMinor:bigint;
 ownerOutstandingMinor:bigint;differenceMinor:bigint;manualQueue:readonly string[];
}{
 const seen=new Set<string>();let bank=BigInt('0');const queue:string[]=[];
 for(const line of lines){
  if(line.accountId!==expected.accountId||line.bookingId!==expected.bookingId||line.currency!==expected.currency)throw Error('bank_tenant_or_currency_mismatch');
  if(line.flow!=='guest_receipt')throw Error('bank_receipt_direction_mismatch');
  if(!line.statementId||!line.providerId||!line.transactionId||!line.evidenceHash.match(/^[a-f0-9]{64}$/))throw Error('bank_evidence_required');
  const key=line.providerId+':'+line.statementId+':'+line.transactionId;
  if(seen.has(key))continue;seen.add(key);
  if(line.status!=='posted'){queue.push('BANK_NOT_POSTED:'+line.transactionId);continue;}
  bank+=minor677(line.amountMinor);
 }
 let ownerPaid=BigInt('0');
 const seenPayout=new Set<string>();
 for(const payout of ownerPayoutBankLines){
  if(payout.accountId!==expected.accountId||payout.bookingId!==expected.bookingId||payout.currency!==expected.currency)throw Error('owner_payout_scope_mismatch');
  if(payout.flow!=='owner_payout')throw Error('owner_payout_direction_mismatch');
  if(!payout.providerId||!payout.statementId||!payout.transactionId||
    !/^[a-f0-9]{64}$/.test(payout.evidenceHash))throw Error('owner_payout_bank_evidence_required');
  const key=payout.providerId+':'+payout.statementId+':'+payout.transactionId;
  if(seenPayout.has(key))continue;
  seenPayout.add(key);
  if(payout.status!=='posted'){queue.push('OWNER_PAYOUT_NOT_POSTED:'+payout.transactionId);continue;}
  ownerPaid+=requirePositive677(minor677(payout.amountMinor));
 }
 const owed=requirePositive677(expected.expectedOwnerMinor);
 if(ownerPaid>owed)queue.push('OWNER_OVERPAID');
 if(bank<BigInt('0'))queue.push('BANK_REVERSAL_REVIEW');
 const diff=expected.expectedBankMinor-bank;
 if(diff!==BigInt('0'))queue.push('BANK_EXPECTED_MISMATCH');
 if(ownerPaid<owed)queue.push('OWNER_PAYOUT_OUTSTANDING');
 if(periodClosed && diff!==BigInt('0'))queue.push('CLOSED_PERIOD_REVERSAL_ONLY');
 const status=periodClosed&&diff!==BigInt('0')?'closed_period_review':
  bank===BigInt('0')?'unmatched':bank<expected.expectedBankMinor?'partial':
  bank>expected.expectedBankMinor?'overpaid':
  ownerPaid===owed?'matched':'manual_review';
 return {status,expectedBankMinor:expected.expectedBankMinor,bankMatchedMinor:bank,ownerOwedMinor:owed,
  ownerPaidMinor:ownerPaid,ownerOutstandingMinor:owed-ownerPaid,
  differenceMinor:diff,manualQueue:queue};
}
