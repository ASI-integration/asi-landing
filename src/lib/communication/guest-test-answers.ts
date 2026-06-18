import { missingDataActionsForFields } from '@/lib/crm/automation-loop';
import { sanitizeGuestFacingReply } from '@/lib/communication/guest-facing-ru';
import {
  composeGuestCheckoutReplyRu,
  composeGuestDirectionsReplyRu,
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
  | 'operator'
  | 'unknown';

export type GuestTestAnswerResult = {
  outcome: GuestTestQuestionOutcome;
  reply: string;
  intent: GuestTestQuestionKind;
  missingFields: string[];
  needsOperator: boolean;
};

export type GuestTestAnswerResolutionSource = {
  table: string;
  field: string;
  found: boolean;
};

export const ASI_GLOBAL_SMOKING_REPLY =
  'Курить в квартире нельзя. Спасибо, что помогаете сохранить объект чистым и комфортным для следующих гостей.';

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
  if (!parts.length) return null;
  return sanitizeGuestFacingReply(parts.join(' '));
}

export function logGuestTestAnswerResolution(input: {
  propertyId?: string | null;
  questionType: GuestTestQuestionKind;
  source: GuestTestAnswerResolutionSource | null;
  outcome: GuestTestQuestionOutcome;
}): void {
  console.info('[guest_test] answer_resolution', {
    propertyId: input.propertyId ?? null,
    questionType: input.questionType,
    sourceTable: input.source?.table ?? null,
    sourceField: input.source?.field ?? null,
    found: input.source?.found ?? false,
    outcome: input.outcome,
  });
}

function resolveAddressSource(property: TelegramPropertyObjectV1 | null): GuestTestAnswerResolutionSource {
  if (textOrNull(property?.address)) {
    return { table: 'properties/property_setup_profiles', field: 'address', found: true };
  }
  if (textOrNull(property?.directions_text)) {
    return { table: 'property_setup_profiles/property_master_cards', field: 'directions_text', found: true };
  }
  return { table: 'properties/property_setup_profiles', field: 'address', found: false };
}

function resolveWifiSource(property: TelegramPropertyObjectV1 | null): GuestTestAnswerResolutionSource {
  if (hasGuestTestFieldValue(property?.wifi_name)) {
    return { table: 'property_setup_profiles/property_master_cards', field: 'wifi_name', found: true };
  }
  if (hasGuestTestFieldValue(property?.wifi_password)) {
    return { table: 'property_setup_profiles/property_master_cards', field: 'wifi_password', found: true };
  }
  return { table: 'property_setup_profiles/property_master_cards', field: 'wifi_name', found: false };
}

function resolveHouseRulesSource(property: TelegramPropertyObjectV1 | null): GuestTestAnswerResolutionSource {
  if (textOrNull(property?.house_rules_text)) {
    return { table: 'property_setup_profiles/property_master_cards', field: 'house_rules_text', found: true };
  }
  return { table: 'property_setup_profiles/property_master_cards', field: 'house_rules_text', found: false };
}

function resolveCheckinSource(property: TelegramPropertyObjectV1 | null): GuestTestAnswerResolutionSource {
  if (textOrNull(property?.check_in_text)) {
    return { table: 'property_setup_profiles/property_master_cards', field: 'check_in_text', found: true };
  }
  if (textOrNull(property?.checkout_time)) {
    return { table: 'property_setup_profiles', field: 'checkout_time', found: true };
  }
  return { table: 'property_setup_profiles/property_master_cards', field: 'check_in_text', found: false };
}

export function classifyGuestTestQuestion(messageText: string): GuestTestQuestionKind {
  const lower = messageText.toLowerCase();

  if (/адрес|как добраться|где наход|как найти/i.test(lower)) return 'address';
  if (/wi-?fi|вай-?фай|парол.*сет|интернет/i.test(lower)) return 'wifi';
  if (/курить|курени|табач|сигарет|вейп|vape|кальян/i.test(lower)) return 'smoking';
  if (/балкон|окн[аоу]?\b/i.test(lower) && /кур|вейп|vape|кальян|сигарет|табач/i.test(lower)) return 'smoking';
  if (/правил|тишин|животн|шум/i.test(lower)) return 'house_rules';
  if (/заезд|выезд|check.?in|check.?out|время.*заезд/i.test(lower)) return 'checkin';
  if (/парков/i.test(lower)) return 'parking';
  if (/описан|квартир|объект|что за жиль/i.test(lower)) return 'description';
  if (/оплат|возврат|жалоб|счет|бронь.*номер|оператор|человек/i.test(lower)) return 'operator';

  return 'unknown';
}

function composeHouseRulesReply(property: TelegramPropertyObjectV1 | null | undefined): string | null {
  const rules = textOrNull(property?.house_rules_text);
  return rules ? sanitizeGuestFacingReply(`Правила проживания: ${rules}`) : null;
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
  return sanitizeGuestFacingReply(parts.join('. ') + '.');
}

