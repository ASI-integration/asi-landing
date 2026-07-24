import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRuntimeBridgeAuthorized } from '../bridge-auth';
import { runtimeBridgeRequestHash } from '../bridge-hash';
import { parseRuntimeBridgeChatInput, parseRuntimeBridgeRunnerInput } from '../bridge-schema';

const repository = vi.hoisted(() => ({
  submitRuntimeBridgeTask: vi.fn(),
  getRuntimeBridgeTask: vi.fn(),
  getRuntimeBridgeResult: vi.fn(),
  listRuntimeBridgeOwnerGates: vi.fn(),
  submitRuntimeBridgeOwnerDecision: vi.fn(),
}));

vi.mock('../bridge-repository', () => ({
  ...repository,
  RuntimeBridgeError: class RuntimeBridgeError extends Error {
    constructor(public code: string, public status: number) { super(code); }
  },
}));

const TOKEN = 'chat-token-with-at-least-thirty-two-characters';
const task = {
  title: 'Implement bridge',
  objective: 'Return a safe, verified result.',
  instructions: ['Use focused tests.'],
  repository: 'ASI-integration/asi-landing',
  baselineSha: '8301b36310c663818b56fb5adce92bbc0d8693a3',
};
const submit = {
  operation: 'runtime_submit_task',
  input: {
    chatgptTaskId: 'chat-task-1',
    conversationId: 'conversation-1',
    idempotencyKey: 'decision-1',
    task,
  },
};

function request(body: unknown, authorization = `Bearer ${TOKEN}`, contentType = 'application/json'): Request {
  return new Request('http://localhost/api/internal/asi-runtime/bridge', {
    method: 'POST',
    headers: { authorization, 'content-type': contentType },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  Object.values(repository).forEach((mock) => mock.mockReset());
  process.env.ASI_RUNTIME_BRIDGE_CHAT_TOKEN = TOKEN;
  process.env.ASI_RUNTIME_BRIDGE_OWNER_TOKEN = 'owner-token-with-at-least-thirty-two-characters';
  process.env.ASI_RUNTIME_BRIDGE_RUNNER_TOKEN = 'runner-token-with-at-least-thirty-two-characters';
  process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID = 'chatgpt-owner';
});

afterEach(() => {
  delete process.env.ASI_RUNTIME_BRIDGE_CHAT_TOKEN;
  delete process.env.ASI_RUNTIME_BRIDGE_OWNER_TOKEN;
  delete process.env.ASI_RUNTIME_BRIDGE_RUNNER_TOKEN;
  delete process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID;
});

describe('runtime bridge authentication and schemas', () => {
  it('requires an exact Bearer scheme and a configured high-entropy token', () => {
    expect(isRuntimeBridgeAuthorized(request({}, TOKEN), 'chat')).toBe(false);
    expect(isRuntimeBridgeAuthorized(request({}, `Basic ${TOKEN}`), 'chat')).toBe(false);
    expect(isRuntimeBridgeAuthorized(request({}, `Bearer ${TOKEN} extra`), 'chat')).toBe(false);
    expect(isRuntimeBridgeAuthorized(request({}), 'chat')).toBe(true);
    delete process.env.ASI_RUNTIME_BRIDGE_CHAT_TOKEN;
    expect(isRuntimeBridgeAuthorized(request({}), 'chat')).toBe(false);
  });

  it('fails closed when Chat and runner credentials are equal', () => {
    process.env.ASI_RUNTIME_BRIDGE_RUNNER_TOKEN = TOKEN;
    expect(isRuntimeBridgeAuthorized(request({}), 'chat')).toBe(false);
  });

  it('hashes semantically identical task objects canonically', () => {
    expect(runtimeBridgeRequestHash({ title: 'x', nested: { b: 2, a: 1 } }))
      .toBe(runtimeBridgeRequestHash({ nested: { a: 1, b: 2 }, title: 'x' }));
  });

  it('accepts the strict submit contract and rejects executable or identity extras', () => {
    expect(parseRuntimeBridgeChatInput(submit)?.operation).toBe('runtime_submit_task');
    expect(parseRuntimeBridgeChatInput({ ...submit, input: { ...submit.input, command: 'npm test' } })).toBeNull();
    expect(parseRuntimeBridgeChatInput({ ...submit, input: { ...submit.input, ownerId: 'attacker' } })).toBeNull();
  });

  it('rejects secrets and local paths in task content', () => {
    expect(parseRuntimeBridgeChatInput({
      ...submit,
      input: { ...submit.input, task: { ...task, objective: 'Use Bearer secret-token-value-123456' } },
    })).toBeNull();
    expect(parseRuntimeBridgeChatInput({
      ...submit,
      input: { ...submit.input, task: { ...task, objective: 'Read C:\\Users\\Admin\\secret.txt' } },
    })).toBeNull();
  });

  it('only accepts an explicit owner-message decision bound to task, gate and cycle', () => {
    const value = {
      operation: 'runtime_submit_owner_decision',
      input: {
        taskId: randomUUID(), gateId: randomUUID(), decisionId: 'owner-message-1',
        taskCycle: 'cycle-1', decision: 'approved', source: 'explicit_owner_message',
      },
    };
    expect(parseRuntimeBridgeChatInput(value)?.operation).toBe('runtime_submit_owner_decision');
    expect(parseRuntimeBridgeChatInput({ ...value, input: { ...value.input, source: 'typed_confirmation' } })).toBeNull();
  });

  it('accepts only safe machine-readable runner results', () => {
    const base = {
      operation: 'runner_submit_result',
      input: {
        runnerId: 'runner-1', taskId: randomUUID(), leaseToken: randomUUID(),
        result: {
          schemaVersion: 'asi.runtime.result.v1', status: 'completed', summary: 'Done.',
          changedFiles: ['src/example.ts'], checks: [{ name: 'typecheck', status: 'PASS' }],
          artifacts: [], blockers: [],
        },
      },
    };
    expect(parseRuntimeBridgeRunnerInput(base)?.operation).toBe('runner_submit_result');
    expect(parseRuntimeBridgeRunnerInput({
      ...base,
      input: { ...base.input, result: { ...base.input.result, stdout: 'raw log' } },
    })).toBeNull();
  });

  it('rejects expired owner gates before persistence', () => {
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_submit_owner_gate',
      input: {
        runnerId: 'runner-1', taskId: randomUUID(), leaseToken: randomUUID(),
        gate: {
          schemaVersion: 'asi.runtime.owner-gate.v1', action: 'deploy', exactTarget: 'production',
          identity: 'sha', reason: 'approval required', evidence: [], allowedSideEffect: 'deploy',
          rollback: 'rollback', postActionVerification: ['health'], taskCycle: 'cycle-1',
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
      },
    })).toBeNull();
  });
});

