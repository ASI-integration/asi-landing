import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { validateTrustedPartnerCommunicationEvent } from '../contract';
import { SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1 } from '../synthetic';
import {
  PartnerCommunicationStateError,
  createPartnerCommunicationStateRepository,
  partnerSessionIdentityFromContext,
  type PartnerCommunicationStateDatabase,
} from '../state-repository';

type Row = Record<string, any>;

const ACCOUNT_A = '10000000-0000-4000-8000-000000000001';
const ACCOUNT_B = '20000000-0000-4000-8000-000000000002';
const MIGRATION = '20260815102111_partner_communication_durable_state_v1.sql';

class MemoryDatabase implements PartnerCommunicationStateDatabase {
  bindings: Row[] = [];
  sessions: Row[] = [];
  turns: Row[] = [];
  handoffs: Row[] = [];
  actions: Row[] = [];

  async findBindings(input: Row) {
    return this.bindings.filter((row) => row.partner_id === input.partnerId
      && row.external_account_id === input.externalPartnerAccountId) as any;
  }

  async findSession(input: Row) {
    return this.sessions.find((row) => row.account_id === input.accountId
      && row.partner_id === input.partnerId
      && row.external_partner_account_id === input.externalPartnerAccountId
      && row.canonical_conversation_key === input.canonicalConversationKey) as any ?? null;
  }

  async getSession(input: Row) {
    return this.sessions.find((row) => row.account_id === input.accountId
      && row.id === input.sessionId) as any ?? null;
  }

  async insertSession(row: Row) {
    const conflict = this.sessions.some((existing) => existing.account_id === row.account_id
      && existing.partner_id === row.partner_id
      && existing.external_partner_account_id === row.external_partner_account_id
      && (existing.canonical_conversation_key === row.canonical_conversation_key
        || existing.external_conversation_id === row.external_conversation_id));
    if (conflict) return { row: null, conflict: true };
    this.sessions.push({ ...row });
    return { row: { ...row } as any, conflict: false };
  }

  async findTurn(input: Row) {
    return this.turns.find((row) => row.account_id === input.accountId
      && row.session_id === input.sessionId
      && (row.canonical_message_key === input.canonicalMessageKey
        || row.external_message_id === input.externalMessageId)) as any ?? null;
  }

  async insertTurn(row: Row) {
    const conflict = this.turns.some((existing) => existing.account_id === row.account_id
      && existing.session_id === row.session_id
      && (existing.canonical_message_key === row.canonical_message_key
        || existing.external_message_id === row.external_message_id));
    if (conflict) return { row: null, conflict: true };
    this.turns.push({ ...row });
    return { row: { ...row } as any, conflict: false };
  }

  async findActiveHandoff(input: Row) {
    return this.handoffs.find((row) => row.account_id === input.accountId
      && row.session_id === input.sessionId
      && ['pending', 'acknowledged'].includes(row.status)) as any ?? null;
  }

  async getHandoff(input: Row) {
    return this.handoffs.find((row) => row.account_id === input.accountId
      && row.session_id === input.sessionId
      && row.id === input.handoffId) as any ?? null;
  }

  async insertHandoff(row: Row) {
    const conflict = Boolean(await this.findActiveHandoff({
      accountId: row.account_id,
      sessionId: row.session_id,
    }));
    if (conflict) return { row: null, conflict: true };
    this.handoffs.push({ ...row });
    return { row: { ...row } as any, conflict: false };
  }

  async updateHandoff(input: Row) {
    const row = await this.getHandoff(input);
    if (!row) return null;
    Object.assign(row, input.patch);
    return { ...row } as any;
  }

  async findAction(input: Row) {
    return this.actions.find((row) => row.account_id === input.accountId
      && row.session_id === input.sessionId
      && row.idempotency_key === input.idempotencyKey) as any ?? null;
  }

  async getAction(input: Row) {
    return this.actions.find((row) => row.account_id === input.accountId
      && row.session_id === input.sessionId
      && row.id === input.actionId) as any ?? null;
  }

  async insertAction(row: Row) {
    const conflict = Boolean(await this.findAction({
      accountId: row.account_id,
      sessionId: row.session_id,
      idempotencyKey: row.idempotency_key,
    }));
    if (conflict) return { row: null, conflict: true };
    this.actions.push({ ...row });
    return { row: { ...row } as any, conflict: false };
  }

  async updateAction(input: Row) {
    const row = await this.getAction(input);
    if (!row) return null;
    Object.assign(row, input.patch);
    return { ...row } as any;
  }
}

