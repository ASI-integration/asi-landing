import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../access', () => ({
  requireOtaFinanceScope: mocks.authorize,
}));

import {
  appendUnverifiedOtaStatement,
  type FinanceTransactionClient,
  type FinanceTransactionPool,
  type UnverifiedStatementInput,
} from '../transactional-import';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P = '11111111-1111-4111-8111-111111111111';
const U = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const payload: UnverifiedStatementInput = {
  accountId: A,
  propertyId: P,
  provider: 'ota-a',
  currency: 'RUB',
  statementExternalId: 'statement-1001',
  sourceSha256: 'a'.repeat(64),
  asOfDate: '2026-11-16',
  events: [
    { bookingId: 'booking-1', externalEventId: 'e-1', kind: 'payout_received',
      amountMinor: '84800', claimedSettledOn: '2026-11-16' },
    { bookingId: 'booking-2', externalEventId: 'e-2', kind: 'refund_debit',
      amountMinor: '900719925474', claimedSettledOn: '2026-11-15' },
  ],
};

function fakeDatabase(options: {
  failAt?: 'event' | 'audit' | 'commit';
  owner?: boolean;
  bookings?: boolean;
} = {}) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const released = vi.fn();
  let pending: string[] = [];
  const durable: string[] = [];
  const query = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    calls.push({ sql, params });
    if (sql === 'BEGIN') { pending = []; return { rows: [] }; }
    if (sql === 'COMMIT') {
      if (options.failAt === 'commit') throw Error('simulated network interruption');
      durable.push(...pending);
      pending = [];
      return { rows: [] };
    }
    if (sql === 'ROLLBACK') { pending = []; return { rows: [] }; }
    if (sql.includes('from public.account_members')) {
      return { rows: options.owner === false ? [] : [{ role: 'owner', property_id: P }] };
    }
    if (sql.includes('from public.booking_ops_records')) {
      return { rows: options.bookings === false ? [] : [
        { booking_id: 'booking-1', quantity: '1' },
        { booking_id: 'booking-2', quantity: '1' },
      ] };
    }
    if (sql.includes('insert into ota_finance_private.statement_imports')) {
      pending.push('statement'); return { rows: [{ id: 'statement-uuid' }] };
    }
    if (sql.includes('insert into ota_finance_private.cash_events')) {
      if (options.failAt === 'event') throw Error('simulated unique event constraint');
      pending.push('cash'); return { rows: [{ id: 'event-uuid' }] };
    }
    if (sql.includes('insert into ota_finance_private.operation_audit')) {
      if (options.failAt === 'audit') throw Error('simulated audit FK failure');
      pending.push('audit'); return { rows: [{ id: 'audit-uuid' }] };
    }
    throw Error('Unexpected SQL operation: ' + sql);
  });
  const client = { query, release: released } as unknown as FinanceTransactionClient;
  return {
    pool: { connect: vi.fn(async () => client) } satisfies FinanceTransactionPool,
    calls, durable, released,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockImplementation(async (req: {
    accountId: string; propertyId: string; bookingId?: string;
  }) => ({ ...req, actorUserId: U, role: 'owner' }));
});

