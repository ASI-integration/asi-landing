import 'server-only';

import { requireOtaFinanceScope, type OtaFinanceScopeRequest } from './access';

/**
 * Source-only, read-only SQL adapter. A trusted Node server must inject a
 * PostgreSQL client with SELECT rights to ota_finance_private; no database URL,
 * pool, HTTP route, or write path is created here. The private schema is NOT
 * exposed through Supabase's Data API.
 */
export interface FinancePrivateSqlReader {
  query<Row extends Record<string, unknown>>(
    statement: string,
    params: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export type FinanceReadScope = Pick<OtaFinanceScopeRequest, 'accountId' | 'propertyId'>;
export type UnverifiedStatement = Readonly<{
  id: string;
  account_id: string;
  property_id: string;
  provider: string;
  currency: string;
  statement_external_id: string;
  source_sha256: string;
  source_status: 'UNVERIFIED_OPERATOR_IMPORT';
  as_of_date: string;
  imported_at: string;
}>;
export type UnverifiedCashEvent = Readonly<{
  id: string;
  account_id: string;
  property_id: string;
  booking_id: string;
  statement_import_id: string;
  provider: string;
  currency: string;
  external_event_id: string;
  kind: string;
  amount_minor: string;
  source_status: 'UNVERIFIED_OPERATOR_IMPORT';
  claimed_settled_on: string;
  recorded_at: string;
}>;
export type FinanceFeeRule = Readonly<{
  id: string;
  account_id: string;
  property_id: string;
  provider: string;
  currency: string;
  contract_key: string;
  version: number;
  effective_from: string;
  effective_through: string | null;
  commission_bps: number;
  fixed_minor: string;
  fee_base: string;
  collection_method: string;
  charge_on_cancellation: boolean;
  source_digest_sha256: string;
}>;

const STATEMENTS = `select
  id, account_id, property_id, provider, currency, statement_external_id,
  source_sha256, source_status, as_of_date::text as as_of_date,
  imported_at::text as imported_at
from ota_finance_private.statement_imports
where account_id = $1::uuid and property_id = $2::uuid
order by imported_at desc, id desc
limit $3::integer`;

const CASH_EVENTS = `select
  id, account_id, property_id, booking_id, statement_import_id,
  provider, currency, external_event_id, kind,
  amount_minor::text as amount_minor, source_status,
  claimed_settled_on::text as claimed_settled_on,
  recorded_at::text as recorded_at
from ota_finance_private.cash_events
where account_id = $1::uuid and property_id = $2::uuid
  and booking_id = $3::text
order by recorded_at desc, id desc
limit $4::integer`;

const FEE_RULES = `select
  id, account_id, property_id, provider, currency, contract_key, version,
  effective_from::text as effective_from,
  effective_through::text as effective_through,
  commission_bps, fixed_minor::text as fixed_minor,
  fee_base, collection_method, charge_on_cancellation, source_digest_sha256
from ota_finance_private.fee_rule_versions
where account_id = $1::uuid and property_id = $2::uuid
order by effective_from desc, id desc
limit $3::integer`;

function limitForRead(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('FINANCE_INVALID_PAGE_LIMIT');
  }
  return value;
}

function verifyScoped<Row extends { account_id: string; property_id: string }>(
  rows: Row[],
  scope: FinanceReadScope,
): Row[] {
  if (!Array.isArray(rows) || rows.some(row =>
    !row || row.account_id !== scope.accountId || row.property_id !== scope.propertyId
  )) throw new Error('FINANCE_DATABASE_SCOPE_MISMATCH');
  return rows;
}

/** This does NOT authenticate source statements or bank settlement. */
export async function listUnverifiedStatements(
  database: FinancePrivateSqlReader,
  scope: FinanceReadScope,
  limit?: number,
): Promise<UnverifiedStatement[]> {
  const authorized = await requireOtaFinanceScope({ ...scope, action: 'read' });
  const max = limitForRead(limit);
  const result = await database.query<UnverifiedStatement>(
    STATEMENTS, [authorized.accountId, authorized.propertyId, max],
  );
  const rows = verifyScoped(result.rows, authorized);
  if (rows.some(row => row.source_status !== 'UNVERIFIED_OPERATOR_IMPORT'))
    throw new Error('FINANCE_UNEXPECTED_SOURCE_STATUS');
  return rows;
}

/** Must validate the booking within the tenant before reading any cash claims. */
export async function listUnverifiedBookingCashEvents(
  database: FinancePrivateSqlReader,
  scope: FinanceReadScope & { bookingId: string },
  limit?: number,
): Promise<UnverifiedCashEvent[]> {
  const authorized = await requireOtaFinanceScope({ ...scope, action: 'read' });
  const max = limitForRead(limit);
  const result = await database.query<UnverifiedCashEvent>(
    CASH_EVENTS, [authorized.accountId, authorized.propertyId, scope.bookingId, max],
  );
  const rows = verifyScoped(result.rows, authorized);
  if (rows.some(row => row.booking_id !== scope.bookingId ||
    row.source_status !== 'UNVERIFIED_OPERATOR_IMPORT'
  )) throw new Error('FINANCE_CASH_SCOPE_OR_PROVENANCE_MISMATCH');
  return rows;
}

/** Contract rules are historical versions, never mutable current balances. */
export async function listFinanceFeeRules(
  database: FinancePrivateSqlReader,
  scope: FinanceReadScope,
  limit?: number,
): Promise<FinanceFeeRule[]> {
  const authorized = await requireOtaFinanceScope({ ...scope, action: 'read' });
  const max = limitForRead(limit);
  const result = await database.query<FinanceFeeRule>(
    FEE_RULES, [authorized.accountId, authorized.propertyId, max],
  );
  return verifyScoped(result.rows, authorized);
}
