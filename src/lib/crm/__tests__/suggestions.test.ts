import { describe, expect, it } from 'vitest';
import {
  collectCrmFieldValues,
  getCrmSuggestions,
  resolveCrmRoleInput,
  resolveCrmSourceInput,
} from '../suggestions';
import { CrmContact } from '../types';

const contacts: CrmContact[] = [
  {
    id: '1',
    name: 'Анна',
    phone: '+7 900 111-22-33',
    telegramUsername: 'anna_owner',
    email: 'anna@example.com',
    role: 'owner',
    source: 'bragin_group',
    objectsCount: 2,
    city: 'Москва',
    note: '',
    status: 'new_lead',
    communicationStatus: 'no_contact',
    lastContactAt: null,
    nextStep: 'Написать в Telegram',
    nextActionAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '2',
    name: 'Анна',
    phone: '+7 900 444-55-66',
    telegramUsername: 'anna2',
    email: null,
    role: 'manager',
    source: 'telegram',
    objectsCount: 1,
    city: 'Санкт-Петербург',
    note: '',
    status: 'contact',
    communicationStatus: 'wrote_first',
    lastContactAt: null,
    nextStep: 'Написать в Telegram',
    nextActionAt: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: '3',
    name: 'Борис',
    phone: '',
    telegramUsername: '',
    email: '',
    role: 'unknown',
    source: 'manual',
    objectsCount: 0,
    city: '   ',
    note: '',
    status: 'new_lead',
    communicationStatus: 'no_contact',
    lastContactAt: null,
    nextStep: '',
    nextActionAt: null,
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  },
];

describe('crm suggestions', () => {
  it('deduplicates and skips empty values', () => {
    expect(collectCrmFieldValues(contacts, 'name')).toEqual(['Анна', 'Борис']);
    expect(collectCrmFieldValues(contacts, 'city')).toEqual(['Москва', 'Санкт-Петербург']);
    expect(collectCrmFieldValues(contacts, 'nextStep')).toEqual(['Написать в Telegram']);
  });

  it('filters suggestions by query and limits the list', () => {
    const manyCities = Array.from({ length: 12 }, (_, index) => ({
      ...contacts[0],
      id: `city-${index}`,
      city: `Город ${index}`,
    }));

    expect(getCrmSuggestions(contacts, 'city', 'мо')).toEqual(['Москва']);
    expect(getCrmSuggestions(contacts, 'source', 'груп')).toEqual(['группа Брагина']);
    expect(getCrmSuggestions(manyCities, 'city', '')).toHaveLength(10);
  });

  it('resolves role and source labels back to enum values', () => {
    expect(resolveCrmRoleInput('управляющий')).toBe('manager');
    expect(resolveCrmRoleInput('manager')).toBe('manager');
    expect(resolveCrmSourceInput('группа Брагина')).toBe('bragin_group');
    expect(resolveCrmSourceInput('telegram')).toBe('telegram');
  });
});
