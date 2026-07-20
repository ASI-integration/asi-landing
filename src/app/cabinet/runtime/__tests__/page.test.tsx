import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CabinetRuntimeView } from '../CabinetRuntimeView';

const repoRoot = path.join(__dirname, '../../../../..');

describe('/cabinet/runtime', () => {
  it('shows empty runtime state when no snapshot is available', () => {
    const html = renderToStaticMarkup(
      React.createElement(CabinetRuntimeView, {
        loading: false,
        error: null,
        snapshot: null,
      }),
    );

    expect(html).toContain('ASI Runtime');
    expect(html).toContain('Нет соединения');
    expect(html).toContain('Данные Runtime ещё не поступали');
  });

  it('shows a saved runtime snapshot', () => {
    const html = renderToStaticMarkup(
      React.createElement(CabinetRuntimeView, {
        loading: false,
        error: null,
        snapshot: {
          taskId: 'task-42',
          taskTitle: 'Добавить runtime snapshot',
          status: 'running',
          currentStage: 'verify',
          completedSteps: 2,
          totalSteps: 5,
          progressPercent: 40,
          provider: 'cursor',
          attemptNumber: 1,
          commitSha: 'abc1234',
          pullRequestUrl: 'https://github.com/example/repo/pull/7',
          verificationStatus: 'pending',
          lastEvent: 'tests_passed',
          startedAt: '2026-07-20T09:00:00.000Z',
          updatedAt: '2026-07-20T10:15:00.000Z',
          payloadVersion: 1,
        },
      }),
    );

    expect(html).toContain('Добавить runtime snapshot');
    expect(html).toContain('running');
    expect(html).toContain('verify');
    expect(html).toContain('2');
    expect(html).toContain('5');
    expect(html).toContain('40%');
    expect(html).toContain('cursor');
    expect(html).toContain('abc1234');
    expect(html).toContain('https://github.com/example/repo/pull/7');
    expect(html).toContain('pending');
    expect(html).toContain('tests_passed');
  });

  it('reuses dashboard cabinet auth and redirects unauthenticated users to connect', () => {
    const layoutSrc = fs.readFileSync(path.join(repoRoot, 'src/app/cabinet/layout.tsx'), 'utf8');
    const dashboardLayoutSrc = fs.readFileSync(path.join(repoRoot, 'src/app/dashboard/layout.tsx'), 'utf8');
    const authGuardSrc = fs.readFileSync(path.join(repoRoot, 'src/components/DashboardAuthGuard.tsx'), 'utf8');

    expect(layoutSrc).toContain("from '../dashboard/layout'");
    expect(dashboardLayoutSrc).toContain('DashboardAuthGuard');
    expect(authGuardSrc).toContain('/connect?redirect=');
  });
});
