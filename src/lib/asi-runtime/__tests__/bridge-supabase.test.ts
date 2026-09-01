import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const createClient = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient,
}));

const BRIDGE_URL = 'https://bridge-isolated.supabase.co';
const BRIDGE_KEY = 'bridge-service-role-key-for-isolated-project';
const PRIMARY_URL = 'https://primary-production.supabase.co';
const PRIMARY_KEY = 'primary-service-role-key-must-not-be-used';

function mockBridgeClient() {
  const rpc = vi.fn();
  const maybeSingle = vi.fn();
  const eq2 = vi.fn(() => ({ maybeSingle, order: vi.fn(() => ({ data: [], error: null })) }));
  const eq1 = vi.fn(() => ({ eq: eq2, maybeSingle, order: vi.fn(() => ({ data: [], error: null })) }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));
  createClient.mockReturnValue({ rpc, from });
  return { rpc, from, select, eq1, eq2, maybeSingle };
}

beforeEach(() => {
  vi.resetModules();
  createClient.mockReset();
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL;
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
});

afterEach(() => {
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL;
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
});

describe('runtime bridge dedicated supabase client', () => {
  it('creates a client only from Bridge URL and service-role key', async () => {
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = BRIDGE_URL;
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
    process.env.SUPABASE_URL = PRIMARY_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = PRIMARY_KEY;
    mockBridgeClient();

    const {
      __resetRuntimeBridgeSupabaseForTests,
      runtimeBridgeSupabase,
      isRuntimeBridgeSupabaseConfigured,
    } = await import('../bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();

    expect(isRuntimeBridgeSupabaseConfigured()).toBe(true);
    void runtimeBridgeSupabase.rpc;
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      BRIDGE_URL,
      BRIDGE_KEY,
      expect.objectContaining({ auth: { persistSession: false } }),
    );
    expect(createClient.mock.calls[0][0]).not.toBe(PRIMARY_URL);
    expect(createClient.mock.calls[0][1]).not.toBe(PRIMARY_KEY);
  });

  it('treats missing Bridge URL as not configured', async () => {
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
    const { isRuntimeBridgeSupabaseConfigured, readRuntimeBridgeSupabaseConfig } = await import('../bridge-supabase');
    expect(isRuntimeBridgeSupabaseConfigured()).toBe(false);
    expect(readRuntimeBridgeSupabaseConfig()).toEqual({ ok: false });
  });

  it('treats missing Bridge service-role key as not configured', async () => {
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = BRIDGE_URL;
    const { isRuntimeBridgeSupabaseConfigured, readRuntimeBridgeSupabaseConfig } = await import('../bridge-supabase');
    expect(isRuntimeBridgeSupabaseConfigured()).toBe(false);
    expect(readRuntimeBridgeSupabaseConfig()).toEqual({ ok: false });
  });

  it('treats malformed Bridge URL as not configured', async () => {
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = 'not-a-url';
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
    const { isRuntimeBridgeSupabaseConfigured } = await import('../bridge-supabase');
    expect(isRuntimeBridgeSupabaseConfigured()).toBe(false);
  });

  it('throws a safe config error without leaking secrets', async () => {
    const {
      __resetRuntimeBridgeSupabaseForTests,
      runtimeBridgeSupabase,
      RuntimeBridgeSupabaseConfigError,
    } = await import('../bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    expect(() => runtimeBridgeSupabase.from('asi_runtime_bridge_tasks')).toThrow(RuntimeBridgeSupabaseConfigError);
    try {
      runtimeBridgeSupabase.from('x');
    } catch (error) {
      const err = error as InstanceType<typeof RuntimeBridgeSupabaseConfigError>;
      expect(err.status).toBe(503);
      expect(err.code).toBe('bridge_not_configured');
      expect(err.messageRu).toBe('Runtime Bridge не настроен.');
      expect(JSON.stringify(err)).not.toMatch(/bridge-service-role|primary-service-role|supabase\.co/i);
      expect(err.message).not.toMatch(/https?:\/\//);
      expect(err.stack ?? '').not.toMatch(BRIDGE_KEY);
    }
  });

  it('does not read NEXT_PUBLIC_ or primary SUPABASE_* for Bridge storage', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PRIMARY_URL;
    process.env.SUPABASE_URL = PRIMARY_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = PRIMARY_KEY;
    const source = readFileSync('src/lib/asi-runtime/bridge-supabase.ts', 'utf8');
    expect(source).toContain('ASI_RUNTIME_BRIDGE_SUPABASE_URL');
    expect(source).toContain('ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY');
    expect(source).not.toContain('NEXT_PUBLIC_');
    expect(source).not.toMatch(/(?<![A-Z_])SUPABASE_URL(?![A-Z_])/);
    expect(source).not.toMatch(/(?<![A-Z_])SUPABASE_SERVICE_ROLE_KEY(?![A-Z_])/);
    const { isRuntimeBridgeSupabaseConfigured } = await import('../bridge-supabase');
    expect(isRuntimeBridgeSupabaseConfigured()).toBe(false);
  });
});

describe('bridge-repository uses dedicated Bridge client', () => {
  it('does not import the primary @/lib/supabase client', () => {
    const source = readFileSync('src/lib/asi-runtime/bridge-repository.ts', 'utf8');
    expect(source).toContain("from './bridge-supabase'");
    expect(source).toContain('bridgeDb()');
    expect(source).not.toContain("@/lib/supabase");
    expect(source).not.toMatch(/from ['\"]@\/lib\/supabase['\"]/);
  });

  it('leaves primary supabase.ts on SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY', () => {
    const source = readFileSync('src/lib/supabase.ts', 'utf8');
    expect(source).toContain('SUPABASE_URL');
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(source).not.toContain('ASI_RUNTIME_BRIDGE_SUPABASE');
  });

  it('submits tasks through the mocked isolated Bridge database', async () => {
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = `${BRIDGE_URL}/rest/v1`;
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
    process.env.SUPABASE_URL = PRIMARY_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = PRIMARY_KEY;

    const { rpc } = mockBridgeClient();
    const taskRow = {
      id: '11111111-1111-4111-8111-111111111111',
      chatgpt_task_id: 'chat-1',
      conversation_id: 'conv-1',
      status: 'queued',
      attempt_count: 0,
      created_at: '2026-07-31T00:00:00.000Z',
      updated_at: '2026-07-31T00:00:00.000Z',
    };
    rpc.mockResolvedValue({ data: { task: taskRow, deduplicated: false }, error: null });

    const { __resetRuntimeBridgeSupabaseForTests } = await import('../bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { submitRuntimeBridgeTask } = await import('../bridge-repository');

    const result = await submitRuntimeBridgeTask('chatgpt-owner', {
      chatgptTaskId: 'chat-1',
      conversationId: 'conv-1',
      idempotencyKey: 'idem-1',
      task: {
        title: 'Title',
        objective: 'Objective',
        instructions: ['Do it'],
        repository: 'ASI-integration/asi-landing',
        baselineSha: '8301b36310c663818b56fb5adce92bbc0d8693a3',
      },
    });

    expect(createClient).toHaveBeenCalledWith(
      BRIDGE_URL,
      BRIDGE_KEY,
      expect.objectContaining({ auth: { persistSession: false } }),
    );
    expect(rpc).toHaveBeenCalledWith(
      'submit_asi_runtime_bridge_task',
      expect.objectContaining({
        p_client_id: 'chatgpt-owner',
        p_chatgpt_task_id: 'chat-1',
        p_idempotency_key: 'idem-1',
      }),
    );
    expect(result.task.taskId).toBe(taskRow.id);
    expect(result.deduplicated).toBe(false);
  });

  it('returns bridge_not_configured when Bridge URL is missing', async () => {
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
    const { __resetRuntimeBridgeSupabaseForTests } = await import('../bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { submitRuntimeBridgeTask, RuntimeBridgeError } = await import('../bridge-repository');
    await expect(
      submitRuntimeBridgeTask('chatgpt-owner', {
        chatgptTaskId: 'chat-1',
        conversationId: 'conv-1',
        idempotencyKey: 'idem-1',
        task: {
          title: 'Title',
          objective: 'Objective',
          instructions: ['Do it'],
          repository: 'ASI-integration/asi-landing',
          baselineSha: '8301b36310c663818b56fb5adce92bbc0d8693a3',
        },
      }),
    ).rejects.toMatchObject({ code: 'bridge_not_configured', status: 503 });
    expect(createClient).not.toHaveBeenCalled();
    try {
      await submitRuntimeBridgeTask('chatgpt-owner', {
        chatgptTaskId: 'chat-1',
        conversationId: 'conv-1',
        idempotencyKey: 'idem-1',
        task: {
          title: 'Title',
          objective: 'Objective',
          instructions: ['Do it'],
          repository: 'ASI-integration/asi-landing',
          baselineSha: '8301b36310c663818b56fb5adce92bbc0d8693a3',
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeBridgeError);
      expect(String(error)).not.toMatch(/SERVICE_ROLE|https?:\/\//i);
    }
  });

  it('returns bridge_not_configured when Bridge key is missing', async () => {
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = BRIDGE_URL;
    const { __resetRuntimeBridgeSupabaseForTests } = await import('../bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { getRuntimeBridgeTask, RuntimeBridgeError } = await import('../bridge-repository');
    await expect(getRuntimeBridgeTask('chatgpt-owner', '11111111-1111-4111-8111-111111111111'))
      .rejects.toBeInstanceOf(RuntimeBridgeError);
    await expect(getRuntimeBridgeTask('chatgpt-owner', '11111111-1111-4111-8111-111111111111'))
      .rejects.toMatchObject({ code: 'bridge_not_configured', status: 503 });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('completes runner_submit_result when pull_request artifact matches authoritative task repository', async () => {
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = `${BRIDGE_URL}/rest/v1`;
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
    const taskId = '22222222-2222-4222-8222-222222222222';
    const { rpc, maybeSingle } = mockBridgeClient();
    rpc.mockImplementation(async (name: string) => {
      if (name === 'expire_asi_runtime_bridge_owner_gates') return { data: null, error: null };
      if (name === 'complete_asi_runtime_bridge_task') return { data: true, error: null };
      return { data: null, error: null };
    });
    maybeSingle.mockResolvedValue({
      data: {
        id: taskId,
        chatgpt_task_id: 'chat-runtime',
        conversation_id: 'conv-runtime',
        status: 'running',
        attempt_count: 1,
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
        idempotency_key: 'idem-runtime',
        request_hash: 'hash-runtime',
        request: {
          title: 'Runtime task',
          objective: 'Ship runtime change.',
          instructions: ['Run focused tests.'],
          repository: 'ASI-integration/asi-os-runtime',
          baselineSha: '6b96503fdd2782e1b2ce68a145251d6066f36db8',
        },
      },
      error: null,
    });

    const { __resetRuntimeBridgeSupabaseForTests } = await import('../bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { runRuntimeBridgeRunnerOperation } = await import('../bridge-repository');

    const result = {
      schemaVersion: 'asi.runtime.result.v1' as const,
      status: 'completed' as const,
      summary: 'Done.',
      changedFiles: ['src/example.ts'],
      checks: [{ name: 'typecheck', status: 'PASS' as const }],
      artifacts: [
        { type: 'commit' as const, value: '6b96503fdd2782e1b2ce68a145251d6066f36db8' },
        { type: 'pull_request' as const, value: 'https://github.com/ASI-integration/asi-os-runtime/pull/100' },
      ],
      blockers: [],
    };

    await expect(runRuntimeBridgeRunnerOperation('chatgpt-owner', {
      operation: 'runner_submit_result',
      input: {
        runnerId: 'runner-1',
        taskId,
        leaseToken: '33333333-3333-4333-8333-333333333333',
        result,
      },
    })).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith('complete_asi_runtime_bridge_task', expect.objectContaining({
      p_task_id: taskId,
      p_result: result,
    }));
  });

  it('rejects runner_submit_result when pull_request artifact repository mismatches task repository', async () => {
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = `${BRIDGE_URL}/rest/v1`;
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
    const taskId = '44444444-4444-4444-8444-444444444444';
    const { rpc, maybeSingle } = mockBridgeClient();
    rpc.mockResolvedValue({ data: null, error: null });
    maybeSingle.mockResolvedValue({
      data: {
        id: taskId,
        chatgpt_task_id: 'chat-landing',
        conversation_id: 'conv-landing',
        status: 'running',
        attempt_count: 1,
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
        idempotency_key: 'idem-landing',
        request_hash: 'hash-landing',
        request: {
          title: 'Landing task',
          objective: 'Ship landing change.',
          instructions: ['Run focused tests.'],
          repository: 'ASI-integration/asi-landing',
          baselineSha: '8301b36310c663818b56fb5adce92bbc0d8693a3',
        },
      },
      error: null,
    });

    const { __resetRuntimeBridgeSupabaseForTests } = await import('../bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { runRuntimeBridgeRunnerOperation, RuntimeBridgeError } = await import('../bridge-repository');

    await expect(runRuntimeBridgeRunnerOperation('chatgpt-owner', {
      operation: 'runner_submit_result',
      input: {
        runnerId: 'runner-1',
        taskId,
        leaseToken: '55555555-5555-4555-8555-555555555555',
        result: {
          schemaVersion: 'asi.runtime.result.v1',
          status: 'completed',
          summary: 'Done.',
          changedFiles: ['src/example.ts'],
          checks: [{ name: 'typecheck', status: 'PASS' }],
          artifacts: [
            { type: 'pull_request', value: 'https://github.com/ASI-integration/asi-os-runtime/pull/100' },
          ],
          blockers: [],
        },
      },
    })).rejects.toMatchObject({ code: 'result_artifact_repository_mismatch', status: 400 });

    expect(rpc).not.toHaveBeenCalledWith('complete_asi_runtime_bridge_task', expect.anything());
    try {
      await runRuntimeBridgeRunnerOperation('chatgpt-owner', {
        operation: 'runner_submit_result',
        input: {
          runnerId: 'runner-1',
          taskId,
          leaseToken: '55555555-5555-4555-8555-555555555555',
          result: {
            schemaVersion: 'asi.runtime.result.v1',
            status: 'completed',
            summary: 'Done.',
            changedFiles: ['src/example.ts'],
            checks: [{ name: 'typecheck', status: 'PASS' }],
            artifacts: [
              { type: 'pull_request', value: 'https://github.com/ASI-integration/asi-os-runtime/pull/100' },
            ],
            blockers: [],
          },
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeBridgeError);
    }
  });

  it('rejects runner_submit_result when runtime task submits a landing pull_request artifact', async () => {
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = `${BRIDGE_URL}/rest/v1`;
    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
    const taskId = '66666666-6666-4666-8666-666666666666';
    const { rpc, maybeSingle } = mockBridgeClient();
    rpc.mockResolvedValue({ data: null, error: null });
    maybeSingle.mockResolvedValue({
      data: {
        id: taskId,
        chatgpt_task_id: 'chat-runtime',
        conversation_id: 'conv-runtime',
        status: 'running',
        attempt_count: 1,
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
        idempotency_key: 'idem-runtime',
        request_hash: 'hash-runtime',
        request: {
          title: 'Runtime task',
          objective: 'Ship runtime change.',
          instructions: ['Run focused tests.'],
          repository: 'ASI-integration/asi-os-runtime',
          baselineSha: '6b96503fdd2782e1b2ce68a145251d6066f36db8',
        },
      },
      error: null,
    });

    const { __resetRuntimeBridgeSupabaseForTests } = await import('../bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { runRuntimeBridgeRunnerOperation } = await import('../bridge-repository');

    await expect(runRuntimeBridgeRunnerOperation('chatgpt-owner', {
      operation: 'runner_submit_result',
      input: {
        runnerId: 'runner-1',
        taskId,
        leaseToken: '77777777-7777-4777-8777-777777777777',
        result: {
          schemaVersion: 'asi.runtime.result.v1',
          status: 'completed',
          summary: 'Done.',
          changedFiles: ['src/example.ts'],
          checks: [{ name: 'typecheck', status: 'PASS' }],
          artifacts: [
            { type: 'pull_request', value: 'https://github.com/ASI-integration/asi-landing/pull/10' },
          ],
          blockers: [],
        },
      },
    })).rejects.toMatchObject({ code: 'result_artifact_repository_mismatch', status: 400 });

    expect(rpc).not.toHaveBeenCalledWith('complete_asi_runtime_bridge_task', expect.anything());
  });
});

describe('runtime bridge configuration readiness', () => {
  it('requires client id, Bridge URL and Bridge service-role key together', async () => {
    const { resolveRuntimeBridgeClientId, isRuntimeBridgeConfigured, getRuntimeBridgeClientId } = await import('../bridge-auth');

    process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID = 'chatgpt-owner';
    expect(getRuntimeBridgeClientId()).toBe('chatgpt-owner');
    expect(isRuntimeBridgeConfigured()).toBe(false);
    expect(resolveRuntimeBridgeClientId()).toBeNull();

    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = BRIDGE_URL;
    expect(isRuntimeBridgeConfigured()).toBe(false);

    process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
    expect(isRuntimeBridgeConfigured()).toBe(true);
    expect(resolveRuntimeBridgeClientId()).toBe('chatgpt-owner');
  });

  it('chat route returns safe 503 without secrets when Bridge storage is missing', async () => {
    process.env.ASI_RUNTIME_BRIDGE_CHAT_TOKEN = 'chat-token-with-at-least-thirty-two-characters';
    process.env.ASI_RUNTIME_BRIDGE_OWNER_TOKEN = 'owner-token-with-at-least-thirty-two-characters';
    process.env.ASI_RUNTIME_BRIDGE_RUNNER_TOKEN = 'runner-token-with-at-least-thirty-two-characters';
    process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID = 'chatgpt-owner';
    // deliberately omit Bridge Supabase URL/key

    vi.doMock('../bridge-repository', () => ({
      submitRuntimeBridgeTask: vi.fn(),
      getRuntimeBridgeTask: vi.fn(),
      getRuntimeBridgeResult: vi.fn(),
      listRuntimeBridgeOwnerGates: vi.fn(),
      submitRuntimeBridgeOwnerDecision: vi.fn(),
      RuntimeBridgeError: class RuntimeBridgeError extends Error {
        constructor(public code: string, public status: number) { super(code); }
      },
    }));

    const { POST } = await import('@/app/api/internal/asi-runtime/bridge/route');
    const response = await POST(new Request('http://localhost/api/internal/asi-runtime/bridge', {
      method: 'POST',
      headers: {
        authorization: 'Bearer chat-token-with-at-least-thirty-two-characters',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        operation: 'runtime_submit_task',
        input: {
          chatgptTaskId: 'chat-1',
          conversationId: 'conv-1',
          idempotencyKey: 'idem-1',
          task: {
            title: 'Title',
            objective: 'Objective',
            instructions: ['Do it'],
            repository: 'ASI-integration/asi-landing',
            baselineSha: '8301b36310c663818b56fb5adce92bbc0d8693a3',
          },
        },
      }),
    }));
    const json = await response.json();
    expect(response.status).toBe(503);
    expect(json).toEqual({ ok: false, error: 'bridge_not_configured' });
    expect(JSON.stringify(json)).not.toMatch(/SERVICE_ROLE|TOKEN|https?:\/\/|supabase\.co/i);
  });
});
