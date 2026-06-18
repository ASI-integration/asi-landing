import { describe, expect, it } from 'vitest';
import {
  answerGuestTestQuestion,
  ASI_GLOBAL_SMOKING_REPLY,
  classifyGuestTestQuestion,
} from '../guest-test-answers';
import type { TelegramPropertyObjectV1 } from '../telegram-booking-object-memory';

const property: TelegramPropertyObjectV1 = {
  object_id: 'prop-1',
  object_name: 'Тестовая квартира',
  address: 'Санкт-Петербург, Невский проспект, 24',
  directions_text: 'Вход со двора.',
  parking_text: 'Парковка во дворе.',
  trash_bins_location: null,
  waste_disposal_text: null,
  wifi_name: 'ASI-Nevsky24-Guest',
  wifi_password: 'wifi-pass-123',
  baby_crib_available: null,
  baby_crib_note: null,
  check_in_text: 'Заезд с 15:00.',
  checkout_time: '12:00',
  house_rules_text: 'Курение запрещено. Тишина после 22:00.',
  door_code_notes: null,
};

describe('guest test deterministic answers', () => {
  it('answers address from property data', () => {
    expect(classifyGuestTestQuestion('Какой адрес?')).toBe('address');
    const result = answerGuestTestQuestion({
      messageText: 'Какой адрес?',
      property,
      propertyId: 'prop-1',
    });
    expect(result.outcome).toBe('answered_from_property_data');
    expect(result.reply).toContain('Невский проспект, 24');
  });

  it('answers wifi from property data', () => {
    const result = answerGuestTestQuestion({
      messageText: 'Какой Wi-Fi?',
      property,
      propertyId: 'prop-1',
    });
    expect(result.outcome).toBe('answered_from_property_data');
    expect(result.reply).toContain('ASI-Nevsky24-Guest');
    expect(result.reply).toContain('wifi-pass-123');
  });

  it('answers smoking question with global ASI policy', () => {
    const result = answerGuestTestQuestion({
      messageText: 'Можно курить?',
      property,
      propertyId: 'prop-1',
    });
    expect(result.outcome).toBe('answered_from_property_data');
    expect(result.reply).toBe(ASI_GLOBAL_SMOKING_REPLY);
    expect(result.missingFields).toEqual([]);
  });

  it('classifies balcony smoking questions as smoking', () => {
    expect(classifyGuestTestQuestion('Можно курить на балконе?')).toBe('smoking');
  });

  it('treats test placeholder wifi values as present in guest test mode', () => {
    const result = answerGuestTestQuestion({
      messageText: 'Какой Wi-Fi?',
      property: { ...property, wifi_name: 'тест', wifi_password: 'test' },
      propertyId: 'prop-1',
    });
    expect(result.outcome).toBe('answered_from_property_data');
    expect(result.reply).toContain('тест');
    expect(result.reply).toContain('test');
  });

  it('answers address with test placeholder values', () => {
    const result = answerGuestTestQuestion({
      messageText: 'Какой адрес?',
      property: { ...property, address: 'тест' },
      propertyId: 'prop-1',
    });
    expect(result.outcome).toBe('answered_from_property_data');
    expect(result.reply).toContain('тест');
  });

  it('creates missing_data outcome when property field is absent', () => {
    const result = answerGuestTestQuestion({
      messageText: 'Какой Wi-Fi?',
      property: { ...property, wifi_name: null, wifi_password: null },
      propertyId: 'prop-1',
    });
    expect(result.outcome).toBe('missing_data');
    expect(result.missingFields.length).toBeGreaterThan(0);
  });

  it('smoking question does not create missing_data when house rules are empty', () => {
    const result = answerGuestTestQuestion({
      messageText: 'Можно курить?',
      property: { ...property, house_rules_text: null },
      propertyId: 'prop-1',
    });
    expect(result.outcome).toBe('answered_from_property_data');
    expect(result.missingFields).toEqual([]);
  });

  it('creates operator_followup_required for operator-level questions', () => {
    const result = answerGuestTestQuestion({
      messageText: 'Хочу вернуть деньги за бронь',
      property,
      propertyId: 'prop-1',
    });
    expect(result.outcome).toBe('operator_followup_required');
    expect(result.needsOperator).toBe(true);
  });
});
