import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const createClient = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient,
}));

const BRIDGE_URL = 'https://asi-staging.supabase.co';
const BRIDGE_KEY = 'staging-service-role-key-shared-project-not-a-secret';
const STAGING_SQL = 'supabase/staging/20260909170000_runtime_bridge_schema_free_tier.sql';
const PRODUCTION_SQL = 'supabase/migrations/20260724120000_asi_chat_runtime_bridge_v1.sql';
const FREE_TIER_NOTE =
  'Free-tier staging exception: Bridge shares the staging Supabase project but uses dedicated runtime_bridge schema. Production requires isolated Bridge storage.';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ROW = {
  id: TASK_ID,
  chatgpt_task_id: 'chat-1',
  conversation_id: 'conv-1',
  status: 'queued',
  attempt_count: 0,
  created_at: '2026-09-09T00:00:00.000Z',
  updated_at: '2026-09-09T00:00:00.000Z',
  idempotency_key: 'idem-1',
  request_hash: 'a'.repeat(64),
  request: {
    title: 'Title',
    objective: 'Objective',
    instructions: ['Do it'],
    repository: 'ASI-integration/asi-landing' as const,
    baselineSha: '8301b36310c663818b56fb5adce92bbc0d8693a3',
  },
  result: {
    schemaVersion: 'asi.runtime.result.v1',
    status: 'completed',
    summary: 'Done.',
    changedFiles: [],
    checks: [],
    artifacts: [],
    blockers: [],
  },
};

function mockBridgeStore() {
  const rpc = vi.fn();
  const maybeSingle = vi.fn();
  const limit = vi.fn();
  const order = vi.fn(() => ({ limit }));
  const eqId = vi.fn(() => ({ maybeSingle }));
  const eqConversation = vi.fn(() => ({ order, maybeSingle: eqId().maybeSingle, eq: eqId }));
  const eqClient = vi.fn(() => ({ eq: eqConversation }));
  const select = vi.fn(() => ({ eq: eqClient }));
  const from = vi.fn((table: string) => {
    if (table !== 'asi_runtime_bridge_tasks') {
      throw new Error(`unexpected_table:${table}`);
    }
    return { select };
  });
  createClient.mockReturnValue({ rpc, from });
  return { rpc, from, select, eqClient, eqConversation, eqId, order, limit, maybeSingle };
}

beforeEach(() => {
  vi.resetModules();
  createClient.mockReset();
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = BRIDGE_URL;
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SCHEMA = 'runtime_bridge';
  process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID = 'chatgpt-owner';
});

afterEach(() => {
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL;
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SCHEMA;
  delete process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID;
});

describe('staging runtime_bridge schema SQL', () => {
  it('creates runtime_bridge.asi_runtime_bridge_tasks without touching public app tables', () => {
    const sql = readFileSync(STAGING_SQL, 'utf8');
    const original = readFileSync(PRODUCTION_SQL, 'utf8');

    expect(sql).toContain(FREE_TIER_NOTE);
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS runtime_bridge');
    expect(sql).toContain('CREATE TABLE runtime_bridge.asi_runtime_bridge_tasks');
    expect(sql).toContain('CREATE TABLE runtime_bridge.asi_runtime_bridge_owner_gates');
    expect(sql).not.toMatch(/\bpublic\./);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+public\./i);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\s+public\./i);
    expect(sql).not.toMatch(/\bCREATE\s+TABLE\s+public\./i);

    expect(sql).toContain('idx_asi_runtime_bridge_queue');
    expect(sql).toContain('idx_asi_runtime_bridge_chat_identity');
    expect(sql).toContain('idx_asi_runtime_bridge_pending_gates');
    expect(sql).toContain('idx_asi_runtime_bridge_owner_decision_once');
    expect(sql).toContain('idx_asi_runtime_bridge_single_running');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION');
    expect(sql.match(/SET search_path = pg_catalog/g)).toHaveLength(8);
    expect(sql).toContain('CREATE FUNCTION runtime_bridge.submit_asi_runtime_bridge_task');
    expect(sql).toContain('CREATE FUNCTION runtime_bridge.claim_asi_runtime_bridge_task');
    expect(sql).toContain('CREATE FUNCTION runtime_bridge.heartbeat_asi_runtime_bridge_task');
    expect(sql).toContain('CREATE FUNCTION runtime_bridge.complete_asi_runtime_bridge_task');
    expect(sql).toContain('CREATE FUNCTION runtime_bridge.gate_asi_runtime_bridge_task');
    expect(sql).toContain('CREATE FUNCTION runtime_bridge.expire_asi_runtime_bridge_owner_gates');
    expect(sql).toContain('CREATE FUNCTION runtime_bridge.fail_asi_runtime_bridge_task');
    expect(sql).toContain('CREATE FUNCTION runtime_bridge.decide_asi_runtime_bridge_owner_gate');
    expect(sql).toContain('idempotency_conflict');
    expect(sql).toContain('pg_advisory_xact_lock');

    expect(original).toContain('CREATE TABLE public.asi_runtime_bridge_tasks');
    expect(original).toContain('CREATE FUNCTION public.submit_asi_runtime_bridge_task');
    expect(original).not.toMatch(/CREATE SCHEMA IF NOT EXISTS runtime_bridge/);
    expect(original).not.toMatch(/CREATE TABLE runtime_bridge\./);
    expect(original).not.toMatch(/CREATE FUNCTION runtime_bridge\./);
  });

  it('keeps the staging SQL outside the production migration chain', () => {
    const deploy = readFileSync('.github/workflows/deploy-staging.yml', 'utf8');
    const productionDeploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    expect(deploy).toContain('ASI_RUNTIME_BRIDGE_SUPABASE_SCHEMA=runtime_bridge');
    expect(deploy).toContain(FREE_TIER_NOTE);
    expect(productionDeploy).not.toContain('ASI_RUNTIME_BRIDGE_SUPABASE_SCHEMA');
    expect(productionDeploy).not.toContain('runtime_bridge');
  });
});

