'use client';

import { useTranslation } from '@/i18n/useTranslation';
import { productSupportEmail } from '@/config/contact';
import { useSession } from '@/contexts/SessionContext';

function formatDateRu(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { year: 'numeric', month: 'short', day: 'numeric' });
}

function planLabel(plan: string | null | undefined) {
  if (plan === 'small') return 'Базовый';
  if (plan === 'growth') return 'Масштабирование';
  if (plan === 'enterprise') return 'Крупный портфель';
  return '—';
}

function subscriptionStatusLabel(status: string | null | undefined) {
  if (status === 'trialing') return 'Пробный период';
  if (status === 'active') return 'Активна';
  if (status === 'inactive' || status === 'canceled' || status === 'cancelled') return 'Неактивна';
  if (status) return status;
  return '—';
}

const pmsItems = [
  { name: 'Bnovo', status: 'soon' as const },
  { name: 'TravelLine', status: 'soon' as const },
  { name: 'RealtyCalendar', status: 'soon' as const },
  { name: 'Другая система', status: 'request' as const },
] as const;

export default function DashboardPage() {
  const { t } = useTranslation();
  const { session } = useSession();
  const account = session?.account ?? null;

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
          <p className="text-sm font-medium text-slate-500">Рабочее пространство</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">
            {account?.name ?? '—'}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-6">
          <p className="text-sm font-medium text-slate-500">Тариф</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">
            {planLabel(account?.plan_code)}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-6">
          <p className="text-sm font-medium text-slate-500">Тестовый период</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">
            до {formatDateRu(account?.trial_ends_at ?? null)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Статус: {subscriptionStatusLabel(account?.subscription_status)}
          </p>
        </div>
      </div>

      {/* PMS / Channel Manager connection */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Подключить PMS / Channel Manager
        </h2>
        <p className="mt-1 text-sm text-slate-600 max-w-2xl">
          Подключите систему, через которую вы уже управляете бронированиями, доступностью и тарифами. ASI будет использовать её как основной источник данных.
        </p>

        <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {pmsItems.map((item) => (
            item.status === 'request' ? (
              <a
                key={item.name}
                href={`mailto:${productSupportEmail}?subject=${encodeURIComponent('Запрос на подключение PMS / Channel Manager')}`}
                className="group rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:bg-slate-50 transition-all"
              >
                <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                <span className="mt-2 inline-block text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  По запросу
                </span>
                <p className="mt-2 text-xs text-slate-500 group-hover:text-slate-700">Напишите нам</p>
              </a>
            ) : (
              <div
                key={item.name}
                className="rounded-xl border border-slate-100 p-4 bg-slate-50 cursor-default"
              >
                <p className="text-sm font-semibold text-slate-500">{item.name}</p>
                <span className="mt-2 inline-block text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                  Скоро
                </span>
              </div>
            )
          ))}
        </div>

        <p className="mt-4 text-xs text-slate-500">
          После подключения система сможет подтянуть объекты и данные бронирований автоматически.
        </p>
      </div>

      {/* Activity placeholder */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('dashboard.overview.activityTitle')}
        </h2>
        <div className="mt-4 py-8 text-center">
          <p className="text-sm text-slate-400">
            Активность появится здесь после подключения PMS или Channel Manager.
          </p>
        </div>
      </div>
    </div>
  );
}
