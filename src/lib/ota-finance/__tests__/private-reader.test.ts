import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../access', () => ({
  requireOtaFinanceScope: mocks.authorize,
}));

import {
  listFinanceFeeRules,
  listUnverifiedBookingCashEvents,
  listUnverifiedStatements,
  type FinancePrivateSqlReader,
} from '../private-reader';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PROPERTY = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const BOOKING = 'BOOKING-X-7';

function adapter(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows }));
  return { client: { query } as unknown as FinancePrivateSqlReader, query };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockImplementation(async (req: { accountId: string; propertyId: string; bookingId?: string }) =>
    ({...req,actorUserId:'44444444-4444-4444-8444-444444444444',role:'owner'}));
});

describe('OTA finance private reader (source-only, no connection or public route)', () => {
  it('authorizes before invoking SQL and scopes by account and property with bound parameters', async () => {
    const row = {
      id:'s-1', account_id:ACCOUNT, property_id:PROPERTY, provider:'OTA-X',
      currency:'RUB', source_status:'UNVERIFIED_OPERATOR_IMPORT',
    };
    const {client,query}=adapter([row]);
    await expect(listUnverifiedStatements(client,{accountId:ACCOUNT,propertyId:PROPERTY},20))
      .resolves.toEqual([row]);
    expect(mocks.authorize).toHaveBeenCalledWith({
      accountId:ACCOUNT,propertyId:PROPERTY,action:'read',
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/from ota_finance_private\.statement_imports/);
    expect(query.mock.calls[0][0]).toMatch(/account_id = \$1::uuid and property_id = \$2::uuid/);
    expect(query.mock.calls[0][1]).toEqual([ACCOUNT,PROPERTY,20]);
  });

  it('fails closed without running SQL when session/account auth fails', async () => {
    mocks.authorize.mockRejectedValue(new Error('FINANCE_ACCOUNT_FORBIDDEN'));
    const {client,query}=adapter();
    await expect(listUnverifiedStatements(client,{accountId:OTHER,propertyId:PROPERTY}))
      .rejects.toThrow('FINANCE_ACCOUNT_FORBIDDEN');
    expect(query).not.toHaveBeenCalled();
  });

  it('denies a mismatched row even when a DB adapter returns it', async () => {
    const {client}=adapter([{
      id:'s-2',account_id:OTHER,property_id:PROPERTY,
      source_status:'UNVERIFIED_OPERATOR_IMPORT',
    }]);
    await expect(listUnverifiedStatements(client,{accountId:ACCOUNT,propertyId:PROPERTY}))
      .rejects.toThrow('FINANCE_DATABASE_SCOPE_MISMATCH');
  });

  it('does not turn an operator CSV into verified bank money', async () => {
    const {client}=adapter([{
      id:'s-3',account_id:ACCOUNT,property_id:PROPERTY,source_status:'bank_settled',
    }]);
    await expect(listUnverifiedStatements(client,{accountId:ACCOUNT,propertyId:PROPERTY}))
      .rejects.toThrow('FINANCE_UNEXPECTED_SOURCE_STATUS');
  });

  it('forces exact canonical booking access and returns integer money as strings', async () => {
    const row = {
      id:'e-1',account_id:ACCOUNT,property_id:PROPERTY,booking_id:BOOKING,
      amount_minor:'9007199254740993',source_status:'UNVERIFIED_OPERATOR_IMPORT',
    };
    const {client,query}=adapter([row]);
    await expect(listUnverifiedBookingCashEvents(client,{
      accountId:ACCOUNT,propertyId:PROPERTY,bookingId:BOOKING,
    })).resolves.toEqual([row]);
    expect(mocks.authorize).toHaveBeenCalledWith({
      accountId:ACCOUNT,propertyId:PROPERTY,bookingId:BOOKING,action:'read',
    });
    expect(query.mock.calls[0][0]).toMatch(/amount_minor::text as amount_minor/);
    expect(query.mock.calls[0][0]).toMatch(/booking_id = \$3::text/);
    expect(query.mock.calls[0][1]).toEqual([ACCOUNT,PROPERTY,BOOKING,50]);
  });

  it('rejects cash rows from another booking', async () => {
    const {client}=adapter([{
      id:'e-2',account_id:ACCOUNT,property_id:PROPERTY,booking_id:'OTHER-BOOKING',
      source_status:'UNVERIFIED_OPERATOR_IMPORT',
    }]);
    await expect(listUnverifiedBookingCashEvents(client,{
      accountId:ACCOUNT,propertyId:PROPERTY,bookingId:BOOKING,
    })).rejects.toThrow('FINANCE_CASH_SCOPE_OR_PROVENANCE_MISMATCH');
  });

  it('refuses invalid/large pagination values without executing SQL', async () => {
    const {client,query}=adapter();
    for (const limit of [0,101,NaN,1.5,-1]) {
      await expect(listUnverifiedStatements(client,{accountId:ACCOUNT,propertyId:PROPERTY},limit))
        .rejects.toThrow('FINANCE_INVALID_PAGE_LIMIT');
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('reads fee versions through a separately scoped parameterized query', async () => {
    const fee = {
      id:'f-1',account_id:ACCOUNT,property_id:PROPERTY,provider:'OTA-X',
      currency:'RUB',contract_key:'A',version:2,commission_bps:500,
      fixed_minor:'25',
    };
    const {client,query}=adapter([fee]);
    await expect(listFinanceFeeRules(client,{accountId:ACCOUNT,propertyId:PROPERTY}))
      .resolves.toEqual([fee]);
    expect(query.mock.calls[0][0]).toMatch(/from ota_finance_private\.fee_rule_versions/);
    expect(query.mock.calls[0][0]).toMatch(/fixed_minor::text as fixed_minor/);
    expect(query.mock.calls[0][1]).toEqual([ACCOUNT,PROPERTY,50]);
  });
});
