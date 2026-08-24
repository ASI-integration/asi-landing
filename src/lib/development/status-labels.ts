import type { RuntimeBridgeTaskStatus } from '@/lib/asi-runtime/bridge-types';

/** Owner-facing RU labels for the Control Room task lifecycle. */
export const DEVELOPMENT_STATUS_LABELS: Record<RuntimeBridgeTaskStatus, string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  awaiting_owner: 'Нужно решение',
  completed: 'Готово',
  failed: 'Заблокировано',
};

/**
 * READY/BLOCKED-style owner semantics layered on top of the durable Bridge statuses.
 * queued/running stay process states; terminal and gate states map to READY/BLOCKED.
 */
export type DevelopmentOwnerSemantics = 'READY' | 'BLOCKED';

export function developmentOwnerSemantics(
  status: RuntimeBridgeTaskStatus,
): DevelopmentOwnerSemantics | null {
  switch (status) {
    case 'awaiting_owner':
    case 'completed':
      return 'READY';
    case 'failed':
      return 'BLOCKED';
    default:
      return null;
  }
}

export function developmentStatusBadgeText(status: RuntimeBridgeTaskStatus): string {
  const label = DEVELOPMENT_STATUS_LABELS[status] ?? status;
  const semantics = developmentOwnerSemantics(status);
  return semantics ? `${label} · ${semantics}` : label;
}

export function developmentStageText(status: RuntimeBridgeTaskStatus): string {
  switch (status) {
    case 'queued':
      return 'Задача принята и ждёт запуска.';
    case 'running':
      return 'Задача выполняется.';
    case 'awaiting_owner':
      return 'Система готова к вашему решению (READY). Без него задача не продолжится.';
    case 'completed':
      return 'Результат готов (READY). Ниже безопасный итог.';
    case 'failed':
      return 'Задача заблокирована (BLOCKED). Ниже безопасный итог.';
    default:
      return 'Статус обновляется.';
  }
}
