'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import OpsPilotParticipantsSection from './OpsPilotParticipantsSection';
import { readResponseJson } from '@/lib/safeResponseJson';
import {
  OPS_V1_ORIGIN_LABELS,
  OPS_V1_SOURCE_LABELS,
  OPS_V1_STATUS_LABELS,
  OPS_V1_TASK_TYPE_LABELS,
  OPS_V1_TASK_TYPES,
  type OpsV1ListFilter,
  type OpsV1Status,
  type OpsV1Summary,
  type OpsV1Task,
  type OpsV1TaskType,
} from '@/lib/ops-v1/types';

type TasksResponse = {
  ok: boolean;
  message?: string;
  tasks: OpsV1Task[];
  summary: OpsV1Summary;
  filter?: OpsV1ListFilter;
  refreshedAt?: string;
  isOpsAdmin?: boolean;
};

const STATUS_TONE: Record<OpsV1Status, string> = {
  new: 'border-sky-200 bg-sky-50 text-sky-800',
  in_progress: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  needs_attention: 'border-rose-200 bg-rose-50 text-rose-800',
};

const LIST_FILTERS: { value: OpsV1ListFilter; label: string }[] = [
  { value: 'active', label: 'Активные' },
  { value: 'done', label: 'Завершённые' },
  { value: 'all', label: 'Все' },
];

