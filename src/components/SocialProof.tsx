'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function SocialProof() {
  const { t, get } = useTranslation();
  const logos = get<string[]>('socialProof.logos') ?? [];
  const testimonials = get<{ quote: string; author: string; role: string }[]>('socialProof.testimonials') ?? [];

  return (
    <section className="py-20 px-4 sm:px-6 lg:px-8 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 text-center">
          {t('socialProof.title')}
        </h2>
        <div className="mt-12 flex flex-wrap justify-center gap-8">
          {logos.map((name, i) => (
            <div
              key={i}
              className="px-6 py-3 bg-white rounded-lg border border-slate-200 text-slate-500 font-medium text-sm"
            >
              {name}
            </div>
          ))}
        </div>
        <div className="mt-16 grid sm:grid-cols-2 gap-8">
          {testimonials.map((t, i) => (
            <blockquote key={i} className="p-6 bg-white rounded-xl border border-slate-200">
              <p className="text-slate-700">"{t.quote}"</p>
              <footer className="mt-4">
                <cite className="font-semibold text-slate-900 not-italic">{t.author}</cite>
                <span className="text-slate-500 text-sm"> — {t.role}</span>
              </footer>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}
