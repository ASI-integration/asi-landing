import { classify } from './classifier';
import { MessageCategory, type ClassifyResult } from './types';

/**
 * Single deterministic entry point for Telegram short social/meta lines
 * ( /start, greetings, language/capability checks, ES locale meta ) so they never
 * depend on scattered keyword lists or the LLM branch.
 */

export type TelegramTextMetaKind =
  | 'start'
  | 'greeting'
  | 'language_check'
  | 'es_locale_meta'
  | 'identity'
  | 'smalltalk'
  | 'test_ping';

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
    normalized === 'te hablas espanol' ||
    normalized === 'hablas español' ||
    normalized === 'hablas espanol' ||
    normalized.includes('hablas espanol') ||
    normalized.includes('hablas español')
  );
}

function isNeutralSmalltalkMeta(normalized: string): boolean {
  const exact = new Set([
    'а ты умный бот',
    'ты умный бот',
    'ты бот',
    'вы бот',
    'а ты бот',
    'а вы бот',
    'ты робот',
    'вы робот',
    'кто ты',
    'кто вы',
    'кто ты такой',
    'кто вы такие',
    'ты живой',
    'вы живые',
    'спасибо',
    'спасибо большое',
    'благодарю',
    'спс',
    'ок',
    'окей',
    'ок спасибо',
    'хорошо',
    'понял',
    'поняла',
    'ясно',
    'are you a bot',
    'r u a bot',
    'who are you',
    'are you alive',
    'thanks',
    'thank you',
    'ok',
    'okay',
    'got it',
  ]);

  return (
    exact.has(normalized) ||
    /^(а\s+)?(ты|вы)\s+(умн(ый|ая|ые)\s+)?(бот|робот)$/i.test(normalized) ||
    /^(а\s+)?(ты|вы)\s+жив(ой|ая|ые)$/i.test(normalized) ||
    /^кто\s+(ты|вы)(\s+так(ой|ая|ие))?$/i.test(normalized)
  );
}

function isIdentityMeta(normalized: string): boolean {
  const exact = new Set([
    'ты бот',
    'а ты бот',
    'вы бот',
    'а вы бот',
    'это бот',
    'ты робот',
    'вы робот',
    'это робот',
    'ты человек',
    'вы человек',
    'ты умный бот',
    'а ты умный бот',
    'вы умный бот',
    'вы умные бот',
    'кто ты',
    'кто вы',
    'кто ты такой',
    'кто вы такие',
    'are you a bot',
    'r u a bot',
    'who are you',
  ]);

  return (
    exact.has(normalized) ||
    /^(а\s+)?(ты|вы|это)\s+(умн(ый|ая|ые)\s+)?(бот|робот|человек)$/i.test(normalized) ||
    /^кто\s+(ты|вы)(\s+так(ой|ая|ие))?$/i.test(normalized)
  );
}

function isTelegramTestPingMeta(normalized: string): boolean {
  if (/^(ping|test|тест|проверка)$/.test(normalized)) return true;
  if (/^(test|тест)\s+/.test(normalized)) return true;
  return false;
}

function isLanguageCapabilityMeta(normalized: string): boolean {
  return (
    /^(а\s+)?(ты|вы)\s+(меня\s+)?(слышишь|слышите|понимаешь|понимаете)(\s+меня)?(?:\s|$)/i.test(normalized) ||
    /^(а\s+)?(ты|вы)\s+(можешь|можете)\s+(меня\s+)?(слышать|понять|понимать)(?:\s|$)/i.test(normalized) ||
    /(?:^|\s)(ответь|ответьте)(?:\s+мне)?(?:\s+пожалуйста)?\s+(по[-\s]?русски|на\s+русском)(?:\s|$)/i.test(normalized) ||
    /(?:^|\s)(понимаешь|понимаете)\s+(русский|по[-\s]?русски|меня)(?:\s|$)/i.test(normalized)
  );
}

type MetaSurfaceLang = 'en' | 'ru' | 'es';

