'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function HowItWorks() {
  const { t, get } = useTranslation();
  const steps = get<{ title: string; desc: string }[]>('howItWorks.steps') ?? [];

  return (
    <section className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('howItWorks.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          {t('howItWorks.subtitle')}
        </p>
        <div className="mt-12 space-y-8">
          {steps.map((s, i) => (
            <div key={i} className="flex gap-6">
              <span className="flex-shrink-0 w-14 h-14 rounded-full bg-slate-900 text-white flex items-center justify-center text-xl font-bold">
                {i + 1}
              </span>
              <div>
                <h3 className="text-xl font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-slate-600">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
