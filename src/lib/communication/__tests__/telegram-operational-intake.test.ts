import { describe, it, expect } from 'vitest';
import { tryTelegramOperationalIntake } from '../telegram-operational-intake';

const base = { update_id: 1, chat_id: 42 };

describe('tryTelegramOperationalIntake', () => {
  it('matches EN access relay with full facts → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Hi, guest John Smith is checking in today at 18:00 at Nevsky 24. He says the door code does not work. Can you help?',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('access_issue');
    expect(hit?.finalAction).toBe('reply');
    expect(hit?.missingFacts).toEqual([]);
    expect(hit?.reply).toMatch(/access issue logged|Understood/i);
  });

  it('matches RU access relay with full facts → reply', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Здравствуйте. Гость John Smith заселяется сегодня в 18:00 по адресу Невский 24. Он пишет, что код от двери не работает. Помогите, пожалуйста.',
      surfaceLang: 'ru',
      ...base,
    });
    expect(hit?.category).toBe('access_issue');
    expect(hit?.finalAction).toBe('reply');
    expect(hit?.reply).toMatch(/Понял/i);
  });

  it('matches late checkout without property → clarify', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Hello. Guest Anna Petrova asks for late checkout tomorrow until 13:00. Is it possible?',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('late_checkout');
    expect(hit?.finalAction).toBe('clarify');
    expect(hit?.missingFacts).toContain('property');
    expect(hit?.reply).toMatch(/late checkout availability|What property/i);
  });

  it('matches urgent no heating → escalate', () => {
    const hit = tryTelegramOperationalIntake({
      text: 'Hello. Guest says there is no heating in the apartment and it is very cold. Please help urgently.',
      surfaceLang: 'en',
      ...base,
    });
    expect(hit?.category).toBe('urgent_maintenance');
    expect(hit?.finalAction).toBe('escalate');
    expect(hit?.reply).toMatch(/urgent|escalat/i);
  });
});
