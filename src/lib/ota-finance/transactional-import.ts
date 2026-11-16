import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { requireOtaFinanceScope } from './access';

type SqlRow = Record<string, unknown>;
export interface FinanceTransactionClient {
  query<Row extends SqlRow>(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>;
  release(): void;
}
export interface FinanceTransactionPool {
  connect(): Promise<FinanceTransactionClient>;
}

export type UnverifiedCashInput = Readonly<{
  bookingId: string;
  externalEventId: string;
  kind: 'payout_received' | 'payout_adjustment_credit' | 'payout_adjustment_debit'
    | 'refund_debit' | 'separate_fee_paid';
  amountMinor: string;
  claimedSettledOn: string;
}>;

export type UnverifiedStatementInput = Readonly<{
  accountId: string;
  propertyId: string;
  provider: string;
  currency: string;
  statementExternalId: string;
  sourceSha256: string;
  asOfDate: string;
  events: readonly UnverifiedCashInput[];
}>;

export type UnverifiedImportReceipt = Readonly<{
  statementId: string;
  auditId: string;
  operationId: string;
  eventCount: number;
  status: 'COMMITTED_UNVERIFIED';
}>;

export class FinanceImportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FinanceImportError';
  }
}

const sha256 = /^[0-9a-f]{64}$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
const currency = /^[A-Z]{3}$/;
const decimal = /^(0|[1-9][0-9]{0,12})$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const eventKinds = new Set([
  'payout_received', 'payout_adjustment_credit', 'payout_adjustment_debit',
  'refund_debit', 'separate_fee_paid',
]);