/**
 * Combine Telegram `language_code` with message text so English/Spanish/Russian
 * prompts get matching replies even when the Telegram client locale differs.
 */
export function inferMetaSurfaceLang(text: string, telegramLangCode?: string): MetaSurfaceLang {
  const raw = String(text ?? '');
  if (/[а-яё]/i.test(raw)) return 'ru';

  const loose = raw.toLowerCase();
  if (
    /(español|espanol|hablas|te\s+habla|te\s+hablas|hola\b|buenos\s+dias|buenas\s+tardes)/i.test(raw) ||
    isSpanishTelegramMeta(normalizeForMetaMatch(raw))
  ) {
    return 'es';
  }

  const norm = normalizeForMetaMatch(raw);
  const englishCapabilityOrGreeting =
    /\b(hello|hi|hey|ping|test)\b/.test(loose) ||
    /\b(can|do)\s+u\s+understand/.test(loose) ||
    /\b(can|do)\s+you\s+understand/.test(loose) ||
    /\bu\s+understand\s+me\b/.test(loose) ||
    /\bcan\s+u\s+read\b/.test(loose) ||
    /\bcan\s+you\s+read\b/.test(loose) ||
    norm.includes('understand me') ||
    norm.includes('understand you');

  if (englishCapabilityOrGreeting) return 'en';

  const code = (telegramLangCode ?? '').toLowerCase();
  if (code.startsWith('ru')) return 'ru';
  if (code.startsWith('es')) return 'es';
  return 'en';
}

/** Product copy for language / capability meta (Telegram-only). */
function unifiedLanguageCapabilityReply(surface: MetaSurfaceLang): string {
  if (surface === 'ru') {
    return 'Да, понимаю русский и английский. Пришлите, пожалуйста, запрос текстом.';
  }
  if (surface === 'es') {
    return 'Да, понимаю русский и английский. Пришлите, пожалуйста, запрос текстом.';
  }
  return 'Да, понимаю русский и английский. Пришлите, пожалуйста, запрос текстом.';
}

function telegramMetaStartReply(surface: MetaSurfaceLang): string {
  if (surface === 'ru') {
    return 'ASI online.\nОтправьте сообщение гостя, проблему или запрос.';
  }
  if (surface === 'es') {
    return 'ASI online.\nОтправьте сообщение гостя, проблему или запрос.';
  }
  return 'ASI online.\nОтправьте сообщение гостя, проблему или запрос.';
}

function telegramMetaGreetingReply(surface: MetaSurfaceLang): string {
  if (surface === 'ru') {
    return 'Здравствуйте! Пришлите запрос гостя, проблему или детали заезда.';
  }
  if (surface === 'es') {
    return 'Здравствуйте! Пришлите запрос гостя, проблему или детали заезда.';
  }
  return 'Здравствуйте! Пришлите запрос гостя, проблему или детали заезда.';
}

function telegramMetaSmalltalkReply(rawText: string, surface: MetaSurfaceLang): string {
  const normalized = normalizeForMetaMatch(rawText);
  const isAck =
    /^(спасибо|спасибо большое|благодарю|спс|ок|окей|ок спасибо|хорошо|понял|поняла|ясно)$/i.test(normalized) ||
    /^(thanks|thank you|ok|okay|got it)$/i.test(normalized);

  if (surface === 'ru') {
    if (isAck) {
      return 'Пожалуйста! Если появится запрос гостя или вопрос по объекту, пришлите сюда.';
    }
    return 'Да, я бот ASI. Помогаю быстро разобрать сообщения гостей, вопросы по заезду и проблемы с объектом.';
  }
  if (surface === 'es') {
    if (isAck) {
      return 'Пожалуйста! Если появится запрос гостя или вопрос по объекту, пришлите сюда.';
    }
    return 'Да, я бот ASI. Помогаю быстро разобрать сообщения гостей, вопросы по заезду и проблемы с объектом.';
  }
  if (isAck) {
    return 'Пожалуйста! Если появится запрос гостя или вопрос по объекту, пришлите сюда.';
  }
  return 'Да, я бот ASI. Помогаю быстро разобрать сообщения гостей, вопросы по заезду и проблемы с объектом.';
}

