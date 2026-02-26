'use client';

import Link from 'next/link';
import { useTranslation } from '@/i18n/useTranslation';

export function Pricing() {
  const { t } = useTranslation();

  return (
    <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 text-center">
          {t('pricing.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600 text-center">
          {t('pricing.subtitle')}
        </p>
        <p className="mt-6 text-center text-slate-600 max-w-2xl mx-auto">
          {t('pricing.valueFraming')}
        </p>
        <p className="mt-2 text-center text-sm text-slate-500 max-w-2xl mx-auto">
          {t('pricing.valueFramingSecondary')}
        </p>
        <p className="mt-3 text-center text-sm text-slate-500 font-medium">
          {t('pricing.comparisonNote')}
        </p>
        <div className="mt-12 grid sm:grid-cols-3 gap-6">
          <div className="p-6 rounded-xl border border-slate-200 bg-white">
            <span className="inline-block px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-medium rounded-full">
              🟢 {t('pricing.smallPlan')}
            </span>
            <p className="mt-4 text-xl font-semibold text-slate-900">
              {t('pricing.smallPrice')}
            </p>
            <ul className="mt-4 space-y-2 text-slate-600 text-sm">
              <li>✓ {t('pricing.smallFeature1')}</li>
              <li>✓ {t('pricing.smallFeature2')}</li>
            </ul>
            <p className="mt-4 text-xs text-slate-500">
              {t('pricing.pricePerObjectNote')}
            </p>
            <Link
              href="/signup"
              className="mt-6 block text-center py-3 rounded-lg font-medium border border-slate-900 text-slate-900 hover:bg-slate-50"
            >
              {t('pricing.startTrial')}
            </Link>
          </div>
          <div className="p-6 rounded-xl border border-slate-900 bg-slate-50">
            <span className="inline-block px-3 py-1 bg-amber-100 text-amber-800 text-xs font-medium rounded-full">
              🟡 {t('pricing.growthPlan')}
            </span>
            <p className="mt-4 text-xl font-semibold text-slate-900">
              {t('pricing.growthPrice')}
            </p>
            <ul className="mt-4 space-y-2 text-slate-600 text-sm">
              <li>✓ {t('pricing.growthFeature1')}</li>
              <li>✓ {t('pricing.growthFeature2')}</li>
            </ul>
            <p className="mt-4 text-xs text-slate-500">
              {t('pricing.pricePerObjectNote')}
            </p>
            <Link
              href="/signup"
              className="mt-6 block text-center py-3 rounded-lg font-medium bg-slate-900 text-white hover:bg-slate-800"
            >
              {t('pricing.startTrial')}
            </Link>
          </div>
          <div className="p-6 rounded-xl border border-slate-200 bg-white">
            <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
              🔵 {t('pricing.enterprisePlan')}
            </span>
            <p className="mt-4 text-xl font-semibold text-slate-900">
              {t('pricing.enterprisePrice')}
            </p>
            <ul className="mt-4 space-y-2 text-slate-600 text-sm">
              <li>✓ {t('pricing.enterpriseFeature')}</li>
            </ul>
            <p className="mt-4 text-xs text-slate-500">
              {t('pricing.pricePerObjectNote')}
            </p>
            <Link
              href="/signup"
              className="mt-6 block text-center py-3 rounded-lg font-medium border border-slate-900 text-slate-900 hover:bg-slate-50"
            >
              {t('pricing.startTrial')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
