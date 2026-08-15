import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  PartnerAuthenticationError,
  createPartnerCredentialAuthenticator,
  hashPartnerBearerTokenForProvisioning,
  type AuthenticatedPartnerPrincipal,
  type PartnerCredentialDatabase,
} from '../auth';
import { validateTrustedPartnerCommunicationEvent } from '../contract';
import {
  PartnerInboxError,
  createPartnerInboxProcessor,
  type PartnerInboxDatabase,
  type PartnerInboxRow,
  type PartnerInboxStateRepository,
} from '../inbox';
import { SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1, SYNTHETIC_PARTNER_CREDENTIAL } from '../synthetic';
import { handlePartnerCommunicationEvent } from '../../../app/api/partner/v1/communication/events/route';

type Row = Record<string, any>;

class MemoryCredentialDatabase implements PartnerCredentialDatabase {
  credentials: Row[] = [];
  bindings: Row[] = [];

  async findCredential(credentialId: string) {
    return this.credentials.find((row) => row.credential_id === credentialId) as any ?? null;
  }

  async findBinding(bindingId: string) {
    return this.bindings.find((row) => row.id === bindingId) as any ?? null;
  }

  async markCredentialUsed(credentialRecordId: string, usedAt: string) {
    const row = this.credentials.find((candidate) => candidate.id === credentialRecordId);
    if (row) row.last_used_at = usedAt;
  }
}

class MemoryInboxDatabase implements PartnerInboxDatabase {
  rows: PartnerInboxRow[] = [];

  async findEvent(input: Row) {
    return this.rows.find((row) => row.account_id === input.accountId
      && row.partner_id === input.partnerId
      && row.external_partner_account_id === input.externalPartnerAccountId
      && row.external_event_id === input.externalEventId) ?? null;
  }

  async insertEvent(row: PartnerInboxRow) {
    const existing = this.rows.find((candidate) => candidate.account_id === row.account_id
      && candidate.partner_id === row.partner_id
      && candidate.external_partner_account_id === row.external_partner_account_id
      && candidate.external_event_id === row.external_event_id);
    if (existing) return { row: null, conflict: true };
    this.rows.push(structuredClone(row));
    return { row: this.rows.at(-1)!, conflict: false };
  }

  async startProcessing(input: Row) {
    const row = this.rows.find((candidate) => candidate.account_id === input.accountId
      && candidate.id === input.inboxId);
    if (!row || row.status === 'processed') return null;
    row.status = 'received';
    row.processing_attempts += 1;
    row.last_error_code = null;
    return row;
  }

  async markProcessed(input: Row) {
    const row = this.rows.find((candidate) => candidate.account_id === input.accountId
      && candidate.id === input.inboxId)!;
    row.status = 'processed';
    row.processed_at = input.processedAt;
    row.last_error_code = null;
  }

  async markFailed(input: Row) {
    const row = this.rows.find((candidate) => candidate.account_id === input.accountId
      && candidate.id === input.inboxId)!;
    if (row.status === 'processed') return;
    row.status = 'failed';
    row.processed_at = null;
    row.last_error_code = input.errorCode;
  }
}

class MemoryStateRepository implements PartnerInboxStateRepository {
  sessions: Row[] = [];
  turns: Row[] = [];
  failNextTurn = false;

  async getOrCreatePartnerSession(input: Row) {
    let row = this.sessions.find((candidate) => candidate.accountId === input.accountId
      && candidate.canonicalConversationKey === input.identity.canonicalConversationKey);
    if (!row) {
      const created = { id: crypto.randomUUID(), ...input.identity, state: 'active' };
      this.sessions.push(created);
      row = created;
    }
    return row as any;
  }

