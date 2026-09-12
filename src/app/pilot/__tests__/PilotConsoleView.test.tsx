import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  PilotAccessPanel,
  PilotConsoleShell,
  PilotCreateForm,
  PilotReadinessBanner,
  PilotStatusBadge,
  PilotTaskDetail,
  PilotTaskList,
} from '../PilotConsoleView';
import { PILOT_CONSOLE_STATUS_LABELS } from '@/lib/pilot/status-ui';
import type { PilotConsoleStatus } from '@/lib/pilot/status';

const STATUSES: PilotConsoleStatus[] = [
  'queued',
  'running',
  'blocked',
  'succeeded',
  'failed',
];

describe('SP-05 Pilot Console UI', () => {
  it('renders console shell branding', () => {
    const html = renderToStaticMarkup(
      React.createElement(PilotConsoleShell, null, React.createElement('div', null, 'body')),
    );
    expect(html).toContain('data-pilot-console="true"');
    expect(html).toContain('Pilot Console');
    expect(html).toContain('ASI Pilot');
  });

  it('handles unauthenticated and uninvited access states', () => {
    const unauth = renderToStaticMarkup(
      React.createElement(PilotAccessPanel, { state: 'unauthenticated' }),
    );
    expect(unauth).toContain('data-pilot-access="unauthenticated"');
    expect(unauth).toContain('/login?redirect=/pilot');

    const uninvited = renderToStaticMarkup(
      React.createElement(PilotAccessPanel, { state: 'uninvited' }),
    );
    expect(uninvited).toContain('data-pilot-access="uninvited"');
    expect(uninvited).toContain('не приглашён');
  });

  it('create form exposes only title + goal fields', () => {
    const html = renderToStaticMarkup(
      React.createElement(PilotCreateForm, {
        title: '',
        goal: 'Add docs under docs/pilot/',
        submitting: false,
        submissionEnabled: true,
        error: null,
        onTitleChange: () => undefined,
        onGoalChange: () => undefined,
        onSubmit: () => undefined,
      }),
    );
    expect(html).toContain('data-pilot-create-form="true"');
    expect(html).toContain('data-pilot-create-enabled="true"');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="goal"');
    expect(html).not.toContain('name="baselineSha"');
    expect(html).not.toContain('name="repository"');
    expect(html).not.toContain('name="provider"');
    expect(html).not.toContain('data-pilot-merge');
    expect(html).not.toContain('data-pilot-deploy');
  });

  it('disables create form when readiness is not ready and keeps history markup separate', () => {
    const form = renderToStaticMarkup(
      React.createElement(PilotCreateForm, {
        title: '',
        goal: 'Add docs under docs/pilot/',
        submitting: false,
        submissionEnabled: false,
        error: null,
        onTitleChange: () => undefined,
        onGoalChange: () => undefined,
        onSubmit: () => undefined,
      }),
    );
    expect(form).toContain('data-pilot-create-enabled="false"');
    expect(form).toMatch(/disabled/);

    const banner = renderToStaticMarkup(
      React.createElement(PilotReadinessBanner, {
        state: 'not_ready',
        messageRu: 'Сейчас нельзя создать новую задачу.',
        refreshing: false,
        onRefresh: () => undefined,
      }),
    );
    expect(banner).toContain('data-pilot-readiness="not_ready"');
    expect(banner).toContain('data-pilot-can-submit="false"');
    expect(banner).toContain('data-pilot-readiness-refresh="true"');
    expect(banner).not.toMatch(/runnerId|SERVICE_ROLE|\/opt\//i);

    const list = renderToStaticMarkup(
      React.createElement(PilotTaskList, {
        tasks: [{
          taskId: '55555555-5555-4555-8555-555555555555',
          title: 'Existing',
          status: 'completed',
          consoleStatus: 'succeeded',
          createdAt: '2026-09-08T00:00:00.000Z',
          updatedAt: '2026-09-08T00:00:00.000Z',
        }],
        selectedTaskId: null,
        empty: false,
        onSelect: () => undefined,
      }),
    );
    expect(list).toContain('Existing');
  });

  it('renders normalized console statuses in the task list', () => {
    const tasks = STATUSES.map((consoleStatus, index) => ({
      taskId: `00000000-0000-4000-8000-00000000000${index}`,
      title: `Task ${consoleStatus}`,
      status: 'queued',
      consoleStatus,
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    }));
    const html = renderToStaticMarkup(
      React.createElement(PilotTaskList, {
        tasks,
        selectedTaskId: tasks[0].taskId,
        empty: false,
        onSelect: () => undefined,
      }),
    );
    for (const status of STATUSES) {
      expect(html).toContain(`data-pilot-status="${status}"`);
      expect(html).toContain(PILOT_CONSOLE_STATUS_LABELS[status]);
    }
  });

  it('shows empty task list state', () => {
    const html = renderToStaticMarkup(
      React.createElement(PilotTaskList, {
        tasks: [],
        selectedTaskId: null,
        empty: true,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain('data-pilot-task-list-empty="true"');
  });

  it('renders safe result fields for a selected task', () => {
    const html = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: '11111111-1111-4111-8111-111111111111',
          title: 'Proof doc',
          status: 'completed',
          consoleStatus: 'succeeded',
          createdAt: '2026-09-08T00:00:00.000Z',
          updatedAt: '2026-09-08T01:00:00.000Z',
        },
        result: {
          outcome: 'succeeded',
          summary: 'Proof markdown added',
          changedFiles: ['docs/pilot/proof.md'],
          pullRequestUrl: 'https://github.com/ASI-integration/asi-landing/pull/9',
          commitSha: 'a'.repeat(40),
          blockers: [],
        },
      }),
    );
    expect(html).toContain('data-pilot-task-detail="true"');
    expect(html).toContain('data-pilot-result-card="succeeded"');
    expect(html).toContain('data-pilot-result="true"');
    expect(html).toContain('Proof markdown added');
    expect(html).toContain('Готово');
    expect(html).toContain('docs/pilot/proof.md');
    expect(html).toContain('https://github.com/ASI-integration/asi-landing/pull/9');
    expect(html).toContain('a'.repeat(40));
    expect(html).not.toMatch(/schemaVersion|leaseToken|SERVICE_ROLE|runtime-envelope/i);
  });

  it('distinguishes blocked and failed states', () => {
    const blocked = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: '22222222-2222-4222-8222-222222222222',
          title: 'Blocked task',
          status: 'awaiting_owner',
          consoleStatus: 'blocked',
          createdAt: '2026-09-08T00:00:00.000Z',
          updatedAt: '2026-09-08T00:00:00.000Z',
        },
        result: {
          outcome: null,
          summary: null,
          changedFiles: [],
          pullRequestUrl: null,
          commitSha: null,
          blockers: ['Owner review required'],
        },
      }),
    );
    expect(blocked).toContain('data-pilot-result-card="blocked"');
    expect(blocked).toContain('data-pilot-status="blocked"');
    expect(blocked).toContain('Owner review required');
    expect(blocked).toContain('Нужен ваш ответ');

    const failed = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: '33333333-3333-4333-8333-333333333333',
          title: 'Failed task',
          status: 'failed',
          consoleStatus: 'failed',
          createdAt: '2026-09-08T00:00:00.000Z',
          updatedAt: '2026-09-08T00:00:00.000Z',
        },
        result: {
          outcome: 'failed',
          summary: 'Checks failed',
          changedFiles: [],
          pullRequestUrl: null,
          commitSha: null,
          blockers: ['lint'],
        },
      }),
    );
    expect(failed).toContain('data-pilot-result-card="failed"');
    expect(failed).toContain('data-pilot-status-tone="danger"');
    expect(failed).toContain('Не удалось выполнить');
  });

  it('status badges use API consoleStatus values only', () => {
    for (const status of STATUSES) {
      const html = renderToStaticMarkup(React.createElement(PilotStatusBadge, { status }));
      expect(html).toContain(`data-pilot-status="${status}"`);
      expect(html).toContain(PILOT_CONSOLE_STATUS_LABELS[status]);
    }
  });
});

