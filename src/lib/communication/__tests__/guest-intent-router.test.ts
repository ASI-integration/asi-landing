import { describe, expect, it } from 'vitest';
import { classifyGuestCommunicationIntent } from '../guest-intent-router';

describe('guest communication intent router', () => {
  it.each([
    ['вы можете порекомендовать рестораны рядом?', 'guest_local_recommendation'],
    ['где аптека рядом?', 'guest_local_recommendation'],
    ['как заселиться?', 'guest_checkin'],
    ['какой пароль от Wi-Fi?', 'guest_property_question'],
    ['можно курить?', 'guest_rules_question'],
    ['Нужно проверить объект на Авито', 'owner_internal_request'],
    ['Хочу подключить ASI', 'lead_connection'],
  ] as const)('classifies safe routing intent: %s', (messageText, expectedIntent) => {
    const result = classifyGuestCommunicationIntent({ messageText });

    expect(result.detectedIntent).toBe(expectedIntent);
    expect(result.shouldEscalate).toBe(false);
  });

  it.each([
    ['можно скидку?', 'money_sensitive'],
    ['верните деньги', 'money_sensitive'],
    ['сломался замок', 'emergency_or_damage'],
  ] as const)('escalates sensitive intent: %s', (messageText, expectedIntent) => {
    const result = classifyGuestCommunicationIntent({ messageText, currentIdentity: 'guest' });

    expect(result.detectedIntent).toBe(expectedIntent);
    expect(result.shouldEscalate).toBe(true);
    expect(result.suggestedRoute).toBe('operator_review');
  });

  it('asks confirmation when saved owner sends a guest stay question', () => {
    const result = classifyGuestCommunicationIntent({
      messageText: 'вы можете порекомендовать рестораны рядом?',
      currentIdentity: 'owner',
    });

    expect(result.detectedIntent).toBe('guest_local_recommendation');
    expect(result.roleConflict).toBe(true);
    expect(result.shouldAskRoleConfirmation).toBe(true);
    expect(result.suggestedRoute).toBe('identity_confirmation');
  });
});
