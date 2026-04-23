import { describe, it, expect } from 'vitest';
import { classify, deterministicReply, extractSlots } from '../classifier';
import { MessageCategory } from '../types';

// ─── extractSlots ──────────────────────────────────────────────────────────────

describe('extractSlots', () => {
  it('detects urgency keywords (EN)', () => {
    expect(extractSlots('urgent problem')).toMatchObject({ isUrgent: true });
    expect(extractSlots('asap please')).toMatchObject({ isUrgent: true });
  });

  it('detects urgency keywords (RU)', () => {
    expect(extractSlots('срочно')).toMatchObject({ isUrgent: true });
    expect(extractSlots('немедленно')).toMatchObject({ isUrgent: true });
  });

  it('detects access-related keywords (EN)', () => {
    expect(extractSlots('lock broken')).toMatchObject({ isAccessRelated: true });
    expect(extractSlots('how to get inside')).toMatchObject({ isAccessRelated: true });
  });

  it('detects access-related keywords (RU)', () => {
    expect(extractSlots('замок не работает')).toMatchObject({ isAccessRelated: true });
    expect(extractSlots('как попасть внутрь')).toMatchObject({ isAccessRelated: true });
    expect(extractSlots('войти в квартиру')).toMatchObject({ isAccessRelated: true });
  });

  it('detects parking as object signal', () => {
    expect(extractSlots('где парковка')).toMatchObject({ mentionsObject: true });
    expect(extractSlots('where is the parking')).toMatchObject({ mentionsObject: true });
  });

  it('detects time signals (RU)', () => {
    expect(extractSlots('сегодня вечером')).toMatchObject({ mentionsTime: true });
    expect(extractSlots('после 23:00 часов')).toMatchObject({ mentionsTime: true });
    expect(extractSlots('завтра утром')).toMatchObject({ mentionsTime: true });
  });

  it('detects guest mentions (RU plural/genitive)', () => {
    expect(extractSlots('2 гостя')).toMatchObject({ mentionsGuest: true });
    expect(extractSlots('для гостей')).toMatchObject({ mentionsGuest: true });
  });

  it('returns false signals for generic text', () => {
    const slots = extractSlots('hello world');
    expect(slots.isUrgent).toBe(false);
    expect(slots.isAccessRelated).toBe(false);
  });
});

// ─── classify — basic cases ────────────────────────────────────────────────────

