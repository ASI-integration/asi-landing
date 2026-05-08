export type TelegramMultiIntentAcceptanceFixture = {
  name: string;
  text: string;
  expectsOperator: boolean;
  expectedSections: string[];
};

export const TELEGRAM_MULTI_INTENT_ACCEPTANCE_FIXTURES: TelegramMultiIntentAcceptanceFixture[] = [
  {
    name: 'standard_checkin_and_operational_bundle',
    text:
      'Здравствуйте! Можно заезд в 15:00 и ранний заезд в 12:00, поздний выезд до 13:00, как получить ключи, где wi-fi, можно с собакой, есть парковка, какие нужны документы/паспорт и как работает отмена брони?',
    expectsOperator: true,
    expectedSections: ['15:00', 'ранний заезд', 'поздний выезд', 'Wi-Fi', 'парковк'],
  },
  {
    name: 'same_bundle_with_object_booking_known',
    text:
      'По брони BK-77, объект Невский 24: можно заезд в 15:00 и ранний в 12:00, поздний выезд до 13:00, где wi-fi, можно с собакой и есть парковка?',
    expectsOperator: false,
    expectedSections: ['По пунктам', '15:00', 'ранний заезд', 'Wi-Fi', 'парковк'],
  },
  {
    name: 'complaint_and_urgent_cannot_enter',
    text:
      'Жалоба: мы у двери прямо сейчас, не могу войти в квартиру, код двери не работает, срочно нужен оператор.',
    expectsOperator: true,
    expectedSections: ['По пунктам', 'оператор'],
  },
  {
    name: 'unknown_object_asks_once',
    text:
      'Подскажите поздний выезд до 13:00, где wi-fi, можно с кошкой и есть парковка?',
    expectsOperator: false,
    expectedSections: ['По пунктам', 'поздний выезд', 'Wi-Fi', 'парковк'],
  },
];
