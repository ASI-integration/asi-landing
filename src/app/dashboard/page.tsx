'use client';

import { useTranslation } from '@/i18n/useTranslation';

export default function DashboardPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {t('dashboard.overview.title')}
        </h1>
        <p className="mt-1 text-slate-600">
          {t('dashboard.overview.subtitle')}
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <p className="text-sm font-medium text-slate-500">
            {t('dashboard.overview.kpi1')}
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">3</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-6">
          <p className="text-sm font-medium text-slate-500">
            {t('dashboard.overview.kpi2')}
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">12</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-6">
          <p className="text-sm font-medium text-slate-500">
            {t('dashboard.overview.kpi3')}
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">47</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('dashboard.overview.activityTitle')}
        </h2>
        <ul className="mt-4 space-y-3">
          <li className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span className="text-slate-700">{t('dashboard.overview.activity1')}</span>
          </li>
          <li className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span className="text-slate-700">{t('dashboard.overview.activity2')}</span>
          </li>
          <li className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span className="text-slate-700">{t('dashboard.overview.activity3')}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
