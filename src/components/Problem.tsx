'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function Problem() {
  const { t, get } = useTranslation();
  const pains = get<{ title: string; desc: string }[]>('problem.pains') ?? [];

  return (
    <section id="problem" className="py-20 px-4 sm:px-6 lg:px-8 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('problem.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          {t('problem.subtitle')}
        </p>
        <div className="mt-12 space-y-8">
          {pains.map((p, i) => (
            <div key={i} className="flex gap-4">
              <span className="flex-shrink-0 w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-semibold">
                {i + 1}
              </span>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{p.title}</h3>
                <p className="mt-1 text-slate-600">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
