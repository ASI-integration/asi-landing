import type { GroundedKnowledge } from './types';
import type { TelegramPropertyObjectV1 } from './telegram-booking-object-memory';
import {
  AUTOPILOT_MISSING_KNOWLEDGE_REPLY_RU,
  classifyKnowledgeTopic,
  requiresAutopilotOperatorEscalation,
  resolveKnowledgeAnswer,
  type KnowledgeTopic,
} from './knowledge-resolver';
import type { CommunicationAutopilotSessionMemory } from './communication-autopilot-session';

export type CommunicationAutopilotV1Action = 'auto_reply' | 'clarification' | 'operator_handoff';

export type CommunicationAutopilotV1Result = {
  action: CommunicationAutopilotV1Action;
  replyText: string;
  topic: KnowledgeTopic;
  intent: string;
  needsOperator: boolean;
  resolved: boolean;
  missingFields: string[];
  escalationReason?: string;
  knowledgeSource?: string | null;
};

const OPERATOR_HANDOFF_REPLY =
  'Поняла вопрос. Передаю оператору — вернусь с ответом здесь, как только проверят ситуацию.';

export function runCommunicationAutopilotV1(input: {
  messageText: string;
  property: TelegramPropertyObjectV1 | null;
  propertyId?: string | null;
  bookingVerified?: boolean;
  passport?: GroundedKnowledge | null;
  faq?: Record<string, string> | null;
  session?: CommunicationAutopilotSessionMemory | null;
}): CommunicationAutopilotV1Result {
  const messageText = String(input.messageText ?? '').trim();
  const escalation = requiresAutopilotOperatorEscalation(messageText);
  if (escalation) {
    return {
      action: 'operator_handoff',
      replyText: OPERATOR_HANDOFF_REPLY,
      topic: 'unknown',
      intent: escalation,
      needsOperator: true,
      resolved: false,
      missingFields: [],
      escalationReason: escalation,
    };
  }

  const topic = classifyKnowledgeTopic(messageText);
  if (topic === 'unknown') {
    return {
      action: 'operator_handoff',
      replyText: OPERATOR_HANDOFF_REPLY,
      topic,
      intent: 'unclear_situation',
      needsOperator: true,
      resolved: false,
      missingFields: [],
      escalationReason: 'unclear_situation',
    };
  }

  const resolvedKnowledge = resolveKnowledgeAnswer({
    topic,
    messageText,
    property: input.property,
    bookingVerified: Boolean(input.bookingVerified),
    passport: input.passport,
    faq: input.faq,
  });

  if (resolvedKnowledge.found && resolvedKnowledge.reply) {
    return {
      action: 'auto_reply',
      replyText: resolvedKnowledge.reply,
      topic,
      intent: topic,
      needsOperator: false,
      resolved: true,
      missingFields: [],
      knowledgeSource: resolvedKnowledge.source,
    };
  }

  return {
    action: 'clarification',
    replyText: AUTOPILOT_MISSING_KNOWLEDGE_REPLY_RU,
    topic,
    intent: topic,
    needsOperator: false,
    resolved: false,
    missingFields: resolvedKnowledge.missingFields,
    knowledgeSource: resolvedKnowledge.source,
  };
}

export function buildAutopilotSessionPatch(input: {
  result: CommunicationAutopilotV1Result;
  messageText: string;
  propertyId?: string | null;
  propertyName?: string | null;
  previous?: CommunicationAutopilotSessionMemory | null;
}): CommunicationAutopilotSessionMemory {
  return {
    property_id: input.propertyId ?? input.previous?.property_id ?? null,
    object_name: input.propertyName ?? input.previous?.object_name ?? null,
    last_topic: input.result.topic,
    last_intent: input.result.intent,
    last_guest_question: input.messageText,
    last_reply: input.result.replyText,
    turn_count: (input.previous?.turn_count ?? 0) + 1,
  };
}
