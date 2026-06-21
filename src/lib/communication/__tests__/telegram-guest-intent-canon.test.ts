import { describe, expect, it } from 'vitest';
import { decideCommunicationAutopilotResponse } from '../autopilot';
import {
  TELEGRAM_GUEST_INTENT_CANON_V1,
  resolveTelegramGuestIntentCanon,
  type TelegramGuestCanonActionType,
  type TelegramGuestCanonIntent,
  type TelegramGuestCanonReplyType,
} from '../telegram-guest-intent-canon';

const MOJIBAKE_PATTERN = /(?:Ð|Ñ|�|вЂ|Р[°±µ¶·»¼½їёѕјџҐґ]|С[‚ѓ„…†‡€ЃЌЏ‘’“”•–—™љњќћџ])/;

function expectReadableRussian(text: string): void {
  expect(text).not.toMatch(MOJIBAKE_PATTERN);
}

type CanonCase = {
  text: string;
  intent: TelegramGuestCanonIntent;
  replyType: TelegramGuestCanonReplyType;
  actionType: TelegramGuestCanonActionType;
  escalate: boolean;
};

function casesFor(
  phrases: string[],
  expected: Omit<CanonCase, 'text'>,
): CanonCase[] {
  return phrases.map((text) => ({ text, ...expected }));
}

