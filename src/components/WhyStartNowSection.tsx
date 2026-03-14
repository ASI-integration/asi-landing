'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function WhyStartNowSection() {
  const { t, get } = useTranslation();
  const listItems = get<string[]>('whyStartNow.listItems') ?? [];

  return (
    <section id="why-start-now" className="py-20 px-4 sm:px-6 lg:px-8 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('whyStartNow.title')}
        </h2>

        <div className="mt-6 space-y-3">
          <p className="text-slate-600">
            {t('whyStartNow.intro1')}
          </p>
          <p className="text-slate-600">
            {t('whyStartNow.intro2')}
          </p>
          <p className="text-slate-600">
            {t('whyStartNow.intro3')}
          </p>
        </div>

        <div className="mt-10 p-6 bg-white rounded-xl border border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">
            {t('whyStartNow.listTitle')}
          </h3>
          <ul className="mt-4 space-y-2 text-slate-600 text-sm">
            {listItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-emerald-600 mt-0.5">•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 text-slate-600 border-l-4 border-slate-300 pl-4 py-2 bg-white/80 rounded-r">
          {t('whyStartNow.final')}
        </p>
      </div>
    </section>
  );
}
