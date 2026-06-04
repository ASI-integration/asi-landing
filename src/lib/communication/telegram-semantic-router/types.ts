export const TELEGRAM_SEMANTIC_ROUTER_INTENTS = [
  'wifi_access',
  'wifi_problem',
  'waste_disposal_info',
  'cleaning_issue',
  'maintenance_issue',
  'check_in_access',
  'checkin_code_request',
  'urgent_access_problem',
  'property_directions',
  'parking',
  'baby_crib_request',
  'checkout',
  'early_checkin_late_checkout',
  'booking_lookup_missing_details',
  'booking_payment_support',
  'general_question',
  'unknown',
] as const;

export type TelegramSemanticRouterIntent = (typeof TELEGRAM_SEMANTIC_ROUTER_INTENTS)[number];

export const TELEGRAM_SEMANTIC_TOPICS = [
  'wifi',
  'waste',
  'cleaning',
  'access',
  'directions',
  'parking',
  'booking',
  'checkout',
  'maintenance',
  'household',
  'general',
] as const;

export type TelegramSemanticTopic = (typeof TELEGRAM_SEMANTIC_TOPICS)[number];

export type TelegramSemanticRouterSlots = {
  problem_type: string | null;
};

export type TelegramSemanticRouterResult = {
  intent: TelegramSemanticRouterIntent;
  confidence: number;
  topic: TelegramSemanticTopic;
  is_problem: boolean;
  needs_booking_context: boolean;
  requested_secret: boolean;
  knowledge_keys: string[];
  slots: TelegramSemanticRouterSlots;
  guest_safe_summary: string;
  source: 'llm' | 'deterministic';
};

export type TelegramSemanticRouterInput = {
  messageText: string;
  lang?: 'ru' | 'en' | string;
  bookingId?: string;
  sessionId?: string;
  canonIntent?: string;
  canonConfidence?: number;
  deterministicIntent?: string;
  recentMessages?: Array<{
    direction: 'inbound' | 'outbound';
    content: string;
  }>;
};

export type TelegramSemanticRouterProviderName = 'openai' | 'deepseek' | 'disabled';

export type TelegramSemanticRouterProvider = {
  readonly name: TelegramSemanticRouterProviderName;
  readonly modelName?: string;
  classify(input: TelegramSemanticRouterInput): Promise<TelegramSemanticRouterResult>;
};

export type TelegramSemanticRouterChainResult =
  | { ok: true; result: TelegramSemanticRouterResult; provider: TelegramSemanticRouterProviderName; modelName?: string }
  | { ok: false; reason: string; fallback: TelegramSemanticRouterResult };
