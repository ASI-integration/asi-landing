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
  type PartnerInboxRecoveryRepository,
} from '../inbox';
import {
  createPartnerCanonicalContextResolver,
  type PartnerCanonicalContextDatabase,
} from '../canonical-context';
import {
  createStrictPartnerPropertyKnowledgeLoader,
  type StrictPartnerPropertyKnowledgeDatabase,
} from '../strict-property-knowledge';
import {
  createPartnerDecisionRepository,
  type PartnerDecisionDatabase,
} from '../decision-repository';
import { decidePartnerCommunication } from '../brain';
import {
  SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1,
  SYNTHETIC_APART_SHARING_PROPERTY_V1,
  SYNTHETIC_PARTNER_CREDENTIAL,
} from '../synthetic';
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
    if (!row || !['received', 'failed'].includes(row.status)) return null;
    row.status = 'processing';
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
  handoffs: Row[] = [];
  actions: Row[] = [];
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

  async createOrReusePartnerHandoff(input: Row) {
    let row = this.handoffs.find((candidate) => candidate.accountId === input.accountId
      && candidate.sessionId === input.sessionId && ['pending', 'acknowledged'].includes(candidate.status));
    if (!row) {
      row = { id: crypto.randomUUID(), status: 'pending', ...input };
      this.handoffs.push(row);
    }
    return row as any;
  }

  async createOrReusePartnerAction(input: Row) {
    let row = this.actions.find((candidate) => candidate.accountId === input.accountId
      && candidate.sessionId === input.sessionId && candidate.idempotencyKey === input.idempotencyKey);
    if (!row) {
      row = { id: crypto.randomUUID(), publicActionRef: `pact_${'a'.repeat(32)}`, ...input };
      this.actions.push(row);
    }
    return row as any;
  }
}

class MemoryCanonicalDatabase implements PartnerCanonicalContextDatabase {
  propertyBindings: Row[] = [];
  bookingBindings: Row[] = [];
  bookings: Row[] = [];

  async findPropertyBindings(input: Row) {
    return this.propertyBindings.filter((row) => row.account_id === input.accountId
      && row.partner_account_binding_id === input.partnerAccountBindingId
      && row.external_property_id === input.externalPropertyId) as any;
  }

  async findBookingBindings(input: Row) {
    return this.bookingBindings.filter((row) => row.account_id === input.accountId
      && row.partner_account_binding_id === input.partnerAccountBindingId
      && row.external_booking_id === input.externalBookingId) as any;
  }

  async findCanonicalBooking(input: Row) {
    return this.bookings.find((row) => row.id === input.bookingId && row.account_id === input.accountId) as any ?? null;
  }
}

class MemoryKnowledgeDatabase implements StrictPartnerPropertyKnowledgeDatabase {
  properties: Row[] = [];
  knowledge: Row[] = [];

  async findActiveProperty(input: Row) {
    return this.properties.find((row) => row.id === input.propertyId
      && row.account_id === input.accountId && row.status === 'active') as any ?? null;
  }

  async findActiveKnowledge(propertyId: string) {
    return this.knowledge.find((row) => row.property_id === propertyId && row.active !== false) as any ?? null;
  }
}

class MemoryDecisionDatabase implements PartnerDecisionDatabase {
  rows: Row[] = [];

  async findDecision(input: Row) {
    return this.rows.find((row) => row.account_id === input.accountId && row.inbox_id === input.inboxId) as any ?? null;
  }

  async insertDecision(row: Row) {
    if (await this.findDecision({ accountId: row.account_id, inboxId: row.inbox_id })) {
      return { row: null, conflict: true };
    }
    this.rows.push(structuredClone(row));
    return { row: this.rows.at(-1) as any, conflict: false };
  }
}

class MemoryRecoveryRepository implements PartnerInboxRecoveryRepository {
  cases: Row[] = [];

  async findBySource(input: Row) {
    return this.cases.find((row) => row.accountId === input.accountId && row.sourceDecisionId === input.sourceDecisionId) as any ?? null;
  }

