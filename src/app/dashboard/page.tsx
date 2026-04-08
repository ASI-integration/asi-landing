'use client';

import { useTranslation } from '@/i18n/useTranslation';
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
            Статус: {account?.subscription_status ?? '—'}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          Подключить каналы
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Минимальный старт: подключите 1 канал — Telegram, Email или VK.
        </p>

        <div className="mt-5 grid sm:grid-cols-3 gap-4">
          <a
            href="https://t.me/ASI_core_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-slate-200 p-4 hover:border-slate-400 hover:bg-slate-50 transition-all"
          >
            <p className="text-sm font-semibold text-slate-900">Telegram</p>
            <p className="mt-1 text-xs text-slate-600">Открыть бота и начать подключение.</p>
            <p className="mt-3 text-xs text-slate-500 group-hover:text-slate-700">t.me/ASI_core_bot</p>
          </a>
          <a
            href="mailto:support@asi-global.ru?subject=Подключение%20Email%20канала"
            className="group rounded-xl border border-slate-200 p-4 hover:border-slate-400 hover:bg-slate-50 transition-all"
          >
            <p className="text-sm font-semibold text-slate-900">Email</p>
            <p className="mt-1 text-xs text-slate-600">Запросить подключение Email‑канала.</p>
            <p className="mt-3 text-xs text-slate-500 group-hover:text-slate-700">support@asi-global.ru</p>
          </a>
          <a
            href="mailto:support@asi-global.ru?subject=Подключение%20VK%20канала"
            className="group rounded-xl border border-slate-200 p-4 hover:border-slate-400 hover:bg-slate-50 transition-all"
          >
            <p className="text-sm font-semibold text-slate-900">VK</p>
            <p className="mt-1 text-xs text-slate-600">Запросить подключение VK‑канала.</p>
            <p className="mt-3 text-xs text-slate-500 group-hover:text-slate-700">support@asi-global.ru</p>
          </a>
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
