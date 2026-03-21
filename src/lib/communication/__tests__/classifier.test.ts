import { describe, it, expect } from 'vitest';
import { classify, deterministicReply, extractSlots } from '../classifier';
import { MessageCategory } from '../types';

describe('extractSlots', () => {
  it('detects urgency keywords', () => {
    expect(extractSlots('urgent problem')).toMatchObject({ isUrgent: true });
    expect(extractSlots('срочно')).toMatchObject({ isUrgent: true });
  });

  it('detects access-related keywords', () => {
    expect(extractSlots('lock broken')).toMatchObject({ isAccessRelated: true });
    expect(extractSlots('замок не работает')).toMatchObject({ isAccessRelated: true });
  });

  it('returns false signals for generic text', () => {
    const slots = extractSlots('hello world');
    expect(slots.isUrgent).toBe(false);
    expect(slots.isAccessRelated).toBe(false);
  });
});

describe('classify', () => {
  it('classifies /start command', () => {
    const r = classify('/start');
    expect(r.category).toBe(MessageCategory.Start);
  });

  it('classifies /start as RU when language_code is ru', () => {
    const r = classify('/start', 'ru');
    expect(r.lang).toBe('ru');
  });

  it('classifies English greetings', () => {
    for (const g of ['hi', 'hello', 'hey', 'test', 'ping']) {
      expect(classify(g).category).toBe(MessageCategory.Greeting);
    }
  });

  it('classifies Russian greetings', () => {
    expect(classify('привет').category).toBe(MessageCategory.Greeting);
    expect(classify('здравствуйте').category).toBe(MessageCategory.Greeting);
  });

  it('classifies guest messages', () => {
    expect(classify('guest says the wifi is down').category).toBe(MessageCategory.GuestMessage);
    expect(classify('гость пишет что нет воды').category).toBe(MessageCategory.GuestMessage);
  });

  it('classifies issues', () => {
    expect(classify('problem with the heating').category).toBe(MessageCategory.Issue);
    expect(classify('не работает свет').category).toBe(MessageCategory.Issue);
  });

  it('classifies booking/access messages', () => {
    expect(classify('check-in time is 3pm').category).toBe(MessageCategory.Booking);
    expect(classify('заезд завтра утром').category).toBe(MessageCategory.Booking);
  });

  it('falls back for unrecognised messages', () => {
    expect(classify('qwerty foobar').category).toBe(MessageCategory.Fallback);
  });

  it('detects Russian language from Cyrillic text', () => {
    expect(classify('не работает').lang).toBe('ru');
  });

  it('defaults to English for latin text', () => {
    expect(classify('hello').lang).toBe('en');
  });

  it('returns fallback for empty text', () => {
    expect(classify('').category).toBe(MessageCategory.Fallback);
  });
});

describe('deterministicReply', () => {
  it('returns EN start reply', () => {
    const r = classify('/start');
    expect(deterministicReply(r)).toContain('ASI online');
  });

  it('returns RU start reply', () => {
    const r = classify('/start', 'ru');
    const reply = deterministicReply(r);
    expect(reply).toContain('ASI online');
    expect(reply).toContain('Отправьте');
  });

  it('returns escalated EN reply for urgent+access issue', () => {
    const r = classify('urgent lock failed');
    expect(r.category).toBe(MessageCategory.Issue);
    const reply = deterministicReply(r);
    expect(reply).toContain('urgent access issue');
  });

  it('returns escalated RU reply for urgent+access issue', () => {
    const r = classify('срочно замок не открывается');
    const reply = deterministicReply(r);
    expect(reply).toContain('доступ');
  });
});