const cases: CanonCase[] = [
  ...casesFor(
    [
      'ты бот?',
      'а ты бот?',
      'ты робот?',
      'вы бот?',
      'вы робот?',
      'ты человек?',
      'это бот?',
      'тут бот?',
      'кто ты?',
      'кто вы?',
      'ты умный бот?',
      'ты официальный бот?',
      'с кем я общаюсь?',
    ],
    { intent: 'identity_meta', replyType: 'fixed', actionType: 'none', escalate: false },
  ),
  ...casesFor(
    [
      'тест',
      'проверка',
      'тест связи',
      'проверка связи',
      'бот на связи?',
      'бот на связи',
      'проверка, ответьте',
      'тест, работаете?',
      'проверка бота',
      'бот работает?',
    ],
    { intent: 'ping_test', replyType: 'fixed', actionType: 'none', escalate: false },
  ),
  ...casesFor(
    [
      'привет',
      'здравствуйте',
      'добрый день',
      'добрый вечер',
      'доброе утро',
      'доброго дня',
      'приветствую',
      'здравствуй',
      'доброй ночи',
      'добрый день вам',
    ],
    { intent: 'greeting', replyType: 'clarify', actionType: 'none', escalate: false },
  ),
  ...casesFor(
    [
      'спасибо',
      'спс',
      'благодарю',
      'ок',
      'окей',
      'понял',
      'поняла',
      'понятно',
      'хорошо',
      'ясно',
      'ладно',
      'спасибо вам',
    ],
    { intent: 'thanks_ok', replyType: 'fixed', actionType: 'none', escalate: false },
  ),
  ...casesFor(
    [
      'не могу попасть',
      'не могу попасть, код не работает',
      'не могу войти',
      'не могу зайти',
      'не могу открыть дверь',
      'код не работает',
      'ключ не подходит',
      'замок не открывается',
      'дверь не открывается',
      'стоим у двери, код не работает',
      'застряли снаружи',
      'код сломался',
    ],
    { intent: 'access_urgent', replyType: 'handoff', actionType: 'access_support', escalate: true },
  ),
  ...casesFor(
    [
      'как заселиться',
      'где ключ',
      'где ключи',
      'как попасть в квартиру',
      'как войти',
      'как зайти',
      'когда заезд',
      'инструкция по заселению',
      'инструкция для входа',
      'инструкция для доступа',
    ],
    { intent: 'checkin_info', replyType: 'clarify', actionType: 'none', escalate: false },
  ),
  ...casesFor(
    [
      'как добраться до квартиры',
      'как доехать до квартиры',
      'где адрес квартиры',
      'где находится квартира',
      'адрес квартиры',
      'как добраться от метро',
      'как доехать от аэропорта',
      'маршрут до квартиры',
    ],
    {
      intent: 'property_directions',
      replyType: 'action_ack',
      actionType: 'property_directions_support',
      escalate: false,
    },
  ),
  ...casesFor(
    [
      'если есть номер брони, я смогу получить код?',
      'можно получить код по номеру брони?',
      'как получить одноразовый код?',
      'где взять код для заселения?',
      'у меня есть бронь, дайте код',
      'у меня номер брони, пришлёте код?',
      'можно по телефону найти бронь и получить код?',
      'код для заселения дадите?',
      'если есть номер брони, я смогу получить одноразовый код для заселения?',
    ],
    { intent: 'checkin_code_request', replyType: 'clarify', actionType: 'none', escalate: false },
  ),
  ...casesFor(
    [
      'сломался душ',
      'сломался кран',
      'сломался унитаз',
      'сломался бойлер',
      'сломался телевизор',
      'нет горячей воды',
      'нет воды',
      'нет света',
      'нет электричества',
      'нет отопления',
      'не работает wifi',
      'не работает вайфай',
      'не работает интернет',
      'не работает отопление',
      'не работает кондиционер',
      'не работает розетка',
      'течет кран',
      'протекает',
      'потекло',
      'залило ванную',
    ],
    { intent: 'maintenance', replyType: 'action_ack', actionType: 'maintenance', escalate: false },
  ),
  ...casesFor(
    [
      'грязно',
      'грязно, нет полотенец',
      'не убрано',
      'не убрали',
      'плохо убрано',
      'грязная ванная',
      'грязная кухня',
      'грязный пол',
      'нет полотенец',
      'нет белья',
      'нет туалетной бумаги',
      'нет мыла',
      'мусор',
      'грязное белье',
      'грязные полотенца',
    ],
    {
      intent: 'cleaning_housekeeping',
      replyType: 'action_ack',
      actionType: 'cleaning_housekeeping',
      escalate: false,
    },
  ),
  ...casesFor(
    [
      'у меня бронь',
      'у меня бронь, но я не помню номер',
      'бронь есть',
      'бронь есть, номера нет',
      'я забронировал',
      'я забронировала',
      'не помню номер брони',
      'не знаю номер брони',
      'нет номера брони',
      'у меня бронирование',
    ],
    { intent: 'booking_missing_details', replyType: 'clarify', actionType: 'none', escalate: false },
  ),
  ...casesFor(
    [
      'оплатил',
      'оплатила',
      'оплата прошла?',
      'не прошла оплата',
      'платеж не прошел',
      'верните деньги',
      'возврат денег',
      'отмена брони',
      'отменить бронь',
      'отменил бронь',
      'отменила бронь',
      'продлить проживание',
      'продлить бронь',
      'хочу продлить',
    ],
    {
      intent: 'payment_booking',
      replyType: 'clarify',
      actionType: 'booking_payment_support',
      escalate: false,
    },
  ),
  ...casesFor(
    [
      'какая сегодня погода',
      'посоветуйте кафе рядом',
      'можно ли заказать такси',
      'у вас есть скидки',
      'что посмотреть в городе',
      'где купить продукты',
      'можно музыку погромче',
      'как дела',
      'расскажите анекдот',
      'я уже приехал и гуляю',
    ],
    { intent: 'unknown', replyType: 'clarify', actionType: 'none', escalate: false },
  ),
];

