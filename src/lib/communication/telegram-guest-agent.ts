import {
  composeGuestDirectionsReplyRu,
} from './telegram-booking-object-memory';
import type { CommunicationAutopilotContext, CommunicationAutopilotDecision } from './autopilot';
import { classifyWithConfiguredLlmRouter } from './llm-router/provider';
import type { LlmRouterAttemptAudit, LlmRouterDecision, LlmRouterProvider } from './llm-router/types';
import {
  safeCheckinCodeRequestReply,
  safeLlmRouterFallbackReply,
  validateLlmRouterDecision,
} from './llm-router/validate-llm-router-decision';
import {
  CHECKIN_READINESS_ACCESS_REPLY,
  hasPropertyDirectionsContext,
  resolvePropertyDirectionsReply,
  resolveTelegramGuestIntentCanon,
  type TelegramGuestCanonIntent,
} from './telegram-guest-intent-canon';

export type TelegramGuestAgentAction = 'auto_reply' | 'ask_clarification' | 'escalate' | 'policy_handoff';
export type TelegramGuestAgentMode = 'off' | 'shadow' | 'assist' | 'controlled_override' | 'primary';

export type TelegramGuestAgentSafetyFlag =
  | 'urgent_access'
  | 'door_code'
  | 'payment_refund'
  | 'booking_change'
  | 'legal_sensitive'
  | 'operator_escalation'
  | 'no_invented_facts'
  | 'prompt_injection_blocked';

export type TelegramGuestAgentDecision = {
  intent: string;
  confidence: number;
  action: TelegramGuestAgentAction;
  needs_booking_lookup: boolean;
  needs_operator: boolean;
  can_auto_reply: boolean;
  safety_flags: TelegramGuestAgentSafetyFlag[];
  reply_text?: string;
  source: 'policy_guard' | 'llm_router' | 'deterministic_fallback';
  llmRouter?: {
    used: boolean;
    provider: string;
    intent?: string;
    validation: 'accepted' | 'rejected' | 'provider_failed' | 'low_confidence' | 'skipped';
    reason?: string;
    modelName?: string;
    attempts?: LlmRouterAttemptAudit[];
  };
};

export type TelegramGuestAgentShadowDraft = {
  intent: string;
  confidence: number;
  requested_action: TelegramGuestAgentAction;
  required_data: string[];
  safe_reply_draft: string | null;
  escalation_needed: boolean;
  can_auto_reply: boolean;
  safety_flags: TelegramGuestAgentSafetyFlag[];
};

export function getTelegramGuestAgentMode(): TelegramGuestAgentMode {
  const raw = String(process.env.TELEGRAM_GUEST_AGENT_MODE ?? 'off').trim().toLowerCase();
  if (raw === 'shadow') return 'shadow';
  if (raw === 'assist') return 'assist';
  if (raw === 'controlled_override' || raw === 'controlled-override') return 'controlled_override';
  if (raw === 'primary') return 'primary';
  return 'off';
}

export function buildTelegramGuestAgentShadowDraft(
  decision: TelegramGuestAgentDecision,
): TelegramGuestAgentShadowDraft {
  return {
    intent: decision.intent,
    confidence: decision.confidence,
    requested_action: decision.action,
    required_data: requiredDataForAgentDecision(decision),
    safe_reply_draft:
      decision.reply_text ??
      'Поняла. Пришлите номер брони или адрес объекта, и я проверю точные данные.',
    escalation_needed: decision.needs_operator || decision.action === 'escalate' || decision.action === 'policy_handoff',
    can_auto_reply: decision.can_auto_reply,
    safety_flags: decision.safety_flags,
  };
}

