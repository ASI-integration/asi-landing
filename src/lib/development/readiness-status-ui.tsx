import type { DevelopmentReadinessState } from '@/lib/development/readiness-types';

export const READINESS_STATE_LABELS = {
  ready: 'Готово',
  degraded: 'Требует внимания',
  blocked: 'Есть блокер',
} as const satisfies Record<DevelopmentReadinessState, string>;

export const OVERALL_READINESS_STATUS_LABELS = {
  ready: 'Система готова',
  degraded: 'Требует внимания',
  blocked: 'Есть блокер',
} as const satisfies Record<DevelopmentReadinessState, string>;

const STATE_COLOR_CLASS = {
  ready: 'text-emerald-600',
  degraded: 'text-amber-600',
  blocked: 'text-red-600',
} as const satisfies Record<DevelopmentReadinessState, string>;

export function readinessItemAriaLabel(state: DevelopmentReadinessState): string {
  return `Статус компонента: ${READINESS_STATE_LABELS[state]}`;
}

export function overallReadinessAriaLabel(state: DevelopmentReadinessState): string {
  return `Общий статус системы: ${OVERALL_READINESS_STATUS_LABELS[state]}`;
}

export function readinessStateColorClass(state: DevelopmentReadinessState): string {
  return STATE_COLOR_CLASS[state];
}

type ReadinessStateIconProps = {
  state: DevelopmentReadinessState;
  ariaLabel: string;
  className?: string;
};

export function ReadinessStateIcon({ state, ariaLabel, className = '' }: ReadinessStateIconProps) {
  const color = readinessStateColorClass(state);
  const shared = `inline-flex h-4 w-4 shrink-0 items-center justify-center ${color} ${className}`.trim();

  if (state === 'ready') {
    return (
      <svg
        viewBox="0 0 16 16"
        aria-label={ariaLabel}
        role="img"
        className={shared}
      >
        <path
          fill="currentColor"
          d="M6.5 11.2 3.3 8l1.1-1.1 2.1 2.1 4.6-4.6L12.2 5.5 6.5 11.2z"
        />
      </svg>
    );
  }

  if (state === 'degraded') {
    return (
      <svg
        viewBox="0 0 16 16"
        aria-label={ariaLabel}
        role="img"
        className={shared}
      >
        <path
          fill="currentColor"
          d="M8 1.5 14.5 13H1.5L8 1.5zm0 3.2-.9 4.8h1.8L8 4.7zm0 6.1a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 16 16"
      aria-label={ariaLabel}
      role="img"
      className={shared}
    >
      <path
        fill="currentColor"
        d="M4.1 3 8 6.9 11.9 3 13 4.1 9.1 8 13 11.9 11.9 13 8 9.1 4.1 13 3 11.9 6.9 8 3 4.1 4.1 3z"
      />
    </svg>
  );
}

type OverallReadinessBadgeProps = {
  state: DevelopmentReadinessState;
};

export function OverallReadinessBadge({ state }: OverallReadinessBadgeProps) {
  const label = OVERALL_READINESS_STATUS_LABELS[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm font-medium ${readinessStateColorClass(state)}`}
      data-readiness-overall={state}
    >
      <ReadinessStateIcon state={state} ariaLabel={overallReadinessAriaLabel(state)} />
      <span>{label}</span>
    </span>
  );
}

type ItemReadinessBadgeProps = {
  state: DevelopmentReadinessState;
};

export function ItemReadinessBadge({ state }: ItemReadinessBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${readinessStateColorClass(state)}`}
      data-readiness-item={state}
    >
      <ReadinessStateIcon state={state} ariaLabel={readinessItemAriaLabel(state)} />
      <span>{READINESS_STATE_LABELS[state]}</span>
    </span>
  );
}

export function ReadinessRefreshIndicator() {
  return (
    <span
      className="inline-flex items-center gap-2 text-xs font-medium text-slate-500"
      role="status"
      aria-live="polite"
      aria-label="Идёт повторная проверка готовности"
      data-readiness-refresh="true"
    >
      <span
        className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
        aria-hidden="true"
      />
      Обновление…
    </span>
  );
}
