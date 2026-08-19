import type { SenderIdentity } from './communication-identity-routing';

export type GuestCommunicationIntent =
  | 'guest_checkin'
  | 'guest_property_question'
  | 'guest_local_recommendation'
  | 'guest_rules_question'
  | 'guest_booking_lookup'
  | 'owner_internal_request'
  | 'lead_connection'
  | 'money_sensitive'
  | 'emergency_or_damage'
  | 'complaint_or_conflict'
  | 'personal_data_sensitive'
  | 'unclear_role';

export type GuestIntentSuggestedRoute =
  | 'guest_concierge'
  | 'owner_manager'
  | 'lead'
  | 'operator_review'
  | 'identity_confirmation';

export type GuestIntentRouterResult = {
  detectedIntent: GuestCommunicationIntent;
  confidence: number;
  roleConflict: boolean;
  shouldAskRoleConfirmation: boolean;
  canAnswerAutomatically: boolean;
  shouldEscalate: boolean;
  reason: string;
  suggestedRoute: GuestIntentSuggestedRoute;
};

const GUEST_CONCIERGE_INTENTS = new Set<GuestCommunicationIntent>([
  'guest_checkin',
  'guest_property_question',
  'guest_local_recommendation',
  'guest_rules_question',
  'guest_booking_lookup',
]);

export function isGuestConciergeIntent(intent: GuestCommunicationIntent): boolean {
  return GUEST_CONCIERGE_INTENTS.has(intent);
}

export function isSensitiveEscalationIntent(intent: GuestCommunicationIntent): boolean {
  return (
    intent === 'money_sensitive' ||
    intent === 'emergency_or_damage' ||
    intent === 'complaint_or_conflict' ||
    intent === 'personal_data_sensitive'
  );
}