function binding(accountId: string, externalAccountId: string, status: 'active' | 'disabled' = 'active'): Row {
  return {
    id: crypto.randomUUID(),
    account_id: accountId,
    partner_id: 'partner-1',
    external_account_id: externalAccountId,
    status,
  };
}

function context(externalAccountId: string, patch: Row = {}) {
  return validateTrustedPartnerCommunicationEvent({
    ...structuredClone(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
    partner: { partnerId: 'partner-1', accountId: externalAccountId },
    ...patch,
  });
}

async function sessionFor(
  database: MemoryDatabase,
  accountId: string,
  externalAccountId: string,
  patch: Row = {},
) {
  database.bindings.push(binding(accountId, externalAccountId));
  const repository = createPartnerCommunicationStateRepository(database);
  const partnerContext = context(externalAccountId, patch);
  const tenant = await repository.resolvePartnerAccountBinding({
    partnerId: 'partner-1',
    externalPartnerAccountId: externalAccountId,
  });
  const identity = partnerSessionIdentityFromContext(tenant, partnerContext);
  const session = await repository.getOrCreatePartnerSession({ accountId, identity });
  return { repository, partnerContext, tenant, identity, session };
}

function expectStateCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({
    name: 'PartnerCommunicationStateError',
    code,
    message: code,
  });
}

