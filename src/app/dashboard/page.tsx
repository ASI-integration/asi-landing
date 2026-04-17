'use client';

import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { useSession } from '@/contexts/SessionContext';

function formatDateRu(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
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
  { name: 'RealtyCalendar', status: 'soon' as const },
  { name: 'Bnovo', status: 'soon' as const },
  { name: 'TravelLine', status: 'soon' as const },
  { name: 'Другая система', status: 'request' as const },
] as const;

const contours = [
  { label: 'Коммуникация', status: 'requires' as const },
  { label: 'Данные / бронирования', status: 'requires' as const },
  { label: 'Автоматизация', status: 'soon' as const },
  { label: 'Платежи', status: 'soon' as const },
] as const;

function ContourStatus({ status }: { status: 'active' | 'requires' | 'soon' }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
        активно
      </span>
    );
  }
  if (status === 'requires') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-amber-700">
        <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
        требует настройки
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
      <span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />
      скоро
    </span>
  );
}

export default function DashboardPage() {
  const { session } = useSession();
  const account = session?.account ?? null;

  const trialEnds = account?.trial_ends_at ?? null;
  const subStatus = subscriptionStatusLabel(account?.subscription_status);

  return (
    <div className="space-y-8 max-w-4xl">

      {/* Block 1 — Состояние аккаунта */}
      <section>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Обзор</h1>
        <p className="mt-1.5 text-lg text-slate-500">Состояние системы и следующий шаг</p>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-sm text-slate-500">Рабочее пространство</p>
            <p className="mt-2 text-lg font-semibold text-slate-900 leading-snug">
              {account?.name ?? '—'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-sm text-slate-500">Тариф</p>
            <p className="mt-2 text-lg font-semibold text-slate-900 leading-snug">
              {planLabel(account?.plan_code)}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-sm text-slate-500">Доступ</p>
            <p className="mt-2 text-lg font-semibold text-slate-900 leading-snug">
              {subStatus}
            </p>
            {trialEnds && (
              <p className="mt-1 text-sm text-slate-400">до {formatDateRu(trialEnds)}</p>
            )}
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-sm text-slate-500">Статус системы</p>
            <p className="mt-2 text-lg font-semibold text-slate-900 leading-snug">
              Начальная настройка
            </p>
          </div>
        </div>
      </section>

      {/* Block 2 — Источник данных */}
      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-2xl font-bold text-slate-900">Подключить менеджер каналов</h2>
        <p className="mt-2 text-base text-slate-600 max-w-2xl leading-relaxed">
          Подключите систему, через которую вы уже управляете бронированиями, доступностью и
          тарифами. ASI будет использовать её как основной источник данных.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {pmsItems.map((item) =>
            item.status === 'request' ? (
              <a
                key={item.name}
                href={`mailto:${productSupportEmail}?subject=${encodeURIComponent('Запрос на подключение PMS / Channel Manager')}`}
                className="group flex items-center justify-between rounded-xl border border-slate-200 px-6 py-4 hover:border-slate-300 hover:bg-slate-50 transition-all"
              >
                <span className="text-lg font-medium text-slate-900">{item.name}</span>
                <span className="text-sm px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 group-hover:bg-blue-100 transition-colors">
                  По запросу — написать нам
                </span>
              </a>
            ) : (
              <div
                key={item.name}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-6 py-4 cursor-default"
              >
                <span className="text-lg font-medium text-slate-500">{item.name}</span>
                <span className="text-sm px-3 py-1 rounded-full bg-slate-100 text-slate-400 border border-slate-200">
                  Скоро
                </span>
              </div>
            )
          )}
        </div>

        <p className="mt-5 text-sm text-slate-400 leading-relaxed">
          После подключения система сможет подтянуть объекты и данные бронирований автоматически.
        </p>
      </section>

      {/* Block 3 — Статус контуров */}
      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Статус контуров</h2>
        <p className="mt-1 text-sm text-slate-500">Что сейчас работает и что ещё предстоит настроить</p>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {contours.map(({ label, status }) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-lg border border-slate-100 px-5 py-4 bg-slate-50"
            >
              <span className="text-base font-medium text-slate-700">{label}</span>
              <ContourStatus status={status} />
            </div>
          ))}
        </div>
      </section>

      {/* Block 4 — Следующий шаг */}
      <section className="bg-slate-900 rounded-xl p-7">
        <p className="text-sm font-medium text-slate-400 uppercase tracking-widest">Следующий шаг</p>
        <h2 className="mt-2 text-2xl font-bold text-white">
          Подключить менеджер каналов
        </h2>
        <p className="mt-2 text-base text-slate-300 leading-relaxed max-w-lg">
          Это первое действие, которое откроет остальные разделы системы. Пока источник данных не
          подключён, объекты, бронирования и автоматизация недоступны.
        </p>
        <div className="mt-6">
          <Link
            href="/dashboard/data-source"
            className="inline-flex items-center px-6 py-3 rounded-lg bg-white text-slate-900 text-base font-semibold hover:bg-slate-100 transition-colors"
          >
            Перейти к подключению
          </Link>
          <p className="mt-4 text-sm text-slate-500">
            Нет вашей системы?{' '}
            <a
              href={`mailto:${productSupportEmail}?subject=${encodeURIComponent('Запрос на подключение PMS / Channel Manager')}`}
              className="text-slate-300 underline hover:text-white transition-colors"
            >
              Напишите нам
            </a>
          </p>
        </div>
      </section>

    </div>
  );
}
