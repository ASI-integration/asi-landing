'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/i18n/useTranslation';

export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const onRu = Boolean(pathname?.startsWith('/ru'));
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/60">
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        {/* Left: Brand + Who we are */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex flex-col">
            <span className="text-2xl font-bold text-slate-900 tracking-tight">ASI</span>
            <span className="text-xs text-slate-500 font-medium tracking-wide mt-0.5">
              {t('nav.tagline')}
            </span>
          </Link>
          <a
            href="#how-it-works"
            className="hidden md:block text-slate-600 hover:text-slate-900 text-sm font-medium transition-colors"
          >
            {t('nav.whoWeAre')}
          </a>
        </div>

        {/* Right: Locale + Contacts + Login */}
        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-1 text-slate-500 text-sm">
            <Link
              href="/"
              className={`px-2 py-1 rounded transition-colors ${!onRu ? 'font-semibold text-slate-900 bg-slate-100' : 'hover:text-slate-900'}`}
            >
              EN
            </Link>
            <span>|</span>
            <Link
              href="/ru"
              className={`px-2 py-1 rounded transition-colors ${onRu ? 'font-semibold text-slate-900 bg-slate-100' : 'hover:text-slate-900'}`}
            >
              RU
            </Link>
          </div>
          <a
            href={`mailto:${t('contact.supportEmail')}`}
            className="text-sm text-slate-600 hover:text-slate-900 font-medium transition-colors"
          >
            {t('nav.contacts')}
          </a>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-xl hover:bg-slate-800 transition-all duration-200 shadow-sm hover:shadow-md"
          >
            {t('nav.login')}
          </Link>
        </div>

        {/* Mobile hamburger */}
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

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-4 space-y-4">
          <a href="#how-it-works" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.whoWeAre')}</a>
          <a href="#features" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.features')}</a>
          <a href="#pricing" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.pricing')}</a>
          <a href="#faq" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.faq')}</a>
          <div className="flex gap-2">
            <Link href="/" onClick={() => setOpen(false)} className={`px-2 py-1 text-sm rounded ${!onRu ? 'font-semibold bg-slate-100' : ''}`}>EN</Link>
            <Link href="/ru" onClick={() => setOpen(false)} className={`px-2 py-1 text-sm rounded ${onRu ? 'font-semibold bg-slate-100' : ''}`}>RU</Link>
          </div>
          <a
            href={`mailto:${t('contact.supportEmail')}`}
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
