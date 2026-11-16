import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  getSession: vi.fn(),
  hasSecret: vi.fn(),
  from: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({
  getSession: mock.getSession,
  isSessionSecretConfigured: mock.hasSecret,
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mock.from } }));

import { requireOtaFinanceScope } from '../access';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function table(result: { data: unknown; error: unknown }) {
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  };
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  q.maybeSingle.mockResolvedValue(result);
  q.limit.mockResolvedValue(result);
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.hasSecret.mockReturnValue(true);
  mock.getSession.mockResolvedValue({ userId: USER });
});

describe('OTA finance boundary (no finance API/database writes)', () => {
  it('refuses unauthenticated requests before calling a privileged client', async () => {
    mock.getSession.mockResolvedValue({});
    await expect(requireOtaFinanceScope({accountId:A,propertyId:PA,action:'read'}))
      .rejects.toMatchObject({ code:'FINANCE_LOGIN_REQUIRED', status:401 });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('refuses an unconfigured secure session', async () => {
    mock.hasSecret.mockReturnValue(false);
    await expect(requireOtaFinanceScope({accountId:A,propertyId:PA,action:'read'}))
      .rejects.toMatchObject({ status:503 });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('refuses legacy scope IDs instead of resolving an arbitrary first account', async () => {
    await expect(requireOtaFinanceScope({accountId:'legacy',propertyId:PA,action:'read'}))
      .rejects.toMatchObject({status:400});
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('refuses account membership that is absent or insufficient', async () => {
    mock.from.mockReturnValue(table({ data: { role:'operator' }, error:null }));
    await expect(requireOtaFinanceScope({accountId:A,propertyId:PA,action:'import'}))
      .rejects.toMatchObject({code:'FINANCE_ACCOUNT_FORBIDDEN',status:403});
    expect(mock.from).toHaveBeenCalledTimes(1);
  });

  it('allows manager reads but denies manager imports and reviews', async () => {
    const membership=table({data:{role:'manager'},error:null});
    mock.from.mockReturnValue(membership);
    await expect(requireOtaFinanceScope({accountId:A,propertyId:PA,action:'import'}))
      .rejects.toMatchObject({code:'FINANCE_WRITE_REQUIRES_OWNER',status:403});
    expect(mock.from).toHaveBeenCalledTimes(1);
  });

  it('refuses a property belonging to another account', async () => {
    const membership=table({ data:{role:'owner'},error:null });
    const property=table({ data:null,error:null });
    mock.from.mockImplementation((name:string)=> name==='account_members'?membership:property);
    await expect(requireOtaFinanceScope({accountId:A,propertyId:PB,action:'review'}))
      .rejects.toMatchObject({code:'FINANCE_PROPERTY_FORBIDDEN',status:403});
    expect(property.eq).toHaveBeenCalledWith('account_id', A);
    expect(property.eq).toHaveBeenCalledWith('id', PB);
  });

  it('refuses missing or ambiguous booking mappings', async () => {
    const membership=table({ data:{role:'manager'},error:null });
    const property=table({ data:{id:PA,account_id:A},error:null });
    const booking=table({ data:[{id:'x'},{id:'y'}],error:null });
    mock.from.mockImplementation((name:string)=>({
      account_members:membership, properties:property, booking_ops_records:booking,
    } as Record<string, ReturnType<typeof table>>)[name]);
    await expect(requireOtaFinanceScope({accountId:A,propertyId:PA,action:'read',bookingId:'B-123'}))
      .rejects.toMatchObject({code:'FINANCE_BOOKING_SCOPE_AMBIGUOUS_OR_MISSING',status:403});
    expect(booking.eq).toHaveBeenCalledWith('account_id', A);
    expect(booking.eq).toHaveBeenCalledWith('property_id', PA);
    expect(booking.eq).toHaveBeenCalledWith('booking_id', 'B-123');
  });

  it('rejects a mismatched property returned despite scoped filters', async () => {
    const membership=table({data:{role:'owner'},error:null});
    const property=table({data:{id:PA,account_id:B},error:null});
    mock.from.mockImplementation((name:string)=>name==='account_members'?membership:property);
    await expect(requireOtaFinanceScope({accountId:A,propertyId:PA,action:'read'}))
      .rejects.toMatchObject({code:'FINANCE_PROPERTY_FORBIDDEN',status:403});
  });

  it('authorizes a booking only with the exact account/property/booking values', async () => {
    const membership=table({data:{role:'owner'},error:null});
    const property=table({data:{id:PA,account_id:A},error:null});
    const booking=table({data:[{
      id:'c1111111-1111-4111-8111-111111111111',
      account_id:A,property_id:PA,booking_id:'B-123',
    }],error:null});
    mock.from.mockImplementation((name:string)=>({
      account_members:membership, properties:property, booking_ops_records:booking,
    } as Record<string, ReturnType<typeof table>>)[name]);
    const spy=vi.spyOn(console,'info').mockImplementation(()=>{});
    try {
      await expect(requireOtaFinanceScope({accountId:A,propertyId:PA,action:'read',bookingId:'B-123'}))
        .resolves.toMatchObject({accountId:A,propertyId:PA,bookingId:'B-123'});
    } finally {spy.mockRestore();}
  });

  it('authorizes only exact matching tenant and property', async () => {
    const membership=table({ data:{role:'owner'},error:null });
    const property=table({ data:{id:PA,account_id:A},error:null });
    mock.from.mockImplementation((name:string)=>name==='account_members'?membership:property);
    const spy=vi.spyOn(console,'info').mockImplementation(()=>{});
    try {
      await expect(requireOtaFinanceScope({accountId:A,propertyId:PA,action:'read'}))
        .resolves.toMatchObject({accountId:A,propertyId:PA,actorUserId:USER,role:'owner'});
      expect(membership.eq).toHaveBeenCalledWith('user_id', USER);
      expect(membership.eq).toHaveBeenCalledWith('account_id', A);
    } finally { spy.mockRestore(); }
  });

  it('fails closed on privileged database errors', async () => {
    mock.from.mockReturnValue(table({data:null,error:{message:'database unavailable'}}));
    await expect(requireOtaFinanceScope({accountId:A,propertyId:PA,action:'fee_rule'}))
      .rejects.toMatchObject({code:'FINANCE_MEMBERSHIP_LOOKUP_UNAVAILABLE',status:503});
  });
});
