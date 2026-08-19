import { missingDataActionsForFields } from '@/lib/crm/automation-loop';
import { sanitizeGuestFacingReply } from '@/lib/communication/guest-facing-ru';
import {
  composeGuestCheckoutReplyRu,
  composeGuestWifiReplyRu,
  type TelegramPropertyObjectV1,
} from '@/lib/communication/telegram-booking-object-memory';
import type { GuestTestQuestionOutcome } from '@/lib/crm/types';

export type GuestTestQuestionKind =
  | 'address'
  | 'wifi'
  | 'smoking'
  | 'house_rules'
  | 'checkin'
  | 'parking'
  | 'description'
  | 'concierge_food'
  | 'concierge_grocery'
  | 'concierge_pharmacy'
  | 'concierge_transport'
  | 'concierge_sights'
  | 'concierge_neutral'
  | 'clarification'
  | 'operator'
  | 'unknown';

export type GuestTestQuestionDecisionLayer =
  | 'property_data_answer'
  | 'global_rule_answer'
  | 'concierge_autopilot_answer'
  | 'clarification_request'
  | 'operator_escalation_required';

export type GuestTestAnswerResult = {
  outcome: GuestTestQuestionOutcome;
  reply: string;
  intent: GuestTestQuestionKind;
  decisionLayer: GuestTestQuestionDecisionLayer;
  missingFields: string[];
  needsOperator: boolean;
};

export const ASI_GLOBAL_SMOKING_REPLY =
  'Курить в квартире нельзя. Спасибо, что помогаете сохранить объект чистым и комфортным для следующих гостей.';
export const ASI_GLOBAL_SMOKING_HOUSE_RULE = 'Курение: нельзя в квартире, на балконе и у окна.';

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function hasGuestTestFieldValue(value: unknown): boolean {
  return textOrNull(value) !== null;
}

function composeGuestTestDirectionsReplyRu(property: TelegramPropertyObjectV1 | null | undefined): string | null {
  if (!property) return null;
  const address = textOrNull(property.address);
  const directions = textOrNull(property.directions_text);
  if (!address && !directions) return null;
  const parts: string[] = [];
  if (address) parts.push(`Адрес: ${address}.`);
  if (directions) parts.push(`Как добраться: ${directions}`);
  return sanitizeGuestFacingReply(parts.join(' '));
}

export function classifyGuestTestQuestion(messageText: string): GuestTestQuestionKind {
  const lower = messageText.toLowerCase();

  if (requiresOperatorEscalation(lower)) return 'operator';
  if (/адрес|как добраться|где наход|как найти/i.test(lower)) return 'address';
  if (/wi-?fi|вай-?фай|парол.*сет|интернет/i.test(lower)) return 'wifi';
  if (/курить|курени|табач|сигарет|вейп|vape|кальян/i.test(lower)) return 'smoking';
  if (/балкон|окн[аоу]?\b/i.test(lower) && /кур|вейп|vape|кальян|сигарет|табач/i.test(lower)) return 'smoking';
  if (/правил|тишин|животн|шум/i.test(lower)) return 'house_rules';
  if (/заезд|выезд|check.?in|check.?out|время.*заезд/i.test(lower)) return 'checkin';
  if (/парков/i.test(lower)) return 'parking';
  if (/ресторан|кафе|кофейн|поесть|завтрак|обед|ужин|грузинск|итальянск|еда|перекус/i.test(lower)) return 'concierge_food';
  if (/продукт|магазин|супермаркет|вода|молок|хлеб|купить/i.test(lower)) return 'concierge_grocery';
  if (/аптек|лекарств|таблет|пластыр|градусник/i.test(lower)) return 'concierge_pharmacy';
  if (/транспорт|метро|такси|автобус|трамва|как доехать|маршрут|остановк/i.test(lower)) return 'concierge_transport';
  if (/посмотреть|достопримеч|погулять|рядом интересн|музе|парк|куда сходить/i.test(lower)) return 'concierge_sights';
  if (/рядом|поблизости|недалеко|около объекта|в районе/i.test(lower)) return 'concierge_neutral';
  if (/описан|квартир|объект|что за жиль/i.test(lower)) return 'description';

  return 'unknown';
}

