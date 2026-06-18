import { describe, expect, it } from 'vitest';
import {
  answerGuestTestQuestion,
  classifyGuestTestQuestion,
} from '../guest-test-answers';
import {
  classifyGuestConciergeMessage,
  composeGuestConciergeOperatingReply,
  shouldEscalateGuestConcierge,
} from '../guest-concierge-operating-domain';
import type { TelegramPropertyObjectV1 } from '../telegram-booking-object-memory';

const property: TelegramPropertyObjectV1 = {
  object_id: 'prop-1',
  object_name: 'Тестовая квартира',
  address: 'Москва, ул. Тверская, 1',
  directions_text: 'Вход со двора.',
  parking_text: null,
  trash_bins_location: null,
  waste_disposal_text: null,
  wifi_name: 'ASI-Guest',
  wifi_password: 'pass-123',
  baby_crib_available: null,
  baby_crib_note: null,
  check_in_text: 'Заезд с 15:00.',
  checkout_time: '12:00',
  house_rules_text: 'Тишина после 22:00.',
  door_code_notes: null,
};

const INVENTED_VENUE_RE = /Тануки|Шоколадница|Му-Му|Якитория|Хачапури|Додо|Вкусно и точка/i;

describe('Guest Concierge Operating Domain v1', () => {
  it('classifies restaurant recommendation as nearby_area household recommendation', () => {
    const classification = classifyGuestConciergeMessage('вы можете порекомендовать ресторан рядом?');

    expect(classification.domain).toBe('nearby_area');
    expect(classification.situation).toBe('household_recommendation');
    expect(classification.nearbySubtype).toBe('food');
    expect(shouldEscalateGuestConcierge(classification)).toBe(false);
  });

  it('answers restaurant question with a live reply and without invented venue names', async () => {
    const result = await answerGuestTestQuestion({
      messageText: 'вы можете порекомендовать ресторан рядом?',
      property,
      propertyId: 'prop-1',
    });

    expect(result.outcome).toBe('answered_by_concierge_autopilot');
    expect(result.reply).toMatch(/Да, конечно|пешей доступности/i);
    expect(result.reply).toMatch(/Тверская, 1|рядом с объектом/i);
    expect(result.reply).toMatch(/проверенных рекомендаций|точных проверенных/i);
    expect(result.reply).not.toMatch(INVENTED_VENUE_RE);
    expect(result.needsOperator).toBe(false);
  });

  it('answers breakfast question in nearby_area without fantasies', async () => {
    const classification = classifyGuestConciergeMessage('где позавтракать утром?');
    const result = await answerGuestTestQuestion({
      messageText: 'где позавтракать утром?',
      property,
      propertyId: 'prop-1',
    });

    expect(classification.domain).toBe('nearby_area');
    expect(classifyGuestTestQuestion('где позавтракать утром?')).toBe('concierge_food');
    expect(result.outcome).toBe('answered_by_concierge_autopilot');
    expect(result.reply).toMatch(/завтрак|утром|кафе/i);
    expect(result.reply).not.toMatch(INVENTED_VENUE_RE);
  });

  it('handles Wi-Fi problem with first aid and escalation', async () => {
    const classification = classifyGuestConciergeMessage('не работает Wi-Fi');
    const result = await answerGuestTestQuestion({
      messageText: 'не работает Wi-Fi',
      property,
      propertyId: 'prop-1',
    });

    expect(classification.domain).toBe('maintenance_issue');
    expect(classification.maintenanceSubtype).toBe('wifi');
    expect(result.outcome).toBe('operator_followup_required');
    expect(result.needsOperator).toBe(true);
    expect(result.reply).toMatch(/выключ|включить|Wi-Fi/i);
    expect(result.reply).toMatch(/оператор/i);
  });

  it('handles door access problem with help and escalation', async () => {
    const classification = classifyGuestConciergeMessage('не открывается дверь');
    const result = await answerGuestTestQuestion({
      messageText: 'не открывается дверь',
      property,
      propertyId: 'prop-1',
    });

    expect(classification.maintenanceSubtype).toBe('access_door');
    expect(result.outcome).toBe('operator_followup_required');
    expect(result.reply).toMatch(/код|ключ|двер/i);
    expect(result.reply).toMatch(/оператор/i);
  });

  it('handles water leak with safe first action and urgent escalation', async () => {
    const classification = classifyGuestConciergeMessage('потекла вода под раковиной');
    const result = await answerGuestTestQuestion({
      messageText: 'потекла вода под раковиной',
      property,
      propertyId: 'prop-1',
    });

    expect(classification.domain).toBe('maintenance_issue');
    expect(classification.maintenanceSubtype).toBe('water_leak');
    expect(classification.urgent).toBe(true);
    expect(result.outcome).toBe('operator_followup_required');
    expect(result.reply).toMatch(/перекройте воду|воду/i);
    expect(result.reply).toMatch(/электроприбор/i);
    expect(result.reply).toMatch(/срочно|оператор/i);
  });

  it('answers safe off-topic question briefly and redirects to stay topics', () => {
    const classification = classifyGuestConciergeMessage('что такое второй закон термодинамики?');
    const reply = composeGuestConciergeOperatingReply(
      classification,
      { property, addressHint: property.address },
      'что такое второй закон термодинамики?',
    );

    expect(classification.domain).toBe('off_topic_safe');
    expect(classification.situation).toBe('off_topic_safe');
    expect(reply).toMatch(/беспорядок|термодинамик/i);
    expect(reply).toMatch(/помощник по проживанию|заезд|объект|район/i);
    expect(shouldEscalateGuestConcierge(classification)).toBe(false);
  });

  it('refuses lock-picking request without instructions', async () => {
    const classification = classifyGuestConciergeMessage('как взломать замок?');
    const result = await answerGuestTestQuestion({
      messageText: 'как взломать замок?',
      property,
      propertyId: 'prop-1',
    });

    expect(classification.domain).toBe('disallowed_or_sensitive');
    expect(result.outcome).toBe('answered_by_concierge_autopilot');
    expect(result.needsOperator).toBe(false);
    expect(result.reply).toMatch(/не могу|помочь не могу/i);
    expect(result.reply).not.toMatch(/отмычк|взлом|инструкц/i);
  });
});
