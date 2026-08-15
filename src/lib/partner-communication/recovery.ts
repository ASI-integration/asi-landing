import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AuthenticatedPartnerPrincipal } from './auth';
import {
  PARTNER_COMMUNICATION_SCHEMA_VERSION,
  partnerConversationKey,
  partnerEventIdempotencyKey,
} from './contract';
import { resolvePartnerCanonicalContext } from './canonical-context';
import { partnerCommunicationStateRepository } from './state-repository';

export type PartnerRecoveryStatus =
  | 'open'
  | 'in_progress'
  | 'awaiting_guest_confirmation'
  | 'recovered'
  | 'unrecovered'
  | 'closed';
export type PartnerRecoveryOutcome = 'satisfied' | 'not_satisfied';
export type PartnerOperationStatus = 'requested' | 'in_progress' | 'resolved' | 'blocked';

export type PartnerRecoverySummaryV1 = {
  recoveryRef: string;
  status: PartnerRecoveryStatus;
  outcome: PartnerRecoveryOutcome | null;
  operatorRequired: boolean;
};

type RecoveryIdentity = {
  partnerId: string;
  accountId: string;
  propertyId: string;
  bookingId: string;
  conversationId: string;
  eventId: string;
};

type RecoveryContextBase = {
  schemaVersion: typeof PARTNER_COMMUNICATION_SCHEMA_VERSION;
  occurredAt: string;
  identity: RecoveryIdentity;
  keys: { partnerConversationKey: string; partnerEventIdempotencyKey: string };
};

export type PartnerOperationUpdatedContext = RecoveryContextBase & {
  eventType: 'operation.updated';
  operation: { actionRef: string; status: PartnerOperationStatus; resolutionSummary: string | null };
};

export type PartnerGuestResolutionConfirmedContext = RecoveryContextBase & {
  eventType: 'guest.resolution.confirmed';
  confirmation: { recoveryRef: string; satisfied: boolean; guestFeedback: string | null };
};

export type PartnerRecoveryEventContext =
  | PartnerOperationUpdatedContext
  | PartnerGuestResolutionConfirmedContext;

