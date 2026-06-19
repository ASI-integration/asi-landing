import type { CommunicationChannel } from './types';
import { classifyWithConfiguredLlmRouter } from './llm-router/provider';
import {
  safeCheckinCodeRequestReply,
  safeLlmRouterFallbackReply,
  validateLlmRouterDecision,
} from './llm-router/validate-llm-router-decision';
import type { LlmRouterAttemptAudit, LlmRouterDecision, LlmRouterProvider } from './llm-router/types';
import {
  buildTelegramGuestAgentShadowDraft,
  decideTelegramGuestAgentTurn,
  getTelegramGuestAgentMode,
  mapAgentDecisionToAutopilot,
  type TelegramGuestAgentShadowDraft,
} from './telegram-guest-agent';
import {
  buildGuestMissingContextReplyRu,
  composeGuestBabyCribReplyRu,
  composeGuestCheckoutReplyRu,
  composeGuestDirectionsReplyRu,
  composeGuestParkingReplyRu,
  composeGuestWasteReplyRu,
  composeGuestWifiReplyRu,
} from './telegram-booking-object-memory';
import {
  classifyTelegramGuestSemanticDeterministic,
  mapSemanticRouterToAutopilotIntent,
  routeTelegramGuestSemantic,
  type SemanticAutopilotClassification,
  type TelegramSemanticRouterProvider,
} from './telegram-semantic-router';
import type { ObjectKnowledgeStatus } from './object-knowledge';
import {
  resolveWifiProblemPolicy,
  type WifiEscalationAudit,
} from './wifi-escalation-policy';
import {
  CHECKIN_READINESS_ACCESS_REPLY,
  hasPropertyDirectionsContext,
  PROPERTY_DIRECTIONS_MISSING_CONTEXT_REPLY,
  resolvePropertyDirectionsReply,
  resolveTelegramGuestIntentCanon,
} from './telegram-guest-intent-canon';

export type CommunicationAutopilotAction = 'auto_reply' | 'escalate' | 'needs_context';

export type CommunicationAutopilotIntent =
  | 'check_in_access'
  | 'address_instruction'
  | 'wifi'
  | 'wifi_access'
  | 'wifi_problem'
  | 'parking'
  | 'waste_disposal_info'
  | 'checkout'
  | 'baby_crib_request'
  | 'early_checkin_late_checkout'
  | 'booking_lookup_missing_details'
  | 'checkin_code_request'
  | 'urgent_access_problem'
  | 'cleaning_issue'
  | 'maintenance_issue'
  | 'booking_payment_support'
  | 'unknown';

export type CommunicationAutopilotOperationsAction = {
  category: 'operator_access_support' | 'cleaning' | 'maintenance';
  priority: 'high' | 'normal';
  title: string;
  shortReason: string;
};

export type CommunicationAutopilotChannel = Extract<
  CommunicationChannel,
  'telegram' | 'email' | 'phone'
>;

export type CommunicationAutopilotContext = {
  session?: {
    id?: string;
    guestName?: string;
    language?: 'ru' | 'en' | string;
  };
  booking?: {
    id?: string;
    checkInDate?: string;
    checkInTime?: string;
    checkoutTime?: string;
    earlyCheckInAvailable?: boolean;
    lateCheckoutAvailable?: boolean;
    verified?: boolean;
  };
  object?: {
    id?: string;
    name?: string;
    address?: string;
    directionsText?: string;
    parkingText?: string;
    trashBinsLocation?: string;
    wasteDisposalText?: string;
    accessInstructions?: string;
    accessCode?: string;
    wifiName?: string;
    wifiPassword?: string;
    babyCribAvailable?: boolean;
    babyCribNote?: string;
    houseRules?: string;
    knowledgeStatus?: Partial<Record<string, ObjectKnowledgeStatus>>;
  };
  bookingVerified?: boolean;
  propertyResolved?: boolean;
};

export type CommunicationAutopilotMetadata = {
  intent: CommunicationAutopilotIntent;
  matchedSignals: string[];
  missingContext: string[];
  contextKeys: string[];
  channelMode: 'active' | 'foundation' | 'planned';
  urgent: boolean;
  operationsAction?: CommunicationAutopilotOperationsAction;
  policy: 'deterministic_mvp_v1' | 'deterministic_mvp_v1_llm_router_fallback';
  llmRouter?: {
    used: boolean;
    provider: string;
    intent: string;
    validation: 'accepted' | 'rejected' | 'provider_failed' | 'low_confidence';
    reason?: string;
    modelName?: string;
    attempts?: LlmRouterAttemptAudit[];
  };
  semanticRouter?: {
    used: boolean;
    provider: string;
    intent: string;
    topic: string;
    source: 'llm' | 'deterministic';
    guestSafeSummary?: string;
    knowledgeKeys?: string[];
    reason?: string;
    modelName?: string;
    mvpIntent?: string;
    semanticIntent?: string;
    semanticConfidence?: number;
    finalIntent?: string;
    semanticOverrideApplied?: boolean;
    overrideReason?: string;
  };
  guestAgentShadow?: {
    mode: 'shadow';
    mvp_intent: string;
    semantic_intent: string | null;
    semantic_confidence: number | null;
    final_live_intent: string;
    agent: TelegramGuestAgentShadowDraft;
    mismatch_reason: string | null;
    would_agent_have_helped: boolean;
  };
  wifiEscalation?: WifiEscalationAudit;
};

export type CommunicationAutopilotWifiSession = {
  previousReply?: string | null;
  continuationUsed?: boolean;
  previousIntent?: string | null;
};

const MVP_SEMANTIC_VERIFY_INTENTS = new Set<CommunicationAutopilotIntent>([
  'wifi_access',
  'wifi_problem',
  'waste_disposal_info',
  'cleaning_issue',
  'check_in_access',
  'checkin_code_request',
  'urgent_access_problem',
  'checkout',
  'early_checkin_late_checkout',
  'parking',
  'baby_crib_request',
  'address_instruction',
]);

const SEMANTIC_OVERRIDE_MIN_CONFIDENCE = 0.75;
const SEMANTIC_RESOLVE_UNKNOWN_MIN_CONFIDENCE = 0.65;

function shouldRunSemanticRouterForMvp(mvpIntent: CommunicationAutopilotIntent): boolean {
  return mvpIntent === 'unknown' || MVP_SEMANTIC_VERIFY_INTENTS.has(mvpIntent);
}

function semanticResultTrusted(input: {
  ok: boolean;
  source: 'llm' | 'deterministic';
  confidence: number;
}): boolean {
  if (input.ok && input.source === 'llm') return true;
  return input.source === 'deterministic' && input.confidence >= 0.88;
}

function resolveSemanticVerifier(input: {
  mvpIntent: CommunicationAutopilotIntent;
  semantic: SemanticAutopilotClassification;
  semanticRaw: { confidence: number; intent: string; source: 'llm' | 'deterministic' };
  semanticRouteOk: boolean;
}): {
  semanticClassification?: SemanticAutopilotClassification;
  overrideApplied: boolean;
  overrideReason?: string;
} {
  const { mvpIntent, semantic, semanticRaw, semanticRouteOk } = input;

  if (!shouldRunSemanticRouterForMvp(mvpIntent)) {
    return { semanticClassification: undefined, overrideApplied: false };
  }

  if (mvpIntent === 'unknown') {
    if (semantic.intent !== 'unknown' && semanticRaw.confidence >= SEMANTIC_RESOLVE_UNKNOWN_MIN_CONFIDENCE) {
      return {
        semanticClassification: semantic,
        overrideApplied: true,
        overrideReason: 'semantic_resolved_unknown',
      };
    }
    return {
      semanticClassification: undefined,
      overrideApplied: false,
      overrideReason: input.semanticRouteOk ? undefined : 'kept_unknown',
    };
  }

  if (semantic.intent !== mvpIntent && semantic.intent !== 'unknown') {
    if (
      semanticRaw.confidence >= SEMANTIC_OVERRIDE_MIN_CONFIDENCE &&
      semanticResultTrusted({ ok: semanticRouteOk, source: semanticRaw.source, confidence: semanticRaw.confidence })
    ) {
      return {
        semanticClassification: semantic,
        overrideApplied: true,
        overrideReason: 'semantic_override_mvp_conflict',
      };
    }
    return {
      semanticClassification: undefined,
      overrideApplied: false,
      overrideReason:
        semanticRaw.confidence < SEMANTIC_OVERRIDE_MIN_CONFIDENCE
          ? 'kept_mvp_low_semantic_confidence'
          : 'kept_mvp_semantic_untrusted',
    };
  }

  return {
    semanticClassification: undefined,
    overrideApplied: false,
    overrideReason: semantic.intent === mvpIntent ? 'semantic_confirmed_mvp' : 'kept_mvp_semantic_unknown',
  };
}

