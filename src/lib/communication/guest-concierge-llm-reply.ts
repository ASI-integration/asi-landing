import { callLLM } from '@/lib/openai';
import {
  guestReplyContainsForbiddenInternalTokens,
  hasGuestFacingEnglish,
  sanitizeGuestFacingReply,
} from './guest-facing-ru';
import {
  composeGuestConciergeOperatingReply,
  type GuestConciergeClassification,
  type GuestConciergeDomain,
  type GuestConciergeReplyContext,
  type GuestConciergeSituationKind,
} from './guest-concierge-operating-domain';
import type { TelegramPropertyObjectV1 } from './telegram-booking-object-memory';

/** Домены, для которых разрешён живой LLM-ответ внутри Operating Domain. */
export const GUEST_CONCIERGE_LLM_ALLOWED_DOMAINS: readonly GuestConciergeDomain[] = [
  'nearby_area',
  'weather_local_plans',
  'wifi_tech',
  'property_appliances',
  'maintenance_issue',
  'check_in_access',
  'check_out',
  'booking_stay',
  'house_rules',
  'off_topic_safe',
] as const;

/** Домены с коротким детерминированным ответом без свободного LLM. */
export const GUEST_CONCIERGE_LLM_PROTECTED_DOMAINS: readonly GuestConciergeDomain[] = [
  'safety_emergency',
  'disallowed_or_sensitive',
] as const;

const INVENTED_VENUE_RE =
  /Тануки|Шоколадница|Му-Му|Якитория|Хачапури|Додо|Вкусно и точка|Starbucks|McDonald/i;

const DOMAIN_LABELS_RU: Record<GuestConciergeDomain, string> = {
  check_in_access: 'заезд и доступ',
  check_out: 'выезд',
  booking_stay: 'бронирование и проживание',
  house_rules: 'правила проживания',
  property_appliances: 'техника и быт в объекте',
  wifi_tech: 'Wi-Fi и техника',
  maintenance_issue: 'проблема в объекте',
  nearby_area: 'район и места рядом',
  weather_local_plans: 'погода и планы рядом с объектом',
  safety_emergency: 'срочная опасность',
  off_topic_safe: 'вне темы проживания (мягкий возврат)',
  disallowed_or_sensitive: 'запрещённый запрос',
};

const SITUATION_LABELS_RU: Record<GuestConciergeSituationKind, string> = {
  informational_question: 'информационный вопрос',
  household_recommendation: 'бытовая рекомендация',
  problem_or_breakdown: 'проблема или поломка',
  urgent_danger: 'срочная опасность',
  off_topic_safe: 'вне темы проживания',
  disallowed_or_sensitive: 'запрещённый запрос',
  unclear_message: 'неясное сообщение',
};

export type GuestConciergeLlmInput = {
  classification: GuestConciergeClassification;
  context: GuestConciergeReplyContext;
  messageText: string;
};

export type GuestConciergeLlmProvider = {
  composeReply(input: GuestConciergeLlmInput): Promise<string | null>;
};

export type GuestConciergeReplySource = 'llm' | 'deterministic';

export function isGuestConciergeLlmAllowedDomain(domain: GuestConciergeDomain): boolean {
  return (GUEST_CONCIERGE_LLM_ALLOWED_DOMAINS as readonly string[]).includes(domain);
}

export function isGuestConciergeLlmProtectedDomain(domain: GuestConciergeDomain): boolean {
  return (GUEST_CONCIERGE_LLM_PROTECTED_DOMAINS as readonly string[]).includes(domain);
}

export function isGuestConciergeLlmEnabled(): boolean {
  return process.env.GUEST_CONCIERGE_LLM_ENABLED === 'true';
}

export function guestConciergeLlmSystemPrompt(): string {
  return (
    'Ты AI-консьерж объекта краткосрочной аренды. Отвечай гостю живым, спокойным, человеческим русским языком. ' +
    'Помогай только по вопросам проживания, объекта, района, быта, техники, правил, заезда, выезда, безопасности и бытовых рекомендаций. ' +
    'Используй только переданные данные объекта. Не выдумывай названия заведений, адреса, телефоны, коды, правила, обещания, компенсации, сроки ремонта. ' +
    'Если точных данных нет, честно скажи это и дай полезный следующий шаг. ' +
    'При проблемах помоги гостю и обозначь, что ситуация передана оператору, только если в запросе явно указано, что эскалация создана. ' +
    'Обычно пиши 1–2 коротких абзаца. Без канцелярита, без англоязычных фраз, без фальшивой дружелюбности. ' +
    'Не превращай ответ в длинную инструкцию, кроме срочных случаев. ' +
    'Верни только готовый текст ответа гостю, без пояснений и служебных пометок.'
  );
}

