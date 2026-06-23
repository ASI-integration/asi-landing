import { getChannelAdapter } from './channels';
import { transitionConversationSessionState } from './conversation-session-engine';
import { createEscalationEvent } from './escalation';
import { recordCommunicationEscalation } from './escalations';
import { buildOperatorEscalationDetail } from './guest-communication-brain';
import {
  TELEGRAM_OPS_ACCEPTANCE_ESCALATE_MARKER,
  TELEGRAM_OPS_ACCEPTANCE_PREFIX,
  isTelegramOpsAcceptanceEscalationRequest,
} from './telegram-ops-acceptance-shared';
import {
  ConversationSession,
  EscalationReason,
  IdentityResolution,
  InboundMessageEnvelope,
  ProcessOutcome,
  ProcessResult,
} from './types';

const TELEGRAM_OPS_ACCEPTANCE_ESCALATION_REPLY_RU =
  'Передал запрос оператору — вернёмся с ответом.';

/**
 * Deterministic escalation for internal Telegram OPS acceptance only.
 * Reserved synthetic chat + acceptance marker — never affects public Telegram UX.
 */
export async function handleTelegramOpsAcceptanceEscalation(input: {
  envelope: InboundMessageEnvelope;
  identity: IdentityResolution;
  convSession: ConversationSession;
  chatId: number;
  update_id: number;
}): Promise<ProcessResult | null> {
  const text = String(input.envelope.messageText ?? '').trim();
  if (
    !isTelegramOpsAcceptanceEscalationRequest({
      channel: input.envelope.channel,
      chatId: input.chatId,
      messageText: text,
    })
  ) {
    return null;
  }

  const targetId = String(input.chatId);
  const escalationDetail = buildOperatorEscalationDetail({
    role: input.identity.role,
    intent: 'acceptance_escalation',
    message: text,
    reason: 'Internal Telegram OPS acceptance synthetic escalation.',
    recommendedStep: 'Проверить pending escalation review и OPS auto-sync.',
  });

  await recordCommunicationEscalation({
    sessionId: input.convSession.sessionId,
    channel: 'telegram',
    targetId,
    actorId: input.convSession.actorId,
    role: input.identity.role,
    reservationId: input.identity.reservationId,
    objectId: input.identity.propertyId,
    contactId: input.identity.leadId,
    guestId: input.identity.guestId,
    messageText: text,
    summary: `telegram_ops_acceptance:${TELEGRAM_OPS_ACCEPTANCE_ESCALATE_MARKER}`,
    reason: 'operator_required',
    source: 'telegram',
    confidence: 1,
    detail: escalationDetail,
    sourceMeta: {
      route: 'telegram_ops_acceptance_escalation',
      acceptance_marker:
        text.match(new RegExp(`${TELEGRAM_OPS_ACCEPTANCE_PREFIX}\\S+`))?.[0] ?? null,
      synthetic_inbound: true,
    },
    latestMessages: input.convSession.memory.lastMessages,
    suggestedReply: TELEGRAM_OPS_ACCEPTANCE_ESCALATION_REPLY_RU,
  });

  transitionConversationSessionState(
    input.convSession,
    'escalated',
    'telegram_ops_acceptance_escalation',
  );

  const adapter = getChannelAdapter('telegram');
  const sent = await adapter.sendMessage(targetId, TELEGRAM_OPS_ACCEPTANCE_ESCALATION_REPLY_RU, {
    reply_handler: 'telegram_ops_acceptance_escalation',
    update_id: input.update_id,
    syntheticInbound: true,
  });
  if (!sent) {
    return { outcome: ProcessOutcome.Error, update_id: input.update_id, chat_id: input.chatId };
  }

  const escalation = createEscalationEvent({
    reason: EscalationReason.RequiresOperator,
    chat_id: input.chatId,
    update_id: input.update_id,
    summary: `telegram_ops_acceptance_escalation:${text.slice(0, 80)}`,
  });

  return {
    outcome: ProcessOutcome.Replied,
    update_id: input.update_id,
    chat_id: input.chatId,
    escalation,
    reply: TELEGRAM_OPS_ACCEPTANCE_ESCALATION_REPLY_RU,
  };
}