function telegramMetaIdentityReply(surface: MetaSurfaceLang): string {
  if (surface === 'ru') {
    return 'Да, я официальный ассистент ASI. Помогаю с заселением, доступом, бронью, уборкой и поломками. Напишите, что случилось, я разберу запрос или передам оператору, если нужен человек.';
  }
  if (surface === 'es') {
    return 'Да, я официальный ассистент ASI. Помогаю с заселением, доступом, бронью, уборкой и поломками. Напишите, что случилось, я разберу запрос или передам оператору, если нужен человек.';
  }
  return 'Да, я официальный ассистент ASI. Помогаю с заселением, доступом, бронью, уборкой и поломками. Напишите, что случилось, я разберу запрос или передам оператору, если нужен человек.';
}

function telegramMetaTestPingReply(surface: MetaSurfaceLang): string {
  if (surface === 'ru') return 'Бот на связи.';
  return 'Бот на связи.';
}

function hasSubstantiveOperationalContent(rawText: string): boolean {
  const raw = String(rawText ?? '');
  const normalized = normalizeForMetaMatch(raw);
  return (
    /\b\d{1,2}:\d{2}\b/.test(raw) ||
    /(?:^|[^\p{L}\d])(?:в|к|на)\s*\d{1,2}\s*(утра|дня|вечера|ночи)?(?:$|[^\p{L}\d])/iu.test(raw) ||
    /\bcheck[-\s]?in\b|\bcheck[-\s]?out\b|\bearly\b|\blate\b|\bbooking\b|\breservation\b|\bguest\b|\baddress\b|\bproperty\b/i.test(raw) ||
    /заезд|засел|заехать|заеду|выезд|гость|брон|объект|адрес|код|доступ|замок|дверь|парков|оплат|уборк|отоп|горяч|шум|продл|wifi|wi\s*fi/i.test(normalized)
  );
}

function applyRuTelegramForceRu(c: ClassifyResult): ClassifyResult {
  if (process.env.RU_TELEGRAM_FORCE_RU === '1') {
    return { ...c, lang: 'ru' };
  }
  return c;
}

function buildTelegramMetaReply(
  kind: TelegramTextMetaKind,
  rawText: string,
  telegramLangCode: string | undefined,
  c: ClassifyResult,
): string {
  const working = applyRuTelegramForceRu(c);
  const surface: MetaSurfaceLang =
    process.env.RU_TELEGRAM_FORCE_RU === '1' ? 'ru' : inferMetaSurfaceLang(rawText, telegramLangCode);

  if (kind === 'smalltalk') {
    return telegramMetaSmalltalkReply(rawText, surface);
  }
  if (kind === 'identity') {
    return telegramMetaIdentityReply(surface);
  }
  if (kind === 'test_ping') {
    return telegramMetaTestPingReply(surface);
  }
  if (working.category === MessageCategory.LanguageCheck || kind === 'es_locale_meta') {
    return unifiedLanguageCapabilityReply(surface);
  }
  if (working.category === MessageCategory.Start) {
    return telegramMetaStartReply(surface);
  }
  if (working.category === MessageCategory.Greeting) {
    return telegramMetaGreetingReply(surface);
  }
  return unifiedLanguageCapabilityReply(surface);
}

