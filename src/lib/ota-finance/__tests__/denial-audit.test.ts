import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../access', () => {
  class OtaFinanceAccessError extends Error {
    constructor(public readonly code: string) { super(code); }
  }
  return { OtaFinanceAccessError, requireOtaFinanceScope: mock.authorize };
});

import { requireAuditedOtaFinanceScope } from '../denial-audit';
import { OtaFinanceAccessError } from '../access';

const REQUEST = {
  action: 'import' as const,
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  propertyId: '11111111-1111-4111-8111-111111111111',
  bookingId: 'secret-guest-booking-1',
};

function sink(options?: { fail?: boolean; missingReceipt?: boolean }) {
  const query = vi.fn(async (_sql: string, _params: readonly unknown[]) => {
    if (options?.fail) throw new Error('database-unavailable');
    return { rows: options?.missingReceipt ? [] : [{ id: 'audit-row' }] };
  });
  return { query };
}

beforeEach(() => vi.clearAllMocks());

describe('private fail-closed denial audit', () => {
  it('authorizes a valid session without writing a denial', async () => {
    const audit = sink();
    mock.authorize.mockResolvedValue({ accountId: REQUEST.accountId, propertyId: REQUEST.propertyId, role: 'owner' });
    await expect(requireAuditedOtaFinanceScope(audit, REQUEST)).resolves.toMatchObject({ role: 'owner' });
    expect(audit.query).not.toHaveBeenCalled();
  });

  it('appends one redacted denial record before rejecting the caller', async () => {
    const audit = sink();
    mock.authorize.mockRejectedValue(new OtaFinanceAccessError('FINANCE_WRITE_REQUIRES_OWNER'));
    await expect(requireAuditedOtaFinanceScope(audit, REQUEST))
      .rejects.toThrow('FINANCE_WRITE_REQUIRES_OWNER');
    expect(audit.query).toHaveBeenCalledTimes(1);
    const [sql, params] = audit.query.mock.calls[0];
    expect(sql).toContain('insert into ota_finance_private.access_denials');
    expect(sql).toContain('returning id');
    expect(params[1]).toBe('import');
    expect(params[2]).toBe('FINANCE_WRITE_REQUIRES_OWNER');
    expect(params[3]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(params)).not.toContain(REQUEST.bookingId);
    expect(JSON.stringify(params)).not.toContain(REQUEST.accountId);
    expect(JSON.stringify(params)).not.toContain(REQUEST.propertyId);
  });

  it('denies access when audit database is unavailable, never converts denial to success', async () => {
    const audit = sink({ fail: true });
    mock.authorize.mockRejectedValue(new OtaFinanceAccessError('FINANCE_ACCOUNT_FORBIDDEN'));
    await expect(requireAuditedOtaFinanceScope(audit, REQUEST))
      .rejects.toThrow('FINANCE_DENIAL_AUDIT_UNAVAILABLE');
    expect(audit.query).toHaveBeenCalledTimes(1);
  });

  it('rejects missing audit receipt, rather than claiming a successful denial log', async () => {
    const audit = sink({ missingReceipt: true });
    mock.authorize.mockRejectedValue(new OtaFinanceAccessError('FINANCE_LOGIN_REQUIRED'));
    await expect(requireAuditedOtaFinanceScope(audit, REQUEST))
      .rejects.toThrow('FINANCE_DENIAL_AUDIT_UNAVAILABLE');
  });

  it('stores an invalid action as a controlled enum, without persisting raw fields', async () => {
    const audit = sink();
    mock.authorize.mockRejectedValue(new OtaFinanceAccessError('FINANCE_INVALID_ACTION'));
    await expect(requireAuditedOtaFinanceScope(audit, {
      ...REQUEST, action: 'malicious-private-action' as 'read',
    })).rejects.toThrow('FINANCE_INVALID_ACTION');
    expect(audit.query.mock.calls[0][1][1]).toBe('invalid_action');
    expect(JSON.stringify(audit.query.mock.calls[0])).not.toContain('malicious-private-action');
  });

  it('does not rewrite arbitrary programmer/runtime exceptions as security denials', async () => {
    const audit = sink();
    mock.authorize.mockRejectedValue(new Error('SERVICE_UNAVAILABLE'));
    await expect(requireAuditedOtaFinanceScope(audit, REQUEST))
      .rejects.toThrow('SERVICE_UNAVAILABLE');
    expect(audit.query).not.toHaveBeenCalled();
  });
});