  async appendPartnerTurn(input: Row) {
    if (this.failNextTurn) {
      this.failNextTurn = false;
      throw new Error('synthetic unsafe detail must not persist');
    }
    let row = this.turns.find((candidate) => candidate.accountId === input.accountId
      && candidate.sessionId === input.sessionId
      && candidate.canonicalMessageKey === input.canonicalMessageKey);
    if (!row) {
      row = { id: crypto.randomUUID(), ...input };
      this.turns.push(row);
    }
    return row as any;
  }
}

function credentialFixture(overrides: Row = {}) {
  return {
    id: '40000000-0000-4000-8000-000000000004',
    partner_account_binding_id: SYNTHETIC_PARTNER_CREDENTIAL.partnerAccountBindingId,
    credential_id: SYNTHETIC_PARTNER_CREDENTIAL.credentialId,
    token_hash: SYNTHETIC_PARTNER_CREDENTIAL.tokenHash,
    status: 'active',
    expires_at: null,
    ...overrides,
  };
}

function bindingFixture(overrides: Row = {}) {
  return {
    id: SYNTHETIC_PARTNER_CREDENTIAL.partnerAccountBindingId,
    account_id: SYNTHETIC_PARTNER_CREDENTIAL.canonicalAccountId,
    partner_id: SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.partner.partnerId,
    external_account_id: SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.partner.accountId,
    status: 'active',
    ...overrides,
  };
}

function authHeaders(
  credentialId: string = SYNTHETIC_PARTNER_CREDENTIAL.credentialId,
  token: string = SYNTHETIC_PARTNER_CREDENTIAL.token,
) {
  return new Headers({
    authorization: `Bearer ${token}`,
    'x-asi-partner-credential': credentialId,
  });
}