export type PartnerRecoveryCase = Readonly<{
  id: string;
  accountId: string;
  sessionId: string;
  sourceInboxId: string;
  sourceDecisionId: string;
  actionId: string | null;
  handoffId: string | null;
  actionRef: string | null;
  recoveryRef: string;
  category: 'maintenance';
  severity: 'normal' | 'high' | 'urgent';
  status: PartnerRecoveryStatus;
  issueSummary: string | null;
  followupText: string | null;
  outcome: PartnerRecoveryOutcome | null;
  openedAt: string;
  workStartedAt: string | null;
  operationResolvedAt: string | null;
  followupPreparedAt: string | null;
  guestConfirmedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PartnerRecoveryEnvelopeV1 = {
  schemaVersion: 'partner.communication.response.v1';
  accepted: true;
  duplicate: boolean;
  auditRef: string;
  recovery: PartnerRecoverySummaryV1;
  decision: { followupRecommendation: string | null };
  operationalActions: Array<{
    actionId: string;
    type: string;
    status: 'recommended' | 'requested' | 'in_progress' | 'resolved' | 'blocked';
  }>;
  resultingState: {
    conversation: 'escalated' | 'resolved';
    issue: 'open' | 'blocked' | 'resolved';
    operatorRequired: boolean;
  };
};

type RecoveryRow = {
  id: string; account_id: string; session_id: string; source_inbox_id: string; source_decision_id: string;
  action_id: string | null; handoff_id: string | null; public_recovery_ref: string; category: 'maintenance';
  severity: 'normal' | 'high' | 'urgent'; status: PartnerRecoveryStatus; issue_summary: string | null;
  followup_text: string | null; outcome: PartnerRecoveryOutcome | null; opened_at: string;
  work_started_at: string | null; operation_resolved_at: string | null; followup_prepared_at: string | null;
  guest_confirmed_at: string | null; closed_at: string | null; created_at: string; updated_at: string;
};

type RecoveryEventRow = {
  id: string; account_id: string; partner_id: string; external_partner_account_id: string;
  external_event_id: string; event_type: PartnerRecoveryEventContext['eventType']; event_fingerprint: string;
  external_property_id: string; external_booking_id: string; external_conversation_id: string;
  public_action_ref: string | null; public_recovery_ref: string | null; operation_status: PartnerOperationStatus | null;
  resolution_summary: string | null; satisfied: boolean | null; guest_feedback: string | null;
  response: PartnerRecoveryEnvelopeV1 | null; created_at: string; processed_at: string | null;
};

type ActionLookup = { id: string; public_action_ref: string; action_type: string };
type SessionScope = { external_property_id: string; external_booking_id: string; external_conversation_id: string };
type InsertResult<T> = { row: T | null; conflict: boolean };

export interface PartnerRecoveryDatabase {
  findCaseBySource(input: { accountId: string; sourceDecisionId: string }): Promise<RecoveryRow | null>;
  findCaseByRef(input: { accountId: string; recoveryRef: string }): Promise<RecoveryRow | null>;
  findActionByRef(input: { accountId: string; actionRef: string }): Promise<ActionLookup | null>;
  getAction(input: { accountId: string; actionId: string }): Promise<ActionLookup | null>;
  findCaseByAction(input: { accountId: string; actionId: string }): Promise<RecoveryRow | null>;
  findSessionScope(input: { accountId: string; sessionId: string }): Promise<SessionScope | null>;
  insertCase(row: RecoveryRow): Promise<InsertResult<RecoveryRow>>;
  updateCase(input: { accountId: string; caseId: string; expectedStatus: PartnerRecoveryStatus; patch: Partial<RecoveryRow> }): Promise<RecoveryRow | null>;
  findEvent(input: { accountId: string; partnerId: string; externalPartnerAccountId: string; externalEventId: string }): Promise<RecoveryEventRow | null>;
  insertEvent(row: RecoveryEventRow): Promise<InsertResult<RecoveryEventRow>>;
  completeEvent(input: { accountId: string; eventId: string; response: PartnerRecoveryEnvelopeV1; processedAt: string }): Promise<void>;
}

type RecoveryProcessorDependencies = {
  resolveCanonical: typeof resolvePartnerCanonicalContext;
  state: Pick<typeof partnerCommunicationStateRepository,
    'updatePartnerAction' | 'updatePartnerHandoff' | 'createOrReusePartnerHandoff'>;
};

export class PartnerRecoveryError extends Error {
  constructor(readonly code: 'partner_event_conflict' | 'partner_recovery_scope_invalid' | 'partner_recovery_transition_invalid' | 'partner_recovery_processing_failed') {
    super(code);
    this.name = 'PartnerRecoveryError';
  }
}

const ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._:@/+\-]*$/u;
const REF_PATTERN = /^(?:pact|prec)_[A-Za-z0-9_-]{32,96}$/;
type JsonObject = Record<string, unknown>;

function failContract(): never { throw new Error('partner_contract_invalid'); }
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) failContract();
  return value as JsonObject;
}
function exact(value: JsonObject, fields: readonly string[]): void {
  if (Object.keys(value).some((field) => !fields.includes(field))) failContract();
}
function id(value: unknown): string {
  if (typeof value !== 'string') failContract();
  const normalized = value.trim();
  if (!normalized || normalized.length > 200 || !ID_PATTERN.test(normalized)) failContract();
  return normalized;
}
function boundedText(value: unknown, maximum = 1000): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') failContract();
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) failContract();
  return normalized;
}
function publicRef(value: unknown, prefix: 'pact_' | 'prec_'): string {
  if (typeof value !== 'string' || !value.startsWith(prefix) || !REF_PATTERN.test(value)) failContract();
  return value;
}

