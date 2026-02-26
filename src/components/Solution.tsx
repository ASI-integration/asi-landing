'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function Solution() {
  const { t } = useTranslation();

  return (
    <section id="solution" className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('solution.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          {t('solution.desc')}
        </p>
        <div className="mt-12 p-8 bg-slate-900 text-white rounded-2xl">
          <p className="text-xl font-medium">
            {t('solution.highlight')}
          </p>
        </div>
      </div>
    </section>
  );
}
