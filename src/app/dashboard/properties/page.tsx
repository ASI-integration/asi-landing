'use client';

import { useTranslation } from '@/i18n/useTranslation';

export default function PropertiesPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {t('dashboard.sidebar.properties')}
        </h1>
        <p className="mt-1 text-slate-600">
          {t('dashboard.propertiesSubtitle')}
        </p>
      </header>
      <div className="bg-white rounded-lg shadow-sm p-10 text-center">
        <p className="text-slate-500 text-sm">
          Объекты появятся здесь после подключения PMS или Channel Manager.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Вернитесь на главную страницу дашборда, чтобы запросить подключение.
        </p>
      </div>
    </div>
  );
}