describe('source-only transactional OTA operator import', () => {
  it('atomically commits one statement, multiple cash events and immutable audit with correct bind parameters', async () => {
    const db = fakeDatabase();
    const receipt = await appendUnverifiedOtaStatement(db.pool, payload);
    expect(receipt).toMatchObject({
      statementId: 'statement-uuid', auditId: 'audit-uuid',
      eventCount: 2, status: 'COMMITTED_UNVERIFIED',
    });
    expect(receipt.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.durable).toEqual(['statement', 'cash', 'cash', 'audit']);
    expect(db.calls[0].sql).toBe('BEGIN');
    expect(db.calls.at(-1)?.sql).toBe('COMMIT');
    expect(db.released).toHaveBeenCalledTimes(1);
    expect(mocks.authorize).toHaveBeenCalledTimes(3);
    const audit = db.calls.find(x => x.sql.includes('insert into ota_finance_private.operation_audit'))!;
    expect(audit.params[1]).toBe(A);
    expect(audit.params[3]).toBe(U);
    expect(audit.params[7]).toBe(2);
    expect(audit.params[8]).toMatch(/^[0-9a-f]{64}$/);
    expect(db.calls.find(x => x.sql.includes('from public.account_members'))?.sql)
      .toContain('for share of m, p');
    expect(db.calls.find(x => x.sql.includes('from public.booking_ops_records'))?.params[2])
      .toEqual(['booking-1', 'booking-2']);
  });

  it('denies a non-owner or invalid session before opening privileged SQL', async () => {
    const db = fakeDatabase();
    mocks.authorize.mockRejectedValueOnce(new Error('FINANCE_WRITE_REQUIRES_OWNER'));
    await expect(appendUnverifiedOtaStatement(db.pool, payload))
      .rejects.toThrow('FINANCE_WRITE_REQUIRES_OWNER');
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('denies changed actor between booking checks before opening SQL', async () => {
    const db = fakeDatabase();
    mocks.authorize.mockResolvedValueOnce({ accountId:A,propertyId:P,actorUserId:U,role:'owner' });
    mocks.authorize.mockResolvedValueOnce({
      accountId:A,propertyId:P,actorUserId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',role:'owner',
    });
    await expect(appendUnverifiedOtaStatement(db.pool, payload))
      .rejects.toThrow('FINANCE_IMPORT_AUTH_DRIFT');
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('rolls back on a failed event insert and leaves no durable partial data', async () => {
    const db = fakeDatabase({ failAt: 'event' });
    await expect(appendUnverifiedOtaStatement(db.pool, payload))
      .rejects.toThrow('simulated unique event constraint');
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(db.durable).toEqual([]);
    expect(db.released).toHaveBeenCalledTimes(1);
  });

  it('rolls back all cash events when the audit cannot be appended', async () => {
    const db = fakeDatabase({ failAt: 'audit' });
    await expect(appendUnverifiedOtaStatement(db.pool, payload))
      .rejects.toThrow('simulated audit FK failure');
    expect(db.durable).toEqual([]);
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('rechecks revoked ownership inside the same transaction and rolls back', async () => {
    const db = fakeDatabase({ owner: false });
    await expect(appendUnverifiedOtaStatement(db.pool, payload))
      .rejects.toThrow('FINANCE_IMPORT_TRANSACTION_OWNER_REVOKED');
    expect(db.calls.some(x=>x.sql.includes('insert into ota_finance_private'))).toBe(false);
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('rechecks missing/ambiguous booking identities inside transaction', async () => {
    const db = fakeDatabase({ bookings: false });
    await expect(appendUnverifiedOtaStatement(db.pool, payload))
      .rejects.toThrow('FINANCE_IMPORT_TRANSACTION_BOOKING_SCOPE_CHANGED');
    expect(db.durable).toEqual([]);
    expect(db.calls.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('never guesses whether a failed COMMIT succeeded, and forbids automatic replay', async () => {
    const db = fakeDatabase({ failAt: 'commit' });
    await expect(appendUnverifiedOtaStatement(db.pool, payload))
      .rejects.toThrow('FINANCE_IMPORT_COMMIT_OUTCOME_UNKNOWN_NO_AUTOREPLAY');
    expect(db.calls.filter(x => x.sql === 'BEGIN')).toHaveLength(1);
    expect(db.calls.filter(x => x.sql === 'COMMIT')).toHaveLength(1);
    expect(db.released).toHaveBeenCalledTimes(1);
  });

  it('rejects duplicated external events, nondecimal money and invalid dates pre-SQL', async () => {
    const db = fakeDatabase();
    const cases: UnverifiedStatementInput[] = [
      { ...payload, events: [payload.events[0], payload.events[0]] },
      { ...payload, events: [{ ...payload.events[0], amountMinor: '1.25' }] },
      { ...payload, events: [{ ...payload.events[0], amountMinor: '1000000000001' }] },
      { ...payload, asOfDate: '2026-02-30' },
      { ...payload, events: [] },
      { ...payload, events: [{ ...payload.events[0], claimedSettledOn: '2026-13-10' }] },
    ];
    for (const bad of cases) {
      await expect(appendUnverifiedOtaStatement(db.pool, bad)).rejects.toThrow();
    }
    expect(db.pool.connect).not.toHaveBeenCalled();
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
});
