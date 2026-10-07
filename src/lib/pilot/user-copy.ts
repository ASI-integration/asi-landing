/**
 * Pilot-facing Russian copy. Internal implementation words stay off this surface.
 */

export const PILOT_USER_STATE = {
  readyToWork: 'Готово к работе',
  inProgress: 'В работе',
  needsAnswer: 'Нужен ваш ответ',
  done: 'Готово',
  temporarilyUnavailable: 'Временно недоступно',
  failed: 'Не удалось выполнить',
} as const;

const INTERNAL_IMPLEMENTATION_WORDS =
  /\b(runtime|bridge|runner|baseline|checkout|executor|lease|execution slot|execution lane)\b/i;

export function containsPilotInternalCopy(value: string): boolean {
  return INTERNAL_IMPLEMENTATION_WORDS.test(value);
}

export function sanitizePilotUserText(value: unknown, max = 400): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  if (containsPilotInternalCopy(trimmed)) return null;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}
