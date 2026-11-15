'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { ExceptionOnlySummary } from '@/components/booking-ops/ExceptionOnlySummary';
import { readResponseJson } from '@/lib/safeResponseJson';

type WorkspaceResponse = {
  ok?: boolean;
  workspace?: {
    onboarding?: { pilot_activated_at?: string | null };
    progress?: { percentage?: number };
    operationalReadiness?: { ready?: boolean; blockers?: string[] };
  } | null;
};

type WorkspaceState = 'loading' | 'needs_setup' | 'needs_review' | 'pilot_active' | 'unavailable';

function Status({ state }: { state: WorkspaceState }) {
  const copy: Record<WorkspaceState, { title: string; detail: string }> = {
    loading: { title: 'Проверяем подключение', detail: 'Получаем актуальное состояние рабочего пространства.' },
    needs_setup: { title: 'Нужно заполнить данные', detail: 'ASI ещё не получил всю исходную информацию для запуска.' },
    needs_review: { title: 'Настройка или проверка', detail: 'Подключения и необходимые разрешения ещё не подтверждены.' },
    pilot_active: { title: 'Пилот активирован', detail: 'Проверяйте события и исключения. Запуск отдельных интеграций зависит от их готовности.' },
    unavailable: { title: 'Статус недоступен', detail: 'Это не подтверждение готовности системы. Повторите проверку позже.' },
  };
  return (
    <div role="status" className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-medium text-slate-500">Состояние ASI</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{copy[state].title}</p>
      <p className="mt-1 text-sm text-slate-600">{copy[state].detail}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { session, loading: sessionLoading } = useSession();
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>('loading');
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session?.user) {
      setWorkspaceState('unavailable');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/dashboard/ops-v17', { credentials: 'include', cache: 'no-store' });
        const payload = await readResponseJson<WorkspaceResponse>(response, { ok: false });
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          setWorkspaceState('unavailable');
          return;
        }
        const w = payload.workspace;
        if (!w) {
          setWorkspaceState('needs_setup');
          setProgress(0);
          return;
        }
        const pct = w.progress?.percentage;
        setProgress(typeof pct === 'number' && Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null);
        setWorkspaceState(
          w.onboarding?.pilot_activated_at && w.operationalReadiness?.ready
            ? 'pilot_active' : 'needs_review',
        );
      } catch {
        if (!cancelled) setWorkspaceState('unavailable');
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user, sessionLoading]);

  const isCrmOperator = session?.isCrmOperator === true;
  return (
    <main className="mx-auto max-w-6xl space-y-7">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">ASI · Автоматизация управления объектами</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">Ваши объекты под контролем ASI</h1>
        <p className="mt-2 max-w-3xl text-base leading-relaxed text-slate-600">
          Вы предоставляете данные и правила работы. ASI выполняет доступные автоматические операции,
          отслеживает события и передаёт вам вопросы, которые требуют решения.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Status state={workspaceState} />
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-medium text-slate-500">Подготовка данных</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">
            {progress === null ? 'Пока нет подтверждённых сведений' : `${progress}% анкеты заполнено`}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            После первоначального заполнения данные можно дополнять и исправлять.
            Изменения действующих подключений проходят отдельную проверку.
          </p>
        </div>
      </div>

      {isCrmOperator ? <ExceptionOnlySummary enabled /> : null}

      <section aria-labelledby="main-actions-title">
        <h2 id="main-actions-title" className="text-xl font-semibold text-slate-900">Что можно сделать</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Link href="/dashboard/data"
            className="group rounded-xl border border-slate-200 bg-white p-6 hover:border-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
            <span className="text-sm font-semibold text-blue-700">01 · Данные и изменения</span>
            <h3 className="mt-3 text-xl font-semibold text-slate-900">Заполнить или обновить</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">Компания, объекты, адреса, правила, заезд и выезд. Вернуться к данным можно в любое время.</p>
            <p className="mt-4 text-sm font-semibold text-blue-700 group-hover:underline">Открыть данные</p>
          </Link>
          <Link href="/dashboard/channel-connections"
            className="group rounded-xl border border-slate-200 bg-white p-6 hover:border-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
            <span className="text-sm font-semibold text-blue-700">02 · Подключения</span>
            <h3 className="mt-3 text-xl font-semibold text-slate-900">Подключить источники</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">Выберите менеджер каналов. ASI покажет, какие интеграции уже готовы, а какие ещё настраиваются.</p>
            <p className="mt-4 text-sm font-semibold text-blue-700 group-hover:underline">Открыть подключения</p>
          </Link>
          <Link href="/dashboard/communication"
            className="group rounded-xl border border-slate-200 bg-white p-6 hover:border-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
            <span className="text-sm font-semibold text-blue-700">03 · Исключения и корректировки</span>
            <h3 className="mt-3 text-xl font-semibold text-slate-900">Посмотреть важное</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">Ошибки, вопросы, сообщения и случаи, в которых нужно ваше решение вместо автоматического действия.</p>
            <p className="mt-4 text-sm font-semibold text-blue-700 group-hover:underline">Открыть обращения</p>
          </Link>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-xl font-semibold text-slate-900">Что ASI делает автоматически</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          После проверки источников, правил и разрешений ASI сможет обрабатывать новые брони,
          готовить сообщения и задания, контролировать сроки, доступность и этапы заселения.
          Фактически работающие функции зависят от подключённых каналов и подтверждённой готовности.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/dashboard/reservations" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100">Календарь</Link>
          <Link href="/dashboard/reports" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100">Аналитика</Link>
          {isCrmOperator ? <Link href="/dashboard/bookings-simple" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100">Бронирования</Link> : null}
        </div>
      </section>
    </main>
  );
}