function missingDataReply(
  missingFields: string[],
  propertyId?: string | null,
): string {
  const actions = missingDataActionsForFields(missingFields, propertyId);
  const first = actions[0];
  if (first?.setupHref) {
    return `В карточке объекта пока нет данных: ${first.label}. Владельцу нужно заполнить раздел в личном кабинете.`;
  }
  if (first?.label) {
    return `В карточке объекта пока нет данных: ${first.label}.`;
  }
  return 'В карточке объекта пока нет нужных данных.';
}

const OPERATOR_HANDOFF_REPLY =
  'Передал вопрос оператору. Ответ придёт в этот чат, как только оператор проверит запрос.';

export const OPERATOR_HANDOFF_FAILED_REPLY =
  'Не смог передать оператору. Напишите, пожалуйста, в поддержку.';

export function answerGuestTestQuestion(input: {
  messageText: string;
  property: TelegramPropertyObjectV1 | null;
  propertyId?: string | null;
}): GuestTestAnswerResult {
  const intent = classifyGuestTestQuestion(input.messageText);
  const property = input.property;

  if (intent === 'operator') {
    const result: GuestTestAnswerResult = {
      outcome: 'operator_followup_required',
      reply: OPERATOR_HANDOFF_REPLY,
      intent,
      missingFields: [],
      needsOperator: true,
    };
    logGuestTestAnswerResolution({
      propertyId: input.propertyId,
      questionType: intent,
      source: null,
      outcome: result.outcome,
    });
    return result;
  }

  if (intent === 'smoking') {
    const result: GuestTestAnswerResult = {
      outcome: 'answered_from_property_data',
      reply: sanitizeGuestFacingReply(ASI_GLOBAL_SMOKING_REPLY) ?? ASI_GLOBAL_SMOKING_REPLY,
      intent,
      missingFields: [],
      needsOperator: false,
    };
    logGuestTestAnswerResolution({
      propertyId: input.propertyId,
      questionType: intent,
      source: { table: 'asi_global_policy', field: 'smoking_ban', found: true },
      outcome: result.outcome,
    });
    return result;
  }

  let reply: string | null = null;
  let missingFields: string[] = [];
  let source: GuestTestAnswerResolutionSource | null = null;

  switch (intent) {
    case 'address':
      reply = composeGuestTestDirectionsReplyRu(property);
      source = resolveAddressSource(property);
      if (!reply) missingFields = ['object.address', 'object.directionsText'];
      break;
    case 'wifi':
      reply = composeGuestWifiReplyRu({ property, verified: true });
      source = resolveWifiSource(property);
      if (!hasGuestTestFieldValue(property?.wifi_name) && !hasGuestTestFieldValue(property?.wifi_password)) {
        missingFields = ['object.wifiName', 'object.wifiPassword'];
        reply = null;
        source = { table: 'property_setup_profiles/property_master_cards', field: 'wifi_name', found: false };
      }
      break;
    case 'house_rules':
      reply = composeHouseRulesReply(property);
      source = resolveHouseRulesSource(property);
      if (!reply) missingFields = ['object.houseRules'];
      break;
    case 'checkin':
      reply = composeCheckinReply(property) ?? composeGuestCheckoutReplyRu(property);
      source = resolveCheckinSource(property);
      if (!reply) missingFields = ['object.check_in_text', 'booking.checkoutTime'];
      break;
    case 'parking':
      reply = property?.parking_text ? sanitizeGuestFacingReply(`Парковка: ${property.parking_text}`) : null;
      source = {
        table: 'property_master_cards',
        field: 'parking_text',
        found: Boolean(property?.parking_text),
      };
      if (!reply) missingFields = ['object.parkingText'];
      break;
    case 'description':
      reply = composeDescriptionReply(property);
      source = {
        table: 'properties/property_setup_profiles',
        field: 'object_name/address',
        found: Boolean(textOrNull(property?.object_name) || textOrNull(property?.address)),
      };
      if (!reply) missingFields = ['object.name', 'object.address'];
      break;
    default:
      const operatorResult: GuestTestAnswerResult = {
        outcome: 'operator_followup_required',
        reply: OPERATOR_HANDOFF_REPLY,
        intent,
        missingFields: [],
        needsOperator: true,
      };
      logGuestTestAnswerResolution({
        propertyId: input.propertyId,
        questionType: intent,
        source: null,
        outcome: operatorResult.outcome,
      });
      return operatorResult;
  }

  if (reply) {
    const result: GuestTestAnswerResult = {
      outcome: 'answered_from_property_data',
      reply,
      intent,
      missingFields: [],
      needsOperator: false,
    };
    logGuestTestAnswerResolution({
      propertyId: input.propertyId,
      questionType: intent,
      source,
      outcome: result.outcome,
    });
    return result;
  }

  const result: GuestTestAnswerResult = {
    outcome: 'missing_data',
    reply: missingDataReply(missingFields, input.propertyId),
    intent,
    missingFields,
    needsOperator: false,
  };
  logGuestTestAnswerResolution({
    propertyId: input.propertyId,
    questionType: intent,
    source,
    outcome: result.outcome,
  });
  return result;
}
