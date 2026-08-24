import type { ReactNode } from 'react';
import type {
  RuntimeBridgeSafeResult,
  RuntimeBridgeTaskStatus,
} from '@/lib/asi-runtime/bridge-types';
import { safeAllowlistedPullRequestUrl } from '@/lib/development/pr-url';
import {
  developmentOwnerSemantics,
  developmentStageText,
  developmentStatusBadgeText,
} from '@/lib/development/status-labels';

export const DEVELOPMENT_STATUS_COLOR_CLASS = {
  queued: 'text-slate-700',
  running: 'text-sky-700',
  awaiting_owner: 'text-amber-700',
  completed: 'text-emerald-700',
  failed: 'text-red-700',
} as const satisfies Record<RuntimeBridgeTaskStatus, string>;

export const DEVELOPMENT_STATUS_BADGE_CLASS = {
  queued: 'border-slate-200 bg-slate-50 text-slate-700',
  running: 'border-sky-200 bg-sky-50 text-sky-800',
  awaiting_owner: 'border-amber-200 bg-amber-50 text-amber-800',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  failed: 'border-red-200 bg-red-50 text-red-800',
} as const satisfies Record<RuntimeBridgeTaskStatus, string>;

export function developmentStatusLabel(status: RuntimeBridgeTaskStatus): string {
  return developmentStatusBadgeText(status);
}

export function developmentStatusAriaLabel(status: RuntimeBridgeTaskStatus): string {
  return `Статус задачи: ${developmentStatusLabel(status)}`;
}

export function developmentStatusColorClass(status: RuntimeBridgeTaskStatus): string {
  return DEVELOPMENT_STATUS_COLOR_CLASS[status];
}

export function pullRequestUrlFromResult(
  result: RuntimeBridgeSafeResult | null | undefined,
): string | null {
  if (!result) return null;
  for (const artifact of result.artifacts) {
    if (artifact.type !== 'pull_request') continue;
    const safeUrl = safeAllowlistedPullRequestUrl(artifact.value);
    if (safeUrl) return safeUrl;
  }
  return null;
}

export function commitShaFromResult(
  result: RuntimeBridgeSafeResult | null | undefined,
): string | null {
  if (!result) return null;
  for (const artifact of result.artifacts) {
    if (artifact.type === 'commit' && artifact.value.trim()) {
      return artifact.value.trim();
    }
  }
  return null;
}

export function compactTaskSummary(input: {
  status: RuntimeBridgeTaskStatus;
  result: RuntimeBridgeSafeResult | null | undefined;
}): string {
  const summary = input.result?.summary?.trim();
  if (summary) return summary;
  return developmentStageText(input.status);
}

export function formatDevelopmentTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU');
}

type TaskStatusBadgeProps = {
  status: RuntimeBridgeTaskStatus;
};

export function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  const label = developmentStatusLabel(status);
  const semantics = developmentOwnerSemantics(status);
  return (
    <span
      role="status"
      aria-label={developmentStatusAriaLabel(status)}
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${DEVELOPMENT_STATUS_BADGE_CLASS[status]}`}
      data-task-status={status}
      data-owner-semantics={semantics ?? undefined}
    >
      <span aria-hidden="true">{label}</span>
    </span>
  );
}

export type DevelopmentTaskCardModel = {
  title: string;
  status: RuntimeBridgeTaskStatus;
  updatedAt: string;
  taskId: string;
  repository: string;
  attemptCount: number;
  createdAt: string;
  chatgptTaskId?: string;
  conversationId?: string;
  result: RuntimeBridgeSafeResult | null;
};

type DevelopmentTaskCardProps = {
  task: DevelopmentTaskCardModel;
};

export function DevelopmentTaskCard({ task }: DevelopmentTaskCardProps) {
  const summary = compactTaskSummary({ status: task.status, result: task.result });
  const pullRequestUrl = pullRequestUrlFromResult(task.result);
  const commitSha = commitShaFromResult(task.result);
  const stage = developmentStageText(task.status);

  return (
    <section
      aria-labelledby="development-task-card-title"
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      data-development-task-card="true"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h2
            id="development-task-card-title"
            className="text-lg font-semibold text-slate-900"
            data-task-title="true"
          >
            {task.title}
          </h2>
          <TaskStatusBadge status={task.status} />
        </div>
        <p className="text-xs text-slate-500" data-task-updated-at="true">
          Обновлено: {formatDevelopmentTimestamp(task.updatedAt)}
        </p>
      </div>

      <p className="text-sm text-slate-700" data-task-stage="true">
        {stage}
      </p>

      <p className="text-sm text-slate-800" data-task-summary="true">
        {summary}
      </p>

      {pullRequestUrl ? (
        <a
          href={pullRequestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          data-task-pr-link="true"
        >
          Открыть PR
        </a>
      ) : null}

      <details className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Подробнее</summary>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <DetailField label="taskId" value={task.taskId} mono />
          <DetailField label="Репозиторий" value={task.repository} />
          <DetailField label="Попытки" value={String(task.attemptCount)} />
          <DetailField label="Создано" value={formatDevelopmentTimestamp(task.createdAt)} />
          {commitSha ? <DetailField label="Commit SHA" value={commitSha} mono /> : null}
          {task.chatgptTaskId ? (
            <DetailField label="chatgptTaskId" value={task.chatgptTaskId} mono />
          ) : null}
          {task.conversationId ? (
            <DetailField label="conversationId" value={task.conversationId} mono />
          ) : null}
        </dl>

        {task.result ? <SafeResultDetails result={task.result} /> : null}
      </details>
    </section>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`mt-0.5 break-all text-slate-900 ${mono ? 'font-mono text-xs sm:text-sm' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function SafeResultDetails({ result }: { result: RuntimeBridgeSafeResult }) {
  return (
    <div className="mt-4 space-y-3 border-t border-slate-200 pt-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Итог Runtime: {result.status}
      </p>

      <DetailBlock title="Изменённые файлы">
        {result.changedFiles.length === 0 ? (
          <p className="text-sm text-slate-500">Нет</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
            {result.changedFiles.map((file) => (
              <li key={file} className="break-all font-mono text-xs sm:text-sm">
                {file}
              </li>
            ))}
          </ul>
        )}
      </DetailBlock>

      <DetailBlock title="Проверки">
        {result.checks.length === 0 ? (
          <p className="text-sm text-slate-500">Нет</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {result.checks.map((check, index) => (
              <li key={`${check.name}-${index}`} className="rounded-md bg-white px-3 py-2">
                <span className="font-medium text-slate-900">{check.name}</span>
                <span className="ml-2 text-slate-600">{check.status}</span>
                {check.detail ? <p className="mt-1 text-slate-600">{check.detail}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </DetailBlock>

      <DetailBlock title="Артефакты">
        {result.artifacts.length === 0 ? (
          <p className="text-sm text-slate-500">Нет</p>
        ) : (
          <ul className="space-y-2 text-sm text-slate-800">
            {result.artifacts.map((artifact, index) => (
              <li key={`${artifact.type}-${index}`} className="break-all font-mono text-xs sm:text-sm">
                {artifact.type}: {artifact.value}
              </li>
            ))}
          </ul>
        )}
      </DetailBlock>

      <DetailBlock title="Блокеры">
        {result.blockers.length === 0 ? (
          <p className="text-sm text-slate-500">Нет</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
            {result.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}
      </DetailBlock>
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}
