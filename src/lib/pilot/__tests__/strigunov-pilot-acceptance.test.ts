/**
 * SP-09 — Strigunov Pilot automated acceptance harness (mock / CI mode).
 * Stages match STRIGUNOV_PILOT_ACCEPTANCE.md §6 exactly.
 *
 * LIVE runner/executor claim against real Bridge storage → SP-10 (marked in output).
 */
import React from 'react';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STRIGUNOV_PILOT_ACCEPTANCE_GREEN_GOAL,
  STRIGUNOV_PILOT_ACCEPTANCE_STAGES,
  STRIGUNOV_PILOT_TELEGRAM_MATRIX,
} from '../acceptance/stage-ids';
import { importRuntimeOwnerTelegramEvents } from '../acceptance/runtime-events';
import {
  assertExecutorCompatiblePilotEnvelope,
  buildPilotClaimableEnvelope,
  taskRequestHasPilotProvenance,
} from '../provenance';
import { createPilotConversationId } from '../ids';
import { resetPilotCreateRateLimitForTests } from '../rate-limit';
import { PILOT_FIXED_REPOSITORY, PILOT_TEMPLATE_ID, buildPilotGreenTemplate } from '../template';
import { buildPilotSafeResultView } from '../result-view';
import { buildPilotResultCardModel, PILOT_RESULT_FALLBACK_SUCCEEDED } from '../result-card';
import { PilotCreateForm, PilotTaskDetail } from '@/app/pilot/PilotConsoleView';
import { isPilotBetaEmail } from '../access';
import type { RuntimeBridgeSafeResult } from '@/lib/asi-runtime/bridge-types';

vi.mock('server-only', () => ({}));

const {
  createClient,
  resolveAllowlistedBaselineSha,
  assertPilotSubmissionReady,
  getPilotReadiness,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  resolveAllowlistedBaselineSha: vi.fn(),
  assertPilotSubmissionReady: vi.fn(),
  getPilotReadiness: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

vi.mock('../readiness', () => ({
  assertPilotSubmissionReady,
  getPilotReadiness,
}));

vi.mock('@/lib/development/baseline-sha', async () => {
  const actual = await vi.importActual<typeof import('@/lib/development/baseline-sha')>(
    '@/lib/development/baseline-sha',
  );
  return { ...actual, resolveAllowlistedBaselineSha };
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
const GREEN_GOAL = STRIGUNOV_PILOT_ACCEPTANCE_GREEN_GOAL;

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
    if (table !== 'asi_runtime_bridge_tasks') throw new Error(`unexpected_table:${table}`);
    const state: {
      filters: Array<[string, string]>;
      orderDesc?: boolean;
    } = { filters: [] };
    const api = {
      select() { return api; },
      eq(column: string, value: string) {
        state.filters.push([column, value]);
        return api;
      },
      order(_column: string, opts?: { ascending?: boolean }) {
        state.orderDesc = opts?.ascending === false;
        return api;
      },
      limit(n: number) {
        let matched = store.rows.filter((row) => state.filters.every(([column, value]) => {
          if (column === 'client_id') return row.client_id === value;
          if (column === 'conversation_id') return row.conversation_id === value;
          return true;
        }));
        if (state.orderDesc) matched = [...matched].reverse();
        return Promise.resolve({ data: matched.slice(0, n), error: null });
      },
      maybeSingle: async () => {
        const matched = store.rows.filter((row) => state.filters.every(([column, value]) => {
          if (column === 'client_id') return row.client_id === value;
          if (column === 'id') return row.id === value;
          if (column === 'idempotency_key') return row.idempotency_key === value;
          if (column === 'conversation_id') return row.conversation_id === value;
          return false;
        }));
        return { data: matched[0] ?? null, error: null };
      },
    };
    return api;
  });

  createClient.mockReturnValue({ rpc, from });
  return { rpc };
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
    messageRu: 'Система готова к запуску задач пилота.',
    checkedAt: NOW,
  });
  getPilotReadiness.mockReset();
  getPilotReadiness.mockResolvedValue({
    state: 'ready',
    canSubmit: true,
    messageRu: 'Система готова к запуску задач пилота.',
    checkedAt: NOW,
  });
  resetPilotCreateRateLimitForTests();
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = BRIDGE_URL;
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = BRIDGE_KEY;
  process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID = 'pilot-bridge-client';
  process.env.ASI_PILOT_BETA_EMAILS = 'strigunov@example.com';
  process.env.ASI_DEVELOPMENT_OWNER_EMAILS = 'owner@example.com';
});