  async openMaintenanceCase(input: Row) {
    const existing = await this.findBySource(input);
    if (existing) return existing;
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(), recoveryRef: `prec_${'r'.repeat(32)}`, category: 'maintenance', status: 'open',
      outcome: null, followupText: null, workStartedAt: null, operationResolvedAt: null, followupPreparedAt: null,
      guestConfirmedAt: null, closedAt: null, createdAt: now, updatedAt: now, ...input,
    };
    this.cases.push(row);
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
  const canonical = new MemoryCanonicalDatabase();
  const knowledge = new MemoryKnowledgeDatabase();
  const decisions = new MemoryDecisionDatabase();
  const recovery = new MemoryRecoveryRepository();
  const canonicalPropertyId = SYNTHETIC_APART_SHARING_PROPERTY_V1.canonicalPropertyId;
  const canonicalBookingId = SYNTHETIC_APART_SHARING_PROPERTY_V1.canonicalBookingId;
  canonical.propertyBindings.push({
    account_id: SYNTHETIC_PARTNER_CREDENTIAL.canonicalAccountId,
    partner_account_binding_id: SYNTHETIC_PARTNER_CREDENTIAL.partnerAccountBindingId,
    external_property_id: SYNTHETIC_APART_SHARING_PROPERTY_V1.externalPropertyId,
    property_id: canonicalPropertyId,
    status: 'active',
  });
  canonical.bookingBindings.push({
    account_id: SYNTHETIC_PARTNER_CREDENTIAL.canonicalAccountId,
    partner_account_binding_id: SYNTHETIC_PARTNER_CREDENTIAL.partnerAccountBindingId,
    external_booking_id: SYNTHETIC_APART_SHARING_PROPERTY_V1.externalBookingId,
    booking_ops_record_id: canonicalBookingId,
    property_id: canonicalPropertyId,
    status: 'active',
  });
  canonical.bookings.push({
    id: canonicalBookingId,
    account_id: SYNTHETIC_PARTNER_CREDENTIAL.canonicalAccountId,
    property_id: canonicalPropertyId,
  });
  knowledge.properties.push({
    id: canonicalPropertyId,
    account_id: SYNTHETIC_PARTNER_CREDENTIAL.canonicalAccountId,
    status: 'active',
  });
  knowledge.knowledge.push({
    property_id: canonicalPropertyId,
    active: true,
    wifi_name: SYNTHETIC_APART_SHARING_PROPERTY_V1.wifiName,
    wifi_password: SYNTHETIC_APART_SHARING_PROPERTY_V1.wifiPassword,
    checkin_instructions: 'Ключ в сейфе у двери.',
    checkout_notes: 'Оставьте ключи на столе.',
    check_out_time: 'Выезд до 11:00.',
    parking_rules: 'Парковка во дворе на месте 12.',
    house_rules: 'Курить и размещать животных нельзя.',
  });
  let failNextBrain = false;
  let brainCalls = 0;
  const dependencies = {
    resolveCanonicalContext: createPartnerCanonicalContextResolver(canonical),
    loadStrictKnowledge: createStrictPartnerPropertyKnowledgeLoader(knowledge),
    decide: (...args: Parameters<typeof decidePartnerCommunication>) => {
      brainCalls += 1;
      if (failNextBrain) {
        failNextBrain = false;
        throw new Error('synthetic brain failure detail');
      }
      return decidePartnerCommunication(...args);
    },
  };
  const process = createPartnerInboxProcessor(
    inbox,
    state,
    createPartnerDecisionRepository(decisions),
    dependencies,
    recovery,
  );
  return {
    inbox, state, canonical, knowledge, decisions, recovery, process,
    failNextBrain: () => { failNextBrain = true; },
    brainCalls: () => brainCalls,
  };
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
    expect(response).toMatchObject({
      accepted: true,
      duplicate: false,
      decision: {
        type: 'reply',
        policy: 'auto_allowed',
        text: 'Сеть Wi-Fi: ASI-Demo. Пароль: demo-wifi-2026.',
      },
    });
    expect(inbox.rows).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
    expect(state.turns).toHaveLength(1);
    expect(inbox.rows[0]).toMatchObject({ status: 'processed', processing_attempts: 1 });
  });

  it('returns duplicate for exact replay without repeating state side effects', async () => {
    const authenticated = await principal();
    const { inbox, state, decisions, process, brainCalls } = processor();
    const context = validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1);
    const original = await process(authenticated, context);
    const replay = await process(authenticated, context);
    expect(replay.duplicate).toBe(true);
    expect(replay.auditRef).toBe(original.auditRef);
    expect(replay.decision).toEqual(original.decision);
    expect(inbox.rows).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
    expect(state.turns).toHaveLength(1);
    expect(decisions.rows).toHaveLength(1);
    expect(brainCalls()).toBe(1);
    expect(inbox.rows[0].processing_attempts).toBe(1);
  });

  it('rejects a materially different replay and preserves original state', async () => {
    const authenticated = await principal();
    const { inbox, state, decisions, process, brainCalls } = processor();
    await process(authenticated, validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1));
    const conflict = validateTrustedPartnerCommunicationEvent({
      ...structuredClone(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
      conversation: { ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.conversation, text: 'Другой текст' },
    });
    await expect(process(authenticated, conflict)).rejects.toEqual(new PartnerInboxError('partner_event_conflict'));
    expect(inbox.rows[0].message_text).toBe('Какой пароль от Wi-Fi?');
    expect(state.sessions).toHaveLength(1);
    expect(state.turns).toHaveLength(1);
    expect(decisions.rows).toHaveLength(1);
    expect(brainCalls()).toBe(1);
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
    const { inbox, state, decisions, process, brainCalls } = processor();
    const context = validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1);
    const responses = await Promise.all([process(authenticated, context), process(authenticated, context)]);
    expect(responses.every((response) => response.accepted)).toBe(true);
    expect(inbox.rows).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
    expect(state.turns).toHaveLength(1);
    expect(decisions.rows).toHaveLength(1);
    expect(brainCalls()).toBe(1);
  });

  it('retains a safe failed inbox event and retries exact replay successfully', async () => {
    const authenticated = await principal();
    const { inbox, state, decisions, process, failNextBrain } = processor();
    failNextBrain();
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
    expect(decisions.rows).toHaveLength(1);
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

    const { process, recovery } = processor();
    const accepted = await handlePartnerCommunicationEvent(request(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1), {
      authenticate: async () => authenticated, process,
    });
    expect(accepted.status).toBe(202);
    const body = await accepted.json();
    expect(body).toMatchObject({
      schemaVersion: 'partner.communication.response.v1',
      accepted: true,
      duplicate: false,
      decision: {
        type: 'reply',
        policy: 'auto_allowed',
        reasonCodes: ['grounded_wifi'],
        text: 'Сеть Wi-Fi: ASI-Demo. Пароль: demo-wifi-2026.',
      },
      operationalActions: [],
      handoff: null,
    });
    expect(body.accountId).toBeUndefined();
    expect(body.sessionId).toBeUndefined();
    expect(body.recovery).toBeNull();
    expect(recovery.cases).toHaveLength(0);
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

  it('fails closed when Wi-Fi knowledge is missing and never reaches the legacy prop_A mock', async () => {
    const authenticated = await principal();
    const fixture = processor();
    fixture.knowledge.knowledge.length = 0;
    const missing = await fixture.process(
      authenticated,
      validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
    );
    expect(missing.decision).toMatchObject({
      type: 'clarify', policy: 'review_required', reasonCodes: ['knowledge_missing'],
    });
    expect(JSON.stringify(missing)).not.toContain('secret123');

    const mockLikeEvent = validateTrustedPartnerCommunicationEvent({
      ...structuredClone(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
      eventId: 'mock-like-event',
      property: { propertyId: 'prop_A' },
      conversation: {
        ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.conversation,
        messageId: 'mock-like-message',
      },
    });
    const mockLike = await processor().process(authenticated, mockLikeEvent);
    expect(mockLike.decision).toMatchObject({
      type: 'escalate', policy: 'review_required', reasonCodes: ['property_mapping_missing'],
    });
    expect(JSON.stringify(mockLike)).not.toMatch(/GuestWifi|secret123|1234\*/);
  });

  it('fails closed for missing booking mapping and a mapping owned by another tenant', async () => {
    const authenticated = await principal();
    const missingBooking = processor();
    missingBooking.canonical.bookingBindings.length = 0;
    const bookingResult = await missingBooking.process(
      authenticated,
      validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
    );
    expect(bookingResult.decision.reasonCodes).toEqual(['booking_mapping_missing']);
    expect(bookingResult.decision.text).not.toContain('demo-wifi-2026');

    const crossTenant = processor();
    crossTenant.canonical.propertyBindings[0].account_id = '20000000-0000-4000-8000-000000000002';
    crossTenant.knowledge.knowledge.push({
      property_id: crossTenant.canonical.propertyBindings[0].property_id,
      active: true,
      wifi_password: 'tenant-b-secret',
    });
    const crossTenantResult = await crossTenant.process(
      authenticated,
      validateTrustedPartnerCommunicationEvent(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
    );
    expect(crossTenantResult.decision.reasonCodes).toEqual(['property_mapping_missing']);
    expect(JSON.stringify(crossTenantResult)).not.toContain('tenant-b-secret');
  });

  it.each([
    ['Как заселиться?', 'grounded_checkin', 'Ключ в сейфе у двери.'],
    ['Во сколько выезд?', 'grounded_checkout', 'Оставьте ключи на столе. Выезд до 11:00.'],
    ['Где парковаться?', 'grounded_parking', 'Парковка во дворе на месте 12.'],
    ['Можно ли курить?', 'grounded_house_rule', 'Курить и размещать животных нельзя.'],
  ])('returns only grounded routine knowledge for %s', async (text, reasonCode, expectedText) => {
    const authenticated = await principal();
    const fixture = processor();
    const event = validateTrustedPartnerCommunicationEvent({
      ...structuredClone(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
      eventId: `event-${reasonCode}`,
      conversation: {
        ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.conversation,
        messageId: `message-${reasonCode}`,
        text,
      },
    });
    const response = await fixture.process(authenticated, event);
    expect(response.decision).toMatchObject({
      type: 'reply', policy: 'auto_allowed', reasonCodes: [reasonCode], text: expectedText,
    });
  });

  it('persists one maintenance action, handoff, and decision and reuses all of them on replay', async () => {
    const authenticated = await principal();
    const fixture = processor();
    const event = validateTrustedPartnerCommunicationEvent({
      ...structuredClone(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
      eventId: 'maintenance-event',
      conversation: {
        ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.conversation,
        messageId: 'maintenance-message',
        text: 'Не работает отопление.',
      },
    });
    const first = await fixture.process(authenticated, event);
    const replay = await fixture.process(authenticated, event);
    expect(first).toMatchObject({
      duplicate: false,
      decision: { type: 'escalate', policy: 'review_required', reasonCodes: ['maintenance_issue'] },
      operationalActions: [{ type: 'maintenance_issue', priority: 'high', status: 'recommended' }],
      handoff: { status: 'pending', priority: 'high', reasonCode: 'maintenance_issue' },
    });
    expect(replay.decision).toEqual(first.decision);
    expect(fixture.state.actions).toHaveLength(1);
    expect(fixture.state.handoffs).toHaveLength(1);
    expect(fixture.decisions.rows).toHaveLength(1);
    expect(fixture.state.turns).toHaveLength(1);
    expect(fixture.recovery.cases).toHaveLength(1);
    expect(first.recovery).toMatchObject({ status: 'open', outcome: null, operatorRequired: true });
    expect(first.operationalActions[0].actionId).toMatch(/^pact_/);
    expect(first.operationalActions[0].actionId).not.toBe(fixture.state.actions[0].id);
    expect(fixture.brainCalls()).toBe(1);
  });

  it.each([
    ['Не могу попасть в квартиру.', 'urgent_access_issue'],
    ['Верните деньги.', 'financial_request_requires_review'],
    ['Измените оплату по карте.', 'sensitive_request_requires_review'],
  ])('routes risky request %s to review without promising an outcome', async (text, reasonCode) => {
    const authenticated = await principal();
    const fixture = processor();
    const event = validateTrustedPartnerCommunicationEvent({
      ...structuredClone(SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1),
      eventId: `event-${reasonCode}`,
      conversation: {
        ...SYNTHETIC_APART_SHARING_PARTNER_EVENT_V1.conversation,
        messageId: `message-${reasonCode}`,
        text,
      },
    });
    const response = await fixture.process(authenticated, event);
    expect(response.decision).toMatchObject({
      type: 'escalate', policy: 'review_required', reasonCodes: [reasonCode],
    });
    expect(response.decision.text).not.toMatch(/код\s*[:=]|возвратим|компенсируем|оплата изменена/iu);
  });

  it('has no outbound adapter or provider dependency in the partner processor', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/partner-communication/inbox.ts'), 'utf8');
    expect(source).not.toMatch(/delivery|telegram|email|webhook|provider|sendMessage|fetch\(/iu);
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

  it('brain migration enforces tenant mappings, one decision per inbox, and service-role-only RLS', () => {
    const sql = readFileSync(resolve(
      process.cwd(), 'supabase/migrations/20260815160000_partner_communication_brain_v1.sql',
    ), 'utf8');
    for (const table of [
      'partner_property_bindings', 'partner_booking_bindings', 'partner_communication_decisions',
    ]) {
      expect(sql).toContain(`CREATE TABLE public.${table}`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated`);
    }
    expect(sql).toContain('partner_communication_decisions_one_per_inbox UNIQUE');
    expect(sql).toContain('partner_booking_binding_scope_mismatch');
    expect(sql).not.toMatch(/CREATE POLICY|TO anon|TO authenticated/iu);
  });
});