function requiredDataForAgentDecision(decision: TelegramGuestAgentDecision): string[] {
  const required = new Set<string>();
  if (decision.needs_booking_lookup) {
    required.add('booking.id_or_guest_phone');
  }
  if (decision.needs_operator) {
    required.add('operator_review');
  }
  if (decision.safety_flags.includes('door_code')) {
    required.add('booking.verification_before_access_secret');
  }
  if (decision.intent === 'address_instruction') {
    required.add('object.address_or_directions');
  }
  if (decision.intent === 'wifi_access') {
    required.add('object.wifi_credentials');
  }
  if (decision.intent === 'wifi_problem') {
    required.add('object.wifi_network_status');
  }
  if (decision.intent === 'parking') {
    required.add('object.parking_policy');
  }
  if (decision.intent === 'waste_disposal_info') {
    required.add('object.waste_disposal_policy');
  }
  if (decision.intent === 'baby_crib_request') {
    required.add('object.baby_crib_policy');
  }
  if (decision.intent === 'early_checkin_late_checkout') {
    required.add('booking.checkout_policy');
  }
  return Array.from(required);
}

const POLICY_GUARD_CANON_INTENTS = new Set<TelegramGuestCanonIntent>([
  'access_urgent',
  'checkin_code_request',
  'payment_booking',
]);

const POLICY_GUARD_AUTOPILOT_INTENTS = new Set([
  'urgent_access_problem',
  'checkin_code_request',
  'booking_payment_support',
]);

export function isTelegramPolicyGuardCanonIntent(intent: TelegramGuestCanonIntent): boolean {
  return POLICY_GUARD_CANON_INTENTS.has(intent);
}

export function isTelegramPolicyGuardAutopilotIntent(intent: string): boolean {
  return POLICY_GUARD_AUTOPILOT_INTENTS.has(intent);
}

export function shouldUseTelegramLlmDefault(input: {
  messageText: string;
  canonIntent: TelegramGuestCanonIntent;
  autopilotIntent: string;
}): boolean {
  if (!input.messageText.trim()) return false;
  if (isTelegramPolicyGuardCanonIntent(input.canonIntent)) return false;
  if (isTelegramPolicyGuardAutopilotIntent(input.autopilotIntent)) return false;
  if (
    ['baby_crib_request', 'waste_disposal_info', 'wifi', 'wifi_access', 'wifi_problem', 'parking'].includes(
      input.autopilotIntent,
    )
  ) {
    return false;
  }
  return true;
}

export async function decideTelegramGuestAgentTurn(input: {
  messageText: string;
  context?: CommunicationAutopilotContext;
  deterministic: CommunicationAutopilotDecision;
  llmRouterProvider?: LlmRouterProvider;
}): Promise<TelegramGuestAgentDecision> {
  const canon = resolveTelegramGuestIntentCanon(input.messageText);
  const policy = resolvePolicyGuardDecision({
    messageText: input.messageText,
    context: input.context,
    canonIntent: canon.intent,
    deterministic: input.deterministic,
  });
  if (policy) return policy;

  if (!shouldUseTelegramLlmDefault({
    messageText: input.messageText,
    canonIntent: canon.intent,
    autopilotIntent: input.deterministic.metadata.intent,
  })) {
    return mapDeterministicToAgentDecision(input.deterministic, 'deterministic_fallback');
  }

  if (input.llmRouterProvider) {
    return decideWithInjectedLlmProvider(input);
  }

  const forceStrongerProvider = detectsGuestMisunderstanding(input.messageText);
  const result = await classifyWithConfiguredLlmRouter({
    messageText: input.messageText,
    lang: input.context?.session?.language ?? 'ru',
    bookingId: input.context?.booking?.id,
    conversationId: input.context?.session?.id,
    sessionId: input.context?.session?.id,
    canonIntent: input.deterministic.metadata.intent,
    canonConfidence: input.deterministic.confidence,
    forceStrongerProvider,
  });

  if (!result.ok) {
    return mapDeterministicToAgentDecision(
      withSafeLlmFallback(input.deterministic, {
        provider: 'disabled',
        intent: 'unknown',
        validation: 'provider_failed',
        reason: result.reason,
        attempts: result.attempts,
      }),
      'deterministic_fallback',
    );
  }

  return mapLlmRouterToAgentDecision(
    input.deterministic,
    result.decision,
    result.provider,
    result.modelName,
    result.attempts,
    input.context,
  );
}

