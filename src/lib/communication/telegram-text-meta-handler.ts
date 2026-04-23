import { classify, deterministicReply } from './classifier';
import { MessageCategory, type ClassifyResult } from './types';

/**
 * Single deterministic entry point for Telegram short social/meta lines
 * ( /start, greetings, language/capability checks, ES locale meta ) so they never
 * depend on scattered keyword lists or the LLM branch.
 */

export type TelegramTextMetaKind = 'start' | 'greeting' | 'language_check' | 'es_locale_meta';

export type TelegramTextMetaMatch = {
  handler: 'telegram_text_meta_deterministic';
  kind: TelegramTextMetaKind;
  reply: string;
  category: MessageCategory;
  classification: ClassifyResult;
};

function normalizeForMetaMatch(text: string): string {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[“”„"']/g, '')
    .replace(/[?!.,;:(){}\[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSpanishTelegramMeta(normalized: string): boolean {
  return (
    normalized === 'do you speak spanish' ||
    normalized === 'te habla espanol' ||
    normalized === 'hablas español' ||
    normalized === 'hablas espanol'
  );
}

type CapabilitySurfaceLang = 'en' | 'ru' | 'es';

function detectCapabilitySurfaceLang(text: string, telegramLangCode?: string): CapabilitySurfaceLang {
  const code = (telegramLangCode ?? '').toLowerCase();
  if (code.startsWith('ru')) return 'ru';
  if (code.startsWith('es')) return 'es';
  if (/[а-яё]/i.test(text)) return 'ru';
  if (/(español|espanol|hablas|te\s+habla)/i.test(text)) return 'es';
  return 'en';
}

/** Unified copy for language / capability meta (Telegram-only product wording). */
function unifiedLanguageCapabilityReply(surface: CapabilitySurfaceLang): string {
  if (surface === 'ru') {
    return 'Да, понимаю русский и английский. Пришлите, пожалуйста, запрос текстом.';
  }
  if (surface === 'es') {
    return 'Sí, entiendo mensajes de texto. Envíe su solicitud por texto, por favor.';
  }
  return 'Yes, I understand English and Russian. Please send your request as text.';
}

function applyRuTelegramForceRu(c: ClassifyResult): ClassifyResult {
  if (process.env.RU_TELEGRAM_FORCE_RU === '1') {
    return { ...c, lang: 'ru' };
  }
  return c;
}

function buildTelegramMetaReply(rawText: string, telegramLangCode: string | undefined, c: ClassifyResult): string {
  const working = applyRuTelegramForceRu(c);
  if (working.category === MessageCategory.LanguageCheck) {
    const surface =
      process.env.RU_TELEGRAM_FORCE_RU === '1'
        ? 'ru'
        : detectCapabilitySurfaceLang(rawText, telegramLangCode);
    return unifiedLanguageCapabilityReply(surface);
  }
  return deterministicReply(working);
}

/**
 * Returns a match when this inbound line should be answered only by the Telegram
 * meta handler (no LLM, no scenario engine).
 */
export function resolveTelegramTextMeta(params: {
  baseText: string;
  telegramLangCode?: string;
}): TelegramTextMetaMatch | null {
  const raw = String(params.baseText ?? '').trim();
  if (!raw) return null;

  const spanishKey = normalizeForMetaMatch(raw);
  if (isSpanishTelegramMeta(spanishKey)) {
    const classification = classify(raw, params.telegramLangCode);
    const patched: ClassifyResult = { ...classification, category: MessageCategory.LanguageCheck };
    return {
      handler: 'telegram_text_meta_deterministic',
      kind: 'es_locale_meta',
      reply: buildTelegramMetaReply(raw, params.telegramLangCode, patched),
      category: MessageCategory.LanguageCheck,
      classification: patched,
    };
  }

  const classification = classify(raw, params.telegramLangCode);
  if (
    classification.category === MessageCategory.Start ||
    classification.category === MessageCategory.Greeting ||
    classification.category === MessageCategory.LanguageCheck
  ) {
    const kind: TelegramTextMetaKind =
      classification.category === MessageCategory.Start
        ? 'start'
        : classification.category === MessageCategory.Greeting
          ? 'greeting'
          : 'language_check';
    return {
      handler: 'telegram_text_meta_deterministic',
      kind,
      reply: buildTelegramMetaReply(raw, params.telegramLangCode, classification),
      category: classification.category,
      classification,
    };
  }

  return null;
}