afterEach(() => {
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL;
  delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID;
  delete process.env.ASI_PILOT_BETA_EMAILS;
  delete process.env.ASI_DEVELOPMENT_OWNER_EMAILS;
  vi.clearAllMocks();
});

describe('SP-09 stage registry', () => {
  it('exports the exact acceptance stage IDs', () => {
    expect([...STRIGUNOV_PILOT_ACCEPTANCE_STAGES]).toEqual([
      'pilot_identity',
      'pilot_template_policy',
      'pilot_create_bridge',
      'pilot_runner_execute',
      'pilot_result_card',
      'pilot_telegram_silent_success',
      'pilot_telegram_blocked',
      'pilot_authz_isolation',
      'pilot_readiness_failclosed',
    ]);
  });
});

describe('stage:pilot_identity', () => {
  it('S1.1/S1.4 — allowlisted email is pilot_beta; others denied', async () => {
    expect(isPilotBetaEmail('strigunov@example.com')).toBe(true);
    expect(isPilotBetaEmail('random@example.com')).toBe(false);
    expect(isPilotBetaEmail('owner@example.com')).toBe(false);
  });

  it('S1.2 — Pilot Console create form exists', () => {
    const html = renderToStaticMarkup(
      React.createElement(PilotCreateForm, {
        title: '',
        goal: '',
        submitting: false,
        submissionEnabled: true,
        error: null,
        onTitleChange: () => undefined,
        onGoalChange: () => undefined,
        onSubmit: () => undefined,
      }),
    );
    expect(html).toContain('data-pilot-create-form="true"');
    expect(html).toContain('name="goal"');
  });

  it('G0.9 — Pilot Console source has no merge/deploy controls', () => {
    const viewSrc = readFileSync(resolve(process.cwd(), 'src/app/pilot/PilotConsoleView.tsx'), 'utf8');
    const clientSrc = readFileSync(resolve(process.cwd(), 'src/app/pilot/PilotConsoleClient.tsx'), 'utf8');
    expect(viewSrc).not.toMatch(/data-pilot-merge|data-pilot-deploy/);
    expect(clientSrc).not.toMatch(/\/merge\b|confirmMerge|mergeGate/);
  });
});

describe('stage:pilot_template_policy', () => {
  it('S5.1 — red objective rejected; no Bridge package', () => {
    expect(() => buildPilotGreenTemplate({
      goal: 'Merge to main and deploy production secrets',
    })).toThrow(/red_objective_rejected|PilotAccessError|red/i);
    try {
      buildPilotGreenTemplate({ goal: 'Merge to main and deploy production secrets' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'red_objective_rejected', status: 400 });
    }
  });

  it('S5.2 — client cannot set repository / privileged fields', async () => {
    const { assertNoPrivilegedPilotFields } = await import('../template');
    expect(() => assertNoPrivilegedPilotFields({
      goal: GREEN_GOAL,
      repository: 'evil/repo',
    })).toThrow();
    const pkg = buildPilotGreenTemplate({ goal: GREEN_GOAL });
    expect(pkg.repository).toBe(PILOT_FIXED_REPOSITORY);
  });
});

describe('stage:pilot_create_bridge', () => {
  it('S2.1/S2.2/S2.5 — create returns durable id with provenance; idempotent reuse', async () => {
    const store = { rows: [] as DurableRow[] };
    installDurableBridgeMock(store);
    const { __resetRuntimeBridgeSupabaseForTests } = await import('@/lib/asi-runtime/bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { submitPilotTask } = await import('../task-service');

    const pilotUserId = 'pilot-acceptance-a';
    const created = await submitPilotTask({
      pilotUserId,
      body: {
        goal: GREEN_GOAL,
        title: 'SP-09 proof',
        idempotencyKey: 'pilot-beta-idem-sp09-create',
      },
    });
    expect(created.task.taskId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.task.status).toBe('queued');
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.conversation_id).toBe(createPilotConversationId(pilotUserId));
    expect(taskRequestHasPilotProvenance(store.rows[0]!.request as never)).toBe(true);
    expect(store.rows[0]!.request.repository).toBe(PILOT_FIXED_REPOSITORY);

    const again = await submitPilotTask({
      pilotUserId,
      body: {
        goal: GREEN_GOAL,
        title: 'SP-09 proof',
        idempotencyKey: 'pilot-beta-idem-sp09-create',
      },
    });
    expect(again.deduplicated).toBe(true);
    expect(again.task.taskId).toBe(created.task.taskId);
    expect(store.rows).toHaveLength(1);
  });
});

