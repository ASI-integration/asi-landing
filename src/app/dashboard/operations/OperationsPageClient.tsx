'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { readResponseJson } from '@/lib/safeResponseJson';
import {
  OPS_TASK_PRIORITY_LABELS,
  OPS_TASK_SOURCE_LABELS,
  OPS_TASK_STATUS_LABELS,
  OPS_TASK_STATUSES,
  OPS_TASK_TYPE_LABELS,
  type OpsOperatorTask,
  type OpsTaskStatus,
} from '@/lib/ops-board/types';

type TasksResponse = {
  ok: boolean;
  message?: string;
  tasks: OpsOperatorTask[];
  refreshedAt?: string;
};

const STATUS_TONE: Record<OpsTaskStatus, string> = {
  new: 'border-sky-200 bg-sky-50 text-sky-800',
  in_progress: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  waiting_owner: 'border-amber-200 bg-amber-50 text-amber-800',
  needs_operator: 'border-rose-200 bg-rose-50 text-rose-800',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  closed: 'border-slate-300 bg-slate-100 text-slate-700',
};

const PRIORITY_TONE: Record<OpsOperatorTask['priority'], string> = {
  normal: 'border-slate-200 bg-slate-50 text-slate-700',
  urgent: 'border-orange-200 bg-orange-50 text-orange-800',
  critical: 'border-rose-300 bg-rose-100 text-rose-900',
};

function formatWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TaskCard({
  task,
  updating,
  onStatus,
}: {
  task: OpsOperatorTask;
  updating: boolean;
  onStatus: (status: OpsTaskStatus) => void;
}) {
  const isClosed = task.taskStatus === 'done' || task.taskStatus === 'closed';

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">
          {OPS_TASK_TYPE_LABELS[task.taskType]}
        </span>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[task.taskStatus]}`}>
          {OPS_TASK_STATUS_LABELS[task.taskStatus]}
        </span>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${PRIORITY_TONE[task.priority]}`}>
          {OPS_TASK_PRIORITY_LABELS[task.priority]}
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
          {OPS_TASK_SOURCE_LABELS[task.source]}
        </span>
      </div>

      <div>
        <h3 className="text-base font-semibold text-slate-950">{task.title}</h3>
        {task.description ? <p className="mt-1 text-sm leading-6 text-slate-600">{task.description}</p> : null}
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-xs font-medium uppercase text-slate-400">Объект</dt>
          <dd className="mt-1 font-medium text-slate-800">{task.objectLabel || task.objectId || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-400">Владелец</dt>
          <dd className="mt-1 font-medium text-slate-800">{task.ownerName || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-400">Гость</dt>
          <dd className="mt-1 font-medium text-slate-800">{task.guestName || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-slate-400">Обновлено</dt>
          <dd className="mt-1 font-medium text-slate-800">{formatWhen(task.updatedAt)}</dd>
        </div>
      </dl>

      {task.lastEventText ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-medium uppercase text-slate-400">Последнее событие</p>
          <p className="mt-1 text-sm text-slate-700">{task.lastEventText}</p>
          <p className="mt-1 text-xs text-slate-500">{formatWhen(task.lastEventAt)}</p>
        </div>
      ) : null}

      {!isClosed ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            disabled={updating || task.taskStatus === 'in_progress'}
            onClick={() => onStatus('in_progress')}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
          >
            В работу
          </button>
          <button
            type="button"
            disabled={updating || task.taskStatus === 'waiting_owner'}
            onClick={() => onStatus('waiting_owner')}
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            Ждёт владельца
          </button>
          <button
            type="button"
            disabled={updating}
            onClick={() => onStatus('done')}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >
            Готово
          </button>
          <button
            type="button"
            disabled={updating}
            onClick={() => onStatus('closed')}
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-200 disabled:opacity-50"
          >
            Закрыть
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default function OperationsPageClient() {
  const [tasks, setTasks] = useState<OpsOperatorTask[]>([]);
  const [statusFilter, setStatusFilter] = useState<'open' | OpsTaskStatus | 'all'>('open');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const params = new URLSearchParams();
      params.set('status', statusFilter);
      if (urgentOnly) params.set('urgentOnly', '1');
      const res = await fetch(`/api/dashboard/operations/tasks?${params.toString()}`, {
        credentials: 'include',
      });
      const payload = await readResponseJson<TasksResponse>(res, {
        ok: false,
        tasks: [],
      });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось загрузить операционные задачи.');
        return;
      }
      setTasks(payload.tasks);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, urgentOnly]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(OPS_TASK_STATUSES.map((status) => [status, 0])) as Record<
      OpsTaskStatus,
      number
    >;
    for (const task of tasks) {
      byStatus[task.taskStatus] += 1;
    }
    return byStatus;
  }, [tasks]);

  const updateStatus = useCallback(
    async (taskId: string, taskStatus: OpsTaskStatus) => {
      setUpdatingId(taskId);
      setMessage('');
      try {
        const res = await fetch(`/api/dashboard/operations/tasks/${taskId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskStatus }),
        });
        const payload = await readResponseJson<{ ok: boolean; message?: string; task?: OpsOperatorTask }>(res, {
          ok: false,
        });
        if (!res.ok || !payload.ok || !payload.task) {
          setMessage(payload.message || 'Не удалось обновить задачу.');
          return;
        }
        setTasks((current) => current.map((task) => (task.id === taskId ? payload.task! : task)));
      } finally {
        setUpdatingId(null);
      }
    },
    [],
  );

  const openCount = tasks.filter((task) => task.taskStatus !== 'done' && task.taskStatus !== 'closed').length;

  return (
    <div className="max-w-7xl space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Operations</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Операционная панель</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
          Задачи из Telegram, CRM, автопилота и Менеджера Каналов — в одном месте для оператора ASI.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-500">В выборке</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{tasks.length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-500">Открытые</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{openCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-500">Требуют оператора</p>
          <p className="mt-2 text-2xl font-semibold text-rose-700">{counts.needs_operator}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-500">Срочные / критичные</p>
          <p className="mt-2 text-2xl font-semibold text-orange-700">
            {tasks.filter((task) => task.priority === 'urgent' || task.priority === 'critical').length}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Фильтры</h2>
            <p className="text-sm text-slate-500">Статус и срочность</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={urgentOnly}
                onChange={(event) => setUrgentOnly(event.target.checked)}
                className="rounded border-slate-300"
              />
              Только срочные
            </label>
            <button
              type="button"
              onClick={() => void loadTasks()}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Обновить
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['open', 'all', ...OPS_TASK_STATUSES] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                statusFilter === status
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {status === 'open' ? 'Открытые' : status === 'all' ? 'Все' : OPS_TASK_STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      </section>

      {message ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{message}</div>
      ) : null}

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          Нет задач по выбранным фильтрам.
        </div>
      ) : (
        <section className="grid gap-3">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              updating={updatingId === task.id}
              onStatus={(status) => void updateStatus(task.id, status)}
            />
          ))}
        </section>
      )}

      <p className="text-xs text-slate-500">
        Связанные разделы:{' '}
        <Link href="/dashboard/crm/queue" className="text-blue-700 hover:text-blue-900">
          Очередь CRM
        </Link>
      </p>
    </div>
  );
}
