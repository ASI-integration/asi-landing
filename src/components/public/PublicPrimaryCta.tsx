import Link from 'next/link';
import type { ComponentProps } from 'react';

const baseClass =
  'inline-flex min-h-[56px] w-full shrink-0 items-center justify-center rounded-2xl bg-[var(--t-accent)] px-10 py-4 text-lg font-bold tracking-tight text-white shadow-md transition-colors hover:bg-[var(--t-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-accent)] sm:min-h-[60px] sm:w-auto sm:min-w-[280px] sm:max-w-[420px] sm:whitespace-nowrap';

export type PublicPrimaryCtaProps = ComponentProps<typeof Link>;

export function PublicPrimaryCta({ className = '', children, ...props }: PublicPrimaryCtaProps) {
  return (
    <Link {...props} className={[baseClass, className].filter(Boolean).join(' ')}>
      {children}
    </Link>
  );
}
