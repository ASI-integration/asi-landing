import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const createClient = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient,
}));

const BRIDGE_URL = 'https://bridge-isolated.supabase.co';
const BRIDGE_KEY = 'bridge-service-role-key-for-isolated-project';

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    chatgpt_task_id: 'dev-console-task-abc',
    conversation_id: 'dev-console-owner-abc',
    status: 'queued',
    attempt_count: 0,
    created_at: '2026-07-30T00:00:00.000Z',
    updated_at: '2026-07-30T00:01:00.000Z',
    request: {
      title: 'Bridge task',
      objective: 'Objective',
      instructions: ['step'],
      repository: 'ASI-integration/asi-landing',
      baselineSha: 'a'.repeat(40),
    },
    ...overrides,
  };
}

function mockListTasksClient(
  rows: Record<string, unknown>[],
  options?: { onExpire?: () => void },
) {
  const limit = vi.fn(async () => ({ data: rows, error: null }));
  const order = vi.fn(() => ({ limit }));
  const eqConversation = vi.fn(() => ({ order }));
  const eqClient = vi.fn(() => ({ eq: eqConversation }));
  const select = vi.fn(() => ({ eq: eqClient }));
  const from = vi.fn(() => ({ select }));
  const expireRpc = vi.fn(async () => {
    options?.onExpire?.();
    return { error: null };
  });
  createClient.mockReturnValue({ rpc: expireRpc, from });
  return { from, select, eqClient, eqConversation, order, limit, expireRpc };
}

function mockBridgeTaskStore(
  rows: Record<string, unknown>[],
  options?: { onExpire?: () => void },
) {
  const expireRpc = vi.fn(async () => {
    options?.onExpire?.();
    return { error: null };
  });
  const from = vi.fn((table: string) => {
    if (table !== 'asi_runtime_bridge_tasks') {
      throw new Error(`Unexpected table: ${table}`);
    }
    return {
      select: vi.fn((_columns: string, selectOptions?: { head?: boolean }) => {
        if (selectOptions?.head) {
          return {
            limit: vi.fn(async () => ({ data: null, error: null })),
          };
        }
        return {
          eq: vi.fn((column: string, value: string) => {
            if (column === 'client_id') {
              return {
                eq: vi.fn((nextColumn: string, nextValue: string) => {
                  if (nextColumn === 'conversation_id') {
                    return {
                      order: vi.fn(() => ({
                        limit: vi.fn(async () => ({
                          data: rows.filter((row) => row.conversation_id === nextValue),
                          error: null,
                        })),
                      })),
                    };
                  }
                  if (nextColumn === 'id') {
                    const row = rows.find((candidate) => candidate.id === nextValue) ?? null;
                    return {
                      maybeSingle: vi.fn(async () => ({ data: row, error: null })),
                    };
                  }
                  throw new Error(`Unexpected eq column: ${nextColumn}`);
                }),
              };
            }
            throw new Error(`Unexpected eq column: ${column}`);
          }),
        };
      }),
    };
  });
  createClient.mockReturnValue({ rpc: expireRpc, from });
  return { from, expireRpc };
}

beforeEach(() => {
  vi.resetModules();
  createClient.mockReset();
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = BRIDGE_URL;
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
  process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID = 'chatgpt-owner';
});

afterEach(() => {
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL;
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID;
});

describe('listRuntimeBridgeTasks', () => {
  it('reads the durable queue table with client and conversation isolation', async () => {
    const row = baseRow();
    const chain = mockListTasksClient([row]);
    const { listRuntimeBridgeTasks } = await import('../bridge-repository');

    const tasks = await listRuntimeBridgeTasks('chatgpt-owner', 'dev-console-owner-abc', { limit: 5 });

    expect(chain.expireRpc).toHaveBeenCalledWith('expire_asi_runtime_bridge_owner_gates', {
      p_client_id: 'chatgpt-owner',
    });
    expect(chain.from).toHaveBeenCalledWith('asi_runtime_bridge_tasks');
    expect(chain.eqClient).toHaveBeenCalledWith('client_id', 'chatgpt-owner');
    expect(chain.eqConversation).toHaveBeenCalledWith('conversation_id', 'dev-console-owner-abc');
    expect(chain.order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(tasks).toEqual([
      expect.objectContaining({
        taskId: row.id,
        title: 'Bridge task',
        repository: 'ASI-integration/asi-landing',
      }),
    ]);
  });

  it('caps list size to the bridge maximum', async () => {
    const chain = mockListTasksClient([]);
    const { listRuntimeBridgeTasks } = await import('../bridge-repository');
    await listRuntimeBridgeTasks('chatgpt-owner', 'dev-console-owner-abc', { limit: 999 });
    expect(chain.limit).toHaveBeenCalledWith(50);
  });

  it('keeps live awaiting_owner tasks as awaiting_owner in list results', async () => {
    const row = baseRow({ status: 'awaiting_owner' });
    mockListTasksClient([row]);
    const { listRuntimeBridgeTasks } = await import('../bridge-repository');

    const tasks = await listRuntimeBridgeTasks('chatgpt-owner', 'dev-console-owner-abc');

    expect(tasks[0]?.status).toBe('awaiting_owner');
  });

  it('converges expired owner gates before returning list items', async () => {
    const row = baseRow({ status: 'awaiting_owner' });
    const chain = mockListTasksClient([row], {
      onExpire: () => {
        row.status = 'failed';
      },
    });
    const { listRuntimeBridgeTasks } = await import('../bridge-repository');

    const tasks = await listRuntimeBridgeTasks('chatgpt-owner', 'dev-console-owner-abc');

    expect(chain.expireRpc).toHaveBeenCalledBefore(chain.from as unknown as ReturnType<typeof vi.fn>);
    expect(tasks[0]?.status).toBe('failed');
  });

  it('returns the same authoritative status from list and detail after convergence', async () => {
    const row = baseRow({ status: 'awaiting_owner' });
    mockBridgeTaskStore([row], {
      onExpire: () => {
        row.status = 'failed';
      },
    });
    const { listRuntimeBridgeTasks, getRuntimeBridgeTask } = await import('../bridge-repository');

    const tasks = await listRuntimeBridgeTasks('chatgpt-owner', 'dev-console-owner-abc');
    const detail = await getRuntimeBridgeTask('chatgpt-owner', String(row.id));

    expect(tasks[0]?.status).toBe('failed');
    expect(detail.status).toBe('failed');
  });
});