function requiresOperatorEscalation(lower: string): boolean {
  return /возврат|вернуть деньги|компенсац|скидк|жалоб|конфликт|спор|претензи|продл.*прожив|продлен|измен.*брон|перенести брон|отмен.*брон|ранн.*заезд|поздн.*выезд|сломал|сломалось|поломк|не работает|протеч|затоп|безопасн|опасн|угроз|пожар|дым|полици|юрист|закон|паспорт|персональн|личные данные|банковск.*карт|картой|карта.*оплат|платеж|оплат|счет|чек|обязательств|обеща|оператор|человек/i.test(lower);
}

function composeLocationContext(property: TelegramPropertyObjectV1 | null | undefined): string {
  const address = textOrNull(property?.address);
  if (address) return `в районе: ${address}`;
  return 'рядом с объектом';
}

function composeConciergeAutopilotReply(
  intent: GuestTestQuestionKind,
  property: TelegramPropertyObjectV1 | null | undefined,
): string {
  const location = composeLocationContext(property);
  const suffix = 'Перед визитом лучше проверить часы работы и рейтинг в картах.';

  if (intent === 'concierge_food') {
    const placeHint = textOrNull(property?.address)
      ? 'рядом с адресом объекта'
      : 'рядом с объектом';
    return sanitizeGuestFacingReply(
      `Да, конечно. Могу подсказать общий ориентир: удобнее искать кафе и рестораны ${placeHint} в Яндекс Картах или 2ГИС. Если подскажете, что вам ближе — завтрак, кофейня, недорогой обед, грузинская, итальянская кухня — я помогу сузить запрос. ${suffix}`,
    )!;
  }
  if (intent === 'concierge_grocery') {
    return sanitizeGuestFacingReply(`Да. Продукты удобнее искать ${location}: супермаркет, магазин у дома или доставку. ${suffix}`)!;
  }
  if (intent === 'concierge_pharmacy') {
    return sanitizeGuestFacingReply(`Да. Аптеку лучше искать ${location} в картах. Проверьте часы работы перед выходом.`)!;
  }
  if (intent === 'concierge_transport') {
    return sanitizeGuestFacingReply(
      `Да. Для транспорта рядом с объектом проверьте маршрут ${location} в картах: метро, остановки и такси могут зависеть от времени дня.`,
    )!;
  }
  if (intent === 'concierge_sights') {
    return sanitizeGuestFacingReply(
      `Да. Можно посмотреть места для прогулки и достопримечательности ${location}. Лучше выбрать по картам и отзывам то, что ближе и удобно по времени.`,
    )!;
  }

  return sanitizeGuestFacingReply(
    `Да. Я могу подсказать по нейтральным вопросам рядом с объектом ${location}. Для точных адресов и часов работы лучше проверить карты.`,
  )!;
}

function composeHouseRulesReply(property: TelegramPropertyObjectV1 | null | undefined): string | null {
  const rules = textOrNull(property?.house_rules_text);
  const propertyRuleLines = rules
    ? rules
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !/^Курение\s*:/iu.test(line))
    : [];
  return sanitizeGuestFacingReply(`Правила проживания: ${[ASI_GLOBAL_SMOKING_HOUSE_RULE, ...propertyRuleLines].join('\n')}`);
}

function composeCheckinReply(property: TelegramPropertyObjectV1 | null | undefined): string | null {
  const parts: string[] = [];
  const checkIn = textOrNull(property?.check_in_text);
  const checkout = textOrNull(property?.checkout_time);
  if (checkIn) parts.push(`Заезд: ${checkIn}`);
  if (checkout) parts.push(`Выезд до ${checkout}.`);
  if (!parts.length) return null;
  return sanitizeGuestFacingReply(parts.join(' '));
}

function composeDescriptionReply(property: TelegramPropertyObjectV1 | null | undefined): string | null {
  const name = textOrNull(property?.object_name);
  const address = textOrNull(property?.address);
  const checkIn = textOrNull(property?.check_in_text);
  const parts: string[] = [];
  if (name) parts.push(name);
  if (address) parts.push(`Адрес: ${address}`);
  if (checkIn) parts.push(`Заезд: ${checkIn}`);
  if (!parts.length) return null;
  return sanitizeGuestFacingReply(`${parts.join('. ')}.`);
}

