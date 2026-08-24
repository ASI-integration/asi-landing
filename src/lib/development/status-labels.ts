import type { RuntimeBridgeTaskStatus } from '@/lib/asi-runtime/bridge-types';

/** Short owner-facing RU labels for the Control Room panel. */
export const DEVELOPMENT_STATUS_LABELS: Record<RuntimeBridgeTaskStatus, string> = {
  queued: 'В очереди',
  running: 'В работе',
  awaiting_owner: 'Нужна помощь',
  completed: 'Готово к проверке',
  failed: 'Остановлено',
};

/**
 * READY/BLOCKED-style owner semantics layered on Bridge statuses.
 * Used for data attributes and tests; the visible badge stays short Russian.
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
  return DEVELOPMENT_STATUS_LABELS[status] ?? status;
}

/** One-line status for the control panel — no paragraphs. */
export function developmentStageText(status: RuntimeBridgeTaskStatus): string {
  switch (status) {
    case 'queued':
      return 'Ждёт запуска';
    case 'running':
      return 'Выполняется сейчас';
    case 'awaiting_owner':
      return 'Нужно ваше решение';
    case 'completed':
      return 'Можно проверить итог';
    case 'failed':
      return 'Остановлено с ошибкой';
    default:
      return 'Статус обновляется';
  }
}

/** Visual category for consistent panel coloring. */
export type ControlRoomColorTone = 'neutral' | 'blue' | 'orange' | 'green' | 'red';

export function developmentStatusTone(status: RuntimeBridgeTaskStatus): ControlRoomColorTone {
  switch (status) {
    case 'queued':
      return 'neutral';
    case 'running':
      return 'blue';
    case 'awaiting_owner':
      return 'orange';
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    default:
      return 'neutral';
  }
}
