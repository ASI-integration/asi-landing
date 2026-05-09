import type { ReactNode } from 'react';

export type PublicInfoCardProps = {
  children: ReactNode;
  className?: string;
  /** Use for accessibility when the card is a labelled region */
  'aria-labelledby'?: string;
};

/**
 * Static explanatory content — must not look or behave like a button (no pointer cursor, no hover “lift”).
 */
export function PublicInfoCard({ children, className = '', ...rest }: PublicInfoCardProps) {
  return (
    <div
      {...rest}
      className={[
        'rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-5 text-[var(--t-text-2)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
