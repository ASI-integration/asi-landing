import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export type PublicClickableCardProps = {
  href: string;
  title: string;
  children?: ReactNode;
  /** Visible hint next to the title (default: arrow) */
  trailing?: ReactNode;
  className?: string;
} & Omit<ComponentProps<typeof Link>, 'href' | 'className' | 'children'>;

/**
 * Navigation/actions framed as a card — hover, focus, and cursor communicate clickability.
 */
export function PublicClickableCard({
  href,
  title,
  children,
  trailing = (
    <span className="text-lg font-semibold text-[var(--t-accent)] transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180">
      →
    </span>
  ),
  className = '',
  ...linkProps
}: PublicClickableCardProps) {
  return (
    <Link
      href={href}
      {...linkProps}
      className={[
        'group relative block cursor-pointer rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-5 text-left shadow-sm outline-none transition-[border-color,box-shadow,background-color] hover:border-[var(--t-accent)]/35 hover:bg-[var(--t-surface-2)] hover:shadow-md focus-visible:border-[var(--t-accent)] focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-[var(--t-text)]">{title}</h3>
          {children ? <div className="mt-3 text-sm leading-relaxed text-[var(--t-text-2)]">{children}</div> : null}
        </div>
        <span className="shrink-0 pt-0.5" aria-hidden>
          {trailing}
        </span>
      </div>
    </Link>
  );
}
