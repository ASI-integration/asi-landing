import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuntimeBridgeSafeResult } from '@/lib/asi-runtime/bridge-types';
import type { ControlCenterMergeGateView } from '@/lib/development/owner-merge-gate';
import type {
  DevelopmentReadinessComponent,
  DevelopmentReadinessSnapshot,
} from '@/lib/development/readiness-types';
import {
  COMPACT_READINESS_LABELS,
  MERGE_GATE_HEADLINE,
  OVERALL_STATUS_HEADLINE,
  CompactReadinessItem,
  MergeGateHero,
  OverallReadinessHero,
  ReadinessDetailsPanel,
  TASK_OUTCOME_HEADLINE,
  mergeGatePresentation,
  readinessShortReason,
} from '@/lib/development/development-console-presentation';
import { DevelopmentTaskCard } from '@/lib/development/task-status-ui';

function component(
  state: 'ready' | 'blocked' | 'degraded',
  reasonCode: string,
  message: string,
  blockingLaunch: boolean,
): DevelopmentReadinessComponent {
  return { state, reasonCode, message, blockingLaunch };
}

function readinessSnapshot(
  overallState: 'ready' | 'blocked' | 'degraded',
  canLaunch: boolean,
  overrides: Partial<DevelopmentReadinessSnapshot['components']> = {},
): DevelopmentReadinessSnapshot {
  const defaults = {
    bridge: component('ready', 'bridge_ready', 'Связь с Runtime Bridge готова.', false),
    checkouts: component('ready', 'runtime_checkouts_ready', 'Оба рабочих каталога Runtime готовы.', false),
    baseline: component('ready', 'baseline_ready', 'Текущая версия main определена.', false),
    executor: component('ready', 'runtime_executor_ready', 'Исполнитель задач готов.', false),
    github: component('ready', 'github_provider_ready', 'GitHub подключён и доступен.', false),
  };
  return {
    schemaVersion: 'asi.owner-console.readiness.v1',
    overallState,
    canLaunch,
    checkedAt: '2026-09-01T00:00:00.000Z',
    runnerEvidence: {
      identity: 'runner-1234567890abcdef12345678',
      checkedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-09-01T00:01:00.000Z',
    },
    components: { ...defaults, ...overrides },
  };
}

const RESULT_WITH_PR: RuntimeBridgeSafeResult = {
  schemaVersion: 'asi.runtime.result.v1',
  status: 'completed',
  summary: 'Черновик PR готов к проверке.',
  changedFiles: ['src/app/dashboard/development/DevelopmentConsoleClient.tsx'],
  checks: [{ name: 'typecheck', status: 'PASS' }],
  artifacts: [
    { type: 'commit', value: 'a'.repeat(40) },
    { type: 'pull_request', value: 'https://github.com/ASI-integration/asi-landing/pull/42' },
  ],
  blockers: [],
};

function mergeBlocker(
  overrides: Partial<ControlCenterMergeGateView['blocker']> & Pick<NonNullable<ControlCenterMergeGateView['blocker']>, 'code' | 'message'>,
): NonNullable<ControlCenterMergeGateView['blocker']> {
  return {
    repository: 'ASI-integration/asi-landing',
    pullRequestNumber: 42,
    expectedSha: 'b'.repeat(40),
    currentSha: 'b'.repeat(40),
    approvedSha: null,
    approvalTaskId: null,
    ...overrides,
  };
}

function mergeGate(overrides: Partial<ControlCenterMergeGateView>): ControlCenterMergeGateView {
  return {
    gateState: 'pending',
    mergeState: 'blocked',
    repository: 'ASI-integration/asi-landing',
    pullRequestNumber: 42,
    pullRequestUrl: 'https://github.com/ASI-integration/asi-landing/pull/42',
    expectedSha: 'b'.repeat(40),
    currentSha: 'b'.repeat(40),
    approvedSha: null,
    approvalTaskId: null,
    approvalSourceId: null,
    mergeRequestId: 'merge-req-1',
    blocker: mergeBlocker({ code: 'owner_gate_pending', message: 'Нужно решение владельца.' }),
    merged: false,
    mergeCommitSha: null,
    ...overrides,
  };
}

