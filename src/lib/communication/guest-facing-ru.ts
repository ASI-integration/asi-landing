/** Гостевые тексты только на русском (данные объекта + финальная санитизация). */

const KNOWN_ENGLISH_PHRASES: Readonly<Record<string, string>> = {
  'please contact us 30 minutes before arrival': 'Пожалуйста, свяжитесь с нами за 30 минут до приезда',
  'please contact us 30 min before arrival': 'Пожалуйста, свяжитесь с нами за 30 минут до приезда',
  'contact us 30 minutes before arrival': 'Свяжитесь с нами за 30 минут до приезда',
  'entrance from yard': 'Вход со двора',
  'door code at entrance': 'Код на входе у двери',
  'courtyard parking': 'Парковка во дворе',
  'no smoking': 'Курение запрещено',
};

const CITY_ALIASES: Readonly<Record<string, string>> = {
  moscow: 'Москва',
  moskva: 'Москва',
  msk: 'Москва',
  'saint petersburg': 'Санкт-Петербург',
  'st petersburg': 'Санкт-Петербург',
  spb: 'Санкт-Петербург',
};

const PLACEHOLDER_ADDRESS_RE = new RegExp(
  `^(?:${Object.keys(CITY_ALIASES).join('|')}|москва|demo|test)$`,
  'i',
);

const LATIN_WORD_RE = /[A-Za-z]{3,}/g;
const URL_RE = /https?:\/\/\S+/gi;

export function normalizeCityToken(value: string): string {
  const key = value.trim().toLowerCase();
  return CITY_ALIASES[key] ?? value.trim();
}

export function normalizeGuestAddress(address: string | null | undefined): string | null {
  if (!address?.trim()) return null;
  const raw = address.trim();
  if (PLACEHOLDER_ADDRESS_RE.test(raw)) return normalizeCityToken(raw);
  if (/^[A-Za-z.\-\s]+$/.test(raw) && CITY_ALIASES[raw.toLowerCase()]) {
    return CITY_ALIASES[raw.toLowerCase()];
  }
  return localizePropertySnippet(raw);
}

export function isIncompleteOrTestAddress(address: string | null | undefined): boolean {
  if (!address?.trim()) return true;
  const raw = address.trim();
  if (PLACEHOLDER_ADDRESS_RE.test(raw)) return true;
  const lowered = raw.toLowerCase();
  if (lowered in CITY_ALIASES || lowered === 'demo' || lowered === 'test') return true;
  if (raw.length < 12 && !/\d/.test(raw)) {
    for (const alias of Object.keys(CITY_ALIASES)) {
      if (lowered === alias || lowered === CITY_ALIASES[alias].toLowerCase()) return true;
    }
  }
  return false;
}

export function localizePropertySnippet(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  let out = text.trim();
  let lowered = out.toLowerCase();
  const entries = Object.entries(KNOWN_ENGLISH_PHRASES).sort((a, b) => b[0].length - a[0].length);
  for (const [en, ru] of entries) {
    if (lowered.includes(en)) {
      out = out.replace(new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ru);
      lowered = out.toLowerCase();
    }
  }
  return out.trim() || null;
}

export function hasGuestFacingEnglish(text: string | null | undefined): boolean {
  if (!text) return false;
  const cleaned = text.replace(URL_RE, '');
  const matches = cleaned.match(LATIN_WORD_RE) ?? [];
  for (const word of matches) {
    const w = word.toLowerCase();
    if (w in CITY_ALIASES) continue;
    if (w === 'wifi' || w === 'asi') continue;
    return true;
  }
  return false;
}

const BOOKING_WORDING_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/\bпо вашей брони\b/gi, 'по вашему бронированию'],
  [/\bв вашей брони\b/gi, 'в вашем бронировании'],
  [/\bномер брони\b/gi, 'номер бронирования'],
  [/\bданные брони\b/gi, 'данные бронирования'],
  [/\bпроверю бронь\b/gi, 'проверю бронирование'],
  [/\bиз брони\b/gi, 'из бронирования'],
  [/\bпосле проверки брони\b/gi, 'после проверки бронирования'],
  [/\bпроверки брони\b/gi, 'проверки бронирования'],
  [/\bпо брони\b/gi, 'по бронированию'],
];

/** Guest-facing RU: avoid colloquial «брони» in favor of «бронирование». */
export function normalizeBookingWordingRu(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  let out = text.trim();
  for (const [pattern, replacement] of BOOKING_WORDING_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.trim() || null;
}

export function sanitizeGuestFacingReply(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  let out = normalizeBookingWordingRu(localizePropertySnippet(text) ?? '') ?? '';
  out = stripForbiddenGuestPhrases(out);
  out = out.replace(/паспорт[а-яё]*\s+объект[а-яё]*/gi, 'данные объекта');
  out = out.replace(/Адрес:\s*([^.\n]+)\.?/i, (_m, addr: string) => {
    const raw = String(addr).trim();
    const normalized = normalizeGuestAddress(raw) ?? normalizeCityToken(raw);
    return `Адрес: ${normalized}.`;
  });
  return out.trim() || null;
}

const FORBIDDEN_GUEST_PHRASES = [
  'без автоматических обещаний',
  'автоматический ответ',
] as const;

const FORBIDDEN_GUEST_INTERNAL_TOKENS = [
  'паспорт объекта',
  'prop_a',
  'prop_',
  'intent',
  'reason',
  'missing fields',
  'object.address',
  'directionstext',
  'chat_id',
  'telegram_user_id',
  'намерение:',
  'не хватает:',
  'гость:',
  'чат:',
  'объект: prop',
  ...FORBIDDEN_GUEST_PHRASES,
] as const;

function stripForbiddenGuestPhrases(text: string): string {
  let out = text;
  for (const phrase of FORBIDDEN_GUEST_PHRASES) {
    out = out.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

export function guestReplyContainsForbiddenInternalTokens(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  const normalized = text.normalize('NFKC').toLocaleLowerCase('ru-RU');
  return FORBIDDEN_GUEST_INTERNAL_TOKENS.some((token) => normalized.includes(token));
}
