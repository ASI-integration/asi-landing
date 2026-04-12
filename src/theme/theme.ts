export type ThemeId = 'light' | 'midnight';

export const THEME_STORAGE_KEY = 'asi_theme';

export const THEMES: Array<{ id: ThemeId; label: string }> = [
  { id: 'light', label: 'Светлая' },
  { id: 'midnight', label: 'Тёмная' },
];

export const DEFAULT_THEME: ThemeId = 'light';

export function isThemeId(v: unknown): v is ThemeId {
  return v === 'light' || v === 'midnight';
}