describe('development console traffic-light presentation', () => {
  it('shows large READY headline without short reason', () => {
    const html = renderToStaticMarkup(
      React.createElement(OverallReadinessHero, { state: 'ready', reason: null }),
    );
    expect(html).toContain(OVERALL_STATUS_HEADLINE.ready);
    expect(html).toContain('data-readiness-overall-hero="ready"');
    expect(html).not.toContain('data-readiness-short-reason="true"');
  });

  it('shows large DEGRADED headline with one short reason', () => {
    const snapshot = readinessSnapshot('degraded', true, {
      github: component('degraded', 'github_provider_degraded', 'GitHub отвечает с задержкой.', false),
    });
    const reason = readinessShortReason(snapshot);
    const html = renderToStaticMarkup(
      React.createElement(OverallReadinessHero, { state: 'degraded', reason }),
    );
    expect(html).toContain(OVERALL_STATUS_HEADLINE.degraded);
    expect(html).toContain('GitHub отвечает с задержкой.');
  });

  it('shows large BLOCKED headline with one short reason', () => {
    const snapshot = readinessSnapshot('blocked', false, {
      checkouts: component(
        'blocked',
        'runtime_checkout_dirty',
        'В одном из рабочих каталогов Runtime есть несохранённые изменения.',
        true,
      ),
    });
    const reason = readinessShortReason(snapshot);
    const html = renderToStaticMarkup(
      React.createElement(OverallReadinessHero, { state: 'blocked', reason }),
    );
    expect(html).toContain(OVERALL_STATUS_HEADLINE.blocked);
    expect(html).toContain('несохранённые изменения');
  });

  it('renders compact readiness rows for Runtime, Репозиторий, GitHub and Executor', () => {
    const snapshot = readinessSnapshot('ready', true);
    const html = renderToStaticMarkup(
      React.createElement(
        'div',
        null,
        ...(['bridge', 'baseline', 'github', 'executor'] as const).map((id) =>
          React.createElement(CompactReadinessItem, {
            key: id,
            label: COMPACT_READINESS_LABELS[id],
            item: snapshot.components[id],
          }),
        ),
      ),
    );
    expect(html).toContain('Runtime');
    expect(html).toContain('Репозиторий');
    expect(html).toContain('GitHub');
    expect(html).toContain('Executor');
    expect(html).not.toContain('runtime_checkouts_ready');
  });

  it('keeps reasonCode inside the Подробнее block only', () => {
    const snapshot = readinessSnapshot('ready', true);
    const html = renderToStaticMarkup(
      React.createElement(ReadinessDetailsPanel, {
        readiness: snapshot,
        checkedAtLabel: '01.09.2026, 03:00:00',
      }),
    );
    const detailsStart = html.indexOf('<details');
    expect(detailsStart).toBeGreaterThan(-1);
    expect(html.slice(detailsStart)).toContain('reasonCode');
    expect(html.slice(detailsStart)).toContain('runtime_checkouts_ready');
    expect(html.slice(0, detailsStart)).not.toContain('runtime_checkouts_ready');
  });

  it('shows large completed and failed outcome headlines with PR and commit visible', () => {
    const completed = renderToStaticMarkup(
      React.createElement(DevelopmentTaskCard, {
        task: {
          title: 'UI refresh',
          status: 'completed',
          updatedAt: '2026-09-01T00:00:00.000Z',
          taskId: '11111111-1111-4111-8111-111111111111',
          repository: 'ASI-integration/asi-landing',
          attemptCount: 1,
          createdAt: '2026-09-01T00:00:00.000Z',
          result: RESULT_WITH_PR,
        },
      }),
    );
    expect(completed).toContain(TASK_OUTCOME_HEADLINE.completed);
    expect(completed).toContain('data-task-pr-link="true"');
    expect(completed).toContain('data-task-commit="true"');

    const failed = renderToStaticMarkup(
      React.createElement(DevelopmentTaskCard, {
        task: {
          title: 'UI refresh',
          status: 'failed',
          updatedAt: '2026-09-01T00:00:00.000Z',
          taskId: '22222222-2222-4222-8222-222222222222',
          repository: 'ASI-integration/asi-landing',
          attemptCount: 1,
          createdAt: '2026-09-01T00:00:00.000Z',
          result: { ...RESULT_WITH_PR, status: 'failed', summary: 'Проверки не прошли.' },
        },
      }),
    );
    expect(failed).toContain(TASK_OUTCOME_HEADLINE.failed);
    expect(failed).toContain('Проверки не прошли.');
  });

  it('maps merge gate states to simple headlines', () => {
    expect(mergeGatePresentation(mergeGate({ gateState: 'pending', mergeState: 'blocked' })).headline).toBe(
      MERGE_GATE_HEADLINE.pending,
    );
    expect(
      mergeGatePresentation(mergeGate({ gateState: 'passed', mergeState: 'merge_allowed', blocker: null })).headline,
    ).toBe(MERGE_GATE_HEADLINE.allowed);
    expect(
      mergeGatePresentation(
        mergeGate({
          gateState: 'failed',
          mergeState: 'blocked',
          blocker: mergeBlocker({
            code: 'owner_gate_failed',
            message: 'Решение не разрешает объединение.',
          }),
        }),
      ).headline,
    ).toBe(MERGE_GATE_HEADLINE.blocked);
  });

  it('renders merge blocked hero with technical details under Подробнее', () => {
    const html = renderToStaticMarkup(
      React.createElement(MergeGateHero, {
        gate: mergeGate({
          gateState: 'failed',
          mergeState: 'blocked',
          blocker: mergeBlocker({
            code: 'owner_gate_failed',
            message: 'Решение не разрешает объединение.',
          }),
        }),
      }),
    );
    expect(html).toContain(MERGE_GATE_HEADLINE.blocked);
    expect(html).toContain('Подробнее');
    expect(html).toContain('merge-req-1');
  });

  it('documents disabled launch when readiness canLaunch is false', () => {
    const snapshot = readinessSnapshot('blocked', false);
    expect(snapshot.canLaunch).toBe(false);
    expect(readinessShortReason(snapshot)).toContain('Запуск остановлен');
  });
});
