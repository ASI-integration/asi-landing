'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { TgIcon } from '@/components/TgIcon';
import { productSupportEmail } from '@/config/contact';
import { ruNavMainLinks } from '@/config/ruNav';
import { ruComplianceRoutes } from '@/config/ruCompliance';

export type RuPublicNavSurface = 'theme' | 'light' | 'dark';
export type RuPublicNavDensity = 'legal' | 'landing';

const surfaceHeader: Record<RuPublicNavSurface, string> = {
  theme:
    'sticky top-0 z-50 bg-[color-mix(in_srgb,var(--t-bg)_96%,transparent)] backdrop-blur-sm border-b border-[var(--t-border)]',
  light: 'sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-200',
  dark: 'sticky top-0 z-50 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800/60',
};

const surfaceLogo: Record<RuPublicNavSurface, string> = {
  theme: 'text-[2rem] sm:text-[2.4rem] font-bold leading-none text-[var(--t-text)] tracking-tight shrink-0',
  light: 'text-[2rem] sm:text-[2.4rem] font-bold leading-none text-slate-900 tracking-tight shrink-0',
  dark: 'text-[2rem] sm:text-[2.4rem] font-bold leading-none text-white tracking-tight shrink-0',
};

const surfaceNav: Record<RuPublicNavSurface, string> = {
  theme: 'text-[var(--t-muted)] hover:text-[var(--t-text)]',
  light: 'text-slate-600 hover:text-slate-900',
  dark: 'text-slate-400 hover:text-white',
};

const surfaceNavActive: Record<RuPublicNavSurface, string> = {
  theme: 'text-[var(--t-text)] bg-[var(--t-surface-2)] border-[var(--t-border)]',
  light: 'text-slate-950 bg-slate-100 border-slate-200',
  dark: 'text-white bg-slate-800 border-slate-700',
};

const surfaceMuted: Record<RuPublicNavSurface, string> = {
  theme: 'text-[var(--t-muted)] hover:text-[var(--t-text)]',
  light: 'text-slate-600 hover:text-slate-900',
  dark: 'text-slate-400 hover:text-white',
};

const surfaceDivider: Record<RuPublicNavSurface, string> = {
  theme: 'bg-[var(--t-border)]',
  light: 'bg-slate-200',
  dark: 'bg-slate-700',
};

const surfaceLangActive: Record<RuPublicNavSurface, string> = {
  theme:
    'px-2 py-1 rounded font-semibold text-[var(--t-text)] bg-[var(--t-surface-2)] border border-[var(--t-border)]',
  light: 'px-2 py-1 rounded font-semibold text-slate-900 bg-slate-100 border border-slate-200',
  dark: 'px-2 py-1 rounded font-semibold text-white bg-slate-800 border border-slate-600',
};

const surfaceLogin: Record<RuPublicNavSurface, string> = {
  theme:
    'inline-flex items-center justify-center px-4 py-2 bg-[var(--t-accent)] text-white text-sm font-semibold rounded-lg hover:bg-[var(--t-accent-hover)] transition-colors shadow-sm',
  light:
    'inline-flex items-center justify-center px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 transition-colors shadow-sm',
  dark:
    'inline-flex items-center justify-center px-4 py-2 bg-white text-slate-900 text-sm font-semibold rounded-lg hover:bg-slate-100 transition-colors shadow-sm',
};

const surfaceTg: Record<RuPublicNavSurface, string> = {
  theme:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#2CA5E0]/30 bg-[#2CA5E0]/10 px-3 py-2 text-sm font-semibold text-[#229ED9] transition-all hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50',
  light:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#2CA5E0]/30 bg-[#2CA5E0]/10 px-3 py-2 text-sm font-semibold text-[#229ED9] transition-all hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50',
  dark:
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold text-sky-300 transition-all hover:bg-slate-700',
};

export function RuPublicNavHeader({
  surface,
  density,
  showContacts = true,
}: {
  surface: RuPublicNavSurface;
  density: RuPublicNavDensity;
  showContacts?: boolean;
}) {
  const pathname = usePathname();
  const navCls =
    'rounded-lg border px-2.5 py-2 text-[13px] font-medium whitespace-nowrap transition-colors sm:text-sm lg:text-[15px]';

  const showTheme = surface === 'theme';
  const isCurrentHref = (href: string) => {
    if (href.includes('#')) return false;
    if (href === '/ru') return pathname === '/' || pathname === '/ru';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <header className={surfaceHeader[surface]}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Top row: contacts + email + Telegram + lang + theme + login */}
        {density === 'landing' ? (
          <div className="py-1.5 sm:py-2 flex items-center justify-between gap-x-3 min-w-0">
            {showContacts ? (
              <div className="flex items-center gap-x-3 min-w-0 overflow-hidden">
                <Link
                  href={ruComplianceRoutes.contacts}
                  className={`text-sm font-medium transition-colors ${surfaceMuted[surface]}`}
                >
                  Контакты
                </Link>
                <span className={`hidden sm:block w-px h-4 shrink-0 ${surfaceDivider[surface]}`} />
                <a
                  href={`mailto:${productSupportEmail}`}
                  className={`hidden lg:block text-sm truncate max-w-[12rem] xl:max-w-[16rem] transition-colors ${surfaceMuted[surface]}`}
                  title={productSupportEmail}
                >
                  {productSupportEmail}
                </a>
              </div>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2 sm:gap-3 justify-end shrink-0">
              {showContacts ? (
                <a
                  href="https://t.me/ASI_core_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Написать в Telegram"
                  title="Написать в Telegram"
                  className={surfaceTg[surface]}
                >
                  <TgIcon className="h-5 w-5 shrink-0" />
                  <span>Telegram</span>
                </a>
              ) : null}
              {showTheme ? <ThemeSwitcher /> : null}
              <Link href="/login" className={surfaceLogin[surface]}>
                Войти
              </Link>
            </div>
          </div>
        ) : null}

        <div className={`h-px ${surfaceDivider[surface]} opacity-60`} />

        {/* Bottom row: logo + main nav */}
        <div className="py-2 sm:py-2.5 flex items-center gap-3 sm:gap-4">
          <Link href="/ru" className={surfaceLogo[surface]}>
            ASI
          </Link>
          <nav
            className="flex items-center gap-x-3 sm:gap-x-3.5 lg:gap-x-4 xl:gap-x-5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-w-0"
            aria-label="Основная навигация"
          >
            {ruNavMainLinks.map(({ href, label }) => {
              const isCurrent = isCurrentHref(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`${navCls} ${isCurrent ? surfaceNavActive[surface] : `border-transparent ${surfaceNav[surface]}`}`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
