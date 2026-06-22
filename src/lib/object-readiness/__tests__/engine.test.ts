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
    expect(result.required_total_count).toBe(8);
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
      checkin_time: '15:00',
      checkout_time: '11:00',
      onboardingStatus: 'missing_required_data',
    });
    expect(result.required_done_count).toBe(4);
    expect(result.readiness_percent).toBe(50);
    expect(result.missing_required_fields).toEqual(
      expect.arrayContaining(['object_type', 'rules', 'photos', 'channels']),
    );
  });

  it('all required fields → ready_for_channel_manager', () => {
    const result = computeObjectReadiness({
      address: 'Казань, Баумана 5',
      object_type: 'апартаменты',
      checkin_time: '15:00',
      checkout_time: '11:00',
      rules: ['Не курить'],
      wifi_name: 'WiFi',
      wifi_password: '1234',
      photos: 'photo-1',
      channels: ['Авито', 'Суточно'],
      onboardingStatus: 'ready_for_channel_manager',
    });
    expect(result.readiness_percent).toBe(100);
    expect(result.missing_required_fields).toEqual([]);
    expect(result.readiness_status).toBe('ready_for_channel_manager');
  });

  it('legacy combined fields still count toward readiness', () => {
    const result = computeObjectReadiness({
      address: 'Казань, Баумана 5',
      property_name: 'апартаменты',
      house_rules: 'без курения',
      wifi: 'WiFi / 1234',
      checkin_checkout: 'заезд с 15:00, выезд до 11:00',
      photos: 'photo-1',
      channels: 'Авито, Суточно',
      onboardingStatus: 'ready_for_channel_manager',
    });
    expect(result.readiness_percent).toBe(100);
    expect(result.missing_required_fields).toEqual([]);
  });

  it('photos_intent=later counts as acceptable photos state', () => {
    const result = computeObjectReadiness({
      address: 'Сочи, морская 1',
      object_type: 'дом',
      rules: ['тишина'],
      wifi_skipped: true,
      checkin_time: '14:00',
      checkout_time: '12:00',
      photos_intent: 'later',
      channels: ['Avito'],
      onboardingStatus: 'ready_for_channel_manager',
    });
    expect(result.missing_required_fields).not.toContain('photos');
    expect(result.readiness_percent).toBe(100);
  });

  it('custom booking channels count toward readiness', () => {
    const result = computeObjectReadiness({
      address: 'Москва, Тверская 1',
      object_type: 'квартира',
      rules: ['без курения'],
      wifi_name: 'Guest',
      checkin_time: '15:00',
      checkout_time: '11:00',
      photos_intent: 'later',
      channels: ['TravelLine', 'МирКвартир'],
      onboardingStatus: 'ready_for_channel_manager',
    });
    expect(result.missing_required_fields).not.toContain('channels');
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
      object_type: 'квартира',
      rules: ['без курения'],
      wifi_name: 'WiFi',
      checkin_time: '15:00',
      checkout_time: '11:00',
      channels: ['Avito'],
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
      object_type: 'квартира',
      rules: ['тишина'],
      wifi: 'WiFi',
      checkin_time: '15:00',
      checkout_time: '11:00',
      photos: 'ok',
      channels: ['Avito'],
      onboardingStatus: 'channel_manager_started',
    });
    expect(result.readiness_status).toBe('completed');
  });
});
