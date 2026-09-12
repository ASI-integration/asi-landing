import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertExecutorCompatiblePilotEnvelope,
  buildPilotClaimableEnvelope,
  PILOT_PROVENANCE_KIND,
  PILOT_PROVENANCE_MARKER,
  PILOT_PROVENANCE_PROFILE,
  taskRequestHasPilotProvenance,
} from '../provenance';
import { createPilotConversationId } from '../ids';
import { resetPilotCreateRateLimitForTests } from '../rate-limit';
import { PILOT_FIXED_REPOSITORY, PILOT_TEMPLATE_ID } from '../template';

vi.mock('server-only', () => ({}));

const createClient = vi.hoisted(() => vi.fn());
const resolveAllowlistedBaselineSha = vi.fn();
const assertPilotSubmissionReady = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient,
}));

vi.mock('../readiness', () => ({
  assertPilotSubmissionReady,
  getPilotReadiness: vi.fn(),
}));

vi.mock('@/lib/development/baseline-sha', async () => {
  const actual = await vi.importActual<typeof import('@/lib/development/baseline-sha')>(
    '@/lib/development/baseline-sha',
  );
  return {
    ...actual,
    resolveAllowlistedBaselineSha,
  };
});

type DurableRow = {
  id: string;
  client_id: string;
  chatgpt_task_id: string;
  conversation_id: string;
  idempotency_key: string;
  request_hash: string;
  request: Record<string, unknown>;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'awaiting_owner';
  attempt_count: number;
  created_at: string;
  updated_at: string;
  result: Record<string, unknown> | null;
  lease_token: string | null;
};

const BRIDGE_URL = 'https://bridge-isolated.supabase.co';
const BRIDGE_KEY = 'bridge-service-role-key-for-isolated-project';
const BASELINE = 'c'.repeat(40);
const NOW = '2026-09-08T12:00:00.000Z';

function installDurableBridgeMock(store: { rows: DurableRow[] }) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'expire_asi_runtime_bridge_owner_gates') {
      return { data: null, error: null };
    }
    if (fn === 'submit_asi_runtime_bridge_task') {
      const clientId = String(args.p_client_id);
      const key = String(args.p_idempotency_key);
      const existing = store.rows.find((row) => row.client_id === clientId && row.idempotency_key === key);
      if (existing) {
        if (
          existing.request_hash !== args.p_request_hash
          || existing.chatgpt_task_id !== args.p_chatgpt_task_id
          || existing.conversation_id !== args.p_conversation_id
        ) {
          return { data: null, error: { message: 'idempotency_conflict' } };
        }
        return {
          data: {
            deduplicated: true,
            task: {
              id: existing.id,
              chatgpt_task_id: existing.chatgpt_task_id,
              conversation_id: existing.conversation_id,
              status: existing.status,
              attempt_count: existing.attempt_count,
              created_at: existing.created_at,
              updated_at: existing.updated_at,
            },
          },
          error: null,
        };
      }
      if (store.rows.some((row) => (
        row.status === 'queued' || row.status === 'running' || row.status === 'awaiting_owner'
      ))) {
        return { data: null, error: { message: 'admission_busy' } };
      }
      const row: DurableRow = {
        id: randomUUID(),
        client_id: clientId,
        chatgpt_task_id: String(args.p_chatgpt_task_id),
        conversation_id: String(args.p_conversation_id),
        idempotency_key: key,
        request_hash: String(args.p_request_hash),
        request: args.p_request as Record<string, unknown>,
        status: 'queued',
        attempt_count: 0,
        created_at: NOW,
        updated_at: NOW,
        result: null,
        lease_token: null,
      };
      store.rows.push(row);
      return {
        data: {
          deduplicated: false,
          task: {
            id: row.id,
            chatgpt_task_id: row.chatgpt_task_id,
            conversation_id: row.conversation_id,
            status: row.status,
            attempt_count: row.attempt_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
          },
        },
        error: null,
      };
    }
    return { data: null, error: { message: `unexpected_rpc:${fn}` } };
  });

  const from = vi.fn((table: string) => {
    if (table !== 'asi_runtime_bridge_tasks') {
      throw new Error(`unexpected_table:${table}`);
    }
    const state: {
      columns: string;
      filters: Array<[string, string]>;
      limit?: number;
      orderDesc?: boolean;
    } = { columns: '*', filters: [] };

    const api = {
      select(columns: string) {
        state.columns = columns;
        return api;
      },
      eq(column: string, value: string) {
        state.filters.push([column, value]);
        return api;
      },
      order(_column: string, opts?: { ascending?: boolean }) {
        state.orderDesc = opts?.ascending === false;
        return api;
      },
      limit(n: number) {
        state.limit = n;
        let matched = store.rows.filter((row) => state.filters.every(([column, value]) => {
          if (column === 'client_id') return row.client_id === value;
          if (column === 'conversation_id') return row.conversation_id === value;
          return true;
        }));
        if (state.orderDesc) matched = [...matched].reverse();
        matched = matched.slice(0, n);
        return Promise.resolve({ data: matched, error: null });
      },
      maybeSingle: async () => {
        const matched = store.rows.filter((row) => state.filters.every(([column, value]) => {
          if (column === 'client_id') return row.client_id === value;
          if (column === 'id') return row.id === value;
          if (column === 'idempotency_key') return row.idempotency_key === value;
          if (column === 'conversation_id') return row.conversation_id === value;
          return false;
        }));
        const data = matched[0] ?? null;
        return { data, error: null };
      },
    };

    return api;
  });

  createClient.mockReturnValue({ rpc, from });
  return { rpc, from };
}