export function mapAgentDecisionToAutopilot(
  decision: TelegramGuestAgentDecision,
  base?: CommunicationAutopilotDecision,
): CommunicationAutopilotDecision {
  const mappedIntent = mapAgentIntentToAutopilotIntent(decision.intent);
  const policy =
    decision.source === 'llm_router' || decision.source === 'deterministic_fallback'
      ? ('deterministic_mvp_v1_llm_router_fallback' as const)
      : ('deterministic_mvp_v1' as const);

  const action =
    decision.action === 'auto_reply'
      ? 'auto_reply'
      : decision.action === 'escalate' || decision.action === 'policy_handoff'
        ? 'escalate'
        : 'needs_context';

  const operationsAction = buildAgentOperationsAction(decision);

  return {
    action,
    confidence: decision.confidence,
    replyText: decision.reply_text,
    escalationReason: decision.needs_operator ? decision.intent : undefined,
    metadata: {
      intent: mappedIntent,
      matchedSignals: base?.metadata.matchedSignals ?? [decision.source, decision.intent],
      missingContext: decision.needs_booking_lookup ? ['booking.lookup_details'] : (base?.metadata.missingContext ?? []),
      contextKeys: base?.metadata.contextKeys ?? [],
      channelMode: 'active',
      urgent: decision.safety_flags.includes('urgent_access'),
      operationsAction,
      policy,
      llmRouter:
        decision.llmRouter?.used &&
        decision.llmRouter.validation !== 'skipped' &&
        decision.llmRouter.validation !== undefined
          ? {
              used: true,
              provider: decision.llmRouter.provider,
              intent: decision.llmRouter.intent ?? decision.intent,
              validation: decision.llmRouter.validation,
              reason: decision.llmRouter.reason,
              modelName: decision.llmRouter.modelName,
              attempts: decision.llmRouter.attempts,
            }
          : undefined,
    },
  };
}

function mapAgentIntentToAutopilotIntent(intent: string): CommunicationAutopilotDecision['metadata']['intent'] {
  switch (intent) {
    case 'urgent_access_problem':
      return 'urgent_access_problem';
    case 'checkin_code_request':
      return 'checkin_code_request';
    case 'check_in_access':
      return 'check_in_access';
    case 'address_instruction':
      return 'address_instruction';
    case 'baby_crib_request':
      return 'baby_crib_request';
    case 'waste_disposal_info':
      return 'waste_disposal_info';
    case 'parking':
      return 'parking';
    case 'early_checkin_late_checkout':
      return 'early_checkin_late_checkout';
    case 'wifi_access':
    case 'wifi_problem':
      return intent;
    case 'booking_lookup_missing_details':
      return 'booking_lookup_missing_details';
    case 'booking_payment_support':
      return 'booking_payment_support';
    case 'cleaning_issue':
      return 'cleaning_issue';
    case 'maintenance_issue':
      return 'maintenance_issue';
    default:
      return 'unknown';
  }
}

function buildAgentOperationsAction(
  decision: TelegramGuestAgentDecision,
): CommunicationAutopilotDecision['metadata']['operationsAction'] {
  if (decision.safety_flags.includes('urgent_access') && decision.needs_operator) {
    return {
      category: 'operator_access_support',
      priority: 'high',
      title: 'Telegram guest agent: urgent access support',
      shortReason: 'urgent_access_problem',
    };
  }
  if (decision.intent === 'cleaning_issue') {
    return {
      category: 'cleaning',
      priority: 'normal',
      title: 'Telegram guest agent: cleaning issue',
      shortReason: 'cleaning_issue',
    };
  }
  if (decision.intent === 'maintenance_issue') {
    return {
      category: 'maintenance',
      priority: 'normal',
      title: 'Telegram guest agent: maintenance issue',
      shortReason: 'maintenance_issue',
    };
  }
  if (decision.intent === 'check_in_access') {
    return {
      category: 'operator_access_support',
      priority: 'normal',
      title: 'Telegram guest agent: check-in readiness and access',
      shortReason: 'check_in_access',
    };
  }
  return undefined;
}

