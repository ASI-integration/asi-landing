export type TelegramGuestCanonIntent =
  | 'identity_meta'
  | 'ping_test'
  | 'greeting'
  | 'thanks_ok'
  | 'access_urgent'
  | 'checkin_info'
  | 'maintenance'
  | 'cleaning_housekeeping'
  | 'booking_missing_details'
  | 'payment_booking'
  | 'unknown';

export type TelegramGuestCanonActionType =
  | 'none'
  | 'access_support'
  | 'maintenance'
  | 'cleaning_housekeeping'
  | 'booking_payment_support';

export type TelegramGuestCanonReplyType =
  | 'fixed'
  | 'clarify'
  | 'action_ack'
  | 'handoff';

export type TelegramGuestCanonRule = {
  intent: TelegramGuestCanonIntent;
  examples: readonly string[];
  replyType: TelegramGuestCanonReplyType;
  actionType: TelegramGuestCanonActionType;
  escalate: boolean;
  reply: string;
};

export type TelegramGuestCanonMatch = TelegramGuestCanonRule & {
  matchedExample?: string;
  replyCount: 1;
};

export const TELEGRAM_GUEST_INTENT_CANON_V1: readonly TelegramGuestCanonRule[] = [
  {
    intent: 'identity_meta',
    examples: ['ты бот?', 'а ты бот?', 'ты человек?', 'кто ты?', 'ты умный бот?', 'это бот?', 'вы бот?'],
    replyType: 'fixed',
    actionType: 'none',
    escalate: false,
    reply:
      'Да, я официальный ассистент ASI. Помогаю с заселением, доступом, бронью, уборкой и поломками. Напишите, что случилось, я разберу запрос или передам оператору, если нужен человек.',
  },
  {
    intent: 'ping_test',
    examples: ['тест', 'проверка', 'ping', 'test', 'бот на связи?'],
    replyType: 'fixed',
    actionType: 'none',
    escalate: false,
    reply: 'Бот на связи. Напишите, что случилось.',
  },
  {
    intent: 'greeting',
    examples: ['привет', 'здравствуйте', 'добрый день', 'добрый вечер'],
    replyType: 'clarify',
    actionType: 'none',
    escalate: false,
    reply: 'Здравствуйте! Что случилось: заселение, доступ, бронь, уборка или поломка?',
  },
  {
    intent: 'thanks_ok',
    examples: ['спасибо', 'ок', 'понял', 'хорошо', 'ясно'],
    replyType: 'fixed',
    actionType: 'none',
    escalate: false,
    reply: 'Хорошо. Если понадобится помощь, напишите сюда.',
  },
  {
    intent: 'access_urgent',
    examples: [
      'не могу попасть',
      'код не работает',
      'не открывается дверь',
      'не могу войти',
      'ключ не подходит',
      'замок не открывается',
      'дверь не открывается',
    ],
    replyType: 'handoff',
    actionType: 'access_support',
    escalate: true,
    reply:
      'Понял, это срочно. Передаю оператору по доступу. Если есть номер брони, адрес или телефон в брони, пришлите сюда.',
  },
  {
    intent: 'checkin_info',
    examples: ['как заселиться', 'где ключ', 'как попасть в квартиру', 'когда заезд', 'инструкция по заселению', 'инструкция для входа'],
    replyType: 'clarify',
    actionType: 'none',
    escalate: false,
    reply: 'Помогу с заселением. Пришлите номер брони, адрес или телефон в брони.',
  },
  {
    intent: 'maintenance',
    examples: [
      'сломался душ',
      'нет горячей воды',
      'нет воды',
      'не работает wifi',
      'не работает вайфай',
      'протекает',
      'сломался замок',
      'нет света',
      'не работает отопление',
      'сломался кондиционер',
    ],
    replyType: 'action_ack',
    actionType: 'maintenance',
    escalate: false,
    reply: 'Принял, передаю поломку в работу. Если можете, пришлите адрес или номер брони.',
  },
  {
    intent: 'cleaning_housekeeping',
    examples: ['грязно', 'не убрано', 'нет полотенец', 'нет белья', 'мусор', 'грязная ванная', 'грязная кухня'],
    replyType: 'action_ack',
    actionType: 'cleaning_housekeeping',
    escalate: false,
    reply: 'Принял, передаю вопрос по уборке. Если можете, пришлите адрес или номер брони.',
  },
  {
    intent: 'booking_missing_details',
    examples: ['у меня бронь', 'я забронировал', 'не помню номер брони', 'бронь есть, номера нет'],
    replyType: 'clarify',
    actionType: 'none',
    escalate: false,
    reply: 'Пришлите, пожалуйста, имя гостя, телефон в брони, дату заезда или адрес объекта.',
  },
  {
    intent: 'payment_booking',
    examples: ['оплатил', 'не прошла оплата', 'верните деньги', 'отмена брони', 'продлить проживание'],
    replyType: 'clarify',
    actionType: 'booking_payment_support',
    escalate: false,
    reply: 'Понял вопрос по брони или оплате. Пришлите номер брони, имя гостя или телефон в брони.',
  },
  {
    intent: 'unknown',
    examples: [],
    replyType: 'clarify',
    actionType: 'none',
    escalate: false,
    reply: 'Уточните, пожалуйста, что случилось: заселение, доступ, уборка, поломка или вопрос по брони?',
  },
] as const;

