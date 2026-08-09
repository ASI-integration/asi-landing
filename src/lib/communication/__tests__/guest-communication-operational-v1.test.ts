import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAutopilotSessionPatch,
  runCommunicationAutopilotV1,
} from '../communication-autopilot-v1';
import {
  autopilotSessionFromCollectedData,
  patchAutopilotSessionCollectedData,
} from '../communication-autopilot-session';
import {
  getCommAgentSessionMemory,
  resetCommAgentSessionMemoryForTests,
  updateCommAgentSessionMemory,
} from '../comm-agent-session-memory';
import {
  __resetAutonomousSessionStoreForTests,
  loadAutonomousSession,
  patchAutonomousSessionCollectedData,
} from '../conversation-session-store';
import {
  canAiReply,
  requestOperatorHandoff,
  resolveOperatorHandoffWithReply,
} from '../handoff-lock';
import {
  __resetEscalationReviewStoreForTests,
  getActiveEscalationReviewIdForSession,
} from '../operator-review';
import { _resetForTesting, checkAndMarkKey } from '../idempotency';
import { decideCommunicationAutopilotResponse } from '../autopilot';
import { logCommAgentMetrics } from '../comm-agent-metrics';
import { buildOperatorHandoffDecision } from '../operator-handoff-decision';
import type { TelegramPropertyObjectV1 } from '../telegram-booking-object-memory';

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn(async () => true) }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async () => ({ error: null }),
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'not found' } }) }) }),
    }),
  },
}));

vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    channel: 'telegram',
    normalizeInbound: async () => { throw new Error('not used'); },
    sendMessage: mocks.sendMessage,
    formatResponse: (raw: string) => raw,
  }),
}));

const property: TelegramPropertyObjectV1 = {
  object_id: 'prop-pilot-1',
  object_name: 'Pilot apartment',
  address: 'Санкт-Петербург, Невский проспект, 24',
  directions_text: 'Вход через арку со стороны проспекта.',
  parking_text: 'Парковка во дворе при наличии свободных мест.',
  trash_bins_location: 'Контейнеры справа от арки.',
  waste_disposal_text: 'Мусор нужно вынести в контейнеры справа от арки.',
  wifi_name: 'ASI Guest',
  wifi_password: 'pilot-wifi-24',
  baby_crib_available: true,
  baby_crib_note: 'Кроватка хранится у администратора.',
  check_in_text: 'Заезд после 15:00.',
  checkout_time: '12:00',
  house_rules_text: 'Тишина после 22:00. Животные разрешены только по согласованию.',
  door_code_notes: 'Инструкция доступа доступна только подтверждённому гостю.',
  communication_autopilot: 'enabled',
};

function firstMemory(
  result: ReturnType<typeof runCommunicationAutopilotV1>,
  text: string,
  transport = 'telegram_text',
) {
  return buildAutopilotSessionPatch({
    result,
    messageText: text,
    propertyId: property.object_id,
    propertyName: property.object_name,
    transport,
  });
}

