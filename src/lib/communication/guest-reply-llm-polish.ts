import { callLLM } from '@/lib/openai';
import type { CommunicationAutopilotPassportScenario } from './communication-autopilot-v1';
import {
  guestReplyContainsForbiddenInternalTokens,
  sanitizeGuestFacingReply,
} from './guest-facing-ru';

export type GuestReplyLlmPolishInput = {
  draftReply: string;
  scenario: CommunicationAutopilotPassportScenario | string;
};

export type GuestReplyLlmPolishProvider = {
  polishReply(input: GuestReplyLlmPolishInput): Promise<string | null>;
};

const POLISH_SYSTEM_PROMPT =
  'Ты редактор гостевых ответов отеля на русском. Перепиши черновик естественнее, сохраняя смысл и факты. ' +
  'Не добавляй новые обещания, цены, коды доступа, пароли Wi-Fi или юридические формулировки. ' +
  'Не используй слова intent, reason, passport, prop_A, debug, object.address, directionsText. ' +
  'Верни только готовый текст ответа гостю, без пояснений.';

function polishModelName(): string {
  return (
    process.env.COMMUNICATION_LLM_POLISH_MODEL?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    'gpt-4o-mini'
  );
}

export function isGuestReplyLlmPolishEnabled(): boolean {
  return process.env.COMMUNICATION_LLM_POLISH_ENABLED === 'true';
}

function rejectsPolishedReply(polished: string, draft: string): boolean {
  const trimmed = polished.trim();
  if (!trimmed || trimmed.length > 600) return true;
  if (guestReplyContainsForbiddenInternalTokens(trimmed)) return true;

  const lower = trimmed.toLocaleLowerCase('ru-RU');
  if (
    /deepseek|openai|llm|модель|провайдер|prompt|промпт|confidence|debug/.test(lower) ||
    /(код\s+доступа|пароль\s+wi|стоимость|цена)\s*[:—-]\s*\S{3,}/i.test(trimmed) ||
    /(свободн|доступн).{0,20}(номер|квартир|объект).{0,20}(есть|на\s+\d)/i.test(trimmed)
  ) {
    return true;
  }

  const draftLen = draft.trim().length;
  if (draftLen > 0 && (trimmed.length < draftLen * 0.35 || trimmed.length > draftLen * 2.5)) {
    return true;
  }

  return false;
}

async function callDefaultPolishProvider(input: GuestReplyLlmPolishInput): Promise<string | null> {
  return callLLM({
    model: polishModelName(),
    systemPrompt: POLISH_SYSTEM_PROMPT,
    userMessage: `Сценарий: ${input.scenario}\nЧерновик:\n${input.draftReply}`,
  });
}

/**
 * Optional stylistic polish for guest-facing Telegram replies.
 * Does not change routing decisions; returns the draft when disabled or on failure.
 */
export async function polishGuestReplyWithLlm(
  input: GuestReplyLlmPolishInput,
  provider?: GuestReplyLlmPolishProvider,
): Promise<string> {
  const draft = sanitizeGuestFacingReply(input.draftReply) ?? input.draftReply.trim();
  if (!draft || !isGuestReplyLlmPolishEnabled()) {
    return draft;
  }

  const polishedRaw = provider ? await provider.polishReply(input) : await callDefaultPolishProvider(input);
  if (!polishedRaw?.trim()) {
    return draft;
  }

  const polished = sanitizeGuestFacingReply(polishedRaw);
  if (!polished || rejectsPolishedReply(polished, draft)) {
    return draft;
  }

  return polished;
}
