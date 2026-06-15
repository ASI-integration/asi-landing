import {
  composeGuestCheckoutReplyRu,
  composeGuestDirectionsReplyRu,
  composeGuestWifiReplyRu,
  type TelegramPropertyObjectV1,
} from './telegram-booking-object-memory';
import { sanitizeGuestFacingReply } from './guest-facing-ru';
import type {
  CommunicationAutopilotContext,
  CommunicationAutopilotDecision,
  CommunicationAutopilotIntent,
  CommunicationAutopilotOperationsAction,
} from './autopilot';

export type CommunicationAutopilotPassportScenario =
  | 'address_directions'
  | 'checkin_checkout'
  | 'wifi'
  | 'house_rules'
  | 'early_late'
  | 'price_payment'
  | 'property_problem'
  | 'emergency'
  | 'outside_object_data'
  | 'prompt_injection';

type PassportScenario = CommunicationAutopilotPassportScenario;

type PassportClassification = {
  scenario: PassportScenario;
  intent: CommunicationAutopilotIntent;
  confidence: number;
  signals: string[];
};

const MONEY_OR_LEGAL_REPLY =
  'Понял вопрос по оплате. Передаю его оператору, чтобы он проверил бронирование и условия.';

const MISSING_DATA_REPLY_GENERAL =
  'Сейчас уточню это у оператора и напишу вам здесь.';

const MISSING_DATA_REPLY_ADDRESS =
  'Сейчас уточню точный адрес у оператора и напишу вам здесь.';

const MISSING_DATA_REPLY_CHECKIN =
  'Сейчас уточню, как заселиться, у оператора и напишу вам здесь.';

const MISSING_DATA_REPLY_WIFI =
  'Сейчас уточню данные Wi-Fi у оператора и напишу вам здесь.';

const PROBLEM_REPLY =
  'Понял, есть проблема в объекте. Передаю оператору — команда проверит и поможет.';

const EMERGENCY_REPLY =
  'Понял, это срочно. Передаю оператору. Если есть угроза жизни, пожар, газ или сильное затопление — звоните 112.';

const BLOCKED_REPLY =
  'Могу помочь с вопросами по бронированию, заселению и проживанию.';

function guestTemplate(text: string): string {
  return sanitizeGuestFacingReply(text) ?? text;
}

