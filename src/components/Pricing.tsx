'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function Pricing() {
  const { t, get } = useTranslation();
  const plans = get<{ name: string; desc: string; features: string[] }[]>('pricing.plans') ?? [];

  return (
    <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 text-center">
          {t('pricing.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600 text-center">
          {t('pricing.subtitle')}
        </p>
        <div className="mt-12 grid sm:grid-cols-3 gap-6">
          {plans.map((p, i) => (
            <div
              key={i}
              className={`p-6 rounded-xl border ${
                i === 1 ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'
              }`}
            >
              <span className="inline-block px-3 py-1 bg-slate-900 text-white text-xs font-medium rounded-full">
                {t('pricing.trialBadge')}
              </span>
              <h3 className="mt-4 text-xl font-semibold text-slate-900">{p.name}</h3>
              <p className="mt-2 text-slate-600">{p.desc}</p>
              <ul className="mt-6 space-y-3">
                {p.features.map((f, j) => (
                  <li key={j} className="flex items-center gap-2 text-slate-700">
                    <span className="text-slate-600">✓</span> {f}
                  </li>
                ))}
              </ul>
              <a
                href="#trial"
                className={`mt-6 block text-center py-3 rounded-lg font-medium ${
                  i === 1
                    ? 'bg-slate-900 text-white hover:bg-slate-800'
                    : 'border border-slate-900 text-slate-900 hover:bg-slate-50'
                }`}
              >
                {t('pricing.startTrial')}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
