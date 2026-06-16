import { describe, expect, it } from 'vitest';
import {
  normalizePilotApplication,
  pilotApplicationMetadata,
  resolvePilotNextAction,
} from '../pilot-intake';

describe('pilot intake CRM mapping', () => {
  it('normalizes a fitting owner application for CRM', () => {
    const application = normalizePilotApplication({
      name: 'Анна',
      telegramContact: '@pilot_owner',
      role: 'owner',
      city: 'Казань',
      propertyCount: 2,
      channelManager: 'bnovo',
      platforms: ['sutochno', 'avito'],
      hasActiveBookings: 'yes',
      testFocus: 'full_cycle',
      feedbackReady: 'yes',
    });

    expect(application.crmRole).toBe('owner');
    expect(application.telegramUsername).toBe('pilot_owner');
    expect(application.suggestedNextAction).toBe('Выбрать в пилот и предложить создать объект');
    expect(application.notes).toContain('Город: Казань');

    const metadata = pilotApplicationMetadata(application);
    expect(metadata).toMatchObject({
      source: 'pilot_form',
      city: 'Казань',
      property_count: 2,
      candidate_fit: true,
      suggested_next_action: 'Выбрать в пилот и предложить создать объект',
    });
  });

  it('prioritizes missing Telegram and missing object next actions', () => {
    expect(resolvePilotNextAction({
      telegramContact: '',
      role: 'owner',
      propertyCount: 1,
      feedbackReady: 'yes',
    })).toBe('Уточнить Telegram для подключения');

    expect(resolvePilotNextAction({
      telegramContact: '@pilot_owner',
      role: 'owner',
      propertyCount: 0,
      feedbackReady: 'yes',
    })).toBe('Уточнить наличие реального объекта');
  });
});
