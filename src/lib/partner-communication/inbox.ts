import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AuthenticatedPartnerPrincipal } from './auth';
import {
  PARTNER_COMMUNICATION_RESPONSE_SCHEMA_VERSION,
  type PartnerCommunicationContext,
  type PartnerCommunicationDecisionEnvelopeV1,
  type PartnerHandoffV1,
  type PartnerOperationalActionV1,
} from './contract';
import { decidePartnerCommunication, type PartnerBrainResult } from './brain';
import {
  resolvePartnerCanonicalContext,
  type PartnerCanonicalResolution,
} from './canonical-context';
import {
  partnerDecisionRepository,
  type DurablePartnerCommunicationDecision,
} from './decision-repository';
import {
  partnerCommunicationStateRepository,
  partnerSessionIdentityFromAuthenticatedPrincipal,
} from './state-repository';
import {
  getStrictPartnerPropertyKnowledge,
  type StrictPartnerPropertyKnowledgeResult,
} from './strict-property-knowledge';
import {
  partnerRecoveryRepository,
  summarizeRecovery,
  type PartnerRecoveryCase,
} from './recovery';

export type PartnerInboxStatus = 'received' | 'processing' | 'processed' | 'failed';

export type PartnerInboxRow = {
  id: string;
  account_id: string;
  partner_id: string;
  external_partner_account_id: string;
  external_event_id: string;
  canonical_event_key: string;
  event_fingerprint: string;
  schema_version: string;
  event_type: string;
  occurred_at: string;
  external_property_id: string;
  external_booking_id: string;
  external_guest_id: string | null;
  external_conversation_id: string;
  external_message_id: string;
  message_text: string;
  booking_status: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  preferred_language: string | null;
  status: PartnerInboxStatus;
  processing_attempts: number;
  last_error_code: string | null;
  audit_ref: string;
  received_at: string;
  processed_at: string | null;
  updated_at: string;
};

type InsertResult = { row: PartnerInboxRow | null; conflict: boolean };

export interface PartnerInboxDatabase {
  findEvent(input: {
    accountId: string;
    partnerId: string;
    externalPartnerAccountId: string;
    externalEventId: string;
  }): Promise<PartnerInboxRow | null>;
  insertEvent(row: PartnerInboxRow): Promise<InsertResult>;
  startProcessing(input: { accountId: string; inboxId: string }): Promise<PartnerInboxRow | null>;
  markProcessed(input: { accountId: string; inboxId: string; processedAt: string }): Promise<void>;
  markFailed(input: { accountId: string; inboxId: string; errorCode: string }): Promise<void>;
}

export interface PartnerInboxStateRepository {
  getOrCreatePartnerSession: typeof partnerCommunicationStateRepository.getOrCreatePartnerSession;
  appendPartnerTurn: typeof partnerCommunicationStateRepository.appendPartnerTurn;
  createOrReusePartnerHandoff: typeof partnerCommunicationStateRepository.createOrReusePartnerHandoff;
  createOrReusePartnerAction: typeof partnerCommunicationStateRepository.createOrReusePartnerAction;
}

export interface PartnerInboxRecoveryRepository {
  findBySource(input: { accountId: string; sourceDecisionId: string; actionRef?: string | null }): Promise<PartnerRecoveryCase | null>;
  openMaintenanceCase(input: {
    accountId: string; sessionId: string; sourceInboxId: string; sourceDecisionId: string;
    actionId: string; actionRef: string; handoffId: string | null; issueSummary: string;
    severity: 'normal' | 'high' | 'urgent'; openedAt: string;
  }): Promise<PartnerRecoveryCase>;
}

export interface PartnerInboxDecisionRepository {
  findPartnerDecision: typeof partnerDecisionRepository.findPartnerDecision;
  createOrReusePartnerDecision: typeof partnerDecisionRepository.createOrReusePartnerDecision;
}

export type PartnerInboxProcessorDependencies = {
  resolveCanonicalContext(
    principal: AuthenticatedPartnerPrincipal,
    context: PartnerCommunicationContext,
  ): Promise<PartnerCanonicalResolution>;
  loadStrictKnowledge(input: {
    accountId: string;
    propertyId: string;
  }): Promise<StrictPartnerPropertyKnowledgeResult>;
  decide: typeof decidePartnerCommunication;
};

