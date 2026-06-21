import type { SenderIdentity } from './communication-identity-routing';
import {
  answerGuestTestQuestion,
  classifyGuestTestQuestion,
  GUEST_MISSING_DATA_OPERATOR_REPLY,
  type GuestTestAnswerResult,
} from './guest-test-answers';
import {
  classifyGuestCommunicationIntent,
  isGuestConciergeIntent,
  isSensitiveEscalationIntent,
  type GuestCommunicationIntent,
} from './guest-intent-router';
import type { TelegramPropertyObjectV1 } from './telegram-booking-object-memory';
import { detectTelegramPromptInjection } from './telegram-prompt-injection-guard';
import type { GuestTestQuestionOutcome } from '@/lib/crm/types';
import {
  runLlmSafeDomainLayer,
  type LlmSafeDomainLayerResult,
  type LlmSafeDomainProvider,
} from './llm-safe-domain-layer';

export type CommunicationResponseMode =
  | 'answer_from_property'
  | 'answer_from_global_rule'
  | 'answer_from_concierge'
  | 'ask_clarifying_question'
  | 'ask_role_confirmation'
  | 'operator_escalation';

export type CommunicationSuggestedRoute =
  | 'guest'
  | 'owner_manager'
  | 'lead'
  | 'support_problem'
  | 'unknown';

export type CommunicationDecision = {
  detectedIntent: GuestCommunicationIntent;
  confidence: number;
  roleConflict: boolean;
  suggestedRoute: CommunicationSuggestedRoute;
  responseMode: CommunicationResponseMode;
  canAnswerAutomatically: boolean;
  shouldEscalate: boolean;
  reason: string;
  safeGuestReply?: string;
  operatorReason?: string;
  guestTestResult?: GuestTestAnswerResult;
  outcome?: GuestTestQuestionOutcome;
  missingFields?: string[];
  decisionSource: 'deterministic' | 'llm_fallback' | 'prompt_injection_guard';
  llmSafeDomain?: {
    used: boolean;
    source: 'llm_safe_domain_layer_v1' | 'llm_safe_domain_local_guard_v1';
    provider: string;
    modelName?: string;
    domainZone: 'core' | 'adjacent' | 'out_of_domain';
    detectedIntent: string;
    confidence: number;
    safeToAnswer: boolean;
    escalationRequired: boolean;
    suggestedReply: string;
    reason: string;
    validation: 'accepted' | 'local_redirect';
  };
};

export type CommunicationMemorySnapshot = {
  active_role?: SenderIdentity | null;
  pending_identity_message?: string | null;
  pending_role_conflict_message?: string | null;
  last_guest_missing_data_request?: string | null;
  awaiting_guest_booking_identifier?: boolean;
  last_intent?: GuestCommunicationIntent | null;
  last_operator_followup_id?: string | null;
};

export const MINIGPT_OPERATOR_HANDOFF_REPLY =
  'Поняла вопрос. Здесь нужна проверка оператора, чтобы не дать вам неверную информацию. Я передам обращение и вернусь с ответом здесь.';

export function buildOperatorEscalationDetail(params: {
  role: unknown;
  intent: string;
  message: string;
  reason: string;
  recommendedStep?: string | null;
}): string {
  const step = String(params.recommendedStep ?? '').trim() || 'Проверить контекст и ответить вручную.';
  return [
    '⚠️ ASI: нужна проверка оператора',
    `Роль: ${String(params.role ?? 'неизвестно')}`,
    `Интент: ${params.intent}`,
    `Сообщение: ${String(params.message ?? '').trim() || 'Нет текста сообщения'}`,
    `Причина эскалации: ${params.reason}`,
    `Рекомендуемый следующий шаг: ${step}`,
  ].join('\n');
}

function mapSuggestedRoute(
  intent: GuestCommunicationIntent,
  roleConflict: boolean,
  shouldEscalate: boolean,
  currentIdentity?: SenderIdentity | null,
): CommunicationSuggestedRoute {
  if (roleConflict && !shouldEscalate) return 'unknown';
  if (shouldEscalate) return 'guest';
  if (isGuestConciergeIntent(intent)) return 'guest';
  if (intent === 'owner_internal_request') return 'owner_manager';
  if (intent === 'lead_connection') return 'lead';
  if (currentIdentity === 'support_problem') return 'support_problem';
  return 'unknown';
}

