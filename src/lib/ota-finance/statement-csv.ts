/**
 * Normalized, operator-reviewed OTA cash statement CSV intake candidate.
 *
 * This is an offline parser, NOT an OTA/bank connector, clearing proof,
 * durable ledger, price publisher or accounting authority. Passing a CSV
 * around never validates the underlying source or whether money arrived.
 */
import { createHash } from 'node:crypto';
import type { CashMovement, CashKind } from './ledger';

export const OTA_CASH_CSV_HEADERS = [
  'account_id', 'property_id', 'booking_id', 'provider', 'currency',
  'event_id', 'kind', 'amount_minor', 'settled_on',
] as const;

export type OtaCashCsvOptions = Readonly<{
  accountId: string;
  propertyId: string;
  provider: string;
  currency: string;
  asOfDate: string;
  statementId: string;
}>;
export type CashCsvCandidate = Readonly<{
  status: 'UNVERIFIED_OPERATOR_IMPORT';
  provenance: 'OPERATOR_SUPPLIED_NORMALIZED_CSV';
  statementId: string;
  scope: Readonly<{ accountId: string; propertyId: string; provider: string; currency: string }>;
  asOfDate: string;
  fingerprintSha256: string;
  rowCount: number;
  deduplicatedRowCount: number;
  rows: readonly CashMovement[];
  notes: readonly string[];
}>;

export class OtaCashCsvError extends Error {
  constructor(readonly code: string, readonly rowNumber?: number) {
    super(code + (rowNumber == null ? '' : ':row_' + rowNumber));
    this.name = 'OtaCashCsvError';
  }
}
const MAX_BYTES = 512 * 1024;
const MAX_RECORDS = 2_000;
const KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;
const CUR = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^(?:0|[1-9][0-9]{0,12})$/;
const KIND = new Set<CashKind>([
  'payout_received', 'payout_adjustment_credit', 'payout_adjustment_debit',
  'refund_debit', 'separate_fee_paid',
]);
function demand(ok: boolean, code: string, rowNumber?: number): void {
  if (!ok) throw new OtaCashCsvError(code, rowNumber);
}
function checkDate(value: string, rowNumber?: number): void {
  demand(DATE.test(value), 'invalid_settled_date', rowNumber);
  const parsed = new Date(value + 'T00:00:00Z');
  demand(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value,
    'invalid_settled_date', rowNumber);
}
function csvRecords(input: string): string[][] {
  // Strict quoted CSV (RFC4180-style escaped double quotes).
  const rows: string[][] = [];
  let current: string[] = [], field = '', quoted = false, afterQuote = false;
  let recordStarted = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    demand(c !== '\0', 'csv_null_byte');
    if (quoted) {
      if (c === '"') {
        if (input[i+1] === '"') { field += '"'; i += 1; }
        else { quoted = false; afterQuote = true; }
      } else {
        field += c;
      }
      continue;
    }
    if (afterQuote) {
      if (c === ',') {
        current.push(field); field = ''; afterQuote = false; recordStarted = true;
      } else if (c === '\n' || c === '\r') {
        current.push(field); rows.push(current);
        current = []; field = ''; afterQuote = false; recordStarted = false;
        if (c === '\r' && input[i+1] === '\n') i += 1;
      } else {
        throw new OtaCashCsvError('csv_invalid_quoted_field');
      }
    } else if (c === '"') {
      demand(field.length === 0, 'csv_quote_in_unquoted_field');
      quoted = true; recordStarted = true;
    } else if (c === ',') {
      current.push(field); field = ''; recordStarted = true;
    } else if (c === '\n' || c === '\r') {
      current.push(field); rows.push(current);
      current = []; field = ''; recordStarted = false;
      if (c === '\r' && input[i+1] === '\n') i += 1;
    } else {
      field += c; recordStarted = true;
    }
    demand(rows.length <= MAX_RECORDS + 1, 'too_many_csv_rows');
  }
  demand(!quoted, 'csv_unterminated_quote');
  if (recordStarted || field !== '' || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  return rows;
}
/**
 * Parses a normalized statement (NOT a provider-specific raw file).
 * No account, property, provider or currency can be silently substituted.
 * Operator must verify the original statement before trusting its amounts.
 */