describe('SP-05 Pilot Console safety (source)', () => {
  it('page mounts PilotConsoleClient without owner guard merge controls', () => {
    const pageSrc = readFileSync(resolve(process.cwd(), 'src/app/pilot/page.tsx'), 'utf8');
    const clientSrc = readFileSync(
      resolve(process.cwd(), 'src/app/pilot/PilotConsoleClient.tsx'),
      'utf8',
    );
    const viewSrc = readFileSync(
      resolve(process.cwd(), 'src/app/pilot/PilotConsoleView.tsx'),
      'utf8',
    );

    expect(pageSrc).toContain('PilotConsoleClient');
    expect(clientSrc).toContain('/api/pilot/session');
    expect(clientSrc).toContain('/api/pilot/tasks');
    expect(clientSrc).toContain('idempotencyKey');
    expect(clientSrc).toMatch(/goal:\s*trimmedGoal/);
    expect(clientSrc).not.toMatch(/\/api\/dashboard\/development/);
    expect(clientSrc).not.toMatch(/\/merge\b/);
    expect(clientSrc).not.toMatch(/confirmMerge|pendingGates|mergeGate|ownerGate/i);
    expect(viewSrc).not.toMatch(/data-pilot-merge|data-pilot-deploy|data-pilot-approve/i);
    expect(viewSrc).not.toMatch(/baselineSha|repositoryId|provider/);
  });

  it('create payload path only allows safe client fields', () => {
    const clientSrc = readFileSync(
      resolve(process.cwd(), 'src/app/pilot/PilotConsoleClient.tsx'),
      'utf8',
    );
    expect(clientSrc).toContain("body.title = trimmedTitle");
    expect(clientSrc).not.toContain('baselineSha');
    expect(clientSrc).not.toContain('repositoryId');
    expect(clientSrc).not.toContain('instructions');
    expect(clientSrc).not.toContain('safetyConstraints');
  });
});
