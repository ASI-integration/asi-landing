import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PilotTaskDetail } from '../PilotConsoleView';
import {
  buildPilotResultCardModel,
  PILOT_OUTCOME_LABELS,
  PILOT_RESULT_FALLBACK_FAILED,
  PILOT_RESULT_FALLBACK_SUCCEEDED,
} from '@/lib/pilot/result-card';
import { buildPilotSafeResultView } from '@/lib/pilot/result-view';
import type { RuntimeBridgeSafeResult } from '@/lib/asi-runtime/bridge-types';

vi.mock('server-only', () => ({}));

function emptyResult(): {
  outcome: 'succeeded' | 'failed' | null;
  summary: string | null;
  changedFiles: string[];
  pullRequestUrl: string | null;
  commitSha: string | null;
  blockers: string[];
} {
  return {
    outcome: null,
    summary: null,
    changedFiles: [],
    pullRequestUrl: null,
    commitSha: null,
    blockers: [],
  };
}

function bridgeResult(overrides: Partial<RuntimeBridgeSafeResult> = {}): RuntimeBridgeSafeResult {
  return {
    schemaVersion: 'asi.runtime.result.v1',
    status: 'completed',
    summary: 'Added proof under docs/pilot/',
    changedFiles: ['docs/pilot/proof.md'],
    checks: [{ name: 'lint', status: 'PASS', detail: 'secret sk-abcdefghijklmnopqrstuvwxyz0123456789' }],
    artifacts: [
      { type: 'pull_request', value: 'https://github.com/ASI-integration/asi-landing/pull/42' },
      { type: 'commit', value: 'b'.repeat(40) },
    ],
    blockers: [],
    ...overrides,
  };
}

describe('SP-07 buildPilotResultCardModel', () => {
  it('maps success with Russian copy and no user action', () => {
    const card = buildPilotResultCardModel({
      consoleStatus: 'succeeded',
      result: {
        outcome: 'succeeded',
        summary: 'Proof ready',
        changedFiles: ['docs/pilot/a.md'],
        pullRequestUrl: 'https://github.com/ASI-integration/asi-landing/pull/1',
        commitSha: 'a'.repeat(40),
        blockers: [],
      },
    });
    expect(card.kind).toBe('succeeded');
    expect(card.outcomeLabelRu).toBe(PILOT_OUTCOME_LABELS.succeeded);
    expect(card.summaryRu).toBe('Proof ready');
    expect(card.userActionRequired).toBe(false);
    expect(card.nextActionRu).toMatch(/не требуется/i);
  });

  it('uses safe fallback when success summary was redacted', () => {
    const sanitized = buildPilotSafeResultView({
      consoleStatus: 'succeeded',
      bridgeResult: bridgeResult({
        summary: 'done sk-abcdefghijklmnopqrstuvwxyz0123456789',
      }),
    });
    expect(sanitized.summary).toBeNull();
    const card = buildPilotResultCardModel({
      consoleStatus: 'succeeded',
      result: sanitized,
    });
    expect(card.summaryRu).toBe(PILOT_RESULT_FALLBACK_SUCCEEDED);
    expect(card.summaryRu).not.toMatch(/sk-/i);
  });

  it('maps blocked with attention copy and no pilot action', () => {
    const card = buildPilotResultCardModel({
      consoleStatus: 'blocked',
      result: {
        ...emptyResult(),
        blockers: ['Owner merge gate'],
      },
    });
    expect(card.kind).toBe('blocked');
    expect(card.userActionRequired).toBe(false);
    expect(card.nextActionRu).toMatch(/ничего делать не нужно/i);
    expect(card.blockers).toEqual(['Owner merge gate']);
  });

  it('maps failed with fallback when summary missing', () => {
    const card = buildPilotResultCardModel({
      consoleStatus: 'failed',
      result: emptyResult(),
    });
    expect(card.kind).toBe('failed');
    expect(card.outcomeLabelRu).toBe(PILOT_OUTCOME_LABELS.failed);
    expect(card.summaryRu).toBe(PILOT_RESULT_FALLBACK_FAILED);
  });
});

describe('SP-07 Pilot result card UI', () => {
  it('renders a successful result card', () => {
    const html = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: '11111111-1111-4111-8111-111111111111',
          title: 'Success',
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
          commitSha: 'c'.repeat(40),
          blockers: [],
        },
      }),
    );
    expect(html).toContain('data-pilot-result-card="succeeded"');
    expect(html).toContain('data-pilot-user-action-required="false"');
    expect(html).toContain('Успешно');
    expect(html).toContain('Proof markdown added');
    expect(html).toContain('docs/pilot/proof.md');
    expect(html).toContain('data-pilot-result-pr="true"');
    expect(html).toContain('не требуется');
    expect(html).not.toMatch(/schemaVersion|leaseToken|SERVICE_ROLE|sk-[A-Za-z0-9]{8,}/i);
    expect(html).not.toContain('data-pilot-merge');
  });

  it('renders blocked and failed cards distinctly', () => {
    const blocked = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: '22222222-2222-4222-8222-222222222222',
          title: 'Blocked',
          status: 'awaiting_owner',
          consoleStatus: 'blocked',
          createdAt: '2026-09-08T00:00:00.000Z',
          updatedAt: '2026-09-08T00:00:00.000Z',
        },
        result: {
          ...emptyResult(),
          blockers: ['Policy blocker'],
        },
      }),
    );
    expect(blocked).toContain('data-pilot-result-card="blocked"');
    expect(blocked).toContain('Нужно внимание владельца');
    expect(blocked).toContain('Policy blocker');

    const failed = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: '33333333-3333-4333-8333-333333333333',
          title: 'Failed',
          status: 'failed',
          consoleStatus: 'failed',
          createdAt: '2026-09-08T00:00:00.000Z',
          updatedAt: '2026-09-08T00:00:00.000Z',
        },
        result: {
          outcome: 'failed',
          summary: null,
          changedFiles: [],
          pullRequestUrl: null,
          commitSha: null,
          blockers: [],
        },
      }),
    );
    expect(failed).toContain('data-pilot-result-card="failed"');
    expect(failed).toContain(PILOT_RESULT_FALLBACK_FAILED);
  });

  it('omits optional fields gracefully and never renders unsafe PR hosts', () => {
    const sanitized = buildPilotSafeResultView({
      consoleStatus: 'succeeded',
      bridgeResult: bridgeResult({
        summary: 'ok',
        changedFiles: [],
        artifacts: [{ type: 'pull_request', value: 'https://evil.example/pr/1' }],
      }),
    });
    expect(sanitized.pullRequestUrl).toBeNull();

    const html = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: '44444444-4444-4444-8444-444444444444',
          title: 'Sparse',
          status: 'completed',
          consoleStatus: 'succeeded',
          createdAt: '2026-09-08T00:00:00.000Z',
          updatedAt: '2026-09-08T00:00:00.000Z',
        },
        result: sanitized,
      }),
    );
    expect(html).toContain('data-pilot-result-card="succeeded"');
    expect(html).not.toContain('data-pilot-result-files');
    expect(html).not.toContain('data-pilot-result-pr');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('ok');
  });
});
