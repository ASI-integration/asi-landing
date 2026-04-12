'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_THEME, isThemeId, THEME_STORAGE_KEY, type ThemeId } from './theme';

type ThemeContextValue = {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  storageKey = THEME_STORAGE_KEY,
  defaultTheme = DEFAULT_THEME,
  className,
}: {
  children: React.ReactNode;
  storageKey?: string;
  defaultTheme?: ThemeId;
  className?: string;
}) {
  const [theme, setThemeState] = useState<ThemeId>(defaultTheme);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === 'soft-blue') {
        setThemeState('light');
        window.localStorage.setItem(storageKey, 'light');
      } else if (isThemeId(stored)) {
        setThemeState(stored);
      }
    } catch {
      // ignore storage errors (private mode / denied)
    }
  }, [storageKey]);

  const setTheme = (t: ThemeId) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(storageKey, t);
    } catch {
      // ignore
    }
  };

  const value = useMemo(() => ({ theme, setTheme }), [theme]);

  return (
    <ThemeContext.Provider value={value}>
      <div data-theme={theme} className={className}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

