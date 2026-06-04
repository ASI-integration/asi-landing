import type { TelegramSemanticRouterResult } from './types';

export type SemanticMappedAutopilotIntent =
  | 'check_in_access'
  | 'address_instruction'
  | 'wifi_access'
  | 'wifi_problem'
  | 'wifi'
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

export type SemanticAutopilotClassification = {
  intent: SemanticMappedAutopilotIntent;
  confidence: number;
  matchedSignals: string[];
  topic: string;
  knowledgeKeys: string[];
  guestSafeSummary: string;
  semanticSource: 'llm' | 'deterministic';
};

export function mapSemanticRouterToAutopilotIntent(
  semantic: TelegramSemanticRouterResult,
): SemanticAutopilotClassification {
  const matchedSignals = [
    'telegram_semantic_router_v1',
    semantic.source,
    semantic.intent,
    semantic.topic,
    ...(semantic.knowledge_keys.length ? [`knowledge:${semantic.knowledge_keys.join(',')}`] : []),
  ];

  const intent = mapIntent(semantic.intent);
  return {
    intent,
    confidence: semantic.confidence,
    matchedSignals,
    topic: semantic.topic,
    knowledgeKeys: semantic.knowledge_keys,
    guestSafeSummary: semantic.guest_safe_summary,
    semanticSource: semantic.source,
  };
}

function mapIntent(intent: TelegramSemanticRouterResult['intent']): SemanticMappedAutopilotIntent {
  switch (intent) {
    case 'wifi_access':
      return 'wifi_access';
    case 'wifi_problem':
      return 'wifi_problem';
    case 'waste_disposal_info':
      return 'waste_disposal_info';
    case 'cleaning_issue':
      return 'cleaning_issue';
    case 'maintenance_issue':
      return 'maintenance_issue';
    case 'check_in_access':
      return 'check_in_access';
    case 'checkin_code_request':
      return 'checkin_code_request';
    case 'urgent_access_problem':
      return 'urgent_access_problem';
    case 'property_directions':
      return 'address_instruction';
    case 'parking':
      return 'parking';
    case 'baby_crib_request':
      return 'baby_crib_request';
    case 'checkout':
      return 'checkout';
    case 'early_checkin_late_checkout':
      return 'early_checkin_late_checkout';
    case 'booking_lookup_missing_details':
      return 'booking_lookup_missing_details';
    case 'booking_payment_support':
      return 'booking_payment_support';
    case 'general_question':
    case 'unknown':
    default:
      return 'unknown';
  }
}