const EMPTY_STATE: Record<OpsV1ListFilter, string> = {
  active: 'Пока нет активных операционных задач.',
  done: 'Пока нет завершённых задач.',
  all: 'Пока нет операционных задач.',
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

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export default function OpsPageClient() {
  const searchParams = useSearchParams();
  const highlightTaskId = useMemo(() => searchParams.get('taskId')?.trim() ?? '', [searchParams]);
  const [tasks, setTasks] = useState<OpsV1Task[]>([]);
  const [summary, setSummary] = useState<OpsV1Summary>({
    checkinsToday: 0,
    checkoutsToday: 0,
    cleaningNeeded: 0,
    needsAttention: 0,
  });
  const [listFilter, setListFilter] = useState<OpsV1ListFilter>('active');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTaskType, setNewTaskType] = useState<OpsV1TaskType>('manual_review');
  const [newObjectLabel, setNewObjectLabel] = useState('');
  const [newComment, setNewComment] = useState('');
  const [isOpsAdmin, setIsOpsAdmin] = useState(false);

  const loadTasks = useCallback(async (filter: OpsV1ListFilter = listFilter) => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/ops/tasks?filter=${filter}`, { credentials: 'include' });
      const payload = await readResponseJson<TasksResponse>(res, {
        ok: false,
        tasks: [],
        summary: { checkinsToday: 0, checkoutsToday: 0, cleaningNeeded: 0, needsAttention: 0 },
      });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось загрузить операционные задачи.');
        return;
      }
      setTasks(payload.tasks);
      setSummary(payload.summary);
      setIsOpsAdmin(payload.isOpsAdmin === true);
    } finally {
      setLoading(false);
    }
  }, [listFilter]);

  useEffect(() => {
    void loadTasks(listFilter);
  }, [listFilter, loadTasks]);

  const changeFilter = useCallback((filter: OpsV1ListFilter) => {
    setListFilter(filter);
  }, []);

  const updateStatus = useCallback(async (taskId: string, status: OpsV1Status) => {
    setUpdatingId(taskId);
    setMessage('');
    try {
      const res = await fetch(`/api/ops/tasks/${taskId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string; task?: OpsV1Task }>(res, {
        ok: false,
      });
      if (!res.ok || !payload.ok || !payload.task) {
        setMessage(payload.message || 'Не удалось обновить задачу.');
        return;
      }
      await loadTasks(listFilter);
    } finally {
      setUpdatingId(null);
    }
  }, [listFilter, loadTasks]);

  const createTask = useCallback(async () => {
    setCreating(true);
    setMessage('');
    try {
      const res = await fetch('/api/ops/tasks', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType: newTaskType,
          objectLabel: newObjectLabel.trim() || null,
          comment: newComment.trim() || null,
        }),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string }>(res, { ok: false });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось создать задачу.');
        return;
      }
      setShowCreate(false);
      setNewObjectLabel('');
      setNewComment('');
      await loadTasks(listFilter);
    } finally {
      setCreating(false);
    }
  }, [listFilter, loadTasks, newComment, newObjectLabel, newTaskType]);

  return (
    <div className="max-w-7xl space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-5">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Операции</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
          Ближайшие действия по объектам: заезды, выезды, уборка и задачи, которые требуют внимания.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Заезды сегодня" value={summary.checkinsToday} />
        <SummaryCard label="Выезды сегодня" value={summary.checkoutsToday} />
        <SummaryCard label="Нужна уборка" value={summary.cleaningNeeded} />
        <SummaryCard label="Требуют внимания" value={summary.needsAttention} />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Операционные задачи</h2>
            <p className="text-sm text-slate-500">Список ближайших действий по объектам</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-300 bg-slate-50 p-0.5">
              {LIST_FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => changeFilter(item.value)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    listFilter === item.value
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {isOpsAdmin ? (
              <button
                type="button"
                onClick={() => setShowCreate((value) => !value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Добавить вручную
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void loadTasks(listFilter)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Обновить
            </button>
          </div>
        </div>

        {showCreate ? (
          <div className="border-b border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Тип задачи</span>
                <select
                  value={newTaskType}
                  onChange={(event) => setNewTaskType(event.target.value as OpsV1TaskType)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  {OPS_V1_TASK_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {OPS_V1_TASK_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Объект</span>
                <input
                  type="text"
                  value={newObjectLabel}
                  onChange={(event) => setNewObjectLabel(event.target.value)}
                  placeholder="Название или код объекта"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Комментарий</span>
              <textarea
                value={newComment}
                onChange={(event) => setNewComment(event.target.value)}
                rows={2}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                placeholder="Что нужно сделать"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={creating}
                onClick={() => void createTask()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : null}

        {message ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{message}</div>
        ) : null}

        {loading ? (
          <div className="flex min-h-[24vh] items-center justify-center p-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-8 text-center text-slate-600">
            <p className="text-base font-medium text-slate-800">{EMPTY_STATE[listFilter]}</p>
            {listFilter === 'active' ? (
              <p className="mt-2 text-sm leading-6">
                Когда появятся заезды, выезды, обращения гостей или задачи по объектам, они будут отображаться здесь
                автоматически.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Объект</th>
                  <th className="px-4 py-3">Тип задачи</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Дата / время</th>
                  <th className="px-4 py-3">Источник</th>
                  <th className="px-4 py-3">Создание</th>
                  <th className="px-4 py-3">Комментарий</th>
                  <th className="px-4 py-3">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {tasks.map((task) => {
                  const isUpdating = updatingId === task.id;
                  const isDone = task.status === 'done';
                  const showReopen = isDone && listFilter === 'done';
                  const isHighlighted = highlightTaskId && highlightTaskId === task.id;
                  return (
                    <tr
                      key={task.id}
                      className={`align-top ${isHighlighted ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {task.objectLabel || task.propertyId || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{OPS_V1_TASK_TYPE_LABELS[task.taskType]}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[task.status]}`}
                        >
                          {OPS_V1_STATUS_LABELS[task.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{formatWhen(task.scheduledAt)}</td>
                      <td className="px-4 py-3 text-slate-700">{OPS_V1_SOURCE_LABELS[task.source]}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            task.origin === 'auto'
                              ? 'border-sky-200 bg-sky-50 text-sky-800'
                              : 'border-slate-200 bg-slate-50 text-slate-700'
                          }`}
                        >
                          {OPS_V1_ORIGIN_LABELS[task.origin]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{task.comment || '—'}</td>
                      <td className="px-4 py-3">
                        {showReopen ? (
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => void updateStatus(task.id, 'in_progress')}
                            className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                          >
                            Вернуть в работу
                          </button>
                        ) : isDone ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              disabled={isUpdating || task.status === 'in_progress'}
                              onClick={() => void updateStatus(task.id, 'in_progress')}
                              className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                            >
                              В работу
                            </button>
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() => void updateStatus(task.id, 'done')}
                              className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              Готово
                            </button>
                            <button
                              type="button"
                              disabled={isUpdating || task.status === 'needs_attention'}
                              onClick={() => void updateStatus(task.id, 'needs_attention')}
                              className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                            >
                              Требует внимания
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <OpsPilotParticipantsSection />
    </div>
  );
}
