import { describe, it, expect, afterEach } from 'vitest';
import { inferMetaSurfaceLang, resolveTelegramTextMeta } from '../telegram-text-meta-handler';

describe('inferMetaSurfaceLang', () => {
  afterEach(() => {
    delete process.env.RU_TELEGRAM_FORCE_RU;
  });

  it('prefers English text over Russian Telegram UI locale', () => {
    expect(inferMetaSurfaceLang('hello', 'ru')).toBe('en');
    expect(inferMetaSurfaceLang('can u understand me?', 'ru')).toBe('en');
  });

  it('detects Russian from Cyrillic script', () => {
    expect(inferMetaSurfaceLang('ты понимаешь русский?', 'en')).toBe('ru');
  });

  it('detects Spanish meta phrasing', () => {
    expect(inferMetaSurfaceLang('te habla espanol?', 'en')).toBe('es');
  });
});

describe('resolveTelegramTextMeta', () => {
  afterEach(() => {
    delete process.env.RU_TELEGRAM_FORCE_RU;
  });

  it('returns Russian product copy for Telegram meta smoke lines', () => {
    const enHello = resolveTelegramTextMeta({ baseText: 'hello', telegramLangCode: 'ru' });
    expect(enHello?.reply).toBe('Здравствуйте! Пришлите запрос гостя, проблему или детали заезда.');

    const enCap = resolveTelegramTextMeta({ baseText: 'can u understand me?', telegramLangCode: 'ru' });
    expect(enCap?.reply).toBe(
      'Да, понимаю русский и английский. Пришлите, пожалуйста, запрос текстом.',
    );

    const ruCap = resolveTelegramTextMeta({ baseText: 'ты понимаешь русский?', telegramLangCode: 'en' });
    expect(ruCap?.reply).toBe('Да, понимаю русский и английский. Пришлите, пожалуйста, запрос текстом.');

    const esCap = resolveTelegramTextMeta({ baseText: 'te habla espanol?', telegramLangCode: 'en' });
    expect(esCap?.reply).toBe(
      'Да, понимаю русский и английский. Пришлите, пожалуйста, запрос текстом.',
    );
  });

  it('routes neutral bot/meta smalltalk without operational context', () => {
    const smartBot = resolveTelegramTextMeta({ baseText: 'А ты умный бот?', telegramLangCode: 'ru' });
    expect(smartBot?.kind).toBe('identity');
    expect(smartBot?.reply).toMatch(/официальный ассистент ASI/i);

    const bot = resolveTelegramTextMeta({ baseText: 'ты бот?', telegramLangCode: 'ru' });
    expect(bot?.kind).toBe('identity');

    const thanks = resolveTelegramTextMeta({ baseText: 'спасибо', telegramLangCode: 'ru' });
    expect(thanks?.kind).toBe('smalltalk');
    expect(thanks?.reply).toMatch(/Пожалуйста/i);
  });

  it('routes Telegram ping/test probes to a short bot-online reply', () => {
    for (const text of ['тест', 'проверка', 'ping', 'test', 'тест один ответ 1629']) {
      const meta = resolveTelegramTextMeta({ baseText: text, telegramLangCode: 'ru' });

      expect(meta?.kind).toBe('test_ping');
      expect(meta?.reply).toMatch(/бот на связи/i);
      expect(meta?.category).toBe('language-check');
    }
  });

  it('does not steal real support messages', () => {
    for (const text of ['код двери не работает', 'сломался душ', 'не убрано']) {
      expect(resolveTelegramTextMeta({ baseText: text, telegramLangCode: 'ru' })).toBeNull();
    }
  });

  it('does not steal operational context from short acknowledgement words', () => {
    expect(resolveTelegramTextMeta({ baseText: 'ок, код двери не работает', telegramLangCode: 'ru' })).toBeNull();
  });
});
