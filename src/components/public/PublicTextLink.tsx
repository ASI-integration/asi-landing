import Link from 'next/link';
import type { ComponentProps } from 'react';

const baseClass =
  'inline-flex text-sm font-semibold text-[var(--t-text)] underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-accent)]';

export type PublicTextLinkProps = ComponentProps<typeof Link>;

export function PublicTextLink({ className = '', children, ...props }: PublicTextLinkProps) {
  return (
    <Link {...props} className={[baseClass, className].filter(Boolean).join(' ')}>
      {children}
    </Link>
  );
}
