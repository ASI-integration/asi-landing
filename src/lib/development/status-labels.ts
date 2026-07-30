import type { RuntimeBridgeTaskStatus } from '@/lib/asi-runtime/bridge-types';

export const DEVELOPMENT_STATUS_LABELS: Record<RuntimeBridgeTaskStatus, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  awaiting_owner: 'Требуется решение владельца',
  completed: 'Завершено',
  failed: 'Ошибка',
};

export function developmentStageText(status: RuntimeBridgeTaskStatus): string {
  switch (status) {
    case 'queued':
      return 'Задача принята Runtime Bridge и ожидает runner.';
    case 'running':
      return 'Runner выполняет задачу в disposable worktree.';
    case 'awaiting_owner':
      return 'Нужно явное решение владельца по owner gate.';
    case 'completed':
      return 'Задача завершена. Ниже безопасный итог.';
    case 'failed':
      return 'Задача завершилась с ошибкой. Ниже безопасный итог.';
    default:
      return 'Статус обновляется.';
  }
}
