'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function Features() {
  const { t, get } = useTranslation();
  const features = get<{ icon?: string; title: string; desc: string }[]>('features.items') ?? [];

  return (
    <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('features.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          {t('features.subtitle')}
        </p>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div
              key={i}
              className="p-6 bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
            >
              <span className="text-2xl">{f.icon ?? '•'}</span>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-slate-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
