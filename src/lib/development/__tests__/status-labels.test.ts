import { describe, expect, it } from 'vitest';
import type { RuntimeBridgeTaskStatus } from '@/lib/asi-runtime/bridge-types';
import {
  DEVELOPMENT_STATUS_LABELS,
  developmentOwnerSemantics,
  developmentStageText,
  developmentStatusBadgeText,
  developmentStatusTone,
} from '@/lib/development/status-labels';

const STATUSES: RuntimeBridgeTaskStatus[] = [
  'queued',
  'running',
  'awaiting_owner',
  'completed',
  'failed',
];

describe('Control Room status labels', () => {
  it('maps every Bridge status to a short Russian control-panel label', () => {
    expect(DEVELOPMENT_STATUS_LABELS).toEqual({
      queued: 'В очереди',
      running: 'В работе',
      awaiting_owner: 'Нужна помощь',
      completed: 'Готово к проверке',
      failed: 'Остановлено',
    });
  });

  it.each([
    ['queued', null, 'neutral'],
    ['running', null, 'blue'],
    ['awaiting_owner', 'READY', 'orange'],
    ['completed', 'READY', 'green'],
    ['failed', 'BLOCKED', 'red'],
  ] as const)('maps %s to semantics %s and tone %s', (status, semantics, tone) => {
    expect(developmentOwnerSemantics(status)).toBe(semantics);
    expect(developmentStatusTone(status)).toBe(tone);
    expect(developmentStatusBadgeText(status)).toBe(DEVELOPMENT_STATUS_LABELS[status]);
  });

  it.each(STATUSES)('keeps stage copy to one short line for %s', (status) => {
    const stage = developmentStageText(status);
    expect(stage.length).toBeLessThan(40);
    expect(stage.includes('.')).toBe(false);
  });
});
