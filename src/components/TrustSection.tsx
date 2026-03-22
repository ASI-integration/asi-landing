'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function TrustSection() {
  const { t, get } = useTranslation();
  const items = get<{ q: string; a: string }[]>('trust.items') ?? [];

  return (
    <section id="trust" className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('trust.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          {t('trust.subtitle')}
        </p>
        <div className="mt-12 space-y-6">
          {items.map((item, i) => (
            <div key={i} className="border-l-4 border-slate-200 pl-6 py-1">
              <h3 className="text-base font-semibold text-slate-900">{item.q}</h3>
              <p className="mt-2 text-slate-600">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