beforeEach(() => {
  vi.resetModules();
  createClient.mockReset();
  resolveAllowlistedBaselineSha.mockReset();
  resolveAllowlistedBaselineSha.mockResolvedValue(BASELINE);
  assertPilotSubmissionReady.mockReset();
  assertPilotSubmissionReady.mockResolvedValue({
    state: 'ready',
    canSubmit: true,
    messageRu: 'ok',
    checkedAt: NOW,
  });
  resetPilotCreateRateLimitForTests();
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = BRIDGE_URL;
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
  process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID = 'pilot-bridge-client';
});

afterEach(() => {
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL;
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID;
  vi.clearAllMocks();
});

describe('SP-06 provenance helpers', () => {
  it('exports stable pilot / strigunov_pilot_v1 markers', () => {
    expect(PILOT_PROVENANCE_KIND).toBe('pilot');
    expect(PILOT_PROVENANCE_PROFILE).toBe('strigunov_pilot_v1');
    expect(PILOT_PROVENANCE_MARKER).toContain('pilot');
    expect(PILOT_PROVENANCE_MARKER).toContain('strigunov_pilot_v1');
    expect(PILOT_TEMPLATE_ID).toBe('strigunov_pilot_green_v1');
  });
});

describe('SP-06 Bridge handoff integration harness', () => {
  it('submits through real Bridge adapter, becomes claimable, completes, and is readable via pilot path', async () => {
    const store = { rows: [] as DurableRow[] };
    installDurableBridgeMock(store);

    const { __resetRuntimeBridgeSupabaseForTests } = await import('@/lib/asi-runtime/bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();

    const { submitPilotTask } = await import('../task-service');
    const { getPilotTaskDetailForUser, listPilotTasksForUser } = await import('../task-access');

    const pilotUserId = 'pilot-handoff-user';
    const created = await submitPilotTask({
      pilotUserId,
      body: {
        goal: 'Add a proof markdown under docs/pilot/ for SP-06 handoff harness.',
        title: 'SP-06 proof',
        idempotencyKey: 'pilot-beta-idem-sp06-handoff-1',
      },
    });

    expect(created.deduplicated).toBe(false);
    expect(created.task.status).toBe('queued');
    expect(created.task.consoleStatus).toBe('queued');
    expect(store.rows).toHaveLength(1);

    const row = store.rows[0]!;
    expect(row.status).toBe('queued');
    expect(row.conversation_id).toBe(createPilotConversationId(pilotUserId));
    expect(row.request.repository).toBe(PILOT_FIXED_REPOSITORY);
    expect(row.request.baselineSha).toBe(BASELINE);
    expect(taskRequestHasPilotProvenance(row.request as never)).toBe(true);

    // Simulate existing runner claim (no second execution path).
    row.status = 'running';
    row.attempt_count = 1;
    row.lease_token = randomUUID();
    row.updated_at = '2026-09-08T12:01:00.000Z';

    const envelope = buildPilotClaimableEnvelope({
      taskId: row.id,
      leaseToken: row.lease_token,
      chatgptTaskId: row.chatgpt_task_id,
      conversationId: row.conversation_id,
      attemptCount: row.attempt_count,
      request: row.request as never,
    });
    expect(() => assertExecutorCompatiblePilotEnvelope(envelope)).not.toThrow();

    // Simulate executor terminal persistence on the Bridge row.
    row.status = 'completed';
    row.result = {
      schemaVersion: 'asi.runtime.result.v1',
      status: 'completed',
      summary: 'SP-06 harness proof written under docs/pilot/',
      changedFiles: ['docs/pilot/sp06-proof.md'],
      checks: [{ name: 'harness', status: 'PASS' }],
      artifacts: [{ type: 'commit', value: 'd'.repeat(40) }],
      blockers: [],
    };
    row.lease_token = null;
    row.updated_at = '2026-09-08T12:02:00.000Z';

    const listed = await listPilotTasksForUser(pilotUserId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.taskId).toBe(row.id);
    expect(listed[0]?.consoleStatus).toBe('succeeded');

    const detail = await getPilotTaskDetailForUser(row.id, pilotUserId);
    expect(detail.task.consoleStatus).toBe('succeeded');
    expect(detail.result.outcome).toBe('succeeded');
    expect(detail.result.summary).toContain('SP-06');
    expect(detail.result.changedFiles).toEqual(['docs/pilot/sp06-proof.md']);
    expect(detail.result.commitSha).toBe('d'.repeat(40));
    expect(JSON.stringify(detail)).not.toMatch(/SERVICE_ROLE|leaseToken|schemaVersion/i);

    // Idempotent resubmit reuses the same durable Bridge row.
    const again = await submitPilotTask({
      pilotUserId,
      body: {
        goal: 'Add a proof markdown under docs/pilot/ for SP-06 handoff harness.',
        title: 'SP-06 proof',
        idempotencyKey: 'pilot-beta-idem-sp06-handoff-1',
      },
    });
    expect(again.deduplicated).toBe(true);
    expect(again.task.taskId).toBe(row.id);
    expect(store.rows).toHaveLength(1);
  });

  it('rejects a second create while the first task is still non-terminal', async () => {
    const store = { rows: [] as DurableRow[] };
    installDurableBridgeMock(store);
    const { __resetRuntimeBridgeSupabaseForTests } = await import('@/lib/asi-runtime/bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { submitPilotTask } = await import('../task-service');

    await submitPilotTask({
      pilotUserId: 'pilot-handoff-user',
      body: {
        goal: 'Add a proof markdown under docs/pilot/ for SP-06 handoff harness.',
        title: 'SP-06 proof',
        idempotencyKey: 'pilot-beta-idem-sp06-first',
      },
    });
    store.rows[0]!.status = 'awaiting_owner';

    await expect(submitPilotTask({
      pilotUserId: 'pilot-handoff-user',
      body: {
        goal: 'Add a second proof markdown under docs/pilot/.',
        title: 'SP-06 second',
        idempotencyKey: 'pilot-beta-idem-sp06-second',
      },
    })).rejects.toMatchObject({
      code: 'admission_busy',
      status: 503,
      messageRu: 'Временно недоступно',
    });
    expect(store.rows).toHaveLength(1);
  });

  it('returns a safe failure when Bridge storage is not configured (no fake success)', async () => {
    delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL;
    delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY;

    const { __resetRuntimeBridgeSupabaseForTests } = await import('@/lib/asi-runtime/bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { submitPilotTask } = await import('../task-service');
    const { PilotAccessError } = await import('../errors');

    await expect(submitPilotTask({
      pilotUserId: 'pilot-handoff-user',
      body: {
        goal: 'Add a proof markdown under docs/pilot/.',
        idempotencyKey: 'pilot-beta-idem-sp06-unconfigured',
      },
    })).rejects.toMatchObject({
      code: 'bridge_not_configured',
      status: 503,
    });
    await expect(submitPilotTask({
      pilotUserId: 'pilot-handoff-user',
      body: {
        goal: 'Add a proof markdown under docs/pilot/.',
        idempotencyKey: 'pilot-beta-idem-sp06-unconfigured',
      },
    })).rejects.toBeInstanceOf(PilotAccessError);
  });
});
