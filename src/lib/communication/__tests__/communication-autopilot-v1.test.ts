import { describe, expect, it } from 'vitest';
import { isCommunicationAutopilotEnabled } from '../communication-autopilot-settings';
import {
  AUTOPILOT_MISSING_KNOWLEDGE_REPLY_RU,
  classifyKnowledgeTopic,
  requiresAutopilotOperatorEscalation,
  resolveKnowledgeAnswer,
} from '../knowledge-resolver';
import { buildAutopilotSessionPatch, runCommunicationAutopilotV1 } from '../communication-autopilot-v1';
import type { TelegramPropertyObjectV1 } from '../telegram-booking-object-memory';

const property: TelegramPropertyObjectV1 = {
  object_id: 'prop-1',
  object_name: 'Тестовая квартира',
  address: 'Санкт-Петербург, Невский 24',
  directions_text: 'Войдите через арку',
  parking_text: 'Парковка во дворе',
  trash_bins_location: null,
  waste_disposal_text: null,
  wifi_name: 'ASI Guest',
  wifi_password: 'welcome24',
  baby_crib_available: null,
  baby_crib_note: null,
  check_in_text: 'Заезд с 15:00',
  checkout_time: '12:00',
  house_rules_text: 'Тишина после 22:00. Животные по согласованию.',
  door_code_notes: 'Ключ в сейфе, код 1234',
  communication_autopilot: 'enabled',
};

