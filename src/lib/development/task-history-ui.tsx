import type { RuntimeBridgeTaskStatus } from '@/lib/asi-runtime/bridge-types';
import {
  TaskStatusBadge,
  formatDevelopmentTimestamp,
} from '@/lib/development/task-status-ui';

export type DevelopmentTaskHistoryItemModel = {
  taskId: string;
  title: string;
  status: RuntimeBridgeTaskStatus;
  provider: string | null;
  updatedAt: string;
  needsOwnerAttention: boolean;
};

type DevelopmentTaskHistoryPanelProps = {
  tasks: DevelopmentTaskHistoryItemModel[];
  activeTaskId?: string | null;
  onSelect: (taskId: string) => void;
};

function providerLabel(provider: string | null): string | null {
  if (!provider) return null;
  const trimmed = provider.trim();
  if (!trimmed) return null;
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

export function DevelopmentTaskHistoryPanel({
  tasks,
  activeTaskId,
  onSelect,
}: DevelopmentTaskHistoryPanelProps) {
  return (
    <section
      aria-labelledby="control-room-task-history-title"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-control-room-task-history
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="control-room-task-history-title" className="text-sm font-semibold text-slate-900">
          Задачи
        </h2>
        <span className="text-xs text-slate-500">{tasks.length}</span>
      </div>

      {tasks.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600" data-control-room-task-history-empty>
          Пока нет задач. Создайте первую через форму ниже.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {tasks.map((item) => {
            const selected = activeTaskId === item.taskId;
            const provider = providerLabel(item.provider);
            return (
              <li key={item.taskId}>
                <button
                  type="button"
                  onClick={() => onSelect(item.taskId)}
                  aria-current={selected ? 'true' : undefined}
                  data-control-room-task-history-item={item.taskId}
                  className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-sky-300 bg-sky-50'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">{item.title}</span>
                      {item.needsOwnerAttention ? (
                        <span
                          className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800"
                          data-owner-attention
                        >
                          Нужно решение
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                      <TaskStatusBadge status={item.status} />
                      {provider ? <span>{provider}</span> : null}
                      <span>{formatDevelopmentTimestamp(item.updatedAt)}</span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