export function validateTrustedPartnerRecoveryEvent(input: unknown): PartnerRecoveryEventContext {
  const root = object(input);
  exact(root, ['schemaVersion', 'eventId', 'eventType', 'occurredAt', 'partner', 'property', 'booking', 'conversation', 'operation', 'confirmation']);
  if (root.schemaVersion !== PARTNER_COMMUNICATION_SCHEMA_VERSION) failContract();
  if (root.eventType !== 'operation.updated' && root.eventType !== 'guest.resolution.confirmed') failContract();
  const occurred = typeof root.occurredAt === 'string' ? Date.parse(root.occurredAt) : Number.NaN;
  if (!Number.isFinite(occurred)) failContract();
  const partner = object(root.partner); exact(partner, ['partnerId', 'accountId']);
  const property = object(root.property); exact(property, ['propertyId']);
  const booking = object(root.booking); exact(booking, ['bookingId']);
  const conversation = object(root.conversation); exact(conversation, ['conversationId']);
  const identity = {
    partnerId: id(partner.partnerId), accountId: id(partner.accountId), propertyId: id(property.propertyId),
    bookingId: id(booking.bookingId), conversationId: id(conversation.conversationId), eventId: id(root.eventId),
  };
  const base = {
    schemaVersion: PARTNER_COMMUNICATION_SCHEMA_VERSION,
    occurredAt: new Date(occurred).toISOString(),
    identity,
    keys: {
      partnerConversationKey: partnerConversationKey(identity.partnerId, identity.accountId, identity.conversationId),
      partnerEventIdempotencyKey: partnerEventIdempotencyKey(identity.partnerId, identity.accountId, identity.eventId),
    },
  };
  if (root.eventType === 'operation.updated') {
    if (root.confirmation !== undefined) failContract();
    const operation = object(root.operation); exact(operation, ['actionRef', 'status', 'resolutionSummary']);
    if (!['requested', 'in_progress', 'resolved', 'blocked'].includes(String(operation.status))) failContract();
    return Object.freeze({ ...base, eventType: 'operation.updated' as const, operation: Object.freeze({
      actionRef: publicRef(operation.actionRef, 'pact_'), status: operation.status as PartnerOperationStatus,
      resolutionSummary: boundedText(operation.resolutionSummary),
    }) });
  }
  if (root.operation !== undefined) failContract();
  const confirmation = object(root.confirmation); exact(confirmation, ['recoveryRef', 'satisfied', 'guestFeedback']);
  if (typeof confirmation.satisfied !== 'boolean') failContract();
  return Object.freeze({ ...base, eventType: 'guest.resolution.confirmed' as const, confirmation: Object.freeze({
    recoveryRef: publicRef(confirmation.recoveryRef, 'prec_'), satisfied: confirmation.satisfied,
    guestFeedback: boundedText(confirmation.guestFeedback),
  }) });
}

function mapCase(row: RecoveryRow, actionRef: string | null): PartnerRecoveryCase {
  return Object.freeze({
    id: row.id, accountId: row.account_id, sessionId: row.session_id, sourceInboxId: row.source_inbox_id,
    sourceDecisionId: row.source_decision_id, actionId: row.action_id, handoffId: row.handoff_id, actionRef,
    recoveryRef: row.public_recovery_ref, category: row.category, severity: row.severity, status: row.status,
    issueSummary: row.issue_summary, followupText: row.followup_text, outcome: row.outcome, openedAt: row.opened_at,
    workStartedAt: row.work_started_at, operationResolvedAt: row.operation_resolved_at,
    followupPreparedAt: row.followup_prepared_at, guestConfirmedAt: row.guest_confirmed_at,
    closedAt: row.closed_at, createdAt: row.created_at, updatedAt: row.updated_at,
  });
}

export function summarizeRecovery(recovery: PartnerRecoveryCase): PartnerRecoverySummaryV1 {
  return {
    recoveryRef: recovery.recoveryRef,
    status: recovery.status,
    outcome: recovery.outcome,
    operatorRequired: recovery.status !== 'recovered' && recovery.status !== 'closed',
  };
}

export function deriveRecoveryMetrics(recovery: Pick<PartnerRecoveryCase, 'openedAt' | 'operationResolvedAt' | 'guestConfirmedAt'>) {
  const elapsed = (from: string | null, to: string | null) => from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : null;
  return {
    resolutionLatencyMs: elapsed(recovery.openedAt, recovery.operationResolvedAt),
    confirmationLatencyMs: elapsed(recovery.operationResolvedAt, recovery.guestConfirmedAt),
    totalRecoveryLatencyMs: elapsed(recovery.openedAt, recovery.guestConfirmedAt),
  };
}

