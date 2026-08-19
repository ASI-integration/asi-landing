import { sanitizeGuestFacingReply } from './guest-facing-ru';
import {
  composeGuestCheckoutReplyRu,
  composeGuestDirectionsReplyRu,
  composeGuestParkingReplyRu,
  composeGuestWifiReplyRu,
  type TelegramPropertyObjectV1,
} from './telegram-booking-object-memory';
import type { GroundedKnowledge } from './types';

export const AUTOPILOT_MISSING_KNOWLEDGE_REPLY_RU =
  'У меня пока нет точной информации по этому вопросу. Уточняю у владельца.';

export type KnowledgeTopic =
  | 'checkin_time'
  | 'checkout_time'
  | 'wifi'
  | 'address'
  | 'parking'
  | 'waste'
  | 'baby_crib'
  | 'support'
  | 'checkin_instructions'
  | 'house_rules'
  | 'deposit'
  | 'reporting_documents'
  | 'pets'
  | 'keys'
  | 'unknown';

export type KnowledgeSourceLayer = 'object' | 'passport' | 'rules' | 'instructions' | 'faq' | 'system';

export type KnowledgeResolverResult = {
  topic: KnowledgeTopic;
  found: boolean;
  reply: string | null;
  missingFields: string[];
  source: KnowledgeSourceLayer | null;
};

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

export function classifyKnowledgeTopic(messageText: string): KnowledgeTopic {
  const lower = messageText
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Common short-voice STT joins: «во сколько» may arrive as «восколько»/«васколько».
    .replace(/\b(?:восколько|васколько)\b/g, 'во сколько');

  if (/возврат|вернуть деньги|компенсац|скидк|жалоб|конфликт|отмен.*брон|юрист|закон|угроз|ужасн|плохой сервис/i.test(lower)) {
    return 'unknown';
  }
  if (/wi-?fi|вай-?фай|вайфа|парол.*(?:сет|wi|вай|интернет)|интернет|^пароль\??$|internet password|network password/i.test(lower)) return 'wifi';
  if (/адрес|как добраться|где наход|как найти|как доехать|address|directions|how (?:do i|to) get there|where is (?:it|the property)/i.test(lower)) return 'address';
  if (/парков|parking|where (?:can|do) i park/i.test(lower)) return 'parking';
  if (/мусор|контейнер|куда выброс|waste|trash|garbage|bins?/i.test(lower)) return 'waste';
  if (/детск.*кроват|кроватк|люльк|baby crib|cot for (?:a )?baby/i.test(lower)) return 'baby_crib';
  if (/как связаться.*(?:поддерж|оператор)|контакт.*поддерж|что ты умеешь|чем можешь помочь|contact support|reach (?:support|an operator)|what can you (?:do|help with)/i.test(lower)) return 'support';
  if (/засел|инструкц.*(?:заезд|заех)|как попасть|ключ|домофон|код.*двер|check-?in instructions|how (?:do i|to) enter|door code|keys?/i.test(lower)) {
    if (/ключ|домофон|код|door code|keys?/i.test(lower) && !/засел|заех|check-?in/i.test(lower)) return 'keys';
    return 'checkin_instructions';
  }
  if (
    /во сколько.*(?:заезд|заех|засел)|(?:когда|во сколько).*(?:можно|можно ли).*(?:заех|засел)|время.*(?:заезд|засел)|раньше|пораньше|ранн.*(?:заезд|заех|приезд|приех)|приех.*раньше|check-?in time|what time.*check-?in|early check-?in/i.test(
      lower,
    )
  ) {
    return 'checkin_time';
  }
  if (
    /во сколько.*(?:выезд|выех)|(?:когда|до скольк).*(?:выезд|выех)|время.*(?:выезд|выех)|поздн.*(?:выезд|выех)|(?:можно|можно ли).*выех|выех.*позже|чек[\s-]?аут|check-?out time|what time.*check-?out|late check-?out/i.test(
      lower,
    )
  ) {
    return 'checkout_time';
  }
  if (/правил|тишин|шум|громк|музык|курить|курени|вечерин|приглас.*гост|сторонн.*гост|house rules|smoking|party|quiet hours|loud|music|extra guest|occupancy/i.test(lower)) return 'house_rules';
  if (/животн|собак|кошк|питомц|\bpets?\b|\bdogs?\b|\bcats?\b/i.test(lower)) return 'pets';
  if (/залог|депозит/i.test(lower)) return 'deposit';
  if (/документ|справк|чек(?![\s-]?аут)|квитанц|отчетн/i.test(lower)) return 'reporting_documents';

  return 'unknown';
}

