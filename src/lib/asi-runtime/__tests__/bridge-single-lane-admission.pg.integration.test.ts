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
});
