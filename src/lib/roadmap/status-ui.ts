import type { RoadmapStatus } from './types';

export const ROADMAP_STATUS_LABELS: Record<RoadmapStatus, string> = {
  done: 'Готово',
  in_progress: 'В работе',
  blocked: 'Блокер',
  later: 'Позже',
};

export const ROADMAP_STATUS_DESCRIPTIONS: Record<RoadmapStatus, string> = {
  done: 'Реализовано и подтверждено кодом, тестом или документацией',
  in_progress: 'Частично существует; нужны ручные шаги или завершение',
  blocked: 'Отсутствует или блокирует полный цикл',
  later: 'Запланировано после пилотного запуска',
};

export const ROADMAP_FILTER_LABELS = {
  all: 'Все',
  done: 'Готово',
  in_progress: 'В работе',
  blocked: 'Блокеры',
  later: 'Позже',
} as const;

/** Text + icon glyph for color-blind / non-color reliance */
export const ROADMAP_STATUS_ICON: Record<RoadmapStatus, string> = {
  done: '✓',
  in_progress: '◐',
  blocked: '✕',
  later: '○',
};

export function roadmapStatusColorClass(status: RoadmapStatus): string {
  switch (status) {
    case 'done':
      return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    case 'in_progress':
      return 'text-amber-800 bg-amber-50 border-amber-200';
    case 'blocked':
      return 'text-red-700 bg-red-50 border-red-200';
    case 'later':
      return 'text-slate-600 bg-slate-100 border-slate-200';
  }
}

export function roadmapStatusDotClass(status: RoadmapStatus): string {
  switch (status) {
    case 'done':
      return 'bg-emerald-500';
    case 'in_progress':
      return 'bg-amber-400';
    case 'blocked':
      return 'bg-red-500';
    case 'later':
      return 'bg-slate-400';
  }
}

export function roadmapStatusBarClass(status: RoadmapStatus): string {
  switch (status) {
    case 'done':
      return 'bg-emerald-500';
    case 'in_progress':
      return 'bg-amber-400';
    case 'blocked':
      return 'bg-red-500';
    case 'later':
      return 'bg-slate-300';
  }
}

export function roadmapStatusAriaLabel(status: RoadmapStatus): string {
  return `${ROADMAP_STATUS_LABELS[status]}: ${ROADMAP_STATUS_DESCRIPTIONS[status]}`;
}