function mapResponseModeFromGuestTest(result: GuestTestAnswerResult): CommunicationResponseMode {
  if (result.needsOperator) return 'operator_escalation';
  if (result.decisionLayer === 'property_data_answer') return 'answer_from_property';
  if (result.decisionLayer === 'global_rule_answer') return 'answer_from_global_rule';
  if (result.decisionLayer === 'concierge_autopilot_answer') return 'answer_from_concierge';
  if (result.outcome === 'missing_data') return 'operator_escalation';
  return 'operator_escalation';
}

function mapGuestTestIntentToCommunicationIntent(
  guestTestIntent: string,
  messageText: string,
  routerIntent: GuestCommunicationIntent,
): GuestCommunicationIntent {
  if (routerIntent !== 'unclear_role') return routerIntent;
  const lower = messageText.toLowerCase();
  if (guestTestIntent === 'checkin') return 'guest_checkin';
  if (guestTestIntent === 'wifi' || guestTestIntent === 'address' || guestTestIntent === 'parking') {
    return 'guest_property_question';
  }
  if (guestTestIntent === 'smoking' || guestTestIntent === 'house_rules') return 'guest_rules_question';
  if (guestTestIntent.startsWith('concierge_')) return 'guest_local_recommendation';
  if (/игнориру|забудь|обойди|системн.*промпт/i.test(lower)) return 'unclear_role';
  return routerIntent;
}

function escalationReasonForIntent(intent: GuestCommunicationIntent): string {
  switch (intent) {
    case 'money_sensitive':
      return 'Вопрос про оплату, возврат, скидку или изменение брони требует проверки оператора.';
    case 'emergency_or_damage':
      return 'Сообщение про безопасность, аварию или поломку требует срочной проверки оператора.';
    case 'complaint_or_conflict':
      return 'Жалоба или конфликт требуют проверки оператора.';
    case 'personal_data_sensitive':
      return 'Запрос персональных или документальных данных требует проверки оператора.';
    default:
      return 'Вопрос требует проверки оператора или создает обязательство владельца.';
  }
}

function buildSensitiveEscalationDecision(input: {
  messageText: string;
  currentIdentity?: SenderIdentity | null;
  intent: GuestCommunicationIntent;
  confidence: number;
  reason: string;
  roleConflict: boolean;
}): CommunicationDecision {
  const operatorReason = escalationReasonForIntent(input.intent);
  return {
    detectedIntent: input.intent,
    confidence: input.confidence,
    roleConflict: input.roleConflict,
    suggestedRoute: mapSuggestedRoute(input.intent, input.roleConflict, true, input.currentIdentity),
    responseMode: 'operator_escalation',
    canAnswerAutomatically: false,
    shouldEscalate: true,
    reason: input.reason,
    safeGuestReply: MINIGPT_OPERATOR_HANDOFF_REPLY,
    operatorReason,
    outcome: 'operator_followup_required',
    decisionSource: 'deterministic',
  };
}