function resolveEnglishKnowledgeAnswer(input: {
  topic: KnowledgeTopic;
  property: TelegramPropertyObjectV1 | null;
  bookingVerified: boolean;
  passport?: GroundedKnowledge | null;
  faq?: Record<string, string> | null;
}): KnowledgeResolverResult {
  const { topic, property, bookingVerified } = input;
  const ok = (reply: string, source: KnowledgeSourceLayer): KnowledgeResolverResult => ({
    topic,
    found: true,
    reply: sanitizeGuestFacingReply(reply),
    missingFields: [],
    source,
  });
  const missing = (fields: string[]): KnowledgeResolverResult => ({
    topic,
    found: false,
    reply: null,
    missingFields: fields,
    source: null,
  });
  if (topic === 'wifi') {
    if (!bookingVerified) return missing(['booking.reference']);
    const name = textOrNull(property?.wifi_name);
    const password = textOrNull(property?.wifi_password);
    return name && password ? ok(`Wi-Fi network: ${name}. Password: ${password}.`, 'object') : missing(['object.wifiName', 'object.wifiPassword']);
  }
  if (topic === 'address') {
    const address = textOrNull(property?.address);
    const directions = textOrNull(property?.directions_text);
    const reply = [address ? `Address: ${address}.` : null, directions ? `Directions: ${directions}` : null].filter(Boolean).join(' ');
    return reply ? ok(reply, 'object') : missing(['object.address', 'object.directionsText']);
  }
  if (topic === 'parking') {
    const parking = textOrNull(property?.parking_text);
    return parking ? ok(`Parking: ${parking}`, 'object') : missing(['object.parkingText']);
  }
  if (topic === 'waste') {
    const waste = textOrNull(property?.waste_disposal_text) ?? textOrNull(property?.trash_bins_location);
    return waste ? ok(`Waste disposal: ${waste}`, 'object') : missing(['object.waste_disposal_text', 'object.trash_bins_location']);
  }
  if (topic === 'baby_crib') {
    if (!property) return missing(['object.baby_crib_available']);
    const note = textOrNull(property.baby_crib_note);
    return ok(
      property.baby_crib_available
        ? `A baby crib is available.${note ? ` ${note}` : ''}`
        : 'A baby crib is not listed as available for this property.',
      'object',
    );
  }
  if (topic === 'support') {
    return ok('You can ask for help here. If an operator must act or approve something, I will pass the request for review.', 'system');
  }
  if (topic === 'checkin_time') {
    const value = textOrNull(property?.check_in_text) ?? textOrNull(input.passport?.checkInInstructions);
    return value && value !== 'Information unavailable.' ? ok(`Check-in: ${value}`, 'instructions') : missing(['object.check_in_text']);
  }
  if (topic === 'checkout_time') {
    const value = textOrNull(property?.checkout_time) ?? textOrNull(input.passport?.checkOutInstructions);
    return value && value !== 'Information unavailable.' ? ok(`Checkout: ${value}`, 'instructions') : missing(['object.checkout_time']);
  }
  if (topic === 'checkin_instructions' || topic === 'keys') {
    if (!bookingVerified) return missing(['booking.reference']);
    const value = [property?.address, property?.directions_text, property?.check_in_text, property?.door_code_notes]
      .map(textOrNull)
      .filter(Boolean)
      .join(' ');
    return value ? ok(value, 'instructions') : missing(['object.check_in_text', 'object.door_code_notes']);
  }
  if (topic === 'house_rules' || topic === 'pets') {
    const rules = textOrNull(property?.house_rules_text);
    if (rules) return ok(`House rules: ${rules}`, 'rules');
    const faqReply = replyFromFaq(input.faq, topic);
    return faqReply ? ok(faqReply, 'faq') : missing([topic === 'pets' ? 'object.petsPolicy' : 'object.house_rules_text']);
  }
  const passportReply = replyFromPassport(input.passport, topic);
  if (passportReply) return ok(passportReply, 'passport');
  const faqReply = replyFromFaq(input.faq, topic);
  return faqReply ? ok(faqReply, 'faq') : missing([`object.${topic}`]);
}

