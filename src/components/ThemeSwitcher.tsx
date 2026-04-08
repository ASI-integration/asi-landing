'use client';

import { useId } from 'react';
import { THEMES, type ThemeId } from '@/theme/theme';
import { useTheme } from '@/theme/ThemeProvider';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const id = useId();

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs font-medium text-[var(--t-muted)] hidden sm:block">
        Тема
      </label>
      <select
        id={id}
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemeId)}
        aria-label="Тема"
        className="h-9 px-3 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] text-[var(--t-text)] text-sm font-medium
                   hover:bg-[var(--t-surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)]
                   focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}