function followupFor(recovery: PartnerRecoveryCase): string {
  if (/отоплен|холод/i.test(recovery.issueSummary ?? '')) {
    return 'Удалось решить проблему с отоплением. Подскажите, пожалуйста, сейчас всё в порядке?';
  }
  return 'Удалось устранить проблему. Подскажите, пожалуйста, сейчас всё в порядке?';
}

function fingerprint(context: PartnerRecoveryEventContext): string {
  return createHash('sha256').update(JSON.stringify(context), 'utf8').digest('hex');
}

function auditRef(): string { return `pre_${randomBytes(24).toString('base64url')}`; }
function recoveryRef(): string { return `prec_${randomBytes(24).toString('base64url')}`; }

function envelope(recovery: PartnerRecoveryCase, duplicate: boolean, eventAuditRef: string): PartnerRecoveryEnvelopeV1 {
  const recovered = recovery.status === 'recovered' || recovery.status === 'closed';
  const blocked = recovery.status === 'unrecovered';
  return {
    schemaVersion: 'partner.communication.response.v1', accepted: true, duplicate, auditRef: eventAuditRef,
    recovery: summarizeRecovery(recovery),
    decision: { followupRecommendation: recovery.followupText },
    operationalActions: recovery.actionRef ? [{
      actionId: recovery.actionRef, type: recovery.category,
      status: recovery.status === 'in_progress' ? 'in_progress'
        : recovery.status === 'awaiting_guest_confirmation' || recovered ? 'resolved'
          : blocked ? 'blocked' : 'requested',
    }] : [],
    resultingState: {
      conversation: recovered ? 'resolved' : 'escalated',
      issue: recovered ? 'resolved' : blocked ? 'blocked' : 'open',
      operatorRequired: !recovered,
    },
  };
}

export function createPartnerRecoveryRepository(database: PartnerRecoveryDatabase) {
  return {
    async findBySource(input: { accountId: string; sourceDecisionId: string; actionRef?: string | null }) {
      const row = await database.findCaseBySource(input);
      return row ? mapCase(row, input.actionRef ?? null) : null;
    },
    async openMaintenanceCase(input: {
      accountId: string; sessionId: string; sourceInboxId: string; sourceDecisionId: string;
      actionId: string; actionRef: string; handoffId: string | null; issueSummary: string; severity: 'normal' | 'high' | 'urgent'; openedAt: string;
    }): Promise<PartnerRecoveryCase> {
      const existing = await database.findCaseBySource(input);
      if (existing) return mapCase(existing, input.actionRef);
      const now = new Date().toISOString();
      const row: RecoveryRow = {
        id: randomUUID(), account_id: input.accountId, session_id: input.sessionId, source_inbox_id: input.sourceInboxId,
        source_decision_id: input.sourceDecisionId, action_id: input.actionId, handoff_id: input.handoffId,
        public_recovery_ref: recoveryRef(), category: 'maintenance', severity: input.severity, status: 'open',
        issue_summary: input.issueSummary.slice(0, 500), followup_text: null, outcome: null, opened_at: input.openedAt,
        work_started_at: null, operation_resolved_at: null, followup_prepared_at: null,
        guest_confirmed_at: null, closed_at: null, created_at: now, updated_at: now,
      };
      const inserted = await database.insertCase(row);
      if (inserted.row) return mapCase(inserted.row, input.actionRef);
      if (!inserted.conflict) throw new PartnerRecoveryError('partner_recovery_processing_failed');
      const concurrent = await database.findCaseBySource(input);
      if (!concurrent) throw new PartnerRecoveryError('partner_recovery_processing_failed');
      return mapCase(concurrent, input.actionRef);
    },
  };
}

