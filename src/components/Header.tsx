'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/i18n/useTranslation';

export function Header() {
  const [open, setOpen] = useState(false);
  const { t, locale, setLocale } = useTranslation();

  return (
    <header className="sticky top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/60">
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex flex-col">
          <span className="text-2xl font-bold text-slate-900 tracking-tight">
            ASI
          </span>
          <span className="text-xs text-slate-500 font-medium tracking-wide mt-0.5">
            Automated Smart Infrastructure
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-6">
          <a href="#problem" className="text-slate-600 hover:text-slate-900 text-sm transition-colors">
            {t('nav.problem')}
          </a>
          <a href="#solution" className="text-slate-600 hover:text-slate-900 text-sm transition-colors">
            {t('nav.solution')}
          </a>
          <a href="#features" className="text-slate-600 hover:text-slate-900 text-sm transition-colors">
            {t('nav.features')}
          </a>
          <a href="#pricing" className="text-slate-600 hover:text-slate-900 text-sm transition-colors">
            {t('nav.pricing')}
          </a>
          <a href="#faq" className="text-slate-600 hover:text-slate-900 text-sm transition-colors">
            {t('nav.faq')}
          </a>
          <div className="flex items-center gap-1 text-slate-500 text-sm">
            <button
              onClick={() => setLocale('en')}
              className={`px-2 py-1 rounded transition-colors ${locale === 'en' ? 'font-semibold text-slate-900 bg-slate-100' : 'hover:text-slate-900'}`}
            >
              EN
            </button>
            <span>|</span>
            <button
              onClick={() => setLocale('ru')}
              className={`px-2 py-1 rounded transition-colors ${locale === 'ru' ? 'font-semibold text-slate-900 bg-slate-100' : 'hover:text-slate-900'}`}
            >
              RU
            </button>
          </div>
          <a
            href="https://t.me/asi_support"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-slate-600 hover:text-slate-900 transition-colors"
            aria-label="Telegram"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
          </a>
          <Link
            href="/signup"
            className="inline-flex items-center justify-center px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-xl hover:bg-slate-800 transition-all duration-200 shadow-sm hover:shadow-md"
          >
            {t('nav.startTrial')}
          </Link>
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
      {open && (
        <div className="md:hidden border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-4 space-y-4">
          <a href="#problem" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.problem')}</a>
          <a href="#solution" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.solution')}</a>
          <a href="#features" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.features')}</a>
          <a href="#pricing" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.pricing')}</a>
          <a href="#faq" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.faq')}</a>
          <div className="flex gap-2">
            <button onClick={() => setLocale('en')} className={`px-2 py-1 text-sm rounded ${locale === 'en' ? 'font-semibold bg-slate-100' : ''}`}>EN</button>
            <button onClick={() => setLocale('ru')} className={`px-2 py-1 text-sm rounded ${locale === 'ru' ? 'font-semibold bg-slate-100' : ''}`}>RU</button>
          </div>
          <Link href="/signup" className="block text-center py-3 bg-slate-900 text-white rounded-xl font-semibold" onClick={() => setOpen(false)}>{t('nav.startTrial')}</Link>
        </div>
      )}
    </header>
  );
}
