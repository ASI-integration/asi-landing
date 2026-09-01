import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuntimeBridgeSafeResult, RuntimeBridgeTaskStatus } from '@/lib/asi-runtime/bridge-types';
import { developmentStageText } from '@/lib/development/status-labels';
import {
  DEVELOPMENT_STATUS_BADGE_CLASS,
  DevelopmentTaskCard,
  TaskStatusBadge,
  compactTaskSummary,
  developmentStatusAriaLabel,
  developmentStatusLabel,
  pullRequestUrlFromResult,
} from '@/lib/development/task-status-ui';

const STATUSES: RuntimeBridgeTaskStatus[] = [
  'queued',
  'running',
  'awaiting_owner',
  'completed',
  'failed',
];

const RESULT_WITH_PR: RuntimeBridgeSafeResult = {
  schemaVersion: 'asi.runtime.result.v1',
  status: 'completed',
  summary: 'Черновик PR готов к проверке.',
  changedFiles: ['src/app/dashboard/development/DevelopmentConsoleClient.tsx'],
  checks: [{ name: 'typecheck', status: 'PASS' }],
  artifacts: [
    { type: 'commit', value: 'a'.repeat(40) },
    {
      type: 'pull_request',
      value: 'https://github.com/ASI-integration/asi-landing/pull/42',
    },
  ],
  blockers: [],
};

describe('development task status UI', () => {
  it.each(STATUSES)('maps %s status badge with color and accessible label', (status) => {
    const html = renderToStaticMarkup(React.createElement(TaskStatusBadge, { status }));

    expect(html).toContain(`data-task-status="${status}"`);
    expect(html).toContain(developmentStatusLabel(status));
    expect(html).toContain(`aria-label="${developmentStatusAriaLabel(status)}"`);
    expect(html).toContain(DEVELOPMENT_STATUS_BADGE_CLASS[status]);
    expect(html).toContain('role="status"');
  });

  it('renders a compact card with title, stage, summary, updated time and PR link', () => {
    const html = renderToStaticMarkup(
      React.createElement(DevelopmentTaskCard, {
        task: {
          title: 'Улучшить карточку задачи',
          status: 'completed',
          updatedAt: '2026-08-02T12:00:00.000Z',
          taskId: '11111111-1111-4111-8111-111111111111',
          repository: 'ASI-integration/asi-landing',
          attemptCount: 2,
          createdAt: '2026-08-02T11:00:00.000Z',
          chatgptTaskId: 'dev-console-task-abc',
          conversationId: 'dev-console-owner-xyz',
          result: RESULT_WITH_PR,
        },
      }),
    );

    expect(html).toContain('data-development-task-card="true"');
    expect(html).toContain('data-task-terminal-headline="completed"');
    expect(html).toContain('ЗАВЕРШЕНО');
    expect(html).toContain('data-task-title="true"');
    expect(html).toContain('Улучшить карточку задачи');
    expect(html).not.toContain('data-task-stage="true"');
    expect(html).toContain('data-task-summary="true"');
    expect(html).toContain('Черновик PR готов к проверке.');
    expect(html).toContain('data-task-updated-at="true"');
    expect(html).toContain('data-task-pr-link="true"');
    expect(html).toContain('Открыть PR');
    expect(html).toContain('data-task-commit-sha="true"');
    expect(html).toContain('https://github.com/ASI-integration/asi-landing/pull/42');
    expect(html).toContain('Подробнее');
    expect(html).toContain('taskId');
    expect(html).toContain('11111111-1111-4111-8111-111111111111');
    expect(html).toContain('a'.repeat(40));
  });

  it('renders large failed headline and keeps PR/commit outside details', () => {
    const html = renderToStaticMarkup(
      React.createElement(DevelopmentTaskCard, {
        task: {
          title: 'Задача с ошибкой',
          status: 'failed',
          updatedAt: '2026-08-02T12:00:00.000Z',
          taskId: '33333333-3333-4333-8333-333333333333',
          repository: 'ASI-integration/asi-landing',
          attemptCount: 1,
          createdAt: '2026-08-02T11:00:00.000Z',
          result: RESULT_WITH_PR,
        },
      }),
    );

    expect(html).toContain('data-task-terminal-headline="failed"');
    expect(html).toContain('ОШИБКА');
    expect(html).toContain('data-task-pr-link="true"');
    expect(html).toContain('data-task-commit-sha="true"');
  });

  it('keeps technical identifiers inside the collapsed details block', () => {
    const html = renderToStaticMarkup(
      React.createElement(DevelopmentTaskCard, {
        task: {
          title: 'Компактный статус',
          status: 'running',
          updatedAt: '2026-08-02T12:00:00.000Z',
          taskId: '22222222-2222-4222-8222-222222222222',
          repository: 'ASI-integration/asi-landing',
          attemptCount: 1,
          createdAt: '2026-08-02T11:30:00.000Z',
          result: null,
        },
      }),
    );

    const detailsStart = html.indexOf('<details');
    const summaryEnd = html.indexOf('</summary>');
    expect(detailsStart).toBeGreaterThan(-1);
    expect(summaryEnd).toBeGreaterThan(detailsStart);

    const visiblePrefix = html.slice(0, detailsStart);
    expect(visiblePrefix).toContain('Компактный статус');
    expect(visiblePrefix).toContain(developmentStageText('running'));
    expect(visiblePrefix).not.toContain('22222222-2222-4222-8222-222222222222');
    expect(visiblePrefix).not.toContain('Попытки');
    expect(html.slice(summaryEnd)).toContain('22222222-2222-4222-8222-222222222222');
    expect(html.slice(summaryEnd)).toContain('Попытки');
  });

  it('falls back to stage text when result summary is absent', () => {
    expect(compactTaskSummary({ status: 'queued', result: null })).toBe(
      developmentStageText('queued'),
    );
  });

  it('extracts only allowlisted pull request URLs', () => {
    expect(pullRequestUrlFromResult(RESULT_WITH_PR)).toBe(
      'https://github.com/ASI-integration/asi-landing/pull/42',
    );
    expect(
      pullRequestUrlFromResult({
        ...RESULT_WITH_PR,
        artifacts: [{ type: 'pull_request', value: 'https://evil.example/pull/1' }],
      }),
    ).toBeNull();
  });
});
