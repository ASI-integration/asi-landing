'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function FAQ() {
  const { t, get } = useTranslation();
  const faqs = get<{ q: string; a: string }[]>('faq.items') ?? [];

  return (
    <section id="faq" className="py-20 px-4 sm:px-6 lg:px-8 bg-slate-50">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('faq.title')}
        </h2>
        <dl className="mt-12 space-y-8">
          {faqs.map((faq, i) => (
            <div key={i}>
              <dt className="text-lg font-semibold text-slate-900">{faq.q}</dt>
              <dd className="mt-2 text-slate-600">{faq.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
