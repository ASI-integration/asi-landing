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
  | 'checkin_instructions'
  | 'house_rules'
  | 'deposit'
  | 'reporting_documents'
  | 'pets'
  | 'keys'
  | 'unknown';

export type KnowledgeSourceLayer = 'object' | 'passport' | 'rules' | 'instructions' | 'faq';

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
  const lower = messageText.toLowerCase();

  if (/возврат|вернуть деньги|компенсац|скидк|жалоб|конфликт|отмен.*брон|юрист|закон|угроз|ужасн|плохой сервис/i.test(lower)) {
    return 'unknown';
  }
  if (/wi-?fi|вай-?фай|вайфа|парол.*сет|интернет/i.test(lower)) return 'wifi';
  if (/адрес|как добраться|где наход|как найти|как доехать/i.test(lower)) return 'address';
  if (/парков/i.test(lower)) return 'parking';
  if (/засел|инструкц.*заезд|как попасть|ключ|домофон|код.*двер/i.test(lower)) {
    if (/ключ|домофон|код/i.test(lower)) return 'keys';
    return 'checkin_instructions';
  }
  if (/во сколько.*заезд|время.*заезд|ранн.*заезд/i.test(lower)) return 'checkin_time';
  if (/во сколько.*выезд|время.*выезд|до скольк.*выезд|поздн.*выезд/i.test(lower)) return 'checkout_time';
  if (/правил|тишин|шум|курить|курени/i.test(lower)) return 'house_rules';
  if (/животн|собак|кошк|питомц/i.test(lower)) return 'pets';
  if (/залог|депозит/i.test(lower)) return 'deposit';
  if (/документ|справк|чек|квитанц|отчетн/i.test(lower)) return 'reporting_documents';

  return 'unknown';
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
    return null;
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
}): KnowledgeResolverResult {
  const { topic, property, bookingVerified, passport, faq } = input;
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
    case 'checkin_time': {
      const checkIn = textOrNull(property?.check_in_text);
      if (checkIn) return found(sanitizeGuestFacingReply(`Заезд: ${checkIn}`), 'instructions');
      missingFields.push('object.check_in_text');
      const passportReply = textOrNull(passport?.checkInInstructions);
      if (passportReply && passportReply !== 'Information unavailable.') {
        return found(sanitizeGuestFacingReply(`Заезд: ${passportReply}`), 'passport');
      }
      return found(null, 'instructions', missingFields);
    }
    case 'checkout_time': {
      const reply = composeGuestCheckoutReplyRu(property);
      if (reply) return found(reply, 'object');
      const checkout = textOrNull(passport?.checkOutInstructions);
      if (checkout && checkout !== 'Information unavailable.') return found(sanitizeGuestFacingReply(checkout), 'passport');
      return found(null, 'object', ['object.checkout_time']);
    }
    case 'checkin_instructions': {
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
  if (/возврат|вернуть деньги|компенсац/i.test(lower)) return 'refund_request';
  if (/отмен.*брон/i.test(lower)) return 'cancellation';
  if (/жалоб|ужасн|плохой сервис|отвратительн|кошмар/i.test(lower)) return 'complaint';
  if (/конфликт|спор|претензи|оскорб|агресс/i.test(lower)) return 'conflict';
  if (/негативн.*отзыв|плохой отзыв/i.test(lower)) return 'review_threat';
  if (/юрист|закон|суд/i.test(lower)) return 'legal';
  if (/скидк|дешевле|снизьте цен/i.test(lower)) return 'forbidden_discount';
  if (/измен.*правил|другие правила/i.test(lower)) return 'forbidden_rule_change';
  return null;
}
