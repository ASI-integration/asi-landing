import { beforeEach, describe, expect, it } from 'vitest';
import {
  composeCommunicationAutopilotContextReply,
  decideCommunicationAutopilotResponse,
  type CommunicationAutopilotDecision,
} from '../autopilot';
import {
  __listCommunicationOperationsActionsForTests,
  __resetCommunicationOperationsActionsForTests,
  upsertCommunicationOperationsAction,
} from '../operations-action';
import { resolveTelegramTextMeta } from '../telegram-text-meta-handler';

function decision(text: string, context = {}) {
  return decideCommunicationAutopilotResponse({
    channel: 'telegram',
    messageText: text,
    context,
  });
}

function registerOperation(d: CommunicationAutopilotDecision): void {
  const op = d.metadata.operationsAction;
  if (!op) return;
  upsertCommunicationOperationsAction({
    sourceChannel: 'telegram',
    category: op.category,
    priority: op.priority,
    reason: op.shortReason,
    reference: { chatId: 42, updateId: 1001 },
  });
}

describe('Telegram guest autopilot MVP', () => {
  beforeEach(() => {
    __resetCommunicationOperationsActionsForTests();
  });

  it('answers smalltalk without operations action', () => {
    const meta = resolveTelegramTextMeta({ baseText: 'ты бот?', telegramLangCode: 'ru' });
    expect(meta?.kind).toBe('smalltalk');
    expect(meta?.reply).toMatch(/бот ASI/i);
    expect(__listCommunicationOperationsActionsForTests()).toEqual([]);
  });

  it('answers ping/test without operations action', () => {
    const ping = resolveTelegramTextMeta({ baseText: 'ping', telegramLangCode: 'ru' });
    const test = resolveTelegramTextMeta({ baseText: 'тест', telegramLangCode: 'ru' });
    expect(ping?.kind).toBe('test_ping');
    expect(test?.kind).toBe('test_ping');
    expect(__listCommunicationOperationsActionsForTests()).toEqual([]);
  });

  it('creates an access support action for access/check-in issues', () => {
    const d = decision('не могу попасть, код не работает');
    registerOperation(d);
    const actions = __listCommunicationOperationsActionsForTests();
    expect(d.metadata.intent).toBe('urgent_access_problem');
    expect(actions).toHaveLength(1);
    expect(actions[0]?.category).toBe('operator_access_support');
  });

  it('creates a maintenance action for maintenance issues', () => {
    const d = decision('сломался душ');
    registerOperation(d);
    const actions = __listCommunicationOperationsActionsForTests();
    expect(d.metadata.intent).toBe('maintenance_issue');
    expect(d.action).toBe('needs_context');
    expect(actions[0]?.category).toBe('maintenance');
  });

  it('creates a cleaning action for housekeeping issues', () => {
    const d = decision('грязно, нет полотенец');
    registerOperation(d);
    const actions = __listCommunicationOperationsActionsForTests();
    expect(d.metadata.intent).toBe('cleaning_issue');
    expect(d.action).toBe('needs_context');
    expect(actions[0]?.category).toBe('cleaning');
  });

  it('asks a category question for unknown messages without immediate escalation', () => {
    const d = decision('что-то непонятное');
    expect(d.metadata.intent).toBe('unknown');
    expect(d.action).toBe('needs_context');
    expect(composeCommunicationAutopilotContextReply({ decision: d, lang: 'ru' })).toBe(
      'Уточните, пожалуйста, что случилось: заселение, доступ, уборка, поломка или вопрос по брони?',
    );
    expect(d.metadata.operationsAction).toBeUndefined();
  });

  it('asks for practical booking details when booking number is missing', () => {
    const d = decision('У меня есть бронь, но номера брони нет');
    const reply = composeCommunicationAutopilotContextReply({ decision: d, lang: 'ru' });
    expect(d.metadata.intent).toBe('booking_lookup_missing_details');
    expect(reply).toMatch(/телефон|имя гостя|дату заезда|объект/i);
    expect(reply).not.toMatch(/пришлите запрос гостя/i);
  });
});
