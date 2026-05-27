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

  it('returns exact EN / RU / ES capability strings for the Telegram smoke matrix', () => {
    const enHello = resolveTelegramTextMeta({ baseText: 'hello', telegramLangCode: 'ru' });
    expect(enHello?.reply).toBe('Hi! Send a guest message, issue, or check-in details.');

    const enCap = resolveTelegramTextMeta({ baseText: 'can u understand me?', telegramLangCode: 'ru' });
    expect(enCap?.reply).toBe(
      'Yes, I understand English and Russian. Please send your request as text.',
    );

    const ruCap = resolveTelegramTextMeta({ baseText: 'ты понимаешь русский?', telegramLangCode: 'en' });
    expect(ruCap?.reply).toBe('Да, понимаю русский и английский. Пришлите, пожалуйста, запрос текстом.');

    const esCap = resolveTelegramTextMeta({ baseText: 'te habla espanol?', telegramLangCode: 'en' });
    expect(esCap?.reply).toBe(
      'Sí, entiendo mensajes en inglés y ruso. Envíe su solicitud por texto, por favor.',
    );
  });

  it('routes neutral bot/meta smalltalk without operational context', () => {
    const smartBot = resolveTelegramTextMeta({ baseText: 'А ты умный бот?', telegramLangCode: 'ru' });
    expect(smartBot?.kind).toBe('smalltalk');
    expect(smartBot?.reply).toMatch(/бот ASI/i);

    const bot = resolveTelegramTextMeta({ baseText: 'ты бот?', telegramLangCode: 'ru' });
    expect(bot?.kind).toBe('smalltalk');

    const thanks = resolveTelegramTextMeta({ baseText: 'спасибо', telegramLangCode: 'ru' });
    expect(thanks?.kind).toBe('smalltalk');
    expect(thanks?.reply).toMatch(/Пожалуйста/i);
  });

  it('does not steal operational context from short acknowledgement words', () => {
    expect(resolveTelegramTextMeta({ baseText: 'ок, код двери не работает', telegramLangCode: 'ru' })).toBeNull();
  });
});