export function decideGuestCommunication(input: {
  messageText: string;
  currentIdentity?: SenderIdentity | null;
  property?: TelegramPropertyObjectV1 | null;
  propertyId?: string | null;
  conversationMemory?: CommunicationMemorySnapshot;
}): CommunicationDecision {
  const messageText = String(input.messageText ?? '').trim();

  const router = classifyGuestCommunicationIntent({
    messageText,
    currentIdentity: input.currentIdentity,
  });

  if (router.shouldAskRoleConfirmation) {
    return {
      detectedIntent: router.detectedIntent,
      confidence: router.confidence,
      roleConflict: router.roleConflict,
      suggestedRoute: 'unknown',
      responseMode: 'ask_role_confirmation',
      canAnswerAutomatically: false,
      shouldEscalate: false,
      reason: router.reason,
      decisionSource: 'deterministic',
    };
  }

  if (isSensitiveEscalationIntent(router.detectedIntent)) {
    return buildSensitiveEscalationDecision({
      messageText,
      currentIdentity: input.currentIdentity,
      intent: router.detectedIntent,
      confidence: router.confidence,
      reason: router.reason,
      roleConflict: router.roleConflict,
    });
  }

  if (!isGuestConciergeIntent(router.detectedIntent)) {
    const injection = detectTelegramPromptInjection(messageText);
    if (injection.detected) {
      return {
        detectedIntent: 'unclear_role',
        confidence: 0.99,
        roleConflict: router.roleConflict,
        suggestedRoute: 'guest',
        responseMode: 'operator_escalation',
        canAnswerAutomatically: false,
        shouldEscalate: true,
        reason: 'prompt_injection_blocked',
        safeGuestReply: MINIGPT_OPERATOR_HANDOFF_REPLY,
        operatorReason: 'Попытка обойти правила безопасности или системные инструкции.',
        outcome: 'operator_followup_required',
        decisionSource: 'prompt_injection_guard',
      };
    }
    return {
      detectedIntent: router.detectedIntent,
      confidence: router.confidence,
      roleConflict: router.roleConflict,
      suggestedRoute: mapSuggestedRoute(
        router.detectedIntent,
        router.roleConflict,
        false,
        input.currentIdentity,
      ),
      responseMode: router.detectedIntent === 'unclear_role' ? 'ask_clarifying_question' : 'operator_escalation',
      canAnswerAutomatically: false,
      shouldEscalate: false,
      reason: router.reason,
      decisionSource: 'deterministic',
    };
  }

  const guestTestIntent = classifyGuestTestQuestion(messageText);
  if (guestTestIntent === 'operator') {
    const intent =
      router.detectedIntent === 'unclear_role' ? 'money_sensitive' : router.detectedIntent;
    return buildSensitiveEscalationDecision({
      messageText,
      currentIdentity: input.currentIdentity,
      intent: isSensitiveEscalationIntent(intent) ? intent : 'money_sensitive',
      confidence: Math.max(router.confidence, 0.9),
      reason: 'operator_escalation_keyword_detected',
      roleConflict: router.roleConflict,
    });
  }

  const guestTestResult = answerGuestTestQuestion({
    messageText,
    property: input.property ?? null,
    propertyId: input.propertyId,
  });

  const detectedIntent = mapGuestTestIntentToCommunicationIntent(
    guestTestResult.intent,
    messageText,
    router.detectedIntent,
  );

  if (guestTestResult.needsOperator || guestTestResult.intent === 'unknown') {
    const injection = detectTelegramPromptInjection(messageText);
    if (injection.detected) {
      return {
        detectedIntent: 'unclear_role',
        confidence: 0.99,
        roleConflict: router.roleConflict,
        suggestedRoute: 'guest',
        responseMode: 'operator_escalation',
        canAnswerAutomatically: false,
        shouldEscalate: true,
        reason: 'prompt_injection_blocked',
        safeGuestReply: MINIGPT_OPERATOR_HANDOFF_REPLY,
        operatorReason: 'Попытка обойти правила безопасности или системные инструкции.',
        guestTestResult,
        outcome: 'operator_followup_required',
        decisionSource: 'prompt_injection_guard',
      };
    }
    return {
      detectedIntent,
      confidence: router.confidence,
      roleConflict: router.roleConflict,
      suggestedRoute: 'guest',
      responseMode: 'operator_escalation',
      canAnswerAutomatically: false,
      shouldEscalate: true,
      reason: guestTestResult.intent === 'unknown' ? 'guest_intent_unknown' : router.reason,
      safeGuestReply: MINIGPT_OPERATOR_HANDOFF_REPLY,
      operatorReason: escalationReasonForIntent(detectedIntent),
      guestTestResult,
      outcome: 'operator_followup_required',
      decisionSource: 'deterministic',
    };
  }

  const responseMode = mapResponseModeFromGuestTest(guestTestResult);
  const guestFacingReply =
    guestTestResult.outcome === 'missing_data'
      ? GUEST_MISSING_DATA_OPERATOR_REPLY
      : guestTestResult.reply;

  return {
    detectedIntent,
    confidence: router.confidence,
    roleConflict: router.roleConflict,
    suggestedRoute: 'guest',
    responseMode,
    canAnswerAutomatically: true,
    shouldEscalate: guestTestResult.outcome === 'missing_data',
    reason: router.reason,
    safeGuestReply: guestFacingReply,
    guestTestResult,
    outcome: guestTestResult.outcome,
    missingFields: guestTestResult.missingFields,
    decisionSource: 'deterministic',
  };
}

