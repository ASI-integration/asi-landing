/**
 * Deterministic Telegram operational intake — runs before LLM / generic escalation copy.
 * Matches obvious staff→ops guest relay patterns without LLM confidence.
 */

import { decideEscalationMatrixV1 } from './escalation-matrix';

export type TelegramOperationalCategory =
  | 'access_issue'
  | 'wifi_issue'
  | 'parking_question'
  | 'late_checkout'
  | 'early_checkin'
  | 'checkin_time_question'
  | 'no_heating'
  | 'no_hot_water'
  | 'noise_complaint'
  | 'cleaning_request'
  | 'extension_request'
  | 'payment_confirmation';

export type TelegramOperationalFinalAction = 'reply' | 'clarify' | 'escalate_operator' | 'escalate_urgent';

export type CheckinTimeBucket =
  | 'very_early_checkin'
  | 'early_checkin'
  | 'conditional_early_checkin'
  | 'normal_checkin'
  | 'late_checkin'
  | 'unknown';

export type TelegramOperationalIntakeHit = {
  category: TelegramOperationalCategory;
  reply: string;
  extractedFacts: Record<string, unknown>;
  missingFacts: string[];
  finalAction: TelegramOperationalFinalAction;
  urgencySignals: string[];
  actionReason: string;
};

export type TelegramOperationalIntakeParams = {
  text: string;
  surfaceLang: 'en' | 'ru';
  update_id: number;
  chat_id: number;
};

function norm(s: string): string {
  return s.toLowerCase().trim();
}

