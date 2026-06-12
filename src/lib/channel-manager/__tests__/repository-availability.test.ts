import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

let mockResult: QueryResult = { data: [], error: null };

vi.mock('@/lib/supabase', () => {
  const makeStub = () => {
    const stub: Record<string, unknown> = {};
    const chain = () => stub;
    for (const method of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'gte', 'lt', 'order', 'limit']) {
      stub[method] = chain;
    }
    stub.single = async () => mockResult;
    stub.maybeSingle = async () => mockResult;
    stub.then = (resolve: (value: QueryResult) => unknown) => resolve(mockResult);
    return stub;
  };
  return { supabase: { from: () => makeStub() } };
});

import { listChannelManagerState, ChannelManagerUnavailableError } from '../repository';

const ctx = { accountId: 'account-1', userId: 'user-1' };

beforeEach(() => {
  mockResult = { data: [], error: null };
});

describe('listChannelManagerState availability', () => {
  it('returns an empty state (no throw) when data is genuinely empty', async () => {
    mockResult = { data: [], error: null };

    const state = await listChannelManagerState(ctx, 'prop-1');

    expect(state.channels).toEqual([]);
    expect(state.reservations).toEqual([]);
    expect(state.syncLogs).toEqual([]);
    expect(state.shadowDiscrepancies).toEqual([]);
    expect(state.bronevikMtsTravel).toBeNull();
  });

  it('degrades to an empty state when the table is missing (Postgres 42P01)', async () => {
    mockResult = { data: null, error: { message: 'relation "cm_channels" does not exist', code: '42P01' } };

    const state = await listChannelManagerState(ctx, 'prop-1');

    expect(state.channels).toEqual([]);
    expect(state.bronevikMtsTravel).toBeNull();
  });

  it('degrades to an empty state on a stale PostgREST schema cache (PGRST205)', async () => {
    mockResult = {
      data: null,
      error: { message: "Could not find the table 'public.cm_channels' in the schema cache", code: 'PGRST205' },
    };

    const state = await listChannelManagerState(ctx, 'prop-1');

    expect(state.channels).toEqual([]);
  });

  it('still throws on a genuine database failure', async () => {
    mockResult = { data: null, error: { message: 'connection timeout' } };

    await expect(listChannelManagerState(ctx, 'prop-1')).rejects.not.toBeInstanceOf(
      ChannelManagerUnavailableError,
    );
    await expect(listChannelManagerState(ctx, 'prop-1')).rejects.toThrow('connection timeout');
  });
});
