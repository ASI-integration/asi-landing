'use client';

import Link from 'next/link';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { TgIcon } from '@/components/TgIcon';
import { productSupportEmail } from '@/config/contact';
import { ruNavMainLinks } from '@/config/ruNav';

export type RuPublicNavSurface = 'theme' | 'light' | 'dark';
export type RuPublicNavDensity = 'legal' | 'landing';

const surfaceHeader: Record<RuPublicNavSurface, string> = {
  theme:
    'sticky top-0 z-50 bg-[color-mix(in_srgb,var(--t-bg)_92%,transparent)] backdrop-blur-md border-b border-[var(--t-border)]',
  light: 'sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200',
  dark: 'sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/60',
};

const surfaceLogo: Record<RuPublicNavSurface, string> = {
  theme: 'text-2xl font-bold text-[var(--t-text)] tracking-tight shrink-0',
  light: 'text-2xl font-bold text-slate-900 tracking-tight shrink-0',
  dark: 'text-2xl font-bold text-white tracking-tight shrink-0',
};

const surfaceNav: Record<RuPublicNavSurface, string> = {
  theme: 'text-[var(--t-muted)] hover:text-[var(--t-text)]',
  light: 'text-slate-600 hover:text-slate-900',
  dark: 'text-slate-400 hover:text-white',
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
    'hidden sm:inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[#2CA5E0]/10 border border-[#2CA5E0]/25 text-sky-300 hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50 transition-all',
  light:
    'hidden sm:inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[#2CA5E0]/10 border border-[#2CA5E0]/25 text-[#229ED9] hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50 transition-all',
  dark:
    'hidden sm:inline-flex items-center justify-center w-9 h-9 rounded-lg bg-slate-800 border border-slate-600 text-sky-300 hover:bg-slate-700 transition-all',
};

export function RuPublicNavHeader({
  surface,
  density,
}: {
  surface: RuPublicNavSurface;
  density: RuPublicNavDensity;
}) {
  const navCls = `text-xs sm:text-sm whitespace-nowrap transition-colors ${surfaceNav[surface]}`;
  const showTheme = surface === 'theme';

  return (
    <header className={surfaceHeader[surface]}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-3.5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-5 min-w-0">
          <Link href="/" className={surfaceLogo[surface]}>
            ASI
          </Link>
          <nav
            className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 sm:gap-x-4 overflow-x-auto sm:overflow-visible pb-0.5 sm:pb-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Основная навигация"
          >
            {ruNavMainLinks.map(({ href, label }) => (
              <Link key={href} href={href} className={navCls}>
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 lg:justify-end shrink-0">
          {density === 'landing' ? (
            <>
              <a
                href={`mailto:${productSupportEmail}`}
                className={`hidden sm:block text-sm truncate max-w-[11rem] md:max-w-none transition-colors ${surfaceMuted[surface]}`}
                title={productSupportEmail}
              >
                {productSupportEmail}
              </a>
              <span className={`hidden sm:block w-px h-4 shrink-0 ${surfaceDivider[surface]}`} />
              <a
                href="https://t.me/ASI_core_bot"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Telegram"
                title="Telegram"
                className={surfaceTg[surface]}
              >
                <TgIcon className="w-4 h-4 shrink-0" />
                <span className="sr-only">Telegram</span>
              </a>
              <div className={`flex items-center gap-1 text-sm ${surfaceMuted[surface]}`}>
                <a href="https://asi-global.com" className="px-2 py-1 rounded transition-colors">
                  EN
                </a>
                <span className={surface === 'dark' ? 'text-slate-600' : surface === 'light' ? 'text-slate-300' : 'text-[var(--t-border)]'}>
                  |
                </span>
                <span className={surfaceLangActive[surface]}>RU</span>
              </div>
            </>
          ) : null}
          {showTheme ? <ThemeSwitcher /> : null}
          {density === 'landing' ? (
            <Link href="/login" className={surfaceLogin[surface]}>
              Войти
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