describe('Partner Communication durable state repository', () => {
  let database: MemoryDatabase;

  beforeEach(() => {
    database = new MemoryDatabase();
  });

  it('resolves exactly one server-side binding to canonical accounts.id', async () => {
    database.bindings.push(binding(ACCOUNT_A, 'external-account-A'));
    const repository = createPartnerCommunicationStateRepository(database);
    await expect(repository.resolvePartnerAccountBinding({
      partnerId: 'partner-1',
      externalPartnerAccountId: 'external-account-A',
    })).resolves.toMatchObject({
      accountId: ACCOUNT_A,
      partnerId: 'partner-1',
      externalPartnerAccountId: 'external-account-A',
    });
  });

  it('fails closed for missing, disabled, or conflicting bindings', async () => {
    const repository = createPartnerCommunicationStateRepository(database);
    await expectStateCode(repository.resolvePartnerAccountBinding({
      partnerId: 'partner-1', externalPartnerAccountId: 'missing',
    }), 'binding_missing');

    database.bindings.push(binding(ACCOUNT_A, 'disabled', 'disabled'));
    await expectStateCode(repository.resolvePartnerAccountBinding({
      partnerId: 'partner-1', externalPartnerAccountId: 'disabled',
    }), 'binding_disabled');

    database.bindings.push(binding(ACCOUNT_A, 'conflict'), binding(ACCOUNT_B, 'conflict'));
    await expectStateCode(repository.resolvePartnerAccountBinding({
      partnerId: 'partner-1', externalPartnerAccountId: 'conflict',
    }), 'binding_conflict');
  });

  it('combines a validated contract context with only the server-resolved ASI tenant', async () => {
    database.bindings.push(binding(ACCOUNT_A, 'external-account-A'));
    const repository = createPartnerCommunicationStateRepository(database);
    const partnerContext = context('external-account-A');
    const tenant = await repository.resolvePartnerAccountBinding({
      partnerId: partnerContext.identity.partnerId,
      externalPartnerAccountId: partnerContext.identity.accountId,
    });
    const identity = partnerSessionIdentityFromContext(tenant, partnerContext);
    expect(identity).toMatchObject({
      accountId: ACCOUNT_A,
      externalPartnerAccountId: 'external-account-A',
      externalPropertyId: 'property-101',
      externalBookingId: 'booking-5001',
      externalConversationId: 'conversation-900',
    });
    expect(identity.accountId).not.toBe(partnerContext.identity.accountId);
  });

  it('rejects a binding/context mapping conflict', async () => {
    database.bindings.push(binding(ACCOUNT_A, 'external-account-A'));
    const repository = createPartnerCommunicationStateRepository(database);
    const tenant = await repository.resolvePartnerAccountBinding({
      partnerId: 'partner-1', externalPartnerAccountId: 'external-account-A',
    });
    expect(() => partnerSessionIdentityFromContext(tenant, context('external-account-B')))
      .toThrowError(new PartnerCommunicationStateError('binding_conflict'));
  });

  it('isolates identical conversation, booking, and property IDs across accounts', async () => {
    const first = await sessionFor(database, ACCOUNT_A, 'external-account-A');
    const second = await sessionFor(database, ACCOUNT_B, 'external-account-B');
    expect(first.session.id).not.toBe(second.session.id);
    expect(first.session.accountId).toBe(ACCOUNT_A);
    expect(second.session.accountId).toBe(ACCOUNT_B);
    expect(first.session.externalConversationId).toBe(second.session.externalConversationId);
    expect(first.session.externalBookingId).toBe(second.session.externalBookingId);
    expect(first.session.externalPropertyId).toBe(second.session.externalPropertyId);
  });

  it('deduplicates the same canonical/external message in one durable session', async () => {
    const { repository, partnerContext, session } = await sessionFor(database, ACCOUNT_A, 'external-account-A');
    const input = {
      accountId: ACCOUNT_A,
      sessionId: session.id,
      canonicalMessageKey: partnerContext.keys.partnerMessageKey,
      externalMessageId: partnerContext.identity.messageId,
      direction: 'inbound' as const,
      text: partnerContext.message.text,
      metadata: { channel: 'partner_messaging' },
    };
    const first = await repository.appendPartnerTurn(input);
    const duplicate = await repository.appendPartnerTurn(input);
    expect(duplicate.id).toBe(first.id);
    await expectStateCode(repository.appendPartnerTurn({
      ...input,
      canonicalMessageKey: `${input.canonicalMessageKey}:conflict`,
    }), 'state_conflict');
    expect(database.turns).toHaveLength(1);
  });

  it('allows the same external message ID in separate accounts', async () => {
    const first = await sessionFor(database, ACCOUNT_A, 'external-account-A');
    const second = await sessionFor(database, ACCOUNT_B, 'external-account-B');
    const turnA = await first.repository.appendPartnerTurn({
      accountId: ACCOUNT_A, sessionId: first.session.id,
      canonicalMessageKey: first.partnerContext.keys.partnerMessageKey,
      externalMessageId: 'message-1', direction: 'inbound', text: 'A',
    });
    const turnB = await second.repository.appendPartnerTurn({
      accountId: ACCOUNT_B, sessionId: second.session.id,
      canonicalMessageKey: second.partnerContext.keys.partnerMessageKey,
      externalMessageId: 'message-1', direction: 'inbound', text: 'B',
    });
    expect(turnA.id).not.toBe(turnB.id);
    expect(database.turns).toHaveLength(2);
  });

  it('reuses one active handoff for repeated escalation', async () => {
    const { repository, session } = await sessionFor(database, ACCOUNT_A, 'external-account-A');
    const first = await repository.createOrReusePartnerHandoff({
      accountId: ACCOUNT_A, sessionId: session.id, reasonCode: 'guest_issue', priority: 'high',
    });
    const repeated = await repository.createOrReusePartnerHandoff({
      accountId: ACCOUNT_A, sessionId: session.id, reasonCode: 'repeat',
    });
    expect(repeated.id).toBe(first.id);
    expect(database.handoffs).toHaveLength(1);
  });

  it('allows a new handoff after the previous handoff is resolved', async () => {
    const { repository, session } = await sessionFor(database, ACCOUNT_A, 'external-account-A');
    const first = await repository.createOrReusePartnerHandoff({
      accountId: ACCOUNT_A, sessionId: session.id, reasonCode: 'guest_issue',
    });
    await repository.updatePartnerHandoff({
      accountId: ACCOUNT_A, sessionId: session.id, handoffId: first.id,
      status: 'resolved', resolutionSummary: 'Handled by operator',
    });
    const next = await repository.createOrReusePartnerHandoff({
      accountId: ACCOUNT_A, sessionId: session.id, reasonCode: 'new_issue',
    });
    expect(next.id).not.toBe(first.id);
    expect(database.handoffs).toHaveLength(2);
  });

  it('deduplicates an operational action by tenant-scoped idempotency key', async () => {
    const { repository, session } = await sessionFor(database, ACCOUNT_A, 'external-account-A');
    const input = {
      accountId: ACCOUNT_A,
      sessionId: session.id,
      idempotencyKey: 'maintenance:door-lock:1',
      actionType: 'maintenance',
      reasonCode: 'access_problem',
    };
    const first = await repository.createOrReusePartnerAction(input);
    const duplicate = await repository.createOrReusePartnerAction(input);
    expect(duplicate.id).toBe(first.id);
    expect(database.actions).toHaveLength(1);
  });

  it('fails closed for cross-account session reads and mutations', async () => {
    const { repository, partnerContext, session } = await sessionFor(database, ACCOUNT_A, 'external-account-A');
    await expect(repository.getPartnerSession({ accountId: ACCOUNT_B, sessionId: session.id }))
      .resolves.toBeNull();
    await expectStateCode(repository.appendPartnerTurn({
      accountId: ACCOUNT_B,
      sessionId: session.id,
      canonicalMessageKey: partnerContext.keys.partnerMessageKey,
      externalMessageId: partnerContext.identity.messageId,
      direction: 'inbound',
      text: 'cross tenant',
    }), 'tenant_scope_mismatch');
    await expectStateCode(repository.createOrReusePartnerHandoff({
      accountId: ACCOUNT_B, sessionId: session.id, reasonCode: 'cross_tenant',
    }), 'tenant_scope_mismatch');
    await expectStateCode(repository.createOrReusePartnerAction({
      accountId: ACCOUNT_B, sessionId: session.id, idempotencyKey: 'cross',
      actionType: 'maintenance', reasonCode: 'cross_tenant',
    }), 'tenant_scope_mismatch');
  });

  it('keeps correctness in the database abstraction across repository instances', async () => {
    const { session } = await sessionFor(database, ACCOUNT_A, 'external-account-A');
    const repositoryAfterRestart = createPartnerCommunicationStateRepository(database);
    await expect(repositoryAfterRestart.getPartnerSession({
      accountId: ACCOUNT_A,
      sessionId: session.id,
    })).resolves.toMatchObject({ id: session.id, accountId: ACCOUNT_A });

    const source = readFileSync(resolve(
      process.cwd(), 'src/lib/partner-communication/state-repository.ts',
    ), 'utf8');
    for (const forbidden of [
      "from 'node:fs'", "from 'fs'", 'new Map(', '/tmp',
      'COMM_STATE_DIR', 'SESSION_STORE_DIR', 'CONVERSATION_SESSION_DIR',
    ]) expect(source).not.toContain(forbidden);
  });

  it('enforces bounded message text and metadata before persistence', async () => {
    const { repository, partnerContext, session } = await sessionFor(database, ACCOUNT_A, 'external-account-A');
    await expectStateCode(repository.appendPartnerTurn({
      accountId: ACCOUNT_A, sessionId: session.id,
      canonicalMessageKey: partnerContext.keys.partnerMessageKey,
      externalMessageId: partnerContext.identity.messageId,
      direction: 'inbound', text: 'x'.repeat(4_097),
    }), 'invalid_state_input');
    await expectStateCode(repository.appendPartnerTurn({
      accountId: ACCOUNT_A, sessionId: session.id,
      canonicalMessageKey: partnerContext.keys.partnerMessageKey,
      externalMessageId: partnerContext.identity.messageId,
      direction: 'inbound', text: 'bounded', metadata: { payload: 'x'.repeat(4_097) },
    }), 'invalid_state_input');
    await expectStateCode(repository.appendPartnerTurn({
      accountId: ACCOUNT_A, sessionId: session.id,
      canonicalMessageKey: partnerContext.keys.partnerMessageKey,
      externalMessageId: partnerContext.identity.messageId,
      direction: 'inbound', text: 'bounded', metadata: { accessToken: 'must-not-persist' },
    }), 'invalid_state_input');
    expect(database.turns).toHaveLength(0);
  });

  it('migration contract provides tenant FKs, database idempotency, active uniqueness, and closed RLS', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations', MIGRATION), 'utf8');
    for (const table of [
      'partner_account_bindings',
      'partner_communication_sessions',
      'partner_communication_turns',
      'partner_communication_handoffs',
      'partner_communication_actions',
    ]) {
      expect(sql).toContain(`CREATE TABLE public.${table}`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated`);
    }
    expect(sql).toMatch(/account_id UUID NOT NULL REFERENCES public\.accounts\(id\)/g);
    expect(sql).toContain('FOREIGN KEY (account_id, session_id)');
    expect(sql).toContain('partner_communication_turns_message_key UNIQUE');
    expect(sql).toContain('partner_communication_turns_external_message_key UNIQUE');
    expect(sql).toContain('uq_partner_communication_handoffs_one_active');
    expect(sql).toContain("WHERE status IN ('pending', 'acknowledged')");
    expect(sql).toContain('partner_communication_actions_idempotency_key UNIQUE');
    expect(sql).toContain('octet_length(metadata::text) <= 4096');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE');
    expect(sql).not.toMatch(/CREATE POLICY|TO anon|TO authenticated/i);
    expect(sql).not.toMatch(/api[_ -]?key|authorization header|access[_ -]?token|payment credential/i);
  });
});
