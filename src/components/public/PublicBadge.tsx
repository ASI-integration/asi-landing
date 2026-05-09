import type { ReactNode } from 'react';

export type PublicBadgeProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Non-interactive label — softer than a button; use for tags and categories only.
 */
export function PublicBadge({ children, className = '' }: PublicBadgeProps) {
  return (
    <span
      className={[
        'inline-flex max-w-full items-center rounded-lg bg-[var(--t-surface)] px-3 py-1.5 text-sm font-medium leading-snug text-[var(--t-text-2)] ring-1 ring-inset ring-[var(--t-border)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}
