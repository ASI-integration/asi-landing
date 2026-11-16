import 'server-only';

import type { FinanceTransactionClient, FinanceTransactionPool } from './transactional-import';

/**
 * Source-only PostgreSQL boundary. A TRUSTED Node server injects a pool that
 * already enforces TLS certificate verification and separately scoped secrets.
 * No database URL, password, HTTP endpoint or pool is instantiated here.
 *
 * PostgreSQL itself cannot prove client-side TLS certificate verification.
 */
export type FinancePgTarget = Readonly<{
  database: string;
  role: 'service_role';
  minimumServerVersion: 170000;
  kind: 'disposable' | 'staging_readiness_only';
}>;

export class FinancePgPreflightError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'FinancePgPreflightError';
  }
}

const REQUIRED = Object.freeze([
  'fee_rule_versions', 'statement_imports', 'cash_events',
  'statement_reviews', 'operation_audit', 'access_denials',
]);

const SERVER_IDENTITY = `select current_database()::text as database,
  current_user::text as role,
  current_setting('server_version_num')::integer as version,
  has_schema_privilege(current_user, 'ota_finance_private', 'USAGE') as schema_usage`;

const TABLE_PERMISSIONS = `with required(name) as (
  values ('fee_rule_versions'), ('statement_imports'), ('cash_events'),
         ('statement_reviews'), ('operation_audit'), ('access_denials')
)
select r.name,
       (c.oid is not null) as exists,
       coalesce(c.relrowsecurity, false) as rls,
       coalesce(has_table_privilege(current_user, c.oid, 'SELECT'), false) as can_select,
       coalesce(has_table_privilege(current_user, c.oid, 'INSERT'), false) as can_insert,
       coalesce(has_table_privilege(current_user, c.oid, 'UPDATE'), false) as can_update,
       coalesce(has_table_privilege(current_user, c.oid, 'DELETE'), false) as can_delete
from required r
left join pg_namespace ns on ns.nspname = 'ota_finance_private'
left join pg_class c on c.relnamespace = ns.oid and c.relname = r.name
order by r.name`;

function validateTarget(target: FinancePgTarget): void {
  if (!target || !/^[a-z][a-z0-9_]{0,62}$/.test(target.database)
      || target.role !== 'service_role' || target.minimumServerVersion !== 170000
      || !['disposable', 'staging_readiness_only'].includes(target.kind)) {
    throw new FinancePgPreflightError('FINANCE_PG_TARGET_CONFIGURATION_REJECTED');
  }
}

/**
 * Verify the actual connected server and every private-table privilege.
 * This is NOT an external TLS/hostname proof or a bank/OTA verification.
 */
export async function verifyFinancePgSession(
  client: FinanceTransactionClient,
  target: FinancePgTarget,
): Promise<void> {
  validateTarget(target);
  const metadata = await client.query<{
    database: string; role: string; version: number; schema_usage: boolean;
  }>(SERVER_IDENTITY);
  if (metadata.rows.length !== 1
      || metadata.rows[0].database !== target.database
      || metadata.rows[0].role !== target.role
      || metadata.rows[0].version < target.minimumServerVersion
      || metadata.rows[0].schema_usage !== true) {
    throw new FinancePgPreflightError('FINANCE_PG_IDENTITY_OR_VERSION_MISMATCH');
  }

  const privileges = await client.query<{
    name: string; exists: boolean; rls: boolean; can_select: boolean;
    can_insert: boolean; can_update: boolean; can_delete: boolean;
  }>(TABLE_PERMISSIONS);

  const rows = privileges.rows;
  if (rows.length !== REQUIRED.length
      || rows.some((row, index) =>
        row.name !== [...REQUIRED].sort()[index]
        || row.exists !== true || row.rls !== true
        || row.can_select !== true || row.can_insert !== true
        || row.can_update !== false || row.can_delete !== false
      )) {
    throw new FinancePgPreflightError('FINANCE_PG_PRIVATE_SCHEMA_OR_PRIVILEGES_MISMATCH');
  }
}

/**
 * Evaluate a staging target, but NEVER return its write-capable connection.
 * Real staging writes require a separately reviewed activation and deployment.
 */
export async function assessFinanceStagingReadiness(
  pool: FinanceTransactionPool,
  target: FinancePgTarget,
): Promise<'FINANCE_PG_STAGING_READINESS_ONLY'> {
  if (target.kind !== 'staging_readiness_only')
    throw new FinancePgPreflightError('FINANCE_PG_STAGING_MODE_REQUIRED');
  const client = await pool.connect();
  try {
    await verifyFinancePgSession(client, target);
    return 'FINANCE_PG_STAGING_READINESS_ONLY';
  } finally {
    client.release();
  }
}

/**
 * Connection wrapper for disposable-test writes only. No staging/production
 * connection can be handed to the financial import module by this adapter.
 */
export function guardedDisposableFinancePool(
  pool: FinanceTransactionPool,
  target: FinancePgTarget,
): FinanceTransactionPool {
  validateTarget(target);
  if (target.kind !== 'disposable')
    throw new FinancePgPreflightError('FINANCE_PG_WRITES_DISPOSABLE_ONLY');
  return {
    async connect() {
      const client = await pool.connect();
      try {
        await verifyFinancePgSession(client, target);
        return client;
      } catch (error) {
        client.release();
        throw error;
      }
    },
  };
}
