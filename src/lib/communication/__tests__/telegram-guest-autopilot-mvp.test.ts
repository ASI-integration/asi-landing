import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  composeCommunicationAutopilotContextReply,
  decideCommunicationAutopilotResponse,
  type CommunicationAutopilotDecision,
} from '../autopilot';
import { canonicalUrgentAccessEscalationText } from '../communication-canon';
import { auditInbound, maskedPreview } from '../audit';
import { shouldEscalateByRules } from '../escalation-policy';
import { saveUserTurn } from '../persistence';
import { __preventRepeatedCommunicationReplyForTests } from '../orchestrator';
import {
  __listCommunicationOperationsActionsForTests,
  __resetCommunicationOperationsActionsForTests,
  upsertCommunicationOperationsAction,
} from '../operations-action';
import { resolveTelegramTextMeta } from '../telegram-text-meta-handler';
import { TELEGRAM_GUEST_INTENT_CANON_V1 } from '../telegram-guest-intent-canon';
import { MessageCategory } from '../types';

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

function canonExample(intent: string): string {
  const rule = TELEGRAM_GUEST_INTENT_CANON_V1.find(item => item.intent === intent);
  const example = rule?.examples[0];
  if (!example) throw new Error(`Missing canon example for ${intent}`);
  return example;
}

describe('Telegram guest autopilot MVP', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    __resetCommunicationOperationsActionsForTests();
  });

  it('answers smalltalk without operations action', () => {
    const meta = resolveTelegramTextMeta({ baseText: 'ты бот?', telegramLangCode: 'ru' });
    expect(meta?.kind).toBe('identity');
    expect(meta?.reply).toMatch(/официальный ассистент ASI/i);
    expect(__listCommunicationOperationsActionsForTests()).toEqual([]);
  });

  it('answers smart bot identity without operations action', () => {
    const meta = resolveTelegramTextMeta({ baseText: 'ты умный бот?', telegramLangCode: 'ru' });
    expect(meta?.kind).toBe('identity');
    expect(meta?.reply).toBe(
      'Да, я официальный ассистент ASI. Помогаю с заселением, доступом, бронью, уборкой и поломками. Напишите, что случилось, я разберу запрос или передам оператору, если нужен человек.',
    );
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
    expect(d.action).toBe('escalate');
    expect(actions).toHaveLength(1);
    expect(actions[0]?.category).toBe('operator_access_support');
  });

  it('uses one combined Telegram urgent access escalation reply', () => {
    expect(
      canonicalUrgentAccessEscalationText({
        channel: 'telegram',
        lang: 'ru',
        category: 'access_issue',
        action: 'escalate_urgent',
      }),
    ).toBe(
      'Понял, это срочно. Уже передаю оператору по доступу. В целях безопасности код двери отправим только после проверки брони.',
    );
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
  it('does not escalate non-urgent check-in code collection only because identity is unresolved', () => {
    const d = decision(canonExample('checkin_code_request'));
    const preRule = shouldEscalateByRules({
      text: 'РјРѕР¶РЅРѕ РїРѕР»СѓС‡РёС‚СЊ РєРѕРґ РїРѕ РЅРѕРјРµСЂСѓ Р±СЂРѕРЅРё?',
      classification: { category: MessageCategory.GuestMessage, lang: 'ru', confidence: 0.96 } as any,
      identity: { status: 'unresolved' } as any,
      reservationResolutionStatus: 'unmatched',
      intent: 'checkin_code_request',
    });

    expect(d.action).toBe('needs_context');
    expect(d.metadata.intent).toBe('checkin_code_request');
    expect(d.metadata.operationsAction).toBeUndefined();
    expect(preRule.escalate).toBe(false);
  });

  it('still escalates urgent access', () => {
    const d = decision(canonExample('access_urgent'));

    expect(d.action).toBe('escalate');
    expect(d.metadata.intent).toBe('urgent_access_problem');
    expect(d.metadata.operationsAction?.category).toBe('operator_access_support');
  });

  it('keeps high-confidence cleaning canon reply instead of anti-loop wording', () => {
    const d = decision(canonExample('cleaning_housekeeping'));

    expect(d.metadata.intent).toBe('cleaning_issue');
    expect(d.metadata.operationsAction?.category).toBe('cleaning');
    expect(d.replyText).not.toMatch(/avoid repeating|operator/i);
  });

  it('masks phone, code, booking-like values and full chat id in audit', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    auditInbound({
      chat_id: 987654321,
      update_id: 1,
      text: 'Телефон +7 999 123-45-67, код 48291, booking ABCD-12345678',
      category: MessageCategory.GuestMessage,
      lang: 'ru',
    });

    const payload = String(log.mock.calls[0]?.[0] ?? '');
    expect(maskedPreview('Телефон +7 999 123-45-67, код 48291, booking ABCD-12345678')).toContain('[phone]');
    expect(payload).toContain('[phone]');
    expect(payload).toContain('[code]');
    expect(payload).toContain('[booking]');
    expect(payload).not.toContain('+7 999 123-45-67');
    expect(payload).not.toContain('987654321');
    log.mockRestore();
  });

  it('does not let Telegram dry-run persistence errors alter routing outcome', async () => {
    vi.stubEnv('TELEGRAM_DRY_RUN', '1');
    await expect(saveUserTurn({
      chat_id: 123456789,
      update_id: 77,
      text: 'dry-run synthetic message',
      category: MessageCategory.GuestMessage,
      lang: 'ru',
    })).resolves.toBeUndefined();

    const d = decision(canonExample('checkin_code_request'));
    expect(d.action).toBe('needs_context');
    expect(d.metadata.intent).toBe('checkin_code_request');
    vi.unstubAllEnvs();
  });

  it('applies anti-loop only to repeated unclear clarification replies', () => {
    const first = __preventRepeatedCommunicationReplyForTests({
      replyText: 'Уточните, пожалуйста, что случилось?',
      lang: 'ru',
      memory: {},
      eligible: true,
    });
    const repeatedUnknown = __preventRepeatedCommunicationReplyForTests({
      replyText: 'Уточните, пожалуйста, что случилось?',
      lang: 'ru',
      memory: { communicationSemanticMemory: { lastReplySignature: first.signature, repeatedReplyCount: 0 } },
      eligible: true,
    });
    const highConfidenceCanon = __preventRepeatedCommunicationReplyForTests({
      replyText: 'Принял, передаю вопрос по уборке.',
      lang: 'ru',
      memory: { communicationSemanticMemory: { lastReplySignature: first.signature, repeatedReplyCount: 1 } },
      eligible: false,
    });

    expect(first.prevented).toBe(false);
    expect(repeatedUnknown.prevented).toBe(true);
    expect(highConfidenceCanon.prevented).toBe(false);
  });
});
