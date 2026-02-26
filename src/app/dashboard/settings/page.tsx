'use client';

import { useTranslation } from '@/i18n/useTranslation';

export default function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {t('dashboard.sidebar.settings')}
        </h1>
        <p className="mt-1 text-slate-600">
          {t('dashboard.settingsSubtitle')}
        </p>
      </header>
      <div className="bg-white rounded-lg shadow-sm p-6">
        <p className="text-slate-500">Settings coming soon.</p>
      </div>
    </div>
  );
}