function replyFromHouseRules(property: TelegramPropertyObjectV1 | null, topic: 'house_rules' | 'pets'): string | null {
  const rules = textOrNull(property?.house_rules_text);
  if (!rules) return null;
  if (topic === 'pets') {
    const petLine = rules
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /животн|собак|кошк|питомц/i.test(line));
    if (petLine) return sanitizeGuestFacingReply(petLine);
    if (/животн|собак|кошк|питомц/i.test(rules)) return sanitizeGuestFacingReply(rules);
    return sanitizeGuestFacingReply(
      `В правилах объекта отдельно про животных не указано. Основные правила: ${rules}.`,
    );
  }
  return sanitizeGuestFacingReply(`Правила проживания: ${rules}`);
}

function replyFromPassport(passport: GroundedKnowledge | null | undefined, topic: KnowledgeTopic): string | null {
  if (!passport) return null;
  if (topic === 'deposit') {
    const payment = textOrNull(passport.paymentRules);
    if (payment && payment !== 'Information unavailable.') return sanitizeGuestFacingReply(`Залог: ${payment}`);
  }
  if (topic === 'reporting_documents') {
    const policy = textOrNull(passport.propertyPolicy);
    if (policy && policy !== 'Information unavailable.' && /документ|справк|чек|квитанц/i.test(policy)) {
      return sanitizeGuestFacingReply(policy);
    }
  }
  return null;
}

function replyFromFaq(faq: Record<string, string> | null | undefined, topic: KnowledgeTopic): string | null {
  if (!faq) return null;
  const keysByTopic: Partial<Record<KnowledgeTopic, string[]>> = {
    deposit: ['deposit', 'deposit_text', 'залог'],
    reporting_documents: ['reporting_documents', 'documents', 'receipt_info'],
    pets: ['pets', 'pets_allowed', 'animals'],
    keys: ['keys', 'key_pickup', 'access_keys'],
  };
  const keys = keysByTopic[topic] ?? [];
  for (const key of keys) {
    const value = textOrNull(faq[key]);
    if (value) return sanitizeGuestFacingReply(value);
  }
  return null;
}

