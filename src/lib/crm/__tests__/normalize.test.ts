import { describe, expect, it } from 'vitest';
import { normalizeCrmContactInput, validateCrmContact, validateCrmContactPayload } from '../normalize';

describe('CRM contact normalization', () => {
  it('normalizes user input and strips telegram prefix', () => {
    const input = normalizeCrmContactInput({
      name: '  Анна  ',
      phone: '+7 900',
      telegramUsername: '@anna',
      objectsCount: '3',
      role: 'owner',
      source: 'telegram',
      status: 'pilot',
      communicationStatus: 'replied',
      nextActionAt: '2026-06-20T10:00:00+03:00',
    });

    expect(input).toMatchObject({
      name: 'Анна',
      telegramUsername: 'anna',
      objectsCount: 3,
      role: 'owner',
      source: 'telegram',
      status: 'active_pilot',
      communicationStatus: 'replied',
      nextActionAt: '2026-06-20T07:00:00.000Z',
    });
  });

  it('requires a name and at least one contact channel', () => {
    const empty = normalizeCrmContactInput({ name: ' ' });
    expect(validateCrmContact(empty)).toBe('Укажите имя контакта.');

    const withoutContact = normalizeCrmContactInput({ name: 'Илья' });
    expect(validateCrmContact(withoutContact)).toBe('Укажите хотя бы один способ связи.');

    const valid = normalizeCrmContactInput({ name: 'Илья', telegramUsername: '@ilya' });
    expect(validateCrmContact(valid)).toBeNull();
  });

  it('rejects invalid creation and update payloads instead of silently replacing values', () => {
    expect(validateCrmContactPayload({ name: 'Анна', email: 'не-email' })).toBe('Проверьте адрес email.');
    expect(validateCrmContactPayload({ name: 'Анна', phone: '+7', status: 'unknown-stage' })).toBe(
      'Проверьте данные заявки.',
    );
    expect(validateCrmContactPayload({ name: 'Анна', phone: '+7', objectsCount: -1 })).toBe(
      'Укажите количество объектов от 0 до 999.',
    );
    expect(validateCrmContactPayload({ nextActionAt: 'не дата' }, true)).toBe(
      'Проверьте дату следующего действия.',
    );
    expect(validateCrmContactPayload({}, true)).toBe('Нет изменений для сохранения.');
  });
});