describe('stage:pilot_runner_execute', () => {
  it('S2.3/S2.4 — claimed envelope is executor-compatible (mock claim; LIVE NOT PROVEN)', async () => {
    const store = { rows: [] as DurableRow[] };
    installDurableBridgeMock(store);
    const { __resetRuntimeBridgeSupabaseForTests } = await import('@/lib/asi-runtime/bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { submitPilotTask } = await import('../task-service');

    const created = await submitPilotTask({
      pilotUserId: 'pilot-acceptance-run',
      body: {
        goal: GREEN_GOAL,
        idempotencyKey: 'pilot-beta-idem-sp09-runner',
      },
    });
    const row = store.rows[0]!;
    expect(row.id).toBe(created.task.taskId);
    expect(row.status).toBe('queued');

    row.status = 'running';
    row.attempt_count = 1;
    row.lease_token = randomUUID();

    const envelope = buildPilotClaimableEnvelope({
      taskId: row.id,
      leaseToken: row.lease_token,
      chatgptTaskId: row.chatgpt_task_id,
      conversationId: row.conversation_id,
      attemptCount: row.attempt_count,
      request: row.request as never,
    });
    expect(() => assertExecutorCompatiblePilotEnvelope(envelope)).not.toThrow();
    // Live runner claim against real Bridge storage is SP-10.
    expect(process.env.ASI_STRIGUNOV_PILOT_LIVE).not.toBe('1');
  });
});

describe('stage:pilot_result_card', () => {
  it('S3.1–S3.3 — terminal success card is safe and secret-free', async () => {
    const store = { rows: [] as DurableRow[] };
    installDurableBridgeMock(store);
    const { __resetRuntimeBridgeSupabaseForTests } = await import('@/lib/asi-runtime/bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { submitPilotTask } = await import('../task-service');
    const { getPilotTaskDetailForUser } = await import('../task-access');

    const pilotUserId = 'pilot-acceptance-result';
    const created = await submitPilotTask({
      pilotUserId,
      body: { goal: GREEN_GOAL, idempotencyKey: 'pilot-beta-idem-sp09-result' },
    });
    const row = store.rows[0]!;
    row.status = 'completed';
    row.result = {
      schemaVersion: 'asi.runtime.result.v1',
      status: 'completed',
      summary: 'Proof written under docs/pilot/',
      changedFiles: ['docs/pilot/sp09-proof.md', 'C:\\secrets\\token.txt'],
      checks: [{ name: 'x', status: 'PASS', detail: 'sk-abcdefghijklmnopqrstuvwxyz0123456789' }],
      artifacts: [
        { type: 'commit', value: 'd'.repeat(40) },
        { type: 'pull_request', value: 'https://evil.example/pr/1' },
      ],
      blockers: [],
    };

    const detail = await getPilotTaskDetailForUser(created.task.taskId, pilotUserId);
    expect(detail.task.consoleStatus).toBe('succeeded');
    expect(detail.result.outcome).toBe('succeeded');
    expect(detail.result.changedFiles).toEqual(['docs/pilot/sp09-proof.md']);
    expect(detail.result.pullRequestUrl).toBeNull();
    expect(detail.result.commitSha).toBe('d'.repeat(40));
    const detailJson = JSON.stringify(detail);
    expect(detailJson).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(detailJson).not.toContain('SERVICE_ROLE');
    expect(detailJson).not.toContain('schemaVersion');
    expect(detailJson).not.toContain('"checks"');
    expect(detailJson).not.toContain('evil.example');
    expect(detailJson).not.toContain('C:\\secrets');

    const sanitized = buildPilotSafeResultView({
      consoleStatus: 'succeeded',
      bridgeResult: row.result as RuntimeBridgeSafeResult,
    });
    const card = buildPilotResultCardModel({ consoleStatus: 'succeeded', result: sanitized });
    const html = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: created.task.taskId,
          title: 'SP-09',
          status: 'completed',
          consoleStatus: 'succeeded',
          createdAt: NOW,
          updatedAt: NOW,
        },
        result: sanitized,
      }),
    );
    expect(card.kind).toBe('succeeded');
    expect(html).toContain('data-pilot-result-card="succeeded"');
    expect(html).toContain('docs/pilot/sp09-proof.md');
    expect(html).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('schemaVersion');


    const redacted = buildPilotSafeResultView({
      consoleStatus: 'succeeded',
      bridgeResult: {
        ...(row.result as RuntimeBridgeSafeResult),
        summary: 'ok sk-abcdefghijklmnopqrstuvwxyz0123456789',
      },
    });
    expect(redacted.summary).toBeNull();
    expect(buildPilotResultCardModel({
      consoleStatus: 'succeeded',
      result: redacted,
    }).summaryRu).toBe(PILOT_RESULT_FALLBACK_SUCCEEDED);
  });
});