function request(body: unknown, headers = authHeaders()): Request {
  return new Request('http://localhost/api/partner/v1/communication/events', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function validAuthenticator(overrides: Row = {}) {
  const database = new MemoryCredentialDatabase();
  database.credentials.push(credentialFixture(overrides.credential));
  database.bindings.push(bindingFixture(overrides.binding));
  return { database, authenticate: createPartnerCredentialAuthenticator(database) };
}

async function principal(overrides: Row = {}): Promise<AuthenticatedPartnerPrincipal> {
  const { authenticate } = validAuthenticator(overrides);
  return authenticate(authHeaders());
}

function processor() {
  const inbox = new MemoryInboxDatabase();
  const state = new MemoryStateRepository();
  return { inbox, state, process: createPartnerInboxProcessor(inbox, state) };
}

async function safeAuthFailure(promise: Promise<unknown>) {
  await expect(promise).rejects.toEqual(new PartnerAuthenticationError());
}

describe('Partner authenticated inbox v1', () => {
  it('rejects missing authentication before parsing or persisting the body', async () => {
    const process = vi.fn();
    const response = await handlePartnerCommunicationEvent(
      new Request('http://localhost/api/partner/v1/communication/events', { method: 'POST', body: '{bad-json' }),
      { authenticate: createPartnerCredentialAuthenticator(new MemoryCredentialDatabase()), process },
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'partner_authentication_failed' });
    expect(process).not.toHaveBeenCalled();
  });

  it('uses the same safe failure for wrong token and unknown credential ID', async () => {
    const { authenticate } = validAuthenticator();
    await safeAuthFailure(authenticate(authHeaders(SYNTHETIC_PARTNER_CREDENTIAL.credentialId, 'wrong-token')));
    await safeAuthFailure(authenticate(authHeaders('unknown-credential', SYNTHETIC_PARTNER_CREDENTIAL.token)));
  });

  it('uses the same safe failure for revoked and expired credentials', async () => {
    await safeAuthFailure(validAuthenticator({ credential: { status: 'revoked' } }).authenticate(authHeaders()));
    await safeAuthFailure(validAuthenticator({
      credential: { expires_at: '2020-01-01T00:00:00.000Z' },
    }).authenticate(authHeaders()));
  });

  it('resolves exactly the canonical account from the credential binding', async () => {
    const authenticated = await principal();
    expect(authenticated).toMatchObject({
      accountId: SYNTHETIC_PARTNER_CREDENTIAL.canonicalAccountId,
      partnerId: 'apart-sharing-demo',
      externalPartnerAccountId: 'partner-account-1',
    });
    expect(authenticated.accountId).not.toBe(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.partner.accountId);
  });

  it('fails closed when authenticated external identity disagrees with the body', async () => {
    const authenticated = await principal();
    const process = vi.fn();
    const response = await handlePartnerCommunicationEvent(request({
      ...structuredClone(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
      partner: { partnerId: 'apart-sharing-demo', accountId: 'partner-account-other' },
    }), { authenticate: async () => authenticated, process });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: 'partner_identity_mismatch' });
    expect(process).not.toHaveBeenCalled();
  });

  it('persists one inbox event, one session, and one inbound turn', async () => {
    const authenticated = await principal();
    const { inbox, state, process } = processor();
    const context = validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1);
    const response = await process(authenticated, context);
    expect(response).toMatchObject({ accepted: true, duplicate: false, decision: { type: 'no_action' } });
    expect(inbox.rows).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
    expect(state.turns).toHaveLength(1);
    expect(inbox.rows[0]).toMatchObject({ status: 'processed', processing_attempts: 1 });
  });

  it('returns duplicate for exact replay without repeating state side effects', async () => {
    const authenticated = await principal();
    const { inbox, state, process } = processor();
    const context = validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1);
    await process(authenticated, context);
    const replay = await process(authenticated, context);
    expect(replay.duplicate).toBe(true);
    expect(inbox.rows).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
    expect(state.turns).toHaveLength(1);
    expect(inbox.rows[0].processing_attempts).toBe(1);
  });

  it('rejects a materially different replay and preserves original state', async () => {
    const authenticated = await principal();
    const { inbox, state, process } = processor();
    await process(authenticated, validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1));
    const conflict = validateTrustedPartnerCommunicationEvent({
      ...structuredClone(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
      conversation: { ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.conversation, text: 'Другой текст' },
    });
    await expect(process(authenticated, conflict)).rejects.toEqual(new PartnerInboxError('partner_event_conflict'));
    expect(inbox.rows[0].message_text).toBe('Какой пароль от Wi-Fi?');
    expect(state.sessions).toHaveLength(1);
    expect(state.turns).toHaveLength(1);
  });

  it('isolates equal event and conversation IDs across authenticated tenants', async () => {
    const first = await principal();
    const second = await principal({
      binding: {
        account_id: '20000000-0000-4000-8000-000000000002',
        external_account_id: 'partner-account-2',
      },
    });
    const { inbox, state, process } = processor();
    const eventA = validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1);
    const eventB = validateTrustedPartnerCommunicationEvent({
      ...structuredClone(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
      partner: { partnerId: 'apart-sharing-demo', accountId: 'partner-account-2' },
    });
    await process(first, eventA);
    await process(second, eventB);
    expect(inbox.rows).toHaveLength(2);
    expect(state.sessions).toHaveLength(2);
    expect(state.turns).toHaveLength(2);
    expect(new Set(inbox.rows.map((row) => row.account_id)).size).toBe(2);
  });

  it('handles concurrent duplicate deliveries with one logical event/session/turn', async () => {
    const authenticated = await principal();
    const { inbox, state, process } = processor();
    const context = validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1);
    const responses = await Promise.all([process(authenticated, context), process(authenticated, context)]);
    expect(responses.every((response) => response.accepted)).toBe(true);
    expect(inbox.rows).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
    expect(state.turns).toHaveLength(1);
  });

  it('retains a safe failed inbox event and retries exact replay successfully', async () => {
    const authenticated = await principal();
    const { inbox, state, process } = processor();
    state.failNextTurn = true;
    const context = validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1);
    await expect(process(authenticated, context))
      .rejects.toEqual(new PartnerInboxError('partner_event_processing_failed'));
    expect(inbox.rows[0]).toMatchObject({
      status: 'failed', processing_attempts: 1, last_error_code: 'partner_state_persistence_failed',
    });
    expect(JSON.stringify(inbox.rows[0])).not.toContain('synthetic unsafe detail');
    const replay = await process(authenticated, context);
    expect(replay).toMatchObject({ accepted: true, duplicate: true });
    expect(inbox.rows[0]).toMatchObject({ status: 'processed', processing_attempts: 2, last_error_code: null });
    expect(state.sessions).toHaveLength(1);
    expect(state.turns).toHaveLength(1);
  });

  it('rejects oversized and malformed authenticated requests before persistence', async () => {
    const authenticated = await principal();
    const process = vi.fn();
    const oversized = await handlePartnerCommunicationEvent(request({ value: 'x'.repeat(17_000) }), {
      authenticate: async () => authenticated, process,
    });
    expect(oversized.status).toBe(413);
    const malformed = await handlePartnerCommunicationEvent(
      new Request('http://localhost/api/partner/v1/communication/events', {
        method: 'POST', headers: authHeaders(), body: '{bad-json',
      }),
      { authenticate: async () => authenticated, process },
    );
    expect(malformed.status).toBe(400);
    expect(process).not.toHaveBeenCalled();
  });

  it('maps event conflict and success to the safe HTTP contract', async () => {
    const authenticated = await principal();
    const conflict = await handlePartnerCommunicationEvent(request(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1), {
      authenticate: async () => authenticated,
      process: async () => { throw new PartnerInboxError('partner_event_conflict'); },
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ ok: false, error: 'partner_event_conflict' });

    const { process } = processor();
    const accepted = await handlePartnerCommunicationEvent(request(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1), {
      authenticate: async () => authenticated, process,
    });
    expect(accepted.status).toBe(202);
    const body = await accepted.json();
    expect(body).toMatchObject({
      schemaVersion: 'partner.communication.response.v1',
      accepted: true,
      duplicate: false,
      decision: { type: 'no_action', policy: 'review_required', reasonCodes: ['partner_inbox_only'] },
      operationalActions: [],
    });
    expect(body.accountId).toBeUndefined();
    expect(body.sessionId).toBeUndefined();
  });

  it('keeps credential material out of persistence and responses', async () => {
    const authenticated = await principal();
    const { inbox, state, process } = processor();
    const response = await process(
      authenticated,
      validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
    );
    const material = JSON.stringify({ response, inbox: inbox.rows, sessions: state.sessions, turns: state.turns });
    expect(material).not.toContain(SYNTHETIC_PARTNER_CREDENTIAL.token);
    expect(material).not.toContain(SYNTHETIC_PARTNER_CREDENTIAL.tokenHash);
    expect(material).not.toContain('Authorization');
    expect(hashPartnerBearerTokenForProvisioning(SYNTHETIC_PARTNER_CREDENTIAL.token)).toHaveLength(64);
  });

  it('does not let the public web intake manufacture partner authentication or context', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/booking-ops/intake/web/route.ts'), 'utf8');
    expect(source).not.toMatch(/partner-communication|AuthenticatedPartnerPrincipal|x-asi-partner-credential/i);
  });

  it('migration closes RLS and persists only bounded normalized fields', () => {
    const sql = readFileSync(resolve(
      process.cwd(), 'supabase/migrations/20260815130000_partner_authenticated_inbox_v1.sql',
    ), 'utf8');
    for (const table of ['partner_api_credentials', 'partner_communication_inbox']) {
      expect(sql).toContain(`CREATE TABLE public.${table}`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated`);
    }
    expect(sql).toContain('partner_communication_inbox_event_identity_key UNIQUE');
    expect(sql).toContain("token_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).not.toMatch(/raw_(body|payload)|authorization_value|plaintext_token/i);
    expect(sql).not.toMatch(/CREATE POLICY|TO anon|TO authenticated/i);
  });
});