export function parseOtaCashCsv(input: string, opts: OtaCashCsvOptions): CashCsvCandidate {
  demand(typeof input === 'string' && Buffer.byteLength(input, 'utf8') <= MAX_BYTES,
    'csv_payload_too_large_or_invalid');
  for (const id of [opts.accountId, opts.propertyId, opts.provider, opts.statementId]) {
    demand(typeof id === 'string' && KEY.test(id), 'invalid_import_identity');
  }
  demand(CUR.test(opts.currency), 'invalid_import_currency');
  checkDate(opts.asOfDate);
  const raw = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const records = csvRecords(raw);
  demand(records.length > 1, 'empty_csv_statement');
  demand(records.length <= MAX_RECORDS + 1, 'too_many_csv_rows');
  demand(records[0].length === OTA_CASH_CSV_HEADERS.length &&
    OTA_CASH_CSV_HEADERS.every((key, idx) => records[0][idx] === key),
    'csv_columns_not_normalized');
  const rows: CashMovement[] = [];
  const seen = new Map<string,string>();
  let duplicates = 0;
  for (const [index, cells] of records.slice(1).entries()) {
    const rowNumber = index + 2;
    demand(cells.length === OTA_CASH_CSV_HEADERS.length,
      'csv_wrong_number_of_columns', rowNumber);
    demand(cells.every((v) => !/[\r\n\x00-\x1f\x7f]/.test(v)),
      'csv_control_character_in_field', rowNumber);
    const [
      accountId, propertyId, bookingId, provider, currency, eventId,
      kind, amountRaw, settledOn,
    ] = cells;
    demand(accountId === opts.accountId && propertyId === opts.propertyId &&
      provider === opts.provider && currency === opts.currency,
    'statement_scope_mismatch', rowNumber);
    demand(KEY.test(bookingId) && KEY.test(eventId), 'invalid_statement_id', rowNumber);
    demand(KIND.has(kind as CashKind), 'unknown_cash_kind', rowNumber);
    demand(MONEY.test(amountRaw), 'invalid_minor_units', rowNumber);
    const amountMinor = Number(amountRaw);
    demand(Number.isSafeInteger(amountMinor) && amountMinor <= 1_000_000_000_000,
      'minor_units_exceed_safe_limit', rowNumber);
    checkDate(settledOn, rowNumber);
    demand(settledOn <= opts.asOfDate, 'bank_clearing_date_in_future', rowNumber);
    const fingerprint = JSON.stringify(cells);
    const prior = seen.get(eventId);
    demand(prior == null || prior === fingerprint,
      'conflicting_statement_event_id', rowNumber);
    if (prior != null) { duplicates += 1; continue; }
    seen.set(eventId, fingerprint);
    rows.push({
      accountId, propertyId, bookingId, provider, currency,
      eventId, kind: kind as CashKind, amountMinor, settledOn,
    });
  }
  demand(rows.length > 0, 'empty_csv_statement');
  const digest = createHash('sha256').update(input, 'utf8').digest('hex');
  return Object.freeze({
    status:'UNVERIFIED_OPERATOR_IMPORT',
    provenance:'OPERATOR_SUPPLIED_NORMALIZED_CSV',
    statementId:opts.statementId,
    scope: { accountId:opts.accountId, propertyId:opts.propertyId,
      provider:opts.provider, currency:opts.currency },
    asOfDate:opts.asOfDate,
    fingerprintSha256:digest,
    rowCount:rows.length,
    deduplicatedRowCount:duplicates,
    rows,
    notes:[
      'source_provenance_and_bank_clearance_not_verified',
      'not_a_provider_raw_csv_importer',
      'no_database_writes_or_external_calls',
    ],
  });
}
