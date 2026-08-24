import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type {
  RuntimeBridgeSafeResult,
  RuntimeBridgeTaskStatus,
} from '@/lib/asi-runtime/bridge-types';
import { safeAllowlistedPullRequestUrl } from '@/lib/development/pr-url';
import {
  type ControlRoomColorTone,
  developmentOwnerSemantics,
  developmentStageText,
  developmentStatusBadgeText,
  developmentStatusTone,
} from '@/lib/development/status-labels';

export const CONTROL_ROOM_TONE_TEXT: Record<ControlRoomColorTone, string> = {
  neutral: 'text-slate-700',
  blue: 'text-sky-800',
  orange: 'text-amber-900',
  green: 'text-emerald-900',
  red: 'text-red-900',
};

export const CONTROL_ROOM_TONE_SURFACE: Record<ControlRoomColorTone, string> = {
  neutral: 'border-slate-200 bg-slate-100 text-slate-800',
  blue: 'border-sky-300 bg-sky-100 text-sky-950',
  orange: 'border-amber-300 bg-amber-100 text-amber-950',
  green: 'border-emerald-300 bg-emerald-100 text-emerald-950',
  red: 'border-red-300 bg-red-100 text-red-950',
};

export const CONTROL_ROOM_TONE_SOLID: Record<ControlRoomColorTone, string> = {
  neutral: 'border-slate-300 bg-slate-700 text-white hover:bg-slate-800',
  blue: 'border-sky-600 bg-sky-600 text-white hover:bg-sky-700',
  orange: 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600',
  green: 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700',
  red: 'border-red-600 bg-red-600 text-white hover:bg-red-700',
};

export const CONTROL_ROOM_TONE_IDLE: Record<ControlRoomColorTone, string> = {
  neutral: 'border-slate-200 bg-white text-slate-500',
  blue: 'border-sky-100 bg-white text-sky-400',
  orange: 'border-amber-100 bg-white text-amber-400',
  green: 'border-emerald-100 bg-white text-emerald-400',
  red: 'border-red-100 bg-white text-red-400',
};

export const DEVELOPMENT_STATUS_COLOR_CLASS = {
  queued: CONTROL_ROOM_TONE_TEXT.neutral,
  running: CONTROL_ROOM_TONE_TEXT.blue,
  awaiting_owner: CONTROL_ROOM_TONE_TEXT.orange,
  completed: CONTROL_ROOM_TONE_TEXT.green,
  failed: CONTROL_ROOM_TONE_TEXT.red,
} as const satisfies Record<RuntimeBridgeTaskStatus, string>;

export const DEVELOPMENT_STATUS_BADGE_CLASS = {
  queued: CONTROL_ROOM_TONE_SURFACE.neutral,
  running: CONTROL_ROOM_TONE_SURFACE.blue,
  awaiting_owner: CONTROL_ROOM_TONE_SURFACE.orange,
  completed: CONTROL_ROOM_TONE_SURFACE.green,
  failed: CONTROL_ROOM_TONE_SURFACE.red,
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
      className={`inline-flex items-center rounded-lg border px-3 py-1 text-sm font-semibold ${DEVELOPMENT_STATUS_BADGE_CLASS[status]}`}
      data-task-status={status}
      data-owner-semantics={semantics ?? undefined}
    >
      <span aria-hidden="true">{label}</span>
    </span>
  );
}

type ControlRoomTileProps = {
  label: string;
  tone: ControlRoomColorTone;
  active?: boolean;
  hint?: string;
  'data-testid'?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/** Large control-panel tile: action button or lit status indicator. */
export function ControlRoomTile({
  label,
  tone,
  active = false,
  hint,
  className = '',
  type = 'button',
  disabled,
  ...props
}: ControlRoomTileProps) {
  const surface = active
    ? CONTROL_ROOM_TONE_SOLID[tone]
    : disabled
      ? CONTROL_ROOM_TONE_IDLE[tone]
      : `${CONTROL_ROOM_TONE_SURFACE[tone]} hover:brightness-[0.98]`;
  const clickable = !disabled && typeof props.onClick === 'function';

  return (
    <button
      type={type}
      disabled={disabled}
      aria-pressed={active || undefined}
      className={[
        'flex min-h-[5.5rem] flex-col items-start justify-between rounded-2xl border-2 px-4 py-3 text-left transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900',
        surface,
        disabled ? 'cursor-not-allowed opacity-70' : clickable ? 'cursor-pointer' : 'cursor-default',
        className,
      ].join(' ')}
      data-control-room-tile={tone}
      data-control-room-active={active ? 'true' : 'false'}
      {...props}
    >
      <span className="text-base font-bold leading-tight sm:text-lg">{label}</span>
      {hint ? <span className="mt-2 text-xs font-medium opacity-80">{hint}</span> : null}
    </button>
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
  const tone = developmentStatusTone(task.status);

  return (
    <section
      aria-labelledby="development-task-card-title"
      className={`space-y-3 rounded-2xl border-2 p-4 sm:p-5 ${CONTROL_ROOM_TONE_SURFACE[tone]}`}
      data-development-task-card="true"
      data-control-room-tone={tone}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h2
            id="development-task-card-title"
            className="text-lg font-bold text-slate-950"
            data-task-title="true"
          >
            {task.title}
          </h2>
          <TaskStatusBadge status={task.status} />
        </div>
        <p className="text-xs font-medium opacity-70" data-task-updated-at="true">
          {formatDevelopmentTimestamp(task.updatedAt)}
        </p>
      </div>

      <p className="text-sm font-semibold" data-task-stage="true">
        {stage}
      </p>

      <p className="line-clamp-2 text-sm opacity-90" data-task-summary="true">
        {summary}
      </p>

      {pullRequestUrl ? (
        <a
          href={pullRequestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
          data-task-pr-link="true"
        >
          Открыть PR
        </a>
      ) : null}

      <details className="rounded-xl border border-black/10 bg-white/70 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Подробнее</summary>
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
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Итог: {result.status}
      </p>

      <DetailBlock title="Файлы">
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
