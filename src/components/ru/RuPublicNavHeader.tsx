'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { BrandLogoMark } from '@/components/brand';
import { TgIcon } from '@/components/TgIcon';
import { productSupportEmail } from '@/config/contact';
import { telegramSupportBotUrl } from '@/config/telegramBots';
import { asiBrandButtonClasses, asiBrandLayout } from '@/config/brand/tokens';
import { ruNavMainLinks } from '@/config/ruNav';
import { ruComplianceRoutes } from '@/config/ruCompliance';

export type RuPublicNavSurface = 'theme' | 'light' | 'dark';
export type RuPublicNavDensity = 'legal' | 'landing';

const PRIMARY_CTA = { href: '/ru/early-access', label: 'Подключить пилот' } as const;

/**
 * RU public header — guestautopilot visual language, RU customer journey labels.
 * Login remains utility; primary acquisition CTA is communications pilot.
 */
export function RuPublicNavHeader({
  density,
  showContacts = true,
}: {
  /** Kept for call-site compatibility; visual system is shared ASI brand. */
  surface?: RuPublicNavSurface;
  density: RuPublicNavDensity;
  showContacts?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isCurrentHref = (href: string) => {
    if (!pathname) return false;
    if (href.includes('#')) return false;
    if (href === '/ru') return pathname === '/' || pathname === '/ru';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <header className="sticky top-0 z-50 bg-asi-ivory/90 backdrop-blur-md border-b border-asi-border">
      <div
        className={`${asiBrandLayout.contentMaxClass} mx-auto ${asiBrandLayout.pagePadXClass} ${asiBrandLayout.headerHeightClass} flex items-center justify-between gap-4`}
      >
        <Link
          href="/ru"
          className="flex items-center gap-2.5 sm:gap-3 shrink-0 text-asi-navy"
          onClick={() => setOpen(false)}
        >
          <BrandLogoMark size={26} />
          <span className="font-serif text-lg tracking-tight">ASI</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-7" aria-label="Основная навигация">
          {ruNavMainLinks.map(({ href, label }) => {
            const isCurrent = isCurrentHref(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={isCurrent ? 'page' : undefined}
                className={`text-sm font-sans transition-colors ${
                  isCurrent ? 'text-asi-navy font-semibold' : 'text-asi-navy/70 hover:text-asi-navy'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden lg:flex items-center gap-4 shrink-0">
          {density === 'landing' && showContacts ? (
            <a
              href={telegramSupportBotUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Написать в Telegram"
              className="inline-flex items-center gap-2 text-sm font-sans text-asi-navy/70 hover:text-asi-navy transition-colors"
            >
              <TgIcon className="h-4 w-4" />
              <span className="hidden xl:inline">Telegram</span>
            </a>
          ) : null}
          <Link
            href="/login"
            className="text-sm font-sans text-asi-navy/65 hover:text-asi-navy transition-colors"
          >
            Войти
          </Link>
          <Link href={PRIMARY_CTA.href} className={asiBrandButtonClasses.headerOutline}>
            {PRIMARY_CTA.label}
          </Link>
        </div>

        <button
          type="button"
          className="lg:hidden inline-flex items-center justify-center w-10 h-10 text-asi-navy"
          aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
            {open ? (
              <path d="M4 4L18 18M18 4L4 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            ) : (
              <>
                <line x1="2" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="1.5" />
                <line x1="2" y1="11" x2="20" y2="11" stroke="currentColor" strokeWidth="1.5" />
                <line x1="2" y1="16" x2="20" y2="16" stroke="currentColor" strokeWidth="1.5" />
              </>
            )}
          </svg>
        </button>
      </div>

      {open ? (
        <div className="lg:hidden border-t border-asi-border bg-asi-ivory px-5 py-4 flex flex-col gap-1">
          <nav className="flex flex-col" aria-label="Мобильная навигация">
            {ruNavMainLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="py-2.5 text-base font-sans text-asi-navy border-b border-asi-border/60 last:border-b-0"
              >
                {label}
              </Link>
            ))}
          </nav>
          {density === 'landing' && showContacts ? (
            <div className="mt-3 flex flex-col gap-2 text-sm font-sans text-asi-navy/75">
              <Link href={ruComplianceRoutes.contacts} onClick={() => setOpen(false)}>
                Контакты
              </Link>
              <a href={`mailto:${productSupportEmail}`}>{productSupportEmail}</a>
              <a
                href={telegramSupportBotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2"
              >
                <TgIcon className="h-4 w-4" />
                Telegram
              </a>
            </div>
          ) : null}
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="mt-3 text-sm font-sans text-asi-navy/65"
          >
            Войти
          </Link>
          <Link
            href={PRIMARY_CTA.href}
            onClick={() => setOpen(false)}
            className={`mt-3 ${asiBrandButtonClasses.primary}`}
          >
            {PRIMARY_CTA.label}
          </Link>
        </div>
      ) : null}
    </header>
  );
}