function resolvePolicyGuardDecision(input: {
  messageText: string;
  context?: CommunicationAutopilotContext;
  canonIntent: TelegramGuestCanonIntent;
  deterministic: CommunicationAutopilotDecision;
}): TelegramGuestAgentDecision | null {
  const canon = resolveTelegramGuestIntentCanon(input.messageText);

  if (canon.intent === 'access_urgent') {
    return {
      intent: 'urgent_access_problem',
      confidence: 0.98,
      action: 'escalate',
      needs_booking_lookup: true,
      needs_operator: true,
      can_auto_reply: false,
      safety_flags: ['urgent_access', 'door_code', 'no_invented_facts'],
      reply_text: canon.reply,
      source: 'policy_guard',
      llmRouter: { used: false, provider: 'policy_guard', validation: 'skipped' },
    };
  }

  if (canon.intent === 'checkin_code_request') {
    return {
      intent: 'checkin_code_request',
      confidence: 0.96,
      action: 'ask_clarification',
      needs_booking_lookup: true,
      needs_operator: false,
      can_auto_reply: false,
      safety_flags: ['door_code', 'no_invented_facts'],
      reply_text: safeCheckinCodeRequestReply(),
      source: 'policy_guard',
      llmRouter: { used: false, provider: 'policy_guard', validation: 'skipped' },
    };
  }

  if (canon.intent === 'payment_booking') {
    return {
      intent: 'booking_payment_support',
      confidence: 0.9,
      action: 'ask_clarification',
      needs_booking_lookup: true,
      needs_operator: false,
      can_auto_reply: false,
      safety_flags: ['payment_refund', 'booking_change', 'no_invented_facts'],
      reply_text: canon.reply,
      source: 'policy_guard',
      llmRouter: { used: false, provider: 'policy_guard', validation: 'skipped' },
    };
  }

  if (input.deterministic.metadata.intent === 'urgent_access_problem') {
    return {
      intent: 'urgent_access_problem',
      confidence: input.deterministic.confidence,
      action: 'escalate',
      needs_booking_lookup: input.deterministic.metadata.missingContext.length > 0,
      needs_operator: true,
      can_auto_reply: false,
      safety_flags: ['urgent_access', 'door_code', 'no_invented_facts'],
      reply_text:
        input.deterministic.replyText ??
        'Поняла, это срочно. Уже передаю оператору по доступу. В целях безопасности код двери отправим только после проверки брони.',
      source: 'policy_guard',
      llmRouter: { used: false, provider: 'policy_guard', validation: 'skipped' },
    };
  }

  if (input.deterministic.metadata.intent === 'booking_payment_support') {
    return {
      intent: 'booking_payment_support',
      confidence: input.deterministic.confidence,
      action: 'ask_clarification',
      needs_booking_lookup: true,
      needs_operator: false,
      can_auto_reply: false,
      safety_flags: ['payment_refund', 'no_invented_facts'],
      reply_text: input.deterministic.replyText ?? canon.reply,
      source: 'policy_guard',
      llmRouter: { used: false, provider: 'policy_guard', validation: 'skipped' },
    };
  }

  if (canon.intent === 'property_directions') {
    const hasContext = hasPropertyDirectionsContext(input.context);
    const grounded = hasContext
      ? composeGuestDirectionsReplyRu(
          input.context?.object
            ? {
                object_id: input.context.object.id ?? '',
                object_name: input.context.object.name ?? null,
                address: input.context.object.address ?? null,
                directions_text: input.context.object.directionsText ?? input.context.object.accessInstructions ?? null,
                parking_text: input.context.object.parkingText ?? null,
                trash_bins_location: input.context.object.trashBinsLocation ?? null,
                waste_disposal_text: input.context.object.wasteDisposalText ?? null,
                wifi_name: input.context.object.wifiName ?? null,
                wifi_password: input.context.object.wifiPassword ?? null,
                baby_crib_available: input.context.object.babyCribAvailable ?? null,
                baby_crib_note: input.context.object.babyCribNote ?? null,
                check_in_text: input.context.object.accessInstructions ?? null,
                checkout_time: input.context.booking?.checkoutTime ?? null,
                house_rules_text: input.context.object.houseRules ?? null,
                door_code_notes: null,
                knowledge_status: input.context.object.knowledgeStatus,
              }
            : null,
        )
      : null;
    return {
      intent: 'address_instruction',
      confidence: 0.95,
      action: hasContext && grounded ? 'auto_reply' : 'ask_clarification',
      needs_booking_lookup: !hasContext,
      needs_operator: false,
      can_auto_reply: Boolean(grounded),
      safety_flags: ['no_invented_facts'],
      reply_text: grounded ?? resolvePropertyDirectionsReply(hasContext),
      source: 'policy_guard',
      llmRouter: { used: false, provider: 'policy_guard', validation: 'skipped' },
    };
  }

  if (canon.matchedExample === 'checkin_readiness_access') {
    return {
      intent: 'check_in_access',
      confidence: 0.96,
      action: 'ask_clarification',
      needs_booking_lookup: true,
      needs_operator: false,
      can_auto_reply: false,
      safety_flags: ['door_code', 'no_invented_facts'],
      reply_text: CHECKIN_READINESS_ACCESS_REPLY,
      source: 'policy_guard',
      llmRouter: { used: false, provider: 'policy_guard', validation: 'skipped' },
    };
  }

  return null;
}