const RULES_BY_INTENT = new Map(TELEGRAM_GUEST_INTENT_CANON_V1.map((rule) => [rule.intent, rule]));

function canonRule(intent: TelegramGuestCanonIntent): TelegramGuestCanonRule {
  return RULES_BY_INTENT.get(intent) ?? TELEGRAM_GUEST_INTENT_CANON_V1[TELEGRAM_GUEST_INTENT_CANON_V1.length - 1]!;
}

export function normalizeTelegramGuestCanonText(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[“”„"'`]/g, '')
    .replace(/[?!.,;:()[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(normalized: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(normalized));
}

function exactAny(normalized: string, phrases: readonly string[]): string | undefined {
  return phrases.find((phrase) => normalizeTelegramGuestCanonText(phrase) === normalized);
}

const IDENTITY_PATTERNS = [
  /^(а\s+)?(ты|вы)\s+(умный\s+|официальный\s+)?(бот|робот|человек)$/,
  /^(это|тут)\s+(бот|робот|человек)$/,
  /^кто\s+(ты|вы)(\s+такой|\s+такие)?$/,
  /^с\s+кем\s+я\s+общаюсь$/,
];

const PING_PATTERNS = [
  /^(тест|проверка|ping|test)$/,
  /^бот\s+на\s+связи$/,
  /^(проверка|тест)\s+связи$/,
  /^(проверка|тест).{0,24}(ответьте|работаете|бота)$/,
  /^бот\s+работает$/,
];

const GREETING_PATTERNS = [
  /^(привет|здравствуйте|здравствуй|приветствую|добрый\s+день|добрый\s+вечер|доброе\s+утро|доброго\s+дня|доброй\s+ночи)$/,
  /^добрый\s+день\s+вам$/,
];

const THANKS_PATTERNS = [
  /^(спасибо|спс|благодарю|ок|окей|понял|поняла|понятно|хорошо|ясно|ладно)$/,
  /^(спасибо|ок|хорошо)\s+(вам|большое)?$/,
];

const ACCESS_PATTERNS = [
  /не\s+могу\s+(попасть|зайти|войти|открыть|попасть\s+в\s+квартиру)/,
  /(?:код|ключ|замок|дверь).{0,32}(не\s+работает|не\s+подходит|не\s+открывается|не\s+открывает|сломал[аио]?с[ья]?|заклинил[ао]?)/,
  /не\s+открывается\s+(дверь|замок)/,
  /(?:застрял|застряли|стоим).{0,32}(у\s+двери|снаружи|на\s+улице)/,
];

const CHECKIN_PATTERNS = [
  /как\s+(заселиться|попасть\s+в\s+квартиру|войти|зайти)/,
  /где\s+(ключ|ключи)/,
  /когда\s+заезд/,
  /инструкц[а-яё]*\s+по\s+заселен/,
  /инструкц[а-яё]*\s+для\s+(входа|доступа)/,
];

const MAINTENANCE_PATTERNS = [
  /сломал[ао]?с[ья]?\s+(душ|замок|кондиционер|кран|унитаз|бойлер|телевизор)/,
  /нет\s+(горячей\s+воды|воды|света|электричества|отопления)/,
  /не\s+работает\s+(wifi|wi fi|вайфай|интернет|отопление|кондиционер|душ|свет|розетка|телевизор)/,
  /(протекает|течет|потекло|залило)/,
];

const CLEANING_PATTERNS = [
  /(грязно|грязная\s+ванная|грязная\s+кухня|грязный\s+пол|не\s+убрано|не\s+убрали|плохо\s+убрано)/,
  /нет\s+(полотенец|белья|туалетной\s+бумаги|мыла)/,
  /(мусор|грязное\s+белье|грязные\s+полотенца)/,
];

const BOOKING_MISSING_PATTERNS = [
  /(у\s+меня\s+(бронь|бронирование)|бронь\s+есть|я\s+забронировал|я\s+забронировала)/,
  /(не\s+помню|не\s+знаю|нет).{0,24}(номер\s+брони|номера\s+брони|бронь)/,
  /бронь\s+есть.{0,24}номер[а]?\s+нет/,
];

const PAYMENT_BOOKING_PATTERNS = [
  /(оплатил|оплатила|оплата|не\s+прошла\s+оплата|платеж\s+не\s+прошел)/,
  /(верните\s+деньги|возврат|refund)/,
  /(отмена\s+брони|отменить\s+бронь|отменил\s+бронь|отменила\s+бронь)/,
  /(продлить\s+проживание|продлить\s+бронь|хочу\s+продлить)/,
];

export function resolveTelegramGuestIntentCanon(text: string): TelegramGuestCanonMatch {
  const normalized = normalizeTelegramGuestCanonText(text);

  if (!normalized) {
    return { ...canonRule('unknown'), replyCount: 1 };
  }

  for (const intent of ['identity_meta', 'ping_test', 'greeting', 'thanks_ok'] as const) {
    const rule = canonRule(intent);
    const matchedExample = exactAny(normalized, rule.examples);
    if (matchedExample) return { ...rule, matchedExample, replyCount: 1 };
  }

  for (const rule of TELEGRAM_GUEST_INTENT_CANON_V1) {
    if (rule.intent === 'unknown') continue;
    const matchedExample = exactAny(normalized, rule.examples);
    if (matchedExample) return { ...rule, matchedExample, replyCount: 1 };
  }

  if (hasAny(normalized, IDENTITY_PATTERNS)) return { ...canonRule('identity_meta'), replyCount: 1 };
  if (hasAny(normalized, PING_PATTERNS)) return { ...canonRule('ping_test'), replyCount: 1 };
  if (hasAny(normalized, GREETING_PATTERNS)) return { ...canonRule('greeting'), replyCount: 1 };
  if (hasAny(normalized, THANKS_PATTERNS)) return { ...canonRule('thanks_ok'), replyCount: 1 };

  if (hasAny(normalized, ACCESS_PATTERNS)) return { ...canonRule('access_urgent'), replyCount: 1 };
  if (hasAny(normalized, MAINTENANCE_PATTERNS)) return { ...canonRule('maintenance'), replyCount: 1 };
  if (hasAny(normalized, CLEANING_PATTERNS)) return { ...canonRule('cleaning_housekeeping'), replyCount: 1 };
  if (hasAny(normalized, BOOKING_MISSING_PATTERNS)) return { ...canonRule('booking_missing_details'), replyCount: 1 };
  if (hasAny(normalized, PAYMENT_BOOKING_PATTERNS)) return { ...canonRule('payment_booking'), replyCount: 1 };
  if (hasAny(normalized, CHECKIN_PATTERNS)) return { ...canonRule('checkin_info'), replyCount: 1 };

  return { ...canonRule('unknown'), replyCount: 1 };
}

export function isNoActionTelegramGuestCanonIntent(intent: TelegramGuestCanonIntent): boolean {
  return intent === 'identity_meta' || intent === 'ping_test' || intent === 'greeting' || intent === 'thanks_ok';
}
