import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { isAuthenticatedPartnerPrincipal, type AuthenticatedPartnerPrincipal } from './auth';
import type { PartnerCommunicationContext } from './contract';

const MAX_EXTERNAL_ID_LENGTH = 200;
const MAX_CANONICAL_KEY_LENGTH = 800;
const MAX_SUMMARY_LENGTH = 2_000;
const MAX_MESSAGE_LENGTH = 4_096;
const MAX_METADATA_BYTES = 4_096;
const MAX_REASON_CODE_LENGTH = 120;
const MAX_ACTION_TYPE_LENGTH = 120;
const MAX_EXTERNAL_ACTION_REFERENCE_LENGTH = 200;
const MAX_RESOLUTION_SUMMARY_LENGTH = 1_000;
const RESOLVED_PARTNER_TENANT = Symbol('resolved-partner-tenant');
const SENSITIVE_METADATA_KEY = /(authorization|token|secret|credential|password|api[_-]?key|payment)/i;

export type PartnerSessionState = 'active' | 'awaiting_input' | 'escalated' | 'resolved';
export type PartnerTurnDirection = 'inbound' | 'outbound' | 'operator' | 'system';
export type PartnerHandoffStatus = 'pending' | 'acknowledged' | 'resolved' | 'cancelled';
export type PartnerPriority = 'low' | 'normal' | 'high' | 'urgent';
export type PartnerActionStatus =
  | 'recommended'
  | 'requested'
  | 'in_progress'
  | 'resolved'
  | 'blocked'
  | 'cancelled';
export type PartnerSafeMetadata = Record<string, string | number | boolean | null>;

export type ResolvedPartnerTenant = Readonly<{
  [RESOLVED_PARTNER_TENANT]: true;
  accountId: string;
  partnerId: string;
  externalPartnerAccountId: string;
}>;

export type PartnerSessionIdentity = Readonly<{
  accountId: string;
  partnerId: string;
  externalPartnerAccountId: string;
  canonicalConversationKey: string;
  externalPropertyId: string;
  externalBookingId: string;
  externalGuestId: string | null;
  externalConversationId: string;
}>;