export function resolveKnowledgeAnswer(input: {
  topic: KnowledgeTopic;
  messageText: string;
  property: TelegramPropertyObjectV1 | null;
  bookingVerified: boolean;
  passport?: GroundedKnowledge | null;
  faq?: Record<string, string> | null;
  language?: 'ru' | 'en';
}): KnowledgeResolverResult {
  const { topic, property, bookingVerified, passport, faq } = input;
  if (input.language === 'en') {
    return resolveEnglishKnowledgeAnswer({ topic, property, bookingVerified, passport, faq });
  }
  const missingFields: string[] = [];

  const found = (reply: string | null, source: KnowledgeSourceLayer, missing: string[] = []): KnowledgeResolverResult => ({
    topic,
    found: Boolean(reply),
    reply,
    missingFields: missing,
    source: reply ? source : null,
  });

  switch (topic) {
    case 'wifi': {
      const reply = composeGuestWifiReplyRu({ property, verified: bookingVerified || Boolean(property?.wifi_name) });
      if (/уточните номер бронирования/i.test(reply)) {
        return found(null, 'object', ['object.wifiName', 'object.wifiPassword']);
      }
      return found(sanitizeGuestFacingReply(reply), 'object');
    }
    case 'address': {
      const reply = composeGuestDirectionsReplyRu(property);
      return found(reply, 'object', reply ? [] : ['object.address', 'object.directionsText']);
    }
    case 'parking': {
      const reply = composeGuestParkingReplyRu(property);
      return found(reply, 'object', reply ? [] : ['object.parkingText']);
    }
    case 'waste': {
      const waste = textOrNull(property?.waste_disposal_text) ?? textOrNull(property?.trash_bins_location);
      return waste
        ? found(sanitizeGuestFacingReply(`Мусор: ${waste}`), 'object')
        : found(null, 'object', ['object.waste_disposal_text', 'object.trash_bins_location']);
    }
    case 'baby_crib': {
      if (!property) return found(null, 'object', ['object.baby_crib_available']);
      const note = textOrNull(property.baby_crib_note);
      const reply = property.baby_crib_available
        ? `Детская кроватка доступна.${note ? ` ${note}` : ''}`
        : 'Детская кроватка для этого объекта не указана как доступная.';
      return found(sanitizeGuestFacingReply(reply), 'object');
    }
    case 'support':
      return found(
        'Напишите здесь, чем помочь. Если потребуется действие или решение оператора, я передам вопрос на проверку.',
        'system',
      );
    case 'checkin_time': {
      const checkIn = textOrNull(property?.check_in_text);
      const earlyRequest = /ранн|раньше|пораньше/i.test(input.messageText);
      if (checkIn) {
        const reply = earlyRequest
          ? `Заезд: ${checkIn} Ранний заезд возможен только по согласованию — напишите, если нужно передать запрос.`
          : `Заезд: ${checkIn}`;
        return found(sanitizeGuestFacingReply(reply), 'instructions');
      }
      missingFields.push('object.check_in_text');
      const passportReply = textOrNull(passport?.checkInInstructions);
      if (passportReply && passportReply !== 'Information unavailable.') {
        return found(sanitizeGuestFacingReply(`Заезд: ${passportReply}`), 'passport');
      }
      return found(null, 'instructions', missingFields);
    }
    case 'checkout_time': {
      const lateRequest = /поздн|позже|подольше/i.test(input.messageText);
      const reply = composeGuestCheckoutReplyRu(property);
      if (reply) {
        const enriched = lateRequest
          ? `${reply} Поздний выезд возможен только по согласованию — напишите, если нужно передать запрос.`
          : reply;
        return found(sanitizeGuestFacingReply(enriched), 'object');
      }
      const checkout = textOrNull(passport?.checkOutInstructions);
      if (checkout && checkout !== 'Information unavailable.') return found(sanitizeGuestFacingReply(checkout), 'passport');
      return found(null, 'object', ['object.checkout_time']);
    }
    case 'checkin_instructions': {
      if (!bookingVerified) return found(null, 'instructions', ['booking.reference']);
      const parts: string[] = [];
      const address = textOrNull(property?.address);
      const directions = textOrNull(property?.directions_text);
      const checkIn = textOrNull(property?.check_in_text);
      if (address) parts.push(`Адрес: ${address}.`);
      if (directions) parts.push(`Как добраться: ${directions}`);
      if (checkIn) parts.push(`Заезд: ${checkIn}`);
      if (parts.length) return found(sanitizeGuestFacingReply(parts.join(' ')), 'instructions');
      const passportCheckIn = textOrNull(passport?.checkInInstructions);
      if (passportCheckIn && passportCheckIn !== 'Information unavailable.') {
        return found(sanitizeGuestFacingReply(passportCheckIn), 'passport');
      }
      return found(null, 'instructions', ['object.check_in_text', 'object.directionsText']);
    }
    case 'house_rules':
    case 'pets': {
      const rulesReply = replyFromHouseRules(property, topic);
      if (rulesReply) return found(rulesReply, 'rules');
      const faqReply = replyFromFaq(faq, topic);
      if (faqReply) return found(faqReply, 'faq');
      return found(null, 'rules', topic === 'pets' ? ['object.petsPolicy'] : ['object.house_rules_text']);
    }
    case 'deposit':
    case 'reporting_documents':
    case 'keys': {
      if (topic === 'keys') {
        if (!bookingVerified) return found(null, 'instructions', ['booking.reference']);
        const doorNotes = textOrNull(property?.door_code_notes);
        const checkIn = textOrNull(property?.check_in_text);
        const combined = [checkIn, doorNotes].filter(Boolean).join(' ');
        if (combined) return found(sanitizeGuestFacingReply(combined), 'instructions');
        const faqReply = replyFromFaq(faq, topic);
        if (faqReply) return found(faqReply, 'faq');
        return found(null, 'instructions', ['object.check_in_text', 'object.door_code_notes']);
      }
      const passportReply = replyFromPassport(passport, topic);
      if (passportReply) return found(passportReply, 'passport');
      const faqReply = replyFromFaq(faq, topic);
      if (faqReply) return found(faqReply, 'faq');
      return found(null, 'passport', [topic === 'deposit' ? 'object.deposit' : 'object.reporting_documents']);
    }
    default:
      return { topic: 'unknown', found: false, reply: null, missingFields: [], source: null };
  }
}

