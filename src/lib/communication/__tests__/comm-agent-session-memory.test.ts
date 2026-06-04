import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyCommAgentSessionContinuation,
  resetCommAgentSessionMemoryForTests,
  updateCommAgentSessionMemory,
} from '../comm-agent-session-memory';
import { decideCommunicationAutopilotResponse } from '../autopilot';

describe('Comm agent session memory v1', () => {
  beforeEach(() => {
    resetCommAgentSessionMemoryForTests();
  });

  it('continues wifi flow when guest sends only booking number', () => {
    updateCommAgentSessionMemory('telegram', '920001', {
      last_intent: 'wifi',
      last_requested_identifier: 'booking_reference',
      last_known_booking_id: null,
      last_known_property_id: null,
      last_safe_reply: 'Напишите номер брони для Wi‑Fi.',
      pending_operator_reason: null,
      last_message_at: new Date().toISOString(),
    });

    const cont = applyCommAgentSessionContinuation({
      channel: 'telegram',
      sessionId: '920001',
      messageText: 'BK-TEST001',
    });

    expect(cont.memory_used).toBe(true);
    expect(cont.continued_intent).toBe('wifi');
    expect(cont.enriched_message_text.toLocaleLowerCase('ru-RU')).toContain('wi-fi');

    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: cont.enriched_message_text,
      context: { session: { language: 'ru' } },
    });
    expect(decision.metadata.intent).toBe('wifi');
  });

  it('continues directions flow when guest sends address fragment', () => {
    updateCommAgentSessionMemory('telegram', '920002', {
      last_intent: 'address_instruction',
      last_requested_identifier: 'address',
      last_known_booking_id: null,
      last_known_property_id: null,
      last_safe_reply: null,
      pending_operator_reason: null,
      last_message_at: new Date().toISOString(),
    });

    const cont = applyCommAgentSessionContinuation({
      channel: 'telegram',
      sessionId: '920002',
      messageText: 'Невский проспект 24',
    });

    expect(cont.memory_used).toBe(true);
    expect(cont.detected_identifier).toBe('address');
  });

  it('does not treat long vague message as follow-up fragment', () => {
    updateCommAgentSessionMemory('telegram', '920003', {
      last_intent: 'wifi',
      last_requested_identifier: 'booking_reference',
      last_known_booking_id: null,
      last_known_property_id: null,
      last_safe_reply: null,
      pending_operator_reason: null,
      last_message_at: new Date().toISOString(),
    });

    const cont = applyCommAgentSessionContinuation({
      channel: 'telegram',
      sessionId: '920003',
      messageText: 'у меня совсем другой вопрос про оплату и возврат денег за прошлую бронь',
    });

    expect(cont.memory_used).toBe(false);
  });
});
