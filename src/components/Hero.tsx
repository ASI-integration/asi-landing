'use client';

import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

export function Hero() {
  const [email, setEmail] = useState('');
  const { t } = useTranslation();

  return (
    <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto text-center">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight leading-tight">
          {t('hero.headline')}
        </h1>
        <p className="mt-6 text-xl sm:text-2xl text-slate-600 max-w-2xl mx-auto">
          {t('hero.subheadline')}
        </p>
        <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="#trial"
            className="inline-flex items-center justify-center px-8 py-4 bg-slate-900 text-white text-lg font-semibold rounded-lg hover:bg-slate-800 transition-colors"
          >
            {t('hero.ctaPrimary')}
          </a>
          <a
            href="#trial"
            className="inline-flex items-center justify-center px-8 py-4 border-2 border-slate-900 text-slate-900 text-lg font-semibold rounded-lg hover:bg-slate-50 transition-colors"
          >
            {t('hero.ctaSecondary')}
          </a>
        </div>
        <form
          onSubmit={(e) => e.preventDefault()}
          className="mt-12 max-w-md mx-auto flex flex-col sm:flex-row gap-3"
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('hero.emailPlaceholder')}
            className="flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
          <button
            type="submit"
            className="px-6 py-3 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800"
          >
            {t('hero.getStarted')}
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-500">{t('hero.trustCopy')}</p>
      </div>
    </section>
  );
}
