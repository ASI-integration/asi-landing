import { describe, expect, it } from 'vitest';
import { executeTelegramOperationalPolicy } from '../telegram-operational-policy-executor';

describe('executeTelegramOperationalPolicy', () => {
  it('15:00 check-in asks for object/booking when missing', () => {
    const result = executeTelegramOperationalPolicy({
      messageText: 'Здравствуйте, хочу заехать завтра в 15:00',
      update_id: 1001,
    });
    expect(result.scenarioFamily).toBe('CHECK_IN_STANDARD');
    expect(result.action).toBe('clarify');
  });

  it('07:00 is very early check-in', () => {
    const result = executeTelegramOperationalPolicy({
      messageText: 'А если заехать в 07:00?',
      update_id: 1002,
      knownContext: { objectLabel: 'Тверская 7' },
    });
    expect(result.scenarioFamily).toBe('CHECK_IN_VERY_EARLY');
  });

  it('07:00 policy does not include cleaning mention without cleaning context', () => {
    const noCleaning = executeTelegramOperationalPolicy({
      messageText: 'А если в 07:00 заезд?',
      update_id: 1003,
      knownContext: { objectLabel: 'Тверская 7', cleaningStatusKnown: false },
    });
    expect(noCleaning.forbiddenClaims).toContain('do_not_mention_cleaning_without_explicit_cleaning_context');

    const withCleaning = executeTelegramOperationalPolicy({
      messageText: 'А если в 07:00 заезд?',
      update_id: 1004,
      knownContext: { objectLabel: 'Тверская 7', cleaningStatusKnown: true },
    });
    expect(withCleaning.forbiddenClaims).not.toContain('do_not_mention_cleaning_without_explicit_cleaning_context');
  });

  it('12:00 is conditional early check-in', () => {
    const result = executeTelegramOperationalPolicy({
      messageText: 'Можно заехать в 12:00?',
      update_id: 1005,
      knownContext: { objectLabel: 'Тверская 7' },
    });
    expect(result.scenarioFamily).toBe('CHECK_IN_EARLY');
  });

  it('object/booking context persists after clarification', () => {
    const clarified = executeTelegramOperationalPolicy({
      messageText: 'Та же бронь, объект на Тверской',
      update_id: 1006,
    });
    expect(clarified.scenarioFamily).toBe('BOOKING_CONTEXT');

    const followUp = executeTelegramOperationalPolicy({
      messageText: 'А если в 07:00?',
      update_id: 1007,
      sessionMemory: clarified.nextSessionMemory,
    });
    expect(followUp.scenarioFamily).toBe('CHECK_IN_VERY_EARLY');
    expect(followUp.action).toBe('auto_reply');
  });

  it('unknown operational request gets slow_ack then escalate', () => {
    const first = executeTelegramOperationalPolicy({
      messageText: 'Уточните нестандартный операционный момент',
      update_id: 1008,
    });
    expect(first.action).toBe('slow_ack');

    const second = executeTelegramOperationalPolicy({
      messageText: 'Уточните нестандартный операционный момент',
      update_id: 1009,
      sessionMemory: first.nextSessionMemory,
    });
    expect(second.action).toBe('escalate');
  });

  it('does not repeat slow_ack for same inbound update id', () => {
    const first = executeTelegramOperationalPolicy({
      messageText: 'Неизвестный запрос',
      update_id: 1010,
    });
    expect(first.action).toBe('slow_ack');

    const secondSameUpdate = executeTelegramOperationalPolicy({
      messageText: 'Неизвестный запрос',
      update_id: 1010,
      sessionMemory: first.nextSessionMemory,
    });
    expect(secondSameUpdate.action).toBe('escalate');
    expect(secondSameUpdate.scenarioFamily).toBe('ESCALATE_TO_OPERATOR');
  });
});

