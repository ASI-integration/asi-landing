import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AuthenticatedPartnerPrincipal } from './auth';
import {
  PARTNER_COMMUNICATION_RESPONSE_SCHEMA_VERSION,
  type PartnerCommunicationContext,
  type PartnerCommunicationDecisionEnvelopeV1,
} from './contract';
import {
  partnerCommunicationStateRepository,
  partnerSessionIdentityFromAuthenticatedPrincipal,
} from './state-repository';

export type PartnerInboxStatus = 'received' | 'processed' | 'failed';

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
}

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

function acknowledgement(
  context: PartnerCommunicationContext,
  row: PartnerInboxRow,
  duplicate: boolean,
): PartnerCommunicationDecisionEnvelopeV1 {
  return {
    schemaVersion: PARTNER_COMMUNICATION_RESPONSE_SCHEMA_VERSION,
    accepted: true,
    duplicate,
    auditRef: row.audit_ref,
    identity: context.identity,
    decision: {
      type: 'no_action',
      text: null,
      confidence: null,
      policy: 'review_required',
      reasonCodes: ['partner_inbox_only'],
    },
    operationalActions: [],
    resultingState: {
      conversation: 'active',
      issue: 'none',
      operatorRequired: false,
    },
  };
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
    if (row.status === 'processed') return acknowledgement(context, row, true);

    const attempt = await database.startProcessing({ accountId: principal.accountId, inboxId: row.id });
    if (!attempt) {
      const concurrent = await database.findEvent(eventIdentity);
      if (concurrent?.status === 'processed' && concurrent.event_fingerprint === fingerprint) {
        return acknowledgement(context, concurrent, true);
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
      await database.markProcessed({
        accountId: principal.accountId,
        inboxId: row.id,
        processedAt: new Date().toISOString(),
      });
      return acknowledgement(context, row, duplicate);
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
);
