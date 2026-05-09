import type { ReactNode } from 'react';

export type PublicSectionVariant = 'hero' | 'default' | 'muted';

export type PublicSectionProps = {
  variant?: PublicSectionVariant;
  children: ReactNode;
  className?: string;
};

const variantClass: Record<PublicSectionVariant, string> = {
  hero: 'border-t-0 bg-[var(--t-bg)]',
  default: 'border-t border-[var(--t-border)] bg-[var(--t-bg)]',
  muted: 'border-t border-[var(--t-border)] bg-[var(--t-surface-2)]',
};

const spacingClass: Record<PublicSectionVariant, string> = {
  hero: 'px-4 py-10 sm:px-6 sm:py-12 lg:py-14',
  default: 'px-4 py-16 sm:px-6 sm:py-20',
  muted: 'px-4 py-16 sm:px-6 sm:py-20',
};

export function PublicSection({ variant = 'default', children, className = '' }: PublicSectionProps) {
  return (
    <section className={[variantClass[variant], spacingClass[variant], className].filter(Boolean).join(' ')}>
      {children}
    </section>
  );
}
