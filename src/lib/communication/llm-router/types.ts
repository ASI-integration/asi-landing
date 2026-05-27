export const LLM_ROUTER_INTENTS = [
  'checkin_code_request',
  'checkin_info_request',
  'access_problem',
  'cleaning_issue',
  'booking_lookup',
  'general_question',
  'unknown',
] as const;

export type LlmRouterIntent = (typeof LLM_ROUTER_INTENTS)[number];

export const LLM_ROUTER_ACTION_TYPES = [
  'access_support',
  'booking_lookup',
  'guest_reply_only',
  'operator_escalation',
  'none',
] as const;

export type LlmRouterActionType = (typeof LLM_ROUTER_ACTION_TYPES)[number];

export type LlmRouterSlots = {
  bookingNumber: string | null;
  phone: string | null;
  propertyName: string | null;
  date: string | null;
};

export type LlmRouterDecision = {
  intent: LlmRouterIntent;
  confidence: number;
  slots: LlmRouterSlots;
  needsBookingDetails: boolean;
  actionType: LlmRouterActionType;
  shouldEscalate: boolean;
  reply: string;
};

export type LlmRouterInput = {
  messageText: string;
  lang: 'ru' | 'en' | string;
  bookingId?: string;
  conversationId?: string;
  sessionId?: string;
  chatId?: string;
  canonIntent?: string;
  canonConfidence?: number;
  recentMessages?: Array<{
    direction: 'inbound' | 'outbound';
    content: string;
  }>;
  forceStrongerProvider?: boolean;
};

export type LlmRouterProviderName = 'deepseek' | 'openai' | 'openai-premium' | 'disabled';

export type LlmRouterProvider = {
  readonly name: LlmRouterProviderName;
  readonly modelName?: string;
  classifyGuestMessage(input: LlmRouterInput): Promise<LlmRouterDecision>;
};

export type LlmRouterAttemptAudit = {
  marker:
    | 'LLM_ROUTER_PRIMARY_USED'
    | 'LLM_ROUTER_PRIMARY_FAILED'
    | 'LLM_ROUTER_SECONDARY_USED'
    | 'LLM_ROUTER_PREMIUM_USED'
    | 'LLM_ROUTER_VALIDATION_FAILED'
    | 'LLM_ROUTER_SAFE_FALLBACK_USED'
    | 'LLM_ROUTER_STICKY_PROVIDER_SET'
    | 'LLM_ROUTER_STICKY_PROVIDER_USED';
  provider: LlmRouterProviderName;
  modelName?: string;
  latencyMs?: number;
  failureReason?: string;
  normalizedIntent?: string;
  confidence?: number;
  validation: 'accepted' | 'rejected' | 'provider_failed' | 'low_confidence' | 'skipped';
  fallbackPath?: string;
  finalActionType?: string;
  finalShouldEscalate?: boolean;
};

export type LlmRouterChainResult =
  | {
      ok: true;
      decision: LlmRouterDecision;
      provider: LlmRouterProviderName;
      modelName?: string;
      attempts: LlmRouterAttemptAudit[];
    }
  | {
      ok: false;
      reason: string;
      attempts: LlmRouterAttemptAudit[];
    };

export type LlmRouterValidationResult =
  | { ok: true; decision: LlmRouterDecision }
  | { ok: false; reason: string };
