import { describe, expect, it } from 'vitest';

import { ensureSpokenTerminalPunctuation } from '../gemini-native-audio';

describe('Gemini Native Audio final cadence preparation', () => {
  it('adds terminal punctuation to an otherwise complete declarative utterance', () => {
    expect(ensureSpokenTerminalPunctuation('Соблюдайте тишину после десяти вечера')).toBe(
      'Соблюдайте тишину после десяти вечера.',
    );
  });

  it('preserves existing terminal punctuation, including questions', () => {
    expect(ensureSpokenTerminalPunctuation('Вам всё понятно?')).toBe('Вам всё понятно?');
    expect(ensureSpokenTerminalPunctuation('Добро пожаловать!')).toBe('Добро пожаловать!');
    expect(ensureSpokenTerminalPunctuation('Всё готово.')).toBe('Всё готово.');
    expect(ensureSpokenTerminalPunctuation('Продолжение следует…')).toBe('Продолжение следует…');
  });

  it('places the final period before a closing quote in the speech-only copy', () => {
    expect(ensureSpokenTerminalPunctuation('Правило называется «тихий час»')).toBe(
      'Правило называется «тихий час.»',
    );
  });

  it('turns a dangling comma, colon, or semicolon into a completed final sentence', () => {
    expect(ensureSpokenTerminalPunctuation('Итог такой:')).toBe('Итог такой.');
    expect(ensureSpokenTerminalPunctuation('Всё готово,')).toBe('Всё готово.');
    expect(ensureSpokenTerminalPunctuation('Можно заселяться;')).toBe('Можно заселяться.');
  });
});
