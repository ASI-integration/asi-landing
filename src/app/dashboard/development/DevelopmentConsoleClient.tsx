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
import { DevelopmentTaskCard } from '@/lib/development/task-status-ui';

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
      const title = typeof payload.task.title === 'string' ? payload.task.title.trim() : '';
      setTask({
        ...payload.task,
        title: title || 'Задача разработки',
      });
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

  const loadReadiness = useCallback(async (selectedRepositoryId: string) => {
    if (!selectedRepositoryId) return;
    setReadinessBusy(true);
    setReadinessError(null);
    // Keep the last successful snapshot visible while a refresh is in flight.
    try {
      const res = await fetch(
        `/api/dashboard/development/readiness?repositoryId=${encodeURIComponent(selectedRepositoryId)}`,
        {
          cache: 'no-store',
          credentials: 'include',
        },
      );
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
        setError(data.message ?? 'Нет доступа к консоли разработки.');
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
      if (!cancelled) setError('Не удалось инициализировать консоль.');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!repositoryId) return;
    void loadReadiness(repositoryId);
  }, [repositoryId, loadReadiness]);

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

  const showForm = !task;
  const pendingGate = useMemo(
    () => pendingGates.find((gate) => gate.status === 'pending') ?? null,
    [pendingGates],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Разработка ASI</h1>
          <p className="mt-1 text-sm text-slate-600">
            Закрытая владельческая консоль: задача → Runtime Bridge → безопасный итог → owner gate.
          </p>
        </div>
        {task ? (
          <button
            type="button"
            onClick={handleNewTask}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Новая задача
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <ReadinessPanel
        readiness={readiness}
        busy={readinessBusy}
        error={readinessError}
        onRetry={() => {
          if (repositoryId) void loadReadiness(repositoryId);
        }}
      />

      {showForm ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div>
            <label htmlFor="dev-repo" className="block text-sm font-medium text-slate-800">
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
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              {repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dev-prompt" className="block text-sm font-medium text-slate-800">
              Что нужно сделать?
            </label>
            <textarea
              id="dev-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={4000}
              required
              rows={6}
              placeholder="Опишите задачу обычным языком"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <details className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-800">
              Расширенные настройки
            </summary>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="dev-title" className="block text-sm font-medium text-slate-800">
                  Название задачи
                </label>
                <input
                  id="dev-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder="Необязательно — сервер сформирует автоматически"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
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
                  rows={3}
                  placeholder="Необязательно"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
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
                  rows={6}
                  placeholder="Необязательно; каждая строка — отдельная инструкция"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>
          </details>
          <button
            type="submit"
            disabled={submitting || !repositoryId || readinessBusy || Boolean(readinessError)
              || readiness?.canLaunch !== true}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting
              ? 'Запуск…'
              : readinessBusy
                ? 'Проверка готовности…'
                : readinessError || readiness?.canLaunch !== true
                ? 'Запуск пока недоступен'
                : 'Запустить задачу'}
          </button>
        </form>
      ) : null}

      {task ? (
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
      ) : null}

      {mergeGate ? (
        <MergeGatePanel
          gate={mergeGate}
          busy={mergeBusy}
          onRequestMerge={() => setConfirmMerge(true)}
        />
      ) : null}

      {task?.status === 'awaiting_owner' && pendingGate ? (
        <OwnerGatePanel
          gate={pendingGate}
          busy={decisionBusy}
          onRequestDecision={(decision) => setConfirmGate({ gate: pendingGate, decision })}
        />
      ) : null}

      {confirmGate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="owner-gate-confirm-title"
            className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
          >
            <h3 id="owner-gate-confirm-title" className="text-lg font-semibold text-slate-900">
              {confirmGate.decision === 'approved' ? 'Подтвердить одобрение' : 'Подтвердить отклонение'}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              Решение отправится только после подтверждения. Проверьте exact action и side effect.
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-slate-500">Действие</dt>
                <dd className="font-medium text-slate-900">{confirmGate.gate.action}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Exact target</dt>
                <dd className="break-all text-slate-900">{confirmGate.gate.exactTarget}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Identity</dt>
                <dd className="break-all text-slate-900">{confirmGate.gate.identity}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Разрешённый side effect</dt>
                <dd className="text-slate-900">{confirmGate.gate.allowedSideEffect}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={decisionBusy}
                onClick={() => setConfirmGate(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={decisionBusy}
                onClick={() => void sendDecision(confirmGate.decision, confirmGate.gate)}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
                  confirmGate.decision === 'approved'
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-red-700 hover:bg-red-800'
                }`}
              >
                {decisionBusy
                  ? 'Отправка…'
                  : confirmGate.decision === 'approved'
                    ? 'Подтвердить одобрение'
                    : 'Подтвердить отклонение'}
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
            className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
          >
            <h3 id="merge-confirm-title" className="text-lg font-semibold text-slate-900">
              Подтвердить объединение PR
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              Сервер ещё раз проверит решение владельца и точную текущую версию PR.
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <GateField label="PR" value={`${mergeGate.repository}#${mergeGate.pullRequestNumber}`} />
              <GateField label="Текущая версия" value={mergeGate.currentSha} />
              <GateField label="Одобренная версия" value={mergeGate.approvedSha ?? 'Нет'} />
            </dl>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={mergeBusy}
                onClick={() => setConfirmMerge(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={mergeBusy || mergeGate.mergeState !== 'merge_allowed'}
                onClick={() => void sendMergeRequest()}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
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
  bridge: 'Runtime Bridge',
  checkouts: 'Рабочие каталоги Runtime',
  baseline: 'Текущая версия main',
  executor: 'Исполнитель',
  github: 'GitHub',
};

function ReadinessPanel({
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
  const overallMessage = readiness?.overallState === 'ready'
    ? 'Система готова к запуску задачи.'
    : readiness?.canLaunch === false
      ? 'Запуск остановлен до устранения обязательных блокеров.'
      : readiness
        ? 'Запуск возможен, но отдельные возможности требуют внимания.'
        : 'Выполняется безопасная проверка готовности.';
  const showRefreshIndicator = busy && readiness !== null;

  return (
    <section
      aria-labelledby="development-readiness-title"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="development-readiness-title" className="text-lg font-semibold text-slate-900">
              Готовность к запуску
            </h2>
            {readiness ? <OverallReadinessBadge state={readiness.overallState} /> : null}
            {showRefreshIndicator ? <ReadinessRefreshIndicator /> : null}
          </div>
          <p className="mt-1 text-sm text-slate-600" aria-live="polite">
            {error ?? overallMessage}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onRetry}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Проверка…' : 'Проверить готовность'}
        </button>
      </div>

      {readiness ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(readiness.components).map(([id, item]) => (
            <div key={id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-slate-900">
                  {READINESS_COMPONENT_LABELS[id as DevelopmentReadinessComponentId]}
                </h3>
                <ItemReadinessBadge state={item.state} />
              </div>
              <p className="mt-2 text-sm text-slate-700">{item.message}</p>
              <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{item.reasonCode}</p>
            </div>
          ))}
        </div>
      ) : null}

      {readiness ? (
        <p className="text-xs text-slate-500">
          Последняя проверка: {formatDate(readiness.checkedAt)}
        </p>
      ) : null}
    </section>
  );
}

const MERGE_GATE_LABELS: Record<ControlCenterMergeGateView['gateState'], string> = {
  pending: 'Ожидает решения владельца',
  passed: 'Решение владельца подтверждено',
  failed: 'Решение не разрешает объединение',
  stale_sha: 'Разрешение относится к старой версии',
  head_changed: 'Состав PR изменился',
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
    <section className={`space-y-4 rounded-xl border p-5 shadow-sm ${
      allowed ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'
    }`}>
      <h2 className="text-lg font-semibold text-slate-900">Разрешение на объединение</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <GateField label="Состояние проверки" value={MERGE_GATE_LABELS[gate.gateState]} />
        <GateField
          label="Объединение"
          value={gate.merged ? 'PR уже объединён' : gate.mergeState === 'merge_allowed' ? 'Разрешено' : 'Заблокировано'}
        />
        <GateField label="PR" value={`${gate.repository}#${gate.pullRequestNumber}`} />
        <GateField label="Текущая версия" value={gate.currentSha} />
        <GateField label="Одобренная версия" value={gate.approvedSha ?? 'Нет'} />
        <GateField label="Код запроса" value={gate.mergeRequestId} />
      </dl>
      {gate.blocker ? (
        <p className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-800">
          {gate.blocker.message}
        </p>
      ) : null}
      <button
        type="button"
        disabled={!allowed || busy}
        onClick={onRequestMerge}
        className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {gate.merged ? 'PR уже объединён' : allowed ? 'Объединить PR' : 'Объединение заблокировано'}
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
    <section className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Owner gate</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <GateField label="Действие" value={gate.action} />
        <GateField label="Exact target" value={gate.exactTarget} />
        <GateField label="Identity" value={gate.identity} />
        <GateField label="Причина" value={gate.reason} />
        <GateField label="Разрешённый side effect" value={gate.allowedSideEffect} />
        <GateField label="Rollback" value={gate.rollback} />
        <GateField label="Истекает" value={formatDate(gate.expiresAt)} />
      </dl>
      <div>
        <h3 className="text-sm font-medium text-slate-800">Evidence</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {gate.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-medium text-slate-800">Post-action verification</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {gate.postActionVerification.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onRequestDecision('approved')}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          Одобрить
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRequestDecision('rejected')}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
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
      <dd className="mt-0.5 break-words text-slate-900">{value}</dd>
    </div>
  );
}