function patchClassificationLang(classification: ClassifyResult, surface: MetaSurfaceLang): ClassifyResult {
  if (process.env.RU_TELEGRAM_FORCE_RU === '1') {
    return { ...classification, lang: 'ru' };
  }
  const lang = surface === 'es' ? 'es' : surface === 'ru' ? 'ru' : 'en';
  return { ...classification, lang };
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

  // Text-first `lang`; do not pass Telegram `language_code` into `classify` or it
  // overrides Cyrillic/Latin detection and biases capability replies to the UI locale.
  const spanishKey = normalizeForMetaMatch(raw);
  if (isTelegramTestPingMeta(spanishKey) && !hasSubstantiveOperationalContent(raw)) {
    const classification = classify(raw);
    const patched: ClassifyResult = { ...classification, category: MessageCategory.LanguageCheck };
    const surface = inferMetaSurfaceLang(raw, params.telegramLangCode);
    return {
      handler: 'telegram_text_meta_deterministic',
      kind: 'test_ping',
      reply: buildTelegramMetaReply('test_ping', raw, params.telegramLangCode, patched),
      category: MessageCategory.LanguageCheck,
      classification: patchClassificationLang(patched, surface),
    };
  }

  if (isSpanishTelegramMeta(spanishKey)) {
    const classification = classify(raw);
    const patched: ClassifyResult = { ...classification, category: MessageCategory.LanguageCheck };
    const surface = inferMetaSurfaceLang(raw, params.telegramLangCode);
    return {
      handler: 'telegram_text_meta_deterministic',
      kind: 'es_locale_meta',
      reply: buildTelegramMetaReply('es_locale_meta', raw, params.telegramLangCode, patched),
      category: MessageCategory.LanguageCheck,
      classification: patchClassificationLang(patched, surface),
    };
  }

  if (isLanguageCapabilityMeta(spanishKey) && !hasSubstantiveOperationalContent(raw)) {
    const classification = classify(raw);
    const patched: ClassifyResult = { ...classification, category: MessageCategory.LanguageCheck };
    const surface = inferMetaSurfaceLang(raw, params.telegramLangCode);
    return {
      handler: 'telegram_text_meta_deterministic',
      kind: 'language_check',
      reply: buildTelegramMetaReply('language_check', raw, params.telegramLangCode, patched),
      category: MessageCategory.LanguageCheck,
      classification: patchClassificationLang(patched, surface),
    };
  }

  if (isIdentityMeta(spanishKey) && !hasSubstantiveOperationalContent(raw)) {
    const classification = classify(raw);
    const patched: ClassifyResult = { ...classification, category: MessageCategory.LanguageCheck };
    const surface = inferMetaSurfaceLang(raw, params.telegramLangCode);
    return {
      handler: 'telegram_text_meta_deterministic',
      kind: 'identity',
      reply: buildTelegramMetaReply('identity', raw, params.telegramLangCode, patched),
      category: MessageCategory.LanguageCheck,
      classification: patchClassificationLang(patched, surface),
    };
  }

  if (isNeutralSmalltalkMeta(spanishKey) && !hasSubstantiveOperationalContent(raw)) {
    const classification = classify(raw);
    const patched: ClassifyResult = { ...classification, category: MessageCategory.LanguageCheck };
    const surface = inferMetaSurfaceLang(raw, params.telegramLangCode);
    return {
      handler: 'telegram_text_meta_deterministic',
      kind: 'smalltalk',
      reply: buildTelegramMetaReply('smalltalk', raw, params.telegramLangCode, patched),
      category: MessageCategory.LanguageCheck,
      classification: patchClassificationLang(patched, surface),
    };
  }

  const classification = classify(raw);
  if (
    classification.category === MessageCategory.Start ||
    classification.category === MessageCategory.Greeting ||
    classification.category === MessageCategory.LanguageCheck
  ) {
    if (classification.category === MessageCategory.Greeting && hasSubstantiveOperationalContent(raw)) {
      return null;
    }
    const kind: TelegramTextMetaKind =
      classification.category === MessageCategory.Start
        ? 'start'
        : classification.category === MessageCategory.Greeting
          ? 'greeting'
          : 'language_check';
    const surface = inferMetaSurfaceLang(raw, params.telegramLangCode);
    return {
      handler: 'telegram_text_meta_deterministic',
      kind,
      reply: buildTelegramMetaReply(kind, raw, params.telegramLangCode, classification),
      category: classification.category,
      classification: patchClassificationLang(classification, surface),
    };
  }

  return null;
}
