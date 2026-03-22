import { LanguageCode, LanguageResolution } from './types';

const COMMON_GREETINGS: Record<string, LanguageCode> = {
  'hello': 'en', 'hi': 'en',
  'hola': 'es', 'buenos dias': 'es',
  'bonjour': 'fr', 'salut': 'fr',
  'hallo': 'de', 'guten tag': 'de',
  'привет': 'ru', 'здравствуйте': 'ru',
  'مرحبا': 'ar', 'السلام عليكم': 'ar',
  '你好': 'zh', '您好': 'zh'
};

export function detectLanguage(text: string): LanguageResolution {
  const normalized = text.toLowerCase().trim();
  
  // 1. Keyword brute force (In a real system: cld3 or fasttext)
  for (const [greeting, code] of Object.entries(COMMON_GREETINGS)) {
    if (normalized.includes(greeting)) {
      return { detectedLanguage: code, confidence: 0.8, source: 'message' };
    }
  }

  // 2. Character-set based detection
  if (/[\u4E00-\u9FFF]/.test(normalized)) {
    return { detectedLanguage: 'zh', confidence: 0.9, source: 'message' };
  }
  if (/[\u0600-\u06FF]/.test(normalized)) {
    return { detectedLanguage: 'ar', confidence: 0.9, source: 'message' };
  }
  if (/[\u0400-\u04FF]/.test(normalized)) {
    return { detectedLanguage: 'ru', confidence: 0.9, source: 'message' };
  }
  if (/[áéíóú¿¡ñ]/.test(normalized)) {
    return { detectedLanguage: 'es', confidence: 0.7, source: 'message' };
  }
  if (/[éàèùâêîôûç]/.test(normalized)) {
    return { detectedLanguage: 'fr', confidence: 0.7, source: 'message' };
  }
  if (/[äöüß]/.test(normalized)) {
    return { detectedLanguage: 'de', confidence: 0.7, source: 'message' };
  }

  // 3. Fallback
  return { detectedLanguage: 'en', confidence: 0.5, source: 'fallback' };
}

export function formatLanguageFallbackPrompt(lang: LanguageCode, originalSystemPrompt: string): string {
  if (lang === 'en') return originalSystemPrompt;

  return `${originalSystemPrompt}
  
CRITICAL LANGUAGE RULES:
- IMPORTANT: You MUST reply entirely in the language corresponding to language code '${lang}'.
- DO NOT hallucinate translated policy details. If specific property rules are missing in the provided knowledge context, fall back to a safe translated sentence explaining that the information is currently unavailable.
- All safety and emergency words must be explicit and clearly translated.`;
}
