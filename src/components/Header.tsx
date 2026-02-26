'use client';

import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

export function Header() {
  const [open, setOpen] = useState(false);
  const { t, locale, setLocale } = useTranslation();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <a href="#" className="text-xl font-bold text-slate-900 tracking-tight">
          ASI
        </a>
        <div className="hidden md:flex items-center gap-8">
          <a href="#problem" className="text-slate-600 hover:text-slate-900 text-sm">
            {t('nav.problem')}
          </a>
          <a href="#solution" className="text-slate-600 hover:text-slate-900 text-sm">
            {t('nav.solution')}
          </a>
          <a href="#features" className="text-slate-600 hover:text-slate-900 text-sm">
            {t('nav.features')}
          </a>
          <a href="#pricing" className="text-slate-600 hover:text-slate-900 text-sm">
            {t('nav.pricing')}
          </a>
          <a href="#faq" className="text-slate-600 hover:text-slate-900 text-sm">
            {t('nav.faq')}
          </a>
          <div className="flex items-center gap-1 text-slate-500 text-sm">
            <button
              onClick={() => setLocale('en')}
              className={`px-2 py-1 rounded ${locale === 'en' ? 'font-semibold text-slate-900 bg-slate-100' : 'hover:text-slate-900'}`}
            >
              EN
            </button>
            <span>|</span>
            <button
              onClick={() => setLocale('ru')}
              className={`px-2 py-1 rounded ${locale === 'ru' ? 'font-semibold text-slate-900 bg-slate-100' : 'hover:text-slate-900'}`}
            >
              RU
            </button>
          </div>
          <a
            href="#trial"
            className="inline-flex items-center justify-center px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800"
          >
            {t('nav.startTrial')}
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
      {open && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-4">
          <a href="#problem" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.problem')}</a>
          <a href="#solution" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.solution')}</a>
          <a href="#features" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.features')}</a>
          <a href="#pricing" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.pricing')}</a>
          <a href="#faq" className="block text-slate-600 hover:text-slate-900" onClick={() => setOpen(false)}>{t('nav.faq')}</a>
          <div className="flex gap-2">
            <button onClick={() => setLocale('en')} className={`px-2 py-1 text-sm rounded ${locale === 'en' ? 'font-semibold bg-slate-100' : ''}`}>EN</button>
            <button onClick={() => setLocale('ru')} className={`px-2 py-1 text-sm rounded ${locale === 'ru' ? 'font-semibold bg-slate-100' : ''}`}>RU</button>
          </div>
          <a href="#trial" className="block text-center py-2 bg-slate-900 text-white rounded-lg font-medium" onClick={() => setOpen(false)}>{t('nav.startTrial')}</a>
        </div>
      )}
    </header>
  );
}
