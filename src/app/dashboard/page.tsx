'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { productSupportEmail } from '@/config/contact';
import { useSession } from '@/contexts/SessionContext';
import type { PilotRolloutMetrics } from '@/lib/crm/pilot-rollout';
import { readResponseJson } from '@/lib/safeResponseJson';

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

const modules = [
  {
    title: 'Коммуникации',
    href: '/dashboard/communication',
    status: 'настройка',
    description: 'Сообщения гостей, заявки и ответы оператора в одном месте.',
  },
  {
    title: 'Операции',
    href: '/dashboard/ops',
    status: 'в кабинете',
    description: 'Заезды, задачи, уборка и готовность объектов к заселению.',
  },
  {
    title: 'Подключения каналов',
    href: '/dashboard/channel-connections',
    status: 'первый шаг',
    description: 'Свяжите ASI с RealtyCalendar, Bnovo, TravelLine или другой системой.',
  },
  {
    title: 'Аналитика локации',
    href: '/dashboard/reports',
    status: 'в подписке',
    description: 'Оценка адресов и сохранённые выводы по объектам внутри ASI.',
  },
] as const;

export default function DashboardPage() {
  const { session } = useSession();
  const account = session?.account ?? null;
  const isCrmOperator = session?.isCrmOperator === true;
  const [pilotMetrics, setPilotMetrics] = useState<PilotRolloutMetrics | null>(null);

  useEffect(() => {
    if (!isCrmOperator) return;
    void (async () => {
      try {
        const res = await fetch('/api/dashboard/crm/pilot-summary', { credentials: 'include' });
        const data = await readResponseJson(res, { ok: false, metrics: null });
        if (res.ok && data.ok && data.metrics) {
          setPilotMetrics(data.metrics);
        }
      } catch {
        // Блок пилота не блокирует обзор кабинета.
      }
    })();
  }, [isCrmOperator]);

  const trialEnds = account?.trial_ends_at ?? null;
  const subStatus = subscriptionStatusLabel(account?.subscription_status);

  return (
    <div className="space-y-8 max-w-6xl">

      {/* Block 1 — Состояние аккаунта */}
      <section>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">ASI-кабинет</h1>
        <p className="mt-1.5 max-w-3xl text-lg text-slate-500">
          Один центр для управления объектами: сообщения, операции, каналы бронирования и аналитика локации.
        </p>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-sm text-slate-500">Рабочее пространство</p>
            <p className="mt-2 text-lg font-semibold text-slate-900 leading-snug">
              {account?.name ?? '—'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-sm text-slate-500">Подписка</p>
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
              Единый кабинет
            </p>
          </div>
        </div>
      </section>

      {isCrmOperator && pilotMetrics ? (
        <section className="rounded-xl border border-slate-200 bg-white p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Пилот</h2>
              <p className="mt-2 text-base text-slate-600 max-w-2xl leading-relaxed">
                Контроль постепенного запуска: активные подключения, очередь и объекты на настройке.
              </p>
            </div>
            <Link
              href="/dashboard/crm"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Открыть CRM
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-5 py-4">
              <p className="text-sm text-slate-500">Активных пилотников</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {pilotMetrics.activePilots} / {pilotMetrics.limit}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-5 py-4">
              <p className="text-sm text-slate-500">В листе ожидания</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{pilotMetrics.waitlist}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-5 py-4">
              <p className="text-sm text-slate-500">На настройке объекта</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{pilotMetrics.onboarding}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-5 py-4">
              <p className="text-sm text-slate-500">Требуют внимания</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{pilotMetrics.needsAttention}</p>
            </div>
          </div>
        </section>
      ) : null}

      {/* Block 2 — Модули */}
      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-2xl font-bold text-slate-900">Модули ASI</h2>
        <p className="mt-2 text-base text-slate-600 max-w-2xl leading-relaxed">
          Все разделы входят в рабочий кабинет по подписке. Подключите объекты и ведите ежедневную работу из ASI.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {modules.map((module) => (
            <Link
              key={module.title}
              href={module.href}
              className="group flex min-h-[168px] flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-5 transition-colors hover:border-slate-300 hover:bg-white"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-xl font-bold text-slate-900">{module.title}</h3>
                  <span className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-600">
                    {module.status}
                  </span>
                </div>
                <p className="mt-3 text-base leading-relaxed text-slate-600">{module.description}</p>
              </div>
              <span className="mt-5 text-sm font-semibold text-slate-900 group-hover:text-blue-700">
                Открыть раздел
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-5 text-sm text-slate-500 leading-relaxed">
          Аналитика локации здесь — часть кабинета для работы с объектами, а не отдельный публичный продукт.
        </p>
      </section>

      {/* Block 3 — Как это связано */}
      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Как работает кабинет</h2>
        <p className="mt-1 text-sm text-slate-500">
          ASI собирает данные по объектам и помогает быстрее принимать решения в ежедневной работе.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-5 py-4">
            <p className="text-base font-semibold text-slate-900">1. Подключите каналы</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              ASI увидит объекты, брони, даты и занятость.
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-5 py-4">
            <p className="text-base font-semibold text-slate-900">2. Ведите работу</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Сообщения, задачи и операционные события остаются в одном кабинете.
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-5 py-4">
            <p className="text-base font-semibold text-slate-900">3. Смотрите аналитику</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Проверяйте адреса и храните выводы по объектам внутри подписки.
            </p>
          </div>
        </div>
      </section>

      {/* Block 4 — Следующий шаг */}
      <section className="bg-slate-900 rounded-xl p-7">
        <p className="text-sm font-medium text-slate-400 uppercase tracking-widest">Следующий шаг</p>
        <h2 className="mt-2 text-2xl font-bold text-white">
          Подключите каналы бронирования
        </h2>
        <p className="mt-2 text-base text-slate-300 leading-relaxed max-w-lg">
          Это поможет ASI подтянуть объекты и бронирования. После этого кабинет станет рабочим центром для сообщений,
          операций, каналов и аналитики локации.
        </p>
        <div className="mt-6">
          <Link
            href="/dashboard/channel-connections"
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
