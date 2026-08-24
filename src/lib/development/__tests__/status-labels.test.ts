import { describe, expect, it } from 'vitest';
import type { RuntimeBridgeTaskStatus } from '@/lib/asi-runtime/bridge-types';
import {
  DEVELOPMENT_STATUS_LABELS,
  developmentOwnerSemantics,
  developmentStageText,
  developmentStatusBadgeText,
} from '@/lib/development/status-labels';

const STATUSES: RuntimeBridgeTaskStatus[] = [
  'queued',
  'running',
  'awaiting_owner',
  'completed',
  'failed',
];

describe('Control Room status labels', () => {
  it('maps every Bridge status to a clear Russian owner label', () => {
    expect(DEVELOPMENT_STATUS_LABELS).toEqual({
      queued: 'В очереди',
      running: 'Выполняется',
      awaiting_owner: 'Нужно решение',
      completed: 'Готово',
      failed: 'Заблокировано',
    });
  });

  it.each([
    ['queued', null],
    ['running', null],
    ['awaiting_owner', 'READY'],
    ['completed', 'READY'],
    ['failed', 'BLOCKED'],
  ] as const)('maps %s to owner semantics %s', (status, semantics) => {
    expect(developmentOwnerSemantics(status)).toBe(semantics);
  });

  it.each(STATUSES)('badge text for %s includes RU label and READY/BLOCKED when applicable', (status) => {
    const badge = developmentStatusBadgeText(status);
    expect(badge).toContain(DEVELOPMENT_STATUS_LABELS[status]);
    const semantics = developmentOwnerSemantics(status);
    if (semantics) {
      expect(badge).toContain(`· ${semantics}`);
    } else {
      expect(badge).toBe(DEVELOPMENT_STATUS_LABELS[status]);
    }
  });

  it('keeps stage copy owner-facing and READY/BLOCKED-aware', () => {
    expect(developmentStageText('queued')).toBe('Задача принята и ждёт запуска.');
    expect(developmentStageText('running')).toBe('Задача выполняется.');
    expect(developmentStageText('awaiting_owner')).toContain('READY');
    expect(developmentStageText('completed')).toContain('READY');
    expect(developmentStageText('failed')).toContain('BLOCKED');
  });
});