function normalizeRu(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function has(text: string, ...patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isPersonalDataSensitive(text: string): boolean {
  return has(
    text,
    /персональн|личн(ые|ых)\s+данн|паспорт|банковск.*карт|cvv|cvc|снилс|инн/,
  );
}

function isComplaintOrConflict(text: string): boolean {
  return has(text, /конфликт|жалоб|претензи|спор|оскорб|угроз/i);
}

function isMoneySensitive(text: string): boolean {
  return has(
    text,
    /возврат|верн(ите|уть)\s+деньг|компенсац|скидк|оплат|платеж|залог|штраф|счет|чек|деньг/,
    /измен(ить|ение).*брон|перенести\s+брон|отмен(ить|а).*брон|продл.*прожив|продлен/,
    /ранн.*заезд|поздн.*выезд|наличн.*оплат/,
    /юрист|закон|обязательств|обеща/,
  );
}

function isEmergencyOrDamage(text: string): boolean {
  return has(
    text,
    /авари|пожар|дым|газ|потоп|затоп|протеч|безопасн|опасн|угроз|полици/,
    /сломал|сломалось|поломк|замок.*(не\s+работ|слом)|не\s+открывается|не\s+работает\s+(душ|вода|свет|замок)/,
  );
}

function isOwnerInternalRequest(text: string): boolean {
  return has(
    text,
    /авито|островок|ota|канал|channel manager|карточк|площадк/,
    /паспорт\s+объект|объект.*(настро|провер|подключ|созда|заполн)|настро.*объект/,
    /владелец|управляющ|собственник/,
  );
}

function isLeadConnection(text: string): boolean {
  return has(
    text,
    /\basi\b.*(подключ|услов|стоим|цен|пилот|начать|демо)|подключ(ить|иться).*asi/,
    /хочу\s+подключить\s+asi|как\s+начать|сколько\s+стоит|условия\s+пилот/,
    /хочу\s+попробовать|у\s+меня\s+\d+\s+объект/,
    /хочу\s+(подключить|добавить|настроить).*(квартир|объект|апартамент)/,
    /(сдаю|управляю).*(квартир|апартамент|объект).*(посуточ|краткосрочн)?/,
    /хочу\s+начать\s+пользоваться/,
  );
}

function isGuestBookingLookup(text: string): boolean {
  return has(
    text,
    /можно\s+по\s+имени|по\s+фамилии|номера\s+нет|нет\s+номера\s+брон|по\s+имени\s+и\s+фамилии/,
    /у\s+меня\s+нет\s+номера\s+бронирования|могу\s+назвать\s+имя/,
  );
}

function isGuestCheckin(text: string): boolean {
  return has(text, /заезд|засел|выезд|check.?in|check.?out|время.*заезд|хотим\s+заехать|хочу\s+заехать/);
}

function isGuestPropertyQuestion(text: string): boolean {
  return has(
    text,
    // Strong operational cues remain deterministic and grounded.
    /адрес|как\s+добраться|где\s+наход|как\s+найти|wi-?fi|вай-?фай|интернет|парол.*сет|парков/,
    // Bare mentions such as «хочу отдохнуть в квартире» are conversation, not a request
    // for the property passport. Require an actual property-information question.
    /(?:расскаж|опиш|описан|что\s+за|что\s+есть|какие?.*удобств|есть\s+ли).{0,80}(?:квартир|объект|жиль|апартамент)/,
    /(?:квартир|объект|жиль|апартамент).{0,80}(?:что\s+есть|какие?.*удобств|есть\s+ли|как\s+выгляд|описан)/,
  );
}

function isGuestRulesQuestion(text: string): boolean {
  return has(text, /правил|курить|курени|тишин|животн|шум|табач|сигарет|вейп|vape|кальян/);
}

function isGuestLocalRecommendation(text: string): boolean {
  return has(
    text,
    /ресторан|кафе|кофейн|поесть|завтрак|обед|ужин|грузинск|итальянск|еда|перекус/,
    /продукт|магазин|супермаркет|аптек|лекарств|такси|метро|транспорт|остановк/,
    /что\s+рядом|рядом|поблизости|недалеко|посмотреть|достопримеч|погулять|куда\s+сходить/,
    /порекоменд|подскаж.*рядом|где\s+купить|как\s+вызвать\s+такси/,
  );
}

function classifyGuestIntent(text: string): { intent: GuestCommunicationIntent; confidence: number; reason: string } {
  if (isEmergencyOrDamage(text)) {
    return { intent: 'emergency_or_damage', confidence: 0.94, reason: 'safety_or_damage_requires_operator' };
  }
  if (isPersonalDataSensitive(text)) {
    return { intent: 'personal_data_sensitive', confidence: 0.92, reason: 'personal_data_requires_operator' };
  }
  if (isComplaintOrConflict(text)) {
    return { intent: 'complaint_or_conflict', confidence: 0.91, reason: 'complaint_or_conflict_requires_operator' };
  }
  if (isMoneySensitive(text)) {
    return { intent: 'money_sensitive', confidence: 0.93, reason: 'money_booking_or_legal_requires_operator' };
  }
  if (isLeadConnection(text)) {
    return { intent: 'lead_connection', confidence: 0.9, reason: 'lead_connection_detected' };
  }
  if (isOwnerInternalRequest(text)) {
    return { intent: 'owner_internal_request', confidence: 0.88, reason: 'owner_internal_request_detected' };
  }
  if (isGuestBookingLookup(text)) {
    return { intent: 'guest_booking_lookup', confidence: 0.87, reason: 'guest_booking_lookup_detected' };
  }
  if (isGuestCheckin(text)) {
    return { intent: 'guest_checkin', confidence: 0.88, reason: 'guest_checkin_detected' };
  }
  if (isGuestLocalRecommendation(text)) {
    return { intent: 'guest_local_recommendation', confidence: 0.89, reason: 'guest_local_recommendation_detected' };
  }
  if (isGuestPropertyQuestion(text)) {
    return { intent: 'guest_property_question', confidence: 0.87, reason: 'guest_property_question_detected' };
  }
  if (isGuestRulesQuestion(text)) {
    return { intent: 'guest_rules_question', confidence: 0.86, reason: 'guest_rules_question_detected' };
  }
  return { intent: 'unclear_role', confidence: 0.45, reason: 'intent_unclear' };
}

function identityGroup(identity?: SenderIdentity | null): 'guest' | 'owner' | 'lead' | 'support' | 'unknown' {
  if (identity === 'guest' || identity === 'test_guest') return 'guest';
  if (identity === 'owner' || identity === 'manager') return 'owner';
  if (identity === 'lead') return 'lead';
  if (identity === 'support_problem') return 'support';
  return 'unknown';
}

export function classifyGuestCommunicationIntent(input: {
  messageText: string;
  currentIdentity?: SenderIdentity | null;
}): GuestIntentRouterResult {
  const text = normalizeRu(input.messageText);
  const currentIdentity = identityGroup(input.currentIdentity);
  const classified = classifyGuestIntent(text);
  const detectedIntent = classified.intent;

  const shouldEscalate = isSensitiveEscalationIntent(detectedIntent);
  const roleConflict =
    (currentIdentity === 'owner' && isGuestConciergeIntent(detectedIntent)) ||
    (currentIdentity === 'guest' &&
      (detectedIntent === 'owner_internal_request' || detectedIntent === 'lead_connection')) ||
    (currentIdentity === 'lead' && isGuestConciergeIntent(detectedIntent));
  const shouldAskRoleConfirmation = roleConflict && !shouldEscalate;

  let suggestedRoute: GuestIntentSuggestedRoute = 'identity_confirmation';
  if (shouldEscalate) suggestedRoute = 'operator_review';
  else if (shouldAskRoleConfirmation) suggestedRoute = 'identity_confirmation';
  else if (isGuestConciergeIntent(detectedIntent)) suggestedRoute = 'guest_concierge';
  else if (detectedIntent === 'owner_internal_request') suggestedRoute = 'owner_manager';
  else if (detectedIntent === 'lead_connection') suggestedRoute = 'lead';

  return {
    detectedIntent,
    confidence: classified.confidence,
    roleConflict,
    shouldAskRoleConfirmation,
    canAnswerAutomatically: isGuestConciergeIntent(detectedIntent) && !shouldEscalate,
    shouldEscalate,
    reason: classified.reason,
    suggestedRoute,
  };
}