export async function decideGuestCommunicationWithLlmSafeDomainLayer(input: {
  messageText: string;
  currentIdentity?: SenderIdentity | null;
  property?: TelegramPropertyObjectV1 | null;
  propertyId?: string | null;
  conversationMemory?: CommunicationMemorySnapshot;
  llmSafeDomainProvider?: LlmSafeDomainProvider;
  telegramChatId?: number | string | null;
}): Promise<CommunicationDecision> {
  const base = decideGuestCommunication(input);
  if (
    base.shouldEscalate ||
    base.outcome === 'missing_data' ||
    base.outcome === 'operator_followup_required'
  ) {
    return base;
  }

  const guard = await runLlmSafeDomainLayer({
    messageText: input.messageText,
    detectedIntent: base.detectedIntent,
    responseMode: base.responseMode,
    propertyId: input.propertyId,
    propertyAddress: input.property?.address ?? null,
    telegramChatId: input.telegramChatId,
    provider: input.llmSafeDomainProvider,
  });

  if (!guard.applied) return base;

  return mapLlmSafeDomainResultToCommunicationDecision(base, guard);
}

function mapLlmSafeDomainResultToCommunicationDecision(
  base: CommunicationDecision,
  result: Extract<LlmSafeDomainLayerResult, { applied: true }>,
): CommunicationDecision {
  return {
    ...base,
    confidence: Math.max(base.confidence, result.decision.confidence),
    suggestedRoute: 'guest',
    responseMode: 'answer_from_concierge',
    canAnswerAutomatically: true,
    shouldEscalate: false,
    reason: result.decision.reason,
    safeGuestReply: result.decision.suggestedReply,
    operatorReason: undefined,
    outcome: 'answered_by_concierge_autopilot',
    missingFields: [],
    decisionSource: result.source === 'llm_safe_domain_layer_v1' ? 'llm_fallback' : 'deterministic',
    llmSafeDomain: {
      used: result.source === 'llm_safe_domain_layer_v1',
      source: result.source,
      provider: result.provider,
      modelName: result.modelName,
      domainZone: result.decision.domainZone,
      detectedIntent: result.decision.intent,
      confidence: result.decision.confidence,
      safeToAnswer: result.decision.safeToAnswer,
      escalationRequired: result.decision.escalationRequired,
      suggestedReply: result.decision.suggestedReply,
      reason: result.decision.reason,
      validation: result.validation,
    },
  };
}

export function patchCommunicationMemoryFromDecision(input: {
  collectedData: Record<string, string | undefined>;
  decision: CommunicationDecision;
  messageText: string;
  activeRole?: SenderIdentity | null;
}): Record<string, string | undefined> {
  const next = { ...input.collectedData };
  if (input.activeRole) next.communication_active_role = input.activeRole;
  next.communication_last_intent = input.decision.detectedIntent;
  if (input.decision.outcome === 'missing_data') {
    next.last_guest_missing_data_request = input.messageText;
  }
  if (input.decision.detectedIntent === 'guest_booking_lookup') {
    next.awaiting_guest_booking_identifier = '1';
  }
  return next;
}

export function loadCommunicationMemoryFromSession(session: {
  identity_role?: string | null;
  pending_identity_message?: string | null;
  collected_data?: Record<string, string | undefined>;
} | null | undefined): CommunicationMemorySnapshot {
  const collected = session?.collected_data ?? {};
  return {
    active_role: (session?.identity_role as SenderIdentity | undefined) ?? null,
    pending_identity_message: session?.pending_identity_message ?? null,
    pending_role_conflict_message: collected.pending_role_conflict_message ?? null,
    last_guest_missing_data_request: collected.last_guest_missing_data_request ?? null,
    awaiting_guest_booking_identifier: collected.awaiting_guest_booking_identifier === '1',
    last_intent: (collected.communication_last_intent as GuestCommunicationIntent | undefined) ?? null,
    last_operator_followup_id: collected.last_operator_followup_id ?? null,
  };
}
