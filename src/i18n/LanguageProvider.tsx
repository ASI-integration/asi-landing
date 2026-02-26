'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { Locale } from './useTranslation';
import { dictionaries } from './dictionaries';

const STORAGE_KEY = 'asi-locale';

type Dict = Record<string, unknown>;

function getNested(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

type LanguageContextValue = {
  locale: Locale;
  setLocale: (lang: Locale) => void;
  t: (path: string) => string;
  get: <T = unknown>(path: string) => T | undefined;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved === 'en' || saved === 'ru') {
      setLocaleState(saved);
    }
    setMounted(true);
  }, []);

  const dict = dictionaries[locale];
  const fallbackDict = dictionaries.en;

  const setLocale = useCallback((lang: Locale) => {
    setLocaleState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, lang);
    }
  }, []);

  const t = useCallback(
    (path: string): string => {
      const val = getNested(dict, path) ?? getNested(fallbackDict, path);
      return val != null ? String(val) : '';
    },
    [dict, fallbackDict]
  );

  const get = useCallback(
    <T = unknown>(path: string): T | undefined => {
      const val = getNested(dict, path) ?? getNested(fallbackDict, path);
      return val as T | undefined;
    },
    [dict, fallbackDict]
  );

  const value = useMemo(
    () => ({ locale: mounted ? locale : 'en', setLocale, t, get }),
    [locale, mounted, setLocale, t, get]
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguageContext() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguageContext must be used within LanguageProvider');
  }
  return ctx;
}
