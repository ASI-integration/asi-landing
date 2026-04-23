import { describe, it, expect } from 'vitest';
import { decideEscalationMatrixV1 } from '../escalation-matrix';

describe('decideEscalationMatrixV1', () => {
  // access_issue (3)
  it('access_issue EN locked out now -> escalate_urgent', () => {
    const d = decideEscalationMatrixV1({
      category: 'access_issue',
      text: "Guest is at the door right now and can't get in. Locked out, code not working.",
      surfaceLang: 'en',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_urgent');
    expect(d.urgency_signals).toContain('locked_out');
  });

  it('access_issue RU check-in blocked -> escalate_urgent', () => {
    const d = decideEscalationMatrixV1({
      category: 'access_issue',
      text: 'Гость сейчас у двери, не может попасть внутрь. Заселение сейчас, код не подходит.',
      surfaceLang: 'ru',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_urgent');
    expect(d.urgency_signals).toContain('active_checkin_blocked');
  });

  it('access_issue EN missing property -> clarify', () => {
    const d = decideEscalationMatrixV1({
      category: 'access_issue',
      text: 'Door code is not working.',
      surfaceLang: 'en',
      missingFacts: ['property'],
    });
    expect(d.action).toBe('clarify');
  });

  // no_heating (3)
  it('no_heating RU night signal -> escalate_urgent', () => {
    const d = decideEscalationMatrixV1({
      category: 'no_heating',
      text: 'Ночью очень холодно, отопление не работает.',
      surfaceLang: 'ru',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_urgent');
    expect(d.urgency_signals).toContain('night');
  });

  it('no_heating EN child mentioned -> escalate_urgent', () => {
    const d = decideEscalationMatrixV1({
      category: 'no_heating',
      text: "No heating and we have a baby. It's cold.",
      surfaceLang: 'en',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_urgent');
    expect(d.urgency_signals).toContain('child');
  });

  it('no_heating EN mild -> reply', () => {
    const d = decideEscalationMatrixV1({
      category: 'no_heating',
      text: 'The heating seems off, can you check tomorrow?',
      surfaceLang: 'en',
      missingFacts: [],
    });
    expect(d.action).toBe('reply');
  });

  // noise_complaint (3)
  it('noise_complaint EN active disturbance -> escalate_operator', () => {
    const d = decideEscalationMatrixV1({
      category: 'noise_complaint',
      text: "There is a loud party right now, can't sleep.",
      surfaceLang: 'en',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_operator');
    expect(d.urgency_signals).toContain('active_disturbance');
  });

  it('noise_complaint RU safety concern -> escalate_urgent', () => {
    const d = decideEscalationMatrixV1({
      category: 'noise_complaint',
      text: 'Соседи дерутся, вызывают полицию, шум сейчас.',
      surfaceLang: 'ru',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_urgent');
    expect(d.urgency_signals).toContain('safety_risk');
  });

  it('noise_complaint EN missing property -> clarify', () => {
    const d = decideEscalationMatrixV1({
      category: 'noise_complaint',
      text: 'Noise complaint about neighbors.',
      surfaceLang: 'en',
      missingFacts: ['property'],
    });
    expect(d.action).toBe('clarify');
  });

  // payment_confirmation (3)
  it('payment_confirmation EN mismatch -> escalate_operator', () => {
    const d = decideEscalationMatrixV1({
      category: 'payment_confirmation',
      text: 'I paid but booking not found / mismatch in amount.',
      surfaceLang: 'en',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_operator');
    expect(d.urgency_signals).toContain('payment_conflict');
  });

  it('payment_confirmation RU no conflict -> reply', () => {
    const d = decideEscalationMatrixV1({
      category: 'payment_confirmation',
      text: 'Оплата прошла, отправил чек.',
      surfaceLang: 'ru',
      missingFacts: [],
    });
    expect(d.action).toBe('reply');
  });

  it('payment_confirmation EN missing reference -> clarify', () => {
    const d = decideEscalationMatrixV1({
      category: 'payment_confirmation',
      text: 'Paid.',
      surfaceLang: 'en',
      missingFacts: ['payment_reference'],
    });
    expect(d.action).toBe('clarify');
  });

  // late_checkout (3)
  it('late_checkout EN default -> reply', () => {
    const d = decideEscalationMatrixV1({
      category: 'late_checkout',
      text: 'Request late checkout until 13:00.',
      surfaceLang: 'en',
      missingFacts: [],
    });
    expect(d.action).toBe('reply');
  });

  it('late_checkout RU missing property -> clarify', () => {
    const d = decideEscalationMatrixV1({
      category: 'late_checkout',
      text: 'Можно поздний выезд?',
      surfaceLang: 'ru',
      missingFacts: ['property'],
    });
    expect(d.action).toBe('clarify');
  });

  it('late_checkout EN safety risk word -> escalate_urgent', () => {
    const d = decideEscalationMatrixV1({
      category: 'late_checkout',
      text: 'Late checkout. Fire alarm issue.',
      surfaceLang: 'en',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_urgent');
  });

  // early_checkin (3)
  it('early_checkin RU default -> reply', () => {
    const d = decideEscalationMatrixV1({
      category: 'early_checkin',
      text: 'Можно ранний заезд в 11:00 по адресу Невский 24?',
      surfaceLang: 'ru',
      missingFacts: [],
    });
    expect(d.action).toBe('reply');
  });

  it('early_checkin EN missing property -> clarify', () => {
    const d = decideEscalationMatrixV1({
      category: 'early_checkin',
      text: 'Early check-in possible?',
      surfaceLang: 'en',
      missingFacts: ['property'],
    });
    expect(d.action).toBe('clarify');
  });

  it('early_checkin RU safety risk -> escalate_urgent', () => {
    const d = decideEscalationMatrixV1({
      category: 'early_checkin',
      text: 'Ранний заезд. Газ и запах, срочно.',
      surfaceLang: 'ru',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_urgent');
  });

  // parking_question (3)
  it('parking_question EN default -> reply', () => {
    const d = decideEscalationMatrixV1({
      category: 'parking_question',
      text: 'Where can we park overnight?',
      surfaceLang: 'en',
      missingFacts: [],
    });
    expect(d.action).toBe('reply');
  });

  it('parking_question RU missing vehicle details -> clarify', () => {
    const d = decideEscalationMatrixV1({
      category: 'parking_question',
      text: 'Парковка по адресу?',
      surfaceLang: 'ru',
      missingFacts: ['vehicle_details'],
    });
    expect(d.action).toBe('clarify');
  });

  it('parking_question EN safety risk -> escalate_urgent', () => {
    const d = decideEscalationMatrixV1({
      category: 'parking_question',
      text: 'Parking question, there is smoke in the garage.',
      surfaceLang: 'en',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_urgent');
  });

  // wifi_issue (3)
  it('wifi_issue RU default -> reply', () => {
    const d = decideEscalationMatrixV1({
      category: 'wifi_issue',
      text: 'Wi‑Fi не работает, пароль не подходит.',
      surfaceLang: 'ru',
      missingFacts: [],
    });
    expect(d.action).toBe('reply');
  });

  it('wifi_issue EN missing details -> clarify', () => {
    const d = decideEscalationMatrixV1({
      category: 'wifi_issue',
      text: 'WiFi issue.',
      surfaceLang: 'en',
      missingFacts: ['wifi_details'],
    });
    expect(d.action).toBe('clarify');
  });

  it('wifi_issue RU safety risk -> escalate_urgent', () => {
    const d = decideEscalationMatrixV1({
      category: 'wifi_issue',
      text: 'Интернет не работает, но главное: пожар/дым в квартире.',
      surfaceLang: 'ru',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_urgent');
  });

  // cleaning_request (3)
  it('cleaning_request EN default -> reply', () => {
    const d = decideEscalationMatrixV1({
      category: 'cleaning_request',
      text: 'Request cleaning tomorrow at 14:00.',
      surfaceLang: 'en',
      missingFacts: [],
    });
    expect(d.action).toBe('reply');
  });

  it('cleaning_request RU missing scope -> clarify', () => {
    const d = decideEscalationMatrixV1({
      category: 'cleaning_request',
      text: 'Нужна горничная.',
      surfaceLang: 'ru',
      missingFacts: ['cleaning_scope'],
    });
    expect(d.action).toBe('clarify');
  });

  it('cleaning_request EN safety risk -> escalate_urgent', () => {
    const d = decideEscalationMatrixV1({
      category: 'cleaning_request',
      text: 'Need cleaning, gas leak smell.',
      surfaceLang: 'en',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_urgent');
  });

  // extension_request (3)
  it('extension_request RU default -> reply', () => {
    const d = decideEscalationMatrixV1({
      category: 'extension_request',
      text: 'Можно продлить на 1 ночь?',
      surfaceLang: 'ru',
      missingFacts: [],
    });
    expect(d.action).toBe('reply');
  });

  it('extension_request EN missing property -> clarify', () => {
    const d = decideEscalationMatrixV1({
      category: 'extension_request',
      text: 'Extend stay by one night.',
      surfaceLang: 'en',
      missingFacts: ['property'],
    });
    expect(d.action).toBe('clarify');
  });

  it('extension_request RU safety risk -> escalate_urgent', () => {
    const d = decideEscalationMatrixV1({
      category: 'extension_request',
      text: 'Продление. Пожарная тревога/дым.',
      surfaceLang: 'ru',
      missingFacts: [],
    });
    expect(d.action).toBe('escalate_urgent');
  });
});