describe('stage:pilot_telegram_silent_success', () => {
  it('S3.4 / matrix — happy-path lifecycle stays silent under strigunov_pilot_v1', async () => {
    expect(STRIGUNOV_PILOT_TELEGRAM_MATRIX.profile).toBe('strigunov_pilot_v1');
    expect(STRIGUNOV_PILOT_TELEGRAM_MATRIX.silentBareReadyForOwner).toBe(true);

    const runtime = await importRuntimeOwnerTelegramEvents();
    expect(runtime, 'asi-os-runtime events module required for SP-09 telegram stages').toBeTruthy();
    const profile = runtime!.STRIGUNOV_PILOT_TELEGRAM_PROFILE;
    expect(profile).toBe('strigunov_pilot_v1');

    for (const event of STRIGUNOV_PILOT_TELEGRAM_MATRIX.silentEvents) {
      expect(runtime!.isNotifiableEvent(event, { profile })).toBe(false);
    }
    expect(runtime!.isNotifiableEvent(runtime!.TASK_EVENTS.READY_FOR_OWNER, {
      profile,
      payload: { verdict: 'GO' },
    })).toBe(false);
  });
});

describe('stage:pilot_telegram_blocked', () => {
  it('S4.1–S4.4 — BLOCKED/FAILED/HITL notify; progress silent; pilot UI shows attention/failed', async () => {
    const runtime = await importRuntimeOwnerTelegramEvents();
    expect(runtime).toBeTruthy();
    const profile = runtime!.STRIGUNOV_PILOT_TELEGRAM_PROFILE;

    for (const event of STRIGUNOV_PILOT_TELEGRAM_MATRIX.notifyEvents) {
      expect(runtime!.isNotifiableEvent(event, { profile })).toBe(true);
    }
    expect(runtime!.isNotifiableEvent(runtime!.TASK_EVENTS.READY_FOR_OWNER, {
      profile,
      payload: { ownerMergeGate: true },
    })).toBe(true);
    expect(runtime!.isExplicitHitlPayload({ ownerMergeGate: true })).toBe(true);

    for (const event of STRIGUNOV_PILOT_TELEGRAM_MATRIX.silentEvents) {
      expect(runtime!.isNotifiableEvent(event, { profile })).toBe(false);
    }

    const blockedHtml = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: randomUUID(),
          title: 'Blocked',
          status: 'awaiting_owner',
          consoleStatus: 'blocked',
          createdAt: NOW,
          updatedAt: NOW,
        },
        result: {
          outcome: null,
          summary: null,
          changedFiles: [],
          pullRequestUrl: null,
          commitSha: null,
          blockers: ['Owner attention required'],
        },
      }),
    );
    expect(blockedHtml).toContain('data-pilot-result-card="blocked"');
    expect(blockedHtml).not.toMatch(/data-pilot-merge|Approve|Reject/i);

    const failedHtml = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: randomUUID(),
          title: 'Failed',
          status: 'failed',
          consoleStatus: 'failed',
          createdAt: NOW,
          updatedAt: NOW,
        },
        result: {
          outcome: 'failed',
          summary: 'Executor failed safely',
          changedFiles: [],
          pullRequestUrl: null,
          commitSha: null,
          blockers: [],
        },
      }),
    );
    expect(failedHtml).toContain('data-pilot-result-card="failed"');
  });
});

