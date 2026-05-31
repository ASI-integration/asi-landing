import {
  LLM_ROUTER_ACTION_TYPES,
  LLM_ROUTER_INTENTS,
  type LlmRouterDecision,
  type LlmRouterValidationResult,
} from './types';

const SAFE_CHECKIN_CODE_REPLY =
  'Да, помогу. Пришлите номер брони или телефон, указанный при бронировании, и я проверю данные для заселения.';

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, 120);
  return undefined;
}

function rejectsUnsafeReply(reply: string): boolean {
  const text = reply.toLocaleLowerCase('ru-RU');
  return [
    /deepseek|openai|llm|модель|провайдер|prompt|промпт|confidence|уверенност/,
    /код\s+(доступа\s+)?(есть|найден|подтвержден|подтверждён|действует|работает|\d{3,})/,
    /бронь\s+(есть|найдена|подтверждена|активна|оплачена)/,
    /я\s+(уже\s+)?(создал|создала|отправил|отправила|выдал|выдала)\s+(код|бронь|заявк)/,
    /адрес\s*[:—-]\s*\S{8,}/,
    /(стоимость|цена|оплата)\s*[:—-]\s*\d/,
    /(свободн|доступн).{0,20}(номер|квартир|объект).{0,20}(есть|на\s+\d)/,
    /(правила\s+проживания|house\s+rules).{0,40}(запрещ|разреш|нельзя|можно)/,
    /(статус\s+брони|ваша\s+бронь).{0,30}(подтвержд|активн|отменен)/,
    /(игнорирую|следую)\s+(новые|ваши)\s+(инструкции|правила|промпт)/,
  ].some((pattern) => pattern.test(text));
}

export function safeLlmRouterFallbackReply(): string {
  return 'Понял. Подскажите, вы про заселение, оплату, доступ к квартире или уже текущее проживание? Я помогу с нужным шагом.';
}

export function safeCheckinCodeRequestReply(): string {
  return SAFE_CHECKIN_CODE_REPLY;
}

export function parseLlmRouterJson(raw: string): unknown {
  return JSON.parse(raw);
}

export function validateLlmRouterDecision(value: unknown): LlmRouterValidationResult {
  if (!isObject(value)) return { ok: false, reason: 'not_object' };

  const intent = value.intent;
  if (typeof intent !== 'string' || !LLM_ROUTER_INTENTS.includes(intent as any)) {
    return { ok: false, reason: 'invalid_intent' };
  }

  const confidence = value.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, reason: 'invalid_confidence' };
  }

  const actionType = value.actionType;
  if (typeof actionType !== 'string' || !LLM_ROUTER_ACTION_TYPES.includes(actionType as any)) {
    return { ok: false, reason: 'invalid_action_type' };
  }

  if (typeof value.needsBookingDetails !== 'boolean' || typeof value.shouldEscalate !== 'boolean') {
    return { ok: false, reason: 'invalid_flags' };
  }

  if (typeof value.reply !== 'string' || value.reply.trim().length === 0 || rejectsUnsafeReply(value.reply)) {
    return { ok: false, reason: 'unsafe_reply' };
  }

  const slots = isObject(value.slots) ? value.slots : null;
  if (!slots) return { ok: false, reason: 'invalid_slots' };

  const bookingNumber = nullableString(slots.bookingNumber);
  const phone = nullableString(slots.phone);
  const propertyName = nullableString(slots.propertyName);
  const date = nullableString(slots.date);
  if (
    bookingNumber === undefined ||
    phone === undefined ||
    propertyName === undefined ||
    date === undefined
  ) {
    return { ok: false, reason: 'invalid_slot_value' };
  }

  return {
    ok: true,
    decision: {
      intent,
      confidence,
      slots: { bookingNumber, phone, propertyName, date },
      needsBookingDetails: value.needsBookingDetails,
      actionType,
      shouldEscalate: value.shouldEscalate,
      reply: value.reply.trim(),
    } as LlmRouterDecision,
  };
}
