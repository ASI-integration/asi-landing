/**
 * Disposable PostgreSQL proof for Bridge single-lane admission.
 * Every fixture is rolled back or truncated; production/staging are never touched.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRIDGE_ADMISSION_BUSY_CODE } from '../execution-lane-contract';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const required = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const available = Boolean(PG_URL) && !/staging|prod|production/iu.test(PG_URL);

const ORIGINAL_SQL = resolve(
  process.cwd(),
  'supabase/migrations/20260724120000_asi_chat_runtime_bridge_v1.sql',
);
const ADMISSION_SQL = resolve(
  process.cwd(),
  'supabase/migrations/20260912210000_asi_runtime_bridge_single_lane_admission_v1.sql',
);

type PgClient = {
  connect(): Promise<void>;
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
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

async function submit(
  client: PgClient,
  input: {
    clientId: string;
    chatgptTaskId: string;
    conversationId: string;
    idempotencyKey: string;
    title: string;
    hash?: string;
  },
) {
  return client.query(
    `SELECT public.submit_asi_runtime_bridge_task($1,$2,$3,$4,$5::jsonb,$6) AS result`,
    [
      input.clientId,
      input.chatgptTaskId,
      input.conversationId,
      input.idempotencyKey,
      requestBody(input.title),
      input.hash ?? requestHash(input.title),
    ],
  );
}

describe('Bridge single-lane admission PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL', () => {
    if (!required) return expect(required).toBe(false);
    expect(available).toBe(true);
    expect(PG_URL).toMatch(/^postgres(ql)?:\/\//u);
  });
});

describe.skipIf(!available)('Bridge single-lane admission PostgreSQL contract', () => {
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

  it('deduplicates the same request and rejects a second new admit', async () => {
    await resetTasks();
    const first = await submit(admin, {
      clientId: 'pilot-client-a',
      chatgptTaskId: 'chat-a',
      conversationId: 'conv-a',
      idempotencyKey: 'idem-a',
      title: 'First',
    });
    const firstResult = first.rows[0]?.result as { deduplicated: boolean; task: { id: string } };
    expect(firstResult.deduplicated).toBe(false);

    const retry = await submit(admin, {
      clientId: 'pilot-client-a',
      chatgptTaskId: 'chat-a',
      conversationId: 'conv-a',
      idempotencyKey: 'idem-a',
      title: 'First',
    });
    const retryResult = retry.rows[0]?.result as { deduplicated: boolean; task: { id: string } };
    expect(retryResult.deduplicated).toBe(true);
    expect(retryResult.task.id).toBe(firstResult.task.id);

    await expect(submit(admin, {
      clientId: 'pilot-client-a',
      chatgptTaskId: 'chat-b',
      conversationId: 'conv-a',
      idempotencyKey: 'idem-b',
      title: 'Second',
    })).rejects.toMatchObject({ message: expect.stringContaining(BRIDGE_ADMISSION_BUSY_CODE) });

    await expect(submit(admin, {
      clientId: 'pilot-client-b',
      chatgptTaskId: 'chat-other',
      conversationId: 'conv-other',
      idempotencyKey: 'idem-other',
      title: 'Other user',
    })).rejects.toMatchObject({ message: expect.stringContaining(BRIDGE_ADMISSION_BUSY_CODE) });

    await expect(submit(admin, {
      clientId: 'pilot-client-a',
      chatgptTaskId: 'chat-conflict',
      conversationId: 'conv-a',
      idempotencyKey: 'idem-a',
      title: 'Changed',
      hash: requestHash('Changed'),
    })).rejects.toMatchObject({ message: expect.stringContaining('idempotency_conflict') });
  });

  it('keeps awaiting_owner occupying the lane until the task is terminal', async () => {
    await resetTasks();
    await submit(admin, {
      clientId: 'pilot-client-a',
      chatgptTaskId: 'chat-hitl',
      conversationId: 'conv-hitl',
      idempotencyKey: 'idem-hitl',
      title: 'HITL',
    });
    await admin.query(
      `UPDATE public.asi_runtime_bridge_tasks SET status = 'awaiting_owner' WHERE idempotency_key = 'idem-hitl'`,
    );
    await expect(submit(admin, {
      clientId: 'pilot-client-a',
      chatgptTaskId: 'chat-next',
      conversationId: 'conv-hitl',
      idempotencyKey: 'idem-next',
      title: 'Next',
    })).rejects.toMatchObject({ message: expect.stringContaining(BRIDGE_ADMISSION_BUSY_CODE) });

    await admin.query(
      `UPDATE public.asi_runtime_bridge_tasks SET status = 'completed' WHERE idempotency_key = 'idem-hitl'`,
    );
    const afterTerminal = await submit(admin, {
      clientId: 'pilot-client-a',
      chatgptTaskId: 'chat-next',
      conversationId: 'conv-hitl',
      idempotencyKey: 'idem-next',
      title: 'Next',
    });
    expect((afterTerminal.rows[0]?.result as { deduplicated: boolean }).deduplicated).toBe(false);
  });

  it('rejects two simultaneous new submissions so only one is admitted', async () => {
    await resetTasks();
    const left = await connect();
    const right = await connect();
    const leftInput = {
      clientId: 'pilot-client-left',
      chatgptTaskId: 'chat-left',
      conversationId: 'conv-left',
      idempotencyKey: `idem-left-${randomUUID()}`,
      title: 'Left',
    };
    const rightInput = {
      clientId: 'pilot-client-right',
      chatgptTaskId: 'chat-right',
      conversationId: 'conv-right',
      idempotencyKey: `idem-right-${randomUUID()}`,
      title: 'Right',
    };
    try {
      const settled = await Promise.allSettled([
        submit(left, leftInput),
        submit(right, rightInput),
      ]);
      const fulfilled = settled.filter((item) => item.status === 'fulfilled');
      const rejected = settled.filter((item) => item.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const rejection = rejected[0] as PromiseRejectedResult;
      expect(String(rejection.reason?.message ?? rejection.reason)).toContain(BRIDGE_ADMISSION_BUSY_CODE);
      const count = await admin.query(
        `SELECT count(*)::int AS n FROM public.asi_runtime_bridge_tasks WHERE status IN ('queued','running','awaiting_owner')`,
      );
      expect(count.rows[0]?.n).toBe(1);
    } finally {
      await left.end();
      await right.end();
    }
    console.info('BRIDGE_SINGLE_LANE_PG_PROOF', JSON.stringify({
      simultaneousCreates: true,
      exactlyOneAdmitted: true,
      loserCode: BRIDGE_ADMISSION_BUSY_CODE,
      idempotentRetryPreserved: true,
      awaitingOwnerHoldsLane: true,
      crossClientBlocked: true,
      productionTouched: false,
      stagingTouched: false,
    }));
  });

  it('deduplicates two concurrent exact retries of the same key', async () => {
    await resetTasks();
    const first = await submit(admin, {
      clientId: 'pilot-client-same',
      chatgptTaskId: 'chat-same',
      conversationId: 'conv-same',
      idempotencyKey: 'idem-same',
      title: 'Same',
    });
    const firstId = (first.rows[0]?.result as { task: { id: string } }).task.id;
    const left = await connect();
    const right = await connect();
    const sameInput = {
      clientId: 'pilot-client-same',
      chatgptTaskId: 'chat-same',
      conversationId: 'conv-same',
      idempotencyKey: 'idem-same',
      title: 'Same',
    };
    try {
      const settled = await Promise.allSettled([
        submit(left, sameInput),
        submit(right, sameInput),
      ]);
      expect(settled.every((item) => item.status === 'fulfilled')).toBe(true);
      const ids = settled.map((item) => (
        (item as PromiseFulfilledResult<{ rows: Array<{ result: { task: { id: string } } }> }>).value
          .rows[0]!.result.task.id
      ));
      expect(new Set(ids)).toEqual(new Set([firstId]));
      const count = await admin.query('SELECT count(*)::int AS n FROM public.asi_runtime_bridge_tasks');
      expect(count.rows[0]?.n).toBe(1);
    } finally {
      await left.end();
      await right.end();
    }
  });
});

const PREFLIGHT_ERROR = 'asi_runtime_bridge_single_lane_preflight_failed';
const STAGING_ADMISSION_SQL = resolve(
  process.cwd(),
  'supabase/staging/20260912210000_runtime_bridge_single_lane_admission_v1.sql',
);

describe.skipIf(!available)('Bridge single-lane admission migration preflight', () => {
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
    await admin.query('DROP SCHEMA IF EXISTS runtime_bridge CASCADE');
    await admin.query(`
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
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.query('DROP TABLE IF EXISTS public.asi_runtime_bridge_owner_gates CASCADE').catch(() => undefined);
    await admin.query('DROP TABLE IF EXISTS public.asi_runtime_bridge_tasks CASCADE').catch(() => undefined);
    await admin.query('DROP SCHEMA IF EXISTS runtime_bridge CASCADE').catch(() => undefined);
    await admin.end();
  });

  async function applyAdmission(sql: string) {
    await admin.query('BEGIN');
    try {
      await admin.query(sql);
      await admin.query('COMMIT');
    } catch (error) {
      try {
        await admin.query('ROLLBACK');
      } catch {
        /* transaction already aborted */
      }
      throw error;
    }
  }

  async function dropPublicIndex() {
    await admin.query('DROP INDEX IF EXISTS public.idx_asi_runtime_bridge_single_nonterminal');
  }

  async function indexExists(schema: 'public' | 'runtime_bridge'): Promise<boolean> {
    const result = await admin.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'idx_asi_runtime_bridge_single_nonterminal'`,
      [schema],
    );
    return result.rows.length > 0;
  }

  async function insertPublicTask(input: {
    key: string;
    status: 'queued' | 'running' | 'awaiting_owner' | 'completed' | 'failed';
    clientId?: string;
  }) {
    await admin.query(
      `INSERT INTO public.asi_runtime_bridge_tasks (
         client_id, chatgpt_task_id, conversation_id, idempotency_key, request_hash, request, status,
         runner_id, lease_token, lease_expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
      [
        input.clientId ?? 'pilot-client-preflight',
        `chat-${input.key}`,
        `conv-${input.key}`,
        input.key,
        requestHash(input.key),
        requestBody(input.key),
        input.status,
        input.status === 'running' ? 'runner-preflight' : null,
        input.status === 'running' ? randomUUID() : null,
        input.status === 'running' ? new Date().toISOString() : null,
      ],
    );
  }

  it('applies when zero non-terminal rows exist', async () => {
    await admin.query('TRUNCATE public.asi_runtime_bridge_owner_gates, public.asi_runtime_bridge_tasks CASCADE');
    await dropPublicIndex();
    await applyAdmission(readFileSync(ADMISSION_SQL, 'utf8'));
    expect(await indexExists('public')).toBe(true);
  });

  it('applies when exactly one non-terminal row exists', async () => {
    await admin.query('TRUNCATE public.asi_runtime_bridge_owner_gates, public.asi_runtime_bridge_tasks CASCADE');
    await dropPublicIndex();
    await insertPublicTask({ key: 'idem-one', status: 'queued' });
    await applyAdmission(readFileSync(ADMISSION_SQL, 'utf8'));
    expect(await indexExists('public')).toBe(true);
    const remaining = await admin.query(
      `SELECT count(*)::int AS n FROM public.asi_runtime_bridge_tasks WHERE idempotency_key = 'idem-one'`,
    );
    expect(remaining.rows[0]?.n).toBe(1);
  });

  it('fails closed before index creation when two non-terminal rows exist', async () => {
    await admin.query('TRUNCATE public.asi_runtime_bridge_owner_gates, public.asi_runtime_bridge_tasks CASCADE');
    await dropPublicIndex();
    await insertPublicTask({ key: 'idem-left', status: 'queued' });
    await insertPublicTask({ key: 'idem-right', status: 'awaiting_owner' });
    await expect(applyAdmission(readFileSync(ADMISSION_SQL, 'utf8'))).rejects.toMatchObject({
      message: expect.stringContaining(PREFLIGHT_ERROR),
    });
    expect(await indexExists('public')).toBe(false);
    const leftover = await admin.query(
      `SELECT idempotency_key, status
         FROM public.asi_runtime_bridge_tasks
        ORDER BY idempotency_key`,
    );
    expect(leftover.rows).toEqual([
      { idempotency_key: 'idem-left', status: 'queued' },
      { idempotency_key: 'idem-right', status: 'awaiting_owner' },
    ]);
  });

  it('does not count terminal completed/failed rows', async () => {
    await admin.query('TRUNCATE public.asi_runtime_bridge_owner_gates, public.asi_runtime_bridge_tasks CASCADE');
    await dropPublicIndex();
    await insertPublicTask({ key: 'idem-done', status: 'completed' });
    await insertPublicTask({ key: 'idem-fail', status: 'failed' });
    await applyAdmission(readFileSync(ADMISSION_SQL, 'utf8'));
    expect(await indexExists('public')).toBe(true);

    await dropPublicIndex();
    await insertPublicTask({ key: 'idem-active', status: 'running' });
    await applyAdmission(readFileSync(ADMISSION_SQL, 'utf8'));
    expect(await indexExists('public')).toBe(true);

    await dropPublicIndex();
    await insertPublicTask({ key: 'idem-extra', status: 'queued' });
    await expect(applyAdmission(readFileSync(ADMISSION_SQL, 'utf8'))).rejects.toMatchObject({
      message: expect.stringContaining(PREFLIGHT_ERROR),
    });
    expect(await indexExists('public')).toBe(false);
    const statuses = await admin.query(
      `SELECT status FROM public.asi_runtime_bridge_tasks ORDER BY idempotency_key`,
    );
    expect(statuses.rows.map((row) => row.status)).toEqual([
      'running',
      'completed',
      'queued',
      'failed',
    ]);
  });

  it('staging runtime_bridge follow-up uses the same fail-closed preflight', async () => {
    await admin.query('DROP SCHEMA IF EXISTS runtime_bridge CASCADE');
    await admin.query('CREATE SCHEMA runtime_bridge');
    await admin.query(`
      CREATE TABLE runtime_bridge.asi_runtime_bridge_tasks (
        LIKE public.asi_runtime_bridge_tasks INCLUDING DEFAULTS INCLUDING CONSTRAINTS
      )
    `);
    const stagingSql = readFileSync(STAGING_ADMISSION_SQL, 'utf8');

    await applyAdmission(stagingSql);
    expect(await indexExists('runtime_bridge')).toBe(true);

    await admin.query('DROP INDEX IF EXISTS runtime_bridge.idx_asi_runtime_bridge_single_nonterminal');
    await admin.query(
      `INSERT INTO runtime_bridge.asi_runtime_bridge_tasks (
         client_id, chatgpt_task_id, conversation_id, idempotency_key, request_hash, request, status
       ) VALUES
         ('pilot-client-preflight', 'chat-a', 'conv-a', 'idem-a', $1, $2::jsonb, 'queued'),
         ('pilot-client-preflight', 'chat-b', 'conv-b', 'idem-b', $3, $4::jsonb, 'queued')`,
      [requestHash('a'), requestBody('A'), requestHash('b'), requestBody('B')],
    );
    await expect(applyAdmission(stagingSql)).rejects.toMatchObject({
      message: expect.stringContaining(PREFLIGHT_ERROR),
    });
    expect(await indexExists('runtime_bridge')).toBe(false);
    const leftover = await admin.query(
      'SELECT count(*)::int AS n FROM runtime_bridge.asi_runtime_bridge_tasks',
    );
    expect(leftover.rows[0]?.n).toBe(2);

    console.info('BRIDGE_SINGLE_LANE_PREFLIGHT_PG_PROOF', JSON.stringify({
      zeroRowsApplies: true,
      oneRowApplies: true,
      twoRowsFailClosed: true,
      terminalRowsExcluded: true,
      stagingSchemaCovered: true,
      historicalRowsUnchanged: true,
      productionTouched: false,
      stagingTouched: false,
    }));
  });
});
