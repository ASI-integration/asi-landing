import type { FormEvent, ReactNode } from 'react';
import type { PilotConsoleStatus } from '@/lib/pilot/status';
import {
  pilotConsoleStatusLabel,
  pilotConsoleStatusTone,
} from '@/lib/pilot/status-ui';
import { buildPilotResultCardModel } from '@/lib/pilot/result-card';

export type PilotTaskListItem = {
  taskId: string;
  title: string;
  status: string;
  consoleStatus: PilotConsoleStatus;
  repository?: string;
  createdAt: string;
  updatedAt: string;
};

export type PilotSafeResult = {
  outcome: 'succeeded' | 'failed' | null;
  summary: string | null;
  changedFiles: string[];
  pullRequestUrl: string | null;
  commitSha: string | null;
  blockers: string[];
};

export type PilotAccessState =
  | 'loading'
  | 'unauthenticated'
  | 'uninvited'
  | 'ready'
  | 'error';

const TONE_CLASS: Record<ReturnType<typeof pilotConsoleStatusTone>, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  active: 'bg-sky-50 text-sky-800 ring-sky-200',
  attention: 'bg-amber-50 text-amber-900 ring-amber-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  danger: 'bg-rose-50 text-rose-800 ring-rose-200',
};

export function PilotStatusBadge({ status }: { status: PilotConsoleStatus }) {
  const tone = pilotConsoleStatusTone(status);
  return (
    <span
      data-pilot-status={status}
      data-pilot-status-tone={tone}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASS[tone]}`}
    >
      {pilotConsoleStatusLabel(status)}
    </span>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU');
}

function shortId(taskId: string): string {
  return taskId.slice(0, 8);
}

export function PilotAccessPanel(props: {
  state: PilotAccessState;
  message?: string | null;
  loginHref?: string;
}) {
  const { state, message, loginHref = '/login?redirect=/pilot' } = props;

  if (state === 'loading') {
    return (
      <div data-pilot-access="loading" className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
      </div>
    );
  }

  if (state === 'unauthenticated') {
    return (
      <div
        data-pilot-access="unauthenticated"
        className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm"
      >
        <h1 className="text-xl font-semibold text-slate-900">Войдите в Pilot Console</h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          Для создания и просмотра задач пилота нужна авторизация.
        </p>
        <a
          href={loginHref}
          className="mt-5 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Войти
        </a>
      </div>
    );
  }

  if (state === 'uninvited') {
    return (
      <div
        data-pilot-access="uninvited"
        className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-6 text-center shadow-sm"
      >
        <h1 className="text-xl font-semibold text-slate-900">Нет доступа к пилоту</h1>
        <p className="mt-2 text-sm text-slate-700 leading-relaxed">
          Ваш аккаунт авторизован, но не приглашён в Strigunov Pilot. Обратитесь к владельцу ASI.
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div
        data-pilot-access="error"
        className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-rose-50 p-6 text-center shadow-sm"
      >
        <h1 className="text-xl font-semibold text-slate-900">Не удалось проверить доступ</h1>
        <p className="mt-2 text-sm text-slate-700 leading-relaxed">
          {message ?? 'Сервер временно недоступен. Попробуйте позже.'}
        </p>
      </div>
    );
  }

  return null;
}

export type PilotReadinessUiState = 'ready' | 'not_ready' | 'error' | 'loading';

export function PilotReadinessBanner(props: {
  state: PilotReadinessUiState;
  messageRu: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { state, messageRu, refreshing, onRefresh } = props;
  if (state === 'loading') {
    return (
      <div
        data-pilot-readiness="loading"
        className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm"
      >
        Проверяем готовность системы…
      </div>
    );
  }

  const tone =
    state === 'ready'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
      : state === 'not_ready'
        ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-rose-200 bg-rose-50 text-rose-950';

  return (
    <div
      data-pilot-readiness={state}
      data-pilot-can-submit={state === 'ready' ? 'true' : 'false'}
      className={`flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between ${tone}`}
    >
      <p data-pilot-readiness-message="true" className="leading-relaxed">
        {messageRu
          ?? (state === 'ready'
            ? 'Система готова к запуску задач пилота.'
            : 'Сейчас нельзя создать новую задачу. Попробуйте позже.')}
      </p>
      <button
        type="button"
        data-pilot-readiness-refresh="true"
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
      >
        {refreshing ? 'Обновление…' : 'Обновить'}
      </button>
    </div>
  );
}

export function PilotCreateForm(props: {
  title: string;
  goal: string;
  submitting: boolean;
  submissionEnabled: boolean;
  error: string | null;
  onTitleChange: (value: string) => void;
  onGoalChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const {
    title,
    goal,
    submitting,
    submissionEnabled,
    error,
    onTitleChange,
    onGoalChange,
    onSubmit,
  } = props;
  const fieldsDisabled = submitting || !submissionEnabled;

  return (
    <form
      data-pilot-create-form="true"
      data-pilot-create-enabled={submissionEnabled ? 'true' : 'false'}
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div>
        <h2 className="text-base font-semibold text-slate-900">Новая задача</h2>
        <p className="mt-1 text-sm text-slate-500">
          Опишите зелёную задачу (документация / proof под docs/pilot/).
        </p>
      </div>

      <div>
        <label htmlFor="pilot-title" className="block text-sm font-medium text-slate-800">
          Название <span className="font-normal text-slate-400">(необязательно)</span>
        </label>
        <input
          id="pilot-title"
          name="title"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          maxLength={200}
          disabled={fieldsDisabled}
          placeholder="Краткое название"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="pilot-goal" className="block text-sm font-medium text-slate-800">
          Цель
        </label>
        <textarea
          id="pilot-goal"
          name="goal"
          value={goal}
          onChange={(e) => onGoalChange(e.target.value)}
          maxLength={4000}
          required
          rows={5}
          disabled={fieldsDisabled}
          placeholder="Например: добавить proof markdown в docs/pilot/"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p data-pilot-create-error="true" className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={fieldsDisabled || !goal.trim()}
        className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Отправка…' : 'Создать задачу'}
      </button>
    </form>
  );
}

export function PilotTaskList(props: {
  tasks: PilotTaskListItem[];
  selectedTaskId: string | null;
  empty: boolean;
  onSelect: (taskId: string) => void;
}) {
  const { tasks, selectedTaskId, empty, onSelect } = props;

  return (
    <section data-pilot-task-list="true" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">Мои задачи</h2>
      </div>

      {empty ? (
        <p data-pilot-task-list-empty="true" className="px-5 py-8 text-sm text-slate-500">
          Пока нет задач. Создайте первую зелёную задачу выше.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tasks.map((task) => {
            const selected = task.taskId === selectedTaskId;
            return (
              <li key={task.taskId}>
                <button
                  type="button"
                  data-pilot-task-item={task.taskId}
                  data-pilot-task-selected={selected ? 'true' : 'false'}
                  onClick={() => onSelect(task.taskId)}
                  className={`flex w-full flex-col gap-2 px-5 py-4 text-left transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between ${
                    selected ? 'bg-slate-50' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{task.title}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-500">
                      {shortId(task.taskId)} · {formatDate(task.createdAt)}
                    </p>
                  </div>
                  <PilotStatusBadge status={task.consoleStatus} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function PilotTaskDetail(props: {
  task: PilotTaskListItem | null;
  result: PilotSafeResult | null;
  loading: boolean;
  error: string | null;
}) {
  const { task, result, loading, error } = props;
  const card = task
    ? buildPilotResultCardModel({
      consoleStatus: task.consoleStatus,
      result,
    })
    : null;

  if (!task && !loading && !error) {
    return (
      <section
        data-pilot-task-detail="empty"
        className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-sm text-slate-500"
      >
        Выберите задачу, чтобы увидеть статус и результат.
      </section>
    );
  }

  return (
    <section
      data-pilot-task-detail="true"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      {loading && !task ? (
        <p className="text-sm text-slate-500">Загрузка задачи…</p>
      ) : null}

      {error ? (
        <p data-pilot-detail-error="true" className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : null}

      {task && card ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">{task.title}</h2>
              <p className="mt-1 font-mono text-xs text-slate-500">{task.taskId}</p>
            </div>
            <PilotStatusBadge status={task.consoleStatus} />
          </div>

          <div
            data-pilot-result-card={card.kind}
            data-pilot-user-action-required={card.userActionRequired ? 'true' : 'false'}
            className={
              card.kind === 'succeeded'
                ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950'
                : card.kind === 'blocked'
                  ? 'rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950'
                  : card.kind === 'failed'
                    ? 'rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950'
                    : 'rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700'
            }
          >
            <p className="font-medium" data-pilot-result-headline="true">
              {card.headlineRu}
            </p>
            <p className="mt-1" data-pilot-result-next-action="true">
              {card.nextActionRu}
            </p>
          </div>

          {card.kind === 'succeeded' || card.kind === 'failed' || card.kind === 'blocked' ? (
            <div data-pilot-result="true" className="space-y-3 border-t border-slate-100 pt-4">
              {card.outcomeLabelRu ? (
                <p className="text-sm text-slate-700">
                  <span className="font-medium text-slate-900">Итог:</span>{' '}
                  <span data-pilot-result-outcome={result?.outcome ?? card.kind}>
                    {card.outcomeLabelRu}
                  </span>
                </p>
              ) : null}

              {card.summaryRu ? (
                <p data-pilot-result-summary="true" className="text-sm leading-relaxed text-slate-700">
                  {card.summaryRu}
                </p>
              ) : null}

              {card.changedFiles.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Изменённые файлы
                  </p>
                  <ul data-pilot-result-files="true" className="mt-1 space-y-1">
                    {card.changedFiles.map((file) => (
                      <li key={file} className="break-all font-mono text-xs text-slate-700">
                        {file}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {card.pullRequestUrl ? (
                <p className="text-sm">
                  <a
                    data-pilot-result-pr="true"
                    href={card.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-sky-700 underline-offset-2 hover:underline"
                  >
                    Открыть pull request
                  </a>
                </p>
              ) : null}

              {card.commitSha ? (
                <p className="break-all font-mono text-xs text-slate-600" data-pilot-result-sha="true">
                  commit {card.commitSha}
                </p>
              ) : null}

              {card.blockers.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
                    Блокеры
                  </p>
                  <ul
                    data-pilot-result-blockers="true"
                    className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700"
                  >
                    {card.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p data-pilot-result-pending="true" className="text-sm text-slate-500">
              Результат ещё не готов. Статус обновится автоматически.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}

export function PilotConsoleShell(props: {
  children: ReactNode;
}) {
  return (
    <div
      data-pilot-console="true"
      className="min-h-screen overflow-x-hidden bg-slate-50 text-slate-900"
    >
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">ASI Pilot</p>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Pilot Console</h1>
          </div>
          <a href="/" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            ASI
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{props.children}</main>
    </div>
  );
}