export type PartnerSession = PartnerSessionIdentity & Readonly<{
  id: string;
  state: PartnerSessionState;
  summary: string | null;
  stateVersion: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PartnerTurn = Readonly<{
  id: string;
  accountId: string;
  sessionId: string;
  canonicalMessageKey: string;
  externalMessageId: string;
  direction: PartnerTurnDirection;
  text: string;
  metadata: PartnerSafeMetadata;
  createdAt: string;
}>;

export type PartnerHandoff = Readonly<{
  id: string;
  accountId: string;
  sessionId: string;
  status: PartnerHandoffStatus;
  reasonCode: string;
  priority: PartnerPriority;
  assignedOperatorId: string | null;
  resolutionSummary: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
}>;

export type PartnerAction = Readonly<{
  id: string;
  accountId: string;
  sessionId: string;
  idempotencyKey: string;
  actionType: string;
  priority: PartnerPriority;
  status: PartnerActionStatus;
  reasonCode: string;
  externalActionReference: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}>;

export type PartnerCommunicationStateErrorCode =
  | 'binding_missing'
  | 'binding_disabled'
  | 'binding_conflict'
  | 'tenant_scope_mismatch'
  | 'state_not_found'
  | 'state_conflict'
  | 'invalid_state_input'
  | 'persistence_failed';

export class PartnerCommunicationStateError extends Error {
  readonly code: PartnerCommunicationStateErrorCode;

  constructor(code: PartnerCommunicationStateErrorCode) {
    super(code);
    this.name = 'PartnerCommunicationStateError';
    this.code = code;
  }
}

type BindingRow = {
  id: string;
  account_id: string;
  partner_id: string;
  external_account_id: string;
  status: 'active' | 'disabled';
};

type SessionRow = {
  id: string;
  account_id: string;
  partner_id: string;
  external_partner_account_id: string;
  canonical_conversation_key: string;
  external_property_id: string;
  external_booking_id: string;
  external_guest_id: string | null;
  external_conversation_id: string;
  state: PartnerSessionState;
  summary: string | null;
  state_version: number;
  created_at: string;
  updated_at: string;
};

type TurnRow = {
  id: string;
  account_id: string;
  session_id: string;
  canonical_message_key: string;
  external_message_id: string;
  direction: PartnerTurnDirection;
  text: string;
  metadata: PartnerSafeMetadata;
  created_at: string;
};

type HandoffRow = {
  id: string;
  account_id: string;
  session_id: string;
  status: PartnerHandoffStatus;
  reason_code: string;
  priority: PartnerPriority;
  assigned_operator_id: string | null;
  resolution_summary: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  updated_at: string;
};

type ActionRow = {
  id: string;
  account_id: string;
  session_id: string;
  idempotency_key: string;
  action_type: string;
  priority: PartnerPriority;
  status: PartnerActionStatus;
  reason_code: string;
  external_action_reference: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

type InsertResult<Row> = { row: Row | null; conflict: boolean };

export interface PartnerCommunicationStateDatabase {
  findBindings(input: { partnerId: string; externalPartnerAccountId: string }): Promise<BindingRow[]>;
  findSession(input: PartnerSessionIdentity): Promise<SessionRow | null>;
  getSession(input: { accountId: string; sessionId: string }): Promise<SessionRow | null>;
  insertSession(row: SessionRow): Promise<InsertResult<SessionRow>>;
  findTurn(input: {
    accountId: string;
    sessionId: string;
    canonicalMessageKey: string;
    externalMessageId: string;
  }): Promise<TurnRow | null>;
  insertTurn(row: TurnRow): Promise<InsertResult<TurnRow>>;
  findActiveHandoff(input: { accountId: string; sessionId: string }): Promise<HandoffRow | null>;
  getHandoff(input: { accountId: string; sessionId: string; handoffId: string }): Promise<HandoffRow | null>;
  insertHandoff(row: HandoffRow): Promise<InsertResult<HandoffRow>>;
  updateHandoff(input: {
    accountId: string;
    sessionId: string;
    handoffId: string;
    patch: Partial<HandoffRow>;
  }): Promise<HandoffRow | null>;
  findAction(input: { accountId: string; sessionId: string; idempotencyKey: string }): Promise<ActionRow | null>;
  getAction(input: { accountId: string; sessionId: string; actionId: string }): Promise<ActionRow | null>;
  insertAction(row: ActionRow): Promise<InsertResult<ActionRow>>;
  updateAction(input: {
    accountId: string;
    sessionId: string;
    actionId: string;
    patch: Partial<ActionRow>;
  }): Promise<ActionRow | null>;
}

function fail(code: PartnerCommunicationStateErrorCode): never {
  throw new PartnerCommunicationStateError(code);
}

function bounded(value: string, maximum: number): string {
  if (typeof value !== 'string') fail('invalid_state_input');
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) fail('invalid_state_input');
  return normalized;
}

function nullableBounded(value: string | null | undefined, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  return bounded(value, maximum);
}

function safeMetadata(value: PartnerSafeMetadata | undefined): PartnerSafeMetadata {
  if (value === undefined) return {};
  if (!value || Array.isArray(value) || typeof value !== 'object') fail('invalid_state_input');
  const entries = Object.entries(value);
  if (entries.length > 20) fail('invalid_state_input');
  for (const [key, item] of entries) {
    if (!key || key.length > 80 || SENSITIVE_METADATA_KEY.test(key)) fail('invalid_state_input');
    if (typeof item === 'string' && item.length > 500) fail('invalid_state_input');
    if (item !== null && !['string', 'number', 'boolean'].includes(typeof item)) fail('invalid_state_input');
  }
  const normalized = Object.fromEntries(entries) as PartnerSafeMetadata;
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_METADATA_BYTES) fail('invalid_state_input');
  return normalized;
}

function now(): string {
  return new Date().toISOString();
}

