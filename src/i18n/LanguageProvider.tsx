'use client';

import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Locale } from './useTranslation';
import { dictionaries } from './dictionaries';

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

function getLocaleFromUrl(): Locale {
  if (typeof window === 'undefined') return 'en';
  const { hostname, pathname } = window.location;
  // Prefer explicit path locale (used on asi-global.ru/ru).
  if (pathname?.startsWith('/ru')) return 'ru';
  // Owner cabinet is RU-only.
  if (pathname?.startsWith('/dashboard')) return 'ru';
  // Fallback: dedicated RU host.
  if (hostname?.endsWith('.ru')) return 'ru';
  return 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Compute initial locale synchronously to avoid sticky EN fallback on `/ru`.
  const [locale, setLocaleState] = useState<Locale>(() => getLocaleFromUrl());

  useEffect(() => {
    // Re-evaluate after mount in case hydration path differs.
    setLocaleState(getLocaleFromUrl());
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const dict = dictionaries[locale];
  const fallbackDict = dictionaries.en;

  const setLocale = useCallback((lang: Locale) => {
    setLocaleState(lang);
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
    () => ({ locale, setLocale, t, get }),
    [locale, setLocale, t, get]
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
