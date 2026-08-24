import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeBridgeTaskStatus } from '@/lib/asi-runtime/bridge-types';
import {
  DevelopmentTaskHistoryPanel,
  type DevelopmentTaskHistoryItemModel,
} from '@/lib/development/task-history-ui';

function item(
  overrides: Partial<DevelopmentTaskHistoryItemModel> & Pick<DevelopmentTaskHistoryItemModel, 'taskId' | 'status' | 'title'>,
): DevelopmentTaskHistoryItemModel {
  return {
    provider: 'ASI-integration/asi-landing',
    updatedAt: '2026-07-30T12:00:00.000Z',
    needsOwnerAttention: false,
    ...overrides,
  };
}

describe('DevelopmentTaskHistoryPanel', () => {
  it('handles empty history safely', () => {
    const html = renderToStaticMarkup(<DevelopmentTaskHistoryPanel tasks={[]} onSelect={vi.fn()} />);
    expect(html).toContain('Задачи');
    expect(html).toContain('data-control-room-task-history-empty');
    expect(html).toContain('Пока нет задач');
  });

  it('renders failed, completed, and awaiting_owner states compactly', () => {
    const tasks: DevelopmentTaskHistoryItemModel[] = [
      item({ taskId: 'task-failed', title: 'Failed task', status: 'failed' }),
      item({ taskId: 'task-done', title: 'Completed task', status: 'completed' }),
      item({
        taskId: 'task-await',
        title: 'Awaiting owner',
        status: 'awaiting_owner',
        needsOwnerAttention: true,
      }),
    ];

    const html = renderToStaticMarkup(
      <DevelopmentTaskHistoryPanel tasks={tasks} activeTaskId="task-done" onSelect={vi.fn()} />,
    );

    expect(html).toContain('Failed task');
    expect(html).toContain('Completed task');
    expect(html).toContain('Awaiting owner');
    expect(html).toContain('data-task-status="failed"');
    expect(html).toContain('data-task-status="completed"');
    expect(html).toContain('data-task-status="awaiting_owner"');
    expect(html).toContain('data-owner-attention');
    expect(html).toContain('asi-landing');
    expect(html).toContain('aria-current="true"');
  });

  it('exposes task ids for the existing detail entry point', () => {
    const tasks = [item({ taskId: 'task-1', title: 'Pick me', status: 'running' as RuntimeBridgeTaskStatus })];
    const html = renderToStaticMarkup(<DevelopmentTaskHistoryPanel tasks={tasks} onSelect={vi.fn()} />);
    expect(html).toContain('data-control-room-task-history-item="task-1"');
    expect(html).toContain('Pick me');
  });
});
