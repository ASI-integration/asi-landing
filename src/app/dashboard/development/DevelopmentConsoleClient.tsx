'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { readResponseJson } from '@/lib/safeResponseJson';
import { useDevelopmentTaskPolling } from '@/lib/development/use-task-polling';
import {
  DEVELOPMENT_REPOSITORY_STORAGE_KEY,
  resolveRememberedDevelopmentRepositoryId,
} from '@/lib/development/repositories';
import type {
  RuntimeBridgeOwnerGateView,
  RuntimeBridgeSafeResult,
  RuntimeBridgeTaskStatus,
} from '@/lib/asi-runtime/bridge-types';
import type { ControlCenterMergeGateView } from '@/lib/development/owner-merge-gate';
import type {
  DevelopmentReadinessComponentId,
  DevelopmentReadinessSnapshot,
} from '@/lib/development/readiness-types';
import {
  ItemReadinessBadge,
  OverallReadinessBadge,
  ReadinessRefreshIndicator,
} from '@/lib/development/readiness-status-ui';
import {
  DEVELOPMENT_STATUS_LABELS,
  developmentStageText,
  developmentStatusTone,
} from '@/lib/development/status-labels';
import {
  CONTROL_ROOM_TONE_SOLID,
  CONTROL_ROOM_TONE_SURFACE,
  ControlRoomTile,
  DevelopmentTaskCard,
  compactTaskSummary,
  pullRequestUrlFromResult,
} from '@/lib/development/task-status-ui';

type RepositoryOption = { id: string; label: string; fullName: string };

type TaskPayload = {
  taskId: string;
  chatgptTaskId: string;
  conversationId: string;
  status: RuntimeBridgeTaskStatus;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  repository: string;
  title: string;
};

type SnapshotResponse = {
  ok: boolean;
  message?: string;
  taskId?: string;
  deduplicated?: boolean;
  task?: TaskPayload | null;
  result?: RuntimeBridgeSafeResult | null;
  pendingGates?: RuntimeBridgeOwnerGateView[];
  mergeGate?: ControlCenterMergeGateView | null;
  gate?: ControlCenterMergeGateView | null;
  repositories?: RepositoryOption[];
};

type ReadinessResponse = {
  ok: boolean;
  message?: string;
  readiness?: DevelopmentReadinessSnapshot;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU');
}

function createClientIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `dev-console-idem-${crypto.randomUUID()}`;
  }
  return `dev-console-idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function DevelopmentConsoleClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskIdFromUrl = searchParams.get('taskId');

  const [repositories, setRepositories] = useState<RepositoryOption[]>([]);
  const [repositoryId, setRepositoryId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [instructions, setInstructions] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<TaskPayload | null>(null);
  const [result, setResult] = useState<RuntimeBridgeSafeResult | null>(null);
  const [pendingGates, setPendingGates] = useState<RuntimeBridgeOwnerGateView[]>([]);
  const [mergeGate, setMergeGate] = useState<ControlCenterMergeGateView | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [confirmGate, setConfirmGate] = useState<{
    gate: RuntimeBridgeOwnerGateView;
    decision: 'approved' | 'rejected';
  } | null>(null);
  const [readiness, setReadiness] = useState<DevelopmentReadinessSnapshot | null>(null);
  const [readinessBusy, setReadinessBusy] = useState(true);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  const idempotencyKeyRef = useRef<string | null>(null);
  const activeTaskId = task?.taskId ?? taskIdFromUrl;

  const applySnapshot = useCallback((payload: SnapshotResponse) => {
    if (payload.task) {
      const nextTitle = typeof payload.task.title === 'string' ? payload.task.title.trim() : '';
      setTask({
        ...payload.task,
        title: nextTitle || 'Задача Control Room',
      });
      setComposerOpen(false);
    }
    setResult(payload.result ?? null);
    setPendingGates(Array.isArray(payload.pendingGates) ? payload.pendingGates : []);
    setMergeGate(payload.mergeGate ?? payload.gate ?? null);
  }, []);

  const loadTask = useCallback(async (id: string) => {
    const res = await fetch(`/api/dashboard/development/tasks/${encodeURIComponent(id)}`, {
      cache: 'no-store',
      credentials: 'include',
    });
    const data = await readResponseJson<SnapshotResponse>(res, {
      ok: false,
      message: 'Не удалось загрузить задачу.',
    });
    if (!res.ok || !data.ok) {
      setError(data.message ?? 'Не удалось загрузить задачу.');
      return;
    }
    setError(null);
    applySnapshot(data);
  }, [applySnapshot]);

  const loadReadiness = useCallback(async () => {
    setReadinessBusy(true);
    setReadinessError(null);
    try {
      const res = await fetch('/api/dashboard/development/readiness', {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await readResponseJson<ReadinessResponse>(res, {
        ok: false,
        message: 'Не удалось проверить готовность.',
      });
      if (!res.ok || !data.ok || !data.readiness) {
        setReadinessError(data.message ?? 'Не удалось проверить готовность.');
        return;
      }
      setReadiness(data.readiness);
    } catch {
      setReadinessError('Не удалось проверить готовность.');
    } finally {
      setReadinessBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/dashboard/development/tasks', {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await readResponseJson<SnapshotResponse>(res, { ok: false, repositories: [] });
      if (cancelled) return;
      if (!res.ok || !data.ok) {
        setError(data.message ?? 'Нет доступа к Control Room.');
        return;
      }
      const repos = data.repositories ?? [];
      setRepositories(repos);
      let rememberedRepository: string | null = null;
      try {
        rememberedRepository = window.localStorage.getItem(DEVELOPMENT_REPOSITORY_STORAGE_KEY);
      } catch {
        // Storage may be unavailable; the first server-allowlisted repository remains safe.
      }
      setRepositoryId(resolveRememberedDevelopmentRepositoryId(repos, rememberedRepository));
    })().catch(() => {
      if (!cancelled) setError('Не удалось инициализировать Control Room.');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  useEffect(() => {
    if (!taskIdFromUrl) return;
    void loadTask(taskIdFromUrl);
  }, [taskIdFromUrl, loadTask]);

  useDevelopmentTaskPolling({
    taskId: activeTaskId,
    status: task?.status as RuntimeBridgeTaskStatus | null,
    enabled: Boolean(activeTaskId && task),
    onPoll: loadTask,
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || readinessBusy || readinessError || readiness?.canLaunch !== true) return;
    setSubmitting(true);
    setError(null);
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = createClientIdempotencyKey();
    }

    try {
      const res = await fetch('/api/dashboard/development/tasks', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repositoryId,
          prompt: prompt.trim(),
          title: title.trim() || undefined,
          objective: objective.trim() || undefined,
          instructions: instructions.trim() || undefined,
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });
      const data = await readResponseJson<SnapshotResponse>(res, {
        ok: false,
        message: 'Не удалось создать задачу.',
      });
      if (!res.ok || !data.ok || !data.taskId) {
        setError(data.message ?? 'Не удалось создать задачу.');
        return;
      }
      applySnapshot(data);
      idempotencyKeyRef.current = null;
      router.replace(`/dashboard/development?taskId=${encodeURIComponent(data.taskId)}`);
    } catch {
      setError('Не удалось создать задачу.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleNewTask() {
    setTask(null);
    setResult(null);
    setPendingGates([]);
    setMergeGate(null);
    setConfirmMerge(false);
    setConfirmGate(null);
    setError(null);
    setPrompt('');
    setTitle('');
    setObjective('');
    setInstructions('');
    setComposerOpen(true);
    idempotencyKeyRef.current = null;
    router.replace('/dashboard/development');
  }

  async function sendDecision(decision: 'approved' | 'rejected', gate: RuntimeBridgeOwnerGateView) {
    if (!task || decisionBusy) return;
    setDecisionBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/development/tasks/${encodeURIComponent(task.taskId)}/decisions`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            gateId: gate.gateId,
            taskCycle: gate.taskCycle,
            decision,
          }),
        },
      );
      const data = await readResponseJson<SnapshotResponse>(res, {
        ok: false,
        message: 'Не удалось отправить решение.',
      });
      if (!res.ok || !data.ok) {
        setError(data.message ?? 'Не удалось отправить решение.');
        return;
      }
      setConfirmGate(null);
      applySnapshot(data);
      await loadTask(task.taskId);
    } catch {
      setError('Не удалось отправить решение.');
    } finally {
      setDecisionBusy(false);
    }
  }

  async function sendMergeRequest() {
    if (!task || !mergeGate || mergeBusy || mergeGate.mergeState !== 'merge_allowed') return;
    setMergeBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/development/tasks/${encodeURIComponent(task.taskId)}/merge`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pullRequestUrl: mergeGate.pullRequestUrl,
            expectedHeadSha: mergeGate.currentSha,
          }),
        },
      );
      const data = await readResponseJson<SnapshotResponse>(res, {
        ok: false,
        message: 'Не удалось объединить PR.',
      });
      if (data.gate) setMergeGate(data.gate);
      if (!res.ok || !data.ok) {
        setError(data.message ?? 'Объединение PR заблокировано.');
        setConfirmMerge(false);
        return;
      }
      setConfirmMerge(false);
      await loadTask(task.taskId);
    } catch {
      setError('Не удалось объединить PR.');
    } finally {
      setMergeBusy(false);
    }
  }

  const pendingGate = useMemo(
    () => pendingGates.find((gate) => gate.status === 'pending') ?? null,
    [pendingGates],
  );

  const canLaunch = !readinessBusy && !readinessError && readiness?.canLaunch === true;
  const mergeAllowed = Boolean(mergeGate && mergeGate.mergeState === 'merge_allowed' && !mergeGate.merged);
  const status = task?.status ?? null;
  const summaryTone = status ? developmentStatusTone(status) : readinessError ? 'red' : readiness?.overallState === 'blocked' ? 'red' : readiness?.overallState === 'degraded' ? 'orange' : canLaunch ? 'green' : 'neutral';
  const summaryLabel = status
    ? DEVELOPMENT_STATUS_LABELS[status]
    : readinessError
      ? 'Система недоступна'
      : readinessBusy
        ? 'Проверка…'
        : canLaunch
          ? 'Готово к запуску'
          : 'Запуск недоступен';
  const summaryHint = status
    ? developmentStageText(status)
    : readinessError ?? (canLaunch ? 'Можно создать задачу' : 'Сначала проверьте готовность');

  const showComposer = composerOpen || !task;
  const recentSummary = task && (status === 'completed' || status === 'failed')
    ? compactTaskSummary({ status, result })
    : null;
  const recentPr = pullRequestUrlFromResult(result);

  return (
    <div className="mx-auto max-w-5xl space-y-5" data-control-room="true">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-950">Control Room</h1>
          <p className="mt-1 text-sm text-slate-600">Панель управления задачами</p>
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          {error}
        </div>
      ) : null}

      <section
        aria-label="Текущее состояние"
        className={`rounded-2xl border-2 px-4 py-4 sm:px-5 ${CONTROL_ROOM_TONE_SURFACE[summaryTone]}`}
        data-control-room-summary={status ?? 'idle'}
      >
        <p className="text-2xl font-black leading-none sm:text-3xl">{summaryLabel}</p>
        <p className="mt-2 text-sm font-medium opacity-80">{summaryHint}</p>
      </section>

      <section aria-label="Основные действия" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <ControlRoomTile
          label="Создать задачу"
          tone="neutral"
          active={showComposer && !task}
          hint={task ? 'Новая' : 'Старт'}
          onClick={handleNewTask}
          data-testid="control-room-create"
        />
        <ControlRoomTile
          label="В работе"
          tone="blue"
          active={status === 'running'}
          hint={status === 'running' ? 'Сейчас' : undefined}
          disabled
          data-testid="control-room-running"
        />
        <ControlRoomTile
          label="Нужна помощь"
          tone="orange"
          active={status === 'awaiting_owner'}
          hint={status === 'awaiting_owner' ? 'Ждёт вас' : undefined}
          disabled={status !== 'awaiting_owner'}
          onClick={
            status === 'awaiting_owner' && pendingGate
              ? () => document.getElementById('control-room-owner-action')?.scrollIntoView({ behavior: 'smooth' })
              : undefined
          }
          data-testid="control-room-awaiting"
        />
        <ControlRoomTile
          label="Готово к проверке"
          tone="green"
          active={status === 'completed'}
          hint={status === 'completed' ? 'Итог готов' : undefined}
          disabled={status !== 'completed'}
          onClick={
            status === 'completed'
              ? () => document.getElementById('control-room-active-task')?.scrollIntoView({ behavior: 'smooth' })
              : undefined
          }
          data-testid="control-room-completed"
        />
        <ControlRoomTile
          label="Объединить PR"
          tone="green"
          active={mergeAllowed}
          hint={mergeGate?.merged ? 'Уже объединено' : mergeAllowed ? 'Exact SHA' : 'Недоступно'}
          disabled={!mergeAllowed || mergeBusy}
          onClick={() => setConfirmMerge(true)}
          data-testid="control-room-merge"
        />
        <ControlRoomTile
          label={status === 'failed' ? 'Остановлено' : status === 'queued' ? 'В очереди' : 'Система'}
          tone={status === 'failed' ? 'red' : status === 'queued' ? 'neutral' : canLaunch ? 'green' : 'orange'}
          active={status === 'failed' || status === 'queued' || (!task && !canLaunch)}
          hint={
            status === 'failed'
              ? 'Сбой'
              : status === 'queued'
                ? 'Ожидание'
                : readinessBusy
                  ? 'Проверка…'
                  : canLaunch
                    ? 'Готова'
                    : 'Есть блокер'
          }
          disabled
          data-testid="control-room-system"
        />
      </section>

      <ReadinessStrip
        readiness={readiness}
        busy={readinessBusy}
        error={readinessError}
        onRetry={() => void loadReadiness()}
      />

      {showComposer && !task ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          data-control-room-composer="true"
        >
          <h2 className="text-lg font-bold text-slate-950">Новая задача</h2>
          {repositories.length > 1 ? (
            <div>
              <label htmlFor="dev-repo" className="block text-sm font-semibold text-slate-800">
                Репозиторий
              </label>
              <select
                id="dev-repo"
                value={repositoryId}
                onChange={(e) => {
                  const selected = e.target.value;
                  setRepositoryId(selected);
                  try {
                    window.localStorage.setItem(DEVELOPMENT_REPOSITORY_STORAGE_KEY, selected);
                  } catch {
                    // A blocked storage API must not block task submission.
                  }
                }}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
                required
              >
                {repositories.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <input type="hidden" name="repositoryId" value={repositoryId} />
          )}
          <div>
            <label htmlFor="dev-prompt" className="block text-sm font-semibold text-slate-800">
              Что сделать?
            </label>
            <textarea
              id="dev-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={4000}
              required
              rows={4}
              placeholder="Кратко, обычным языком"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
            />
          </div>
          <details className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">Ещё настройки</summary>
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="dev-title" className="block text-sm font-medium text-slate-800">
                  Название
                </label>
                <input
                  id="dev-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="Необязательно"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="dev-objective" className="block text-sm font-medium text-slate-800">
                  Цель
                </label>
                <textarea
                  id="dev-objective"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  maxLength={4000}
                  rows={2}
                  placeholder="Необязательно"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="dev-instructions" className="block text-sm font-medium text-slate-800">
                  Инструкции
                </label>
                <textarea
                  id="dev-instructions"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={4}
                  placeholder="Необязательно"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>
          </details>
          <button
            type="submit"
            disabled={submitting || !repositoryId || !canLaunch}
            className={`min-h-14 w-full rounded-2xl border-2 px-4 py-3 text-base font-bold disabled:cursor-not-allowed disabled:opacity-60 ${CONTROL_ROOM_TONE_SOLID.neutral}`}
          >
            {submitting
              ? 'Запуск…'
              : readinessBusy
                ? 'Проверка…'
                : !canLaunch
                  ? 'Запуск недоступен'
                  : 'Создать задачу'}
          </button>
        </form>
      ) : null}

      {task ? (
        <div id="control-room-active-task" className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Активная задача</h2>
          <DevelopmentTaskCard
            task={{
              title: task.title,
              status: task.status,
              updatedAt: task.updatedAt,
              taskId: task.taskId,
              repository: task.repository,
              attemptCount: task.attemptCount,
              createdAt: task.createdAt,
              chatgptTaskId: task.chatgptTaskId,
              conversationId: task.conversationId,
              result,
            }}
          />
        </div>
      ) : null}

      {task?.status === 'awaiting_owner' && pendingGate ? (
        <OwnerGatePanel
          gate={pendingGate}
          busy={decisionBusy}
          onRequestDecision={(decision) => setConfirmGate({ gate: pendingGate, decision })}
        />
      ) : null}

      {mergeGate ? (
        <MergeGatePanel
          gate={mergeGate}
          busy={mergeBusy}
          onRequestMerge={() => setConfirmMerge(true)}
        />
      ) : null}

      {recentSummary ? (
        <section
          aria-label="Последний итог"
          className={`rounded-2xl border-2 p-4 ${CONTROL_ROOM_TONE_SURFACE[developmentStatusTone(status!)]}`}
          data-control-room-recent="true"
        >
          <h2 className="text-sm font-bold uppercase tracking-wide opacity-70">Последний итог</h2>
          <p className="mt-2 text-base font-bold">{DEVELOPMENT_STATUS_LABELS[status!]}</p>
          <p className="mt-1 line-clamp-2 text-sm opacity-90">{recentSummary}</p>
          {recentPr ? (
            <a
              href={recentPr}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white"
            >
              Открыть PR
            </a>
          ) : null}
        </section>
      ) : null}

      {confirmGate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="owner-gate-confirm-title"
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
          >
            <h3 id="owner-gate-confirm-title" className="text-lg font-bold text-slate-900">
              {confirmGate.decision === 'approved' ? 'Подтвердить одобрение' : 'Подтвердить отклонение'}
            </h3>
            <p className="mt-2 text-sm text-slate-600">Решение отправится только после подтверждения.</p>
            <dl className="mt-4 space-y-2 text-sm">
              <GateField label="Действие" value={confirmGate.gate.action} />
              <GateField label="Цель" value={confirmGate.gate.exactTarget} />
              <GateField label="Side effect" value={confirmGate.gate.allowedSideEffect} />
            </dl>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={decisionBusy}
                onClick={() => setConfirmGate(null)}
                className="min-h-12 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={decisionBusy}
                onClick={() => void sendDecision(confirmGate.decision, confirmGate.gate)}
                className={`min-h-12 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60 ${
                  confirmGate.decision === 'approved'
                    ? CONTROL_ROOM_TONE_SOLID.green
                    : CONTROL_ROOM_TONE_SOLID.red
                }`}
              >
                {decisionBusy ? 'Отправка…' : 'Подтвердить'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmMerge && mergeGate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="merge-confirm-title"
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
          >
            <h3 id="merge-confirm-title" className="text-lg font-bold text-slate-900">
              Объединить PR?
            </h3>
            <p className="mt-2 text-sm text-slate-600">Сервер сверит решение и точную версию SHA.</p>
            <dl className="mt-4 space-y-2 text-sm">
              <GateField label="PR" value={`${mergeGate.repository}#${mergeGate.pullRequestNumber}`} />
              <GateField label="SHA" value={mergeGate.currentSha} />
            </dl>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={mergeBusy}
                onClick={() => setConfirmMerge(false)}
                className="min-h-12 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={mergeBusy || mergeGate.mergeState !== 'merge_allowed'}
                onClick={() => void sendMergeRequest()}
                className={`min-h-12 rounded-xl border-2 px-4 py-2 text-sm font-bold disabled:opacity-60 ${CONTROL_ROOM_TONE_SOLID.green}`}
              >
                {mergeBusy ? 'Проверка…' : 'Объединить PR'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const READINESS_COMPONENT_LABELS: Record<DevelopmentReadinessComponentId, string> = {
  bridge: 'Bridge',
  checkouts: 'Каталоги',
  baseline: 'main',
  executor: 'Исполнитель',
  github: 'GitHub',
};

function ReadinessStrip({
  readiness,
  busy,
  error,
  onRetry,
}: {
  readiness: DevelopmentReadinessSnapshot | null;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const showRefreshIndicator = busy && readiness !== null;
  return (
    <section
      aria-labelledby="development-readiness-title"
      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
      data-control-room-readiness="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="development-readiness-title" className="text-sm font-bold text-slate-900">
            Готовность
          </h2>
          {readiness ? <OverallReadinessBadge state={readiness.overallState} /> : null}
          {showRefreshIndicator ? <ReadinessRefreshIndicator /> : null}
          {error ? <span className="text-sm font-semibold text-red-700">{error}</span> : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onRetry}
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-60"
        >
          {busy ? '…' : 'Обновить'}
        </button>
      </div>
      {readiness ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">Подробнее</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.entries(readiness.components).map(([id, item]) => (
              <div key={id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {READINESS_COMPONENT_LABELS[id as DevelopmentReadinessComponentId]}
                  </span>
                  <ItemReadinessBadge state={item.state} />
                </div>
                <p className="mt-1 text-xs text-slate-600">{item.message}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">{formatDate(readiness.checkedAt)}</p>
        </details>
      ) : null}
    </section>
  );
}

const MERGE_GATE_LABELS: Record<ControlCenterMergeGateView['gateState'], string> = {
  pending: 'Ждёт решения',
  passed: 'Решение есть',
  failed: 'Нельзя объединять',
  stale_sha: 'Старая версия',
  head_changed: 'PR изменился',
};

function MergeGatePanel({
  gate,
  busy,
  onRequestMerge,
}: {
  gate: ControlCenterMergeGateView;
  busy: boolean;
  onRequestMerge: () => void;
}) {
  const allowed = gate.mergeState === 'merge_allowed' && !gate.merged;
  return (
    <section
      className={`space-y-3 rounded-2xl border-2 p-4 sm:p-5 ${
        allowed ? CONTROL_ROOM_TONE_SURFACE.green : CONTROL_ROOM_TONE_SURFACE.orange
      }`}
      data-control-room-merge-panel="true"
    >
      <h2 className="text-lg font-bold text-slate-950">Объединение PR</h2>
      <p className="text-sm font-semibold">
        {gate.merged ? 'PR уже объединён' : MERGE_GATE_LABELS[gate.gateState]}
      </p>
      <details className="rounded-xl border border-black/10 bg-white/70 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold">Подробнее</summary>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <GateField label="PR" value={`${gate.repository}#${gate.pullRequestNumber}`} />
          <GateField label="SHA" value={gate.currentSha} />
          <GateField label="Одобрено" value={gate.approvedSha ?? 'Нет'} />
          {gate.blocker ? <GateField label="Блокер" value={gate.blocker.message} /> : null}
        </dl>
      </details>
      <button
        type="button"
        disabled={!allowed || busy}
        onClick={onRequestMerge}
        className={`min-h-14 w-full rounded-2xl border-2 px-4 py-3 text-base font-bold disabled:cursor-not-allowed disabled:opacity-60 ${CONTROL_ROOM_TONE_SOLID.green}`}
      >
        {gate.merged ? 'Уже объединено' : allowed ? 'Объединить PR' : 'Объединение недоступно'}
      </button>
    </section>
  );
}

function OwnerGatePanel({
  gate,
  busy,
  onRequestDecision,
}: {
  gate: RuntimeBridgeOwnerGateView;
  busy: boolean;
  onRequestDecision: (decision: 'approved' | 'rejected') => void;
}) {
  return (
    <section
      id="control-room-owner-action"
      className={`space-y-3 rounded-2xl border-2 p-4 sm:p-5 ${CONTROL_ROOM_TONE_SURFACE.orange}`}
      data-control-room-owner-action="true"
    >
      <h2 className="text-lg font-bold text-slate-950">Нужна помощь</h2>
      <p className="text-sm font-semibold line-clamp-2">{gate.action}</p>
      <details className="rounded-xl border border-black/10 bg-white/70 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold">Подробнее</summary>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <GateField label="Цель" value={gate.exactTarget} />
          <GateField label="Причина" value={gate.reason} />
          <GateField label="Side effect" value={gate.allowedSideEffect} />
          <GateField label="Rollback" value={gate.rollback} />
          <GateField label="Истекает" value={formatDate(gate.expiresAt)} />
        </dl>
        {gate.evidence.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {gate.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </details>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onRequestDecision('approved')}
          className={`min-h-14 rounded-2xl border-2 px-4 py-3 text-base font-bold disabled:opacity-60 ${CONTROL_ROOM_TONE_SOLID.green}`}
        >
          Одобрить
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRequestDecision('rejected')}
          className={`min-h-14 rounded-2xl border-2 px-4 py-3 text-base font-bold disabled:opacity-60 ${CONTROL_ROOM_TONE_SOLID.red}`}
        >
          Отклонить
        </button>
      </div>
    </section>
  );
}

function GateField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-slate-900">{value}</dd>
    </div>
  );
}
