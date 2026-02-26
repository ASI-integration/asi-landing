'use client';

import Link from 'next/link';
import { useTranslation } from '@/i18n/useTranslation';

export function FinalCTA() {
  const { t } = useTranslation();

  return (
    <section id="trial" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('finalCta.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          {t('finalCta.subtitle')}
        </p>
        <Link
          href="/signup"
          className="mt-8 inline-flex items-center justify-center px-8 py-4 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800"
        >
          {t('finalCta.button')}
        </Link>
      </div>
    </section>
  );
}
