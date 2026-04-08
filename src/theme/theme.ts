export type ThemeId = 'light' | 'midnight' | 'soft-blue';

export const THEME_STORAGE_KEY = 'asi_theme';

export const THEMES: Array<{ id: ThemeId; label: string }> = [
  { id: 'light', label: 'Светлая' },
  { id: 'midnight', label: 'Тёмная' },
  { id: 'soft-blue', label: 'Голубая' },
];

export const DEFAULT_THEME: ThemeId = 'light';

export function isThemeId(v: unknown): v is ThemeId {
  return v === 'light' || v === 'midnight' || v === 'soft-blue';
}

