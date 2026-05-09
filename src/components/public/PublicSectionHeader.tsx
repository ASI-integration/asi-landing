import type { ReactNode } from 'react';

export type PublicSectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  align?: 'left' | 'center';
  className?: string;
  /** Override default heading scale (e.g. closing hero headline). */
  titleClassName?: string;
};

export function PublicSectionHeader({
  title,
  description,
  eyebrow,
  align = 'left',
  className = '',
  titleClassName,
}: PublicSectionHeaderProps) {
  const alignClass = align === 'center' ? 'mx-auto text-center' : 'max-w-3xl';
  const defaultTitleClass = 'text-2xl font-bold tracking-tight text-[var(--t-text)] sm:text-3xl';

  return (
    <div className={[alignClass, className].filter(Boolean).join(' ')}>
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">{eyebrow}</p>
      ) : null}
      <h2
        className={[titleClassName ?? defaultTitleClass, eyebrow ? 'mt-3' : ''].filter(Boolean).join(' ')}
      >
        {title}
      </h2>
      {description ? (
        <div className="mt-3 text-base leading-relaxed text-[var(--t-text-2)]">{description}</div>
      ) : null}
    </div>
  );
}
