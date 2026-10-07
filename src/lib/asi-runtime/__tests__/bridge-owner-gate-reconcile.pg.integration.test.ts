/**
 * Disposable PostgreSQL proof for runner_reconcile_owner_gate.
 * Every fixture is rolled back or truncated; production/staging are never touched.
 *
 * Covers the restart-reconciliation crash window between an executor producing
 * owner_gate and Landing durably committing it (see
 * supabase/migrations/20260913000000_asi_runtime_bridge_owner_gate_reconcile_v1.sql).
 */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const required = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const available = Boolean(PG_URL) && !/staging|prod|production/iu.test(PG_URL);

const ORIGINAL_SQL = resolve(process.cwd(), 'supabase/migrations/20260724120000_asi_chat_runtime_bridge_v1.sql');
const ADMISSION_SQL = resolve(process.cwd(), 'supabase/migrations/20260912210000_asi_runtime_bridge_single_lane_admission_v1.sql');
const RECONCILE_SQL = resolve(process.cwd(), 'supabase/migrations/20260913000000_asi_runtime_bridge_owner_gate_reconcile_v1.sql');

type PgClient = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};

async function connect(): Promise<PgClient> {
  const pg = await import('pg') as unknown as {
    Client: new (input: { connectionString: string }) => PgClient;
  };
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  return client;
}

function requestHash(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

function requestBody(title: string): string {
  return JSON.stringify({
    title,
    objective: 'Pilot proof',
    instructions: ['docs/pilot'],
    repository: 'ASI-integration/asi-landing',
    baselineSha: 'a'.repeat(40),
  });
}

function gatePayload(input: { taskCycle: string; expiresAt: string; action?: string }): Record<string, unknown> {
  return {
    schemaVersion: 'asi.runtime.owner-gate.v1',
    action: input.action ?? 'production_deploy',
    exactTarget: 'production',
    identity: 'commit sha',
    reason: 'Owner approval required',
    evidence: [],
    allowedSideEffect: 'Deploy exact SHA',
    rollback: 'Use approved rollback runbook',
    postActionVerification: ['Verify health/version SHA'],
    taskCycle: input.taskCycle,
    expiresAt: input.expiresAt,
  };
}

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3_600_000).toISOString();

type TaskStatus = 'queued' | 'running' | 'awaiting_owner' | 'completed' | 'failed';
type GateStatus = 'pending' | 'approved' | 'rejected' | 'consumed' | 'expired';

type ReconcileResult = {
  status: 'COMMITTED' | 'COMMITTED_DEDUPLICATED' | 'RECOVERED_AND_COMMITTED' | 'TERMINAL' | 'SUPERSEDED' | 'CONFLICT';
  task: { taskId: string; status: TaskStatus; attemptCount: number; updatedAt: string } | null;
  gate: { gateId: string; taskId: string; status: GateStatus; taskCycle: string; createdAt: string } | null;
};

describe('Bridge owner-gate reconciliation PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL', () => {
    if (!required) return expect(required).toBe(false);
    expect(available).toBe(true);
    expect(PG_URL).toMatch(/^postgres(ql)?:\/\//u);
  });
});

