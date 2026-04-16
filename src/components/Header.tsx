'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/i18n/useTranslation';
import { productSupportEmail } from '@/config/contact';
import { RU_PUBLIC_ORIGIN } from '@/config/publicOrigins';
import { TgIcon } from '@/components/TgIcon';

export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const onRu = Boolean(pathname?.startsWith('/ru'));
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-b border-slate-200/70">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Top row: contacts + email + Telegram + locale + login */}
        <div className="hidden md:flex items-center justify-between py-2.5 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <a
              href={`mailto:${productSupportEmail}`}
              className="text-sm text-slate-600 hover:text-slate-900 font-medium transition-colors truncate"
              title={productSupportEmail}
            >
              {productSupportEmail}
            </a>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <a
              href="https://t.me/ASI_core_bot"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram"
              title="Telegram"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[#2CA5E0]/10 border border-[#2CA5E0]/25 text-[#229ED9] hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50 transition-all"
            >
              <TgIcon className="w-4 h-4 shrink-0" />
              <span className="sr-only">Telegram</span>
            </a>
            <div className="flex items-center gap-1 text-slate-500 text-sm">
              <Link
                href="/"
                className={`px-2 py-1 rounded transition-colors ${!onRu ? 'font-semibold text-slate-900 bg-slate-100' : 'hover:text-slate-900'}`}
              >
                EN
              </Link>
              <span className="text-slate-300">|</span>
              <a
                href={`${RU_PUBLIC_ORIGIN}/ru`}
                className={`px-2 py-1 rounded transition-colors ${onRu ? 'font-semibold text-slate-900 bg-slate-100' : 'hover:text-slate-900'}`}
              >
                RU
              </a>
            </div>
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-xl hover:bg-slate-800 transition-all duration-200 shadow-sm hover:shadow-md"
            >
              {t('nav.login')}
            </Link>
          </div>
        </div>

        <div className="hidden md:block h-px bg-slate-200/70" />

        {/* Bottom row: logo + main nav + mobile toggle */}
        <nav className="py-3.5 flex items-center justify-between gap-4">
          <Link href="/" className="flex flex-col shrink-0">
            <span className="text-2xl font-bold text-slate-900 tracking-tight">ASI</span>
            <span className="text-xs text-slate-500 font-medium tracking-wide mt-0.5">
              {t('nav.tagline')}
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-5">
            <a href="#how-it-works" className="text-base text-slate-700 hover:text-slate-900 font-medium transition-colors">
              {t('nav.whoWeAre')}
            </a>
            <a href="#features" className="text-base text-slate-700 hover:text-slate-900 font-medium transition-colors">
              {t('nav.features')}
            </a>
            <a href="#pricing" className="text-base text-slate-700 hover:text-slate-900 font-medium transition-colors">
              {t('nav.pricing')}
            </a>
            <a href="#faq" className="text-base text-slate-700 hover:text-slate-900 font-medium transition-colors">
              {t('nav.faq')}
            </a>
            <a
              href={`mailto:${productSupportEmail}`}
              className="text-base text-slate-700 hover:text-slate-900 font-medium transition-colors"
            >
              {t('nav.contacts')}
            </a>
          </div>

          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-2 text-slate-600"
            aria-label="Menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {open ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </nav>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-4 space-y-4">
          <a href="#how-it-works" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.whoWeAre')}</a>
          <a href="#features" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.features')}</a>
          <a href="#pricing" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.pricing')}</a>
          <a href="#faq" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.faq')}</a>
          <div className="flex gap-2">
            <Link href="/" onClick={() => setOpen(false)} className={`px-2 py-1 text-sm rounded ${!onRu ? 'font-semibold bg-slate-100' : ''}`}>EN</Link>
            <a href={`${RU_PUBLIC_ORIGIN}/ru`} onClick={() => setOpen(false)} className={`px-2 py-1 text-sm rounded ${onRu ? 'font-semibold bg-slate-100' : ''}`}>RU</a>
          </div>
          <a
            href={`mailto:${productSupportEmail}`}
            className="block text-sm text-slate-600 hover:text-slate-900 transition-colors"
            onClick={() => setOpen(false)}
          >
            {t('nav.contacts')}
          </a>
          <Link
            href="/login"
            className="block text-center py-3 bg-slate-900 text-white rounded-xl font-semibold"
            onClick={() => setOpen(false)}
          >
            {t('nav.login')}
          </Link>
        </div>
      )}
    </header>
  );
}