async function decideWithInjectedLlmProvider(input: {
  messageText: string;
  context?: CommunicationAutopilotContext;
  deterministic: CommunicationAutopilotDecision;
  llmRouterProvider?: LlmRouterProvider;
}): Promise<TelegramGuestAgentDecision> {
  const provider = input.llmRouterProvider!;
  try {
    const rawDecision = await provider.classifyGuestMessage({
      messageText: input.messageText,
      lang: input.context?.session?.language ?? 'ru',
      bookingId: input.context?.booking?.id,
      conversationId: input.context?.session?.id,
      sessionId: input.context?.session?.id,
      canonIntent: input.deterministic.metadata.intent,
      canonConfidence: input.deterministic.confidence,
      forceStrongerProvider: detectsGuestMisunderstanding(input.messageText),
    });
    const validated = validateLlmRouterDecision(rawDecision);
    if (!validated.ok) {
      return mapDeterministicToAgentDecision(
        withSafeLlmFallback(input.deterministic, {
          provider: provider.name,
          modelName: provider.modelName,
          intent: 'unknown',
          validation: 'rejected',
          reason: validated.reason,
        }),
        'deterministic_fallback',
      );
    }
    if (validated.decision.confidence < 0.7) {
      return mapDeterministicToAgentDecision(
        withSafeLlmFallback(input.deterministic, {
          provider: provider.name,
          modelName: provider.modelName,
          intent: validated.decision.intent,
          validation: 'low_confidence',
        }),
        'deterministic_fallback',
      );
    }
    return mapLlmRouterToAgentDecision(
      input.deterministic,
      validated.decision,
      provider.name,
      provider.modelName,
      undefined,
      input.context,
    );
  } catch (error) {
    return mapDeterministicToAgentDecision(
      withSafeLlmFallback(input.deterministic, {
        provider: provider.name,
        modelName: provider.modelName,
        intent: 'unknown',
        validation: 'provider_failed',
        reason: error instanceof Error ? error.message.slice(0, 80) : 'unknown',
      }),
      'deterministic_fallback',
    );
  }
}