export type PartnerInboxErrorCode = 'partner_event_conflict' | 'partner_event_processing_failed';

export class PartnerInboxError extends Error {
  readonly code: PartnerInboxErrorCode;

  constructor(code: PartnerInboxErrorCode) {
    super(code);
    this.name = 'PartnerInboxError';
    this.code = code;
  }
}

function normalizedFingerprint(context: PartnerCommunicationContext): string {
  const normalized = {
    schemaVersion: context.schemaVersion,
    eventType: context.eventType,
    occurredAt: context.occurredAt,
    identity: context.identity,
    booking: context.booking,
    guest: context.guest,
    message: context.message,
  };
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
}

function auditRef(): string {
  return `pai_${randomBytes(24).toString('base64url')}`;
}

function envelope(
  context: PartnerCommunicationContext,
  row: PartnerInboxRow,
  duplicate: boolean,
  durable: DurablePartnerCommunicationDecision,
  recovery: PartnerRecoveryCase | null = null,
): PartnerCommunicationDecisionEnvelopeV1 {
  return {
    schemaVersion: PARTNER_COMMUNICATION_RESPONSE_SCHEMA_VERSION,
    accepted: true,
    duplicate,
    auditRef: row.audit_ref,
    identity: context.identity,
    decision: { ...durable.decision, reasonCodes: [...durable.decision.reasonCodes] },
    operationalActions: durable.operationalActions.map((action) => ({ ...action })),
    handoff: durable.handoff ? { ...durable.handoff } : null,
    resultingState: { ...durable.resultingState },
    recovery: recovery ? summarizeRecovery(recovery) : null,
  };
}

function stateFor(brain: PartnerBrainResult) {
  const escalated = brain.decision.type === 'escalate' || Boolean(brain.handoffRecommendation);
  return {
    conversation: escalated ? 'escalated' as const : brain.decision.type === 'clarify' ? 'awaiting_input' as const : 'active' as const,
    issue: brain.actionRecommendation ? 'open' as const : 'none' as const,
    operatorRequired: escalated,
  };
}

async function waitForConcurrentDecision(
  decisionRepository: PartnerInboxDecisionRepository,
  input: { accountId: string; inboxId: string },
): Promise<DurablePartnerCommunicationDecision | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const decision = await decisionRepository.findPartnerDecision(input);
    if (decision) return decision;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

function newInboxRow(
  principal: AuthenticatedPartnerPrincipal,
  context: PartnerCommunicationContext,
  fingerprint: string,
): PartnerInboxRow {
  const timestamp = new Date().toISOString();
  return {
    id: randomUUID(),
    account_id: principal.accountId,
    partner_id: principal.partnerId,
    external_partner_account_id: principal.externalPartnerAccountId,
    external_event_id: context.identity.eventId,
    canonical_event_key: context.keys.partnerEventIdempotencyKey,
    event_fingerprint: fingerprint,
    schema_version: context.schemaVersion,
    event_type: context.eventType,
    occurred_at: context.occurredAt,
    external_property_id: context.identity.propertyId,
    external_booking_id: context.identity.bookingId,
    external_guest_id: context.identity.guestId,
    external_conversation_id: context.identity.conversationId,
    external_message_id: context.identity.messageId,
    message_text: context.message.text,
    booking_status: context.booking.status,
    check_in_at: context.booking.checkInAt,
    check_out_at: context.booking.checkOutAt,
    preferred_language: context.guest.preferredLanguage,
    status: 'received',
    processing_attempts: 0,
    last_error_code: null,
    audit_ref: auditRef(),
    received_at: timestamp,
    processed_at: null,
    updated_at: timestamp,
  };
}