describe('runtime bridge Chat route', () => {
  it('authenticates before parsing or repository access', async () => {
    const { POST } = await import('@/app/api/internal/asi-runtime/bridge/route');
    const response = await POST(request(submit, ''));
    expect(response.status).toBe(401);
    expect(repository.submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('rejects wrong content type and oversized declared bodies', async () => {
    const { POST } = await import('@/app/api/internal/asi-runtime/bridge/route');
    expect((await POST(request(submit, `Bearer ${TOKEN}`, 'text/plain'))).status).toBe(400);
    const oversized = new Request('http://localhost/api/internal/asi-runtime/bridge', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        'content-length': String(70_000),
      },
      body: JSON.stringify(submit),
    });
    expect((await POST(oversized)).status).toBe(400);
  });

  it('submits under the server-derived client and returns no-store output', async () => {
    repository.submitRuntimeBridgeTask.mockResolvedValue({
      task: { taskId: randomUUID(), status: 'queued' },
      deduplicated: false,
    });
    const { POST } = await import('@/app/api/internal/asi-runtime/bridge/route');
    const response = await POST(request(submit));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(repository.submitRuntimeBridgeTask).toHaveBeenCalledWith('chatgpt-owner', submit.input);
    expect(await response.json()).not.toHaveProperty('token');
  });

  it('requires the dedicated owner credential for an owner decision', async () => {
    repository.submitRuntimeBridgeOwnerDecision.mockResolvedValue({
      task: { taskId: randomUUID(), status: 'queued' },
      gate: { gateId: randomUUID(), status: 'approved' },
      deduplicated: false,
    });
    const input = {
      taskId: randomUUID(), gateId: randomUUID(), decisionId: 'owner-message-1',
      taskCycle: 'cycle-1', decision: 'approved', source: 'explicit_owner_message',
    };
    const { POST } = await import('@/app/api/internal/asi-runtime/bridge/[operation]/route');
    expect((await POST(request(input), { params: { operation: 'runtime_submit_owner_decision' } })).status).toBe(401);
    const ownerRequest = request(input, `Bearer ${process.env.ASI_RUNTIME_BRIDGE_OWNER_TOKEN}`);
    expect((await POST(ownerRequest, { params: { operation: 'runtime_submit_owner_decision' } })).status).toBe(200);
  });
});

describe('runtime bridge durable contracts', () => {
  it('migration enforces RLS, service-role-only access, one running task and fencing', () => {
    const sql = readFileSync('supabase/migrations/20260724120000_asi_chat_runtime_bridge_v1.sql', 'utf8');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('idx_asi_runtime_bridge_single_running');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('runner_id = p_runner_id AND lease_token = p_lease_token');
    expect(sql).toContain('idempotency_conflict');
    expect(sql).toContain('decision_conflict');
    expect(sql).toContain('expire_asi_runtime_bridge_owner_gates');
    expect(sql).toContain('recovery_count');
  });

  it('runner never invokes a shell or logs response bodies', () => {
    const source = readFileSync('scripts/asi-runtime-bridge-runner.mjs', 'utf8');
    expect(source).toContain('shell: false');
    expect(source).not.toContain('env: { ...process.env');
    expect(source).toContain('controller.abort()');
    expect(source).toContain('executionTimeoutMs');
    expect(source).toContain('heartbeatTimeoutMs');
    expect(source).toContain('leaseDeadlineTimer');
    expect(source).toContain("detached: process.platform !== 'win32'");
    expect(source).toContain("child.on('close'");
    expect(source).toContain('initialLeaseRemainingMs');
    expect(source).toContain('abortActiveClaim?.()');
    expect(source).not.toContain('console.log');
    expect(source).not.toContain('process.stderr.write(error');
  });

  it('local smoke: deduplicates, single-claims, recovers, gates and resumes the same task', () => {
    type State = {
      tasks: Array<{ id: string; key: string; hash: string; status: string; attempt: number; lease?: string; result?: object }>;
      gates: Array<{ id: string; taskId: string; status: string; decisionId?: string }>;
    };
    const durable: State = { tasks: [], gates: [] };
    const open = () => ({
      submit(key: string, hash: string) {
        const existing = durable.tasks.find((item) => item.key === key);
        if (existing) {
          if (existing.hash !== hash) throw new Error('idempotency_conflict');
          return existing;
        }
        const created = { id: randomUUID(), key, hash, status: 'queued', attempt: 0 };
        durable.tasks.push(created);
        return created;
      },
      claim() {
        if (durable.tasks.some((item) => item.status === 'running')) return null;
        const item = durable.tasks.find((candidate) => candidate.status === 'queued');
        if (!item) return null;
        item.status = 'running'; item.attempt += 1; item.lease = randomUUID();
        return { ...item };
      },
      recover(taskId: string) {
        const item = durable.tasks.find((candidate) => candidate.id === taskId)!;
        item.status = 'queued'; delete item.lease;
      },
      gate(taskId: string, lease: string) {
        const item = durable.tasks.find((candidate) => candidate.id === taskId && candidate.lease === lease)!;
        item.status = 'awaiting_owner'; delete item.lease;
        const gate = { id: randomUUID(), taskId, status: 'pending' };
        durable.gates.push(gate);
        return gate;
      },
      decide(gateId: string, decisionId: string) {
        const gate = durable.gates.find((candidate) => candidate.id === gateId)!;
        if (gate.decisionId && gate.decisionId !== decisionId) throw new Error('decision_conflict');
        gate.decisionId = decisionId; gate.status = 'approved';
        durable.tasks.find((item) => item.id === gate.taskId)!.status = 'queued';
      },
      complete(taskId: string, lease: string, result: object) {
        const item = durable.tasks.find((candidate) => candidate.id === taskId && candidate.lease === lease)!;
        item.status = 'completed'; item.result = result; delete item.lease;
      },
    });

    const firstProcess = open();
    const original = firstProcess.submit('key-1', 'hash-1');
    expect(firstProcess.submit('key-1', 'hash-1').id).toBe(original.id);
    expect(() => firstProcess.submit('key-1', 'changed')).toThrow('idempotency_conflict');
    const firstClaim = firstProcess.claim()!;
    expect(firstProcess.claim()).toBeNull();
    firstProcess.recover(firstClaim.id);

    const restarted = open();
    const recovered = restarted.claim()!;
    expect(recovered.id).toBe(original.id);
    expect(recovered.attempt).toBe(2);
    const gate = restarted.gate(recovered.id, recovered.lease!);
    restarted.decide(gate.id, 'owner-decision-1');
    restarted.decide(gate.id, 'owner-decision-1');
    expect(() => restarted.decide(gate.id, 'conflict')).toThrow('decision_conflict');
    const resumed = restarted.claim()!;
    expect(resumed.id).toBe(original.id);
    restarted.complete(resumed.id, resumed.lease!, { status: 'completed' });
    expect(durable.tasks[0]).toMatchObject({ id: original.id, status: 'completed', attempt: 3 });
  });
});
