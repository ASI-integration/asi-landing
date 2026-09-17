import Link from 'next/link';
import type { ReactNode } from 'react';

/* ── Section wrapper ─────────────────────────────────────────────── */

export function Section({
  children,
  variant = 'ivory',
  id,
  className = '',
}: {
  children: ReactNode;
  variant?: 'ivory' | 'paper' | 'navy';
  id?: string;
  className?: string;
}) {
  const bg =
    variant === 'navy'
      ? 'bg-asi-navy text-asi-ivory'
      : variant === 'paper'
        ? 'bg-asi-paper text-asi-navy'
        : 'bg-asi-ivory text-asi-navy';

  return (
    <section id={id} className={`${bg} py-16 sm:py-24 px-5 sm:px-8 ${className}`}>
      <div className="max-w-6xl mx-auto">{children}</div>
    </section>
  );
}

/* ── Small uppercase eyebrow label ───────────────────────────────── */

export function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <p
      className={`flex items-center gap-3 text-xs font-sans font-semibold uppercase tracking-[0.22em] mb-4 ${
        dark ? 'text-asi-gold-soft' : 'text-asi-gold-text'
      }`}
    >
      <span className={`h-px w-8 ${dark ? 'bg-asi-gold-soft' : 'bg-asi-gold'}`} />
      {children}
    </p>
  );
}

/* ── Thin gold rule ───────────────────────────────────────────────── */

export function GoldRule({ dark = false, className = '' }: { dark?: boolean; className?: string }) {
  return <span className={`block h-px w-16 ${dark ? 'bg-asi-gold-soft' : 'bg-asi-gold'} ${className}`} />;
}

/* ── Headline ─────────────────────────────────────────────────────── */

export function Headline({
  children,
  as: Tag = 'h2',
  className = '',
}: {
  children: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  return (
    <Tag className={`font-serif font-medium tracking-tight leading-[1.05] ${className}`}>
      {children}
    </Tag>
  );
}

/* ── CTA buttons ──────────────────────────────────────────────────── */

function isExternal(href: string) {
  return /^https?:\/\//.test(href) || href.startsWith('mailto:');
}

export function PrimaryCta({
  href,
  children,
  disabledReason,
}: {
  href: string;
  children: ReactNode;
  /** When set, renders the identical button with no live destination — no navigation, no fabricated contact. */
  disabledReason?: string;
}) {
  const external = isExternal(href);
  const cls =
    'inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-asi-navy text-asi-ivory text-sm font-sans font-semibold tracking-wide rounded-sm border border-asi-navy hover:bg-asi-navy-2 transition-colors';
  if (disabledReason) {
    return (
      <button type="button" disabled aria-label={disabledReason} title={disabledReason} className={`${cls} opacity-60 cursor-not-allowed hover:bg-asi-navy`}>
        {children}
      </button>
    );
  }
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function SecondaryCta({
  href,
  children,
  disabledReason,
}: {
  href: string;
  children: ReactNode;
  /** When set, renders the identical button with no live destination — no navigation, no fabricated contact. */
  disabledReason?: string;
}) {
  const external = isExternal(href);
  const cls =
    'inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-transparent text-asi-navy text-sm font-sans font-semibold tracking-wide rounded-sm border border-asi-navy/70 hover:border-asi-navy transition-colors';
  if (disabledReason) {
    return (
      <button type="button" disabled aria-label={disabledReason} title={disabledReason} className={`${cls} opacity-60 cursor-not-allowed hover:border-asi-navy/70`}>
        {children}
      </button>
    );
  }
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
