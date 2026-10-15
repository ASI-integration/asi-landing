import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ subscription: null as null | { status: string }, queryErrors: [] as string[] }));
vi.mock('next/headers', () => ({ headers: () => ({ get: () => '' }) }));
vi.mock('@/lib/auth', () => ({ isSessionSecretConfigured: () => true, getSession: async () => ({ userId: 'synthetic-operator', email: 'operator@example.invalid' }) }));
vi.mock('@/lib/getIsRuHost', () => ({ getIsRuHost: async () => false }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  const result = () => ({ data: table === 'subscriptions' ? fixture.subscription : null, error: null });
  const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
    single: async () => { if (!result().data) { fixture.queryErrors.push('PGRST116'); return { data: null, error: { code: 'PGRST116' } }; } return result(); },
    maybeSingle: async () => result() };
  return query;
} } }));
import { GET } from '../route';

beforeEach(() => { fixture.subscription = null; fixture.queryErrors = []; });
describe('optional operator subscription', () => {
  it('treats an absent subscription as optional without a singular-query error', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(fixture.queryErrors).toEqual([]);
    expect(await response.json()).toMatchObject({ user: { id: 'synthetic-operator' }, subscription: null });
  });
  it('preserves an existing subscription projection', async () => {
    fixture.subscription = { status: 'active' };
    expect(await (await GET()).json()).toMatchObject({ subscription: { status: 'active' } });
  });
});