function conciergeLlmModelName(): string {
  return (
    process.env.GUEST_CONCIERGE_LLM_MODEL?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    'gpt-4o-mini'
  );
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function buildPropertyPassportForLlm(
  context: GuestConciergeReplyContext,
  includeSensitive: boolean,
): string {
  const property = context.property;
  const lines: string[] = [];

  const push = (label: string, value: unknown) => {
    const text = textOrNull(value);
    if (text) lines.push(`${label}: ${text}`);
  };

  push('Название объекта', property?.object_name);
  push('Адрес', context.addressHint ?? property?.address);
  push('Как добраться', property?.directions_text);
  push('Заезд', property?.check_in_text);
  push('Выезд до', property?.checkout_time);
  push('Парковка', property?.parking_text);
  push('Правила проживания', property?.house_rules_text);
  push('Мусор', property?.trash_bins_location ?? property?.waste_disposal_text);

  if (includeSensitive) {
    push('Сеть Wi-Fi', property?.wifi_name);
    push('Пароль Wi-Fi', property?.wifi_password);
    push('Данные доступа', property?.door_code_notes);
  }

  if (!lines.length) {
    return 'Данные объекта: пока не переданы.';
  }
  return `Данные объекта:\n${lines.join('\n')}`;
}

export function buildGuestConciergeLlmUserMessage(input: GuestConciergeLlmInput): string {
  const { classification, context, messageText } = input;
  const domainLabel = DOMAIN_LABELS_RU[classification.domain] ?? classification.domain;
  const situationLabel = SITUATION_LABELS_RU[classification.situation] ?? classification.situation;
  const subtypeParts: string[] = [];
  if (classification.nearbySubtype) subtypeParts.push(`подтип района: ${classification.nearbySubtype}`);
  if (classification.maintenanceSubtype) subtypeParts.push(`подтип проблемы: ${classification.maintenanceSubtype}`);

  const escalationNote = classification.needsEscalation
    ? 'Эскалация оператору: да — можно коротко сообщить гостю, что вопрос передан оператору.'
    : 'Эскалация оператору: нет — не обещай связь с оператором.';

  const includeSensitive =
    classification.domain === 'wifi_tech' ||
    classification.domain === 'check_in_access' ||
    classification.maintenanceSubtype === 'wifi' ||
    classification.maintenanceSubtype === 'access_door';

  return [
    `Домен: ${domainLabel}`,
    `Тип ситуации: ${situationLabel}`,
    ...subtypeParts,
    escalationNote,
    buildPropertyPassportForLlm(context, includeSensitive),
    `Сообщение гостя:\n${messageText.trim() || '(пустое сообщение)'}`,
  ].join('\n');
}

function rejectsGuestConciergeLlmReply(
  polished: string,
  draft: string,
  classification: GuestConciergeClassification,
): boolean {
  const trimmed = polished.trim();
  if (!trimmed || trimmed.length > 700) return true;
  if (guestReplyContainsForbiddenInternalTokens(trimmed)) return true;
  if (hasGuestFacingEnglish(trimmed)) return true;
  if (INVENTED_VENUE_RE.test(trimmed)) return true;

  const lower = trimmed.toLocaleLowerCase('ru-RU');
  if (/deepseek|openai|llm|модель|провайдер|prompt|промпт|confidence|debug/.test(lower)) {
    return true;
  }

  if (classification.domain === 'disallowed_or_sensitive' || classification.domain === 'safety_emergency') {
    return true;
  }

  const draftLen = draft.trim().length;
  if (draftLen > 0 && trimmed.length > Math.max(draftLen * 2.8, 420)) {
    return true;
  }

  return false;
}

async function callDefaultConciergeLlmProvider(input: GuestConciergeLlmInput): Promise<string | null> {
  return callLLM({
    model: conciergeLlmModelName(),
    systemPrompt: guestConciergeLlmSystemPrompt(),
    userMessage: buildGuestConciergeLlmUserMessage(input),
  });
}

/**
 * Слой LLM поверх Operating Domain: классификация уже выполнена, здесь только живой текст.
 * При недоступности LLM или запрещённом домене возвращает детерминированный ответ Operating Domain.
 */
export async function composeGuestConciergeReplyWithLlm(
  classification: GuestConciergeClassification,
  context: GuestConciergeReplyContext,
  messageText = '',
  provider?: GuestConciergeLlmProvider,
): Promise<{ reply: string; source: GuestConciergeReplySource }> {
  const fallback = composeGuestConciergeOperatingReply(classification, context, messageText);

  if (isGuestConciergeLlmProtectedDomain(classification.domain)) {
    return { reply: fallback, source: 'deterministic' };
  }

  const llmRequested = Boolean(provider) || isGuestConciergeLlmEnabled();
  if (!llmRequested || !isGuestConciergeLlmAllowedDomain(classification.domain)) {
    return { reply: fallback, source: 'deterministic' };
  }

  const llmInput: GuestConciergeLlmInput = { classification, context, messageText };
  const llmRaw = provider ? await provider.composeReply(llmInput) : await callDefaultConciergeLlmProvider(llmInput);
  if (!llmRaw?.trim()) {
    return { reply: fallback, source: 'deterministic' };
  }

  const polished = sanitizeGuestFacingReply(llmRaw);
  if (!polished || rejectsGuestConciergeLlmReply(polished, fallback, classification)) {
    return { reply: fallback, source: 'deterministic' };
  }

  return { reply: polished, source: 'llm' };
}

export function propertyPassportBlockForTests(
  property: TelegramPropertyObjectV1 | null | undefined,
  addressHint?: string | null,
): string {
  return buildPropertyPassportForLlm({ property, addressHint }, true);
}