describe('Guest Communication Operational Completion v1', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetEscalationReviewStoreForTests();
    __resetAutonomousSessionStoreForTests();
    resetCommAgentSessionMemoryForTests();
    mocks.sendMessage.mockClear();
  });

  it('1. answers Wi-Fi only from verified property context', () => {
    const result = runCommunicationAutopilotV1({
      messageText: 'Какой пароль от вайфая?',
      property,
      bookingVerified: true,
    });
    expect(result).toMatchObject({ action: 'auto_reply', resolved: true, needsOperator: false, language: 'ru' });
    expect(result.replyText).toContain('pilot-wifi-24');
  });

  it('answers the remaining verified informational pilot topics from canonical object/system knowledge', () => {
    const scenarios = [
      ['Куда выносить мусор?', 'waste', 'контейнеры'],
      ['Есть детская кроватка?', 'baby_crib', 'Кроватка'],
      ['Как связаться с поддержкой?', 'support', 'Напишите здесь'],
      ['What can you help with?', 'support', 'ask for help here'],
    ] as const;
    for (const [messageText, intent, expected] of scenarios) {
      const result = runCommunicationAutopilotV1({ messageText, property, bookingVerified: true });
      expect(result).toMatchObject({ action: 'auto_reply', intent, resolved: true });
      expect(result.replyText).toContain(expected);
    }
  });

  it('2. asks once for booking and resumes Wi-Fi from a booking-only follow-up', () => {
    const first = runCommunicationAutopilotV1({
      messageText: 'Какой пароль от вайфая?',
      property,
      bookingVerified: false,
    });
    const second = runCommunicationAutopilotV1({
      messageText: 'BK-PILOT-2042',
      property,
      bookingVerified: true,
      session: firstMemory(first, 'Какой пароль от вайфая?'),
    });
    expect(first).toMatchObject({ action: 'clarification', requestedMissingField: 'booking_reference' });
    expect(second).toMatchObject({ action: 'auto_reply', intent: 'wifi', memoryUsed: true, language: 'ru' });
  });

  it('3. retains late-checkout intent when the guest follows with only a time', () => {
    const first = runCommunicationAutopilotV1({
      messageText: 'Можно поздний выезд?',
      property,
      bookingVerified: true,
    });
    const second = runCommunicationAutopilotV1({
      messageText: 'До 15',
      property,
      bookingVerified: true,
      session: firstMemory(first, 'Можно поздний выезд?'),
    });
    expect(first).toMatchObject({ action: 'clarification', requestedMissingField: 'requested_time' });
    expect(second).toMatchObject({
      action: 'operator_handoff',
      intent: 'late_checkout_request',
      memoryUsed: true,
      safetyBlockedAction: true,
    });
  });

  it('4. creates one maintenance handoff and suppresses a repeated open handoff', () => {
    const decision = runCommunicationAutopilotV1({ messageText: 'В душе нет горячей воды', property, bookingVerified: true });
    const first = requestOperatorHandoff({
      sessionId: 'maintenance-session', channel: 'telegram', targetId: '5104', escalationReason: decision.escalationReason!,
    });
    const repeated = requestOperatorHandoff({
      sessionId: 'maintenance-session', channel: 'telegram', targetId: '5104', escalationReason: decision.escalationReason!,
    });
    expect(decision).toMatchObject({ action: 'operator_handoff', intent: 'maintenance_issue' });
    expect(repeated).toMatchObject({ alreadyLocked: true, reviewId: first.reviewId });
    expect(getActiveEscalationReviewIdForSession('maintenance-session')).toBe(first.reviewId);
  });

  it('5. treats an unverified lockout as a critical access handoff', () => {
    const result = runCommunicationAutopilotV1({ messageText: 'Не могу войти, код не работает', property: null, bookingVerified: false });
    const routed = decideCommunicationAutopilotResponse({ channel: 'telegram', messageText: 'Не могу войти, код не работает', context: {} });
    const handoff = buildOperatorHandoffDecision({
      channel: 'telegram', transport: 'telegram_voice', guestMessage: 'Не могу войти, код не работает',
      autopilot: routed, sessionId: 'lockout-session', guestIdentity: 'guest-5', conversationSummary: 'Гость не может войти.',
    });
    expect(result).toMatchObject({ action: 'operator_handoff', intent: 'urgent_access_problem', safetyBlockedAction: true });
    expect(routed.metadata.urgent).toBe(true);
    expect(handoff).toMatchObject({
      session_id: 'lockout-session', guest_identity: 'guest-5', guest_transport: 'telegram_voice',
      urgency: 'critical', next_action: 'operator_review_and_reply',
    });
  });

  it('6. hands refund requests to an operator without promising money', () => {
    const result = runCommunicationAutopilotV1({ messageText: 'Верните деньги за бронь', property, bookingVerified: true });
    expect(result).toMatchObject({ action: 'operator_handoff', intent: 'refund_request', safetyBlockedAction: true });
    expect(result.replyText).not.toMatch(/вернул|возврат оформлен|refund issued/i);
  });

  it('7. does not hallucinate a missing property fact', () => {
    const result = runCommunicationAutopilotV1({
      messageText: 'Где парковка?', property: { ...property, parking_text: null }, bookingVerified: true,
    });
    expect(result).toMatchObject({ action: 'clarification', resolved: false });
    expect(result.replyText).not.toContain(property.parking_text);
  });

  it('8. keeps a Russian conversation and handoff acknowledgement in Russian', () => {
    const first = runCommunicationAutopilotV1({ messageText: 'Можно поздний выезд?', property, bookingVerified: true });
    const second = runCommunicationAutopilotV1({ messageText: 'До 15', property, bookingVerified: true, session: firstMemory(first, 'Можно поздний выезд?') });
    expect(second.language).toBe('ru');
    expect(second.replyText).toMatch(/[А-Яа-яЁё]/);
  });

  it('9. keeps an English conversation and handoff acknowledgement in English', () => {
    const first = runCommunicationAutopilotV1({ messageText: 'Can I have a late checkout?', property, bookingVerified: true });
    const second = runCommunicationAutopilotV1({ messageText: 'Until 15', property, bookingVerified: true, session: firstMemory(first, 'Can I have a late checkout?') });
    expect(first).toMatchObject({ action: 'clarification', language: 'en' });
    expect(second).toMatchObject({ action: 'operator_handoff', language: 'en', memoryUsed: true });
    expect(second.replyText).toMatch(/operator/i);
    const switched = runCommunicationAutopilotV1({
      messageText: 'Ответь на английском', property, bookingVerified: true,
      session: firstMemory(runCommunicationAutopilotV1({ messageText: 'Где парковка?', property, bookingVerified: true }), 'Где парковка?'),
    });
    expect(switched).toMatchObject({ action: 'auto_reply', intent: 'language_switch', language: 'en' });
    expect(switched.replyText).toBe('I will continue in English.');
  });

  it('10. converges equivalent text and voice transcripts on the same decision', () => {
    const text = runCommunicationAutopilotV1({ messageText: 'В квартире не работает отопление', property, bookingVerified: true });
    const voice = runCommunicationAutopilotV1({ messageText: 'В квартире не работает отопление', property, bookingVerified: true });
    expect({ action: voice.action, intent: voice.intent, reason: voice.escalationReason }).toEqual({
      action: text.action, intent: text.intent, reason: text.escalationReason,
    });
    expect(firstMemory(text, 'В квартире не работает отопление', 'telegram_text').last_transport).toBe('telegram_text');
    expect(firstMemory(voice, 'В квартире не работает отопление', 'telegram_voice').last_transport).toBe('telegram_voice');
  });

  it('11. records operator resolution, clears pending state and resumes the conversation', async () => {
    updateCommAgentSessionMemory('telegram', '5111', {
      last_intent: 'maintenance_issue', pending_operator_reason: 'maintenance_issue', pending_operator_status: 'open', unresolved_action: 'maintenance_issue',
    });
    patchAutonomousSessionCollectedData({
      chatId: 5111,
      channel: 'telegram',
      set: patchAutopilotSessionCollectedData({
        memory: {
          language: 'ru', last_intent: 'maintenance_issue', unresolved_action: 'maintenance_issue',
          pending_operator_reason: 'maintenance_issue', pending_operator_status: 'open',
        },
      }),
    });
    const handoff = requestOperatorHandoff({ sessionId: 'resolve-session', channel: 'telegram', targetId: '5111', escalationReason: 'maintenance_issue' });
    const resolved = await resolveOperatorHandoffWithReply({ reviewId: handoff.reviewId, operatorId: 'operator-1', replyText: 'Мастер будет после 18:00.' });
    expect(resolved).toMatchObject({ ok: true, state: 'resolved', review: { status: 'closed' } });
    expect(canAiReply('resolve-session')).toBe(true);
    expect(getCommAgentSessionMemory('telegram', '5111')).toMatchObject({ pending_operator_status: 'resolved', unresolved_action: null });
    expect(autopilotSessionFromCollectedData(loadAutonomousSession(5111)?.collected_data)).toMatchObject({
      pending_operator_status: 'resolved', pending_operator_reason: null, unresolved_action: null,
    });
  });

  it('12. survives a process-memory reset through the existing durable session snapshot', () => {
    updateCommAgentSessionMemory('telegram', '5112', {
      last_intent: 'wifi', last_requested_identifier: 'booking_reference', language: 'ru', unresolved_action: 'wifi',
    });
    resetCommAgentSessionMemoryForTests();
    expect(getCommAgentSessionMemory('telegram', '5112')).toMatchObject({ last_intent: 'wifi', unresolved_action: 'wifi' });
    expect(loadAutonomousSession(5112)?.collected_data.comm_agent_session_memory_v1).toBeTruthy();
  });

  it('13. isolates durable memory across guests and channels', () => {
    updateCommAgentSessionMemory('telegram', '5113', { last_intent: 'wifi', language: 'ru' });
    updateCommAgentSessionMemory('telegram', '5114', { last_intent: 'parking', language: 'en' });
    resetCommAgentSessionMemoryForTests();
    expect(getCommAgentSessionMemory('telegram', '5113')?.last_intent).toBe('wifi');
    expect(getCommAgentSessionMemory('telegram', '5114')?.last_intent).toBe('parking');
    expect(getCommAgentSessionMemory('email', '5113')).toBeNull();
  });

  it('14. prevents a duplicate guest reply on an idempotent retry', async () => {
    const handoff = requestOperatorHandoff({ sessionId: 'retry-session', channel: 'telegram', targetId: '5115', escalationReason: 'noise_complaint' });
    const first = await resolveOperatorHandoffWithReply({ reviewId: handoff.reviewId, operatorId: 'operator-2', replyText: 'Проверяем жалобу на шум.' });
    const retry = await resolveOperatorHandoffWithReply({ reviewId: handoff.reviewId, operatorId: 'operator-2', replyText: 'Проверяем жалобу на шум.' });
    expect(first.duplicatePrevented).toBe(false);
    expect(retry.duplicatePrevented).toBe(true);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(checkAndMarkKey({ scope: 'inbound', key: 'telegram:5115:update-1' })).toBe(false);
    expect(checkAndMarkKey({ scope: 'inbound', key: 'telegram:5115:update-1' })).toBe(true);
  });

  it('15. keeps booking, cancellation and payment mutations non-auto-send', () => {
    for (const messageText of ['Измените даты брони', 'Отмените бронирование', 'I dispute this payment']) {
      const result = runCommunicationAutopilotV1({ messageText, property, bookingVerified: true });
      expect(result.action).toBe('operator_handoff');
      expect(result.needsOperator).toBe(true);
      expect(result.safetyBlockedAction).toBe(true);
    }
  });

  it('emits bounded operational metrics for outcome, language, transport, continuation and safety', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logCommAgentMetrics({
      channel: 'telegram', session_key: 'metric-session', intent: 'refund_request', confidence: 0.99,
      action: 'escalate', source: 'session_continuation', memory_used: true, booking_resolved: true,
      operator_needed: true, auto_reply_allowed: false, operational_outcome: 'safety_blocked', language: 'en',
      transport: 'telegram_voice', handoff_reason: 'refund_request', handoff_urgency: 'normal', safety_blocked_action: true,
    });
    const record = JSON.parse(String(spy.mock.calls.at(-1)?.[0]));
    expect(record).toMatchObject({
      'comm.agent.operational_outcome': 'safety_blocked', 'comm.agent.language': 'en',
      'comm.agent.transport': 'telegram_voice', 'comm.agent.memory_used': true,
      'comm.agent.safety_blocked_action': true,
    });
    expect(JSON.stringify(record)).not.toMatch(/password|token|messageText/i);
  });

  it('expires stale durable autopilot memory and keeps the stored payload bounded', () => {
    const stale = firstMemory(
      runCommunicationAutopilotV1({ messageText: 'Где парковка?', property, bookingVerified: true }),
      'Где парковка?',
    );
    stale.expires_at = '2026-08-08T00:00:00.000Z';
    const collected = patchAutopilotSessionCollectedData({ memory: stale });
    patchAutonomousSessionCollectedData({ chatId: 5116, channel: 'telegram', set: collected });
    expect(autopilotSessionFromCollectedData(loadAutonomousSession(5116)?.collected_data, new Date('2026-08-09T00:00:00.000Z'))).toEqual({});
    expect(String(collected.communication_autopilot_session).length).toBeLessThan(2_500);
  });
});
