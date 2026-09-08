'use client';

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { readResponseJson } from '@/lib/safeResponseJson';
import { isTerminalPilotConsoleStatus, type PilotConsoleStatus } from '@/lib/pilot/status';
import {
  usePilotListPolling,
  usePilotTaskPolling,
} from '@/lib/pilot/use-pilot-polling';
import {
  PilotAccessPanel,
  PilotConsoleShell,
  PilotCreateForm,
  PilotReadinessBanner,
  PilotTaskDetail,
  PilotTaskList,
  type PilotAccessState,
  type PilotReadinessUiState,
  type PilotSafeResult,
  type PilotTaskListItem,
} from './PilotConsoleView';

type SessionResponse = {
  ok?: boolean;
  role?: string;
  userId?: string;
  message?: string;
  code?: string;
};

type ListResponse = {
  ok?: boolean;
  tasks?: PilotTaskListItem[];
  message?: string;
};

type DetailResponse = {
  ok?: boolean;
  task?: PilotTaskListItem;
  result?: PilotSafeResult;
  message?: string;
};

type CreateResponse = {
  ok?: boolean;
  taskId?: string;
  task?: PilotTaskListItem;
  message?: string;
  code?: string;
};

type ReadinessResponse = {
  ok?: boolean;
  readiness?: {
    state?: PilotReadinessUiState;
    canSubmit?: boolean;
    messageRu?: string;
    checkedAt?: string;
  };
  message?: string;
};

function createPilotIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `pilot-beta-idem-${crypto.randomUUID()}`;
  }
  return `pilot-beta-idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function PilotConsoleClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskIdFromUrl = searchParams.get('taskId');

  const [access, setAccess] = useState<PilotAccessState>('loading');
  const [accessMessage, setAccessMessage] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [readinessState, setReadinessState] = useState<PilotReadinessUiState>('loading');
  const [readinessMessage, setReadinessMessage] = useState<string | null>(null);
  const [readinessRefreshing, setReadinessRefreshing] = useState(false);

  const [tasks, setTasks] = useState<PilotTaskListItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(taskIdFromUrl);
  const [selectedTask, setSelectedTask] = useState<PilotTaskListItem | null>(null);
  const [result, setResult] = useState<PilotSafeResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const idempotencyKeyRef = useRef<string | null>(null);

  const selectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    router.replace(`/pilot?taskId=${encodeURIComponent(taskId)}`, { scroll: false });
  }, [router]);

  const checkSession = useCallback(async () => {
    const res = await fetch('/api/pilot/session', {
      cache: 'no-store',
      credentials: 'include',
    });
    const data = await readResponseJson<SessionResponse>(res, { ok: false });

    if (res.status === 401) {
      setAccess('unauthenticated');
      return false;
    }
    if (res.status === 403) {
      setAccess('uninvited');
      return false;
    }
    if (!res.ok || !data.ok || data.role !== 'pilot_beta') {
      setAccess('error');
      setAccessMessage(data.message ?? 'Не удалось проверить доступ пилота.');
      return false;
    }
    setAccess('ready');
    setAccessMessage(null);
    return true;
  }, []);

  const loadReadiness = useCallback(async () => {
    setReadinessRefreshing(true);
    try {
      const res = await fetch('/api/pilot/readiness', {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await readResponseJson<ReadinessResponse>(res, { ok: false });
      if (res.status === 401) {
        setAccess('unauthenticated');
        return;
      }
      if (res.status === 403) {
        setAccess('uninvited');
        return;
      }
      if (!res.ok || !data.ok || !data.readiness) {
        setReadinessState('error');
        setReadinessMessage(data.message ?? 'Не удалось проверить готовность. Попробуйте позже.');
        return;
      }
      const nextState = data.readiness.state === 'ready'
        || data.readiness.state === 'not_ready'
        || data.readiness.state === 'error'
        ? data.readiness.state
        : 'error';
      setReadinessState(nextState);
      setReadinessMessage(data.readiness.messageRu ?? null);
    } catch {
      setReadinessState('error');
      setReadinessMessage('Не удалось проверить готовность. Попробуйте позже.');
    } finally {
      setReadinessRefreshing(false);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    const res = await fetch('/api/pilot/tasks', {
      cache: 'no-store',
      credentials: 'include',
    });
    const data = await readResponseJson<ListResponse>(res, { ok: false, tasks: [] });
    if (res.status === 401) {
      setAccess('unauthenticated');
      return;
    }
    if (res.status === 403) {
      setAccess('uninvited');
      return;
    }
    if (!res.ok || !data.ok) {
      setListError(data.message ?? 'Не удалось загрузить список задач.');
      return;
    }
    setListError(null);
    setTasks(Array.isArray(data.tasks) ? data.tasks : []);
  }, []);

  const loadTaskDetail = useCallback(async (taskId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/pilot/tasks/${encodeURIComponent(taskId)}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const data = await readResponseJson<DetailResponse>(res, { ok: false });
      if (res.status === 401) {
        setAccess('unauthenticated');
        return;
      }
      if (res.status === 403) {
        setAccess('uninvited');
        return;
      }
      if (!res.ok || !data.ok || !data.task) {
        setDetailError(data.message ?? 'Не удалось загрузить задачу.');
        setSelectedTask(null);
        setResult(null);
        return;
      }
      setDetailError(null);
      setSelectedTask(data.task);
      setResult(data.result ?? {
        outcome: null,
        summary: null,
        changedFiles: [],
        pullRequestUrl: null,
        commitSha: null,
        blockers: [],
      });
      setTasks((prev) => {
        const next = prev.filter((item) => item.taskId !== data.task!.taskId);
        return [data.task!, ...next];
      });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await checkSession();
      if (cancelled || !ok) return;
      await Promise.all([loadTasks(), loadReadiness()]);
    })();
    return () => {
      cancelled = true;
    };
  }, [checkSession, loadTasks, loadReadiness]);

  useEffect(() => {
    if (access !== 'ready' || !selectedTaskId) return;
    void loadTaskDetail(selectedTaskId);
  }, [access, selectedTaskId, loadTaskDetail]);

  const selectedConsoleStatus: PilotConsoleStatus | null =
    selectedTask?.consoleStatus
    ?? tasks.find((t) => t.taskId === selectedTaskId)?.consoleStatus
    ?? null;

  const hasActiveTasks = useMemo(
    () => tasks.some((task) => !isTerminalPilotConsoleStatus(task.consoleStatus)),
    [tasks],
  );

  usePilotTaskPolling({
    taskId: selectedTaskId,
    consoleStatus: selectedConsoleStatus,
    enabled: access === 'ready',
    onPoll: loadTaskDetail,
  });

  usePilotListPolling({
    enabled: access === 'ready',
    hasActiveTasks,
    onPoll: loadTasks,
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    if (readinessState !== 'ready') {
      setCreateError(readinessMessage ?? 'Сейчас нельзя создать новую задачу.');
      return;
    }
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      setCreateError('Укажите цель задачи.');
      return;
    }

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = createPilotIdempotencyKey();
    }

    setSubmitting(true);
    try {
      const body: Record<string, string> = {
        goal: trimmedGoal,
        idempotencyKey: idempotencyKeyRef.current,
      };
      const trimmedTitle = title.trim();
      if (trimmedTitle) body.title = trimmedTitle;

      const res = await fetch('/api/pilot/tasks', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readResponseJson<CreateResponse>(res, { ok: false });

      if (res.status === 401) {
        setAccess('unauthenticated');
        return;
      }
      if (res.status === 403) {
        setAccess('uninvited');
        return;
      }
      if (!res.ok || !data.ok || !data.taskId) {
        setCreateError(data.message ?? 'Не удалось создать задачу.');
        return;
      }

      idempotencyKeyRef.current = null;
      setTitle('');
      setGoal('');
      await loadTasks();
      selectTask(data.taskId);
    } catch {
      setCreateError('Не удалось создать задачу.');
    } finally {
      setSubmitting(false);
    }
  };

  if (access !== 'ready') {
    return (
      <PilotConsoleShell>
        <PilotAccessPanel state={access} message={accessMessage} />
      </PilotConsoleShell>
    );
  }

  return (
    <PilotConsoleShell>
      <div className="space-y-6">
        <p data-pilot-session-ready="true" className="text-sm text-slate-600">
          Доступ: <span className="font-medium text-slate-900">pilot_beta</span>. Здесь только
          создание и просмотр ваших задач.
        </p>

        <PilotReadinessBanner
          state={readinessState}
          messageRu={readinessMessage}
          refreshing={readinessRefreshing}
          onRefresh={() => {
            void loadReadiness();
          }}
        />

        <PilotCreateForm
          title={title}
          goal={goal}
          submitting={submitting}
          submissionEnabled={readinessState === 'ready'}
          error={createError}
          onTitleChange={setTitle}
          onGoalChange={setGoal}
          onSubmit={handleSubmit}
        />

        {listError ? (
          <p data-pilot-list-error="true" className="text-sm text-rose-700" role="alert">
            {listError}
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <PilotTaskList
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            empty={tasks.length === 0 && !listError}
            onSelect={selectTask}
          />
          <PilotTaskDetail
            task={selectedTask}
            result={result}
            loading={detailLoading}
            error={detailError}
          />
        </div>
      </div>
    </PilotConsoleShell>
  );
}
