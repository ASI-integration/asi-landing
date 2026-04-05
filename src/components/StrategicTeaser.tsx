'use client';

import Link from 'next/link';
import { useTranslation } from '@/i18n/useTranslation';
import type { Locale } from '@/i18n/useTranslation';

const COPY: Record<Locale, any> = {
  en: {
    teaserTitle: "Strategic Participation",
    teaserSubtitle: "If you are interested in early access to the AI platform for short-term rental operations automation, you can request a project review and discuss possible participation formats.",
    teaserCta: "Discuss participation",
  },
  ru: {
    teaserTitle: "Стратегическое участие",
    teaserSubtitle: "Если вам интересен ранний доступ к AI-платформе для автоматизации short-term rental operations, можно запросить обзор проекта и обсудить возможный формат участия.",
    teaserCta: "Обсудить участие",
  }
};

export function StrategicTeaser() {
  const { locale } = useTranslation();
  const t = COPY[locale] || COPY['en'];

  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8 bg-slate-900 border-t border-slate-800">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
          {t.teaserTitle}
        </h2>
        <p className="mt-6 text-lg sm:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
          {t.teaserSubtitle}
        </p>
        <Link
          href="/strategic-partnerships"
          className="mt-10 inline-flex items-center justify-center px-8 py-4 bg-white text-slate-900 font-semibold rounded-xl hover:bg-slate-100 transition-all duration-300 shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20 hover:scale-[1.02]"
        >
          {t.teaserCta}
        </Link>
      </div>
    </section>
  );
}