export function requiresAutopilotOperatorEscalation(messageText: string): string | null {
  const lower = messageText.toLowerCase();
  if (/пожар|дым|газ|угроз.*жизн|emergency|fire|smoke|gas leak|medical emergency/i.test(lower)) return 'critical_safety';
  if (/не могу (?:войти|попасть)|застрял.*снаруж|код.*не работ|потерял.*ключ|(?:замок|дверь).{0,40}(?:слом(?:ан|ана|ано|аны|ался|алась|алось|ались)|не\s+работ|не\s+откры)|lockout|locked out|cannot (?:enter|get in)|access code.*not work|lost key|(?:lock|door).{0,40}(?:broken|not working|will not open|won't open)/i.test(lower)) return 'urgent_access_problem';
  if (/возврат|верн(?:уть|ите) деньги|компенсац|refund|money back|compensation|chargeback|payment dispute|disput(?:e|ing|ed).{0,32}payment|payment.{0,32}disput(?:e|ing|ed)/i.test(lower)) return 'refund_request';
  if (/отмен.*брон|cancel.*(?:booking|reservation)/i.test(lower)) return 'cancellation';
  if (/измен.*(?:дат|брон)|перенест.*брон|change.*(?:booking|reservation|dates?)|move my booking|extend (?:my )?stay|продл.*прожив/i.test(lower)) return 'booking_change';
  if (/нет горячей воды|нет отоплен|нет электрич|света нет|интернет не работ|no hot water|no heating|no electricity|power outage|internet (?:is )?(?:down|not working)/i.test(lower)) return 'maintenance_issue';
  if (/не работ|сломал|сломан|протека|поломк|maintenance|broken|leaking|does not work|doesn't work/i.test(lower)) return 'maintenance_issue';
  if (/уборк|грязн|нет бель|нет полотен|cleaning|dirty|missing linen|missing towels|supplies/i.test(lower)) return 'cleaning_issue';
  if (/(?:сосед|сверху|рядом).{0,48}(?:шум|громк|музык|вечерин)|(?:шум|громк|музык|вечерин).{0,48}(?:сосед|сверху|рядом)|жалоб.*шум|noise complaint|too (?:loud|noisy)/i.test(lower)) return 'noise_complaint';
  if (/жалоб|ужасн|плохой сервис|отвратительн|кошмар|недовол.*(?:сервис|обслуж|номер|прожив)/i.test(lower)) return 'complaint';
  if (/конфликт|спор|претензи|оскорб|агресс/i.test(lower)) return 'conflict';
  if (/негативн.*отзыв|плохой отзыв/i.test(lower)) return 'review_threat';
  if (/юрист|закон|суд|lawyer|legal action|court/i.test(lower)) return 'legal';
  if (/скидк|дешевле|снизьте цен/i.test(lower)) return 'forbidden_discount';
  if (/измен.*правил|другие правила/i.test(lower)) return 'forbidden_rule_change';
  return null;
}
