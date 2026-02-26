'use client';

import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

export function FinalCTA() {
  const [email, setEmail] = useState('');
  const { t } = useTranslation();

  return (
    <section id="trial" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('finalCta.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          {t('finalCta.subtitle')}
        </p>
        <form
          onSubmit={(e) => e.preventDefault()}
          className="mt-8 flex flex-col sm:flex-row gap-3"
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('finalCta.emailPlaceholder')}
            className="flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
          <button
            type="submit"
            className="px-8 py-3 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800"
          >
            {t('finalCta.button')}
          </button>
        </form>
      </div>
    </section>
  );
}