export function createPartnerInboxProcessor(
  database: PartnerInboxDatabase,
  stateRepository: PartnerInboxStateRepository,
  decisionRepository: PartnerInboxDecisionRepository,
  dependencies: PartnerInboxProcessorDependencies,
  recoveryRepository?: PartnerInboxRecoveryRepository,
) {
  return async function process(
    principal: AuthenticatedPartnerPrincipal,
    context: PartnerCommunicationContext,
  ): Promise<PartnerCommunicationDecisionEnvelopeV1> {
    if (
      principal.partnerId !== context.identity.partnerId
      || principal.externalPartnerAccountId !== context.identity.accountId
    ) throw new PartnerInboxError('partner_event_conflict');

    const eventIdentity = {
      accountId: principal.accountId,
      partnerId: principal.partnerId,
      externalPartnerAccountId: principal.externalPartnerAccountId,
      externalEventId: context.identity.eventId,
    };
    const fingerprint = normalizedFingerprint(context);
    let row = await database.findEvent(eventIdentity);
    let duplicate = Boolean(row);
    if (!row) {
      const inserted = await database.insertEvent(newInboxRow(principal, context, fingerprint));
      row = inserted.row;
      if (!row && inserted.conflict) {
        duplicate = true;
        row = await database.findEvent(eventIdentity);
      }
    }
    if (!row) throw new PartnerInboxError('partner_event_processing_failed');
    if (row.event_fingerprint !== fingerprint) throw new PartnerInboxError('partner_event_conflict');
    const stored = await decisionRepository.findPartnerDecision({ accountId: principal.accountId, inboxId: row.id });
    if (stored) {
      if (row.status !== 'processed') {
        await database.markProcessed({
          accountId: principal.accountId,
          inboxId: row.id,
          processedAt: new Date().toISOString(),
        });
      }
      const recovery = recoveryRepository
        ? await recoveryRepository.findBySource({
          accountId: principal.accountId,
          sourceDecisionId: stored.id,
          actionRef: stored.operationalActions[0]?.actionId ?? null,
        })
        : null;
      return envelope(context, row, true, stored, recovery);
    }

    const attempt = await database.startProcessing({ accountId: principal.accountId, inboxId: row.id });
    if (!attempt) {
      const concurrent = await database.findEvent(eventIdentity);
      if (concurrent?.event_fingerprint === fingerprint) {
        const concurrentDecision = await waitForConcurrentDecision(decisionRepository, {
          accountId: principal.accountId,
          inboxId: concurrent.id,
        });
        if (concurrentDecision) {
          const recovery = recoveryRepository
            ? await recoveryRepository.findBySource({
              accountId: principal.accountId,
              sourceDecisionId: concurrentDecision.id,
              actionRef: concurrentDecision.operationalActions[0]?.actionId ?? null,
            })
            : null;
          return envelope(context, concurrent, true, concurrentDecision, recovery);
        }
      }
      throw new PartnerInboxError('partner_event_processing_failed');
    }

    try {
      const identity = partnerSessionIdentityFromAuthenticatedPrincipal(principal, context);
      const session = await stateRepository.getOrCreatePartnerSession({
        accountId: principal.accountId,
        identity,
      });
      await stateRepository.appendPartnerTurn({
        accountId: principal.accountId,
        sessionId: session.id,
        canonicalMessageKey: context.keys.partnerMessageKey,
        externalMessageId: context.identity.messageId,
        direction: 'inbound',
        text: context.message.text,
        metadata: { channel: 'partner_messaging', inboxAuditRef: row.audit_ref },
      });
      const canonical = await dependencies.resolveCanonicalContext(principal, context);
      const knowledge: StrictPartnerPropertyKnowledgeResult = canonical.status === 'resolved'
        ? await dependencies.loadStrictKnowledge({
          accountId: principal.accountId,
          propertyId: canonical.propertyId,
        })
        : Object.freeze({ status: 'not_loaded', source: 'none', knowledge: null });
      const brain = dependencies.decide({ principal, context, canonical, session, knowledge });

      let handoff: PartnerHandoffV1 | null = null;
      let handoffId: string | null = null;
      if (brain.handoffRecommendation) {
        const persisted = await stateRepository.createOrReusePartnerHandoff({
          accountId: principal.accountId,
          sessionId: session.id,
          reasonCode: brain.handoffRecommendation.reasonCode,
          priority: brain.handoffRecommendation.priority,
        });
        handoff = {
          status: 'pending',
          priority: persisted.priority,
          reasonCode: persisted.reasonCode,
        };
        handoffId = persisted.id;
      }

      const operationalActions: PartnerOperationalActionV1[] = [];
      let internalActionId: string | null = null;
      let publicActionRef: string | null = null;
      if (brain.actionRecommendation) {
        const persisted = await stateRepository.createOrReusePartnerAction({
          accountId: principal.accountId,
          sessionId: session.id,
          idempotencyKey: `${context.keys.partnerEventIdempotencyKey}|maintenance_issue`,
          actionType: brain.actionRecommendation.actionType,
          priority: brain.actionRecommendation.priority,
          status: 'recommended',
          reasonCode: brain.actionRecommendation.reasonCode,
        });
        operationalActions.push({
          actionId: persisted.publicActionRef,
          type: persisted.actionType,
          priority: persisted.priority,
          status: persisted.status === 'cancelled' ? 'blocked' : persisted.status,
          reason: persisted.reasonCode,
        });
        internalActionId = persisted.id;
        publicActionRef = persisted.publicActionRef;
      }

      const durable = await decisionRepository.createOrReusePartnerDecision({
        accountId: principal.accountId,
        inboxId: row.id,
        sessionId: session.id,
        decision: brain.decision,
        evidence: {
          knowledgeSource: knowledge.source,
          propertyBindingResolved: canonical.status === 'resolved',
          bookingBindingResolved: canonical.status === 'resolved',
          matchedIntent: brain.matchedIntent,
        },
        operationalActions,
        handoff,
        resultingState: stateFor(brain),
      });
      const recovery = recoveryRepository && brain.actionRecommendation?.actionType === 'maintenance_issue'
        && internalActionId && publicActionRef
        ? await recoveryRepository.openMaintenanceCase({
          accountId: principal.accountId,
          sessionId: session.id,
          sourceInboxId: row.id,
          sourceDecisionId: durable.id,
          actionId: internalActionId,
          actionRef: publicActionRef,
          handoffId,
          issueSummary: context.message.text,
          severity: brain.actionRecommendation?.priority ?? 'normal',
          openedAt: context.occurredAt,
        })
        : null;
      await database.markProcessed({
        accountId: principal.accountId,
        inboxId: row.id,
        processedAt: new Date().toISOString(),
      });
      return envelope(context, row, duplicate, durable, recovery);
    } catch {
      await database.markFailed({
        accountId: principal.accountId,
        inboxId: row.id,
        errorCode: 'partner_state_persistence_failed',
      }).catch(() => undefined);
      throw new PartnerInboxError('partner_event_processing_failed');
    }
  };
}

function uniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function persistenceError(): never {
  throw new PartnerInboxError('partner_event_processing_failed');
}

export function createSupabasePartnerInboxDatabase(client: SupabaseClient): PartnerInboxDatabase {
  return {
    async findEvent(input) {
      const { data, error } = await client.from('partner_communication_inbox').select('*')
        .eq('account_id', input.accountId)
        .eq('partner_id', input.partnerId)
        .eq('external_partner_account_id', input.externalPartnerAccountId)
        .eq('external_event_id', input.externalEventId)
        .maybeSingle();
      if (error) persistenceError();
      return data as PartnerInboxRow | null;
    },
    async insertEvent(row) {
      const { data, error } = await client.from('partner_communication_inbox')
        .insert(row).select('*').maybeSingle();
      if (error && !uniqueViolation(error)) persistenceError();
      return { row: data as PartnerInboxRow | null, conflict: uniqueViolation(error) };
    },
    async startProcessing(input) {
      const { data, error } = await client.rpc('start_partner_communication_inbox_processing', {
        target_account_id: input.accountId,
        target_inbox_id: input.inboxId,
      }).maybeSingle();
      if (error) persistenceError();
      return data as PartnerInboxRow | null;
    },
    async markProcessed(input) {
      const { data, error } = await client.from('partner_communication_inbox').update({
        status: 'processed', processed_at: input.processedAt, last_error_code: null,
      }).eq('account_id', input.accountId).eq('id', input.inboxId).select('id').maybeSingle();
      if (error || !data) persistenceError();
    },
    async markFailed(input) {
      const { error } = await client.from('partner_communication_inbox').update({
        status: 'failed', processed_at: null, last_error_code: input.errorCode,
      }).eq('account_id', input.accountId).eq('id', input.inboxId).neq('status', 'processed');
      if (error) persistenceError();
    },
  };
}

export const processPartnerInboxEvent = createPartnerInboxProcessor(
  createSupabasePartnerInboxDatabase(supabase),
  partnerCommunicationStateRepository,
  partnerDecisionRepository,
  {
    resolveCanonicalContext: resolvePartnerCanonicalContext,
    loadStrictKnowledge: getStrictPartnerPropertyKnowledge,
    decide: decidePartnerCommunication,
  },
  partnerRecoveryRepository,
);
