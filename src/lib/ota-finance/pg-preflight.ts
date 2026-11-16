import 'server-only';

import type { FinanceTransactionClient, FinanceTransactionPool } from './transactional-import';

/**
 * Source-only PostgreSQL boundary. A TRUSTED Node server injects a pool that
 * already enforces TLS certificate verification and separately scoped secrets.
 * No database URL, password, HTTP endpoint or pool is instantiated here.
 *
 * PostgreSQL itself cannot prove client-side TLS certificate verification.
 * The staging role MUST be a distinct LOGIN role provisioned by a separately
 * reviewed deployment. The Supabase service_role is NOLOGIN and cannot be
 * used as a direct PostgreSQL login in staging.
 */
export type FinancePgTarget = Readonly<{
  database: string;
  role: 'service_role' | 'asi_finance_runtime';
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
  exists(select 1 from pg_roles where rolname = current_user and rolcanlogin) as role_can_login,
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
      || !['service_role', 'asi_finance_runtime'].includes(target.role)
      || target.minimumServerVersion !== 170000
      || !['disposable', 'staging_readiness_only'].includes(target.kind)) {
    throw new FinancePgPreflightError('FINANCE_PG_TARGET_CONFIGURATION_REJECTED');
  }
  // Supabase service_role is NOLOGIN. It is usable in disposable PG fixtures
  // via SET ROLE but is NOT a valid staging direct-connection identity.
  if (target.kind === 'staging_readiness_only' && target.role !== 'asi_finance_runtime')
    throw new FinancePgPreflightError('FINANCE_PG_STAGING_DEDICATED_ROLE_REQUIRED');
  if (target.kind === 'disposable' && target.role !== 'service_role')
    throw new FinancePgPreflightError('FINANCE_PG_DISPOSABLE_SERVICE_ROLE_REQUIRED');
}

/**
 * Verify the actual connected server and every private-table privilege.
 * A dedicated staging role must be provisioned separately with narrow grants
 * and RLS access; this module NEVER creates a credential or a database role.
 * This is NOT an external TLS/hostname proof or a bank/OTA verification.
 */
export async function verifyFinancePgSession(
  client: FinanceTransactionClient,
  target: FinancePgTarget,
): Promise<void> {
  validateTarget(target);
  const metadata = await client.query<{
    database: string; role: string; version: number;
    role_can_login: boolean; schema_usage: boolean;
  }>(SERVER_IDENTITY);
  if (metadata.rows.length !== 1
      || metadata.rows[0].database !== target.database
      || metadata.rows[0].role !== target.role
      || metadata.rows[0].version < target.minimumServerVersion
      || metadata.rows[0].schema_usage !== true
      || (target.kind === 'staging_readiness_only' && metadata.rows[0].role_can_login !== true)) {
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