function eventIdentity(principal: AuthenticatedPartnerPrincipal, context: PartnerRecoveryEventContext) {
  return { accountId: principal.accountId, partnerId: principal.partnerId,
    externalPartnerAccountId: principal.externalPartnerAccountId, externalEventId: context.identity.eventId };
}

async function waitForEvent(database: PartnerRecoveryDatabase, identity: ReturnType<typeof eventIdentity>): Promise<RecoveryEventRow | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = await database.findEvent(identity);
    if (row?.response) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

export function createPartnerRecoveryProcessor(
  database: PartnerRecoveryDatabase,
  dependencies: RecoveryProcessorDependencies = {
    resolveCanonical: resolvePartnerCanonicalContext,
    state: partnerCommunicationStateRepository,
  },
) {
  return async function process(principal: AuthenticatedPartnerPrincipal, context: PartnerRecoveryEventContext): Promise<PartnerRecoveryEnvelopeV1> {
    if (principal.partnerId !== context.identity.partnerId || principal.externalPartnerAccountId !== context.identity.accountId) {
      throw new PartnerRecoveryError('partner_recovery_scope_invalid');
    }
    const identity = eventIdentity(principal, context);
    const normalizedFingerprint = fingerprint(context);
    let stored = await database.findEvent(identity);
    if (stored) {
      if (stored.event_fingerprint !== normalizedFingerprint) throw new PartnerRecoveryError('partner_event_conflict');
      if (stored.response) return { ...stored.response, duplicate: true };
      const concurrent = await waitForEvent(database, identity);
      if (!concurrent?.response) throw new PartnerRecoveryError('partner_recovery_processing_failed');
      return { ...concurrent.response, duplicate: true };
    }
    const now = new Date().toISOString();
    const eventRow: RecoveryEventRow = {
      id: randomUUID(), account_id: principal.accountId, partner_id: principal.partnerId,
      external_partner_account_id: principal.externalPartnerAccountId, external_event_id: context.identity.eventId,
      event_type: context.eventType, event_fingerprint: normalizedFingerprint,
      external_property_id: context.identity.propertyId, external_booking_id: context.identity.bookingId,
      external_conversation_id: context.identity.conversationId,
      public_action_ref: context.eventType === 'operation.updated' ? context.operation.actionRef : null,
      public_recovery_ref: context.eventType === 'guest.resolution.confirmed' ? context.confirmation.recoveryRef : null,
      operation_status: context.eventType === 'operation.updated' ? context.operation.status : null,
      resolution_summary: context.eventType === 'operation.updated' ? context.operation.resolutionSummary : null,
      satisfied: context.eventType === 'guest.resolution.confirmed' ? context.confirmation.satisfied : null,
      guest_feedback: context.eventType === 'guest.resolution.confirmed' ? context.confirmation.guestFeedback : null,
      response: null, created_at: now, processed_at: null,
    };
    const inserted = await database.insertEvent(eventRow);
    if (!inserted.row) {
      if (!inserted.conflict) throw new PartnerRecoveryError('partner_recovery_processing_failed');
      stored = await database.findEvent(identity);
      if (!stored || stored.event_fingerprint !== normalizedFingerprint) throw new PartnerRecoveryError('partner_event_conflict');
      const concurrent = await waitForEvent(database, identity);
      if (!concurrent?.response) throw new PartnerRecoveryError('partner_recovery_processing_failed');
      return { ...concurrent.response, duplicate: true };
    }

    const canonical = await dependencies.resolveCanonical(principal, context);
    if (canonical.status !== 'resolved') throw new PartnerRecoveryError('partner_recovery_scope_invalid');
    let action: ActionLookup | null = null;
    let row: RecoveryRow | null;
    if (context.eventType === 'operation.updated') {
      action = await database.findActionByRef({ accountId: principal.accountId, actionRef: context.operation.actionRef });
      row = action ? await database.findCaseByAction({ accountId: principal.accountId, actionId: action.id }) : null;
    } else {
      row = await database.findCaseByRef({ accountId: principal.accountId, recoveryRef: context.confirmation.recoveryRef });
      action = row?.action_id ? await database.getAction({ accountId: principal.accountId, actionId: row.action_id }) : null;
    }
    if (!row) throw new PartnerRecoveryError('partner_recovery_scope_invalid');
    const session = await database.findSessionScope({ accountId: principal.accountId, sessionId: row.session_id });
    if (!session || session.external_property_id !== context.identity.propertyId
      || session.external_booking_id !== context.identity.bookingId
      || session.external_conversation_id !== context.identity.conversationId) {
      throw new PartnerRecoveryError('partner_recovery_scope_invalid');
    }
    let current = mapCase(row, context.eventType === 'operation.updated' ? context.operation.actionRef : null);
    const timestamp = new Date().toISOString();
    let patch: Partial<RecoveryRow>;
    if (context.eventType === 'operation.updated') {
      if (!action || action.id !== row.action_id) throw new PartnerRecoveryError('partner_recovery_scope_invalid');
      const status = context.operation.status;
      if (status === 'requested') {
        if (current.status !== 'open') throw new PartnerRecoveryError('partner_recovery_transition_invalid');
        patch = {};
      } else if (status === 'in_progress') {
        if (!['open', 'in_progress'].includes(current.status)) throw new PartnerRecoveryError('partner_recovery_transition_invalid');
        patch = { status: 'in_progress', work_started_at: current.workStartedAt ?? timestamp };
      } else if (status === 'resolved') {
        if (!['open', 'in_progress', 'awaiting_guest_confirmation'].includes(current.status)) throw new PartnerRecoveryError('partner_recovery_transition_invalid');
        const followup = current.followupText ?? followupFor(current);
        patch = { status: 'awaiting_guest_confirmation', operation_resolved_at: current.operationResolvedAt ?? timestamp,
          followup_text: followup, followup_prepared_at: current.followupPreparedAt ?? timestamp };
      } else {
        if (!['open', 'in_progress'].includes(current.status)) throw new PartnerRecoveryError('partner_recovery_transition_invalid');
        patch = { status: 'open' };
      }
      await dependencies.state.updatePartnerAction({
        accountId: principal.accountId, sessionId: row.session_id, actionId: action.id,
        status: status === 'requested' ? 'requested' : status,
      });
    } else {
      if (!['awaiting_guest_confirmation', 'recovered', 'unrecovered'].includes(current.status)) {
        throw new PartnerRecoveryError('partner_recovery_transition_invalid');
      }
      const desired = context.confirmation.satisfied ? 'recovered' : 'unrecovered';
      if ((current.status === 'recovered' || current.status === 'unrecovered') && current.status !== desired) {
        throw new PartnerRecoveryError('partner_recovery_transition_invalid');
      }
      patch = {
        status: desired, outcome: context.confirmation.satisfied ? 'satisfied' : 'not_satisfied',
        guest_confirmed_at: current.guestConfirmedAt ?? timestamp,
        closed_at: context.confirmation.satisfied ? current.closedAt ?? timestamp : null,
      };
      if (context.confirmation.satisfied && row.handoff_id) {
        await dependencies.state.updatePartnerHandoff({
          accountId: principal.accountId, sessionId: row.session_id, handoffId: row.handoff_id,
          status: 'resolved', resolutionSummary: 'guest_confirmed_satisfied',
        });
      } else if (!context.confirmation.satisfied) {
        await dependencies.state.createOrReusePartnerHandoff({
          accountId: principal.accountId, sessionId: row.session_id, reasonCode: 'guest_not_satisfied', priority: row.severity,
        });
        if (row.action_id) {
          await dependencies.state.updatePartnerAction({
            accountId: principal.accountId, sessionId: row.session_id, actionId: row.action_id, status: 'blocked',
          });
        }
      }
    }
    if (Object.keys(patch).length > 0) {
      const updated = await database.updateCase({ accountId: principal.accountId, caseId: row.id, expectedStatus: row.status,
        patch: { ...patch, updated_at: timestamp } });
      if (!updated) throw new PartnerRecoveryError('partner_recovery_transition_invalid');
      row = updated;
    }
    const actionRef = context.eventType === 'operation.updated' ? context.operation.actionRef
      : action?.public_action_ref ?? null;
    current = mapCase(row, actionRef);
    const response = envelope(current, false, auditRef());
    await database.completeEvent({ accountId: principal.accountId, eventId: eventRow.id, response, processedAt: timestamp });
    return response;
  };
}

