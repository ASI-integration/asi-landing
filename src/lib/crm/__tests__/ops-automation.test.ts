import { describe, expect, it } from 'vitest';
import type { CrmContact } from '../types';
import {
  buildCrmOpsAutomationPatch,
  evaluateCrmOpsAutomation,
} from '../ops-automation';

const baseContact: CrmContact = {
  id: 'lead-1',
  name: 'Анна',
  phone: '+79990000000',
  telegramUsername: 'anna',
  email: null,
  role: 'owner',
  source: 'telegram',
  objectsCount: 0,
  city: 'Москва',
  note: 'Заметка оператора',
  status: 'new',
  communicationStatus: 'replied',
  lastContactAt: null,
  nextStep: '',
  nextActionAt: null,
  createdAt: '2026-06-27T08:00:00.000Z',
  updatedAt: '2026-06-27T08:00:00.000Z',
};

describe('OPS Automation v1', () => {
  it('computes a controlled next action for a new application', () => {
    const result = evaluateCrmOpsAutomation(baseContact, '2026-06-27T09:00:00.000Z');

    expect(result).toMatchObject({
      currentStage: 'new',
      nextAction: 'send_instruction',
      automationState: 'action_required',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedStatus: null,
    });
    expect(buildCrmOpsAutomationPatch(baseContact)).toEqual({ nextStep: 'Отправить инструкцию' });
  });

  it('advances only when channel manager data confirms access', () => {
    const contact: CrmContact = {
      ...baseContact,
      status: 'access_requested',
      channelManagerConnection: {
        objectId: 'OBJ-1',
        contactId: 'lead-1',
        method: 'bnovo',
        customManagerName: null,
        accessSituation: 'has_access',
        status: 'ready_to_connect',
        nextStepRu: 'Продолжить',
        updatedAt: '2026-06-27T09:00:00.000Z',
      },
    };

    expect(evaluateCrmOpsAutomation(contact)).toMatchObject({
      nextAction: 'mark_access_received',
      canAutoPerform: true,
      recommendedStatus: 'access_received',
    });
    expect(buildCrmOpsAutomationPatch(contact)).toEqual({
      status: 'access_received',
      nextStep: 'Выбрать тестовый объект',
    });
  });

  it('selects a single known object and marks a prepared object ready', () => {
    const oneObject: CrmContact = {
      ...baseContact,
      status: 'access_received',
      objectsCount: 1,
      activeObjectTitle: 'Апартаменты на Невском',
    };
    expect(buildCrmOpsAutomationPatch(oneObject)).toEqual({
      status: 'test_object_selected',
      nextStep: 'Открыть менеджер каналов',
    });

    const prepared: CrmContact = {
      ...baseContact,
      status: 'test_object_selected',
      onboarding: {
        status: 'ready_for_channel_manager',
        statusLabel: 'готов к менеджеру каналов',
        missing: [],
        lastMessage: '',
        channelManagerHref: '/dashboard/channel-connections',
        readinessPercent: 100,
        readinessStatusLabel: 'Готово',
        nextBestStep: null,
        missingOptional: [],
      },
    };
    expect(buildCrmOpsAutomationPatch(prepared)).toEqual({
      status: 'ready_for_setup',
      nextStep: 'Открыть менеджер каналов',
    });
  });

  it('preserves manual override and never includes notes in a patch', () => {
    const contact: CrmContact = {
      ...baseContact,
      status: 'access_received',
      objectsCount: 1,
      activeObjectTitle: 'Объект 1',
      nextStep: 'Сначала позвонить владельцу',
    };

    expect(evaluateCrmOpsAutomation(contact)).toMatchObject({
      automationState: 'manual_override',
      canAutoPerform: false,
      recommendedStatus: null,
    });
    const patch = buildCrmOpsAutomationPatch(contact);
    expect(patch).toEqual({});
    expect(patch).not.toHaveProperty('note');
  });

  it('routes ambiguous and problem states to operator attention', () => {
    expect(evaluateCrmOpsAutomation({ ...baseContact, status: 'access_received' })).toMatchObject({
      nextAction: 'choose_test_property',
      automationState: 'needs_operator_attention',
      needsOperatorAction: true,
      recommendedStatus: null,
    });
    expect(evaluateCrmOpsAutomation({ ...baseContact, communicationStatus: 'has_problem' })).toMatchObject({
      nextAction: 'problem_detected',
      automationState: 'needs_operator_attention',
      needsOperatorAction: true,
    });
  });
});