describe('Bridge client create/list/read against runtime_bridge', () => {
  it('creates, lists, and reads status/result through asi_runtime_bridge_tasks', async () => {
    const chain = mockBridgeStore();
    chain.rpc.mockImplementation(async (name: string) => {
      if (name === 'submit_asi_runtime_bridge_task') {
        return { data: { task: TASK_ROW, deduplicated: false }, error: null };
      }
      if (name === 'expire_asi_runtime_bridge_owner_gates') {
        return { data: 0, error: null };
      }
      return { data: null, error: null };
    });
    chain.limit.mockResolvedValue({ data: [TASK_ROW], error: null });
    chain.maybeSingle.mockResolvedValue({ data: TASK_ROW, error: null });

    const { __resetRuntimeBridgeSupabaseForTests } = await import('../bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const {
      submitRuntimeBridgeTask,
      listRuntimeBridgeTasks,
      getRuntimeBridgeTask,
      getRuntimeBridgeResult,
    } = await import('../bridge-repository');

    const created = await submitRuntimeBridgeTask('chatgpt-owner', {
      chatgptTaskId: 'chat-1',
      conversationId: 'conv-1',
      idempotencyKey: 'idem-1',
      task: TASK_ROW.request,
    });
    const listed = await listRuntimeBridgeTasks('chatgpt-owner', 'conv-1', { limit: 10 });
    const status = await getRuntimeBridgeTask('chatgpt-owner', TASK_ID);
    const result = await getRuntimeBridgeResult('chatgpt-owner', TASK_ID);

    expect(createClient).toHaveBeenCalledWith(
      BRIDGE_URL,
      BRIDGE_KEY,
      expect.objectContaining({ db: { schema: 'runtime_bridge' } }),
    );
    expect(chain.rpc).toHaveBeenCalledWith(
      'submit_asi_runtime_bridge_task',
      expect.objectContaining({
        p_client_id: 'chatgpt-owner',
        p_chatgpt_task_id: 'chat-1',
        p_conversation_id: 'conv-1',
      }),
    );
    expect(chain.from).toHaveBeenCalledWith('asi_runtime_bridge_tasks');
    expect(chain.from.mock.calls.every((call) => call[0] === 'asi_runtime_bridge_tasks')).toBe(true);
    expect(created.task.taskId).toBe(TASK_ID);
    expect(listed).toEqual([
      expect.objectContaining({
        taskId: TASK_ID,
        title: 'Title',
        status: 'queued',
      }),
    ]);
    expect(status).toEqual(expect.objectContaining({ taskId: TASK_ID, status: 'queued' }));
    expect(result).toEqual({
      taskId: TASK_ID,
      status: 'queued',
      result: TASK_ROW.result,
    });
  });
});
