import { describe, expect, it } from 'vitest';
import {
  computeObjectReadiness,
  READINESS_STATUS_LABELS_RU,
  REQUIRED_FIELD_LABELS_RU,
} from '../engine';

describe('object readiness engine', () => {
  it('empty object → 0–10%, «Не начат»', () => {
    const result = computeObjectReadiness({ onboardingStatus: 'onboarding_started' });
    expect(result.readiness_percent).toBeGreaterThanOrEqual(0);
    expect(result.readiness_percent).toBeLessThanOrEqual(10);
    expect(result.readiness_status).toBe('not_started');
    expect(result.readiness_status_label_ru).toBe(READINESS_STATUS_LABELS_RU.not_started);
    expect(result.required_done_count).toBe(0);
  });

  it('only address → «Не хватает данных»', () => {
    const result = computeObjectReadiness({
      address: 'Санкт-Петербург, Невский 24',
      onboardingStatus: 'missing_required_data',
    });
    expect(result.readiness_status).toBe('missing_data');
    expect(result.missing_required_fields).not.toContain('address');
    expect(result.missing_required_fields.length).toBeGreaterThan(0);
  });

  it('address + Wi-Fi + check-in/out → partial readiness', () => {
    const result = computeObjectReadiness({
      address: 'Москва, Тверская 1',
      wifi: 'GuestNet / pass123',
      checkin_checkout: 'заезд с 15:00, выезд до 11:00',
      onboardingStatus: 'missing_required_data',
    });
    expect(result.required_done_count).toBe(3);
    expect(result.readiness_percent).toBeGreaterThan(30);
    expect(result.readiness_percent).toBeLessThan(100);
    expect(result.missing_required_fields).toEqual(
      expect.arrayContaining(['property_name', 'house_rules', 'photos', 'channels']),
    );
  });

  it('all required fields → ready_for_channel_manager', () => {
    const result = computeObjectReadiness({
      address: 'Казань, Баумана 5',
      property_name: 'апартаменты',
      house_rules: 'без курения',
      wifi: 'WiFi / 1234',
      checkin_checkout: '15:00 / 11:00',
      photos: 'photo-1',
      channels: 'Авито, Суточно',
      onboardingStatus: 'ready_for_channel_manager',
    });
    expect(result.readiness_percent).toBe(100);
    expect(result.missing_required_fields).toEqual([]);
    expect(result.readiness_status).toBe('ready_for_channel_manager');
  });

  it('photos_intent=later counts as acceptable photos state', () => {
    const result = computeObjectReadiness({
      address: 'Сочи, морская 1',
      property_name: 'дом',
      house_rules: 'тишина',
      wifi: 'net / pass',
      checkin_checkout: '14:00 / 12:00',
      photos_intent: 'later',
      channels: 'Avito',
      onboardingStatus: 'ready_for_channel_manager',
    });
    expect(result.missing_required_fields).not.toContain('photos');
    expect(result.readiness_percent).toBe(100);
  });

  it('missing fields are displayed in Russian', () => {
    const result = computeObjectReadiness({
      address: 'Екатеринбург, Ленина 1',
      onboardingStatus: 'missing_required_data',
    });
    expect(result.missing_required_labels_ru).toContain(REQUIRED_FIELD_LABELS_RU.wifi);
    expect(result.missing_required_labels_ru).toContain(REQUIRED_FIELD_LABELS_RU.photos);
    expect(result.missing_required_labels_ru.every((label) => !label.includes('_'))).toBe(true);
  });

  it('suggests next step for the most important missing field', () => {
    const result = computeObjectReadiness({
      address: 'Казань',
      property_name: 'квартира',
      house_rules: 'без курения',
      wifi: 'WiFi',
      checkin_checkout: '15-11',
      onboardingStatus: 'missing_required_data',
    });
    expect(result.next_best_step_ru).toMatch(/фото/i);
  });

  it('needs_operator maps to needs_attention status', () => {
    const result = computeObjectReadiness({
      address: 'Москва',
      onboardingStatus: 'needs_operator',
    });
    expect(result.readiness_status).toBe('needs_attention');
    expect(result.readiness_status_label_ru).toBe('Требует внимания');
  });

  it('channel_manager_started maps to completed', () => {
    const result = computeObjectReadiness({
      address: 'Москва',
      property_name: 'квартира',
      house_rules: 'тишина',
      wifi: 'WiFi',
      checkin_checkout: '15-11',
      photos: 'ok',
      channels: 'Avito',
      onboardingStatus: 'channel_manager_started',
    });
    expect(result.readiness_status).toBe('completed');
  });
});
