import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DevelopmentReadinessSnapshot } from '@/lib/development/readiness-types';
import type { ControlCenterMergeGateView } from '@/lib/development/owner-merge-gate';
import {
  CompactReadinessRow,
  MergeGateHero,
  TRAFFIC_LIGHT_STATUS_LABELS,
  TrafficLightHero,
  combineReadinessStates,
  mergeGateHeadline,
  readinessShortReason,
  resolveDisplayReadinessGroup,
} from '@/lib/development/development-console-presentation';

function component(
  state: 'ready' | 'blocked' | 'degraded',
  reasonCode: string,
  message: string,
  blockingLaunch: boolean,
) {
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
    runnerEvidence: null,
    components: { ...defaults, ...overrides },
  };
}

const MERGE_GATE_BASE: ControlCenterMergeGateView = {
  gateState: 'pending',
  mergeState: 'blocked',
  repository: 'ASI-integration/asi-landing',
  pullRequestNumber: 42,
  pullRequestUrl: 'https://github.com/ASI-integration/asi-landing/pull/42',
  expectedSha: 'a'.repeat(40),
  currentSha: 'b'.repeat(40),
  approvedSha: null,
  approvalTaskId: null,
  approvalSourceId: null,
  mergeRequestId: 'merge-request-1',
  blocker: {
    code: 'owner_gate_pending',
    message: 'Нужно решение владельца.',
    repository: 'ASI-integration/asi-landing',
    pullRequestNumber: 42,
    expectedSha: 'a'.repeat(40),
    currentSha: 'b'.repeat(40),
    approvedSha: null,
    approvalTaskId: null,
  },
  merged: false,
  mergeCommitSha: null,
};

describe('development console traffic-light presentation', () => {
  it('renders READY, DEGRADED and BLOCKED hero labels', () => {
    for (const state of ['ready', 'degraded', 'blocked'] as const) {
      const html = renderToStaticMarkup(
        React.createElement(TrafficLightHero, { state, reason: 'Короткая причина.' }),
      );
      expect(html).toContain(TRAFFIC_LIGHT_STATUS_LABELS[state]);
      expect(html).toContain(`data-traffic-light-status="${state}"`);
      expect(html).toContain('Короткая причина.');
    }
  });

  it('shows compact readiness rows for Runtime, Репозиторий, GitHub and Executor', () => {
    const snapshot = readinessSnapshot('degraded', true, {
      github: component('degraded', 'github_provider_degraded', 'GitHub отвечает с задержкой.', false),
    });
    const html = renderToStaticMarkup(
      React.createElement(
        'div',
        null,
        ...['runtime', 'repository', 'github', 'executor'].map((groupId) => {
          const resolved = resolveDisplayReadinessGroup({
            groupId: groupId as 'runtime' | 'repository' | 'github' | 'executor',
            readiness: snapshot,
          });
          return React.createElement(CompactReadinessRow, {
            key: groupId,
            label: groupId,
            state: resolved.state,
            message: resolved.message,
          });
        }),
      ),
    );

    expect(html).toContain('data-readiness-group="runtime"');
    expect(html).toContain('data-readiness-group="repository"');
    expect(html).toContain('data-readiness-group="github"');
    expect(html).toContain('data-readiness-group="executor"');
    expect(html).toContain('GitHub отвечает с задержкой.');
  });

  it('combines repository group state from checkouts and baseline', () => {
    const snapshot = readinessSnapshot('blocked', false, {
      checkouts: component('ready', 'runtime_checkouts_ready', 'Каталоги готовы.', false),
      baseline: component('blocked', 'baseline_unavailable', 'Не удалось получить main.', true),
    });
    const resolved = resolveDisplayReadinessGroup({ groupId: 'repository', readiness: snapshot });
    expect(resolved.state).toBe('blocked');
    expect(resolved.message).toBe('Не удалось получить main.');
    expect(combineReadinessStates(['ready', 'blocked'])).toBe('blocked');
  });

  it('returns one short overall reason for degraded and blocked snapshots', () => {
    const degraded = readinessSnapshot('degraded', true, {
      github: component('degraded', 'github_provider_degraded', 'GitHub отвечает с задержкой.', false),
    });
    expect(readinessShortReason(degraded)).toBe('GitHub отвечает с задержкой.');
    expect(readinessShortReason(readinessSnapshot('ready', true))).toBeNull();

    const blocked = readinessSnapshot('blocked', false, {
      checkouts: component('blocked', 'runtime_checkout_dirty', 'Есть несохранённые изменения.', true),
    });
    expect(readinessShortReason(blocked)).toBe('Есть несохранённые изменения.');
  });

  it('maps merge gate to pending, allowed and blocked headlines', () => {
    expect(mergeGateHeadline(MERGE_GATE_BASE)).toEqual({
      label: 'ОЖИДАЕТ РЕШЕНИЯ',
      state: 'pending',
    });
    expect(
      mergeGateHeadline({
        ...MERGE_GATE_BASE,
        gateState: 'passed',
        mergeState: 'merge_allowed',
        blocker: null,
      }),
    ).toEqual({
      label: 'МОЖНО ОБЪЕДИНИТЬ',
      state: 'allowed',
    });
    expect(
      mergeGateHeadline({
        ...MERGE_GATE_BASE,
        gateState: 'failed',
        mergeState: 'blocked',
      }),
    ).toEqual({
      label: 'ОБЪЕДИНЕНИЕ ЗАБЛОКИРОВАНО',
      state: 'blocked',
    });
  });

  it('renders merge blocked hero with technical details kept outside the headline', () => {
    const html = renderToStaticMarkup(
      React.createElement(MergeGateHero, {
        label: 'ОБЪЕДИНЕНИЕ ЗАБЛОКИРОВАНО',
        state: 'blocked',
        reason: 'Решение не разрешает объединение.',
      }),
    );
    expect(html).toContain('ОБЪЕДИНЕНИЕ ЗАБЛОКИРОВАНО');
    expect(html).toContain('data-merge-gate-state="blocked"');
    expect(html).toContain('Решение не разрешает объединение.');
  });
});