function mapLlmRouterToAgentDecision(
  base: CommunicationAutopilotDecision,
  decision: LlmRouterDecision,
  provider: string,
  modelName?: string,
  attempts?: LlmRouterAttemptAudit[],
  context?: CommunicationAutopilotContext,
): TelegramGuestAgentDecision {
  const llmRouter = {
    used: true,
    provider,
    modelName,
    validation: 'accepted' as const,
    attempts,
  };

  if (decision.intent === 'access_problem' && decision.shouldEscalate) {
    return {
      intent: 'urgent_access_problem',
      confidence: decision.confidence,
      action: 'escalate',
      needs_booking_lookup: true,
      needs_operator: true,
      can_auto_reply: false,
      safety_flags: ['urgent_access', 'door_code', 'no_invented_facts'],
      reply_text:
        'Поняла, это срочно. Уже передаю оператору по доступу. В целях безопасности код двери отправим только после проверки брони.',
      source: 'llm_router',
      llmRouter,
    };
  }

  if (decision.intent === 'checkin_code_request') {
    return {
      intent: 'checkin_code_request',
      confidence: decision.confidence,
      action: 'ask_clarification',
      needs_booking_lookup: true,
      needs_operator: false,
      can_auto_reply: false,
      safety_flags: ['door_code', 'no_invented_facts'],
      reply_text: safeCheckinCodeRequestReply(),
      source: 'llm_router',
      llmRouter,
    };
  }

  if (decision.intent === 'checkin_info_request') {
    return {
      intent: 'check_in_access',
      confidence: decision.confidence,
      action: 'ask_clarification',
      needs_booking_lookup: decision.needsBookingDetails,
      needs_operator: false,
      can_auto_reply: false,
      safety_flags: ['no_invented_facts'],
      reply_text: CHECKIN_READINESS_ACCESS_REPLY,
      source: 'llm_router',
      llmRouter,
    };
  }

  if (decision.intent === 'property_directions') {
    const hasContext = hasPropertyDirectionsContext(context);
    return {
      intent: 'address_instruction',
      confidence: decision.confidence,
      action: hasContext && !decision.needsBookingDetails ? 'auto_reply' : 'ask_clarification',
      needs_booking_lookup: !hasContext || decision.needsBookingDetails,
      needs_operator: false,
      can_auto_reply: hasContext && !decision.needsBookingDetails,
      safety_flags: ['no_invented_facts'],
      reply_text: hasContext ? decision.reply : resolvePropertyDirectionsReply(false),
      source: 'llm_router',
      llmRouter,
    };
  }

  if (decision.intent === 'payment_refund' || decision.intent === 'booking_change' || decision.intent === 'cancellation') {
    return {
      intent: 'booking_payment_support',
      confidence: decision.confidence,
      action: decision.shouldEscalate ? 'escalate' : 'ask_clarification',
      needs_booking_lookup: true,
      needs_operator: decision.shouldEscalate,
      can_auto_reply: false,
      safety_flags:
        decision.intent === 'payment_refund' || decision.intent === 'cancellation'
          ? ['payment_refund', 'no_invented_facts']
          : ['booking_change', 'no_invented_facts'],
      reply_text: decision.reply,
      source: 'llm_router',
      llmRouter,
    };
  }

  if (decision.intent === 'cleaning_issue' || decision.intent === 'maintenance_issue') {
    return {
      intent: decision.intent === 'cleaning_issue' ? 'cleaning_issue' : 'maintenance_issue',
      confidence: decision.confidence,
      action: 'ask_clarification',
      needs_booking_lookup: decision.needsBookingDetails,
      needs_operator: decision.shouldEscalate,
      can_auto_reply: false,
      safety_flags: ['no_invented_facts'],
      reply_text: decision.reply,
      source: 'llm_router',
      llmRouter,
    };
  }

  if (decision.intent === 'parking_question') {
    return {
      intent: 'parking',
      confidence: decision.confidence,
      action: 'ask_clarification',
      needs_booking_lookup: decision.needsBookingDetails,
      needs_operator: decision.shouldEscalate,
      can_auto_reply: false,
      safety_flags: ['no_invented_facts'],
      reply_text: decision.reply,
      source: 'llm_router',
      llmRouter,
    };
  }

  if (decision.intent === 'late_checkout') {
    return {
      intent: 'early_checkin_late_checkout',
      confidence: decision.confidence,
      action: 'ask_clarification',
      needs_booking_lookup: true,
      needs_operator: decision.shouldEscalate,
      can_auto_reply: false,
      safety_flags: ['booking_change', 'no_invented_facts'],
      reply_text: decision.reply,
      source: 'llm_router',
      llmRouter,
    };
  }

  if (decision.intent === 'booking_lookup') {
    return {
      intent: 'booking_lookup_missing_details',
      confidence: decision.confidence,
      action: 'ask_clarification',
      needs_booking_lookup: true,
      needs_operator: false,
      can_auto_reply: false,
      safety_flags: ['no_invented_facts'],
      reply_text: 'Напишите, пожалуйста, телефон или имя гостя, дату заезда и объект - найдем бронь.',
      source: 'llm_router',
      llmRouter,
    };
  }

  if (decision.actionType === 'operator_escalation' || decision.shouldEscalate) {
    return {
      intent: decision.intent,
      confidence: decision.confidence,
      action: 'escalate',
      needs_booking_lookup: decision.needsBookingDetails,
      needs_operator: true,
      can_auto_reply: false,
      safety_flags: ['operator_escalation', 'no_invented_facts'],
      reply_text: decision.reply,
      source: 'llm_router',
      llmRouter,
    };
  }

  const canAutoReply =
    decision.actionType === 'guest_reply_only' &&
    !decision.needsBookingDetails &&
    decision.confidence >= 0.7;

  return {
    intent: decision.intent,
    confidence: decision.confidence,
    action: canAutoReply ? 'auto_reply' : 'ask_clarification',
    needs_booking_lookup: decision.needsBookingDetails,
    needs_operator: false,
    can_auto_reply: canAutoReply,
    safety_flags: ['no_invented_facts'],
    reply_text: decision.reply,
    source: 'llm_router',
    llmRouter,
  };
}