function mapSession(row: SessionRow): PartnerSession {
  return {
    id: row.id,
    accountId: row.account_id,
    partnerId: row.partner_id,
    externalPartnerAccountId: row.external_partner_account_id,
    canonicalConversationKey: row.canonical_conversation_key,
    externalPropertyId: row.external_property_id,
    externalBookingId: row.external_booking_id,
    externalGuestId: row.external_guest_id,
    externalConversationId: row.external_conversation_id,
    state: row.state,
    summary: row.summary,
    stateVersion: row.state_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTurn(row: TurnRow): PartnerTurn {
  return {
    id: row.id,
    accountId: row.account_id,
    sessionId: row.session_id,
    canonicalMessageKey: row.canonical_message_key,
    externalMessageId: row.external_message_id,
    direction: row.direction,
    text: row.text,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function mapHandoff(row: HandoffRow): PartnerHandoff {
  return {
    id: row.id,
    accountId: row.account_id,
    sessionId: row.session_id,
    status: row.status,
    reasonCode: row.reason_code,
    priority: row.priority,
    assignedOperatorId: row.assigned_operator_id,
    resolutionSummary: row.resolution_summary,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
  };
}

function mapAction(row: ActionRow): PartnerAction {
  return {
    id: row.id,
    accountId: row.account_id,
    sessionId: row.session_id,
    idempotencyKey: row.idempotency_key,
    actionType: row.action_type,
    priority: row.priority,
    status: row.status,
    reasonCode: row.reason_code,
    externalActionReference: row.external_action_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

function assertSessionIdentity(row: SessionRow, identity: PartnerSessionIdentity): void {
  if (
    row.account_id !== identity.accountId
    || row.partner_id !== identity.partnerId
    || row.external_partner_account_id !== identity.externalPartnerAccountId
    || row.canonical_conversation_key !== identity.canonicalConversationKey
    || row.external_property_id !== identity.externalPropertyId
    || row.external_booking_id !== identity.externalBookingId
    || row.external_guest_id !== identity.externalGuestId
    || row.external_conversation_id !== identity.externalConversationId
  ) fail('state_conflict');
}

function assertTurnIdentity(
  row: TurnRow,
  identity: { canonicalMessageKey: string; externalMessageId: string },
): void {
  if (
    row.canonical_message_key !== identity.canonicalMessageKey
    || row.external_message_id !== identity.externalMessageId
  ) fail('state_conflict');
}

function isActiveHandoff(status: PartnerHandoffStatus): boolean {
  return status === 'pending' || status === 'acknowledged';
}

function canUpdateHandoff(from: PartnerHandoffStatus, to: PartnerHandoffStatus): boolean {
  if (from === to) return true;
  if (from === 'pending') return ['acknowledged', 'resolved', 'cancelled'].includes(to);
  if (from === 'acknowledged') return ['resolved', 'cancelled'].includes(to);
  return false;
}

export function partnerSessionIdentityFromContext(
  tenant: ResolvedPartnerTenant,
  context: PartnerCommunicationContext,
): PartnerSessionIdentity {
  if (
    tenant[RESOLVED_PARTNER_TENANT] !== true
    || tenant.partnerId !== context.identity.partnerId
    || tenant.externalPartnerAccountId !== context.identity.accountId
  ) fail('binding_conflict');
  return Object.freeze({
    accountId: bounded(tenant.accountId, MAX_EXTERNAL_ID_LENGTH),
    partnerId: bounded(context.identity.partnerId, MAX_EXTERNAL_ID_LENGTH),
    externalPartnerAccountId: bounded(context.identity.accountId, MAX_EXTERNAL_ID_LENGTH),
    canonicalConversationKey: bounded(context.keys.partnerConversationKey, MAX_CANONICAL_KEY_LENGTH),
    externalPropertyId: bounded(context.identity.propertyId, MAX_EXTERNAL_ID_LENGTH),
    externalBookingId: bounded(context.identity.bookingId, MAX_EXTERNAL_ID_LENGTH),
    externalGuestId: nullableBounded(context.identity.guestId, MAX_EXTERNAL_ID_LENGTH),
    externalConversationId: bounded(context.identity.conversationId, MAX_EXTERNAL_ID_LENGTH),
  });
}

export function partnerSessionIdentityFromAuthenticatedPrincipal(
  principal: AuthenticatedPartnerPrincipal,
  context: PartnerCommunicationContext,
): PartnerSessionIdentity {
  if (
    !isAuthenticatedPartnerPrincipal(principal)
    || principal.partnerId !== context.identity.partnerId
    || principal.externalPartnerAccountId !== context.identity.accountId
  ) fail('binding_conflict');
  return Object.freeze({
    accountId: bounded(principal.accountId, MAX_EXTERNAL_ID_LENGTH),
    partnerId: bounded(context.identity.partnerId, MAX_EXTERNAL_ID_LENGTH),
    externalPartnerAccountId: bounded(context.identity.accountId, MAX_EXTERNAL_ID_LENGTH),
    canonicalConversationKey: bounded(context.keys.partnerConversationKey, MAX_CANONICAL_KEY_LENGTH),
    externalPropertyId: bounded(context.identity.propertyId, MAX_EXTERNAL_ID_LENGTH),
    externalBookingId: bounded(context.identity.bookingId, MAX_EXTERNAL_ID_LENGTH),
    externalGuestId: nullableBounded(context.identity.guestId, MAX_EXTERNAL_ID_LENGTH),
    externalConversationId: bounded(context.identity.conversationId, MAX_EXTERNAL_ID_LENGTH),
  });
}

export function createPartnerCommunicationStateRepository(database: PartnerCommunicationStateDatabase) {
  return {
    async resolvePartnerAccountBinding(input: {
      partnerId: string;
      externalPartnerAccountId: string;
    }): Promise<ResolvedPartnerTenant> {
      const partnerId = bounded(input.partnerId, MAX_EXTERNAL_ID_LENGTH);
      const externalPartnerAccountId = bounded(input.externalPartnerAccountId, MAX_EXTERNAL_ID_LENGTH);
      const matches = await database.findBindings({ partnerId, externalPartnerAccountId });
      if (matches.length === 0) fail('binding_missing');
      if (matches.length !== 1) fail('binding_conflict');
      const [binding] = matches;
      if (binding.status !== 'active') fail('binding_disabled');
      return Object.freeze({
        [RESOLVED_PARTNER_TENANT]: true as const,
        accountId: binding.account_id,
        partnerId: binding.partner_id,
        externalPartnerAccountId: binding.external_account_id,
      });
    },

    async getOrCreatePartnerSession(input: {
      accountId: string;
      identity: PartnerSessionIdentity;
      state?: PartnerSessionState;
      summary?: string | null;
    }): Promise<PartnerSession> {
      const accountId = bounded(input.accountId, MAX_EXTERNAL_ID_LENGTH);
      if (accountId !== input.identity.accountId) fail('tenant_scope_mismatch');
      const existing = await database.findSession(input.identity);
      if (existing) {
        assertSessionIdentity(existing, input.identity);
        return mapSession(existing);
      }
      const timestamp = now();
      const row: SessionRow = {
        id: randomUUID(),
        account_id: accountId,
        partner_id: bounded(input.identity.partnerId, MAX_EXTERNAL_ID_LENGTH),
        external_partner_account_id: bounded(input.identity.externalPartnerAccountId, MAX_EXTERNAL_ID_LENGTH),
        canonical_conversation_key: bounded(input.identity.canonicalConversationKey, MAX_CANONICAL_KEY_LENGTH),
        external_property_id: bounded(input.identity.externalPropertyId, MAX_EXTERNAL_ID_LENGTH),
        external_booking_id: bounded(input.identity.externalBookingId, MAX_EXTERNAL_ID_LENGTH),
        external_guest_id: nullableBounded(input.identity.externalGuestId, MAX_EXTERNAL_ID_LENGTH),
        external_conversation_id: bounded(input.identity.externalConversationId, MAX_EXTERNAL_ID_LENGTH),
        state: input.state ?? 'active',
        summary: nullableBounded(input.summary, MAX_SUMMARY_LENGTH),
        state_version: 1,
        created_at: timestamp,
        updated_at: timestamp,
      };
      const inserted = await database.insertSession(row);
      if (inserted.row) return mapSession(inserted.row);
      if (!inserted.conflict) fail('persistence_failed');
      const concurrent = await database.findSession(input.identity);
      if (!concurrent) fail('persistence_failed');
      assertSessionIdentity(concurrent, input.identity);
      return mapSession(concurrent);
    },

    async getPartnerSession(input: { accountId: string; sessionId: string }): Promise<PartnerSession | null> {
      const row = await database.getSession({
        accountId: bounded(input.accountId, MAX_EXTERNAL_ID_LENGTH),
        sessionId: bounded(input.sessionId, MAX_EXTERNAL_ID_LENGTH),
      });
      return row ? mapSession(row) : null;
    },

    async appendPartnerTurn(input: {
      accountId: string;
      sessionId: string;
      canonicalMessageKey: string;
      externalMessageId: string;
      direction: PartnerTurnDirection;
      text: string;
      metadata?: PartnerSafeMetadata;
    }): Promise<PartnerTurn> {
      const accountId = bounded(input.accountId, MAX_EXTERNAL_ID_LENGTH);
      const sessionId = bounded(input.sessionId, MAX_EXTERNAL_ID_LENGTH);
      if (!await database.getSession({ accountId, sessionId })) fail('tenant_scope_mismatch');
      const identity = {
        accountId,
        sessionId,
        canonicalMessageKey: bounded(input.canonicalMessageKey, MAX_CANONICAL_KEY_LENGTH),
        externalMessageId: bounded(input.externalMessageId, MAX_EXTERNAL_ID_LENGTH),
      };
      const existing = await database.findTurn(identity);
      if (existing) {
        assertTurnIdentity(existing, identity);
        return mapTurn(existing);
      }
      const row: TurnRow = {
        id: randomUUID(),
        account_id: accountId,
        session_id: sessionId,
        canonical_message_key: identity.canonicalMessageKey,
        external_message_id: identity.externalMessageId,
        direction: input.direction,
        text: bounded(input.text, MAX_MESSAGE_LENGTH),
        metadata: safeMetadata(input.metadata),
        created_at: now(),
      };
      const inserted = await database.insertTurn(row);
      if (inserted.row) return mapTurn(inserted.row);
      if (!inserted.conflict) fail('persistence_failed');
      const concurrent = await database.findTurn(identity);
      if (!concurrent) fail('persistence_failed');
      assertTurnIdentity(concurrent, identity);
      return mapTurn(concurrent);
    },

    async createOrReusePartnerHandoff(input: {
      accountId: string;
      sessionId: string;
      reasonCode: string;
      priority?: PartnerPriority;
    }): Promise<PartnerHandoff> {
      const accountId = bounded(input.accountId, MAX_EXTERNAL_ID_LENGTH);
      const sessionId = bounded(input.sessionId, MAX_EXTERNAL_ID_LENGTH);
      if (!await database.getSession({ accountId, sessionId })) fail('tenant_scope_mismatch');
      const existing = await database.findActiveHandoff({ accountId, sessionId });
      if (existing) return mapHandoff(existing);
      const timestamp = now();
      const row: HandoffRow = {
        id: randomUUID(),
        account_id: accountId,
        session_id: sessionId,
        status: 'pending',
        reason_code: bounded(input.reasonCode, MAX_REASON_CODE_LENGTH),
        priority: input.priority ?? 'normal',
        assigned_operator_id: null,
        resolution_summary: null,
        created_at: timestamp,
        acknowledged_at: null,
        resolved_at: null,
        updated_at: timestamp,
      };
      const inserted = await database.insertHandoff(row);
      if (inserted.row) return mapHandoff(inserted.row);
      if (!inserted.conflict) fail('persistence_failed');
      const concurrent = await database.findActiveHandoff({ accountId, sessionId });
      if (!concurrent) fail('persistence_failed');
      return mapHandoff(concurrent);
    },

    async updatePartnerHandoff(input: {
      accountId: string;
      sessionId: string;
      handoffId: string;
      status: PartnerHandoffStatus;
      assignedOperatorId?: string | null;
      resolutionSummary?: string | null;
    }): Promise<PartnerHandoff> {
      const scope = {
        accountId: bounded(input.accountId, MAX_EXTERNAL_ID_LENGTH),
        sessionId: bounded(input.sessionId, MAX_EXTERNAL_ID_LENGTH),
        handoffId: bounded(input.handoffId, MAX_EXTERNAL_ID_LENGTH),
      };
      const current = await database.getHandoff(scope);
      if (!current) fail('tenant_scope_mismatch');
      if (!canUpdateHandoff(current.status, input.status)) fail('state_conflict');
      const timestamp = now();
      const patch: Partial<HandoffRow> = {
        status: input.status,
        assigned_operator_id: nullableBounded(input.assignedOperatorId, MAX_EXTERNAL_ID_LENGTH),
        resolution_summary: nullableBounded(input.resolutionSummary, MAX_RESOLUTION_SUMMARY_LENGTH),
        updated_at: timestamp,
      };
      if (input.status === 'acknowledged' && !current.acknowledged_at) patch.acknowledged_at = timestamp;
      if (!isActiveHandoff(input.status)) patch.resolved_at = timestamp;
      const updated = await database.updateHandoff({ ...scope, patch });
      if (!updated) fail('tenant_scope_mismatch');
      return mapHandoff(updated);
    },

    async createOrReusePartnerAction(input: {
      accountId: string;
      sessionId: string;
      idempotencyKey: string;
      actionType: string;
      priority?: PartnerPriority;
      status?: PartnerActionStatus;
      reasonCode: string;
      externalActionReference?: string | null;
    }): Promise<PartnerAction> {
      const accountId = bounded(input.accountId, MAX_EXTERNAL_ID_LENGTH);
      const sessionId = bounded(input.sessionId, MAX_EXTERNAL_ID_LENGTH);
      if (!await database.getSession({ accountId, sessionId })) fail('tenant_scope_mismatch');
      const idempotencyKey = bounded(input.idempotencyKey, MAX_CANONICAL_KEY_LENGTH);
      const existing = await database.findAction({ accountId, sessionId, idempotencyKey });
      if (existing) return mapAction(existing);
      const timestamp = now();
      const row: ActionRow = {
        id: randomUUID(),
        account_id: accountId,
        session_id: sessionId,
        idempotency_key: idempotencyKey,
        action_type: bounded(input.actionType, MAX_ACTION_TYPE_LENGTH),
        priority: input.priority ?? 'normal',
        status: input.status ?? 'recommended',
        reason_code: bounded(input.reasonCode, MAX_REASON_CODE_LENGTH),
        external_action_reference: nullableBounded(
          input.externalActionReference,
          MAX_EXTERNAL_ACTION_REFERENCE_LENGTH,
        ),
        created_at: timestamp,
        updated_at: timestamp,
        resolved_at: input.status === 'resolved' ? timestamp : null,
      };
      const inserted = await database.insertAction(row);
      if (inserted.row) return mapAction(inserted.row);
      if (!inserted.conflict) fail('persistence_failed');
      const concurrent = await database.findAction({ accountId, sessionId, idempotencyKey });
      if (!concurrent) fail('persistence_failed');
      return mapAction(concurrent);
    },

    async updatePartnerAction(input: {
      accountId: string;
      sessionId: string;
      actionId: string;
      status: PartnerActionStatus;
      externalActionReference?: string | null;
    }): Promise<PartnerAction> {
      const scope = {
        accountId: bounded(input.accountId, MAX_EXTERNAL_ID_LENGTH),
        sessionId: bounded(input.sessionId, MAX_EXTERNAL_ID_LENGTH),
        actionId: bounded(input.actionId, MAX_EXTERNAL_ID_LENGTH),
      };
      const current = await database.getAction(scope);
      if (!current) fail('tenant_scope_mismatch');
      const timestamp = now();
      const updated = await database.updateAction({
        ...scope,
        patch: {
          status: input.status,
          external_action_reference: nullableBounded(
            input.externalActionReference,
            MAX_EXTERNAL_ACTION_REFERENCE_LENGTH,
          ),
          resolved_at: input.status === 'resolved' ? current.resolved_at ?? timestamp : null,
          updated_at: timestamp,
        },
      });
      if (!updated) fail('tenant_scope_mismatch');
      return mapAction(updated);
    },
  };
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function persistenceError(error: { code?: string } | null): never {
  if (isUniqueViolation(error)) fail('state_conflict');
  fail('persistence_failed');
}

export function createSupabasePartnerCommunicationStateDatabase(
  client: SupabaseClient,
): PartnerCommunicationStateDatabase {
  return {
    async findBindings(input) {
      const { data, error } = await client.from('partner_account_bindings').select('*')
        .eq('partner_id', input.partnerId).eq('external_account_id', input.externalPartnerAccountId).limit(2);
      if (error) persistenceError(error);
      return (data ?? []) as BindingRow[];
    },
    async findSession(input) {
      const { data, error } = await client.from('partner_communication_sessions').select('*')
        .eq('account_id', input.accountId).eq('partner_id', input.partnerId)
        .eq('external_partner_account_id', input.externalPartnerAccountId)
        .eq('canonical_conversation_key', input.canonicalConversationKey).maybeSingle();
      if (error) persistenceError(error);
      return data as SessionRow | null;
    },
    async getSession(input) {
      const { data, error } = await client.from('partner_communication_sessions').select('*')
        .eq('account_id', input.accountId).eq('id', input.sessionId).maybeSingle();
      if (error) persistenceError(error);
      return data as SessionRow | null;
    },
    async insertSession(row) {
      const { data, error } = await client.from('partner_communication_sessions').insert(row).select('*').maybeSingle();
      if (error && !isUniqueViolation(error)) persistenceError(error);
      return { row: data as SessionRow | null, conflict: isUniqueViolation(error) };
    },
    async findTurn(input) {
      const canonical = await client.from('partner_communication_turns').select('*')
        .eq('account_id', input.accountId).eq('session_id', input.sessionId)
        .eq('canonical_message_key', input.canonicalMessageKey).maybeSingle();
      if (canonical.error) persistenceError(canonical.error);
      if (canonical.data) return canonical.data as TurnRow;
      const external = await client.from('partner_communication_turns').select('*')
        .eq('account_id', input.accountId).eq('session_id', input.sessionId)
        .eq('external_message_id', input.externalMessageId).maybeSingle();
      if (external.error) persistenceError(external.error);
      return external.data as TurnRow | null;
    },
    async insertTurn(row) {
      const { data, error } = await client.from('partner_communication_turns').insert(row).select('*').maybeSingle();
      if (error && !isUniqueViolation(error)) persistenceError(error);
      return { row: data as TurnRow | null, conflict: isUniqueViolation(error) };
    },
    async findActiveHandoff(input) {
      const { data, error } = await client.from('partner_communication_handoffs').select('*')
        .eq('account_id', input.accountId).eq('session_id', input.sessionId)
        .in('status', ['pending', 'acknowledged']).limit(1).maybeSingle();
      if (error) persistenceError(error);
      return data as HandoffRow | null;
    },
    async getHandoff(input) {
      const { data, error } = await client.from('partner_communication_handoffs').select('*')
        .eq('account_id', input.accountId).eq('session_id', input.sessionId)
        .eq('id', input.handoffId).maybeSingle();
      if (error) persistenceError(error);
      return data as HandoffRow | null;
    },
    async insertHandoff(row) {
      const { data, error } = await client.from('partner_communication_handoffs').insert(row).select('*').maybeSingle();
      if (error && !isUniqueViolation(error)) persistenceError(error);
      return { row: data as HandoffRow | null, conflict: isUniqueViolation(error) };
    },
    async updateHandoff(input) {
      const { data, error } = await client.from('partner_communication_handoffs').update(input.patch)
        .eq('account_id', input.accountId).eq('session_id', input.sessionId)
        .eq('id', input.handoffId).select('*').maybeSingle();
      if (error) persistenceError(error);
      return data as HandoffRow | null;
    },
    async findAction(input) {
      const { data, error } = await client.from('partner_communication_actions').select('*')
        .eq('account_id', input.accountId).eq('session_id', input.sessionId)
        .eq('idempotency_key', input.idempotencyKey).maybeSingle();
      if (error) persistenceError(error);
      return data as ActionRow | null;
    },
    async getAction(input) {
      const { data, error } = await client.from('partner_communication_actions').select('*')
        .eq('account_id', input.accountId).eq('session_id', input.sessionId)
        .eq('id', input.actionId).maybeSingle();
      if (error) persistenceError(error);
      return data as ActionRow | null;
    },
    async insertAction(row) {
      const { data, error } = await client.from('partner_communication_actions').insert(row).select('*').maybeSingle();
      if (error && !isUniqueViolation(error)) persistenceError(error);
      return { row: data as ActionRow | null, conflict: isUniqueViolation(error) };
    },
    async updateAction(input) {
      const { data, error } = await client.from('partner_communication_actions').update(input.patch)
        .eq('account_id', input.accountId).eq('session_id', input.sessionId)
        .eq('id', input.actionId).select('*').maybeSingle();
      if (error) persistenceError(error);
      return data as ActionRow | null;
    },
  };
}

export const partnerCommunicationStateRepository = createPartnerCommunicationStateRepository(
  createSupabasePartnerCommunicationStateDatabase(supabase),
);
