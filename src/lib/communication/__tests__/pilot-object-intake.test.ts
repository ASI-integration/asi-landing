import { describe, expect, it } from 'vitest';
import {
  buildPilotObjectKnowledgeRows,
  normalizePilotObjectInput,
  summarizePilotObjectFromRows,
} from '../pilot-object-intake';

describe('pilot object intake', () => {
  it('maps Russian object form fields into bot-ready object knowledge rows', () => {
    const input = normalizePilotObjectInput({
      objectId: 'pilot_test_object',
      city: 'Псков',
      objectName: 'Студия у вокзала',
      addressOrArea: 'Рядом с вокзалом',
      wifiName: 'ASI-Guest',
      wifiPassword: 'secret-pass',
      accessInstructions: 'Ключ в мини-сейфе у двери.',
      trashBinsLocation: 'Контейнеры во дворе слева.',
      parkingText: 'Парковка во дворе, бесплатно.',
      checkoutTime: 'до 12:00',
      houseRules: 'Не курить. Тишина после 22:00.',
      additionalFeatures: 'Есть бойлер.',
      ownerContact: '+79990000000',
    });

    const rows = buildPilotObjectKnowledgeRows(input, new Date('2026-06-03T12:00:00.000Z'));
    const byKey = new Map(rows.map((row) => [row.key, row]));

    expect(byKey.get('wifi_password')).toMatchObject({
      category: 'wifi',
      visibility: 'guest_after_booking_verified',
      sensitivity: 'password',
      value_text: 'secret-pass',
    });
    expect(byKey.get('trash_bins_location')?.value_text).toBe('Контейнеры во дворе слева.');
    expect(byKey.get('parking_text')?.value_text).toBe('Парковка во дворе, бесплатно.');
    expect(byKey.get('checkout_time')?.value_text).toBe('до 12:00');
    expect(byKey.get('owner_contact')).toMatchObject({
      visibility: 'operator_only',
      sensitivity: 'personal_data',
    });
  });

  it('restores a saved object summary from object knowledge rows', () => {
    const summary = summarizePilotObjectFromRows('pilot_test_object', [
      { key: 'city', value_text: 'Псков' },
      { key: 'object_name', value_text: 'Студия у вокзала' },
      { key: 'address', value_text: 'Рядом с вокзалом' },
      { key: 'wifi_name', value_text: 'ASI-Guest' },
      { key: 'check_in_text', value_text: 'Ключ в мини-сейфе.' },
      { key: 'trash_bins_location', value_text: 'Контейнеры во дворе.' },
    ]);

    expect(summary).toMatchObject({
      objectId: 'pilot_test_object',
      city: 'Псков',
      objectName: 'Студия у вокзала',
      addressOrArea: 'Рядом с вокзалом',
      wifiName: 'ASI-Guest',
      accessInstructions: 'Ключ в мини-сейфе.',
      trashBinsLocation: 'Контейнеры во дворе.',
    });
  });
});