describe.skipIf(!available)('Bridge owner-gate reconciliation PostgreSQL contract', () => {
  let admin: PgClient;

  beforeAll(async () => {
    admin = await connect();
    await admin.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      DO $roles$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END $roles$;
    `);
    await admin.query('DROP TABLE IF EXISTS public.asi_runtime_bridge_owner_gates CASCADE');
    await admin.query('DROP TABLE IF EXISTS public.asi_runtime_bridge_tasks CASCADE');
    await admin.query(`
      DROP FUNCTION IF EXISTS public.reconcile_asi_runtime_bridge_owner_gate(TEXT, TEXT, UUID, INTEGER, UUID, JSONB);
      DROP FUNCTION IF EXISTS public.submit_asi_runtime_bridge_task(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT);
      DROP FUNCTION IF EXISTS public.claim_asi_runtime_bridge_task(TEXT, TEXT, INTEGER);
      DROP FUNCTION IF EXISTS public.heartbeat_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, INTEGER);
      DROP FUNCTION IF EXISTS public.complete_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, JSONB);
      DROP FUNCTION IF EXISTS public.gate_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, JSONB);
      DROP FUNCTION IF EXISTS public.expire_asi_runtime_bridge_owner_gates(TEXT);
      DROP FUNCTION IF EXISTS public.fail_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, BOOLEAN, TEXT);
      DROP FUNCTION IF EXISTS public.decide_asi_runtime_bridge_owner_gate(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT);
    `);
    await admin.query(readFileSync(ORIGINAL_SQL, 'utf8'));
    await admin.query(readFileSync(ADMISSION_SQL, 'utf8'));
    await admin.query(readFileSync(RECONCILE_SQL, 'utf8'));
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.query('DROP TABLE IF EXISTS public.asi_runtime_bridge_owner_gates CASCADE').catch(() => undefined);
    await admin.query('DROP TABLE IF EXISTS public.asi_runtime_bridge_tasks CASCADE').catch(() => undefined);
    await admin.end();
  });

  async function resetTasks() {
    await admin.query('TRUNCATE public.asi_runtime_bridge_owner_gates, public.asi_runtime_bridge_tasks CASCADE');
  }

  async function insertTask(input: {
    key: string;
    status: TaskStatus;
    clientId?: string;
    attemptCount?: number;
    runnerId?: string | null;
    leaseToken?: string | null;
    leaseExpiresAt?: string | null;
  }): Promise<string> {
    const runnerId = input.runnerId ?? (input.status === 'running' ? 'runner-1' : null);
    const leaseToken = input.leaseToken ?? (input.status === 'running' ? randomUUID() : null);
    const leaseExpiresAt = input.leaseExpiresAt ?? (input.status === 'running' ? FUTURE : null);
    const attemptCount = input.attemptCount
      ?? (input.status === 'queued' || input.status === 'running' || input.status === 'awaiting_owner' ? 1 : 0);
    const result = await admin.query(
      `INSERT INTO public.asi_runtime_bridge_tasks (
         client_id, chatgpt_task_id, conversation_id, idempotency_key, request_hash, request, status,
         attempt_count, runner_id, lease_token, lease_expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        input.clientId ?? 'pilot-client-reconcile',
        `chat-${input.key}`, `conv-${input.key}`, input.key,
        requestHash(input.key), requestBody(input.key), input.status,
        attemptCount, runnerId, leaseToken, leaseExpiresAt,
      ],
    );
    return String(result.rows[0]!.id);
  }

  async function insertGate(input: {
    taskId: string;
    clientId?: string;
    taskCycle: string;
    status: GateStatus;
    request: Record<string, unknown>;
  }): Promise<string> {
    const result = await admin.query(
      `INSERT INTO public.asi_runtime_bridge_owner_gates (task_id, client_id, task_cycle, status, request)
       VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id`,
      [input.taskId, input.clientId ?? 'pilot-client-reconcile', input.taskCycle, input.status, JSON.stringify(input.request)],
    );
    return String(result.rows[0]!.id);
  }

  async function reconcile(
    client: PgClient,
    input: {
      clientId?: string;
      runnerId: string;
      taskId: string;
      attemptCount: number;
      originalLeaseToken?: string | null;
      gate: Record<string, unknown>;
    },
  ): Promise<ReconcileResult> {
    const result = await client.query(
      `SELECT public.reconcile_asi_runtime_bridge_owner_gate($1,$2,$3,$4,$5,$6::jsonb) AS result`,
      [
        input.clientId ?? 'pilot-client-reconcile',
        input.runnerId,
        input.taskId,
        input.attemptCount,
        input.originalLeaseToken ?? null,
        JSON.stringify(input.gate),
      ],
    );
    return result.rows[0]!.result as ReconcileResult;
  }

  async function taskRow(taskId: string) {
    const result = await admin.query(
      `SELECT status, attempt_count, runner_id, lease_token FROM public.asi_runtime_bridge_tasks WHERE id = $1`,
      [taskId],
    );
    return result.rows[0] as { status: TaskStatus; attempt_count: number; runner_id: string | null; lease_token: string | null } | undefined;
  }

  async function gateCount(taskId: string): Promise<number> {
    const result = await admin.query(
      `SELECT count(*)::int AS n FROM public.asi_runtime_bridge_owner_gates WHERE task_id = $1`,
      [taskId],
    );
    return Number(result.rows[0]!.n);
  }

  it('A1: running + exact current attempt + exact identity -> committed awaiting_owner', async () => {
    await resetTasks();
    const leaseToken = randomUUID();
    const taskId = await insertTask({ key: 'a1', status: 'running', attemptCount: 1, runnerId: 'runner-1', leaseToken, leaseExpiresAt: FUTURE });
    const gate = gatePayload({ taskCycle: 'cycle-a1', expiresAt: FUTURE });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, originalLeaseToken: leaseToken, gate });
    expect(result.status).toBe('COMMITTED');
    expect(result.task?.status).toBe('awaiting_owner');
    expect(result.gate?.taskCycle).toBe('cycle-a1');
    const row = await taskRow(taskId);
    expect(row?.status).toBe('awaiting_owner');
    expect(row?.runner_id).toBeNull();
    expect(row?.lease_token).toBeNull();
    expect(await gateCount(taskId)).toBe(1);
  });

  it('A2/A3: repeated reconciliation after commit (lost response) returns the exact same gate, deduplicated', async () => {
    await resetTasks();
    const leaseToken = randomUUID();
    const taskId = await insertTask({ key: 'a2', status: 'running', attemptCount: 1, runnerId: 'runner-1', leaseToken, leaseExpiresAt: FUTURE });
    const gate = gatePayload({ taskCycle: 'cycle-a2', expiresAt: FUTURE });
    const first = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, originalLeaseToken: leaseToken, gate });
    expect(first.status).toBe('COMMITTED');

    const replay = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, originalLeaseToken: leaseToken, gate });
    expect(replay.status).toBe('COMMITTED_DEDUPLICATED');
    expect(replay.gate?.gateId).toBe(first.gate?.gateId);
    expect(await gateCount(taskId)).toBe(1);

    const secondReplay = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, originalLeaseToken: leaseToken, gate });
    expect(secondReplay.status).toBe('COMMITTED_DEDUPLICATED');
    expect(secondReplay.gate?.gateId).toBe(first.gate?.gateId);
    expect(await gateCount(taskId)).toBe(1);
  });

  it('A4: running with expired lease but not reclaimed/superseded reconciles safely', async () => {
    await resetTasks();
    const leaseToken = randomUUID();
    const taskId = await insertTask({ key: 'a4', status: 'running', attemptCount: 1, runnerId: 'runner-1', leaseToken, leaseExpiresAt: PAST });
    const gate = gatePayload({ taskCycle: 'cycle-a4', expiresAt: FUTURE });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, originalLeaseToken: leaseToken, gate });
    expect(result.status).toBe('COMMITTED');
    expect((await taskRow(taskId))?.status).toBe('awaiting_owner');
  });

  it('A5: requeued after expired lease, same attempt_count, no newer claim -> recovered_and_committed', async () => {
    await resetTasks();
    const taskId = await insertTask({ key: 'a5', status: 'queued', attemptCount: 1 });
    const gate = gatePayload({ taskCycle: 'cycle-a5', expiresAt: FUTURE });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, gate });
    expect(result.status).toBe('RECOVERED_AND_COMMITTED');
    const row = await taskRow(taskId);
    expect(row?.status).toBe('awaiting_owner');
    expect(await gateCount(taskId)).toBe(1);
  });

  it('A6: requeued then claimed again (attempt_count incremented) -> old reconciliation SUPERSEDED, no mutation', async () => {
    await resetTasks();
    const newLease = randomUUID();
    const taskId = await insertTask({ key: 'a6', status: 'running', attemptCount: 2, runnerId: 'runner-2', leaseToken: newLease, leaseExpiresAt: FUTURE });
    const staleGate = gatePayload({ taskCycle: 'cycle-a6-stale', expiresAt: FUTURE });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, gate: staleGate });
    expect(result.status).toBe('SUPERSEDED');
    const row = await taskRow(taskId);
    expect(row?.status).toBe('running');
    expect(row?.attempt_count).toBe(2);
    expect(row?.runner_id).toBe('runner-2');
    expect(await gateCount(taskId)).toBe(0);
  });

  it('A7: different gate payload for the same taskCycle -> CONFLICT', async () => {
    await resetTasks();
    const leaseToken = randomUUID();
    const taskId = await insertTask({ key: 'a7', status: 'running', attemptCount: 1, runnerId: 'runner-1', leaseToken, leaseExpiresAt: FUTURE });
    const gate = gatePayload({ taskCycle: 'cycle-a7', expiresAt: FUTURE });
    const first = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, originalLeaseToken: leaseToken, gate });
    expect(first.status).toBe('COMMITTED');

    const conflicting = gatePayload({ taskCycle: 'cycle-a7', expiresAt: FUTURE, action: 'different_action' });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, originalLeaseToken: leaseToken, gate: conflicting });
    expect(result.status).toBe('CONFLICT');
    expect(await gateCount(taskId)).toBe(1);
  });

  it('A8: two simultaneous identical reconciliation calls yield exactly one gate row and committed semantics for both', async () => {
    await resetTasks();
    const leaseToken = randomUUID();
    const taskId = await insertTask({ key: 'a8', status: 'running', attemptCount: 1, runnerId: 'runner-1', leaseToken, leaseExpiresAt: FUTURE });
    const gate = gatePayload({ taskCycle: 'cycle-a8', expiresAt: FUTURE });
    const left = await connect();
    const right = await connect();
    try {
      const [leftResult, rightResult] = await Promise.all([
        reconcile(left, { runnerId: 'runner-1', taskId, attemptCount: 1, originalLeaseToken: leaseToken, gate }),
        reconcile(right, { runnerId: 'runner-1', taskId, attemptCount: 1, originalLeaseToken: leaseToken, gate }),
      ]);
      const statuses = [leftResult.status, rightResult.status].sort();
      expect(statuses).toEqual(['COMMITTED', 'COMMITTED_DEDUPLICATED']);
      expect(leftResult.gate?.gateId).toBe(rightResult.gate?.gateId);
      expect(await gateCount(taskId)).toBe(1);
    } finally {
      await left.end();
      await right.end();
    }
    console.info('BRIDGE_RECONCILE_CONCURRENT_PG_PROOF', JSON.stringify({
      exactlyOneGateRow: true,
      bothReceiveCommittedSemantics: true,
      productionTouched: false,
      stagingTouched: false,
    }));
  });

  it('A9: completed task -> TERMINAL, no gate recreation', async () => {
    await resetTasks();
    const taskId = await insertTask({ key: 'a9', status: 'completed' });
    const gate = gatePayload({ taskCycle: 'cycle-a9', expiresAt: FUTURE });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 0, gate });
    expect(result.status).toBe('TERMINAL');
    expect(await gateCount(taskId)).toBe(0);
  });

  it('A10: failed task -> TERMINAL, no gate recreation', async () => {
    await resetTasks();
    const taskId = await insertTask({ key: 'a10', status: 'failed' });
    const gate = gatePayload({ taskCycle: 'cycle-a10', expiresAt: FUTURE });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 0, gate });
    expect(result.status).toBe('TERMINAL');
    expect(await gateCount(taskId)).toBe(0);
  });

  it('A11: rejected gate cannot be recreated pending', async () => {
    await resetTasks();
    const taskId = await insertTask({ key: 'a11', status: 'failed', attemptCount: 1 });
    const gate = gatePayload({ taskCycle: 'cycle-a11', expiresAt: FUTURE });
    await insertGate({ taskId, taskCycle: 'cycle-a11', status: 'rejected', request: gate });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, gate });
    expect(result.status).toBe('TERMINAL');
    expect(await gateCount(taskId)).toBe(1);
    const gateRow = await admin.query(`SELECT status FROM public.asi_runtime_bridge_owner_gates WHERE task_id = $1`, [taskId]);
    expect(gateRow.rows[0]?.status).toBe('rejected');
  });

  it('A12: approved/consumed gate cannot create a duplicate pending gate', async () => {
    await resetTasks();
    const newLease = randomUUID();
    const taskId = await insertTask({ key: 'a12', status: 'running', attemptCount: 2, runnerId: 'runner-2', leaseToken: newLease, leaseExpiresAt: FUTURE });
    const gate = gatePayload({ taskCycle: 'cycle-a12', expiresAt: FUTURE });
    await insertGate({ taskId, taskCycle: 'cycle-a12', status: 'consumed', request: gate });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, gate });
    expect(result.status).toBe('SUPERSEDED');
    expect(await gateCount(taskId)).toBe(1);
    const row = await taskRow(taskId);
    expect(row?.status).toBe('running');
    expect(row?.attempt_count).toBe(2);
  });

  it('A13: wrong runner identity with a matching attempt_count fails closed (running branch)', async () => {
    await resetTasks();
    const leaseToken = randomUUID();
    const taskId = await insertTask({ key: 'a13', status: 'running', attemptCount: 1, runnerId: 'runner-1', leaseToken, leaseExpiresAt: FUTURE });
    const gate = gatePayload({ taskCycle: 'cycle-a13', expiresAt: FUTURE });
    const result = await reconcile(admin, { runnerId: 'runner-impostor', taskId, attemptCount: 1, originalLeaseToken: leaseToken, gate });
    expect(result.status).toBe('SUPERSEDED');
    expect(await gateCount(taskId)).toBe(0);
    const row = await taskRow(taskId);
    expect(row?.status).toBe('running');
  });

  it('A13b: wrong original lease token with matching runner/attempt fails closed (running branch)', async () => {
    await resetTasks();
    const leaseToken = randomUUID();
    const taskId = await insertTask({ key: 'a13b', status: 'running', attemptCount: 1, runnerId: 'runner-1', leaseToken, leaseExpiresAt: FUTURE });
    const gate = gatePayload({ taskCycle: 'cycle-a13b', expiresAt: FUTURE });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, originalLeaseToken: randomUUID(), gate });
    expect(result.status).toBe('SUPERSEDED');
    expect(await gateCount(taskId)).toBe(0);
  });

  it('A13c: queued recovery rule explicitly applies when attempt_count matches even without a lease token', async () => {
    await resetTasks();
    const taskId = await insertTask({ key: 'a13c', status: 'queued', attemptCount: 3 });
    const gate = gatePayload({ taskCycle: 'cycle-a13c', expiresAt: FUTURE });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 3, gate });
    expect(result.status).toBe('RECOVERED_AND_COMMITTED');
  });

  it('A14: cross-client task access leaks nothing and mutates nothing', async () => {
    await resetTasks();
    const leaseToken = randomUUID();
    const taskId = await insertTask({
      key: 'a14', status: 'running', attemptCount: 1, runnerId: 'runner-1', leaseToken, leaseExpiresAt: FUTURE,
      clientId: 'pilot-client-owner',
    });
    const gate = gatePayload({ taskCycle: 'cycle-a14', expiresAt: FUTURE });
    const result = await reconcile(admin, {
      clientId: 'pilot-client-intruder', runnerId: 'runner-1', taskId, attemptCount: 1, originalLeaseToken: leaseToken, gate,
    });
    expect(result.status).toBe('CONFLICT');
    expect(result.task).toBeNull();
    expect(result.gate).toBeNull();
    const row = await taskRow(taskId);
    expect(row?.status).toBe('running');
    expect(await gateCount(taskId)).toBe(0);
  });

  it('expires an already-stale exact gate at reconcile time instead of creating a doomed pending gate', async () => {
    await resetTasks();
    const taskId = await insertTask({ key: 'stale-gate', status: 'queued', attemptCount: 1 });
    const gate = gatePayload({ taskCycle: 'cycle-stale', expiresAt: PAST });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId, attemptCount: 1, gate });
    expect(result.status).toBe('TERMINAL');
    expect(await gateCount(taskId)).toBe(0);
    const row = await taskRow(taskId);
    expect(row?.status).toBe('failed');
  });

  it('rejects a malformed reconciliation request', async () => {
    await resetTasks();
    const taskId = await insertTask({ key: 'invalid', status: 'queued', attemptCount: 1 });
    await expect(admin.query(
      `SELECT public.reconcile_asi_runtime_bridge_owner_gate($1,$2,$3,$4,$5,$6::jsonb) AS result`,
      ['pilot-client-reconcile', 'runner-1', taskId, 1, null, JSON.stringify({ schemaVersion: 'wrong' })],
    )).rejects.toMatchObject({ message: expect.stringContaining('invalid_owner_gate_reconcile') });
  });

  it('unknown task returns CONFLICT with no leak and no mutation', async () => {
    await resetTasks();
    const gate = gatePayload({ taskCycle: 'cycle-unknown', expiresAt: FUTURE });
    const result = await reconcile(admin, { runnerId: 'runner-1', taskId: randomUUID(), attemptCount: 1, gate });
    expect(result.status).toBe('CONFLICT');
    expect(result.task).toBeNull();
    expect(result.gate).toBeNull();
  });
});
