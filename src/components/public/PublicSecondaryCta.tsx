import Link from 'next/link';
import type { ComponentProps } from 'react';

const baseClass =
  'inline-flex min-h-[48px] w-full shrink-0 items-center justify-center rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] px-8 py-3 text-base font-semibold text-[var(--t-text-2)] shadow-sm transition-colors hover:border-[var(--t-muted)] hover:bg-[var(--t-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-accent)] sm:min-h-[52px] sm:w-auto sm:min-w-[220px] sm:whitespace-nowrap';

export type PublicSecondaryCtaProps = ComponentProps<typeof Link>;

export function PublicSecondaryCta({ className = '', children, ...props }: PublicSecondaryCtaProps) {
  return (
    <Link {...props} className={[baseClass, className].filter(Boolean).join(' ')}>
      {children}
    </Link>
  );
}
