import { describe, expect, it } from 'vitest';
import {
  extractPropertyKnowledge,
  mergePropertyKnowledgeIntake,
  redactPropertyKnowledgeIntakeText,
} from '../property-knowledge-intake';
import type { BookingOpsPropertyKnowledge } from '../types';

const EXISTING: BookingOpsPropertyKnowledge = {
  propertyId: 'prop-1',
  propertyLabel: 'Старая карточка',
  address: 'Старый адрес',
  entranceInstructions: null,
  floorApartment: null,
  intercomCode: 'old-door-code',
  keyPickupInstructions: 'Старый код локбокса',
  wifiName: 'Old Wi-Fi',
  wifiPassword: 'old-wifi-password',
  parkingInstructions: null,
  houseRules: null,
  quietHours: null,
  checkoutInstructions: null,
  emergencyInstructions: null,
  cleaningLinenNotes: null,
  publicGuestNotes: null,
  privateOperatorNotes: 'Не менять эту заметку',
  updatedAt: null,
};

describe('Property Knowledge intake extraction', () => {
  it('extracts address, entrance, floor and access instructions', () => {
    const result = extractPropertyKnowledge(`
Адрес: г. Тестов, ул. Примерная, 10
Как войти: вход со двора
Этаж / квартира: 4 этаж, квартира 12
Код домофона: 2468
Локбокс: справа от двери, код 1357
    `);

    expect(result.draft).toMatchObject({
      address: 'г. Тестов, ул. Примерная, 10',
      entranceInstructions: 'вход со двора',
      floorApartment: '4 этаж, квартира 12',
      intercomCode: '2468',
      keyPickupInstructions: 'справа от двери, код 1357',
    });
    expect(extractPropertyKnowledge('Код двери: 9753').draft.intercomCode).toBe('9753');
  });

  it('extracts separate and combined Wi-Fi name/password formats', () => {
    const labelled = extractPropertyKnowledge('Название Wi-Fi: ASI Test\nПароль Wi-Fi: safe-test-123');
    expect(labelled.draft.wifiName).toBe('ASI Test');
    expect(labelled.draft.wifiPassword).toBe('safe-test-123');

    const combined = extractPropertyKnowledge('Wi-Fi: ASI Guest, пароль: guest-456');
    expect(combined.draft.wifiName).toBe('ASI Guest');
    expect(combined.draft.wifiPassword).toBe('guest-456');
  });

  it('extracts parking, rules, quiet hours and multiline checkout instructions', () => {
    const result = extractPropertyKnowledge(`
Парковка: бесплатная у тестового шлагбаума
Правила проживания: без вечеринок
Тихие часы: с 22:00 до 08:00
Выезд: выключить свет
Оставить ключ на столе
    `);

    expect(result.draft.parkingInstructions).toBe('бесплатная у тестового шлагбаума');
    expect(result.draft.houseRules).toBe('без вечеринок');
    expect(result.draft.quietHours).toBe('с 22:00 до 08:00');
    expect(result.draft.checkoutInstructions).toBe('выключить свет\nОставить ключ на столе');
  });

  it('extracts emergency, cleaning, public and private notes', () => {
    const result = extractPropertyKnowledge(`
Экстренная связь: тестовый оператор +7 000 000-00-00
Уборка и бельё: бельё в закрытом шкафу
Заметки для гостя: двор временно ремонтируют
Заметки оператора: проверить запас ключей
    `);

    expect(result.draft).toMatchObject({
      emergencyInstructions: 'тестовый оператор +7 000 000-00-00',
      cleaningLinenNotes: 'бельё в закрытом шкафу',
      publicGuestNotes: 'двор временно ремонтируют',
      privateOperatorNotes: 'проверить запас ключей',
    });
  });
});

describe('Property Knowledge intake safe merge', () => {
  it('does not overwrite non-empty sensitive fields without explicit confirmation', () => {
    const result = mergePropertyKnowledgeIntake({
      propertyId: 'prop-1',
      existing: EXISTING,
      draft: { intercomCode: 'new-code', wifiPassword: 'new-password', address: 'Новый адрес' },
      approvedFields: ['intercomCode', 'wifiPassword', 'address'],
    });

    expect(result.input).toEqual({ propertyId: 'prop-1', address: 'Новый адрес' });
    expect(result.sensitiveConflicts).toEqual(['intercomCode', 'wifiPassword']);
  });

  it('never erases existing values with empty extracted values', () => {
    const result = mergePropertyKnowledgeIntake({
      propertyId: 'prop-1',
      existing: EXISTING,
      draft: { address: '   ', wifiName: '' },
      approvedFields: ['address', 'wifiName'],
    });

    expect(result.input).toEqual({ propertyId: 'prop-1' });
    expect(result.skippedFields).toEqual(['address', 'wifiName']);
  });

  it('preserves private notes unless explicitly accepted and confirms protected changes separately', () => {
    const preserved = mergePropertyKnowledgeIntake({
      propertyId: 'prop-1',
      existing: EXISTING,
      draft: { privateOperatorNotes: 'Новая заметка', keyPickupInstructions: 'Новый код' },
      approvedFields: ['keyPickupInstructions'],
      confirmedSensitiveFields: ['keyPickupInstructions'],
    });
    expect(preserved.input.privateOperatorNotes).toBeUndefined();
    expect(preserved.input.keyPickupInstructions).toBe('Новый код');

    const accepted = mergePropertyKnowledgeIntake({
      propertyId: 'prop-1',
      existing: EXISTING,
      draft: { privateOperatorNotes: 'Новая заметка' },
      approvedFields: ['privateOperatorNotes'],
    });
    expect(accepted.input.privateOperatorNotes).toBe('Новая заметка');
  });

  it('redacts access codes and Wi-Fi passwords from audit-safe text', () => {
    const redacted = redactPropertyKnowledgeIntakeText(
      'Пароль Wi-Fi: top-secret\nКод домофона: 1234\nЛокбокс: код 5678',
    );
    expect(redacted).not.toContain('top-secret');
    expect(redacted).not.toContain('1234');
    expect(redacted).not.toContain('5678');
    expect(redacted.match(/\[СКРЫТО\]/gu)).toHaveLength(3);
  });
});