function mapDeterministicToAgentDecision(
  decision: CommunicationAutopilotDecision,
  source: TelegramGuestAgentDecision['source'],
): TelegramGuestAgentDecision {
  const needsBooking =
    decision.metadata.missingContext.includes('booking.lookup_details') ||
    decision.metadata.missingContext.some((field) => field.startsWith('booking.') || field.startsWith('object.'));
  const needsOperator = decision.action === 'escalate' || decision.metadata.urgent;
  const safetyFlags: TelegramGuestAgentSafetyFlag[] = ['no_invented_facts'];
  if (decision.metadata.urgent) safetyFlags.push('urgent_access');
  if (decision.metadata.intent === 'checkin_code_request') safetyFlags.push('door_code');
  if (decision.metadata.intent === 'booking_payment_support') safetyFlags.push('payment_refund');

  return {
    intent: decision.metadata.intent,
    confidence: decision.confidence,
    action:
      decision.action === 'auto_reply'
        ? 'auto_reply'
        : decision.action === 'escalate'
          ? 'escalate'
          : 'ask_clarification',
    needs_booking_lookup: needsBooking,
    needs_operator: needsOperator,
    can_auto_reply: decision.action === 'auto_reply' && Boolean(decision.replyText),
    safety_flags: safetyFlags,
    reply_text: decision.replyText,
    source,
    llmRouter: decision.metadata.llmRouter,
  };
}

function withSafeLlmFallback(
  base: CommunicationAutopilotDecision,
  marker: Omit<NonNullable<CommunicationAutopilotDecision['metadata']['llmRouter']>, 'used'>,
): CommunicationAutopilotDecision {
  return {
    ...base,
    action: 'needs_context',
    confidence: Math.min(base.confidence, 0.69),
    replyText: safeLlmRouterFallbackReply(),
    metadata: {
      ...base.metadata,
      intent: 'unknown',
      missingContext: [],
      urgent: false,
      operationsAction: undefined,
      policy: 'deterministic_mvp_v1_llm_router_fallback',
      llmRouter: { used: true, ...marker },
    },
  };
}

function detectsGuestMisunderstanding(text: string): boolean {
  return /(ты\s+не\s+понял|вы\s+не\s+поняли|я\s+уже\s+сказал|я\s+уже\s+сказала|нет\s+не\s+это|я\s+про\s+другое|при\s+ч[её]м\s+тут\s+уборка|мне\s+нужен\s+код|я\s+спрашиваю\s+про\s+бронь)/i.test(
    text.toLocaleLowerCase('ru-RU'),
  );
}
