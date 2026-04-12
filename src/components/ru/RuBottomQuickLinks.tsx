'use client';

import Link from 'next/link';
import { ruNavComplianceLinks, ruNavMainLinks } from '@/config/ruNav';

type Tone = 'theme' | 'light' | 'dark';

const wrapTone: Record<Tone, string> = {
  theme: 'border-t border-[var(--t-border)] bg-[color-mix(in_srgb,var(--t-bg)_96%,transparent)]',
  light: 'border-t border-slate-200 bg-slate-50/80',
  dark: 'border-t border-slate-800/60 bg-slate-950',
};

const labelTone: Record<Tone, string> = {
  theme: 'text-[var(--t-muted)]',
  light: 'text-slate-500',
  dark: 'text-slate-500',
};

const linkTone: Record<Tone, string> = {
  theme:
    'text-xs text-[var(--t-muted)] hover:text-[var(--t-text)] underline-offset-2 hover:underline transition-colors',
  light: 'text-xs text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline transition-colors',
  dark: 'text-xs text-slate-500 hover:text-slate-200 underline-offset-2 hover:underline transition-colors',
};

const topTone: Record<Tone, string> = {
  theme:
    'text-xs text-[var(--t-muted)] hover:text-[var(--t-text)] underline-offset-2 hover:underline transition-colors shrink-0',
  light: 'text-xs text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline transition-colors shrink-0',
  dark: 'text-xs text-slate-500 hover:text-slate-200 underline-offset-2 hover:underline transition-colors shrink-0',
};

const allLinks = [...ruNavMainLinks, ...ruNavComplianceLinks];

export function RuBottomQuickLinks({
  tone,
  showBackToTop = true,
}: {
  tone: Tone;
  showBackToTop?: boolean;
}) {
  return (
    <section className={`${wrapTone[tone]} py-5 px-4 sm:px-6`} aria-label="Быстрые ссылки">
      <div className="max-w-6xl mx-auto flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${labelTone[tone]}`}>
            Навигация
          </p>
          <nav
            className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 sm:gap-x-3.5"
            aria-label="Быстрые ссылки по сайту"
          >
            {allLinks.map(({ href, label }) => (
              <Link key={href} href={href} className={linkTone[tone]}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
        {showBackToTop ? (
          <button
            type="button"
            className={topTone[tone]}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            Наверх
          </button>
        ) : null}
      </div>
    </section>
  );
}