export type CommunicationAutopilotDecision = {
  action: CommunicationAutopilotAction;
  confidence: number;
  replyText?: string;
  escalationReason?: string;
  metadata: CommunicationAutopilotMetadata;
};

type IntentRule = {
  intent: Exclude<CommunicationAutopilotIntent, 'unknown'>;
  confidence: number;
  patterns: RegExp[];
};

const INTENT_RULES: readonly IntentRule[] = [
  {
    intent: 'urgent_access_problem',
    confidence: 0.94,
    patterns: [
      /(can(?:not|'t)|unable|cannot)\s+(enter|get\s+in|open|access)/i,
      /(door|lock|key|code).{0,28}(does\s+not\s+work|doesn't\s+work|not\s+working|broken|stuck|wrong)/i,
      /(домофон|подъезд|вход|дверь).{0,28}(не\s+открывает|не\s+работает|не\s+пускает|сломал)/i,
      /(urgent|emergency|outside|stuck).{0,40}(access|door|lock|key|code|enter|get\s+in)/i,
    ],
  },
  {
    intent: 'booking_lookup_missing_details',
    confidence: 0.82,
    patterns: [
      /(есть|у\s+меня|моя|моё|мое).{0,24}(бронь|бронирован)/i,
      /(бронь|бронирован).{0,32}(не\s+знаю|нет|без).{0,18}(номер|номера)/i,
      /(booking|reservation).{0,32}(no\s+number|without\s+number|do\s+not\s+know)/i,
    ],
  },
  {
    intent: 'early_checkin_late_checkout',
    confidence: 0.86,
    patterns: [
      /ранн(?:ий|его|ему|им)?\s+заезд/i,
      /поздн(?:ий|его|ему|им)?\s+выезд/i,
      /(заехать|заселиться)\s+(раньше|пораньше|до)/i,
      /(выехать|выезд)\s+(позже|попозже|после)/i,
      /(early\s+check[\s-]?in|late\s+check[\s-]?out)/i,
    ],
  },
  {
    intent: 'cleaning_issue',
    confidence: 0.9,
    patterns: [
      /(грязно|грязн(?:ая|ый|ое|ые)|не\s+убрано|не\s+убрали|плохо\s+убрано|уборк[аи])/i,
      /(нет|не\s+хватает|закончились).{0,28}(полотенц|туалетн(?:ой|ая)\s+бумаг|бель[ея])/i,
      /(dirty|not\s+cleaned|unclean|messy|no\s+towels?|missing\s+towels?|needs?\s+cleaning)/i,
    ],
  },
  {
    intent: 'maintenance_issue',
    confidence: 0.9,
    patterns: [
      /(сломал(?:ось|ся|ась|и)|сломано|поломка|не\s+работает|перестал[ао]?\s+работать|протекает|теч[её]т)/i,
      /(свет|душ|кран|вода|раковин|унитаз|замок|дверь|отоплен|кондиционер|розетк).{0,36}(не\s+работает|сломал(?:ось|ся|ась|и)|протекает|теч[её]т|не\s+открывается)/i,
      /(broken|does\s+not\s+work|doesn't\s+work|not\s+working|leaking|leak|no\s+light|shower|lock|maintenance)/i,
    ],
  },
  {
    intent: 'check_in_access',
    confidence: 0.88,
    patterns: [
      /(заселени[еяю]|заезд)/i,
      /как\s+(попасть|зайти|войти|заселиться)/i,
      /(код|ключ[иа]?|инструкция)\s+(для\s+)?(входа|заселения|доступа)/i,
      /(ключ|код).{0,20}(доступ|вход|заселен)/i,
      /(квартир|объект|номер|апартамент).{0,24}(готов|готовности|готова)/i,
      /готовност[ьи].{0,24}(квартир|объекта|номера|объект)/i,
      /(нужен|нужна|нужно|дайте|хочу).{0,28}(ключ|код).{0,28}(доступ|вход)/i,
      /(check[\s-]?in|arrival|access|door\s+code|entry\s+code|key\s+instructions)/i,
      /how\s+(do|can)\s+i\s+(enter|get\s+in|check\s+in|access)/i,
    ],
  },
  {
    intent: 'address_instruction',
    confidence: 0.84,
    patterns: [
      /(address|location|directions|where\s+is|how\s+to\s+get\s+there)/i,
      /(адрес|локаци[яию]|геолокаци[яию])/i,
      /(где\s+находится|куда\s+ехать|как\s+добраться)/i,
      /инструкци[яию]/i,
    ],
  },
  {
    intent: 'wifi_access',
    confidence: 0.9,
    patterns: [
      /(wi[\s-]?fi|вай[\s-]?фай|интернет)/i,
      /парол[ья]?.{0,18}(wifi|wi[\s-]?fi|вай[\s-]?фай|интернет)/i,
      /(wifi|wi[\s-]?fi|вай[\s-]?фай|интернет).{0,40}(парол|password|подключ|данные|сеть)/i,
    ],
  },
  {
    intent: 'parking',
    confidence: 0.88,
    patterns: [/(парков|где\s+припарк|можно\s+ли\s+парков|стоянк)/i, /(parking|park\s+car|where\s+to\s+park)/i],
  },
  {
    intent: 'waste_disposal_info',
    confidence: 0.89,
    patterns: [
      /(мусор|баки|контейнер|выбросить|выносить|утилизац|recycling|trash|garbage|waste)/i,
      /(где|куда).{0,32}(баки|мусор|контейнер)/i,
    ],
  },
  {
    intent: 'baby_crib_request',
    confidence: 0.9,
    patterns: [
      /(детск|ребен|ребён|малыш).{0,32}(кроват|люльк|манеж)/i,
      /(кроват|люльк|манеж).{0,32}(детск|ребен|ребён|малыш)/i,
      /(baby\s+crib|cot|child\s+bed)/i,
    ],
  },
  {
    intent: 'checkout',
    confidence: 0.86,
    patterns: [/(выезд|чекаут|check[\s-]?out)/i, /до\s+скольки\s+(выехать|выезд)/i],
  },
] as const;

const CHANNEL_MODE: Record<CommunicationAutopilotChannel, CommunicationAutopilotMetadata['channelMode']> = {
  telegram: 'active',
  email: 'foundation',
  phone: 'planned',
};

export function decideCommunicationAutopilotResponse(input: {
  channel: CommunicationAutopilotChannel;
  messageText: string;
  context?: CommunicationAutopilotContext;
  semanticClassification?: SemanticAutopilotClassification;
  wifiSession?: CommunicationAutopilotWifiSession;
}): CommunicationAutopilotDecision {
  const normalizedText = normalizeText(input.messageText);
  const useGuestIntentCanon = input.channel === 'telegram' || input.channel === 'email';
  const canon = useGuestIntentCanon ? resolveTelegramGuestIntentCanon(input.messageText) : null;
  const classification = resolveGuestClassification({
    channel: input.channel,
    messageText: input.messageText,
    normalizedText,
    canon,
    semanticClassification: input.semanticClassification,
  });
  const missingContext = getMissingContext(classification.intent, input.context);
  const baseMetadata = buildMetadata({
    channel: input.channel,
    context: input.context,
    intent: classification.intent,
    matchedSignals: classification.matchedSignals,
    missingContext,
  });

  if (canon?.intent === 'access_urgent') {
    return {
      action: 'escalate',
      confidence: classification.confidence,
      replyText: canon.reply,
      escalationReason: 'urgent_access_problem',
      metadata: { ...baseMetadata, urgent: true },
    };
  }

  if (canon?.intent === 'payment_booking') {
    const refundOrCancel = /(отмен|возврат|refund|cancel)/i.test(input.messageText);
    if (refundOrCancel) {
      return {
        action: 'escalate',
        confidence: classification.confidence,
        replyText:
          'Понял запрос по отмене/возврату. Передаю оператору — сверим бронь и оплату без автоматических обещаний.',
        escalationReason: 'booking_payment_support',
        metadata: baseMetadata,
      };
    }
    return {
      action: 'needs_context',
      confidence: Math.min(classification.confidence, 0.72),
      replyText: canon.reply,
      metadata: baseMetadata,
    };
  }

  if (canon?.intent === 'property_directions') {
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
      action: hasContext && grounded ? 'auto_reply' : 'needs_context',
      confidence: classification.confidence,
      replyText: grounded ?? resolvePropertyDirectionsReply(hasContext),
      metadata: {
        ...baseMetadata,
        missingContext: hasContext && grounded ? [] : ['object.address'],
      },
    };
  }

  if (classification.intent === 'urgent_access_problem') {
    if (classification.matchedSignals.includes('safety_emergency')) {
      return {
        action: 'escalate',
        confidence: classification.confidence,
        replyText:
          '\u0415\u0441\u043b\u0438 \u0435\u0441\u0442\u044c \u043f\u043e\u0436\u0430\u0440 \u0438\u043b\u0438 \u0434\u044b\u043c, \u0441\u0440\u0430\u0437\u0443 \u0432\u044b\u0439\u0434\u0438\u0442\u0435 \u0438\u0437 \u043a\u0432\u0430\u0440\u0442\u0438\u0440\u044b \u0438 \u0437\u0432\u043e\u043d\u0438\u0442\u0435 112. \u041c\u044b \u043f\u0435\u0440\u0435\u0434\u0430\u0451\u043c \u0441\u0438\u0442\u0443\u0430\u0446\u0438\u044e \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0443.',
        escalationReason: 'safety_emergency',
        metadata: { ...baseMetadata, urgent: true },
      };
    }

    if (classification.matchedSignals.includes('protected_access_bypass')) {
      return {
        action: 'escalate',
        confidence: classification.confidence,
        replyText:
          '\u041d\u0435 \u043c\u043e\u0433\u0443 \u043f\u043e\u043c\u043e\u0433\u0430\u0442\u044c \u0441 \u043e\u0431\u0445\u043e\u0434\u043e\u043c \u0437\u0430\u043c\u043a\u0430. \u0415\u0441\u043b\u0438 \u0432\u044b \u0433\u043e\u0441\u0442\u044c \u0438 \u043d\u0435 \u043c\u043e\u0436\u0435\u0442\u0435 \u0432\u043e\u0439\u0442\u0438, \u043d\u0430\u043f\u0438\u0448\u0438\u0442\u0435 \u043d\u043e\u043c\u0435\u0440 \u0431\u0440\u043e\u043d\u0438 \u0438\u043b\u0438 \u0430\u0434\u0440\u0435\u0441, \u043f\u0435\u0440\u0435\u0434\u0430\u043c \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0443.',
        escalationReason: 'protected_access_bypass',
        metadata: { ...baseMetadata, urgent: true },
      };
    }

    if (missingContext.length === 0) {
      return {
        action: 'auto_reply',
        confidence: classification.confidence,
        replyText: 'Понял, доступом занимаемся срочно. Передаю команде.',
        metadata: baseMetadata,
      };
    }
    return {
      action: 'escalate',
      confidence: classification.confidence,
      escalationReason: 'urgent_access_problem',
      metadata: baseMetadata,
    };
  }

  if (classification.intent === 'unknown') {
    if (isNoiseComplaintText(input.messageText)) {
      return {
        action: 'needs_context',
        confidence: 0.72,
        replyText:
          '\u041f\u043e\u043d\u044f\u043b, \u0441\u043e\u0441\u0435\u0434\u0438 \u0448\u0443\u043c\u044f\u0442. \u041d\u0430\u043f\u0438\u0448\u0438\u0442\u0435, \u043f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430, \u0448\u0443\u043c \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u0435\u0442\u0441\u044f \u0441\u0435\u0439\u0447\u0430\u0441 \u0438 \u044d\u0442\u043e \u043c\u0443\u0437\u044b\u043a\u0430, \u0432\u0435\u0447\u0435\u0440\u0438\u043d\u043a\u0430 \u0438\u043b\u0438 \u0440\u0435\u043c\u043e\u043d\u0442? \u0415\u0441\u043b\u0438 \u043c\u0435\u0448\u0430\u0435\u0442 \u0441\u043f\u0430\u0442\u044c, \u043f\u0435\u0440\u0435\u0434\u0430\u043c \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0443.',
        metadata: baseMetadata,
      };
    }

    return {
      action: 'needs_context',
      confidence: 0.42,
      metadata: baseMetadata,
    };
  }

  if (classification.intent === 'wifi_problem') {
    const wifiPolicy = resolveWifiProblemPolicy({
      messageText: input.messageText,
      context: input.context,
      previousReply: input.wifiSession?.previousReply,
      continuationUsed: input.wifiSession?.continuationUsed,
      previousIntent: input.wifiSession?.previousIntent,
    });
    return {
      action: wifiPolicy.action,
      confidence: classification.confidence,
      replyText: wifiPolicy.replyText,
      escalationReason: wifiPolicy.escalationNeeded ? 'wifi_problem' : undefined,
      metadata: {
        ...baseMetadata,
        missingContext: wifiPolicy.action === 'needs_context' ? missingContext : [],
        wifiEscalation: wifiPolicy.audit,
      },
    };
  }

  if (missingContext.length > 0) {
    const canonReply =
      canon && canon.intent !== 'unknown' && classifyCanonIntent(canon).intent === classification.intent
        && !(
          classification.intent === 'baby_crib_request' ||
          classification.intent === 'waste_disposal_info'
        )
        ? canon.reply
        : undefined;
    const semanticReply =
      classification.intent === 'wifi_access' || classification.intent === 'wifi'
          ? composeGuestWifiReplyRu({ property: null, verified: false })
          : undefined;
    return {
      action: 'needs_context',
      confidence: Math.min(classification.confidence, 0.72),
      replyText: canonReply ?? semanticReply,
      metadata: baseMetadata,
    };
  }

  if (isOperationsIntent(classification.intent) && missingContext.length === 0) {
    return {
      action: 'escalate',
      confidence: classification.confidence,
      escalationReason: classification.intent,
      metadata: baseMetadata,
    };
  }

  return {
    action: 'auto_reply',
    confidence: classification.confidence,
    replyText: isOperationsIntent(classification.intent)
      ? composeRuOperationsReply(classification.intent)
      : composeRuReply(classification.intent, input.context),
    metadata: baseMetadata,
  };
}

export async function decideCommunicationAutopilotResponseWithLlmRouter(input: {
  channel: CommunicationAutopilotChannel;
  messageText: string;
  context?: CommunicationAutopilotContext;
  llmRouterProvider?: LlmRouterProvider;
  semanticRouterProvider?: TelegramSemanticRouterProvider;
  wifiSession?: CommunicationAutopilotWifiSession;
}): Promise<CommunicationAutopilotDecision> {
  let semanticClassification: SemanticAutopilotClassification | undefined;
  let semanticRouterMeta: CommunicationAutopilotMetadata['semanticRouter'];

  if (input.channel === 'telegram') {
    const canon = resolveTelegramGuestIntentCanon(input.messageText);
    const mvpIntent = classifyIntent(normalizeText(input.messageText), input.messageText).intent;
    const semanticRoute = await routeTelegramGuestSemantic(
      {
        messageText: input.messageText,
        lang: input.context?.session?.language ?? 'ru',
        bookingId: input.context?.booking?.id,
        sessionId: input.context?.session?.id,
        canonIntent: canon.intent,
        deterministicIntent: mvpIntent,
      },
      input.semanticRouterProvider,
    );
    const semanticRaw = semanticRoute.ok ? semanticRoute.result : semanticRoute.fallback;
    const semantic = mapSemanticRouterToAutopilotIntent(semanticRaw);
    const verifier = resolveSemanticVerifier({
      mvpIntent,
      semantic,
      semanticRaw,
      semanticRouteOk: semanticRoute.ok,
    });
    semanticClassification = verifier.semanticClassification;
    semanticRouterMeta = {
      used: shouldRunSemanticRouterForMvp(mvpIntent),
      provider: semanticRoute.ok ? semanticRoute.provider : 'deterministic',
      intent: semantic.intent,
      topic: semantic.topic,
      source: semantic.semanticSource,
      guestSafeSummary: semantic.guestSafeSummary,
      knowledgeKeys: semantic.knowledgeKeys,
      reason: semanticRoute.ok ? undefined : semanticRoute.reason,
      modelName: semanticRoute.ok
        ? semanticRoute.modelName
        : semanticRaw.source === 'deterministic'
          ? 'deterministic'
          : 'disabled',
      mvpIntent,
      semanticIntent: semanticRaw.intent,
      semanticConfidence: semanticRaw.confidence,
      finalIntent: verifier.semanticClassification?.intent ?? mvpIntent,
      semanticOverrideApplied: verifier.overrideApplied,
      overrideReason: verifier.overrideReason,
    };
  }

  const deterministic = decideCommunicationAutopilotResponse({
    ...input,
    semanticClassification,
  });
  if (semanticRouterMeta) {
    deterministic.metadata.semanticRouter = semanticRouterMeta;
  }

  if (input.channel === 'telegram') {
    const guestAgentMode = getTelegramGuestAgentMode();
    if (guestAgentMode === 'primary') {
      const agentDecision = await decideTelegramGuestAgentTurn({
        messageText: input.messageText,
        context: input.context,
        deterministic,
        llmRouterProvider: input.llmRouterProvider,
      });
      return mapAgentDecisionToAutopilot(agentDecision, deterministic);
    }

    if (guestAgentMode === 'shadow') {
      const agentDecision = await decideTelegramGuestAgentTurn({
        messageText: input.messageText,
        context: input.context,
        deterministic,
        llmRouterProvider: input.llmRouterProvider,
      });
      const mvpIntent = semanticRouterMeta?.mvpIntent ?? deterministic.metadata.intent;
      const semanticIntent = semanticRouterMeta?.semanticIntent ?? null;
      const finalLiveIntent = deterministic.metadata.intent;
      deterministic.metadata.guestAgentShadow = {
        mode: 'shadow',
        mvp_intent: mvpIntent,
        semantic_intent: semanticIntent,
        semantic_confidence: semanticRouterMeta?.semanticConfidence ?? null,
        final_live_intent: finalLiveIntent,
        agent: buildTelegramGuestAgentShadowDraft(agentDecision),
        mismatch_reason: resolveGuestAgentMismatchReason({
          mvpIntent,
          semanticIntent,
          finalLiveIntent,
          agentIntent: agentDecision.intent,
        }),
        would_agent_have_helped: wouldGuestAgentHaveHelped({
          finalLiveIntent,
          finalReply: deterministic.replyText,
          agentIntent: agentDecision.intent,
          agentConfidence: agentDecision.confidence,
          agentReply: agentDecision.reply_text,
        }),
      };
    }
  }

  if (!shouldUseLlmRouterFallback(input.channel, input.messageText, deterministic)) {
    return deterministic;
  }

  if (input.llmRouterProvider) {
    return decideWithSingleInjectedProvider(input, deterministic);
  }

  const forceStrongerProvider = detectsMisunderstanding(input.messageText);
  const result = await classifyWithConfiguredLlmRouter({
    messageText: input.messageText,
    lang: input.context?.session?.language ?? 'ru',
    bookingId: input.context?.booking?.id,
    conversationId: input.context?.session?.id,
    sessionId: input.context?.session?.id,
    canonIntent: deterministic.metadata.intent,
    canonConfidence: deterministic.confidence,
    forceStrongerProvider,
  });

  if (!result.ok) {
    return withLlmRouterMetadata(buildSafeClarificationDecision(deterministic), {
      provider: 'disabled',
      intent: 'unknown',
      validation: 'provider_failed',
      reason: result.reason,
      attempts: result.attempts,
    });
  }

  return mapLlmRouterDecisionToAutopilotDecision(
    deterministic,
    result.decision,
    result.provider,
    result.modelName,
    result.attempts,
  );
}

function resolveGuestAgentMismatchReason(input: {
  mvpIntent: string;
  semanticIntent: string | null;
  finalLiveIntent: string;
  agentIntent: string;
}): string | null {
  if (input.agentIntent === input.finalLiveIntent) return null;
  if (input.semanticIntent && input.semanticIntent !== input.mvpIntent && input.agentIntent === input.semanticIntent) {
    return 'agent_matches_semantic_router_not_live_intent';
  }
  if (input.finalLiveIntent === 'unknown' && input.agentIntent !== 'unknown') {
    return 'agent_resolved_live_unknown';
  }
  if (input.agentIntent !== input.mvpIntent) {
    return 'agent_differs_from_mvp_intent';
  }
  return 'agent_differs_from_live_intent';
}

function wouldGuestAgentHaveHelped(input: {
  finalLiveIntent: string;
  finalReply?: string;
  agentIntent: string;
  agentConfidence: number;
  agentReply?: string;
}): boolean {
  if (input.agentConfidence < 0.7 || !input.agentReply?.trim()) return false;
  if (input.finalLiveIntent === 'unknown' && input.agentIntent !== 'unknown') return true;
  if (input.agentIntent !== input.finalLiveIntent) return true;
  return !input.finalReply?.trim();
}

async function decideWithSingleInjectedProvider(
  input: {
    channel: CommunicationAutopilotChannel;
    messageText: string;
    context?: CommunicationAutopilotContext;
    llmRouterProvider?: LlmRouterProvider;
  },
  deterministic: CommunicationAutopilotDecision,
): Promise<CommunicationAutopilotDecision> {
  const provider = input.llmRouterProvider!;
  try {
    const rawDecision = await provider.classifyGuestMessage({
      messageText: input.messageText,
      lang: input.context?.session?.language ?? 'ru',
      bookingId: input.context?.booking?.id,
      conversationId: input.context?.session?.id,
      sessionId: input.context?.session?.id,
      canonIntent: deterministic.metadata.intent,
      canonConfidence: deterministic.confidence,
      forceStrongerProvider: detectsMisunderstanding(input.messageText),
    });
    const validated = validateLlmRouterDecision(rawDecision);
    if (!validated.ok) {
      return withLlmRouterMetadata(deterministic, {
        provider: provider.name,
        modelName: provider.modelName,
        intent: 'unknown',
        validation: 'rejected',
        reason: validated.reason,
      });
    }
    if (validated.decision.confidence < 0.7) {
      return withLlmRouterMetadata(buildSafeClarificationDecision(deterministic), {
        provider: provider.name,
        modelName: provider.modelName,
        intent: validated.decision.intent,
        validation: 'low_confidence',
      });
    }
    return mapLlmRouterDecisionToAutopilotDecision(
      deterministic,
      validated.decision,
      provider.name,
      provider.modelName,
    );
  } catch (error) {
    return withLlmRouterMetadata(deterministic, {
      provider: provider.name,
      modelName: provider.modelName,
      intent: 'unknown',
      validation: 'provider_failed',
      reason: error instanceof Error ? error.message.slice(0, 80) : 'unknown',
    });
  }
}

export function composeCommunicationAutopilotContextReply(input: {
  decision: CommunicationAutopilotDecision;
  lang: 'ru' | 'en' | string;
}): string {
  if (input.decision.replyText) return input.decision.replyText;

  if (input.lang === 'ru') {
    switch (input.decision.metadata.intent) {
      case 'unknown':
        return 'Понял. Подскажите, вы про заселение, оплату, доступ к квартире или уже текущее проживание? Я помогу с нужным шагом.';
      case 'booking_lookup_missing_details':
        return 'Напишите, пожалуйста, телефон или имя гостя, дату заезда и объект - найдем бронь.';
      case 'checkin_code_request':
        return safeCheckinCodeRequestReply();
      case 'cleaning_issue':
        return 'Принял, вопрос по уборке зарегистрирован. Напишите, пожалуйста, объект или номер брони.';
      case 'maintenance_issue':
        return 'Принял, поломку зарегистрировал. Напишите, пожалуйста, объект или номер брони.';
      case 'check_in_access':
        return 'Понял, помогаю с заселением. Напишите, пожалуйста, объект или номер брони.';
      case 'address_instruction':
        return PROPERTY_DIRECTIONS_MISSING_CONTEXT_REPLY;
    case 'wifi':
    case 'wifi_access':
      return composeGuestWifiReplyRu({ property: null, verified: false });
    case 'wifi_problem':
      return resolveWifiProblemPolicy({ messageText: '', context: undefined }).replyText;
      case 'baby_crib_request':
      case 'waste_disposal_info':
        return input.decision.metadata.missingContext.includes('object.id')
          ? 'Напишите, пожалуйста, номер бронирования или адрес объекта. Я проверю информацию.'
          : 'Сейчас не вижу точной информации по этому вопросу для вашего объекта. Уточню и вернусь с ответом.';
      case 'parking':
      case 'checkout':
        return buildGuestMissingContextReplyRu();
      default:
        return 'Уточните, пожалуйста, объект или номер брони, и я проверю точные детали.';
    }
  }

  if (input.decision.metadata.intent === 'unknown') {
    return 'Please clarify what happened: check-in, access, cleaning, maintenance, or booking question?';
  }
  return 'Please send the property or booking number, and I will check the exact details.';
}

function resolveGuestClassification(input: {
  channel: CommunicationAutopilotChannel;
  messageText: string;
  normalizedText: string;
  canon: ReturnType<typeof resolveTelegramGuestIntentCanon> | null;
  semanticClassification?: SemanticAutopilotClassification;
}): {
  intent: CommunicationAutopilotIntent;
  confidence: number;
  matchedSignals: string[];
} {
  const patternClassification = classifyIntent(input.normalizedText, input.messageText);
  const canonClassification =
    input.canon && input.canon.intent !== 'unknown' ? classifyCanonIntent(input.canon) : null;

  const semantic = input.semanticClassification;
  if (semantic && semantic.confidence >= 0.65 && semantic.intent !== 'unknown') {
    if (shouldPreferSemanticClassification(canonClassification, semantic, patternClassification)) {
      return {
        intent: semantic.intent as CommunicationAutopilotIntent,
        confidence: semantic.confidence,
        matchedSignals: semantic.matchedSignals,
      };
    }
  }

  if (input.channel === 'telegram') {
    const deterministicSemantic = mapSemanticRouterToAutopilotIntent(
      classifyTelegramGuestSemanticDeterministic(input.messageText),
    );
    const disambiguationIntents = new Set([
      'wifi_access',
      'wifi_problem',
      'waste_disposal_info',
      'cleaning_issue',
    ]);
    if (
      deterministicSemantic.confidence >= 0.88 &&
      disambiguationIntents.has(deterministicSemantic.intent) &&
      shouldPreferSemanticClassification(canonClassification, deterministicSemantic, patternClassification)
    ) {
      return {
        intent: deterministicSemantic.intent as CommunicationAutopilotIntent,
        confidence: deterministicSemantic.confidence,
        matchedSignals: deterministicSemantic.matchedSignals,
      };
    }
  }

  if (canonClassification) return canonClassification;
  return patternClassification;
}

function shouldPreferSemanticClassification(
  canon: { intent: CommunicationAutopilotIntent; confidence: number } | null,
  semantic: SemanticAutopilotClassification,
  pattern: { intent: CommunicationAutopilotIntent; confidence: number },
): boolean {
  const semanticIntent = semantic.intent as CommunicationAutopilotIntent;
  if (semanticIntent === 'wifi_problem' || semanticIntent === 'wifi_access') return true;
  if (semanticIntent === 'waste_disposal_info' && pattern.intent === 'cleaning_issue') return true;
  if (semanticIntent === 'cleaning_issue' && pattern.intent === 'waste_disposal_info') return true;
  if (!canon) return semantic.confidence >= pattern.confidence;
  if (canon.intent === 'unknown') return true;
  return semantic.confidence >= canon.confidence + 0.05;
}

function classifyCanonIntent(canon: ReturnType<typeof resolveTelegramGuestIntentCanon>): {
  intent: CommunicationAutopilotIntent;
  confidence: number;
  matchedSignals: string[];
} {
  const matchedSignals = [canon.intent, canon.matchedExample ?? 'telegram_guest_intent_canon_v1'];
  switch (canon.intent) {
    case 'access_urgent':
      return { intent: 'urgent_access_problem', confidence: 0.98, matchedSignals };
    case 'checkin_info':
      return {
        intent: 'check_in_access',
        confidence: canon.matchedExample === 'checkin_readiness_access' ? 0.96 : 0.94,
        matchedSignals,
      };
    case 'checkin_code_request':
      return { intent: 'checkin_code_request', confidence: 0.96, matchedSignals };
    case 'property_directions':
      return { intent: 'address_instruction', confidence: 0.95, matchedSignals };
    case 'waste_disposal_info':
      return { intent: 'waste_disposal_info', confidence: 0.95, matchedSignals };
    case 'baby_crib_request':
      return { intent: 'baby_crib_request', confidence: 0.95, matchedSignals };
    case 'maintenance':
      return { intent: 'maintenance_issue', confidence: 0.96, matchedSignals };
    case 'cleaning_housekeeping':
      return { intent: 'cleaning_issue', confidence: 0.96, matchedSignals };
    case 'booking_missing_details':
      return { intent: 'booking_lookup_missing_details', confidence: 0.94, matchedSignals };
    case 'payment_booking':
      return { intent: 'booking_payment_support', confidence: 0.9, matchedSignals };
    default:
      return { intent: 'unknown', confidence: 0.38, matchedSignals };
  }
}

function classifyIntent(
  normalizedText: string,
  originalText = normalizedText,
): {
  intent: CommunicationAutopilotIntent;
  confidence: number;
  matchedSignals: string[];
} {
  const urgentAccessSignals = [
    /(\u043d\u0435\s+\u043c\u043e\u0433\u0443|\u043d\u0435\u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e|\u043d\u0435\s+\u043f\u043e\u043b\u0443\u0447\u0430\u0435\u0442\u0441\u044f)\s+(\u043f\u043e\u043f\u0430\u0441\u0442\u044c|\u0437\u0430\u0439\u0442\u0438|\u0432\u043e\u0439\u0442\u0438|\u043e\u0442\u043a\u0440\u044b\u0442\u044c)/i,
    /(\u043a\u043e\u0434|\u0437\u0430\u043c\u043e\u043a|\u0434\u0432\u0435\u0440\u044c|\u043a\u043b\u044e\u0447).{0,28}(\u043d\u0435\s+\u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442|\u043d\u0435\s+\u043f\u043e\u0434\u0445\u043e\u0434\u0438\u0442|\u043d\u0435\s+\u043e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442|\u043d\u0435\s+\u043e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442\u0441\u044f|\u0441\u043b\u043e\u043c\u0430\u043b[\u0430\u043e]?\u0441[\u044c\u044f]|\u0437\u0430\u043a\u043b\u0438\u043d\u0438\u043b[\u0430\u043e]?)/i,
    /(\u0441\u0440\u043e\u0447\u043d\u043e|\u044d\u043a\u0441\u0442\u0440\u0435\u043d\u043d\u043e|\u043d\u0430\s+\u0443\u043b\u0438\u0446\u0435|\u0437\u0430\u0441\u0442\u0440\u044f\u043b[\u0430\u0438]?|\u0437\u0430\u0441\u0442\u0440\u044f\u043b\u0438).{0,40}(\u0434\u043e\u0441\u0442\u0443\u043f|\u0437\u0430\u043c\u043e\u043a|\u0434\u0432\u0435\u0440\u044c|\u043a\u043e\u0434|\u043a\u043b\u044e\u0447|\u0432\u043e\u0439\u0442\u0438|\u043f\u043e\u043f\u0430\u0441\u0442\u044c)/i,
  ];

  if (isSafetyEmergencyText(originalText)) {
    return {
      intent: 'urgent_access_problem',
      confidence: 0.99,
      matchedSignals: ['safety_emergency'],
    };
  }

  if (isProtectedAccessBypassText(originalText)) {
    return {
      intent: 'urgent_access_problem',
      confidence: 0.99,
      matchedSignals: ['protected_access_bypass'],
    };
  }

  const urgentMatches = urgentAccessSignals
    .filter((pattern) => pattern.test(normalizedText))
    .map((pattern) => pattern.source);
  if (urgentMatches.length > 0) {
    return {
      intent: 'urgent_access_problem',
      confidence: 0.94,
      matchedSignals: urgentMatches,
    };
  }

  if (isWaterLeakMaintenanceText(originalText)) {
    return {
      intent: 'maintenance_issue',
      confidence: 0.94,
      matchedSignals: ['water_leak_maintenance'],
    };
  }

  for (const rule of INTENT_RULES) {
    const matchedSignals = rule.patterns
      .filter((pattern) => pattern.test(normalizedText))
      .map((pattern) => pattern.source);

    if (matchedSignals.length > 0) {
      return {
        intent: rule.intent,
        confidence: rule.confidence,
        matchedSignals,
      };
    }
  }

  return {
    intent: 'unknown',
    confidence: 0.38,
    matchedSignals: [],
  };
}

function isSafetyEmergencyText(text: string): boolean {
  return /(\u043f\u043e\u0436\u0430\u0440|\u0434\u044b\u043c|\u0433\u0430\u0437|fire|smoke|gas\s+leak)/i.test(text);
}

function isProtectedAccessBypassText(text: string): boolean {
  return /(\u0432\u0437\u043b\u043e\u043c|\u0432\u0441\u043a\u0440\u044b\u0442|\u043e\u0431\u043e\u0439\u0442\u0438|\u0441\u043b\u043e\u043c\u0430\u0442\u044c|hack|break\s+in|pick).{0,40}(\u0437\u0430\u043c\u043e\u043a|\u0434\u0432\u0435\u0440|\u0434\u043e\u043c\u043e\u0444\u043e\u043d|lock|door)/i.test(
    text,
  );
}

function isWaterLeakMaintenanceText(text: string): boolean {
  return /(\u043f\u043e\u0442\u0435\u043a|\u043f\u0440\u043e\u0442\u0435\u043a|\u0442\u0435\u0447|\u0437\u0430\u043b\u0438\u043b).{0,48}(\u0432\u043e\u0434|\u0440\u0430\u043a\u043e\u0432\u0438\u043d|\u043a\u0440\u0430\u043d|\u0442\u0440\u0443\u0431)|(\u0432\u043e\u0434|\u0440\u0430\u043a\u043e\u0432\u0438\u043d|\u043a\u0440\u0430\u043d|\u0442\u0440\u0443\u0431).{0,48}(\u043f\u043e\u0442\u0435\u043a|\u043f\u0440\u043e\u0442\u0435\u043a|\u0442\u0435\u0447|\u0437\u0430\u043b\u0438\u043b)|water\s+leak|leaking\s+(sink|tap|pipe)/i.test(
    text,
  );
}

function isNoiseComplaintText(text: string): boolean {
  return /(\u0441\u043e\u0441\u0435\u0434|\u0448\u0443\u043c|\u0433\u0440\u043e\u043c\u043a|\u0432\u0435\u0447\u0435\u0440\u0438\u043d\u043a|\u043c\u0443\u0437\u044b\u043a|\u043a\u0440\u0438\u043a|\u0441\u0432\u0435\u0440\u043b\u044f\u0442|neighbou?r|noise|loud|party|music|shouting)/i.test(
    text,
  );
}

function getMissingContext(
  intent: CommunicationAutopilotIntent,
  context: CommunicationAutopilotContext | undefined,
): string[] {
  switch (intent) {
    case 'check_in_access':
      return missingFields([
        ['object.address', context?.object?.address],
        ['object.accessInstructions', context?.object?.accessInstructions],
      ]);
    case 'address_instruction':
      return missingPropertyDirectionsContext(context);
    case 'wifi':
    case 'wifi_access':
      if (!context?.bookingVerified && !context?.booking?.id) return ['booking.verification'];
      return missingFields([
        ['object.wifiName', context?.object?.wifiName],
        ['object.wifiPassword', context?.object?.wifiPassword],
      ]);
    case 'wifi_problem':
      if (!hasPropertyObjectContext(context)) return ['object.id'];
      return [];
    case 'parking':
      return missingFields([['object.parkingText', context?.object?.parkingText]]);
    case 'waste_disposal_info':
      if (!hasPropertyObjectContext(context)) return ['object.id'];
      return missingFields([
        ['object.trashBinsLocation', context?.object?.trashBinsLocation ?? context?.object?.wasteDisposalText],
      ]);
    case 'checkout':
      return missingFields([['booking.checkoutTime', context?.booking?.checkoutTime]]);
    case 'baby_crib_request':
      if (!hasPropertyObjectContext(context)) return ['object.id'];
      return missingFields([
        ['object.babyCribNote', context?.object?.babyCribNote ?? context?.object?.babyCribAvailable],
      ]);
    case 'early_checkin_late_checkout':
      return missingFields([
        ['booking.earlyCheckInAvailable', context?.booking?.earlyCheckInAvailable],
        ['booking.lateCheckoutAvailable', context?.booking?.lateCheckoutAvailable],
      ]);
    case 'booking_lookup_missing_details':
    case 'checkin_code_request':
      return ['booking.lookup_details'];
    case 'booking_payment_support':
      return ['booking.lookup_details'];
    case 'cleaning_issue':
    case 'maintenance_issue':
      return missingOperationalContext(context);
    case 'urgent_access_problem':
      return missingOperationalContext(context);
    case 'unknown':
      return [];
  }
}

function missingPropertyDirectionsContext(context: CommunicationAutopilotContext | undefined): string[] {
  if (hasPropertyDirectionsContext(context)) {
    return [];
  }
  return ['object.address'];
}

function hasPropertyObjectContext(context: CommunicationAutopilotContext | undefined): boolean {
  return Boolean(context?.booking?.id || context?.object?.id || context?.object?.name || context?.object?.address);
}

function missingOperationalContext(context: CommunicationAutopilotContext | undefined): string[] {
  if (hasPropertyObjectContext(context)) {
    return [];
  }
  return ['object.id'];
}

function isOperationsIntent(
  intent: CommunicationAutopilotIntent,
): intent is 'cleaning_issue' | 'maintenance_issue' {
  return intent === 'cleaning_issue' || intent === 'maintenance_issue';
}

function composeRuReply(
  intent: Exclude<CommunicationAutopilotIntent, 'urgent_access_problem' | 'cleaning_issue' | 'maintenance_issue' | 'unknown'>,
  context: CommunicationAutopilotContext | undefined,
): string {
  switch (intent) {
    case 'check_in_access': {
      const parts = [
        `Адрес: ${context?.object?.address}.`,
        `Как попасть: ${context?.object?.accessInstructions}.`,
      ];

      if (context?.object?.accessCode) {
        parts.push(`Код доступа: ${context.object.accessCode}.`);
      }

      if (context?.booking?.checkInTime) {
        parts.push(`Заезд с ${context.booking.checkInTime}.`);
      }

      return parts.join(' ');
    }
    case 'address_instruction': {
      const grounded = composeGuestDirectionsReplyRu(
        context?.object
          ? {
              object_id: context.object.id ?? '',
              object_name: context.object.name ?? null,
              address: context.object.address ?? null,
              directions_text: context.object.directionsText ?? context.object.accessInstructions ?? null,
              parking_text: context.object.parkingText ?? null,
              trash_bins_location: context.object.trashBinsLocation ?? null,
              waste_disposal_text: context.object.wasteDisposalText ?? null,
              wifi_name: context.object.wifiName ?? null,
              wifi_password: context.object.wifiPassword ?? null,
              baby_crib_available: context.object.babyCribAvailable ?? null,
              baby_crib_note: context.object.babyCribNote ?? null,
              check_in_text: context.object.accessInstructions ?? null,
              checkout_time: context.booking?.checkoutTime ?? null,
              house_rules_text: context.object.houseRules ?? null,
              door_code_notes: null,
              knowledge_status: context.object.knowledgeStatus,
            }
          : null,
      );
      return grounded ?? resolvePropertyDirectionsReply(hasPropertyDirectionsContext(context));
    }
    case 'wifi':
    case 'wifi_access':
      return composeGuestWifiReplyRu({
        property: context?.object
          ? {
              object_id: context.object.id ?? '',
              object_name: context.object.name ?? null,
              address: context.object.address ?? null,
              directions_text: context.object.directionsText ?? null,
              parking_text: context.object.parkingText ?? null,
              trash_bins_location: context.object.trashBinsLocation ?? null,
              waste_disposal_text: context.object.wasteDisposalText ?? null,
              wifi_name: context.object.wifiName ?? null,
              wifi_password: context.object.wifiPassword ?? null,
              baby_crib_available: context.object.babyCribAvailable ?? null,
              baby_crib_note: context.object.babyCribNote ?? null,
              check_in_text: context.object.accessInstructions ?? null,
              checkout_time: context.booking?.checkoutTime ?? null,
              house_rules_text: context.object.houseRules ?? null,
              door_code_notes: null,
              knowledge_status: context.object.knowledgeStatus,
            }
          : null,
        verified: Boolean(context?.bookingVerified ?? context?.booking?.id),
      });
    case 'wifi_problem':
      return resolveWifiProblemPolicy({
        messageText: '',
        context,
      }).replyText;
    case 'parking': {
      const parking = composeGuestParkingReplyRu(
        context?.object
          ? {
              object_id: context.object.id ?? '',
              object_name: context.object.name ?? null,
              address: context.object.address ?? null,
              directions_text: context.object.directionsText ?? null,
              parking_text: context.object.parkingText ?? null,
              trash_bins_location: context.object.trashBinsLocation ?? null,
              waste_disposal_text: context.object.wasteDisposalText ?? null,
              wifi_name: context.object.wifiName ?? null,
              wifi_password: context.object.wifiPassword ?? null,
              baby_crib_available: context.object.babyCribAvailable ?? null,
              baby_crib_note: context.object.babyCribNote ?? null,
              check_in_text: context.object.accessInstructions ?? null,
              checkout_time: context.booking?.checkoutTime ?? null,
              house_rules_text: context.object.houseRules ?? null,
              door_code_notes: null,
              knowledge_status: context.object.knowledgeStatus,
            }
          : null,
      );
      return parking ?? buildGuestMissingContextReplyRu();
    }
    case 'waste_disposal_info': {
      const waste = composeGuestWasteReplyRu(
        context?.object
          ? {
              object_id: context.object.id ?? '',
              object_name: context.object.name ?? null,
              address: context.object.address ?? null,
              directions_text: context.object.directionsText ?? null,
              parking_text: context.object.parkingText ?? null,
              trash_bins_location: context.object.trashBinsLocation ?? null,
              waste_disposal_text: context.object.wasteDisposalText ?? null,
              wifi_name: context.object.wifiName ?? null,
              wifi_password: context.object.wifiPassword ?? null,
              baby_crib_available: context.object.babyCribAvailable ?? null,
              baby_crib_note: context.object.babyCribNote ?? null,
              check_in_text: context.object.accessInstructions ?? null,
              checkout_time: context.booking?.checkoutTime ?? null,
              house_rules_text: context.object.houseRules ?? null,
              door_code_notes: null,
              knowledge_status: context.object.knowledgeStatus,
            }
          : null,
      );
      return waste ?? 'Сейчас не вижу точной информации по этому вопросу для вашего объекта. Уточню и вернусь с ответом.';
    }
    case 'baby_crib_request': {
      const babyCrib = composeGuestBabyCribReplyRu(
        context?.object
          ? {
              object_id: context.object.id ?? '',
              object_name: context.object.name ?? null,
              address: context.object.address ?? null,
              directions_text: context.object.directionsText ?? null,
              parking_text: context.object.parkingText ?? null,
              trash_bins_location: context.object.trashBinsLocation ?? null,
              waste_disposal_text: context.object.wasteDisposalText ?? null,
              wifi_name: context.object.wifiName ?? null,
              wifi_password: context.object.wifiPassword ?? null,
              baby_crib_available: context.object.babyCribAvailable ?? null,
              baby_crib_note: context.object.babyCribNote ?? null,
              check_in_text: context.object.accessInstructions ?? null,
              checkout_time: context.booking?.checkoutTime ?? null,
              house_rules_text: context.object.houseRules ?? null,
              door_code_notes: null,
              knowledge_status: context.object.knowledgeStatus,
            }
          : null,
      );
      return babyCrib ?? 'Сейчас не вижу точной информации по этому вопросу для вашего объекта. Уточню и вернусь с ответом.';
    }
    case 'checkout': {
      const checkout = composeGuestCheckoutReplyRu(
        context?.object
          ? {
              object_id: context.object.id ?? '',
              object_name: context.object.name ?? null,
              address: context.object.address ?? null,
              directions_text: context.object.directionsText ?? null,
              parking_text: context.object.parkingText ?? null,
              trash_bins_location: context.object.trashBinsLocation ?? null,
              waste_disposal_text: context.object.wasteDisposalText ?? null,
              wifi_name: context.object.wifiName ?? null,
              wifi_password: context.object.wifiPassword ?? null,
              baby_crib_available: context.object.babyCribAvailable ?? null,
              baby_crib_note: context.object.babyCribNote ?? null,
              check_in_text: context.object.accessInstructions ?? null,
              checkout_time: context.booking?.checkoutTime ?? null,
              house_rules_text: context.object.houseRules ?? null,
              door_code_notes: null,
              knowledge_status: context.object.knowledgeStatus,
            }
          : null,
      );
      return checkout ?? `Выезд до ${context?.booking?.checkoutTime}. Ключи оставьте по инструкции из заселения.`;
    }
    case 'early_checkin_late_checkout': {
      const early = context?.booking?.earlyCheckInAvailable
        ? 'Ранний заезд сейчас возможен.'
        : 'Ранний заезд сейчас не подтвержден.';
      const late = context?.booking?.lateCheckoutAvailable
        ? 'Поздний выезд сейчас возможен.'
        : 'Поздний выезд сейчас не подтвержден.';

      return `${early} ${late} Если планы изменятся, напишите - проверим еще раз.`;
    }
    case 'booking_lookup_missing_details':
    case 'checkin_code_request':
      return 'Напишите, пожалуйста, телефон или имя гостя, дату заезда и объект - найдем бронь.';
  }
  return 'Понял вопрос по брони или оплате. Пришлите номер брони, имя гостя или телефон в брони.';
}

function composeRuOperationsReply(intent: 'cleaning_issue' | 'maintenance_issue'): string {
  if (intent === 'cleaning_issue') {
    return 'Принял, вопрос по уборке зарегистрирован. Передаю команде.';
  }
  return 'Принял, поломку зарегистрировал. Передаю команде.';
}

function buildMetadata(input: {
  channel: CommunicationAutopilotChannel;
  context: CommunicationAutopilotContext | undefined;
  intent: CommunicationAutopilotIntent;
  matchedSignals: string[];
  missingContext: string[];
}): CommunicationAutopilotMetadata {
  return {
    intent: input.intent,
    matchedSignals: input.matchedSignals,
    missingContext: input.missingContext,
    contextKeys: collectContextKeys(input.context),
    channelMode: CHANNEL_MODE[input.channel],
    urgent: input.intent === 'urgent_access_problem',
    operationsAction: buildOperationsAction(input.intent, input.matchedSignals),
    policy: 'deterministic_mvp_v1',
  };
}

function shouldUseLlmRouterFallback(
  channel: CommunicationAutopilotChannel,
  text: string,
  decision: CommunicationAutopilotDecision,
): boolean {
  if (channel !== 'telegram') return false;
  if (!text.trim()) return false;
  if (decision.metadata.intent === 'address_instruction') return false;
  if (decision.metadata.matchedSignals.some((signal) => signal === 'property_directions' || signal === 'route_to_property')) {
    return false;
  }
  if (decision.metadata.intent === 'unknown' && isNoiseComplaintText(text) && decision.replyText) return false;
  if (decision.metadata.intent === 'unknown') return true;
  if (decision.confidence < 0.7) return true;
  return decision.metadata.matchedSignals.length === 0 && text.trim().length > 80;
}

function withLlmRouterMetadata(
  decision: CommunicationAutopilotDecision,
  marker: Omit<NonNullable<CommunicationAutopilotMetadata['llmRouter']>, 'used'>,
): CommunicationAutopilotDecision {
  return {
    ...decision,
    metadata: {
      ...decision.metadata,
      policy: 'deterministic_mvp_v1_llm_router_fallback',
      llmRouter: {
        used: true,
        ...marker,
      },
    },
  };
}

function buildSafeClarificationDecision(base: CommunicationAutopilotDecision): CommunicationAutopilotDecision {
  return {
    ...base,
    action: 'needs_context',
    confidence: Math.min(base.confidence, 0.69),
    replyText: safeLlmRouterFallbackReply(),
    escalationReason: undefined,
    metadata: {
      ...base.metadata,
      intent: 'unknown',
      missingContext: [],
      urgent: false,
      operationsAction: undefined,
    },
  };
}

function mapLlmRouterDecisionToAutopilotDecision(
  base: CommunicationAutopilotDecision,
  decision: LlmRouterDecision,
  provider: string,
  modelName?: string,
  attempts?: LlmRouterAttemptAudit[],
): CommunicationAutopilotDecision {
  const marker = {
    provider,
    modelName,
    intent: decision.intent,
    validation: 'accepted' as const,
    attempts,
  };

  if (
    base.metadata.intent === 'address_instruction' ||
    base.metadata.intent === 'urgent_access_problem' ||
    base.metadata.matchedSignals.includes('property_directions')
  ) {
    return withLlmRouterMetadata(base, marker);
  }

  if (decision.intent === 'checkin_info_request') {
    return withLlmRouterMetadata(
      {
        ...base,
        action: 'needs_context',
        confidence: decision.confidence,
        replyText: CHECKIN_READINESS_ACCESS_REPLY,
        escalationReason: undefined,
        metadata: {
          ...base.metadata,
          intent: 'check_in_access',
          matchedSignals: ['llm_router', decision.intent],
          missingContext: base.metadata.missingContext,
          urgent: false,
          operationsAction: {
            category: 'operator_access_support',
            priority: 'normal',
            title: 'Communication autopilot: check-in readiness and access',
            shortReason: 'check_in_access',
          },
        },
      },
      marker,
    );
  }

  if (decision.intent === 'checkin_code_request') {
    return withLlmRouterMetadata(
      {
        ...base,
        action: 'needs_context',
        confidence: decision.confidence,
        replyText: safeCheckinCodeRequestReply(),
        escalationReason: undefined,
        metadata: {
          ...base.metadata,
          intent: 'checkin_code_request',
          matchedSignals: ['llm_router', decision.intent],
          missingContext: ['booking.lookup_details'],
          urgent: false,
          operationsAction: undefined,
        },
      },
      marker,
    );
  }

  if (decision.intent === 'access_problem' && decision.shouldEscalate && decision.actionType === 'access_support') {
    return withLlmRouterMetadata(
      {
        ...base,
        action: 'escalate',
        confidence: decision.confidence,
        replyText:
          'Понял, это срочно. Уже передаю оператору по доступу. В целях безопасности код двери отправим только после проверки брони.',
        escalationReason: 'urgent_access_problem',
        metadata: {
          ...base.metadata,
          intent: 'urgent_access_problem',
          matchedSignals: ['llm_router', decision.intent],
          urgent: true,
          operationsAction: {
            category: 'operator_access_support',
            priority: 'high',
            title: 'Communication autopilot: urgent access support',
            shortReason: 'urgent_access_problem',
          },
        },
      },
      marker,
    );
  }

  if (decision.intent === 'booking_lookup') {
    return withLlmRouterMetadata(
      {
        ...base,
        action: 'needs_context',
        confidence: decision.confidence,
        replyText: 'Напишите, пожалуйста, телефон или имя гостя, дату заезда и объект - найдем бронь.',
        escalationReason: undefined,
        metadata: {
          ...base.metadata,
          intent: 'booking_lookup_missing_details',
          matchedSignals: ['llm_router', decision.intent],
          missingContext: ['booking.lookup_details'],
          urgent: false,
          operationsAction: undefined,
        },
      },
      marker,
    );
  }

  if (decision.intent === 'cleaning_issue') {
    return withLlmRouterMetadata(
      {
        ...base,
        action: 'needs_context',
        confidence: decision.confidence,
        replyText: 'Принял, вопрос по уборке зарегистрирован. Напишите, пожалуйста, объект или номер брони.',
        escalationReason: undefined,
        metadata: {
          ...base.metadata,
          intent: 'cleaning_issue',
          matchedSignals: ['llm_router', decision.intent],
          missingContext: base.metadata.missingContext,
          urgent: false,
          operationsAction: {
            category: 'cleaning',
            priority: 'normal',
            title: 'Communication autopilot: cleaning issue',
            shortReason: 'cleaning_issue',
          },
        },
      },
      marker,
    );
  }

  return withLlmRouterMetadata(buildSafeClarificationDecision(base), marker);
}

function detectsMisunderstanding(text: string): boolean {
  return /(ты\s+не\s+понял|вы\s+не\s+поняли|я\s+уже\s+сказал|я\s+уже\s+сказала|нет\s+не\s+это|я\s+про\s+другое|при\s+ч[её]м\s+тут\s+уборка|мне\s+нужен\s+код|я\s+спрашиваю\s+про\s+бронь)/i.test(
    text.toLocaleLowerCase('ru-RU'),
  );
}

function buildOperationsAction(
  intent: CommunicationAutopilotIntent,
  matchedSignals: string[] = [],
): CommunicationAutopilotOperationsAction | undefined {
  if (
    intent === 'check_in_access' &&
    matchedSignals.some((signal) => signal === 'checkin_readiness_access' || signal.includes('checkin_readiness'))
  ) {
    return {
      category: 'operator_access_support',
      priority: 'normal',
      title: 'Communication autopilot: check-in readiness and access',
      shortReason: 'check_in_access',
    };
  }

  switch (intent) {
    case 'urgent_access_problem':
      if (matchedSignals.includes('safety_emergency')) {
        return {
          category: 'operator_access_support',
          priority: 'high',
          title: 'Communication autopilot: safety emergency',
          shortReason: 'safety_emergency',
        };
      }
      return {
        category: 'operator_access_support',
        priority: 'high',
        title: 'Communication autopilot: urgent access support',
        shortReason: 'urgent_access_problem',
      };
    case 'cleaning_issue':
      return {
        category: 'cleaning',
        priority: 'normal',
        title: 'Communication autopilot: cleaning issue',
        shortReason: 'cleaning_issue',
      };
    case 'maintenance_issue':
      return {
        category: 'maintenance',
        priority: 'normal',
        title: 'Communication autopilot: maintenance issue',
        shortReason: 'maintenance_issue',
      };
    default:
      return undefined;
  }
}

function collectContextKeys(context: CommunicationAutopilotContext | undefined): string[] {
  if (!context) {
    return [];
  }

  const keys: string[] = [];

  for (const scope of ['session', 'booking', 'object'] as const) {
    const value = context[scope];

    if (!value) {
      continue;
    }

    for (const key of Object.keys(value)) {
      keys.push(`${scope}.${key}`);
    }
  }

  if (context.bookingVerified !== undefined) keys.push('bookingVerified');
  if (context.propertyResolved !== undefined) keys.push('propertyResolved');

  return keys;
}

function missingFields(fields: Array<[string, unknown]>): string[] {
  return fields
    .filter(([, value]) => value === undefined || value === null || value === '')
    .map(([key]) => key);
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}