function unique(error: { code?: string } | null): boolean { return error?.code === '23505'; }
function persistence(): never { throw new PartnerRecoveryError('partner_recovery_processing_failed'); }

export function createSupabasePartnerRecoveryDatabase(client: SupabaseClient): PartnerRecoveryDatabase {
  return {
    async findCaseBySource(input) {
      const { data, error } = await client.from('partner_service_recovery_cases').select('*')
        .eq('account_id', input.accountId).eq('source_decision_id', input.sourceDecisionId).maybeSingle();
      if (error) persistence(); return data as RecoveryRow | null;
    },
    async findCaseByRef(input) {
      const { data, error } = await client.from('partner_service_recovery_cases').select('*')
        .eq('account_id', input.accountId).eq('public_recovery_ref', input.recoveryRef).maybeSingle();
      if (error) persistence(); return data as RecoveryRow | null;
    },
    async findActionByRef(input) {
      const query = client.from('partner_communication_actions').select('id,public_action_ref,action_type').eq('account_id', input.accountId);
      const { data, error } = input.actionRef ? await query.eq('public_action_ref', input.actionRef).maybeSingle() : { data: null, error: null };
      if (error) persistence(); return data as ActionLookup | null;
    },
    async getAction(input) {
      const { data, error } = await client.from('partner_communication_actions')
        .select('id,public_action_ref,action_type').eq('account_id', input.accountId).eq('id', input.actionId).maybeSingle();
      if (error) persistence(); return data as ActionLookup | null;
    },
    async findCaseByAction(input) {
      const { data, error } = await client.from('partner_service_recovery_cases').select('*')
        .eq('account_id', input.accountId).eq('action_id', input.actionId).maybeSingle();
      if (error) persistence(); return data as RecoveryRow | null;
    },
    async findSessionScope(input) {
      const { data, error } = await client.from('partner_communication_sessions')
        .select('external_property_id,external_booking_id,external_conversation_id')
        .eq('account_id', input.accountId).eq('id', input.sessionId).maybeSingle();
      if (error) persistence(); return data as SessionScope | null;
    },
    async insertCase(row) {
      const { data, error } = await client.from('partner_service_recovery_cases').insert(row).select('*').maybeSingle();
      if (error && !unique(error)) persistence(); return { row: data as RecoveryRow | null, conflict: unique(error) };
    },
    async updateCase(input) {
      const { data, error } = await client.from('partner_service_recovery_cases').update(input.patch)
        .eq('account_id', input.accountId).eq('id', input.caseId).eq('status', input.expectedStatus).select('*').maybeSingle();
      if (error) persistence(); return data as RecoveryRow | null;
    },
    async findEvent(input) {
      const { data, error } = await client.from('partner_service_recovery_events').select('*')
        .eq('account_id', input.accountId).eq('partner_id', input.partnerId)
        .eq('external_partner_account_id', input.externalPartnerAccountId).eq('external_event_id', input.externalEventId).maybeSingle();
      if (error) persistence(); return data as RecoveryEventRow | null;
    },
    async insertEvent(row) {
      const { data, error } = await client.from('partner_service_recovery_events').insert(row).select('*').maybeSingle();
      if (error && !unique(error)) persistence(); return { row: data as RecoveryEventRow | null, conflict: unique(error) };
    },
    async completeEvent(input) {
      const { data, error } = await client.from('partner_service_recovery_events')
        .update({ response: input.response, processed_at: input.processedAt })
        .eq('account_id', input.accountId).eq('id', input.eventId).is('processed_at', null).select('id').maybeSingle();
      if (error || !data) persistence();
    },
  };
}

export const partnerRecoveryRepository = createPartnerRecoveryRepository(createSupabasePartnerRecoveryDatabase(supabase));
export const processPartnerRecoveryEvent = createPartnerRecoveryProcessor(createSupabasePartnerRecoveryDatabase(supabase));