describe('Telegram Russian guest intent canon v1', () => {
  it('keeps canon examples and guest replies readable Russian', () => {
    for (const rule of TELEGRAM_GUEST_INTENT_CANON_V1) {
      expectReadableRussian(rule.reply);
      for (const example of rule.examples) {
        expectReadableRussian(example);
      }
    }
  });

  it.each(cases)('maps "$text" to stable canon output', (item) => {
    const match = resolveTelegramGuestIntentCanon(item.text);

    expectReadableRussian(item.text);
    expectReadableRussian(match.reply);
    expect(match.intent).toBe(item.intent);
    expect(match.replyType).toBe(item.replyType);
    expect(match.actionType).toBe(item.actionType);
    expect(match.escalate).toBe(item.escalate);
    expect(match.replyCount).toBe(1);
    expect(match.reply.trim().length).toBeGreaterThan(0);
  });

  it('covers at least 100 Russian phrase variants across all required groups', () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    expect(new Set(cases.map((item) => item.intent))).toEqual(
      new Set<TelegramGuestCanonIntent>([
        'identity_meta',
        'ping_test',
        'greeting',
        'thanks_ok',
        'access_urgent',
        'checkin_code_request',
        'checkin_info',
        'property_directions',
        'maintenance',
        'cleaning_housekeeping',
        'booking_missing_details',
        'payment_booking',
        'unknown',
      ]),
    );
  });

  it('handles explicit MVP acceptance examples', () => {
    expect(resolveTelegramGuestIntentCanon('ты бот?')).toMatchObject({
      intent: 'identity_meta',
      replyType: 'fixed',
      actionType: 'none',
      escalate: false,
      replyCount: 1,
    });
    expect(resolveTelegramGuestIntentCanon('ты бот?').reply).toContain('официальный ассистент ASI');

    expect(resolveTelegramGuestIntentCanon('ты умный бот?')).toMatchObject({
      intent: 'identity_meta',
      replyType: 'fixed',
      actionType: 'none',
      escalate: false,
      replyCount: 1,
    });
    expect(resolveTelegramGuestIntentCanon('ты умный бот?').reply).toContain('официальный ассистент ASI');

    expect(resolveTelegramGuestIntentCanon('не могу попасть, код не работает')).toMatchObject({
      intent: 'access_urgent',
      replyType: 'handoff',
      actionType: 'access_support',
      escalate: true,
      replyCount: 1,
    });
    expect(resolveTelegramGuestIntentCanon('сломался душ')).toMatchObject({
      intent: 'maintenance',
      actionType: 'maintenance',
      replyCount: 1,
    });
    expect(resolveTelegramGuestIntentCanon('грязно, нет полотенец')).toMatchObject({
      intent: 'cleaning_housekeeping',
      actionType: 'cleaning_housekeeping',
      replyCount: 1,
    });
    expect(resolveTelegramGuestIntentCanon('у меня бронь, но я не помню номер')).toMatchObject({
      intent: 'booking_missing_details',
      actionType: 'none',
      escalate: false,
      replyCount: 1,
    });
    expect(resolveTelegramGuestIntentCanon('у меня бронь, но я не помню номер').reply).toMatch(
      /имя гостя|телефон|дату заезда|адрес объекта/,
    );

    expect(resolveTelegramGuestIntentCanon('если есть номер брони, я смогу получить одноразовый код для заселения?')).toMatchObject({
      intent: 'checkin_code_request',
      actionType: 'none',
      escalate: false,
      replyCount: 1,
    });
    expect(resolveTelegramGuestIntentCanon('если есть номер брони, я смогу получить одноразовый код для заселения?').reply).toBe(
      'Да, помогу. Пришлите номер брони или телефон, указанный при бронировании, и я проверю данные для заселения.',
    );

    expect(resolveTelegramGuestIntentCanon('я не очень понимаю что дальше делать')).toMatchObject({
      intent: 'unknown',
      replyType: 'clarify',
      actionType: 'none',
      escalate: false,
      replyCount: 1,
    });
    expect(resolveTelegramGuestIntentCanon('я не очень понимаю что дальше делать').reply).toBe(
      'Поняла. Подскажите, вы про заселение, оплату, доступ к квартире или уже текущее проживание? Я помогу с нужным шагом.',
    );

    expect(
      resolveTelegramGuestIntentCanon(
        'хочу уточнить, квартира готова? и нужен ключ доступа',
      ),
    ).toMatchObject({
      intent: 'checkin_info',
      matchedExample: 'checkin_readiness_access',
      replyType: 'action_ack',
      actionType: 'access_support',
      escalate: false,
      replyCount: 1,
    });
    expect(
      resolveTelegramGuestIntentCanon(
        'хочу уточнить, квартира готова? и нужен ключ доступа',
      ).reply,
    ).toBe(
      'Поняла, проверю готовность квартиры и доступ к ключу. Напишите, пожалуйста, номер бронирования или адрес объекта, чтобы я сразу нашёл нужную бронь. Если данных не хватит, передам оператору.',
    );
  });

  it('detects property directions and keeps access routing unchanged', () => {
    expect(resolveTelegramGuestIntentCanon('а как добраться до квартиры в Шереметьево?')).toMatchObject({
      intent: 'property_directions',
      replyType: 'action_ack',
      actionType: 'route_to_property',
      matchedExample: 'route_to_property',
      replyCount: 1,
    });
    expect(resolveTelegramGuestIntentCanon('а как добраться до квартиры в Шереметьево?').reply).toBe(
      'Поняла, нужно подсказать маршрут до квартиры. Напишите, пожалуйста, адрес объекта или номер бронирования, и я подскажу, как добраться. Если адрес уже привязан к брони, сейчас найду его по бронированию.',
    );

    expect(resolveTelegramGuestIntentCanon('как доехать до квартиры?')).toMatchObject({
      intent: 'property_directions',
      actionType: 'property_directions_support',
      replyCount: 1,
    });

    expect(resolveTelegramGuestIntentCanon('где адрес квартиры?')).toMatchObject({
      intent: 'property_directions',
      actionType: 'property_directions_support',
      replyCount: 1,
    });

    expect(resolveTelegramGuestIntentCanon('не могу попасть, код не работает')).toMatchObject({
      intent: 'access_urgent',
      replyType: 'handoff',
      actionType: 'access_support',
      escalate: true,
      replyCount: 1,
    });
  });

  it('maps property directions into autopilot with context-aware replies', () => {
    const missingContext = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'а как добраться до квартиры из Шереметьево?',
      context: {},
    });
    expect(missingContext.metadata.intent).toBe('address_instruction');
    expect(missingContext.action).toBe('needs_context');
    expect(missingContext.replyText).toBe(
      'Поняла, нужно подсказать маршрут до квартиры. Напишите, пожалуйста, адрес объекта или номер бронирования, и я подскажу, как добраться. Если адрес уже привязан к брони, сейчас найду его по бронированию.',
    );
    expect(missingContext.replyText).not.toMatch(/заселение, оплату, доступ/i);

    const withContext = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'как доехать до квартиры?',
      context: {
        booking: { id: 'BR-123' },
        object: { address: 'Невский проспект 24' },
      },
    });
    expect(withContext.metadata.intent).toBe('address_instruction');
    expect(withContext.action).toBe('auto_reply');
    expect(withContext.replyText).toBe('Сейчас посмотрю адрес объекта и подскажу маршрут.');
    expect(withContext.replyText).not.toMatch(/номер бронирования/i);
  });

  it('maps operational canon hits into Telegram autopilot decisions', () => {
    const access = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'не могу попасть, код не работает',
      context: {},
    });
    expect(access.action).toBe('escalate');
    expect(access.metadata.operationsAction?.category).toBe('operator_access_support');
    expect(access.replyText).toBe(
      'Поняла, это срочно. Уже передаю оператору по доступу. В целях безопасности код двери отправим только после проверки брони.',
    );

    const cleaning = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'грязно, нет полотенец',
      context: {},
    });
    expect(cleaning.metadata.operationsAction?.category).toBe('cleaning');
    expect(cleaning.replyText).toContain('уборке');

    const maintenance = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'сломался душ',
      context: {},
    });
    expect(maintenance.metadata.operationsAction?.category).toBe('maintenance');
    expect(maintenance.replyText).toContain('поломку');

    const booking = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'у меня бронь, но я не помню номер',
      context: {},
    });
    expect(booking.action).toBe('needs_context');
    expect(booking.metadata.operationsAction).toBeUndefined();
    expect(booking.replyText).toMatch(/имя гостя|телефон|дату заезда|адрес объекта/);

    const checkinCode = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'если есть номер брони, я смогу получить одноразовый код для заселения?',
      context: {},
    });
    expect(checkinCode.action).toBe('needs_context');
    expect(checkinCode.metadata.intent).toBe('checkin_code_request');
    expect(checkinCode.metadata.operationsAction).toBeUndefined();
    expect(checkinCode.replyText).toBe(
      'Да, помогу. Пришлите номер брони или телефон, указанный при бронировании, и я проверю данные для заселения.',
    );
  });
});