function validDate(value: string): boolean {
  if (typeof value !== 'string' || !date.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function checkedLabel(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length >= 1 && value.length <= max && value.trim() === value;
}

function validate(input: UnverifiedStatementInput): void {
  if (!input || typeof input !== 'object' || !uuid.test(input.accountId)
      || !uuid.test(input.propertyId)
      || !checkedLabel(input.provider, 100) || !currency.test(input.currency)
      || !checkedLabel(input.statementExternalId, 200)
      || !sha256.test(input.sourceSha256) || !validDate(input.asOfDate)
      || !Array.isArray(input.events) || input.events.length < 1 || input.events.length > 50) {
    throw new FinanceImportError('FINANCE_IMPORT_INVALID_STATEMENT');
  }
  const seen = new Set<string>();
  for (const row of input.events) {
    if (!row || !checkedLabel(row.bookingId, 200)
        || !checkedLabel(row.externalEventId, 200)
        || !eventKinds.has(row.kind)
        || typeof row.amountMinor !== 'string'
        || !decimal.test(row.amountMinor)
        || BigInt(row.amountMinor) > 1_000_000_000_000n
        || !validDate(row.claimedSettledOn)
        || seen.has(row.externalEventId)) {
      throw new FinanceImportError('FINANCE_IMPORT_INVALID_OR_DUPLICATE_EVENT');
    }
    seen.add(row.externalEventId);
  }
}

function assertCountExactlyOne(rows: readonly unknown[], code: string): void {
  if (!Array.isArray(rows) || rows.length !== 1) throw new FinanceImportError(code);
}

/**
 * SOURCE-ONLY. No HTTP route, PostgreSQL pool, credential or privileged connection
 * is constructed by this module. The caller must inject a trusted server-only
 * pool. This never calls an OTA or bank and never proves a cash settlement.
 *
 * Statement + all events + append-only audit row commit or roll back together.
 * A lost connection during COMMIT yields an UNKNOWN outcome: do not auto-replay.
 */
export async function appendUnverifiedOtaStatement(
  database: FinanceTransactionPool,
  input: UnverifiedStatementInput,
): Promise<UnverifiedImportReceipt> {
  validate(input);
  const scope = { accountId: input.accountId, propertyId: input.propertyId };
  const principal = await requireOtaFinanceScope({ ...scope, action: 'import' });
  if (principal.role !== 'owner') throw new FinanceImportError('FINANCE_IMPORT_OWNER_REQUIRED');

  const bookings = [...new Set(input.events.map(event => event.bookingId))];
  // Validate every legacy booking alias through the application's actual
  // iron-session guard BEFORE acquiring a privileged connection.
  for (const bookingId of bookings) {
    const bookScope = await requireOtaFinanceScope({ ...scope, bookingId, action: 'import' });
    if (bookScope.actorUserId !== principal.actorUserId || bookScope.role !== 'owner'
        || bookScope.accountId !== principal.accountId || bookScope.propertyId !== principal.propertyId) {
      throw new FinanceImportError('FINANCE_IMPORT_AUTH_DRIFT');
    }
  }

  const operationId = randomUUID();
  const payloadSha256 = createHash('sha256').update(JSON.stringify({
    accountId: input.accountId, propertyId: input.propertyId,
    provider: input.provider, currency: input.currency,
    statementExternalId: input.statementExternalId, sourceSha256: input.sourceSha256,
    asOfDate: input.asOfDate, events: input.events,
  }), 'utf8').digest('hex');

  const client = await database.connect();
  let transactionStarted = false;
  let commitRequested = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // Read the canonical app membership inside THIS SAME transaction. Locking
    // rows prevents a concurrent role revocation/property reassignment from
    // silently racing a finance write between authorization and COMMIT.
    const tenant = await client.query<{ role: string; property_id: string }>(
      `select m.role, p.id as property_id
       from public.account_members m
       join public.properties p on p.account_id = m.account_id
       where m.account_id = $1::uuid and m.user_id = $2::uuid
         and m.role = 'owner' and p.id = $3::uuid
       for share of m, p`,
      [principal.accountId, principal.actorUserId, principal.propertyId],
    );
    assertCountExactlyOne(tenant.rows, 'FINANCE_IMPORT_TRANSACTION_OWNER_REVOKED');
    if (tenant.rows[0].role !== 'owner' || tenant.rows[0].property_id !== principal.propertyId) {
      throw new FinanceImportError('FINANCE_IMPORT_TRANSACTION_OWNER_REVOKED');
    }

    // booking_ops_records stores account/property as TEXT, unlike canonical UUIDs.
    // A duplicate or missing booking alias fails rather than guessing.
    const matches = await client.query<{ booking_id: string; quantity: string }>(
      `select booking_id, count(*)::text as quantity
       from public.booking_ops_records
       where account_id = $1::text and property_id = $2::text
         and booking_id = any($3::text[])
       group by booking_id`,
      [principal.accountId, principal.propertyId, bookings],
    );
    if (matches.rows.length !== bookings.length
        || matches.rows.some(row => !bookings.includes(row.booking_id) || row.quantity !== '1')) {
      throw new FinanceImportError('FINANCE_IMPORT_TRANSACTION_BOOKING_SCOPE_CHANGED');
    }

    const statements = await client.query<{ id: string }>(
      `insert into ota_finance_private.statement_imports
       (account_id, property_id, provider, currency, statement_external_id,
        source_sha256, as_of_date, provenance, source_status)
       values($1::uuid,$2::uuid,$3,$4,$5,$6,$7::date,
              'OPERATOR_SUPPLIED_NORMALIZED_CSV','UNVERIFIED_OPERATOR_IMPORT')
       returning id`,
      [principal.accountId, principal.propertyId, input.provider, input.currency,
        input.statementExternalId, input.sourceSha256, input.asOfDate],
    );
    assertCountExactlyOne(statements.rows, 'FINANCE_IMPORT_STATEMENT_INSERT_MISSING');
    const statementId = statements.rows[0].id;

    for (const event of input.events) {
      const added = await client.query<{ id: string }>(
        `insert into ota_finance_private.cash_events
         (statement_import_id, account_id, property_id, provider, currency,
          booking_id, external_event_id, kind, amount_minor,
          claimed_settled_on, source_status)
         values($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::bigint,$10::date,
                'UNVERIFIED_OPERATOR_IMPORT')
         returning id`,
        [statementId, principal.accountId, principal.propertyId,
          input.provider, input.currency, event.bookingId, event.externalEventId,
          event.kind, event.amountMinor, event.claimedSettledOn],
      );
      assertCountExactlyOne(added.rows, 'FINANCE_IMPORT_EVENT_INSERT_MISSING');
    }

    const audits = await client.query<{ id: string }>(
      `insert into ota_finance_private.operation_audit
       (operation_id, account_id, property_id, actor_user_id,
        statement_import_id, provider, currency, operation_kind,
        event_count, payload_sha256, outcome)
       values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,
              'operator_statement_import',$8::integer,$9,'COMMITTED_UNVERIFIED')
       returning id`,
      [operationId, principal.accountId, principal.propertyId, principal.actorUserId,
        statementId, input.provider, input.currency, input.events.length, payloadSha256],
    );
    assertCountExactlyOne(audits.rows, 'FINANCE_IMPORT_AUDIT_INSERT_MISSING');

    commitRequested = true;
    await client.query('COMMIT');
    transactionStarted = false;
    return {
      statementId, auditId: audits.rows[0].id, operationId,
      eventCount: input.events.length, status: 'COMMITTED_UNVERIFIED',
    };
  } catch (error) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch { /* DB may be disconnected */ }
    }
    if (commitRequested) throw new FinanceImportError('FINANCE_IMPORT_COMMIT_OUTCOME_UNKNOWN_NO_AUTOREPLAY');
    // Conflicts are deliberately NOT silently counted as successful imports.
    throw error;
  } finally {
    client.release();
  }
}