function missingDataReply(missingFields: string[], propertyId?: string | null): string {
  const first = missingDataActionsForFields(missingFields, propertyId)[0];
  if (first?.setupHref) {
    return `В карточке объекта пока нет данных: ${first.label}. Владельцу нужно заполнить раздел в личном кабинете.`;
  }
  if (first?.label) return `В карточке объекта пока нет данных: ${first.label}.`;
  return 'В карточке объекта пока нет нужных данных.';
}

const OPERATOR_HANDOFF_REPLY =
  'Поняла вопрос. Здесь нужна проверка оператора, чтобы не дать вам неверную информацию. Я передам обращение и вернусь с ответом здесь.';

export const GUEST_MISSING_DATA_OPERATOR_REPLY =
  'Поняла, вы хотите заехать. Сейчас у меня не хватает данных по объекту, поэтому я уточню информацию у оператора. Напишите, пожалуйста, номер бронирования или адрес/название объекта, если они у вас есть.';

export const OPERATOR_HANDOFF_FAILED_REPLY =
  'Не смог передать оператору. Напишите, пожалуйста, в поддержку.';

export function answerGuestTestQuestion(input: {
  messageText: string;
  property: TelegramPropertyObjectV1 | null;
  propertyId?: string | null;
}): GuestTestAnswerResult {
  const intent = classifyGuestTestQuestion(input.messageText);
  const property = input.property;

  if (intent === 'operator' || intent === 'unknown') {
    return {
      outcome: 'operator_followup_required',
      reply: OPERATOR_HANDOFF_REPLY,
      intent,
      decisionLayer: 'operator_escalation_required',
      missingFields: [],
      needsOperator: true,
    };
  }

  if (intent === 'smoking') {
    return {
      outcome: 'answered_from_global_rule',
      reply: sanitizeGuestFacingReply(ASI_GLOBAL_SMOKING_REPLY) ?? ASI_GLOBAL_SMOKING_REPLY,
      intent,
      decisionLayer: 'global_rule_answer',
      missingFields: [],
      needsOperator: false,
    };
  }

  if (
    intent === 'concierge_food' ||
    intent === 'concierge_grocery' ||
    intent === 'concierge_pharmacy' ||
    intent === 'concierge_transport' ||
    intent === 'concierge_sights' ||
    intent === 'concierge_neutral'
  ) {
    return {
      outcome: 'answered_by_concierge_autopilot',
      reply: composeConciergeAutopilotReply(intent, property),
      intent,
      decisionLayer: 'concierge_autopilot_answer',
      missingFields: [],
      needsOperator: false,
    };
  }

  let reply: string | null = null;
  let missingFields: string[] = [];
  let outcome: GuestTestQuestionOutcome = 'answered_from_property_data';

  switch (intent) {
    case 'address':
      reply = composeGuestTestDirectionsReplyRu(property);
      if (!reply) missingFields = ['object.address', 'object.directionsText'];
      break;
    case 'wifi':
      reply = composeGuestWifiReplyRu({ property, verified: true });
      if (!hasGuestTestFieldValue(property?.wifi_name) && !hasGuestTestFieldValue(property?.wifi_password)) {
        reply = null;
        missingFields = ['object.wifiName', 'object.wifiPassword'];
      }
      break;
    case 'house_rules':
      reply = composeHouseRulesReply(property);
      outcome = textOrNull(property?.house_rules_text) ? 'answered_from_property_data' : 'answered_from_global_rule';
      break;
    case 'checkin':
      reply = composeCheckinReply(property) ?? composeGuestCheckoutReplyRu(property);
      if (!reply) missingFields = ['object.check_in_text', 'booking.checkoutTime'];
      break;
    case 'parking':
      reply = property?.parking_text ? sanitizeGuestFacingReply(`Парковка: ${property.parking_text}`) : null;
      if (!reply) missingFields = ['object.parkingText'];
      break;
    case 'description':
      reply = composeDescriptionReply(property);
      if (!reply) missingFields = ['object.name', 'object.address'];
      break;
    default:
      break;
  }

  if (reply) {
    return {
      outcome,
      reply,
      intent,
      decisionLayer: outcome === 'answered_from_global_rule' ? 'global_rule_answer' : 'property_data_answer',
      missingFields: [],
      needsOperator: false,
    };
  }

  return {
    outcome: 'missing_data',
    reply: missingDataReply(missingFields, input.propertyId),
    intent,
    decisionLayer: 'property_data_answer',
    missingFields,
    needsOperator: false,
  };
}
