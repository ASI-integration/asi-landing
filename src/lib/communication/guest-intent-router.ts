import type { SenderIdentity } from './communication-identity-routing';

export type GuestCommunicationIntent =
  | 'guest_stay_question'
  | 'owner_internal_request'
  | 'lead_connection'
  | 'money_sensitive'
  | 'emergency_or_damage'
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

function isMoneySensitive(text: string): boolean {
  return has(
    text,
    /возврат|верн(ите|уть)\s+деньг|компенсац|скидк|оплат|платеж|залог|штраф|счет|чек|деньг/,
    /измен(ить|ение).*брон|перенести\s+брон|отмен(ить|а).*брон/,
    /конфликт|жалоб|претензи|спор|юрист|закон|персональн|личн(ые|ых)\s+данн/,
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
  );
}

function isGuestStayQuestion(text: string): boolean {
  return has(
    text,
    /заезд|засел|выезд|адрес|как\s+добраться|wi-?fi|вай-?фай|интернет|парол.*сет/,
    /правил|курить|курени|парков|ресторан|кафе|кофейн|поесть|завтрак|обед|ужин/,
    /продукт|магазин|супермаркет|аптек|лекарств|такси|метро|транспорт|остановк/,
    /что\s+рядом|рядом|поблизости|недалеко|посмотреть|достопримеч|погулять|куда\s+сходить/,
    /бытов|мусор|полотенц|белье/,
  );
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

  let detectedIntent: GuestCommunicationIntent = 'unclear_role';
  let confidence = 0.45;
  let reason = 'intent_unclear';

  if (isEmergencyOrDamage(text)) {
    detectedIntent = 'emergency_or_damage';
    confidence = 0.94;
    reason = 'safety_or_damage_requires_operator';
  } else if (isMoneySensitive(text)) {
    detectedIntent = 'money_sensitive';
    confidence = 0.93;
    reason = 'money_booking_or_legal_requires_operator';
  } else if (isLeadConnection(text)) {
    detectedIntent = 'lead_connection';
    confidence = 0.9;
    reason = 'lead_connection_detected';
  } else if (isOwnerInternalRequest(text)) {
    detectedIntent = 'owner_internal_request';
    confidence = 0.88;
    reason = 'owner_internal_request_detected';
  } else if (isGuestStayQuestion(text)) {
    detectedIntent = 'guest_stay_question';
    confidence = 0.88;
    reason = 'guest_stay_question_detected';
  }

  const shouldEscalate = detectedIntent === 'money_sensitive' || detectedIntent === 'emergency_or_damage';
  const roleConflict =
    (currentIdentity === 'owner' && detectedIntent === 'guest_stay_question') ||
    (currentIdentity === 'guest' && (detectedIntent === 'owner_internal_request' || detectedIntent === 'lead_connection')) ||
    (currentIdentity === 'lead' && detectedIntent === 'guest_stay_question');
  const shouldAskRoleConfirmation = roleConflict && !shouldEscalate;

  let suggestedRoute: GuestIntentSuggestedRoute = 'identity_confirmation';
  if (shouldEscalate) suggestedRoute = 'operator_review';
  else if (shouldAskRoleConfirmation) suggestedRoute = 'identity_confirmation';
  else if (detectedIntent === 'guest_stay_question') suggestedRoute = 'guest_concierge';
  else if (detectedIntent === 'owner_internal_request') suggestedRoute = 'owner_manager';
  else if (detectedIntent === 'lead_connection') suggestedRoute = 'lead';

  return {
    detectedIntent,
    confidence,
    roleConflict,
    shouldAskRoleConfirmation,
    canAnswerAutomatically: detectedIntent === 'guest_stay_question' && !shouldEscalate,
    shouldEscalate,
    reason,
    suggestedRoute,
  };
}
