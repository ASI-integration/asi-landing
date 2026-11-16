import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  assessFinanceStagingReadiness,
  guardedDisposableFinancePool,
  verifyFinancePgSession,
  type FinancePgTarget,
} from '../pg-preflight';
import type { FinanceTransactionClient, FinanceTransactionPool } from '../transactional-import';

const target: FinancePgTarget = {
  kind: 'disposable',
  database: 'asi_ota_finance_test',
  role: 'service_role',
  minimumServerVersion: 170000,
};
const names = [
  'access_denials', 'cash_events', 'fee_rule_versions',
  'operation_audit', 'statement_imports', 'statement_reviews',
];
function fixture(overrides: {
  wrongDb?: boolean;
  version?: number;
  missingTable?: boolean;
  updateGranted?: boolean;
  lostUsage?: boolean;
  wrongRole?: boolean;
  stagedRole?: boolean;
  roleCanLogin?: boolean;
} = {}) {
  const release = vi.fn();
  const sql: string[] = [];
  const query = vi.fn(async (statement: string) => {
    sql.push(statement);
    if (statement.includes('current_database()::text')) {
      return { rows: [{
        database: overrides.wrongDb ? 'wrong_project' : 'asi_ota_finance_test',
        role: overrides.wrongRole ? 'postgres' : overrides.stagedRole ? 'asi_finance_runtime' : 'service_role',
        version: overrides.version ?? 170002,
        role_can_login: overrides.roleCanLogin ?? false,
        schema_usage: !overrides.lostUsage,
      }] };
    }
    if (statement.includes('from required r')) return {
      rows: names.map(name => ({
        name, exists: !(overrides.missingTable && name === 'access_denials'),
        rls: true, can_select: true, can_insert: true,
        can_update: !!overrides.updateGranted, can_delete: false,
      })),
    };
    throw new Error('unexpected_sql');
  });
  const client = { query, release } as unknown as FinanceTransactionClient;
  const pool: FinanceTransactionPool = { connect: vi.fn(async () => client) };
  return { client, pool, release, sql };
}

describe('finance PostgreSQL schema and identity preflight', () => {
  it('accepts only exact role, version, database, 6 private RLS tables, SELECT/INSERT grants', async () => {
    const db = fixture();
    await expect(verifyFinancePgSession(db.client, target)).resolves.toBeUndefined();
    expect(db.sql).toHaveLength(2);
  });

  it.each([
    [{ wrongDb: true }, 'FINANCE_PG_IDENTITY_OR_VERSION_MISMATCH'],
    [{ wrongRole: true }, 'FINANCE_PG_IDENTITY_OR_VERSION_MISMATCH'],
    [{ version: 160000 }, 'FINANCE_PG_IDENTITY_OR_VERSION_MISMATCH'],
    [{ lostUsage: true }, 'FINANCE_PG_IDENTITY_OR_VERSION_MISMATCH'],
    [{ missingTable: true }, 'FINANCE_PG_PRIVATE_SCHEMA_OR_PRIVILEGES_MISMATCH'],
    [{ updateGranted: true }, 'FINANCE_PG_PRIVATE_SCHEMA_OR_PRIVILEGES_MISMATCH'],
  ] as const)('fails closed for invalid database metadata: %o', async (change, code) => {
    const db = fixture(change);
    await expect(verifyFinancePgSession(db.client, target)).rejects.toThrow(code);
  });

  it('releases a mismatched client and never lends it to the importer', async () => {
    const db = fixture({ wrongDb: true });
    const wrapped = guardedDisposableFinancePool(db.pool, target);
    await expect(wrapped.connect()).rejects.toThrow('FINANCE_PG_IDENTITY_OR_VERSION_MISMATCH');
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('lends a verified disposable client and leaves release to importer', async () => {
    const db = fixture();
    const wrapped = guardedDisposableFinancePool(db.pool, target);
    const client = await wrapped.connect();
    expect(client).toBe(db.client);
    expect(db.release).not.toHaveBeenCalled();
    client.release();
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('staging assessment always releases the connection without any DML', async () => {
    const db = fixture({ stagedRole: true, roleCanLogin: true });
    const result = await assessFinanceStagingReadiness(db.pool, {
      ...target, kind: 'staging_readiness_only', role: 'asi_finance_runtime',
    });
    expect(result).toBe('FINANCE_PG_STAGING_READINESS_ONLY');
    expect(db.release).toHaveBeenCalledOnce();
    expect(db.sql.every(sql => sql.trim().toLowerCase().startsWith('select')
      || sql.trim().toLowerCase().startsWith('with'))).toBe(true);
  });

  it('staging connection cannot be used as a finance write pool', () => {
    const db = fixture();
    expect(() => guardedDisposableFinancePool(db.pool, {
      ...target, kind: 'staging_readiness_only', role: 'asi_finance_runtime',
    })).toThrow('FINANCE_PG_WRITES_DISPOSABLE_ONLY');
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('refuses the Supabase NOLOGIN service_role for a real staging probe before connecting', async () => {
    const db = fixture();
    await expect(assessFinanceStagingReadiness(db.pool, {
      ...target, kind: 'staging_readiness_only',
    })).rejects.toThrow('FINANCE_PG_STAGING_DEDICATED_ROLE_REQUIRED');
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('rejects a dedicated staging role that cannot log in, and releases client', async () => {
    const db = fixture({ stagedRole: true, roleCanLogin: false });
    await expect(assessFinanceStagingReadiness(db.pool, {
      ...target, kind: 'staging_readiness_only', role: 'asi_finance_runtime',
    })).rejects.toThrow('FINANCE_PG_IDENTITY_OR_VERSION_MISMATCH');
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('rejects a mismatching actual staging role even if the configured role is valid', async () => {
    const db = fixture({ roleCanLogin: true });
    await expect(assessFinanceStagingReadiness(db.pool, {
      ...target, kind: 'staging_readiness_only', role: 'asi_finance_runtime',
    })).rejects.toThrow('FINANCE_PG_IDENTITY_OR_VERSION_MISMATCH');
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('rejects invalid target identifiers before connecting to DB', () => {
    const db = fixture();
    expect(() => guardedDisposableFinancePool(db.pool, {
      ...target, database: 'postgres;drop',
    })).toThrow('FINANCE_PG_TARGET_CONFIGURATION_REJECTED');
    expect(db.pool.connect).not.toHaveBeenCalled();
  });
});
