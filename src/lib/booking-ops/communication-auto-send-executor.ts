import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { EmailAdapter } from '@/lib/communication/channels/email';
import { TelegramAdapter } from '@/lib/communication/channels/telegram';
import { getBookingOpsRecord } from './repository';
import {
  SUPPORTED_ACTUAL_AUTO_SEND_MESSAGE_TYPES,
  canAutoSendCommunicationIntent,
  recordAutoSendAttempt,
  type CommunicationAutoSendDecision,
} from './communication-auto-send-policy';
import type {
  BookingOpsCommunicationActorType,
  BookingOpsCommunicationChannel,
  BookingOpsCommunicationIntent,
  BookingOpsCommunicationPurpose,
} from './types';

export const AUTO_SEND_DELIVERY_STATUSES = [
  'queued', 'sending', 'sent', 'failed', 'skipped', 'blocked', 'dry_run',
] as const;

export type AutoSendDeliveryStatus = (typeof AUTO_SEND_DELIVERY_STATUSES)[number];
export type ActualAutoSendChannel = 'telegram' | 'email' | 'web' | 'sms';

export type BookingOpsCommunicationDelivery = {
  id: string;
  communicationIntentId: string;
  bookingId: string | null;
  recipientRole: string;
  recipientRef: string | null;
  channel: ActualAutoSendChannel;
  messageType: string;
  policyDecisionId: string | null;
  status: AutoSendDeliveryStatus;
  idempotencyKey: string;
  providerMessageId: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
  failureReason: string | null;
  safeSummary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export function toSafeDeliveryView(delivery: BookingOpsCommunicationDelivery | null) {
  if (!delivery) return null;
  return {
    id: delivery.id,
    communicationIntentId: delivery.communicationIntentId,
    bookingId: delivery.bookingId,
    recipientRole: delivery.recipientRole,
    channel: delivery.channel,
    messageType: delivery.messageType,
    status: delivery.status,
    idempotencyKey: `${delivery.idempotencyKey.slice(0, 10)}…`,
    attemptCount: delivery.attemptCount,
    lastAttemptAt: delivery.lastAttemptAt,
    sentAt: delivery.sentAt,
    failureReason: delivery.failureReason,
    safeSummary: delivery.safeSummary,
    actualSendEnabled: delivery.metadata.actual_send_enabled === true,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
}

export type AutoSendSender = (input: {
  channel: ActualAutoSendChannel;
  recipientRef: string;
  messageText: string;
  metadata: Record<string, unknown>;
}) => Promise<{ ok: boolean; providerMessageId?: string; reason?: string }>;

export type ExecuteAutoSendOptions = {
  dryRun?: boolean;
  maxBatchSize?: number;
  allowedChannels?: ActualAutoSendChannel[];
  allowedMessageTypes?: string[];
  forcePolicyRecheck?: boolean;
  /** Test-only seam. Production callers never pass a sender. */
  sender?: AutoSendSender;
};

type IntentRow = {
  id: string;
  booking_ops_record_id: string;
  booking_id: string | null;
  related_task_id: string | null;
  actor_type: BookingOpsCommunicationActorType;
  actor_label: string | null;
  purpose: BookingOpsCommunicationPurpose;
  channel: BookingOpsCommunicationChannel;
  status: string;
  message_text: string;
  message_template_key: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  superseded_at: string | null;
};

type DeliveryRow = {
  id: string;
  communication_intent_id: string;
  booking_id: string | null;
  recipient_role: string;
  recipient_ref: string | null;
  channel: ActualAutoSendChannel;
  message_type: string;
  policy_decision_id: string | null;
  status: AutoSendDeliveryStatus;
  idempotency_key: string;
  provider_message_id: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  sent_at: string | null;
  failure_reason: string | null;
  safe_summary: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const SUPPORTED_TYPES = new Set<string>(SUPPORTED_ACTUAL_AUTO_SEND_MESSAGE_TYPES);
const DEFAULT_CHANNELS: ActualAutoSendChannel[] = ['telegram', 'email'];

function mapIntent(row: IntentRow): BookingOpsCommunicationIntent {
  return {
    id: row.id,
    bookingOpsRecordId: row.booking_ops_record_id,
    bookingId: row.booking_id,
    relatedTaskId: row.related_task_id,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    purpose: row.purpose,
    channel: row.channel,
    status: row.status as BookingOpsCommunicationIntent['status'],
    messageText: row.message_text,
    messageTemplateKey: row.message_template_key,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    supersededAt: row.superseded_at,
  };
}

function mapDelivery(row: DeliveryRow): BookingOpsCommunicationDelivery {
  return {
    id: row.id,
    communicationIntentId: row.communication_intent_id,
    bookingId: row.booking_id,
    recipientRole: row.recipient_role,
    recipientRef: row.recipient_ref,
    channel: row.channel,
    messageType: row.message_type,
    policyDecisionId: row.policy_decision_id,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    providerMessageId: row.provider_message_id,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    sentAt: row.sent_at,
    failureReason: row.failure_reason,
    safeSummary: row.safe_summary,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeText(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

function deliveryKey(intent: BookingOpsCommunicationIntent): string {
  return createHash('sha256')
    .update([intent.id, intent.channel, intent.purpose, intent.updatedAt, intent.messageText].join('|'))
    .digest('hex');
}

function safeMetadata(input: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: safeText(input.source),
    operator_action: safeText(input.operator_action),
    dry_run: input.dry_run === true,
    retry_requested: input.retry_requested === true,
  };
}

function channelForIntent(intent: BookingOpsCommunicationIntent): ActualAutoSendChannel | null {
  return intent.channel === 'telegram' || intent.channel === 'email'
    ? intent.channel
    : null;
}

function recipientFromMetadata(intent: BookingOpsCommunicationIntent): string | null {
  const metadata = intent.metadata;
  const candidates = intent.channel === 'telegram'
    ? [metadata.recipient_ref, metadata.telegram_chat_id, metadata.telegramTarget, metadata.chat_id]
    : [metadata.recipient_ref, metadata.recipient_email, metadata.email];
  return candidates.map(safeText).find(Boolean) ?? null;
}

function persistedOperatorBlock(intent: BookingOpsCommunicationIntent): CommunicationAutoSendDecision | null {
  const raw = intent.metadata.auto_send_decision;
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const ruleKey = String(value.rule_key ?? '');
  const code = String(value.decision ?? '');
  if (!ruleKey.startsWith('operator.') || (code !== 'blocked' && code !== 'review_required')) return null;
  return {
    decision: code,
    allowed: false,
    reason: 'Оператор запретил автоматическую отправку.',
    rule_key: ruleKey,
    safe_to_display_summary: String(value.safe_to_display_summary ?? 'Требуется решение оператора.'),
    actual_send_enabled: false,
    policy_decision_id: null,
  } as CommunicationAutoSendDecision;
}

async function resolveExecutionContext(intent: BookingOpsCommunicationIntent) {
  const record = await getBookingOpsRecord(intent.bookingOpsRecordId);
  const recipientRef = recipientFromMetadata(intent)
    ?? (intent.actorType === 'guest'
      ? (intent.channel === 'telegram' ? record?.guestTelegram : record?.guestEmail)
      : null);
  const unresolvedFallback = intent.metadata.guestIntakeStatus === 'fallback_required'
    || intent.metadata.unresolved_complaint === true
    || record?.guestIntake?.intakeStatus === 'fallback_required';
  return {
    record,
    recipientRef: safeText(recipientRef),
    policyContext: {
      bookingId: intent.bookingId ?? record?.bookingId ?? intent.bookingOpsRecordId,
      propertyId: record?.propertyId ?? safeText(intent.metadata.property_id),
      ownerId: safeText(intent.metadata.owner_id),
      guestRef: safeText(recipientRef),
      unresolvedComplaint: unresolvedFallback,
    },
  };
}

async function defaultSender(input: Parameters<AutoSendSender>[0]) {
  if (input.channel === 'telegram') {
    const ok = await new TelegramAdapter().sendMessage(input.recipientRef, input.messageText, {
      reply_handler: 'booking_ops_controlled_auto_send',
      ...input.metadata,
    });
    return { ok, reason: ok ? undefined : 'provider_rejected' };
  }
  if (input.channel === 'email') {
    const ok = await new EmailAdapter().sendMessage(input.recipientRef, input.messageText, input.metadata);
    return { ok, reason: ok ? undefined : 'provider_rejected' };
  }
  return { ok: false, reason: 'channel_not_implemented' };
}

async function readIntent(intentId: string): Promise<BookingOpsCommunicationIntent | null> {
  const { data, error } = await supabase
    .from('booking_ops_communication_intents')
    .select('*')
    .eq('id', intentId)
    .maybeSingle();
  return error || !data ? null : mapIntent(data as IntentRow);
}

async function readDelivery(deliveryId: string): Promise<BookingOpsCommunicationDelivery | null> {
  const { data, error } = await supabase
    .from('booking_ops_communication_deliveries')
    .select('*')
    .eq('id', deliveryId)
    .maybeSingle();
  return error || !data ? null : mapDelivery(data as DeliveryRow);
}

export async function getEligibleAutoSendIntents(filters: {
  bookingOpsRecordId?: string;
  channel?: BookingOpsCommunicationChannel;
  limit?: number;
} = {}) {
  let query = supabase
    .from('booking_ops_communication_intents')
    .select('*')
    .eq('metadata->>auto_send_eligible', 'true')
    .in('status', ['draft_ready', 'waiting_for_external_input'])
    .order('updated_at', { ascending: true })
    .limit(Math.min(Math.max(filters.limit ?? 20, 1), 100));
  if (filters.bookingOpsRecordId) query = query.eq('booking_ops_record_id', filters.bookingOpsRecordId);
  if (filters.channel) query = query.eq('channel', filters.channel);
  const { data, error } = await query;
  const intents = error ? [] : ((data ?? []) as IntentRow[]).map(mapIntent)
    .filter((intent) => SUPPORTED_TYPES.has(intent.purpose));
  return error ? { ok: false as const, error: error.message, intents } : { ok: true as const, intents };
}

export async function enqueueAutoSendDelivery(
  intentId: string,
  metadata: Record<string, unknown> = {},
) {
  const intent = await readIntent(intentId);
  if (!intent) return { ok: false as const, error: 'intent_not_found' };
  if (!SUPPORTED_TYPES.has(intent.purpose)) return { ok: false as const, error: 'unsupported_message_type' };
  const channel = channelForIntent(intent);
  if (!channel) return { ok: false as const, error: 'unsupported_channel' };
  const context = await resolveExecutionContext(intent);
  const decision = persistedOperatorBlock(intent)
    ?? await canAutoSendCommunicationIntent(intent, context.policyContext);
  if (!decision.allowed) return { ok: false as const, error: decision.decision, decision };

  const key = deliveryKey(intent);
  const now = new Date().toISOString();
  const values = {
    id: randomUUID(),
    communication_intent_id: intent.id,
    booking_id: intent.bookingId ?? context.record?.bookingId ?? null,
    recipient_role: intent.actorType,
    recipient_ref: context.recipientRef,
    channel,
    message_type: intent.purpose,
    policy_decision_id: decision.policy_decision_id,
    status: 'queued',
    idempotency_key: key,
    attempt_count: 0,
    safe_summary: decision.safe_to_display_summary,
    metadata: safeMetadata(metadata),
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('booking_ops_communication_deliveries')
    .insert(values)
    .select('*')
    .maybeSingle();
  if (!error && data) return { ok: true as const, delivery: mapDelivery(data as DeliveryRow), created: true };

  const { data: existing, error: existingError } = await supabase
    .from('booking_ops_communication_deliveries')
    .select('*')
    .eq('idempotency_key', key)
    .maybeSingle();
  if (existingError || !existing) return { ok: false as const, error: error?.message ?? 'enqueue_failed' };
  return { ok: true as const, delivery: mapDelivery(existing as DeliveryRow), created: false };
}

async function updateDelivery(deliveryId: string, patch: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('booking_ops_communication_deliveries')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', deliveryId)
    .select('*')
    .maybeSingle();
  return error || !data ? null : mapDelivery(data as DeliveryRow);
}

export async function recordDeliverySuccess(
  deliveryId: string,
  providerMessageId?: string,
  metadata: Record<string, unknown> = {},
) {
  return updateDelivery(deliveryId, {
    status: 'sent',
    provider_message_id: safeText(providerMessageId),
    sent_at: new Date().toISOString(),
    failure_reason: null,
    metadata: safeMetadata(metadata),
  });
}

export async function recordDeliveryFailure(
  deliveryId: string,
  reason: string,
  metadata: Record<string, unknown> = {},
) {
  return updateDelivery(deliveryId, {
    status: 'failed',
    failure_reason: safeText(reason)?.slice(0, 160) ?? 'send_failed',
    metadata: safeMetadata(metadata),
  });
}

export async function skipDelivery(
  deliveryId: string,
  reason: string,
  metadata: Record<string, unknown> = {},
) {
  return updateDelivery(deliveryId, {
    status: 'skipped',
    failure_reason: safeText(reason)?.slice(0, 160) ?? 'skipped',
    metadata: safeMetadata(metadata),
  });
}

async function blockDelivery(
  delivery: BookingOpsCommunicationDelivery,
  decision: CommunicationAutoSendDecision | null,
  reason: string,
) {
  await recordAutoSendAttempt(delivery.communicationIntentId, decision?.decision ?? 'blocked', {
    booking_id: delivery.bookingId,
    error_code: reason,
  });
  return updateDelivery(delivery.id, {
    status: 'blocked',
    failure_reason: reason,
    policy_decision_id: decision?.policy_decision_id ?? delivery.policyDecisionId,
    safe_summary: decision?.safe_to_display_summary ?? 'Отправка заблокирована правилом безопасности.',
  });
}

export async function executeAutoSendDelivery(
  deliveryId: string,
  options: ExecuteAutoSendOptions = {},
) {
  const delivery = await readDelivery(deliveryId);
  if (!delivery) return { ok: false as const, error: 'delivery_not_found' };
  if (delivery.status === 'sent') return { ok: true as const, delivery, duplicate: true };

  const intent = await readIntent(delivery.communicationIntentId);
  if (!intent) return { ok: false as const, error: 'intent_not_found' };
  const allowedTypes = new Set(options.allowedMessageTypes ?? SUPPORTED_ACTUAL_AUTO_SEND_MESSAGE_TYPES);
  const allowedChannels = new Set(options.allowedChannels ?? DEFAULT_CHANNELS);
  if (!SUPPORTED_TYPES.has(intent.purpose) || !allowedTypes.has(intent.purpose)) {
    const blocked = await blockDelivery(delivery, null, 'unsupported_message_type');
    return { ok: false as const, error: 'unsupported_message_type', delivery: blocked };
  }
  const channel = channelForIntent(intent);
  if (!channel || !allowedChannels.has(channel)) {
    const blocked = await blockDelivery(delivery, null, 'channel_not_allowed');
    return { ok: false as const, error: 'channel_not_allowed', delivery: blocked };
  }

  const executionContext = await resolveExecutionContext(intent);
  const decision = persistedOperatorBlock(intent)
    ?? await canAutoSendCommunicationIntent(intent, executionContext.policyContext);
  if (!decision.allowed) {
    const blocked = await blockDelivery(delivery, decision, decision.decision);
    return { ok: false as const, error: decision.decision, delivery: blocked, decision };
  }
  if (!decision.actual_send_enabled) {
    const blocked = await blockDelivery(delivery, decision, 'actual_send_disabled');
    return { ok: false as const, error: 'actual_send_disabled', delivery: blocked, decision };
  }
  if (!executionContext.recipientRef) {
    const blocked = await blockDelivery(delivery, decision, 'recipient_missing');
    return { ok: false as const, error: 'recipient_missing', delivery: blocked, decision };
  }

  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from('booking_ops_communication_deliveries')
    .update({
      status: 'sending',
      attempt_count: delivery.attemptCount + 1,
      last_attempt_at: now,
      failure_reason: null,
      policy_decision_id: decision.policy_decision_id,
      safe_summary: decision.safe_to_display_summary,
      updated_at: now,
    })
    .eq('id', delivery.id)
    .in('status', ['queued', 'failed', 'dry_run', 'blocked'])
    .select('*')
    .maybeSingle();
  if (claimError || !claimed) {
    const latest = await readDelivery(delivery.id);
    return latest?.status === 'sent'
      ? { ok: true as const, delivery: latest, duplicate: true }
      : { ok: false as const, error: 'delivery_already_running', delivery: latest };
  }

  if (options.dryRun === true) {
    await recordAutoSendAttempt(intent.id, 'dry_run', {
      booking_id: delivery.bookingId,
      guest_ref: intent.actorType === 'guest' ? executionContext.recipientRef : null,
      dry_run: true,
    });
    const dryRunDelivery = await updateDelivery(delivery.id, {
      status: 'dry_run',
      failure_reason: null,
      metadata: safeMetadata({ dry_run: true }),
    });
    return { ok: true as const, delivery: dryRunDelivery, dryRun: true, decision };
  }

  const sender = options.sender ?? defaultSender;
  try {
    const result = await sender({
      channel,
      recipientRef: executionContext.recipientRef,
      messageText: intent.messageText,
      metadata: { source: 'booking_ops_controlled_auto_send', intent_id: intent.id },
    });
    if (!result.ok) {
      await recordAutoSendAttempt(intent.id, 'failed', {
        booking_id: delivery.bookingId,
        guest_ref: intent.actorType === 'guest' ? executionContext.recipientRef : null,
        error_code: result.reason ?? 'provider_rejected',
      });
      const failed = await recordDeliveryFailure(delivery.id, result.reason ?? 'provider_rejected');
      return { ok: false as const, error: result.reason ?? 'provider_rejected', delivery: failed, decision };
    }
    await recordAutoSendAttempt(intent.id, 'sent', {
      booking_id: delivery.bookingId,
      guest_ref: intent.actorType === 'guest' ? executionContext.recipientRef : null,
      provider: channel,
    });
    const sent = await recordDeliverySuccess(
      delivery.id,
      'providerMessageId' in result ? result.providerMessageId : undefined,
      { source: channel },
    );
    await supabase.from('booking_ops_communication_intents').update({
      status: 'completed',
      updated_at: new Date().toISOString(),
    }).eq('id', intent.id);
    return { ok: true as const, delivery: sent, decision };
  } catch {
    await recordAutoSendAttempt(intent.id, 'failed', {
      booking_id: delivery.bookingId,
      error_code: 'provider_exception',
    });
    const failed = await recordDeliveryFailure(delivery.id, 'provider_exception');
    return { ok: false as const, error: 'provider_exception', delivery: failed, decision };
  }
}

export async function executeEligibleAutoSendBatch(options: ExecuteAutoSendOptions = {}) {
  const maxBatchSize = Math.min(Math.max(options.maxBatchSize ?? 20, 1), 50);
  const eligible = await getEligibleAutoSendIntents({ limit: maxBatchSize });
  if (!eligible.ok) return { ok: false as const, error: eligible.error, results: [] };
  const results: unknown[] = [];
  for (const intent of eligible.intents.slice(0, maxBatchSize)) {
    const enqueued = await enqueueAutoSendDelivery(intent.id, { source: 'manual_batch' });
    if (!enqueued.ok) {
      results.push(enqueued);
      continue;
    }
    results.push(await executeAutoSendDelivery(enqueued.delivery.id, options));
  }
  return { ok: true as const, processed: results.length, results };
}

export async function getDeliveryStatus(intentId: string) {
  const { data, error } = await supabase
    .from('booking_ops_communication_deliveries')
    .select('*')
    .eq('communication_intent_id', intentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return error || !data
    ? { ok: !error, delivery: null, error: error?.message }
    : { ok: true, delivery: mapDelivery(data as DeliveryRow) };
}

export async function explainDeliveryDecision(intentId: string) {
  const intent = await readIntent(intentId);
  if (!intent) return { ok: false as const, error: 'intent_not_found' };
  if (!SUPPORTED_TYPES.has(intent.purpose)) {
    return {
      ok: true as const,
      decision: {
        decision: 'unknown_message_type',
        allowed: false,
        actual_send_enabled: false,
        policy_decision_id: null,
        rule_key: 'actual_send.unsupported_message_type',
        reason: 'Тип сообщения не разрешён для фактической автоотправки.',
        safe_to_display_summary: 'Для этого типа доступна только ручная отправка.',
      } satisfies CommunicationAutoSendDecision,
    };
  }
  const context = await resolveExecutionContext(intent);
  const decision = await canAutoSendCommunicationIntent(intent, context.policyContext);
  return { ok: true as const, decision, recipientValid: Boolean(context.recipientRef) };
}
