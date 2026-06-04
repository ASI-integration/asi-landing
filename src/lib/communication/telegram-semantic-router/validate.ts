import {
  TELEGRAM_SEMANTIC_ROUTER_INTENTS,
  TELEGRAM_SEMANTIC_TOPICS,
  type TelegramSemanticRouterResult,
  type TelegramSemanticRouterSlots,
} from './types';

const ALLOWED_KNOWLEDGE_KEYS = new Set([
  'wifi_name',
  'wifi_password',
  'wifi_instruction_text',
  'trash_bins_location',
  'waste_disposal_text',
  'address',
  'directions_text',
  'parking_text',
  'check_in_text',
  'door_code_notes',
  'baby_crib_note',
  'baby_crib_available',
  'checkout_time',
  'house_rules_text',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function rejectsUnsafeSummary(summary: string): boolean {
  const text = summary.toLocaleLowerCase('ru-RU');
  return [
    /парол[ья]?\s*[:=]/,
    /\b\d{6,}\b/,
    /https?:\/\//,
    /код\s+доступа\s*[:=]/,
    /deepseek|openai|llm|prompt|промпт/,
  ].some((pattern) => pattern.test(text));
}

export function parseTelegramSemanticRouterJson(raw: string): unknown {
  return JSON.parse(raw);
}

export type TelegramSemanticRouterValidationResult =
  | { ok: true; result: TelegramSemanticRouterResult }
  | { ok: false; reason: string };

export function validateTelegramSemanticRouterResult(
  value: unknown,
  source: 'llm' | 'deterministic' = 'llm',
): TelegramSemanticRouterValidationResult {
  if (!isObject(value)) return { ok: false, reason: 'not_object' };

  const intent = value.intent;
  if (typeof intent !== 'string' || !TELEGRAM_SEMANTIC_ROUTER_INTENTS.includes(intent as any)) {
    return { ok: false, reason: 'invalid_intent' };
  }

  const confidence = value.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, reason: 'invalid_confidence' };
  }

  const topic = value.topic;
  if (typeof topic !== 'string' || !TELEGRAM_SEMANTIC_TOPICS.includes(topic as any)) {
    return { ok: false, reason: 'invalid_topic' };
  }

  if (typeof value.is_problem !== 'boolean' || typeof value.needs_booking_context !== 'boolean') {
    return { ok: false, reason: 'invalid_flags' };
  }
  if (typeof value.requested_secret !== 'boolean') {
    return { ok: false, reason: 'invalid_requested_secret' };
  }

  if (!Array.isArray(value.knowledge_keys)) return { ok: false, reason: 'invalid_knowledge_keys' };
  const knowledge_keys = value.knowledge_keys
    .filter((key): key is string => typeof key === 'string')
    .map((key) => key.trim())
    .filter((key) => key.length > 0 && ALLOWED_KNOWLEDGE_KEYS.has(key))
    .slice(0, 8);

  const slotsRaw = isObject(value.slots) ? value.slots : {};
  const problem_type =
    slotsRaw.problem_type === null
      ? null
      : typeof slotsRaw.problem_type === 'string'
        ? slotsRaw.problem_type.slice(0, 80)
        : undefined;
  if (problem_type === undefined) return { ok: false, reason: 'invalid_slots' };
  const slots: TelegramSemanticRouterSlots = { problem_type };

  if (typeof value.guest_safe_summary !== 'string' || value.guest_safe_summary.trim().length === 0) {
    return { ok: false, reason: 'invalid_summary' };
  }
  const guest_safe_summary = value.guest_safe_summary.trim().slice(0, 240);
  if (rejectsUnsafeSummary(guest_safe_summary)) return { ok: false, reason: 'unsafe_summary' };

  if (intent === 'wifi_access' && value.is_problem) return { ok: false, reason: 'wifi_access_marked_problem' };
  if (intent === 'wifi_problem' && !value.is_problem) return { ok: false, reason: 'wifi_problem_not_marked_problem' };
  if (intent === 'waste_disposal_info' && value.is_problem) return { ok: false, reason: 'waste_marked_problem' };
  if (intent === 'cleaning_issue' && !value.is_problem) return { ok: false, reason: 'cleaning_not_marked_problem' };

  return {
    ok: true,
    result: {
      intent: intent as TelegramSemanticRouterResult['intent'],
      confidence,
      topic: topic as TelegramSemanticRouterResult['topic'],
      is_problem: value.is_problem,
      needs_booking_context: value.needs_booking_context,
      requested_secret: value.requested_secret,
      knowledge_keys,
      slots,
      guest_safe_summary,
      source,
    },
  };
}