describe('classify — basic', () => {
  it('classifies /start command', () => {
    expect(classify('/start').category).toBe(MessageCategory.Start);
  });

  it('classifies /start as RU when language_code is ru', () => {
    expect(classify('/start', 'ru').lang).toBe('ru');
  });

  it('classifies short English greetings', () => {
    for (const g of ['hi', 'hello', 'hey', 'test', 'ping']) {
      expect(classify(g).category).toBe(MessageCategory.Greeting);
    }
  });

  it('classifies short Russian greetings (exact)', () => {
    expect(classify('привет').category).toBe(MessageCategory.Greeting);
    expect(classify('здравствуйте').category).toBe(MessageCategory.Greeting);
  });

  it('classifies greeting with trailing punctuation as Greeting when short', () => {
    expect(classify('hello!').category).toBe(MessageCategory.Greeting);
    expect(classify('привет,').category).toBe(MessageCategory.Greeting);
  });

  it('classifies guest-forwarded messages', () => {
    expect(classify('guest says the wifi is down').category).toBe(MessageCategory.GuestMessage);
    expect(classify('гость пишет что нет воды').category).toBe(MessageCategory.GuestMessage);
  });

  it('classifies operational issues', () => {
    expect(classify('problem with the heating').category).toBe(MessageCategory.Issue);
    expect(classify('не работает свет').category).toBe(MessageCategory.Issue);
  });

  it('classifies booking/access messages', () => {
    expect(classify('check-in time is 3pm').category).toBe(MessageCategory.Booking);
    expect(classify('заезд завтра утром').category).toBe(MessageCategory.Booking);
  });

  it('falls back for truly unrecognised messages', () => {
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

// ─── classify — multi-intent realistic guest messages ─────────────────────────

describe('classify — multi-intent guest messages (RU)', () => {
  it('classifies parking + late-access inquiry (the reported failing case)', () => {
    const msg =
      'Здравствуйте. Мы заселяемся сегодня в апартаменты X, 2 гостя. ' +
      'Подскажите, где парковка и как попасть внутрь после 23:00?';
    const result = classify(msg);
    expect(result.category).toBe(MessageCategory.Booking);
    expect(result.lang).toBe('ru');
  });

  it('classifies check-in + door code request', () => {
    const msg = 'Добрый день! Мы заедем в 21:00. Пришлите код от двери, пожалуйста.';
    expect(classify(msg).category).toBe(MessageCategory.Booking);
  });

  it('classifies late-arrival + access question', () => {
    const msg = 'Прилетаем поздно ночью, примерно в 02:00. Как войти в квартиру?';
    expect(classify(msg).category).toBe(MessageCategory.Booking);
  });

  it('classifies guest count + booking context', () => {
    const msg = 'Нас будет 3 гостя. Заселяемся завтра. Есть ли детская кроватка?';
    expect(classify(msg).category).toBe(MessageCategory.Booking);
  });

  it('classifies parking-only question with object context', () => {
    const msg = 'Где парковка у апартаментов?';
    expect(classify(msg).category).toBe(MessageCategory.Booking);
  });

  it('does NOT classify long greeting-prefixed message as Greeting', () => {
    const msg =
      'Здравствуйте. Мы заселяемся сегодня в апартаменты X, 2 гостя. ' +
      'Подскажите, где парковка и как попасть внутрь после 23:00?';
    expect(classify(msg).category).not.toBe(MessageCategory.Greeting);
  });

  it('classifies urgent lock failure as Issue', () => {
    const msg = 'Срочно! Замок не открывается, гость стоит у двери.';
    expect(classify(msg).category).toBe(MessageCategory.Issue);
  });
});

describe('classify — multi-intent guest messages (EN)', () => {
  it('classifies parking + late entry inquiry', () => {
    const msg =
      'Hi, we are checking in today, 2 guests. ' +
      'Can you tell us where the parking is and how to get inside after 11pm?';
    expect(classify(msg).category).toBe(MessageCategory.Booking);
  });

  it('classifies late arrival + door code request', () => {
    const msg = 'We will arrive around 1am. Could you send the door code please?';
    expect(classify(msg).category).toBe(MessageCategory.Booking);
  });

  it('classifies booking + check-in time question', () => {
    const msg = 'Hello, we have a reservation for tomorrow. What time is check-in?';
    expect(classify(msg).category).toBe(MessageCategory.Booking);
  });

  it('classifies access + parking multi-intent', () => {
    const msg = 'Good evening! Where do I park and how do I access the building?';
    expect(classify(msg).category).toBe(MessageCategory.Booking);
  });

  it('keeps manual review for truly ambiguous messages', () => {
    expect(classify('qwerty foobar').category).toBe(MessageCategory.Fallback);
    expect(classify('???').category).toBe(MessageCategory.Fallback);
  });
});

// ─── deterministicReply ───────────────────────────────────────────────────────

describe('deterministicReply', () => {
  it('returns EN start reply', () => {
    expect(deterministicReply(classify('/start'))).toContain('ASI online');
  });

  it('returns RU start reply', () => {
    const reply = deterministicReply(classify('/start', 'ru'));
    expect(reply).toContain('ASI online');
    expect(reply).toContain('Отправьте');
  });

  it('returns RU booking reply for multi-intent parking+access message', () => {
    const msg =
      'Здравствуйте. Мы заселяемся сегодня в апартаменты X, 2 гостя. ' +
      'Подскажите, где парковка и как попасть внутрь после 23:00?';
    const reply = deterministicReply(classify(msg));
    // Must NOT be the manual-review fallback
    expect(reply).not.toContain('ручную проверку');
    // Must be the booking reply
    expect(reply).toContain('guest operations');
  });

  it('returns escalated EN reply for urgent+access issue', () => {
    const r = classify('urgent lock failed');
    expect(r.category).toBe(MessageCategory.Issue);
    expect(deterministicReply(r)).toContain('urgent access issue');
  });

  // ── Tone tests ─────────────────────────────────────────────────────────────

  it('RU Greeting reply opens with Здравствуйте!', () => {
    const reply = deterministicReply(classify('привет'));
    expect(reply).toMatch(/^Здравствуйте!/);
  });

  it('RU LanguageCheck reply is short and direct', () => {
    const reply = deterministicReply(classify('ты понимаешь русский?'));
    expect(reply).toMatch(/^Да, понимаю/);
  });

  it('RU GuestMessage reply opens with Здравствуйте!', () => {
    const reply = deterministicReply(classify('гость пишет что нет воды'));
    expect(reply).toMatch(/^Здравствуйте!/);
  });

  it('RU Booking reply opens with Здравствуйте! and mentions guest operations', () => {
    const reply = deterministicReply(classify('заезд завтра утром'));
    expect(reply).toMatch(/^Здравствуйте!/);
    expect(reply).toContain('guest operations');
  });

  it('RU Issue (non-urgent) reply opens with Здравствуйте!', () => {
    const reply = deterministicReply(classify('не работает свет'));
    expect(reply).toMatch(/^Здравствуйте!/);
  });

  it('RU Fallback reply does NOT start with Здравствуйте (stays neutral)', () => {
    // Must use Cyrillic input so the RU branch is taken
    const reply = deterministicReply(classify('непонятный запрос абырвалг'));
    expect(reply).not.toMatch(/^Здравствуйте/);
    expect(reply).toContain('ручную проверку');
  });

  it('EN Greeting reply is friendly and asks how to help', () => {
    const reply = deterministicReply(classify('hello'));
    expect(reply).toContain('Hi!');
    expect(reply).toContain('can I help');
  });

  it('EN LanguageCheck reply confirms understanding and asks for text', () => {
    const reply = deterministicReply(classify('can you understand me?'));
    expect(reply.toLowerCase()).toContain('please send');
    expect(reply.toLowerCase()).toContain('text');
  });

  it('returns escalated RU reply for urgent+access issue', () => {
    const r = classify('срочно замок не открывается');
    expect(deterministicReply(r)).toContain('доступ');
  });
});
