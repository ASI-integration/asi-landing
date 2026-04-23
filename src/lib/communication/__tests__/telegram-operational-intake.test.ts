import { describe, it, expect } from 'vitest';
import { tryTelegramOperationalIntake } from '../telegram-operational-intake';

const base = { update_id: 1, chat_id: 42 };

describe('tryTelegramOperationalIntake', () => {
  it('access_issue EN with property+fail → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Hi, guest John Smith is checking in today at 18:00 at Nevsky 24. He says the door code does not work. Can you help?',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('access_issue');
    expect(hit?.finalAction).toBe('reply');
    expect(hit?.missingFacts).toEqual([]);
    expect(hit?.reply).toMatch(/access issue logged|Understood/i);
  });

  it('access_issue RU with property+fail → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Здравствуйте. Гость John Smith заселяется сегодня в 18:00 по адресу Невский 24. Он пишет, что код от двери не работает. Помогите, пожалуйста.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('access_issue');
    expect(hit?.finalAction).toBe('reply');
    expect(hit?.reply).toMatch(/Понял/i);
  });

  it('access_issue EN without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Guest can’t open the door, code is not working. Check-in today 18:00.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('access_issue');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
    expect(hit?.reply).toMatch(/property|address/i);
  });

  it('access_issue RU urgent risk keyword → escalate', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Срочно: гость не может попасть внутрь, вызывает полицию. Код не подходит.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('access_issue');
    expect(hit?.finalAction).toBe('escalate');
    expect(hit?.reply).toMatch(/срочн|передаю/i);
  });

  it('late_checkout EN without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Hello. Guest Anna Petrova asks for late checkout tomorrow until 13:00. Is it possible?',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('late_checkout');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
    expect(hit?.reply).toMatch(/property|address/i);
  });

  it('late_checkout RU with property → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Гость просит поздний выезд до 14:00 по адресу Невский 24, завтра.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('late_checkout');
    expect(hit?.finalAction).toBe('reply');
    expect(hit?.missingFacts).toEqual([]);
  });

  it('late_checkout EN with @ property → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Late checkout request for guest — tomorrow until 13:00 @ Nevsky 24.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('late_checkout');
    expect(hit?.finalAction).toBe('reply');
  });

  it('late_checkout RU without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Можно поздний выезд до 13:00 завтра?',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('late_checkout');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
  });

  it('early_checkin EN with property → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Guest asks for early check-in tomorrow 11:00 at Nevsky 24.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('early_checkin');
    expect(hit?.finalAction).toBe('reply');
  });

  it('early_checkin RU with property → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Ранний заезд сегодня в 11:00 по адресу Невский 24 возможен?',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('early_checkin');
    expect(hit?.finalAction).toBe('reply');
  });

  it('early_checkin EN without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Early check-in possible at 11:00?',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('early_checkin');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
  });

  it('early_checkin RU without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Можно ранний заезд в 10:00?',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('early_checkin');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
  });

  it('no_heating EN urgent cold → escalate', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Hello. Guest says there is no heating in the apartment and it is very cold. Please help urgently.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('no_heating');
    expect(hit?.finalAction).toBe('escalate');
    expect(hit?.reply).toMatch(/urgent|escalat/i);
  });

  it('no_heating RU urgent signal → escalate', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Очень холодно, отопление не работает, срочно помогите. По адресу Невский 24.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('no_heating');
    expect(hit?.finalAction).toBe('escalate');
  });

  it('no_heating EN non-urgent with property → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'At Nevsky 24 the heating seems off, can you check?',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('no_heating');
    expect(hit?.finalAction).toBe('reply');
  });

  it('no_heating RU without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Отопление не работает, батареи холодные.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('no_heating');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
  });

  it('noise_complaint EN with property → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Noise complaint at Nevsky 24, neighbors are loud with music.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('noise_complaint');
    expect(hit?.finalAction).toBe('reply');
  });

  it('noise_complaint RU now → escalate', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Сейчас шум, музыка и крики у соседей по адресу Невский 24. Срочно.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('noise_complaint');
    expect(hit?.finalAction).toBe('escalate');
  });

  it('noise_complaint EN without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Guest complains about loud neighbors and party music.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('noise_complaint');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
  });

  it('noise_complaint RU without details → clarify(noise_details)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'По адресу Невский 24 жалоба на шум.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('noise_complaint');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('noise_details');
  });

  it('cleaning_request EN towels with property → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Housekeeping: extra towels needed at Nevsky 24 today.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('cleaning_request');
    expect(hit?.finalAction).toBe('reply');
  });

  it('cleaning_request RU уборка with property → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Нужна уборка сегодня в 14:00 по адресу Невский 24.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('cleaning_request');
    expect(hit?.finalAction).toBe('reply');
  });

  it('cleaning_request EN without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Can we schedule cleaning tomorrow?',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('cleaning_request');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
  });

  it('cleaning_request RU without scope → clarify(cleaning_scope)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'По адресу Невский 24 нужна горничная.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('cleaning_request');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('cleaning_scope');
  });

  it('extension_request EN with property → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Guest wants to extend stay by 1 night at Nevsky 24.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('extension_request');
    expect(hit?.finalAction).toBe('reply');
  });

  it('extension_request RU with property → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Гость хочет продлить проживание на 1 ночь по адресу Невский 24.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('extension_request');
    expect(hit?.finalAction).toBe('reply');
  });

  it('extension_request EN without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Extension request: can we add one more night?',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('extension_request');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
  });

  it('extension_request RU without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Можно продлить на сутки?',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('extension_request');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
  });

  it('wifi_issue EN with property and details → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'WiFi at Nevsky 24: password does not work, cannot connect.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('wifi_issue');
    expect(hit?.finalAction).toBe('reply');
  });

  it('wifi_issue RU with property and details → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Вайфай по адресу Невский 24 не подключается, пароль не подходит.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('wifi_issue');
    expect(hit?.finalAction).toBe('reply');
  });

  it('wifi_issue EN without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Wi-Fi is not working.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('wifi_issue');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
  });

  it('wifi_issue RU without details → clarify(wifi_details)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'WiFi по адресу Невский 24.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('wifi_issue');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('wifi_details');
  });

  it('parking_question EN with property + car detail → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Parking question for Nevsky 24: guest arrives by car, where to park overnight?',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('parking_question');
    expect(hit?.finalAction).toBe('reply');
  });

  it('parking_question RU with property + car detail → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Парковка по адресу Невский 24: гость на машине, где можно оставить на ночь?',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('parking_question');
    expect(hit?.finalAction).toBe('reply');
  });

  it('parking_question EN without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Is there parking near the apartment? Guest has a car.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('parking_question');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
  });

  it('parking_question RU without vehicle detail → clarify(vehicle_details)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Парковка по адресу Невский 24?',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('parking_question');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('vehicle_details');
  });

  it('payment_confirmation EN with property + amount → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Payment done for Nevsky 24, I paid 5000 RUB today. Receipt available.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('payment_confirmation');
    expect(hit?.finalAction).toBe('reply');
  });

  it('payment_confirmation RU with property + screenshot mention → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Я оплатил по адресу Невский 24, сейчас отправлю скрин.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('payment_confirmation');
    expect(hit?.finalAction).toBe('reply');
  });

  it('payment_confirmation EN without reference → clarify(payment_reference)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Paid for Nevsky 24.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('payment_confirmation');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('payment_reference');
  });

  it('payment_confirmation RU without property → clarify(property)', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Оплата прошла, чек есть.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('payment_confirmation');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
  });
});
