import { describe, it, expect } from 'vitest';
import { detectLanguage, formatLanguageFallbackPrompt } from '../language';

describe('Multilingual Layer', () => {
  it('detects simple english greetings', () => {
    expect(detectLanguage('Hello, I need help').detectedLanguage).toBe('en');
    expect(detectLanguage('Hi there!').detectedLanguage).toBe('en');
  });

  it('detects spanish via character sets and greetings', () => {
    expect(detectLanguage('Hola, ¿cómo estás?').detectedLanguage).toBe('es');
    expect(detectLanguage('¿Dónde está la llave?').detectedLanguage).toBe('es');
  });

  it('detects chinese fallback via logograms', () => {
    expect(detectLanguage('你好，我在哪里可以停车？').detectedLanguage).toBe('zh');
  });

  it('detects arabic from characters', () => {
    expect(detectLanguage('مرحبا متى يمكنني تسجيل الدخول؟').detectedLanguage).toBe('ar');
  });

  it('detects russian from cyrillic', () => {
    expect(detectLanguage('Где ключи?').detectedLanguage).toBe('ru');
  });

  it('generates a strict fallback prompt when language is not en', () => {
    const original = 'You are a helpful assistant.';
    const prompt = formatLanguageFallbackPrompt('zh', original);
    expect(prompt).toContain(original);
    expect(prompt).toContain(`code 'zh'`);
    expect(prompt).toContain('DO NOT hallucinate');
  });

  it('returns original prompt entirely for en', () => {
    const original = 'You are a helpful assistant.';
    expect(formatLanguageFallbackPrompt('en', original)).toBe(original);
  });
});