function normalizeSpace(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeRuGenderPlaceholders(s: string): string {
  return String(s ?? '')
    .replace(/Понял\(а\)/g, 'Понял')
    .replace(/Зафиксировал\(а\)/g, 'Зафиксировал')
    .replace(/Передал\(а\)/g, 'Передал')
    .replace(/уточнял\(а\)/g, 'уточнял')
    .replace(/задавал\(а\)/g, 'задавал');
}

function stripPunctForMatch(s: string): string {
  return normalizeSpace(String(s ?? '').toLowerCase().replace(/[“”„"']/g, '').replace(/[?!.,;:(){}\[\]<>]/g, ' '));
}

function normalizeKnownRuStreetForms(snippet: string): string {
  let s = normalizeSpace(snippet);
  // Heuristic normalization for common declensions so DB "location" matches:
  // "в Невском 24" -> "Невский 24", "в Литейном 12" -> "Литейный 12"
  // Do NOT use `\b` here — JS word boundaries are ASCII-centric and break on Cyrillic,
  // which caused "Невском/Литейном" to not normalize → DB location mismatch.
  s = s.replace(/(невск)(ий|ого|ому|ом|ая|ую|ой|им)/iu, 'Невский');
  s = s.replace(/(литейн)(ый|ого|ому|ом|ая|ую|ой|ым)/iu, 'Литейный');
  return s;
}

function extractExplicitRuPropertyLabel(text: string): string | null {
  const t = String(text ?? '');
  // Unicode-safe boundary: avoid JS `\b` (ASCII-centric) for Cyrillic.
  const m = t.match(/(?:^|[^\p{L}])((?:невск[\p{L}]*|литейн[\p{L}]*)\s+\d{1,4}(?:\s*к\d+)?)\b/iu);
  if (!m) return null;
  const s = normalizeKnownRuStreetForms(String(m[1] ?? '').trim()).slice(0, 120);
  if (!s) return null;
  if (/^\d{1,2}:\d{2}$/.test(s)) return null;
  return s;
}

function hasLateCheckoutIntent(n: string): boolean {
  return (
    /\blate\s+checkout\b/i.test(n) ||
    /\blate\s+check[-\s]?out\b/i.test(n) ||
    /поздн(ий|его|ему)?\s+выезд/i.test(n) ||
    (/выезд/i.test(n) && /до\s*\d{1,2}/i.test(n) && /поздн|до\s*13|до\s*14/i.test(n))
  );
}

function hasCheckinArrivalIntent(n: string): boolean {
  return /\bcheck[-\s]?in\b|\barriv(e|al|ing)?\b|заезд|засел|заехать|заеду|заезж|приезд|приех/i.test(n);
}

function hasExplicitEarlyCheckinWording(n: string): boolean {
  return (
    /\bearly\s+check[-\s]?in\b/i.test(n) ||
    /\bearlier\s+check[-\s]?in\b/i.test(n) ||
    /\bcheck[-\s]?in\s+early\b/i.test(n) ||
    /ранн(ий|его|ему)?\s+(заезд|засел)/i.test(n) ||
    (/заезд|засел/i.test(n) && /(раньше|пораньше|с\s*\d{1,2}(:\d{2})?)/i.test(n))
  );
}

function hasEarlyCheckinIntent(n: string, bucket: CheckinTimeBucket): boolean {
  const explicitEarly = hasExplicitEarlyCheckinWording(n);

  if (bucket === 'normal_checkin' || bucket === 'late_checkin') return false;
  if (bucket === 'very_early_checkin' || bucket === 'early_checkin' || bucket === 'conditional_early_checkin') {
    return explicitEarly || hasCheckinArrivalIntent(n);
  }
  return explicitEarly;
}

function hasNoHeatingIntent(n: string): boolean {
  return (
    /no\s+heating|without\s+heating|no\s+heat\b|heating\s+(doesn'?t|does\s+not|isn'?t|is\s+not)\s+work|heating\s+(off|broken)|\bheating\b.*\b(not|no)\b/i.test(
      n,
    ) ||
    /\bheating\b.{0,25}\boff\b/i.test(n) ||
    /\bheating\b.{0,25}\bbroken\b/i.test(n) ||
    /нет\s+отоплен|отоплен(ие|ия)\s+нет|отопление\s+не\s+работает|батаре(и|я)\s+холодн/i.test(n) ||
    (/(very\s+cold|freezing|no\s+warm)/i.test(n) && /(apartment|flat|unit|room|квартир|апарт|жиль)/i.test(n)) ||
    (/холодно/i.test(n) && /(квартир|апарт|в\s+жиль|в\s+номер)/i.test(n))
  );
}

function hasNoHotWaterIntent(n: string): boolean {
  return (
    /\bno\s+hot\s+water\b|\bhot\s+water\b.*\b(not|no)\b|\bwater\b.*\bnot\s+hot\b|\bshower\b.*\b(cold|not\s+hot)\b/i.test(n) ||
    /нет\s+горяч(ей|ая)\s+вод|горяч(ая|ей)\s+вод(а|ы)\s+нет|горячая\s+вода\s+не\s+работает|вода\s+холодн(ая|ая)\s+из\s+крана|душ\s+холодн/i.test(
      n,
    )
  );
}

function hasAccessIssueIntent(n: string): boolean {
  if (hasLateCheckoutIntent(n)) return false;

  // Do NOT treat pure "door code" or "check-in info" as access issues.
  // Access_issue should require a failure/lockout signal, not just access data.
  const enterOrOpenFailure =
    /(can'?t|cannot)\s+(get\s+in|enter|open)/i.test(n) ||
    /locked\s+out|lockout/i.test(n) ||
    /не\s+могу\s+(войти|попасть)|не\s+попад(а|у)ю|закры(т|та)\s+снаружи/i.test(n) ||
    /не\s+открыва(ется|ть)?/i.test(n);

  const codeDoor =
    // "door/access/entry code" only counts if it's failing / lockout
    (/(door\s+code|access\s+code|entry\s+code|код(\s+от)?\s+двери|код)/i.test(n) && enterOrOpenFailure) ||
    (/(code|код)/i.test(n) && /(doesn'?t\s+work|does\s+not\s+work|not\s+work|не\s+работает|не\s+подходит|не\s+открыва)/i.test(n)) ||
    (/(lock|замок)/i.test(n) && /(doesn'?t|does\s+not|не\s+работает|не\s+открыва|failed)/i.test(n)) ||
    (/(door|дверь)/i.test(n) && /(doesn'?t|does\s+not|не\s+открыва|won'?t\s+open|not\s+open)/i.test(n));

  const mentionsAccessSurface = /(code|код|door|дверь|lock|замок|intercom|домофон)/i.test(n);

  // "cannot enter" / "locked out" alone is enough for ops access_issue, even without explicit door/code word.
  return Boolean(codeDoor || enterOrOpenFailure || (mentionsAccessSurface && enterOrOpenFailure));
}

function hasNoiseComplaintIntent(n: string): boolean {
  return (
    /\bnoise\b|\bloud\b|\bneighbou?r\b|\bparty\b|\bmusic\b|\bshouting\b|\bscream/i.test(n) ||
    /шум|громк|сосед|вечеринк|музык|крики?|орут|сверлят|жалоб/i.test(n)
  );
}

function hasCleaningRequestIntent(n: string): boolean {
  return (
    /\bclean(?:ing)?\b|\bhousekeep(?:ing)?\b|\bmaid\b|\bchange\s+(towels|linen|beds?)\b|\bextra\s+towels?\b/i.test(
      n,
    ) ||
    /уборк|клининг|горничн|смен(ить|а)\s+(полотенц|постел|бель)/i.test(n) ||
    /доп\s*полотенц|полотенц(а|е)\s+нужн/i.test(n) ||
    /\bservice\b/i.test(n) ||
    /сервис/i.test(n)
  );
}

function hasExtensionRequestIntent(n: string): boolean {
  return (
    /\bextend\b|\bextension\b|\bstay\s+longer\b|\bextra\s+nights?\b|\badd\s+night\b/i.test(n) ||
    /продл(ить|ение)|остаться\s+ещ[её]|доп(олнительно)?\s+ноч/i.test(n)
  );
}

function hasWifiIssueIntent(n: string): boolean {
  return (
    /\bwifi\b|\bwi[\-‑–—]?\s*fi\b|\bwi-fi\b|\binternet\b|\brouter\b|\bnetwork\b|\bpassword\b/i.test(n) ||
    /вайфай|wi-?fi|интернет|роутер|маршрутизатор|парол/i.test(n)
  );
}

function hasParkingQuestionIntent(n: string): boolean {
  return (
    /\bparking\b|\bpark\b|\bcar\b|\bgarage\b|\bwhere\s+to\s+park\b/i.test(n) ||
    /парковк|парковат|машин|авто|гараж|где\s+поставить/i.test(n)
  );
}

function hasPaymentConfirmationIntent(n: string): boolean {
  // "I paid / sent payment / payment done / transfer made / screenshot" (confirmation, not request for a link)
  return (
    /\bpaid\b|\bpayment\s+(sent|done|completed|confirmed)\b|\btransfer\b|\bsent\s+the\s+money\b|\bproof\b|\breceipt\b/i.test(
      n,
    ) ||
    /оплат(ил|ила|или|а)|плат(ёж|еж)\s+(отправ|сделан|прош[её]л|подтвержд)|перев(е|ё)л|чек|квитанц|скрин/i.test(n)
  );
}

function extractAddressHint(text: string): string | null {
  const t = String(text ?? '');
  const m =
    t.match(/\b(\d{1,4}\s*[A-Za-zА-Яа-яЁё.-]+(?:\s+(?:st|street|ave|avenue|road|rd|проспект|просп|ул\.?|улица|пер\.?|переулок|наб\.?|набережная))\b[^.\n?]{0,60})/iu) ??
    t.match(/по\s+адресу\s+([^.\n?]{3,120})/iu) ??
    t.match(/\b(?:at|@)\s+([^.\n?]{3,120})/iu);
  if (!m) return null;
  let s = String(m[1] ?? '').trim();
  if (!s) return null;
  if (/^\d{1,2}:\d{2}$/.test(s)) return null;
  // Trim trailing non-address fragments often present in ops relays.
  s = s
    .replace(/\b(can'?t|cannot)\s+(enter|get\s+in|open)\b.*$/i, '')
    .replace(/\bне\s+могу\s+(войти|попасть)\b.*$/i, '')
    .trim();
  return s.slice(0, 120);
}

function hasPropertyHint(text: string, n: string): boolean {
  if (/по\s+адресу/i.test(text)) return true;
  // "at 11:00" is not a property; guard against time-only captures
  const atOrAtSign = text.match(/\b(?:at|@)\s+([^.\n?]+)/i);
  if (atOrAtSign) {
    const snippet = atOrAtSign[1].trim().slice(0, 40);
    // Common non-property "at ..." phrases seen in ops chat (not an address).
    if (/^(the\s+)?entrance\b/i.test(snippet)) return false;
    if (/^(the\s+)?door\b/i.test(snippet)) return false;
    if (/^(the\s+)?front\s+door\b/i.test(snippet)) return false;
    if (!/^\d{1,2}:\d{2}$/.test(snippet) && !/^\d{1,2}$/.test(snippet)) return true;
  }
  if (/(nevsky|невск|liteyn|литейн|tversk|тверск|ул\.?\s|улиц|проспект|набережн)/i.test(n)) return true;
  // Russian "street-in-locative + number": "в Невском 24", "в Литейном 12"
  if (/(?:^|[^\p{L}])(в|на)\s+[а-яёa-z.\-]{3,40}\s+\d{1,4}\b/iu.test(n)) return true;
  if (/\b\d{1,4}\s*[A-Za-zА-Яа-яЁё.-]+(?:st|street|str|ave|просп|пер|шоссе)\b/i.test(n)) return true;
  return false;
}

function hasTimingHint(n: string): boolean {
  return (
    /\b(today|tomorrow|tonight|сегодня|завтра|вечером)\b/i.test(n) ||
    /\d{1,2}:\d{2}/.test(n) ||
    /check[-\s]?in|заезд|засел|приезд|arriv/i.test(n)
  );
}

function hasFailureModeHint(n: string): boolean {
  if (/не\s+работает|не\s+подходит|не\s+открыва(ется|ть)?/i.test(n)) return true;
  return (
    (/(code|код)/i.test(n) && /(work|подходит|открыва|open|doesn|does\s+not)/i.test(n)) ||
    /(lock|замок)/i.test(n) ||
    /(door|дверь)/i.test(n)
  );
}

function extractGuestName(text: string): string | null {
  const m =
    text.match(/\bguest\s+([A-Za-zА-Яа-яЁё]+(?:\s+[A-Za-zА-Яа-яЁё]+)?)/u) ??
    text.match(/\bгость\s+([A-Za-zА-Яа-яЁё]+(?:\s+[A-Za-zА-Яа-яЁё]+)?)/u);
  return m ? m[1].trim() : null;
}

function extractTimeLike(text: string): string | null {
  const t = String(text ?? '');
  const m = t.match(/\b(\d{1,2}:\d{2})\b/);
  if (m) return m[1];
  const m2 = t.match(/\bдо\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\b/i);
  if (m2) {
    const hh = m2[1].padStart(2, '0');
    const mm = (m2[2] ?? '00').padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const m3 = t.match(/\bfrom\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\b/i);
  if (m3) {
    const hh = m3[1].padStart(2, '0');
    const mm = (m3[2] ?? '00').padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const m4 = t.match(/(?:^|[^\p{L}\d])(?:в|к|на)\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(утра|дня|вечера|ночи)?(?:$|[^\p{L}\d])/iu);
  if (m4) {
    let hour = Number(m4[1]);
    const meridiem = String(m4[3] ?? '').toLowerCase();
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
    if (meridiem === 'вечера' && hour >= 1 && hour <= 11) hour += 12;
    if (meridiem === 'дня' && hour >= 1 && hour <= 11) hour += 12;
    if (meridiem === 'ночи' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${(m4[2] ?? '00').padStart(2, '0')}`;
  }
  return null;
}

function parseTimeParts(time: string | null): { hour: number; minute: number } | null {
  const m = String(time ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseTimeHour(time: string | null): number | null {
  return parseTimeParts(time)?.hour ?? null;
}

export function classifyCheckinTimeBucket(time: string | null): {
  bucket: CheckinTimeBucket;
  isEarlyCheckinByTime: boolean;
  requiresCleaningAvailability: boolean;
  policy: string;
} {
  const parsed = parseTimeParts(time);
  if (!parsed) {
    return {
      bucket: 'unknown',
      isEarlyCheckinByTime: false,
      requiresCleaningAvailability: false,
      policy: 'no_explicit_checkin_time',
    };
  }
  const { hour, minute } = parsed;
  if (hour >= 6 && (hour < 8 || (hour === 8 && minute === 0))) {
    return {
      bucket: 'very_early_checkin',
      isEarlyCheckinByTime: true,
      requiresCleaningAvailability: false,
      policy: '06:00-08:00_very_early_requires_previous_night_availability',
    };
  }
  if ((hour === 8 && minute > 0) || (hour >= 9 && hour <= 10)) {
    return {
      bucket: 'early_checkin',
      isEarlyCheckinByTime: true,
      requiresCleaningAvailability: true,
      policy: '06:00-10:59_early_checkin',
    };
  }
  if (hour >= 11 && hour <= 13) {
    return {
      bucket: 'conditional_early_checkin',
      isEarlyCheckinByTime: true,
      requiresCleaningAvailability: true,
      policy: '11:00-13:59_conditional_depends_on_cleaning_and_previous_checkout',
    };
  }
  if (hour >= 14 && hour <= 16) {
    return {
      bucket: 'normal_checkin',
      isEarlyCheckinByTime: false,
      requiresCleaningAvailability: false,
      policy: '14:00-16:00_normal_checkin_window',
    };
  }
  if (hour >= 21 || hour <= 5) {
    return {
      bucket: 'late_checkin',
      isEarlyCheckinByTime: false,
      requiresCleaningAvailability: false,
      policy: '21:00-05:59_late_checkin',
    };
  }
  return {
    bucket: 'normal_checkin',
    isEarlyCheckinByTime: false,
    requiresCleaningAvailability: false,
    policy: '17:00-20:59_standard_evening_checkin',
  };
}

function buildRuCheckinTimePolicyReply(params: {
  bucket: CheckinTimeBucket;
  time: string | null;
  hasProperty: boolean;
}): string {
  const time = params.time ?? 'Это время';
  const missingObjectQuestion = params.hasProperty ? '' : ' Подскажите, для какого это объекта или брони?';

  if (params.bucket === 'early_checkin') {
    return `Понял. ${time} — это ранний заезд, его нужно отдельно подтвердить. Проверю готовность объекта после уборки и отсутствие конфликта с предыдущим выездом.${missingObjectQuestion}`;
  }
  if (params.bucket === 'very_early_checkin') {
    return `Понял. ${time} — это очень ранний заезд. Такое время возможно только если объект свободен с предыдущей ночи: нет гостя накануне и нет конфликта с предыдущим выездом. Проверю это отдельно.${missingObjectQuestion}`;
  }
  if (params.bucket === 'conditional_early_checkin') {
    return `Понял. ${time} — раньше стандартного времени заезда. Тут всё зависит от уборки и предыдущего выезда, поэтому проверю готовность объекта отдельно.${missingObjectQuestion}`;
  }
  if (params.bucket === 'normal_checkin') {
    return `Понял. ${time} обычно считается стандартным временем заезда, не ранним. Я всё равно уточню готовность объекта после уборки, но, скорее всего, заезд в это время будет возможен без проблем.${missingObjectQuestion}`;
  }
  if (params.bucket === 'late_checkin') {
    return `Понял. ${time} — это поздний заезд. Проверю, что для объекта есть понятные инструкции по доступу и ключам, чтобы вы спокойно заселились вечером.${missingObjectQuestion}`;
  }
  return `Понял. Уточню возможность заезда и готовность объекта.${missingObjectQuestion}`;
}

function extractDateLikeToken(n: string): 'today' | 'tomorrow' | null {
  if (/\b(today|сегодня)\b/i.test(n)) return 'today';
  if (/\b(tomorrow|завтра)\b/i.test(n)) return 'tomorrow';
  return null;
}

function extractCheckinCheckoutHints(n: string): { checkin_hint: string | null; checkout_hint: string | null } {
  const isCheckin = /\bcheck[-\s]?in\b|заезд|засел|checkin/i.test(n);
  const isCheckout = /\bcheck[-\s]?out\b|выезд|checkout/i.test(n);
  const day = extractDateLikeToken(n);
  const dayToken = day ? day : null;
  return {
    checkin_hint: isCheckin ? (dayToken ?? 'checkin') : null,
    checkout_hint: isCheckout ? (dayToken ?? 'checkout') : null,
  };
}

function extractAmountLike(text: string): string | null {
  const t = String(text ?? '');
  const m =
    t.match(/(\b\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?\b)\s*(rub|rur|₽|eur|€|usd|\$)/i) ??
    t.match(/(rub|rur|₽|eur|€|usd|\$)\s*(\b\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?\b)/i);
  if (!m) return null;
  if (m[1] && /\d/.test(m[1])) return normalizeSpace(m[1] + ' ' + (m[2] ?? '')).trim();
  if (m[2] && /\d/.test(m[2])) return normalizeSpace((m[1] ?? '') + ' ' + m[2]).trim();
  return null;
}

function extractPropertySnippet(text: string): string | null {
  // Fast-path for our priority RU objects: "Невском 24", "Литейном 12" (any case/declension),
  // including mid-sentence: "... у входа в Невском 24, ..."
  const explicit = extractExplicitRuPropertyLabel(text);
  if (explicit) return explicit;

  const m1 = text.match(/по\s+адресу\s+([^.\n?]+)/i);
  if (m1) {
    const s = m1[1].trim().slice(0, 120);
    // Avoid capturing a time or trivial token as "property"
    if (/^\d{1,2}:\d{2}$/.test(s)) return null;
    return s;
  }
  const m2 = text.match(/\b(?:at|@)\s+([^.\n?]+)/i);
  if (m2) {
    let s = m2[1].trim().slice(0, 120);
    // "at 11:00" is timing, not a property reference
    if (/^\d{1,2}:\d{2}$/.test(s)) return null;
    if (/^\d{1,2}$/.test(s)) return null;
    // "at the entrance" / "at the door" is not a property reference
    if (/^(the\s+)?entrance\b/i.test(s)) return null;
    if (/^(the\s+)?door\b/i.test(s)) return null;
    if (/^(the\s+)?front\s+door\b/i.test(s)) return null;
    // Trim trailing action fragments ("cannot enter", etc.)
    s = s
      .replace(/\b(can'?t|cannot)\s+(enter|get\s+in|open)\b.*$/i, '')
      .replace(/\bне\s+могу\s+(войти|попасть)\b.*$/i, '')
      .trim();
    return s;
  }
  // Russian locative address fragment: "в Невском 24", "на Литейном 12"
  const m3 = text.match(/(?:^|[^\p{L}])(в|на)\s+([А-Яа-яЁёA-Za-z.\-]{3,60}\s+\d{1,4}(?:\s*к\d+)*)\b/iu);
  if (m3) {
    const s = normalizeKnownRuStreetForms(String(m3[2] ?? '').trim()).slice(0, 120);
    if (s && !/^\d{1,2}:\d{2}$/.test(s)) return s;
  }
  // Word+number without explicit preposition: "Невском 24", "Литейном 12"
  const m4 = text.match(/\b([А-Яа-яЁёA-Za-z.\-]{3,60}\s+\d{1,4}(?:\s*к\d+)*)\b/u);
  if (m4) {
    const candidate = String(m4[1] ?? '').trim();
    if (candidate && (/(невск|литейн|tversk|тверск|ул\.?|улиц|просп|наб\.)/iu.test(candidate))) {
      const s = normalizeKnownRuStreetForms(candidate).slice(0, 120);
      if (s && !/^\d{1,2}:\d{2}$/.test(s)) return s;
    }
  }
  return null;
}

function isUrgentOrRisky(n: string): boolean {
  // Hard escalation triggers only (safety / violence / police / medical / fire / gas / flood).
  // Keep this intentionally narrow to avoid over-escalation.
  return (
    /\bpolice\b|\bambulance\b|\bfire\b|\bsmoke\b|\bgas\b|\bflood\b|\bthreat\b|\bviolent\b|\bfight\b/i.test(n) ||
    /полици|скорая|пожар|дым|газ|затоп|угроз|драка|насили/i.test(n)
  );
}

function normalizeFactsForOps(params: {
  category: TelegramOperationalCategory;
  rawText: string;
  guestName: string | null;
  propertySnippet: string | null;
  addressHint: string | null;
  timeHint: string | null;
  checkinHint: string | null;
  checkoutHint: string | null;
  urgencySignals: string[];
}): Record<string, unknown> {
  return {
    // Required extracted facts (ops-friendly keys)
    guest_name: params.guestName,
    property_hint: params.propertySnippet ?? (params.addressHint ? params.addressHint : null),
    address_hint: params.addressHint,
    checkin_hint: params.checkinHint,
    checkout_hint: params.checkoutHint,
    time_hint: params.timeHint,
    issue_type: params.category,
    urgency_signals: params.urgencySignals,
    // Back-compat / internal keys (kept for existing merges)
    guestName: params.guestName,
    property: params.propertySnippet ?? (params.addressHint ? params.addressHint : null),
    requestedTime: params.timeHint,
  };
}

function logEscalationMatrixDecision(params: {
  update_id: number;
  category: TelegramOperationalCategory;
  urgency_signals: string[];
  action: TelegramOperationalFinalAction;
  reason: string;
}): void {
  try {
    console.log(
      JSON.stringify({
        route: 'escalation_matrix',
        category: params.category,
        urgency_signals: params.urgency_signals,
        action: params.action,
        reason: params.reason,
        update_id: params.update_id,
      }),
    );
  } catch {
    // never throw from logging
  }
}

function pickSingleClarifyingQuestion(
  category: TelegramOperationalCategory,
  missingFacts: string[],
  ru: boolean,
): string {
  const key = missingFacts[0] ?? '';
  if (key === 'property') {
    return ru ? 'Уточните, пожалуйста, для какого объекта/адреса это?' : 'Which property/address is this for?';
  }
  if (key === 'requested_time') {
    return ru ? 'На какое время это нужно?' : 'What time do you need it for?';
  }
  if (key === 'requested_date') {
    return ru ? 'На какую дату это нужно?' : 'What date is this for?';
  }
  if (key === 'wifi_details') {
    return ru
      ? 'Что именно не работает: нет сети, не подключается или пароль не подходит?'
      : 'What exactly fails: no network, can’t connect, or password not working?';
  }
  if (key === 'payment_reference') {
    return ru
      ? 'Пришлите, пожалуйста, сумму и время/скрин оплаты (или последние 4 цифры карты), чтобы сверить.'
      : 'Please share the amount and time/screenshot of payment (or last 4 digits) so we can confirm.';
  }
  if (key === 'vehicle_details') {
    return ru ? 'Уточните, пожалуйста: вы на машине? Нужна парковка на ночь или на несколько часов?' : 'Are you arriving by car, and do you need overnight parking or short-term?';
  }
  if (key === 'cleaning_scope') {
    return ru ? 'Что нужно: уборка, смена полотенец или постельного белья?' : 'What do you need: cleaning, towel change, or linen change?';
  }
  if (key === 'noise_details') {
    return ru ? 'Шум сейчас продолжается? Это музыка/вечеринка или ремонт?' : 'Is the noise ongoing right now, and is it music/party or renovation?';
  }

  // Fallback question is still deterministic and category-scoped, never "generic fallback".
  return category === 'parking_question'
    ? ru
      ? 'Уточните, пожалуйста, у объекта нужен паркинг или рядом на улице?'
      : 'Do you need on-site parking or nearby street parking?'
    : ru
      ? 'Уточните, пожалуйста, один ключевой факт, чтобы помочь: для какого адреса/объекта это?'
      : 'Please share one key detail so we can help: which property/address is this for?';
}

function logIntake(
  params: TelegramOperationalIntakeParams,
  hit: TelegramOperationalIntakeHit,
): void {
  hit.reply = removeRuGenderPlaceholders(hit.reply);
  try {
    console.log(
      JSON.stringify({
        route: 'telegram_operational_intake',
        scenario: hit.category,
        category: hit.category,
        confidence: 1,
        extracted_facts: hit.extractedFacts,
        missing_facts: hit.missingFacts,
        final_action: hit.finalAction,
        urgency_signals: hit.urgencySignals,
        clarification_question_used: hit.finalAction === 'clarify',
        escalated: hit.finalAction === 'escalate_operator' || hit.finalAction === 'escalate_urgent',
        action_reason: hit.actionReason,
        update_id: params.update_id,
        chat_id: params.chat_id,
      }),
    );
  } catch {
    // never throw from logging
  }
}

/**
 * Returns a deterministic intake hit for Telegram operational guest-relay messages, or null.
 */
export function tryTelegramOperationalIntake(
  params: TelegramOperationalIntakeParams,
): TelegramOperationalIntakeHit | null {
  const raw = params.text ?? '';
  if (!raw.trim()) return null;

  const n = norm(raw);
  const loose = stripPunctForMatch(raw);
  const ru = params.surfaceLang === 'ru';

  const getMatrix = (category: TelegramOperationalCategory, missingFacts: string[]) =>
    decideEscalationMatrixV1({
      // categories match exactly; this narrows the union for TS
      category: category as any,
      text: raw,
      surfaceLang: params.surfaceLang,
      missingFacts,
    });

  // 1) Access / door code / lock / check-in access
  if (hasAccessIssueIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);
    const dateToken = extractDateLikeToken(loose);
    const cc = extractCheckinCheckoutHints(loose);
    const hasFail = hasFailureModeHint(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    if (!hasFail) missing.push('failure_mode');

    const facts: Record<string, unknown> = {
      ...normalizeFactsForOps({
        category: 'access_issue',
        rawText: raw,
        guestName: guest ?? null,
        propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
        addressHint: addr ?? null,
        timeHint: time ?? null,
        checkinHint: cc.checkin_hint,
        checkoutHint: cc.checkout_hint,
        urgencySignals: [],
      }),
      requestedDateToken: dateToken ?? null,
      failureModeHint: hasFail,
    };

    const matrix = getMatrix('access_issue', missing);
    let finalAction: TelegramOperationalFinalAction = matrix.action;
    (facts as any).urgency_signals = matrix.urgency_signals;

    // RU live rule: if guest is "right now at the entrance/door" and we have a property clue,
    // treat it as urgent access escalation.
    const urgentAtDoor =
      /сейчас\s+у\s+(входа|двери)|я\s+сейчас\s+у\s+(входа|двери)|прямо\s+сейчас\s+у\s+(входа|двери)/i.test(raw) ||
      /i'?m\s+at\s+the\s+(entrance|door)\s+now/i.test(raw);
    if (urgentAtDoor && hasProp) {
      finalAction = 'escalate_urgent';
      (facts as any).urgency_signals = Array.isArray((facts as any).urgency_signals)
        ? Array.from(new Set([...(facts as any).urgency_signals, 'at_door_now']))
        : ['at_door_now'];
    }
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял. Зафиксировал проблему с доступом (код/замок/дверь). Команда сейчас проверит и поможет гостю попасть внутрь.'
          : 'Understood — access issue logged (code/lock/door). Our team will verify and help the guest get inside now.'
        : finalAction === 'escalate_urgent'
          ? ru
            ? 'Понял. Похоже на срочную ситуацию с доступом. Передаю в операционную команду прямо сейчас.'
            : 'Understood. This looks urgent (access/safety). I’m escalating this now.'
          : finalAction === 'escalate_operator'
            ? ru
              ? 'Понял. Передаю проблему с доступом оператору для оперативного решения.'
              : 'Understood. I’m escalating the access issue to an operator for quick resolution.'
          : pickSingleClarifyingQuestion('access_issue', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'access_issue',
      reply,
      extractedFacts: facts,
      missingFacts: missing,
      finalAction,
      urgencySignals: matrix.urgency_signals,
      actionReason: matrix.reason,
    };
    logEscalationMatrixDecision({
      update_id: params.update_id,
      category: hit.category,
      urgency_signals: hit.urgencySignals,
      action: hit.finalAction,
      reason: hit.actionReason,
    });
    logIntake(params, hit);
    return hit;
  }

  // 2) No heating / cold apartment
  if (hasNoHeatingIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);
    const cc = extractCheckinCheckoutHints(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');

    const matrix = getMatrix('no_heating', missing);
    const finalAction: TelegramOperationalFinalAction = matrix.action;
    const reply =
      finalAction === 'escalate_urgent'
        ? ru
          ? 'Понял. Это срочно. Передаю заявку по отоплению в операционную команду прямо сейчас.'
          : 'Understood. This is urgent. I’m escalating the heating issue right now.'
        : finalAction === 'escalate_operator'
          ? ru
            ? 'Понял. Передаю заявку по отоплению оператору — вернёмся с обновлением.'
            : 'Understood. I’m escalating the heating issue to an operator and we’ll follow up shortly.'
        : finalAction === 'reply'
          ? ru
            ? 'Понял. Зафиксировал проблему с отоплением; команда проверит и вернётся с обновлением.'
            : 'Understood. Heating issue logged; the team will check and update you shortly.'
          : pickSingleClarifyingQuestion('no_heating', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'no_heating',
      reply,
      extractedFacts: normalizeFactsForOps({
        category: 'no_heating',
        rawText: raw,
        guestName: guest ?? null,
        propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
        addressHint: addr ?? null,
        timeHint: time ?? null,
        checkinHint: cc.checkin_hint,
        checkoutHint: cc.checkout_hint,
        urgencySignals: matrix.urgency_signals,
      }),
      missingFacts: missing,
      finalAction,
      urgencySignals: matrix.urgency_signals,
      actionReason: matrix.reason,
    };
    logEscalationMatrixDecision({
      update_id: params.update_id,
      category: hit.category,
      urgency_signals: hit.urgencySignals,
      action: hit.finalAction,
      reason: hit.actionReason,
    });
    logIntake(params, hit);
    return hit;
  }

  // 2b) No hot water
  if (hasNoHotWaterIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);
    const cc = extractCheckinCheckoutHints(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');

    const matrix = getMatrix('no_hot_water', missing);
    const finalAction: TelegramOperationalFinalAction = matrix.action;
    const reply =
      finalAction === 'escalate_urgent'
        ? ru
          ? 'Понял. Это срочно. Передаю заявку по горячей воде в операционную команду прямо сейчас.'
          : 'Understood. This is urgent. I’m escalating the hot water issue right now.'
        : finalAction === 'escalate_operator'
          ? ru
            ? 'Понял. Передаю заявку по горячей воде оператору — вернёмся с обновлением.'
            : 'Understood. I’m escalating the hot water issue to an operator and we’ll follow up shortly.'
        : finalAction === 'reply'
          ? ru
            ? 'Понял. Зафиксировал проблему с горячей водой; команда проверит и вернётся с обновлением.'
            : 'Understood. Hot water issue logged; the team will check and update you shortly.'
          : pickSingleClarifyingQuestion('no_hot_water', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'no_hot_water',
      reply,
      extractedFacts: normalizeFactsForOps({
        category: 'no_hot_water',
        rawText: raw,
        guestName: guest ?? null,
        propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
        addressHint: addr ?? null,
        timeHint: time ?? null,
        checkinHint: cc.checkin_hint,
        checkoutHint: cc.checkout_hint,
        urgencySignals: matrix.urgency_signals,
      }),
      missingFacts: missing,
      finalAction,
      urgencySignals: matrix.urgency_signals,
      actionReason: matrix.reason,
    };
    logEscalationMatrixDecision({
      update_id: params.update_id,
      category: hit.category,
      urgency_signals: hit.urgencySignals,
      action: hit.finalAction,
      reason: hit.actionReason,
    });
    logIntake(params, hit);
    return hit;
  }

  // 3) Late checkout
  if (hasLateCheckoutIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);
    const dateToken = extractDateLikeToken(loose);
    const cc = extractCheckinCheckoutHints(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');

    const matrix = getMatrix('late_checkout', missing);
    const finalAction: TelegramOperationalFinalAction = matrix.action;
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял. Зафиксировал запрос на поздний выезд; проверим возможность и вернёмся с ответом.'
          : 'Understood. I’ve logged the late checkout request and will confirm availability shortly.'
        : finalAction === 'escalate_operator'
          ? ru
            ? 'Понял. Передаю запрос на поздний выезд оператору для проверки и подтверждения.'
            : 'Understood. I’m escalating the late checkout request to an operator to verify and confirm.'
          : finalAction === 'escalate_urgent'
            ? ru
              ? 'Понял. Это срочно. Передаю оператору прямо сейчас.'
              : 'Understood. This is urgent. Escalating to an operator right now.'
        : pickSingleClarifyingQuestion('late_checkout', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'late_checkout',
      reply,
      extractedFacts: {
        ...normalizeFactsForOps({
          category: 'late_checkout',
          rawText: raw,
          guestName: guest ?? null,
          propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
          addressHint: addr ?? null,
          timeHint: time ?? null,
          checkinHint: cc.checkin_hint,
          checkoutHint: cc.checkout_hint,
          urgencySignals: matrix.urgency_signals,
        }),
        requestedDateToken: dateToken ?? null,
      },
      missingFacts: missing,
      finalAction,
      urgencySignals: matrix.urgency_signals,
      actionReason: matrix.reason,
    };
    logEscalationMatrixDecision({
      update_id: params.update_id,
      category: hit.category,
      urgency_signals: hit.urgencySignals,
      action: hit.finalAction,
      reason: hit.actionReason,
    });
    logIntake(params, hit);
    return hit;
  }

  // 4) Check-in time policy. A concrete normal-time check-in question still deserves
  // a deterministic answer, even when the guest did not call it "early".
  const earlyCheckinTime = extractTimeLike(raw);
  const checkinTimePolicy = classifyCheckinTimeBucket(earlyCheckinTime);
  const shouldExplainCheckinTime =
    hasCheckinArrivalIntent(loose) &&
    Boolean(earlyCheckinTime) &&
    (checkinTimePolicy.bucket === 'normal_checkin' || checkinTimePolicy.bucket === 'late_checkin');

  if (shouldExplainCheckinTime) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const dateToken = extractDateLikeToken(loose);
    const cc = extractCheckinCheckoutHints(loose);
    const missing: string[] = [];
    if (!hasProp) missing.push('property');

    const finalAction: TelegramOperationalFinalAction = hasProp ? 'reply' : 'clarify';
    const hit: TelegramOperationalIntakeHit = {
      category: 'checkin_time_question',
      reply: ru
        ? buildRuCheckinTimePolicyReply({
            bucket: checkinTimePolicy.bucket,
            time: earlyCheckinTime,
            hasProperty: hasProp,
          })
        : hasProp
          ? 'Understood. I’ll verify the property readiness and access instructions for that check-in time.'
          : 'Understood. Which property is this for? I’ll verify readiness and access instructions for that check-in time.',
      extractedFacts: {
        ...normalizeFactsForOps({
          category: 'checkin_time_question',
          rawText: raw,
          guestName: guest ?? null,
          propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
          addressHint: addr ?? null,
          timeHint: earlyCheckinTime ?? null,
          checkinHint: cc.checkin_hint,
          checkoutHint: cc.checkout_hint,
          urgencySignals: [],
        }),
        requestedDateToken: dateToken ?? null,
        checkin_time_bucket: checkinTimePolicy.bucket,
        checkin_time_policy: checkinTimePolicy.policy,
        is_early_checkin_by_time: checkinTimePolicy.isEarlyCheckinByTime,
        requires_cleaning_availability: checkinTimePolicy.requiresCleaningAvailability,
      },
      missingFacts: missing,
      finalAction,
      urgencySignals: [],
      actionReason: hasProp ? 'checkin_time_policy:property_present' : 'checkin_time_policy:missing_property',
    };
    logIntake(params, hit);
    return hit;
  }

  if (hasEarlyCheckinIntent(loose, checkinTimePolicy.bucket)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = earlyCheckinTime;
    const dateToken = extractDateLikeToken(loose);
    const cc = extractCheckinCheckoutHints(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');

    const matrix = getMatrix('early_checkin', missing);
    const finalAction: TelegramOperationalFinalAction = matrix.action;
    const reply =
      finalAction === 'reply'
        ? ru
          ? buildRuCheckinTimePolicyReply({
              bucket: checkinTimePolicy.bucket,
              time,
              hasProperty: hasProp,
            })
          : 'Understood. I’ve logged the early check-in request and will confirm availability shortly.'
        : finalAction === 'escalate_operator'
          ? ru
            ? 'Понял. Передаю запрос на заезд оператору для проверки и подтверждения.'
            : 'Understood. I’m escalating the early check-in request to an operator to verify and confirm.'
          : finalAction === 'escalate_urgent'
            ? ru
              ? 'Понял. Это срочно. Передаю оператору прямо сейчас.'
              : 'Understood. This is urgent. Escalating to an operator right now.'
        : ru
          ? buildRuCheckinTimePolicyReply({
              bucket: checkinTimePolicy.bucket,
              time,
              hasProperty: hasProp,
            })
          : pickSingleClarifyingQuestion('early_checkin', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'early_checkin',
      reply,
      extractedFacts: {
        ...normalizeFactsForOps({
          category: 'early_checkin',
          rawText: raw,
          guestName: guest ?? null,
          propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
          addressHint: addr ?? null,
          timeHint: time ?? null,
          checkinHint: cc.checkin_hint,
          checkoutHint: cc.checkout_hint,
          urgencySignals: matrix.urgency_signals,
        }),
        requestedDateToken: dateToken ?? null,
        checkin_time_bucket: checkinTimePolicy.bucket,
        checkin_time_policy: checkinTimePolicy.policy,
        is_early_checkin_by_time: checkinTimePolicy.isEarlyCheckinByTime,
        requires_cleaning_availability: checkinTimePolicy.requiresCleaningAvailability,
      },
      missingFacts: missing,
      finalAction,
      urgencySignals: matrix.urgency_signals,
      actionReason: matrix.reason,
    };
    logEscalationMatrixDecision({
      update_id: params.update_id,
      category: hit.category,
      urgency_signals: hit.urgencySignals,
      action: hit.finalAction,
      reason: hit.actionReason,
    });
    logIntake(params, hit);
    return hit;
  }

  // 5) Noise complaint
  if (hasNoiseComplaintIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);
    const cc = extractCheckinCheckoutHints(loose);
    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    // "noise" / "шум" alone is not enough — ask what kind (party/music/renovation/etc).
    const hasAnyNoiseKeyword = /\bnoise\b|\bloud\b|шум|громк/i.test(loose);
    const hasTypeKeyword = /(party|music|neighbor|neighbou?r|shouting|scream|ремонт|музык|сосед|вечеринк|крики?|орут|сверлят)/i.test(
      loose,
    );
    if (hasAnyNoiseKeyword && !hasTypeKeyword) missing.push('noise_details');

    const matrix = getMatrix('noise_complaint', missing);
    const finalAction: TelegramOperationalFinalAction = matrix.action;
    const reply =
      finalAction === 'escalate_urgent'
        ? ru
          ? 'Понял. Это срочно. Передаю шумовую жалобу в операционную команду прямо сейчас.'
          : 'Understood. This is urgent. I’m escalating the noise complaint to the ops team now.'
        : finalAction === 'escalate_operator'
          ? ru
            ? 'Понял. Передаю шумовую жалобу оператору для оперативного решения.'
            : 'Understood. I’m escalating the noise complaint to an operator for quick resolution.'
        : finalAction === 'reply'
          ? ru
            ? 'Понял. Зафиксировал жалобу на шум; команда свяжется и постарается быстро решить.'
            : 'Understood. Noise complaint logged; the team will reach out and resolve it as quickly as possible.'
          : pickSingleClarifyingQuestion('noise_complaint', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'noise_complaint',
      reply,
      extractedFacts: normalizeFactsForOps({
        category: 'noise_complaint',
        rawText: raw,
        guestName: guest ?? null,
        propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
        addressHint: addr ?? null,
        timeHint: time ?? null,
        checkinHint: cc.checkin_hint,
        checkoutHint: cc.checkout_hint,
        urgencySignals: matrix.urgency_signals,
      }),
      missingFacts: missing,
      finalAction,
      urgencySignals: matrix.urgency_signals,
      actionReason: matrix.reason,
    };
    logEscalationMatrixDecision({
      update_id: params.update_id,
      category: hit.category,
      urgency_signals: hit.urgencySignals,
      action: hit.finalAction,
      reason: hit.actionReason,
    });
    logIntake(params, hit);
    return hit;
  }

  // 6) Cleaning request (incl. towels/linen)
  if (hasCleaningRequestIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const time = extractTimeLike(raw);
    const dateToken = extractDateLikeToken(loose);
    const cc = extractCheckinCheckoutHints(loose);
    const wantsTowels = /\btowel/i.test(loose) || /полотенц/i.test(loose);
    const wantsLinen = /\blinen|beds?/i.test(loose) || /постел|бель/i.test(loose);
    // Require explicit cleaning words; "housekeeping/service/горничная" without details should trigger clarification.
    const wantsCleaning = /\bclean\b|\bcleaning\b/i.test(loose) || /уборк|клининг/i.test(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    if (!(wantsTowels || wantsLinen || wantsCleaning)) missing.push('cleaning_scope');

    const matrix = getMatrix('cleaning_request', missing);
    const finalAction: TelegramOperationalFinalAction = matrix.action;
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял. Зафиксировал запрос на уборку/сервис; согласуем время и вернёмся с подтверждением.'
          : 'Understood. Housekeeping request logged; we’ll coordinate timing and confirm shortly.'
        : finalAction === 'escalate_operator'
          ? ru
            ? 'Понял. Передаю запрос на уборку оператору для согласования.'
            : 'Understood. I’m escalating the housekeeping request to an operator to coordinate.'
          : finalAction === 'escalate_urgent'
            ? ru
              ? 'Понял. Это срочно. Передаю оператору прямо сейчас.'
              : 'Understood. This is urgent. Escalating to an operator right now.'
        : pickSingleClarifyingQuestion('cleaning_request', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'cleaning_request',
      reply,
      extractedFacts: {
        ...normalizeFactsForOps({
          category: 'cleaning_request',
          rawText: raw,
          guestName: guest ?? null,
          propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
          addressHint: addr ?? null,
          timeHint: time ?? null,
          checkinHint: cc.checkin_hint,
          checkoutHint: cc.checkout_hint,
          urgencySignals: matrix.urgency_signals,
        }),
        requestedDateToken: dateToken ?? null,
        scope: { cleaning: wantsCleaning, towels: wantsTowels, linen: wantsLinen },
      },
      missingFacts: missing,
      finalAction,
      urgencySignals: matrix.urgency_signals,
      actionReason: matrix.reason,
    };
    logEscalationMatrixDecision({
      update_id: params.update_id,
      category: hit.category,
      urgency_signals: hit.urgencySignals,
      action: hit.finalAction,
      reason: hit.actionReason,
    });
    logIntake(params, hit);
    return hit;
  }

  // 7) Extension request (stay longer)
  if (hasExtensionRequestIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const dateToken = extractDateLikeToken(loose);
    const time = extractTimeLike(raw);
    const cc = extractCheckinCheckoutHints(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');

    const matrix = getMatrix('extension_request', missing);
    const finalAction: TelegramOperationalFinalAction = matrix.action;
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял. Зафиксировал запрос на продление проживания; проверим доступность и стоимость и вернёмся с ответом.'
          : 'Understood. Extension request logged; we’ll confirm availability and pricing shortly.'
        : finalAction === 'escalate_operator'
          ? ru
            ? 'Понял. Передаю запрос на продление оператору для проверки доступности и стоимости.'
            : 'Understood. I’m escalating the extension request to an operator to verify availability and pricing.'
          : finalAction === 'escalate_urgent'
            ? ru
              ? 'Понял. Это срочно. Передаю оператору прямо сейчас.'
              : 'Understood. This is urgent. Escalating to an operator right now.'
        : pickSingleClarifyingQuestion('extension_request', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'extension_request',
      reply,
      extractedFacts: {
        ...normalizeFactsForOps({
          category: 'extension_request',
          rawText: raw,
          guestName: guest ?? null,
          propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
          addressHint: addr ?? null,
          timeHint: time ?? null,
          checkinHint: cc.checkin_hint,
          checkoutHint: cc.checkout_hint,
          urgencySignals: matrix.urgency_signals,
        }),
        requestedDateToken: dateToken ?? null,
      },
      missingFacts: missing,
      finalAction,
      urgencySignals: matrix.urgency_signals,
      actionReason: matrix.reason,
    };
    logEscalationMatrixDecision({
      update_id: params.update_id,
      category: hit.category,
      urgency_signals: hit.urgencySignals,
      action: hit.finalAction,
      reason: hit.actionReason,
    });
    logIntake(params, hit);
    return hit;
  }

  // 8) Wi‑Fi issue
  if (hasWifiIssueIntent(loose) && !hasPaymentConfirmationIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const cc = extractCheckinCheckoutHints(loose);
    const hasDetails =
      /\bpassword\b|\bwrong\b|\bdoesn'?t\s+work\b|\bcan'?t\s+connect\b|\bno\s+internet\b|\brouter\b/i.test(loose) ||
      /парол|не\s+подход|не\s+работает|не\s+подключ|нет\s+интернет|роутер/i.test(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    if (!hasDetails) missing.push('wifi_details');

    const matrix = getMatrix('wifi_issue', missing);
    const finalAction: TelegramOperationalFinalAction = matrix.action;
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял. Зафиксировал проблему с Wi‑Fi; команда проверит сеть/пароль и вернётся с решением.'
          : 'Understood. Wi‑Fi issue logged; the team will check the network/password and get back with a fix.'
        : finalAction === 'escalate_operator'
          ? ru
            ? 'Понял. Передаю проблему с Wi‑Fi оператору для проверки и решения.'
            : 'Understood. I’m escalating the Wi‑Fi issue to an operator to check and resolve.'
          : finalAction === 'escalate_urgent'
            ? ru
              ? 'Понял. Это срочно. Передаю оператору прямо сейчас.'
              : 'Understood. This is urgent. Escalating to an operator right now.'
        : pickSingleClarifyingQuestion('wifi_issue', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'wifi_issue',
      reply,
      extractedFacts: {
        ...normalizeFactsForOps({
          category: 'wifi_issue',
          rawText: raw,
          guestName: guest ?? null,
          propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
          addressHint: addr ?? null,
          timeHint: null,
          checkinHint: cc.checkin_hint,
          checkoutHint: cc.checkout_hint,
          urgencySignals: matrix.urgency_signals,
        }),
        hasDetails,
      },
      missingFacts: missing,
      finalAction,
      urgencySignals: matrix.urgency_signals,
      actionReason: matrix.reason,
    };
    logEscalationMatrixDecision({
      update_id: params.update_id,
      category: hit.category,
      urgency_signals: hit.urgencySignals,
      action: hit.finalAction,
      reason: hit.actionReason,
    });
    logIntake(params, hit);
    return hit;
  }

  // 9) Parking question
  if (hasParkingQuestionIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const cc = extractCheckinCheckoutHints(loose);
    const hasVehicleDetails = /\bcar\b|\bvehicle\b|\bplate\b|\bparking\s+overnight\b/i.test(loose) || /машин|авто|номер\s+машин/i.test(loose);

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    else if (!hasVehicleDetails) missing.push('vehicle_details');

    const matrix = getMatrix('parking_question', missing);
    const finalAction: TelegramOperationalFinalAction = matrix.action;
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял. Уточню правила парковки для этого адреса и вернусь с инструкцией (где можно/нельзя, платно/бесплатно).'
          : 'Understood. I’ll confirm parking options for this address and return with clear instructions (where to park, paid/free).'
        : finalAction === 'escalate_operator'
          ? ru
            ? 'Понял. Передаю вопрос по парковке оператору для уточнения правил по адресу.'
            : 'Understood. I’m escalating the parking question to an operator to confirm the exact rules for this address.'
          : finalAction === 'escalate_urgent'
            ? ru
              ? 'Понял. Это срочно. Передаю оператору прямо сейчас.'
              : 'Understood. This is urgent. Escalating to an operator right now.'
        : pickSingleClarifyingQuestion('parking_question', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'parking_question',
      reply,
      extractedFacts: {
        ...normalizeFactsForOps({
          category: 'parking_question',
          rawText: raw,
          guestName: guest ?? null,
          propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
          addressHint: addr ?? null,
          timeHint: null,
          checkinHint: cc.checkin_hint,
          checkoutHint: cc.checkout_hint,
          urgencySignals: matrix.urgency_signals,
        }),
        hasVehicleDetails,
      },
      missingFacts: missing,
      finalAction,
      urgencySignals: matrix.urgency_signals,
      actionReason: matrix.reason,
    };
    logEscalationMatrixDecision({
      update_id: params.update_id,
      category: hit.category,
      urgency_signals: hit.urgencySignals,
      action: hit.finalAction,
      reason: hit.actionReason,
    });
    logIntake(params, hit);
    return hit;
  }

  // 10) Payment confirmation (guest says they paid)
  if (hasPaymentConfirmationIntent(loose)) {
    const guest = extractGuestName(raw);
    const prop = extractPropertySnippet(raw);
    const addr = extractAddressHint(raw);
    const hasProp = hasPropertyHint(raw, loose);
    const amount = extractAmountLike(raw);
    const time = extractTimeLike(raw);
    const cc = extractCheckinCheckoutHints(loose);
    const hasReference = Boolean(amount || time || /\breceipt\b|\bscreenshot\b/i.test(loose) || /чек|скрин/i.test(loose));

    const missing: string[] = [];
    if (!hasProp) missing.push('property');
    if (!hasReference) missing.push('payment_reference');

    const matrix = getMatrix('payment_confirmation', missing);
    const finalAction: TelegramOperationalFinalAction = matrix.action;
    const reply =
      finalAction === 'reply'
        ? ru
          ? 'Понял. Спасибо — передаю подтверждение оплаты в операционную команду для сверки. Если есть чек/скрин, пришлите — это ускорит.'
          : 'Understood, thank you — I’m forwarding the payment confirmation to ops to verify. If you have a receipt/screenshot, please share it to speed things up.'
        : finalAction === 'escalate_operator'
          ? ru
            ? 'Понял. Есть признаки расхождения по оплате/брони. Передаю оператору для проверки и решения.'
            : 'Understood. There are signs of a payment/booking mismatch. I’m escalating to an operator to verify and resolve.'
          : finalAction === 'escalate_urgent'
            ? ru
              ? 'Понял. Это срочно. Передаю оператору прямо сейчас.'
              : 'Understood. This is urgent. Escalating to an operator right now.'
        : pickSingleClarifyingQuestion('payment_confirmation', missing, ru);

    const hit: TelegramOperationalIntakeHit = {
      category: 'payment_confirmation',
      reply,
      extractedFacts: {
        ...normalizeFactsForOps({
          category: 'payment_confirmation',
          rawText: raw,
          guestName: guest ?? null,
          propertySnippet: prop ?? (hasProp ? 'hint_present' : null),
          addressHint: addr ?? null,
          timeHint: time ?? null,
          checkinHint: cc.checkin_hint,
          checkoutHint: cc.checkout_hint,
          urgencySignals: matrix.urgency_signals,
        }),
        amount: amount ?? null,
      },
      missingFacts: missing,
      finalAction,
      urgencySignals: matrix.urgency_signals,
      actionReason: matrix.reason,
    };
    logEscalationMatrixDecision({
      update_id: params.update_id,
      category: hit.category,
      urgency_signals: hit.urgencySignals,
      action: hit.finalAction,
      reason: hit.actionReason,
    });
    logIntake(params, hit);
    return hit;
  }

  return null;
}