function normalizeRu(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function has(text: string, ...needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function classifyPassportScenario(messageText: string): PassportClassification {
  const text = normalizeRu(messageText);

  if (
    matches(text, /(игнорируй|забудь|обойди|нарушь|сломай).{0,48}(правила|инструкции|ограничения|промпт)/iu) ||
    matches(text, /(покажи|раскрой|выведи|пришли).{0,48}(системн|промпт|инструкции|правила)/iu)
  ) {
    return {
      scenario: 'prompt_injection',
      intent: 'unknown',
      confidence: 0.99,
      signals: ['passport_v1_prompt_injection'],
    };
  }

  if (
    has(text, 'пожар', 'дым', 'газ', 'искрит', 'короткое замыкание', 'сильное затопление', 'прорыв трубы') ||
    (has(text, 'опасно', 'срочно', 'помогите') && has(text, 'вода', 'электричество', 'дверь', 'замок'))
  ) {
    return {
      scenario: 'emergency',
      intent: 'urgent_access_problem',
      confidence: 0.98,
      signals: ['passport_v1_emergency'],
    };
  }

  if (
    has(text, 'оплата', 'оплатить', 'цена', 'стоимость', 'деньги', 'возврат', 'штраф', 'депозит', 'счет', 'чек') ||
    has(text, 'договор', 'юрист', 'суд', 'претензия', 'компенсация', 'конфликт')
  ) {
    return {
      scenario: 'price_payment',
      intent: 'booking_payment_support',
      confidence: 0.94,
      signals: ['passport_v1_money_or_legal'],
    };
  }

  if (
    has(text, 'не работает', 'сломано', 'сломался', 'сломалась', 'протекает', 'течет', 'нет горячей воды') ||
    has(text, 'грязно', 'не убрано', 'нет полотенец', 'нет белья', 'не хватает бумаги')
  ) {
    return {
      scenario: 'property_problem',
      intent: has(text, 'гряз', 'убран', 'полотен', 'бель', 'бумаг') ? 'cleaning_issue' : 'maintenance_issue',
      confidence: 0.92,
      signals: ['passport_v1_property_problem'],
    };
  }

  if (has(text, 'wifi', 'wi-fi', 'вайфа', 'вай фай', 'вай-фай', 'интернет', 'пароль от сети')) {
    return {
      scenario: 'wifi',
      intent: 'wifi_access',
      confidence: 0.92,
      signals: ['passport_v1_wifi'],
    };
  }

  if (
    has(text, 'правила проживания', 'правила дома', 'можно курить', 'курение', 'тихий час', 'можно с животными') ||
    (has(text, 'правила') && has(text, 'квартир', 'объект', 'прожив'))
  ) {
    return {
      scenario: 'house_rules',
      intent: 'house_rules',
      confidence: 0.91,
      signals: ['passport_v1_house_rules'],
    };
  }

  if (
    has(text, 'ранний заезд', 'заехать раньше', 'заселиться раньше', 'оставить багаж') ||
    has(text, 'поздний выезд', 'выехать позже', 'выезд позже', 'late checkout', 'early checkin')
  ) {
    return {
      scenario: 'early_late',
      intent: 'early_checkin_late_checkout',
      confidence: 0.9,
      signals: ['passport_v1_early_late'],
    };
  }

  if (
    has(
      text,
      'заезд',
      'заселение',
      'заселиться',
      'заселится',
      'как попасть',
      'как зайти',
      'инструкция по заселению',
      'где ключ',
      'ключи',
      'ключ ',
      'код от двер',
      'код двер',
      'код на двер',
    ) ||
    (has(text, 'код') && has(text, 'двер')) ||
    has(text, 'выезд', 'до скольки', 'checkout', 'check-out', 'чекаут')
  ) {
    return {
      scenario: 'checkin_checkout',
      intent: has(text, 'выезд', 'checkout', 'check-out', 'чекаут') ? 'checkout' : 'check_in_access',
      confidence: 0.88,
      signals: ['passport_v1_checkin_checkout'],
    };
  }

  if (has(text, 'адрес', 'как добраться', 'как доехать', 'куда ехать', 'где находится', 'локация', 'геолокация')) {
    return {
      scenario: 'address_directions',
      intent: 'address_instruction',
      confidence: 0.9,
      signals: ['passport_v1_address_directions'],
    };
  }

  return {
    scenario: 'outside_object_data',
    intent: 'unknown',
    confidence: 0.6,
    signals: ['passport_v1_outside_object_data'],
  };
}

function contextToProperty(context: CommunicationAutopilotContext | undefined): TelegramPropertyObjectV1 | null {
  const object = context?.object;
  if (!object) return null;
  return {
    object_id: object.id ?? '',
    object_name: object.name ?? null,
    address: object.address ?? null,
    directions_text: object.directionsText ?? object.accessInstructions ?? null,
    parking_text: object.parkingText ?? null,
    trash_bins_location: object.trashBinsLocation ?? null,
    waste_disposal_text: object.wasteDisposalText ?? null,
    wifi_name: object.wifiName ?? null,
    wifi_password: object.wifiPassword ?? null,
    baby_crib_available: object.babyCribAvailable ?? null,
    baby_crib_note: object.babyCribNote ?? null,
    check_in_text: object.accessInstructions ?? null,
    checkout_time: context?.booking?.checkoutTime ?? null,
    house_rules_text: object.houseRules ?? null,
    door_code_notes: context?.booking?.verified || context?.bookingVerified ? (object.accessCode ?? null) : null,
    knowledge_status: object.knowledgeStatus,
  };
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function composeCheckinCheckoutReply(context: CommunicationAutopilotContext | undefined): string | null {
  const parts: string[] = [];
  const object = context?.object;
  if (object?.accessInstructions) parts.push(`Заезд: ${object.accessInstructions}`);
  if (context?.booking?.checkInTime) parts.push(`Время заезда: ${context.booking.checkInTime}.`);
  if (context?.booking?.checkoutTime) parts.push(`Выезд до ${context.booking.checkoutTime}.`);
  if ((context?.booking?.verified || context?.bookingVerified) && object?.accessCode) {
    parts.push(`Данные доступа: ${object.accessCode}`);
  }
  return sanitizeGuestFacingReply(parts.join(' '));
}

function composeEarlyLateReply(context: CommunicationAutopilotContext | undefined): string | null {
  const parts = [
    context?.object?.earlyCheckinPolicy ? `Ранний заезд: ${context.object.earlyCheckinPolicy}` : null,
    context?.object?.lateCheckoutPolicy ? `Поздний выезд: ${context.object.lateCheckoutPolicy}` : null,
  ].filter((part): part is string => Boolean(part));
  return sanitizeGuestFacingReply(parts.join(' '));
}

function composeHouseRulesReply(context: CommunicationAutopilotContext | undefined): string | null {
  const rules = textOrNull(context?.object?.houseRules);
  return rules ? sanitizeGuestFacingReply(`Правила проживания: ${rules}`) : null;
}

function operationsActionFor(
  classification: PassportClassification,
): CommunicationAutopilotOperationsAction | undefined {
  if (classification.scenario === 'emergency') {
    return {
      category: 'maintenance',
      priority: 'high',
      title: 'Communication autopilot: emergency at property',
      shortReason: 'emergency',
    };
  }
  if (classification.intent === 'maintenance_issue') {
    return {
      category: 'maintenance',
      priority: 'normal',
      title: 'Communication autopilot: maintenance issue',
      shortReason: 'maintenance_issue',
    };
  }
  if (classification.intent === 'cleaning_issue') {
    return {
      category: 'cleaning',
      priority: 'normal',
      title: 'Communication autopilot: cleaning issue',
      shortReason: 'cleaning_issue',
    };
  }
  return undefined;
}

function missingForScenario(
  classification: PassportClassification,
  context: CommunicationAutopilotContext | undefined,
): string[] {
  switch (classification.scenario) {
    case 'address_directions':
      return composeGuestDirectionsReplyRu(contextToProperty(context)) ? [] : ['object.address', 'object.directionsText'];
    case 'checkin_checkout':
      return composeCheckinCheckoutReply(context) || composeGuestCheckoutReplyRu(contextToProperty(context))
        ? []
        : ['object.check_in_text', 'booking.checkoutTime'];
    case 'wifi':
      if (!context?.bookingVerified && !context?.booking?.verified) return ['booking.verification'];
      return context?.object?.wifiName || context?.object?.wifiPassword ? [] : ['object.wifiName', 'object.wifiPassword'];
    case 'house_rules':
      return composeHouseRulesReply(context) ? [] : ['object.houseRules'];
    case 'early_late':
      return composeEarlyLateReply(context) ? [] : ['object.earlyCheckinPolicy', 'object.lateCheckoutPolicy'];
    case 'price_payment':
    case 'property_problem':
    case 'emergency':
    case 'outside_object_data':
    case 'prompt_injection':
      return [];
  }
}

function safeReplyForScenario(
  classification: PassportClassification,
  context: CommunicationAutopilotContext | undefined,
): string | null {
  switch (classification.scenario) {
    case 'address_directions':
      return composeGuestDirectionsReplyRu(contextToProperty(context));
    case 'checkin_checkout':
      return composeCheckinCheckoutReply(context) ?? composeGuestCheckoutReplyRu(contextToProperty(context));
    case 'wifi':
      return context?.bookingVerified || context?.booking?.verified
        ? composeGuestWifiReplyRu({ property: contextToProperty(context), verified: true })
        : null;
    case 'house_rules':
      return composeHouseRulesReply(context);
    case 'early_late':
      return composeEarlyLateReply(context);
    case 'price_payment':
      return guestTemplate(MONEY_OR_LEGAL_REPLY);
    case 'property_problem':
      return guestTemplate(PROBLEM_REPLY);
    case 'emergency':
      return guestTemplate(EMERGENCY_REPLY);
    case 'prompt_injection':
      return guestTemplate(BLOCKED_REPLY);
    case 'outside_object_data':
      return guestTemplate(MISSING_DATA_REPLY_GENERAL);
  }
}

function missingDataGuestReply(classification: PassportClassification): string {
  switch (classification.scenario) {
    case 'address_directions':
      return guestTemplate(MISSING_DATA_REPLY_ADDRESS);
    case 'checkin_checkout':
      return guestTemplate(MISSING_DATA_REPLY_CHECKIN);
    case 'wifi':
      return guestTemplate(MISSING_DATA_REPLY_WIFI);
    default:
      return guestTemplate(MISSING_DATA_REPLY_GENERAL);
  }
}

function shouldEscalate(classification: PassportClassification, missingContext: string[]): boolean {
  if (missingContext.length > 0) return true;
  return [
    'price_payment',
    'property_problem',
    'emergency',
    'outside_object_data',
    'prompt_injection',
  ].includes(classification.scenario);
}

export function decideCommunicationAutopilotPassportV1(input: {
  messageText: string;
  context?: CommunicationAutopilotContext;
  baseDecision: CommunicationAutopilotDecision;
}): CommunicationAutopilotDecision {
  const classification = classifyPassportScenario(input.messageText);
  const missingContext = missingForScenario(classification, input.context);
  const safeReply = safeReplyForScenario(classification, input.context);
  const replyText = sanitizeGuestFacingReply(
    missingContext.length > 0
      ? missingDataGuestReply(classification)
      : safeReply ?? guestTemplate(MISSING_DATA_REPLY_GENERAL),
  ) ?? guestTemplate(MISSING_DATA_REPLY_GENERAL);
  const escalate = shouldEscalate(classification, missingContext);

  return {
    action: escalate ? 'escalate' : 'auto_reply',
    confidence: classification.confidence,
    replyText,
    escalationReason: escalate ? classification.scenario : undefined,
    metadata: {
      ...input.baseDecision.metadata,
      intent: classification.intent,
      passportScenario: classification.scenario,
      matchedSignals: classification.signals,
      missingContext,
      urgent: classification.scenario === 'emergency' || input.baseDecision.metadata.urgent,
      operationsAction: operationsActionFor(classification) ?? input.baseDecision.metadata.operationsAction,
    },
  };
}
