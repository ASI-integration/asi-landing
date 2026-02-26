'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function DemoSection() {
  const { t } = useTranslation();

  return (
    <section id="demo" className="py-20 px-4 sm:px-6 lg:px-8 bg-slate-50">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('demo.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          {t('demo.subtitle')}
        </p>
        <a
          href="#"
          className="mt-10 inline-flex items-center justify-center px-10 py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl hover:bg-slate-800 transition-all duration-300 shadow-lg"
        >
          {t('demo.button')}
        </a>
      </div>
    </section>
  );
}
