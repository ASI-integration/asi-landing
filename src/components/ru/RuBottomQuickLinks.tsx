/** Shared quick links strip for RU public pages — ASI brand visual language. */
'use client';

import Link from 'next/link';
import { ruNavComplianceLinks, ruNavMainLinks } from '@/config/ruNav';
import { asiBrandLayout } from '@/config/brand/tokens';

type Tone = 'theme' | 'light' | 'dark';

const allLinks = [...ruNavMainLinks, ...ruNavComplianceLinks];

export function RuBottomQuickLinks({
  tone: _tone,
  showBackToTop = true,
}: {
  tone: Tone;
  showBackToTop?: boolean;
}) {
  void _tone;

  return (
    <section
      className="border-t border-asi-border bg-asi-paper/80 py-5 px-5 sm:px-8"
      aria-label="Быстрые ссылки"
    >
      <div
        className={`${asiBrandLayout.contentMaxClass} mx-auto flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
            Навигация
          </p>
          <nav
            className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 sm:gap-x-3.5"
            aria-label="Быстрые ссылки по сайту"
          >
            {allLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-xs text-asi-navy/65 hover:text-asi-navy underline-offset-2 hover:underline transition-colors"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        {showBackToTop ? (
          <button
            type="button"
            className="text-xs text-asi-navy/65 hover:text-asi-navy underline-offset-2 hover:underline transition-colors shrink-0"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            Наверх
          </button>
        ) : null}
      </div>
    </section>
  );
}