describe('stage:pilot_authz_isolation', () => {
  it('S1.3/S5.3 — cross-user task access is 404; conversation ids isolated', async () => {
    const store = { rows: [] as DurableRow[] };
    installDurableBridgeMock(store);
    const { __resetRuntimeBridgeSupabaseForTests } = await import('@/lib/asi-runtime/bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { submitPilotTask } = await import('../task-service');
    const { getPilotTaskDetailForUser } = await import('../task-access');

    const created = await submitPilotTask({
      pilotUserId: 'pilot-a',
      body: { goal: GREEN_GOAL, idempotencyKey: 'pilot-beta-idem-sp09-iso' },
    });

    await expect(getPilotTaskDetailForUser(created.task.taskId, 'pilot-b')).rejects.toMatchObject({
      code: 'task_not_found',
      status: 404,
    });

    const digestA = createHash('sha256').update('pilot_beta|pilot-a', 'utf8').digest('hex').slice(0, 24);
    const digestOwner = createHash('sha256').update('pilot-a', 'utf8').digest('hex').slice(0, 24);
    expect(createPilotConversationId('pilot-a')).toBe(`pilot-beta-${digestA}`);
    expect(createPilotConversationId('pilot-a')).not.toBe(`dev-console-owner-${digestOwner}`);

    const pageSrc = readFileSync(resolve(process.cwd(), 'src/app/api/pilot/__tests__/routes.test.ts'), 'utf8');
    expect(pageSrc).toMatch(/denies pilot_beta on Owner Development Console/);
  });
});

describe('stage:pilot_readiness_failclosed', () => {
  it('S6.1 — canLaunch false blocks create before Bridge', async () => {
    const { PilotAccessError } = await import('../errors');
    assertPilotSubmissionReady.mockRejectedValue(
      new PilotAccessError(
        'readiness_blocked',
        503,
        'Сейчас нельзя создать новую задачу. Runtime ещё не готов — попробуйте позже.',
      ),
    );
    const store = { rows: [] as DurableRow[] };
    installDurableBridgeMock(store);
    const { __resetRuntimeBridgeSupabaseForTests } = await import('@/lib/asi-runtime/bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { submitPilotTask } = await import('../task-service');

    await expect(submitPilotTask({
      pilotUserId: 'pilot-acceptance-ready',
      body: { goal: GREEN_GOAL, idempotencyKey: 'pilot-beta-idem-sp09-ready' },
    })).rejects.toMatchObject({ code: 'readiness_blocked', status: 503 });
    expect(store.rows).toHaveLength(0);
  });

  it('S6.2 — Bridge misconfigured returns safe 503', async () => {
    delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL;
    delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY;
    const { __resetRuntimeBridgeSupabaseForTests } = await import('@/lib/asi-runtime/bridge-supabase');
    __resetRuntimeBridgeSupabaseForTests();
    const { submitPilotTask } = await import('../task-service');

    await expect(submitPilotTask({
      pilotUserId: 'pilot-acceptance-bridge',
      body: { goal: GREEN_GOAL, idempotencyKey: 'pilot-beta-idem-sp09-bridge' },
    })).rejects.toMatchObject({ code: 'bridge_not_configured', status: 503 });
  });

  it('getPilotReadiness never leaks privileged readiness fields', async () => {
    const { getPilotReadiness: realGet } = await vi.importActual<typeof import('../readiness')>(
      '../readiness',
    );
    const view = await realGet({
      loadOwnerReadiness: async () => ({
        schemaVersion: 'asi.owner-console.readiness.v1',
        overallState: 'blocked',
        canLaunch: false,
        checkedAt: NOW,
        runnerEvidence: {
          identity: 'runner-host-secret',
          checkedAt: NOW,
          expiresAt: NOW,
          schemaVersion: 'asi.runtime.runner-readiness.v1',
          repositoryId: 'asi-landing',
          canonicalRepository: 'ASI-integration/asi-landing',
          observedBaselineSha: null,
          verifiedBaselineSha: null,
          readinessState: 'blocked',
          blockingReason: 'secret path /opt/runtime',
          evidenceAgeMs: 0,
        },
        components: {
          bridge: {
            state: 'blocked',
            reasonCode: 'bridge_config_missing',
            message: 'secret path /opt/runtime',
            blockingLaunch: true,
          },
          checkouts: {
            state: 'blocked',
            reasonCode: 'runtime_runner_readiness_missing',
            message: 'missing',
            blockingLaunch: true,
          },
          baseline: {
            state: 'blocked',
            reasonCode: 'baseline_unavailable',
            message: 'missing',
            blockingLaunch: true,
          },
          executor: {
            state: 'blocked',
            reasonCode: 'runtime_executor_missing',
            message: 'missing',
            blockingLaunch: true,
          },
          github: {
            state: 'blocked',
            reasonCode: 'github_provider_missing',
            message: 'missing',
            blockingLaunch: true,
          },
        },
      }),
    });
    expect(view.canSubmit).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/runner-host-secret|\/opt\/runtime|components|bridge_config_missing/i);
  });
});
