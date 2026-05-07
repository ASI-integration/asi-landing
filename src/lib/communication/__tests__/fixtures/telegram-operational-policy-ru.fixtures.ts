import type { TelegramOperationalScenarioFamily } from '../../telegram-operational-knowledge';

export type TelegramOperationalRuFixture = {
  text: string;
  expectedScenario: TelegramOperationalScenarioFamily;
  expectedAction?: 'auto_reply' | 'clarify' | 'slow_ack' | 'escalate';
  knownContext?: { objectLabel?: string | null; bookingReference?: string | null };
};

export const TELEGRAM_OPERATIONAL_POLICY_RU_FIXTURES: TelegramOperationalRuFixture[] = [
  { text: 'Можно поздний выезд до 13:00?', expectedScenario: 'LATE_CHECKOUT' },
  { text: 'Нужен поздний checkout завтра в 14:00', expectedScenario: 'LATE_CHECKOUT' },
  { text: 'Разрешите выезд попозже, около 12:30', expectedScenario: 'LATE_CHECKOUT' },

  { text: 'Не могу открыть дверь, код не работает', expectedScenario: 'ACCESS_KEY_ISSUE', expectedAction: 'escalate' },
  { text: 'Мы у двери, замок не открывается', expectedScenario: 'ACCESS_KEY_ISSUE', expectedAction: 'escalate' },
  { text: 'Гость locked out, cannot enter apartment', expectedScenario: 'ACCESS_KEY_ISSUE', expectedAction: 'escalate' },

  { text: 'Подскажите адрес объекта, как найти дом?', expectedScenario: 'ADDRESS_FIND_OBJECT' },
  { text: 'Как пройти к входу в апартаменты?', expectedScenario: 'ADDRESS_FIND_OBJECT' },
  { text: 'Где именно вход, как вас найти?', expectedScenario: 'ADDRESS_FIND_OBJECT' },

  { text: 'Какой пароль от Wi-Fi?', expectedScenario: 'WIFI' },
  { text: 'Вайфай не подключается в квартире', expectedScenario: 'WIFI' },
  { text: 'Интернет пропал, роутер мигает красным', expectedScenario: 'WIFI' },

  { text: 'Есть ли парковка у дома?', expectedScenario: 'PARKING' },
  { text: 'Где поставить машину на ночь?', expectedScenario: 'PARKING' },
  { text: 'Нужен parking рядом с объектом', expectedScenario: 'PARKING' },

  { text: 'Можно с собакой маленькой?', expectedScenario: 'PETS' },
  { text: 'Разрешены ли питомцы в апартаментах?', expectedScenario: 'PETS' },
  { text: 'Мы с котом, это допустимо?', expectedScenario: 'PETS' },

  { text: 'К нам приедет еще один человек, это ок?', expectedScenario: 'EXTRA_GUESTS' },
  { text: 'Можно добавить доп гостя в бронь?', expectedScenario: 'EXTRA_GUESTS' },
  { text: 'Нас будет 3 вместо 2, что делать?', expectedScenario: 'EXTRA_GUESTS' },

  { text: 'Куда отправить паспорт для заселения?', expectedScenario: 'DOCUMENTS_PASSPORT' },
  { text: 'Какие документы нужны при заезде?', expectedScenario: 'DOCUMENTS_PASSPORT' },
  { text: 'Нужно ли фото паспорта заранее?', expectedScenario: 'DOCUMENTS_PASSPORT' },

  { text: 'Оплатил депозит, проверьте пожалуйста', expectedScenario: 'PAYMENT_DEPOSIT' },
  { text: 'Залог уже внесен, пришлю чек', expectedScenario: 'PAYMENT_DEPOSIT' },
  { text: 'Payment sent, подтвердите поступление', expectedScenario: 'PAYMENT_DEPOSIT' },

  { text: 'Хочу отменить бронь и вернуть деньги', expectedScenario: 'CANCELLATION_REFUND', expectedAction: 'escalate' },
  { text: 'Какие условия отмены и возврата?', expectedScenario: 'CANCELLATION_REFUND', expectedAction: 'escalate' },
  { text: 'Можно сделать refund за отмену?', expectedScenario: 'CANCELLATION_REFUND', expectedAction: 'escalate' },

  { text: 'Нужна уборка сегодня вечером', expectedScenario: 'CLEANING_LINEN_TOWELS' },
  { text: 'Принесите дополнительные полотенца', expectedScenario: 'CLEANING_LINEN_TOWELS' },
  { text: 'Можно сменить постельное белье?', expectedScenario: 'CLEANING_LINEN_TOWELS' },

  { text: 'Жалоба: в квартире сломан фен', expectedScenario: 'COMPLAINTS_PROBLEMS' },
  { text: 'Проблема с техникой, ничего не работает', expectedScenario: 'COMPLAINTS_PROBLEMS' },
  { text: 'У нас complaint по шуму от соседей', expectedScenario: 'COMPLAINTS_PROBLEMS' },

  { text: 'В квартире пожар, много дыма!', expectedScenario: 'EMERGENCY_URGENT_ISSUE', expectedAction: 'escalate' },
  { text: 'Пахнет газом, срочно нужна помощь', expectedScenario: 'EMERGENCY_URGENT_ISSUE', expectedAction: 'escalate' },
  { text: 'Нужно вызвать скорую, человеку плохо', expectedScenario: 'EMERGENCY_URGENT_ISSUE', expectedAction: 'escalate' },

  { text: 'Соедините меня с оператором', expectedScenario: 'OPERATOR_HANDOFF', expectedAction: 'escalate' },
  { text: 'Позовите, пожалуйста, живого человека', expectedScenario: 'OPERATOR_HANDOFF', expectedAction: 'escalate' },
  { text: 'Нужен менеджер прямо сейчас', expectedScenario: 'OPERATOR_HANDOFF', expectedAction: 'escalate' },
];
