import { describe, expect, it } from 'vitest';

import {
  buildAutopilotSessionPatch,
  runCommunicationAutopilotV1,
} from '../communication-autopilot-v1';

function unclearTurn(messageText: string, session?: Parameters<typeof runCommunicationAutopilotV1>[0]['session']) {
  return runCommunicationAutopilotV1({
    messageText,
    property: null,
    bookingVerified: true,
    session,
    language: 'ru',
  });
}

describe('communication autopilot clarification before handoff', () => {
  it('asks the guest to repeat once instead of immediately escalating an unclear message', () => {
    const result = unclearTurn('эээ... ну там это...');

    expect(result.action).toBe('clarification');
    expect(result.needsOperator).toBe(false);
    expect(result.intent).toBe('unclear_situation');
    expect(result.requestedMissingField).toBe('guest_question_repeat');
    expect(result.replyText).toMatch(/повторите/i);
  });

  it('hands off only when the repeated question is still unclear within the clarification window', () => {
    const first = unclearTurn('эээ... ну там это...');
    const session = buildAutopilotSessionPatch({
      result: first,
      messageText: 'эээ... ну там это...',
      now: new Date(),
    });

    const second = unclearTurn('ну вот это самое...', session);

    expect(second.action).toBe('operator_handoff');
    expect(second.needsOperator).toBe(true);
    expect(second.intent).toBe('unclear_situation_after_clarification');
    expect(second.escalationReason).toBe('unclear_situation_after_clarification');
    expect(second.replyText).toMatch(/оператор/i);
  });

  it('answers normally when the repeated question becomes understandable', () => {
    const first = unclearTurn('эээ... ну там это...');
    const session = buildAutopilotSessionPatch({
      result: first,
      messageText: 'эээ... ну там это...',
      now: new Date(),
    });

    const second = runCommunicationAutopilotV1({
      messageText: 'До которого часа можно громко включать музыку?',
      property: {
        object_id: 'test-property',
        house_rules_text: 'Тишина после 22:00.',
      } as any,
      bookingVerified: true,
      session,
      language: 'ru',
    });

    expect(second.action).toBe('auto_reply');
    expect(second.needsOperator).toBe(false);
    expect(second.topic).toBe('house_rules');
    expect(second.replyText).toContain('22:00');
  });

  it('starts a fresh clarification after the previous clarification window expires', () => {
    const first = unclearTurn('эээ... ну там это...');
    const session = buildAutopilotSessionPatch({
      result: first,
      messageText: 'эээ... ну там это...',
      now: new Date(Date.now() - 11 * 60 * 1000),
    });

    const later = unclearTurn('ну вот это самое...', session);

    expect(later.action).toBe('clarification');
    expect(later.needsOperator).toBe(false);
    expect(later.intent).toBe('unclear_situation');
  });

  it('still escalates safety-sensitive messages immediately without clarification', () => {
    const result = unclearTurn('Не могу попасть в квартиру, замок не работает.');

    expect(result.action).toBe('operator_handoff');
    expect(result.needsOperator).toBe(true);
    expect(result.intent).toBe('urgent_access_problem');
  });
});
