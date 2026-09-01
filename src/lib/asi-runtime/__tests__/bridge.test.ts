import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRuntimeBridgeAuthorized } from '../bridge-auth';
import { runtimeBridgeRequestHash } from '../bridge-hash';
import {
  parseRuntimeBridgeChatInput,
  parseRuntimeBridgeRunnerInput,
  resolveBridgePullRequestArtifactRepository,
  RUNTIME_BRIDGE_MAX_INSTRUCTION_TOTAL_CHARS,
  validateBridgeResultArtifactsMatchTaskRepository,
} from '../bridge-schema';
import { RUNTIME_BRIDGE_CHAT_OPERATIONS } from '../bridge-types';

vi.mock('server-only', () => ({}));

const repository = vi.hoisted(() => ({
  submitRuntimeBridgeTask: vi.fn(),
  getRuntimeBridgeTask: vi.fn(),
  getRuntimeBridgeResult: vi.fn(),
  listRuntimeBridgeOwnerGates: vi.fn(),
  submitRuntimeBridgeOwnerDecision: vi.fn(),
  runRuntimeBridgeRunnerOperation: vi.fn(),
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
  acceptanceCriteria: ['Focused tests pass.'],
  safetyConstraints: ['Do not merge or deploy.'],
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
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = 'https://bridge-isolated.supabase.co';
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = 'bridge-service-role-key-for-isolated-project';
});

afterEach(() => {
  delete process.env.ASI_RUNTIME_BRIDGE_CHAT_TOKEN;
  delete process.env.ASI_RUNTIME_BRIDGE_OWNER_TOKEN;
  delete process.env.ASI_RUNTIME_BRIDGE_RUNNER_TOKEN;
  delete process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID;
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL;
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY;
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

  it('accepts 100 instruction lines and rejects over-limit instruction payloads', () => {
    const hundred = Array.from({ length: 100 }, (_, index) => `step-${index + 1}`);
    expect(parseRuntimeBridgeChatInput({
      ...submit,
      input: { ...submit.input, task: { ...task, instructions: hundred } },
    })?.operation).toBe('runtime_submit_task');
    expect(parseRuntimeBridgeChatInput({
      ...submit,
      input: { ...submit.input, task: { ...task, instructions: [...hundred, 'step-101'] } },
    })).toBeNull();
    expect(parseRuntimeBridgeChatInput({
      ...submit,
      input: { ...submit.input, task: { ...task, instructions: ['x'.repeat(2001)] } },
    })).toBeNull();
    const oversizedLine = 'x'.repeat(2000);
    const oversized = Array.from(
      { length: Math.floor(RUNTIME_BRIDGE_MAX_INSTRUCTION_TOTAL_CHARS / 2000) + 1 },
      () => oversizedLine,
    );
    expect(oversized.length).toBeLessThanOrEqual(100);
    expect(parseRuntimeBridgeChatInput({
      ...submit,
      input: { ...submit.input, task: { ...task, instructions: oversized } },
    })).toBeNull();
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

  it('accepts only safe bounded runner-host readiness evidence', () => {
    const readiness = {
      operation: 'runner_publish_readiness',
      input: {
        schemaVersion: 'asi.runtime.runner-readiness.v1',
        runnerId: 'runner-1234567890abcdef12345678',
        checkedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 45_000).toISOString(),
        baselineSha: 'a'.repeat(40),
        capabilities: {
          checkouts: { state: 'degraded', reasonCode: 'runtime_checkout_recoverable_drift' },
          baselineRecovery: { state: 'ready', reasonCode: 'runtime_baseline_recovery_ready' },
          executor: { state: 'ready', reasonCode: 'runtime_executor_ready' },
        },
      },
    };
    const parsed = parseRuntimeBridgeRunnerInput(readiness);
    expect(parsed?.operation).toBe('runner_publish_readiness');
    for (const name of [
      'ASI_RUNTIME_BRIDGE_CHAT_TOKEN',
      'ASI_RUNTIME_BRIDGE_OWNER_TOKEN',
      'ASI_RUNTIME_BRIDGE_RUNNER_TOKEN',
    ] as const) {
      expect(JSON.stringify(parsed)).not.toContain(process.env[name]);
    }
    expect(parseRuntimeBridgeRunnerInput({
      ...readiness,
      input: { ...readiness.input, executorPath: '/opt/runtime/executor.mjs' },
    })).toBeNull();
    expect(parseRuntimeBridgeRunnerInput({
      ...readiness,
      input: {
        ...readiness.input,
        capabilities: {
          ...readiness.input.capabilities,
          executor: { state: 'blocked', reasonCode: '/opt/runtime/executor.mjs' },
        },
      },
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

function bridgeRunnerResult(artifacts: Array<{ type: 'commit' | 'pull_request' | 'report'; value: string }>) {
  return {
    operation: 'runner_submit_result' as const,
    input: {
      runnerId: 'runner-1',
      taskId: randomUUID(),
      leaseToken: randomUUID(),
      result: {
        schemaVersion: 'asi.runtime.result.v1' as const,
        status: 'completed' as const,
        summary: 'Done.',
        changedFiles: ['src/example.ts'],
        checks: [{ name: 'typecheck', status: 'PASS' as const }],
        artifacts,
        blockers: [],
      },
    },
  };
}

describe('runtime bridge cross-repository result artifact acceptance', () => {
  const landingPr = 'https://github.com/ASI-integration/asi-landing/pull/10';
  const runtimePr99 = 'https://github.com/ASI-integration/asi-os-runtime/pull/99';
  const runtimePr100 = 'https://github.com/ASI-integration/asi-os-runtime/pull/100';
  const commitSha = '6b96503fdd2782e1b2ce68a145251d6066f36db8';

  it('accepts landing and runtime pull_request artifacts syntactically', () => {
    expect(parseRuntimeBridgeRunnerInput(bridgeRunnerResult([{ type: 'pull_request', value: landingPr }]))?.operation)
      .toBe('runner_submit_result');
    expect(parseRuntimeBridgeRunnerInput(bridgeRunnerResult([{ type: 'pull_request', value: runtimePr99 }]))?.operation)
      .toBe('runner_submit_result');
    expect(parseRuntimeBridgeRunnerInput(bridgeRunnerResult([{ type: 'pull_request', value: runtimePr100 }]))?.operation)
      .toBe('runner_submit_result');
  });

  it('binds pull_request artifacts to the authoritative task repository', () => {
    const result = bridgeRunnerResult([{ type: 'pull_request', value: landingPr }]).input.result;
    expect(validateBridgeResultArtifactsMatchTaskRepository(result, 'ASI-integration/asi-landing')).toBe(true);
    expect(validateBridgeResultArtifactsMatchTaskRepository(result, 'ASI-integration/asi-os-runtime')).toBe(false);

    const runtimeResult = bridgeRunnerResult([{ type: 'pull_request', value: runtimePr99 }]).input.result;
    expect(validateBridgeResultArtifactsMatchTaskRepository(runtimeResult, 'ASI-integration/asi-os-runtime')).toBe(true);
    expect(validateBridgeResultArtifactsMatchTaskRepository(runtimeResult, 'ASI-integration/asi-landing')).toBe(false);

    const runtimePr100Result = bridgeRunnerResult([{ type: 'pull_request', value: runtimePr100 }]).input.result;
    expect(validateBridgeResultArtifactsMatchTaskRepository(runtimePr100Result, 'ASI-integration/asi-os-runtime')).toBe(true);
    expect(validateBridgeResultArtifactsMatchTaskRepository(runtimePr100Result, 'ASI-integration/asi-landing')).toBe(false);
  });

  it('rejects foreign organization and foreign ASI-integration repository pull_request URLs', () => {
    for (const value of [
      'https://github.com/other-org/asi-landing/pull/1',
      'https://github.com/ASI-integration/other-repo/pull/1',
    ]) {
      expect(parseRuntimeBridgeRunnerInput(bridgeRunnerResult([{ type: 'pull_request', value }]))).toBeNull();
      expect(resolveBridgePullRequestArtifactRepository(value)).toBeNull();
    }
  });

  it('rejects pull_request URLs with query strings, hashes, credentials, or alternate hosts', () => {
    for (const value of [
      `${runtimePr99}?utm=1`,
      `${runtimePr99}#discussion`,
      'https://www.github.com/ASI-integration/asi-os-runtime/pull/99',
      'https://user:pass@github.com/ASI-integration/asi-os-runtime/pull/99',
      'http://github.com/ASI-integration/asi-os-runtime/pull/99',
    ]) {
      expect(parseRuntimeBridgeRunnerInput(bridgeRunnerResult([{ type: 'pull_request', value }]))).toBeNull();
    }
  });

  it('preserves commit and report artifact validation', () => {
    expect(parseRuntimeBridgeRunnerInput(bridgeRunnerResult([
      { type: 'commit', value: commitSha },
      { type: 'report', value: 'docs/agent-os/report.md' },
    ]))?.operation).toBe('runner_submit_result');
    expect(parseRuntimeBridgeRunnerInput(bridgeRunnerResult([
      { type: 'commit', value: 'not-a-sha' },
    ]))).toBeNull();
    expect(parseRuntimeBridgeRunnerInput(bridgeRunnerResult([
      { type: 'report', value: '../secrets.env' },
    ]))).toBeNull();
  });

  it('accepts incident #99 runtime task result with asi-os-runtime pull/99', () => {
    const incidentResult = bridgeRunnerResult([
      { type: 'commit', value: commitSha },
      { type: 'pull_request', value: runtimePr99 },
    ]).input.result;
    expect(parseRuntimeBridgeRunnerInput({
      ...bridgeRunnerResult([
        { type: 'commit', value: commitSha },
        { type: 'pull_request', value: runtimePr99 },
      ]),
    })?.operation).toBe('runner_submit_result');
    expect(validateBridgeResultArtifactsMatchTaskRepository(
      incidentResult,
      'ASI-integration/asi-os-runtime',
    )).toBe(true);
    expect(resolveBridgePullRequestArtifactRepository(runtimePr99))
      .toBe('ASI-integration/asi-os-runtime');
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

describe('runtime bridge runner readiness control plane', () => {
  it('expires evidence and rejects a different identity while a heartbeat is fresh', async () => {
    const readinessStore = await import('../bridge-runner-readiness');
    readinessStore.__resetRuntimeRunnerReadinessForTests();
    const now = Date.parse('2026-08-01T00:00:00.000Z');
    const record = {
      schemaVersion: 'asi.runtime.runner-readiness.v1' as const,
      runnerId: 'runner-1234567890abcdef12345678',
      checkedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 45_000).toISOString(),
      baselineSha: 'a'.repeat(40),
      capabilities: {
        checkouts: { state: 'ready' as const, reasonCode: 'runtime_checkouts_ready' },
        baselineRecovery: { state: 'ready' as const, reasonCode: 'runtime_baseline_recovery_ready' },
        executor: { state: 'ready' as const, reasonCode: 'runtime_executor_ready' },
      },
    };
    readinessStore.publishRuntimeRunnerReadiness('chatgpt-owner', record, now);
    expect(readinessStore.getRuntimeRunnerReadiness('chatgpt-owner', now + 1_000).status).toBe('fresh');
    expect(() => readinessStore.publishRuntimeRunnerReadiness('chatgpt-owner', {
      ...record,
      runnerId: 'runner-fedcba0987654321fedcba09',
      checkedAt: new Date(now + 1_000).toISOString(),
      expiresAt: new Date(now + 46_000).toISOString(),
    }, now + 1_000)).toThrow('runner_identity_conflict');
    expect(readinessStore.getRuntimeRunnerReadiness('chatgpt-owner', now + 46_000).status).toBe('stale');
  });

  it('publishes runner-host evidence only through the authenticated runner route', async () => {
    const body = {
      operation: 'runner_publish_readiness',
      input: {
        schemaVersion: 'asi.runtime.runner-readiness.v1',
        runnerId: 'runner-1234567890abcdef12345678',
        checkedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 45_000).toISOString(),
        baselineSha: 'a'.repeat(40),
        capabilities: {
          checkouts: { state: 'ready', reasonCode: 'runtime_checkouts_ready' },
          baselineRecovery: { state: 'ready', reasonCode: 'runtime_baseline_recovery_ready' },
          executor: { state: 'ready', reasonCode: 'runtime_executor_ready' },
        },
      },
    };
    repository.runRuntimeBridgeRunnerOperation.mockResolvedValue(body.input);
    const { POST } = await import('@/app/api/internal/asi-runtime/bridge/runner/route');

    expect((await POST(request(body, ''))).status).toBe(401);
    expect(repository.runRuntimeBridgeRunnerOperation).not.toHaveBeenCalled();

    const response = await POST(request(
      body,
      `Bearer ${process.env.ASI_RUNTIME_BRIDGE_RUNNER_TOKEN}`,
    ));
    expect(response.status).toBe(200);
    expect(repository.runRuntimeBridgeRunnerOperation).toHaveBeenCalledWith('chatgpt-owner', body);
    const responseJson = JSON.stringify(await response.json());
    expect(responseJson).not.toMatch(/\/opt\/|argv|stdout|stderr|TOKEN/i);
    for (const name of [
      'ASI_RUNTIME_BRIDGE_CHAT_TOKEN',
      'ASI_RUNTIME_BRIDGE_OWNER_TOKEN',
      'ASI_RUNTIME_BRIDGE_RUNNER_TOKEN',
    ] as const) {
      expect(responseJson).not.toContain(process.env[name]);
    }
  });
});

describe('runtime bridge durable contracts', () => {
  it('migration enforces RLS, service-role-only access, one running task and fencing', () => {
    const sql = readFileSync('supabase/migrations/20260724120000_asi_chat_runtime_bridge_v1.sql', 'utf8');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION');
    expect(sql.match(/SET search_path = pg_catalog/g)).toHaveLength(8);
    expect(sql).toContain('idx_asi_runtime_bridge_single_running');
    expect(sql).toContain('idx_asi_runtime_bridge_owner_decision_once');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('IF FOUND THEN RETURN NULL; END IF;');
    expect(sql).toContain('runner_id = p_runner_id AND lease_token = p_lease_token');
    expect(sql).toContain('idempotency_conflict');
    expect(sql).toContain('decision_conflict');
    expect(sql).toContain('p_task_cycle IS NULL');
    expect(sql).toContain('IS DISTINCT FROM p_task_cycle');
    expect(sql).toContain('expire_asi_runtime_bridge_owner_gates');
    expect(sql).toContain('recovery_count');
  });

  it('validates only the runner credential and executor availability without starting the executor', async () => {
    const { inspectRuntimeRunnerPrerequisites } = await import(
      '../../../../scripts/asi-runtime-runner-config.mjs'
    );
    const runnerToken = 'runner-token-with-at-least-thirty-two-characters';
    const configured = {
      ASI_RUNTIME_BRIDGE_URL: 'https://runtime.example.com',
      ASI_RUNTIME_BRIDGE_RUNNER_TOKEN: runnerToken,
      ASI_RUNTIME_BRIDGE_EXECUTOR_JSON: JSON.stringify([
        process.execPath,
        path.resolve('scripts/asi-runtime-bridge-executor-guard.mjs'),
      ]),
    };
    await expect(inspectRuntimeRunnerPrerequisites(configured)).resolves.toEqual({
      ready: true,
      reasonCode: 'runtime_executor_ready',
    });
    await expect(inspectRuntimeRunnerPrerequisites({
      ...configured,
      ASI_RUNTIME_BRIDGE_EXECUTOR_JSON: JSON.stringify(['missing-asi-executor-command']),
    })).resolves.toEqual({ ready: false, reasonCode: 'runtime_executor_unavailable' });
    await expect(inspectRuntimeRunnerPrerequisites({
      ...configured,
      ASI_RUNTIME_BRIDGE_EXECUTOR_JSON: JSON.stringify([
        process.execPath,
        path.resolve('scripts/missing-runtime-executor.mjs'),
      ]),
    })).resolves.toEqual({
      ready: false,
      reasonCode: 'runtime_executor_entrypoint_unavailable',
    });
  });

  it.each([undefined, '', 'short-runner-token', ' runner-token-with-at-least-thirty-two-characters'])(
    'blocks runner readiness for a missing, short or malformed runner token (%s)',
    async (runnerToken) => {
      const { inspectRuntimeRunnerPrerequisites } = await import(
        '../../../../scripts/asi-runtime-runner-config.mjs'
      );
      await expect(inspectRuntimeRunnerPrerequisites({
        ASI_RUNTIME_BRIDGE_URL: 'https://runtime.example.com',
        ASI_RUNTIME_BRIDGE_RUNNER_TOKEN: runnerToken,
        ASI_RUNTIME_BRIDGE_EXECUTOR_JSON: JSON.stringify([
          process.execPath,
          path.resolve('scripts/asi-runtime-bridge-executor-guard.mjs'),
        ]),
      })).resolves.toEqual({ ready: false, reasonCode: 'runtime_runner_credentials_invalid' });
    },
  );

  it('does not read or require Chat and Owner credentials on the runner host', async () => {
    const { inspectRuntimeRunnerPrerequisites } = await import(
      '../../../../scripts/asi-runtime-runner-config.mjs'
    );
    const configured = {
      ASI_RUNTIME_BRIDGE_URL: 'https://runtime.example.com',
      ASI_RUNTIME_BRIDGE_RUNNER_TOKEN: 'runner-token-with-at-least-thirty-two-characters',
      ASI_RUNTIME_BRIDGE_EXECUTOR_JSON: JSON.stringify([
        process.execPath,
        path.resolve('scripts/asi-runtime-bridge-executor-guard.mjs'),
      ]),
    };
    const expected = { ready: true, reasonCode: 'runtime_executor_ready' };
    await expect(inspectRuntimeRunnerPrerequisites(configured)).resolves.toEqual(expected);
    await expect(inspectRuntimeRunnerPrerequisites({
      ...configured,
      ASI_RUNTIME_BRIDGE_CHAT_TOKEN: configured.ASI_RUNTIME_BRIDGE_RUNNER_TOKEN,
      ASI_RUNTIME_BRIDGE_OWNER_TOKEN: 'owner-token-that-must-not-affect-runner-readiness',
    })).resolves.toEqual(expected);

    const unreadableRoleCredentials = new Proxy(configured, {
      get(target, property, receiver) {
        if (property === 'ASI_RUNTIME_BRIDGE_CHAT_TOKEN'
          || property === 'ASI_RUNTIME_BRIDGE_OWNER_TOKEN') {
          throw new Error('runner_read_role_credential');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const result = await inspectRuntimeRunnerPrerequisites(unreadableRoleCredentials);
    expect(result).toEqual(expected);
    expect(JSON.stringify(result)).not.toContain(configured.ASI_RUNTIME_BRIDGE_RUNNER_TOKEN);
  });

  it('runner and guard never invoke a shell or log response bodies', () => {
    const source = readFileSync('scripts/asi-runtime-bridge-runner.mjs', 'utf8');
    const guard = readFileSync('scripts/asi-runtime-bridge-executor-guard.mjs', 'utf8');
    const recovery = readFileSync('scripts/asi-runtime-baseline-recovery.mjs', 'utf8');
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
    expect(source).toContain('ASI_RUNTIME_BRIDGE_LEASE_TOKEN');
    expect(source).toContain('wakePoll?.()');
    expect(guard).toContain('shell: false');
    expect(guard).toContain("process.once('disconnect', terminateTree)");
    expect(guard).toContain("process.kill(-process.pid, 'SIGKILL')");
    expect(guard).toContain("'taskkill.exe'");
    expect(source).not.toContain('console.log');
    expect(source).not.toContain('process.stderr.write(error');
    expect(source).not.toContain('ASI_RUNTIME_BRIDGE_CHAT_TOKEN');
    expect(source).not.toContain('ASI_RUNTIME_BRIDGE_OWNER_TOKEN');
    expect(source).not.toMatch(/stderr\.write\([^)]*token/i);
    expect(recovery).toContain("execFileAsync('git'");
    expect(recovery).not.toContain('shell: true');
    expect(recovery).not.toContain('console.log');
  });

  it('runner startup logs never disclose any role credential value', async () => {
    const secrets = {
      chat: 'chat-secret-value-with-at-least-thirty-two-characters',
      owner: 'owner-secret-value-with-at-least-thirty-two-characters',
      runner: 'runner-secret-value-with-at-least-thirty-two-characters',
    };
    const child = spawn(process.execPath, ['scripts/asi-runtime-bridge-runner.mjs'], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        ASI_RUNTIME_BRIDGE_URL: 'not-a-runtime-url',
        ASI_RUNTIME_BRIDGE_CHAT_TOKEN: secrets.chat,
        ASI_RUNTIME_BRIDGE_OWNER_TOKEN: secrets.owner,
        ASI_RUNTIME_BRIDGE_RUNNER_TOKEN: secrets.runner,
      },
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exitCode = await new Promise<number | null>((resolve) => child.once('close', resolve));
    expect(exitCode).toBe(1);
    expect(stderr).toBe('Runtime bridge runner is not configured.\n');
    for (const secret of Object.values(secrets)) expect(stderr).not.toContain(secret);
  });

  it('executor guard kills its child when the runner IPC disappears', async () => {
    const executor = Buffer.from(JSON.stringify([
      process.execPath,
      '-e',
      'setInterval(() => {}, 1000)',
    ]), 'utf8').toString('base64url');
    const guard = spawn(process.execPath, ['scripts/asi-runtime-bridge-executor-guard.mjs', executor], {
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        ...process.env,
        ASI_RUNTIME_BRIDGE_TASK_ID: randomUUID(),
        ASI_RUNTIME_BRIDGE_LEASE_TOKEN: randomUUID(),
      },
    });
    let executorPid = 0;
    try {
      executorPid = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('guard_start_timeout')), 5_000);
        guard.once('error', reject);
        guard.on('message', (message) => {
          if (!message || typeof message !== 'object' || !('pid' in message)) return;
          clearTimeout(timer);
          resolve(Number(message.pid));
        });
      });
      const guardExit = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('guard_exit_timeout')), 5_000);
        guard.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      guard.disconnect();
      await guardExit;
      await vi.waitFor(() => {
        let alive = true;
        try { process.kill(executorPid, 0); } catch { alive = false; }
        expect(alive).toBe(false);
      }, { timeout: 5_000, interval: 100 });
    } finally {
      if (guard.exitCode === null && guard.pid) {
        if (process.platform === 'win32') {
          spawn('taskkill.exe', ['/PID', String(guard.pid), '/T', '/F'], {
            shell: false, windowsHide: true, stdio: 'ignore',
          }).unref();
        } else {
          try { process.kill(-guard.pid, 'SIGKILL'); } catch { guard.kill('SIGKILL'); }
        }
      }
      if (executorPid) {
        try { process.kill(executorPid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
  }, 15_000);

  it('runner kills an orphan executor before retrying after a guard crash', async () => {
    const checkoutRoot = mkdtempSync(path.join(os.tmpdir(), 'asi-runner-checkouts-'));
    const primaryCheckout = path.join(checkoutRoot, 'primary');
    const secondaryCheckout = path.join(checkoutRoot, 'secondary');
    execFileSync('git', ['init', primaryCheckout], { windowsHide: true });
    execFileSync('git', ['-C', primaryCheckout, 'config', 'user.name', 'ASI Test'], { windowsHide: true });
    execFileSync('git', ['-C', primaryCheckout, 'config', 'user.email', 'asi-test@example.invalid'], { windowsHide: true });
    writeFileSync(path.join(primaryCheckout, 'marker.txt'), 'runner baseline\n', 'utf8');
    execFileSync('git', ['-C', primaryCheckout, 'add', 'marker.txt'], { windowsHide: true });
    execFileSync('git', ['-C', primaryCheckout, 'commit', '-m', 'runner baseline'], { windowsHide: true });
    execFileSync('git', ['-C', primaryCheckout, 'branch', '-M', 'main'], { windowsHide: true });
    const runnerBaselineSha = execFileSync('git', ['-C', primaryCheckout, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', windowsHide: true,
    }).trim();
    execFileSync('git', ['clone', '--no-hardlinks', primaryCheckout, secondaryCheckout], { windowsHide: true });
    for (const checkout of [primaryCheckout, secondaryCheckout]) {
      const remoteArgs = checkout === primaryCheckout ? ['remote', 'add'] : ['remote', 'set-url'];
      execFileSync('git', [
        '-C', checkout, ...remoteArgs, 'origin', 'https://github.com/ASI-integration/asi-landing.git',
      ], { windowsHide: true });
      execFileSync('git', [
        '-C', checkout, 'config', `url.${primaryCheckout}.insteadOf`,
        'https://github.com/ASI-integration/asi-landing.git',
      ], { windowsHide: true });
    }
    const taskId = randomUUID();
    const leaseToken = randomUUID();
    let claimed = false;
    let executorPid = 0;
    let guardPid = 0;
    let failureObserved = false;
    let failureBeforeExecutorExit = false;
    const server = createServer(async (incoming, response) => {
      const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/executor-start') {
        executorPid = Number(url.searchParams.get('pid'));
        guardPid = Number(url.searchParams.get('ppid'));
        response.writeHead(204).end();
        return;
      }
      let raw = '';
      for await (const chunk of incoming) raw += String(chunk);
      const body = JSON.parse(raw) as { operation: string };
      let data: unknown = true;
      if (body.operation === 'runner_claim_task') {
        data = claimed ? null : {
          taskId,
          chatgptTaskId: 'chat-task-guard-crash',
          conversationId: 'conversation-guard-crash',
          request: { ...task, baselineSha: runnerBaselineSha },
          ownerDecision: null,
          attemptCount: 1,
          leaseToken,
          leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        };
        claimed = true;
      } else if (body.operation === 'runner_fail_task') {
        failureObserved = true;
        try { process.kill(executorPid, 0); failureBeforeExecutorExit = true; } catch { /* executor exited */ }
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, data }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('bridge_fixture_address');
    const executorSource = [
      "let body='';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data',(chunk)=>body+=chunk);",
      "process.stdin.on('end',()=>{",
      "JSON.parse(body);",
      "fetch(`${process.argv[2]}?pid=${process.pid}&ppid=${process.ppid}`)",
      ".finally(()=>setInterval(()=>{},1000));",
      '});',
    ].join('');
    const executorPath = path.join(checkoutRoot, 'runner-executor.mjs');
    writeFileSync(executorPath, executorSource, 'utf8');
    const runner = spawn(process.execPath, ['scripts/asi-runtime-bridge-runner.mjs'], {
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        ASI_RUNTIME_BRIDGE_URL: `http://127.0.0.1:${address.port}`,
        ASI_RUNTIME_BRIDGE_RUNNER_TOKEN: 'runner-token-with-at-least-thirty-two-characters',
        ASI_RUNTIME_BRIDGE_EXECUTOR_JSON: JSON.stringify([
          process.execPath,
          executorPath,
          `http://127.0.0.1:${address.port}/executor-start`,
        ]),
        ASI_RUNTIME_BRIDGE_CHECKOUTS_JSON: JSON.stringify([
          { id: 'runtime-primary', path: primaryCheckout },
          { id: 'runtime-secondary', path: secondaryCheckout },
        ]),
        ASI_RUNTIME_BRIDGE_POLL_MS: '250',
      },
    });
    try {
      await vi.waitFor(() => {
        expect(executorPid).toBeGreaterThan(0);
        expect(guardPid).toBeGreaterThan(0);
      }, { timeout: 5_000, interval: 50 });
      process.kill(guardPid, 'SIGKILL');
      await vi.waitFor(() => {
        expect(failureObserved).toBe(true);
        expect(failureBeforeExecutorExit).toBe(false);
        let alive = true;
        try { process.kill(executorPid, 0); } catch { alive = false; }
        expect(alive).toBe(false);
      }, { timeout: 8_000, interval: 100 });
    } finally {
      if (runner.exitCode === null) runner.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        if (runner.exitCode !== null) return resolve();
        const timer = setTimeout(() => {
          runner.kill('SIGKILL');
          resolve();
        }, 3_000);
        runner.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      for (const pid of [guardPid, executorPid]) {
        if (!pid) continue;
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      rmSync(checkoutRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 20_000);

  it('OpenAPI exposes exactly the five strict Chat operations and typed responses', () => {
    const openapi = readFileSync('docs/asi-chat-runtime-bridge-v1.openapi.yaml', 'utf8');
    const operationIds = [...openapi.matchAll(/^\s+operationId:\s+(\S+)$/gm)].map((match) => match[1]);
    expect(operationIds).toEqual(RUNTIME_BRIDGE_CHAT_OPERATIONS);
    expect(openapi).not.toContain('JsonResponse');
    expect(openapi).toContain("pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'");
    expect(openapi).toContain("SubmitTaskResponse:");
    expect(openapi).toContain("GetTaskResponse:");
    expect(openapi).toContain("GetResultResponse:");
    expect(openapi).toContain("ListOwnerGatesResponse:");
    expect(openapi).toContain("OwnerDecisionResponse:");
    expect(openapi.match(/'401':/g)).toHaveLength(5);
    expect(openapi.match(/'503':/g)).toHaveLength(5);
  });

  it('auth and repository modules enforce the server-only boundary', () => {
    for (const path of [
      'src/lib/asi-runtime/bridge-auth.ts',
      'src/lib/asi-runtime/bridge-repository.ts',
    ]) {
      expect(readFileSync(path, 'utf8')).toContain("import 'server-only';");
    }
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
