import { describe, expect, it } from 'vitest';
import type { OpsProperty, PropertyMasterCard, PropertyMedia } from '@/lib/ops-foundation/types';
import { createEmptySetupData } from '@/lib/property-setup/setup-data';
import {
  buildCrmPropertyAutomationSummary,
  deriveCrmAutomationSuggestion,
  missingDataActionsForFields,
} from '../automation-loop';

const property: OpsProperty = {
  id: 'prop-1',
  accountId: 'acct-1',
  title: 'Апартаменты ASI',
  address: null,
  city: 'Москва',
  timezone: 'Europe/Moscow',
  status: 'draft',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

const masterCard: PropertyMasterCard = {
  id: 'card-1',
  propertyId: 'prop-1',
  publicTitle: null,
  shortDescription: null,
  fullDescription: null,
  amenities: [],
  houseRules: null,
  checkInInstructions: null,
  checkOutInstructions: null,
  wifiName: null,
  wifiPassword: null,
  parkingInfo: null,
  depositInfo: null,
  extraFeesInfo: null,
  cancellationInfo: null,
  guestContactsInfo: null,
  internalNotes: null,
  contentVersion: 1,
  publicationStatus: 'draft',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

const photo: PropertyMedia = {
  id: 'photo-1',
  propertyId: 'prop-1',
  url: 'https://example.com/photo.jpg',
  storagePath: null,
  title: null,
  description: null,
  sortOrder: 0,
  isCover: true,
  status: 'active',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

describe('CRM automation loop', () => {
  it('maps missing autopilot context to setup actions', () => {
    const actions = missingDataActionsForFields(
      ['object.address', 'object.directionsText', 'object.wifiPassword'],
      'prop-1',
    );

    expect(actions).toEqual([
      expect.objectContaining({ label: 'Адрес объекта', setupHref: '/dashboard/properties/prop-1/setup?step=address' }),
      expect.objectContaining({ label: 'Инструкции по заезду', setupHref: '/dashboard/properties/prop-1/setup?step=checkin' }),
      expect.objectContaining({ label: 'Пароль Wi-Fi', setupHref: '/dashboard/properties/prop-1/setup?step=wifi' }),
    ]);
  });

  it('suggests next actions from role and property readiness', () => {
    const ownerWithoutProperty = deriveCrmAutomationSuggestion({
      role: 'owner',
      status: 'qualified',
      source: 'telegram',
      propertyId: null,
      explicitNextAction: '',
    });
    expect(ownerWithoutProperty).toMatchObject({
      effectiveStatus: 'qualified',
      suggestedNextAction: 'Создать или выбрать объект',
      nextActionHref: '/dashboard/properties',
    });

    const setup = createEmptySetupData();
    setup.basic.title = 'Апартаменты ASI';
    const summary = buildCrmPropertyAutomationSummary({
      property,
      masterCard,
      setup,
      media: [],
    });
    const linkedProperty = deriveCrmAutomationSuggestion({
      role: 'owner',
      status: 'qualified',
      source: 'telegram',
      propertyId: 'prop-1',
      explicitNextAction: '',
      propertySummary: summary,
    });

    expect(linkedProperty).toMatchObject({
      effectiveStatus: 'creating_object',
      suggestedNextAction: 'Заполнить адрес и город',
      nextActionHref: '/dashboard/properties/prop-1/setup?step=address',
    });
  });

  it('marks operationally filled object as object_filled', () => {
    const setup = createEmptySetupData();
    setup.basic.title = 'Апартаменты ASI';
    setup.basic.city = 'Москва';
    setup.address.line = 'Тверская, 1';
    setup.checkInOut.checkInTime = '15:00';
    setup.checkInOut.checkOutTime = '12:00';
    setup.checkInOut.checkInInstructions = 'Ключи в сейфе.';
    setup.wifi.wifiName = 'ASI';
    setup.wifi.wifiPassword = 'secret';
    setup.wifi.entryInstructions = 'Вход со двора.';
    setup.rules.smoking = 'Запрещено';
    setup.description.full = 'Уютная квартира.';

    const summary = buildCrmPropertyAutomationSummary({
      property: { ...property, address: 'Тверская, 1' },
      masterCard,
      setup,
      media: [photo],
    });
    const suggestion = deriveCrmAutomationSuggestion({
      role: 'owner',
      status: 'creating_object',
      source: 'telegram',
      propertyId: 'prop-1',
      explicitNextAction: '',
      propertySummary: summary,
    });

    expect(summary.isOperationallyReady).toBe(true);
    expect(suggestion.effectiveStatus).toBe('object_filled');
  });

  it('suggests pilot candidate and selected pilot next actions', () => {
    const candidateWithoutTelegram = deriveCrmAutomationSuggestion({
      role: 'owner',
      status: 'pilot_candidate',
      source: 'pilot_form',
      contact: null,
      telegramDisplay: null,
      propertyId: null,
      explicitNextAction: '',
    });

    expect(candidateWithoutTelegram).toMatchObject({
      effectiveStatus: 'pilot_candidate',
      suggestedNextAction: 'Уточнить Telegram для подключения',
    });

    const selectedWithoutProperty = deriveCrmAutomationSuggestion({
      role: 'owner',
      status: 'pilot_selected',
      source: 'pilot_form',
      contact: '@pilot_owner',
      telegramDisplay: '@pilot_owner',
      propertyId: null,
      explicitNextAction: 'Выбрать в пилот и предложить создать объект',
    });

    expect(selectedWithoutProperty).toMatchObject({
      effectiveStatus: 'pilot_selected',
      suggestedNextAction: 'Предложить создать объект',
      nextActionHref: '/dashboard/properties',
    });
  });

  it('moves selected pilot with object into setup and then guest_test', () => {
    const incompleteSetup = createEmptySetupData();
    incompleteSetup.basic.title = 'Апартаменты ASI';
    const incompleteSummary = buildCrmPropertyAutomationSummary({
      property,
      masterCard,
      setup: incompleteSetup,
      media: [],
    });

    const creatingObject = deriveCrmAutomationSuggestion({
      role: 'owner',
      status: 'pilot_selected',
      source: 'pilot_form',
      contact: '@pilot_owner',
      telegramDisplay: '@pilot_owner',
      propertyId: 'prop-1',
      explicitNextAction: '',
      propertySummary: incompleteSummary,
    });

    expect(creatingObject).toMatchObject({
      effectiveStatus: 'creating_object',
      suggestedNextAction: 'Заполнить адрес и город',
      nextActionHref: '/dashboard/properties/prop-1/setup?step=address',
    });

    const readySetup = createEmptySetupData();
    readySetup.basic.title = 'Апартаменты ASI';
    readySetup.basic.city = 'Москва';
    readySetup.address.line = 'Тверская, 1';
    readySetup.checkInOut.checkInTime = '15:00';
    readySetup.checkInOut.checkOutTime = '12:00';
    readySetup.checkInOut.checkInInstructions = 'Ключи в сейфе.';
    readySetup.wifi.wifiName = 'ASI';
    readySetup.wifi.wifiPassword = 'secret';
    readySetup.wifi.entryInstructions = 'Вход со двора.';
    readySetup.rules.smoking = 'Запрещено';
    readySetup.description.full = 'Уютная квартира.';

    const readySummary = buildCrmPropertyAutomationSummary({
      property: { ...property, address: 'Тверская, 1' },
      masterCard,
      setup: readySetup,
      media: [photo],
    });

    const readyObject = deriveCrmAutomationSuggestion({
      role: 'owner',
      status: 'pilot_selected',
      source: 'pilot_form',
      contact: '@pilot_owner',
      telegramDisplay: '@pilot_owner',
      propertyId: 'prop-1',
      explicitNextAction: '',
      propertySummary: readySummary,
    });

    expect(readyObject).toMatchObject({
      effectiveStatus: 'object_filled',
      suggestedNextAction: 'Запустить тест гостя',
      nextActionHref: expect.stringContaining('guest_test_prop-1'),
    });
  });
});