describe('communication autopilot v1', () => {
  it('enables autopilot only when object flag is enabled', () => {
    expect(isCommunicationAutopilotEnabled(property)).toBe(true);
    expect(isCommunicationAutopilotEnabled({ ...property, communication_autopilot: 'disabled' })).toBe(false);
  });

  it('auto-replies about Wi-Fi from object data', () => {
    const result = runCommunicationAutopilotV1({
      messageText: 'Какой Wi-Fi?',
      property,
      propertyId: property.object_id,
      bookingVerified: true,
    });
    expect(result.action).toBe('auto_reply');
    expect(result.resolved).toBe(true);
    expect(result.needsOperator).toBe(false);
    expect(result.replyText).toMatch(/ASI Guest/);
    expect(result.replyText).toMatch(/welcome24/);
  });

  it('auto-replies about address and check-in time', () => {
    const address = runCommunicationAutopilotV1({
      messageText: 'Какой адрес?',
      property,
      bookingVerified: true,
    });
    expect(address.action).toBe('auto_reply');
    expect(address.replyText).toMatch(/Невский 24/);

    const checkin = runCommunicationAutopilotV1({
      messageText: 'Во сколько заезд?',
      property,
      bookingVerified: true,
    });
    expect(checkin.action).toBe('auto_reply');
    expect(checkin.replyText).toMatch(/15:00/);
  });

  it('auto-replies about checkout, rules and parking', () => {
    const checkout = runCommunicationAutopilotV1({
      messageText: 'До скольки выезд?',
      property,
      bookingVerified: true,
    });
    expect(checkout.action).toBe('auto_reply');
    expect(checkout.replyText).toMatch(/12:00/);

    const rules = runCommunicationAutopilotV1({
      messageText: 'Какие правила проживания?',
      property,
      bookingVerified: true,
    });
    expect(rules.action).toBe('auto_reply');
    expect(rules.replyText).toMatch(/Тишина/);

    const parking = runCommunicationAutopilotV1({
      messageText: 'Где парковка?',
      property,
      bookingVerified: true,
    });
    expect(parking.action).toBe('auto_reply');
    expect(parking.replyText).toMatch(/Парковка/);
  });

  it('closes conversation after a typical answer', () => {
    const result = runCommunicationAutopilotV1({
      messageText: 'Подскажите пароль от вайфая',
      property,
      bookingVerified: true,
    });
    expect(result.resolved).toBe(true);
    expect(result.action).toBe('auto_reply');
  });

  it('does not invent data and asks owner when knowledge is missing', () => {
    const emptyProperty: TelegramPropertyObjectV1 = {
      ...property,
      wifi_name: null,
      wifi_password: null,
      parking_text: null,
    };
    const result = runCommunicationAutopilotV1({
      messageText: 'Какой Wi-Fi?',
      property: emptyProperty,
      bookingVerified: true,
    });
    expect(result.action).toBe('clarification');
    expect(result.replyText).toBe(AUTOPILOT_MISSING_KNOWLEDGE_REPLY_RU);
    expect(result.resolved).toBe(false);
  });

  it('escalates refund and complaint messages to operator', () => {
    const refund = runCommunicationAutopilotV1({
      messageText: 'Хочу вернуть деньги',
      property,
      bookingVerified: true,
    });
    expect(refund.action).toBe('operator_handoff');
    expect(refund.needsOperator).toBe(true);
    expect(refund.escalationReason).toBe('refund_request');

    const complaint = runCommunicationAutopilotV1({
      messageText: 'У вас ужасный сервис',
      property,
      bookingVerified: true,
    });
    expect(complaint.needsOperator).toBe(true);
    expect(complaint.escalationReason).toBe('complaint');
  });

  it('keeps session memory context between turns', () => {
    const first = runCommunicationAutopilotV1({
      messageText: 'Какой Wi-Fi?',
      property,
      bookingVerified: true,
    });
    const session = buildAutopilotSessionPatch({
      result: first,
      messageText: 'Какой Wi-Fi?',
      propertyId: property.object_id,
      propertyName: property.object_name,
    });
    const second = runCommunicationAutopilotV1({
      messageText: 'А парковка есть?',
      property,
      bookingVerified: true,
      session,
    });
    expect(second.action).toBe('auto_reply');
    expect(session.property_id).toBe('prop-1');
    expect(session.last_topic).toBe('wifi');
  });

  it('classifies guest phrasing for check-in, checkout, wifi and rules', () => {
    expect(classifyKnowledgeTopic('во сколько можно заехать?')).toBe('checkin_time');
    expect(classifyKnowledgeTopic('можно ли приехать раньше?')).toBe('checkin_time');
    expect(classifyKnowledgeTopic('можно ли выехать позже?')).toBe('checkout_time');
    expect(classifyKnowledgeTopic('пароль?')).toBe('wifi');
    expect(classifyKnowledgeTopic('можно ли пригласить гостей?')).toBe('house_rules');
    expect(requiresAutopilotOperatorEscalation('очень недоволен сервисом')).toBe('complaint');
  });

  it('answers pets and short password follow-ups from property rules', () => {
    const pets = runCommunicationAutopilotV1({
      messageText: 'Можно ли с животными?',
      property,
      bookingVerified: true,
    });
    expect(pets.action).toBe('auto_reply');
    expect(pets.replyText).toMatch(/животн|правил/i);

    const password = runCommunicationAutopilotV1({
      messageText: 'пароль?',
      property,
      bookingVerified: true,
    });
    expect(password.action).toBe('auto_reply');
    expect(password.replyText).toMatch(/test12345|welcome24/i);
  });

  it('classifies knowledge topics and escalation keywords', () => {
    expect(classifyKnowledgeTopic('какой wi-fi')).toBe('wifi');
    expect(classifyKnowledgeTopic('во сколько заезд')).toBe('checkin_time');
    expect(requiresAutopilotOperatorEscalation('хочу вернуть деньги')).toBe('refund_request');
  });

  it('resolves knowledge from object layers without fabrication', () => {
    const resolved = resolveKnowledgeAnswer({
      topic: 'wifi',
      messageText: 'wi-fi',
      property,
      bookingVerified: true,
    });
    expect(resolved.found).toBe(true);
    expect(resolved.source).toBe('object');

    const missing = resolveKnowledgeAnswer({
      topic: 'parking',
      messageText: 'парковка',
      property: { ...property, parking_text: null },
      bookingVerified: true,
    });
    expect(missing.found).toBe(false);
    expect(missing.missingFields).toContain('object.parkingText');
  });
});
