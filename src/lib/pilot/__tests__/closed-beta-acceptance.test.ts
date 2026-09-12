/**
 * Closed-beta /pilot acceptance: truthful readiness, user states, HITL, terminal cards.
 */
import React from 'react';
import { randomUUID } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PilotCreateForm, PilotHitlPanel, PilotStatusBadge, PilotTaskDetail } from '@/app/pilot/PilotConsoleView';
import { buildPilotHitlView, isPrivilegedPilotOwnerGate } from '../hitl';
import { buildPilotResultCardModel } from '../result-card';
import { PILOT_CONSOLE_STATUS_LABELS } from '../status-ui';
import { isTerminalPilotConsoleStatus } from '../status';
import { PILOT_USER_STATE } from '../user-copy';
import type { RuntimeBridgeOwnerGateView } from '@/lib/asi-runtime/bridge-types';

vi.mock('server-only', () => ({}));

const NOW = '2026-09-08T12:00:00.000Z';

function emptyResult() {
  return {
    outcome: null as 'succeeded' | 'failed' | null,
    summary: null as string | null,
    changedFiles: [] as string[],
    pullRequestUrl: null as string | null,
    commitSha: null as string | null,
    blockers: [] as string[],
  };
}

function pendingGate(overrides: Partial<RuntimeBridgeOwnerGateView> = {}): RuntimeBridgeOwnerGateView {
  return {
    schemaVersion: 'asi.runtime.owner-gate.v1',
    action: 'Продолжить правку документации',
    exactTarget: 'docs/pilot/proof.md',
    identity: 'task-cycle-1',
    reason: 'Нужно подтвердить формулировку в proof-файле.',
    evidence: ['raw diagnostic payload should not leak'],
    allowedSideEffect: 'update the same task only',
    rollback: 'leave files unchanged',
    postActionVerification: ['same taskId'],
    taskCycle: 'cycle-1',
    expiresAt: '2026-09-08T13:00:00.000Z',
    gateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    status: 'pending',
    createdAt: NOW,
    ...overrides,
  };
}

describe('closed-beta user states', () => {
  it('maps console statuses to the approved Russian labels', () => {
    expect(PILOT_CONSOLE_STATUS_LABELS.queued).toBe(PILOT_USER_STATE.readyToWork);
    expect(PILOT_CONSOLE_STATUS_LABELS.running).toBe(PILOT_USER_STATE.inProgress);
    expect(PILOT_CONSOLE_STATUS_LABELS.blocked).toBe(PILOT_USER_STATE.needsAnswer);
    expect(PILOT_CONSOLE_STATUS_LABELS.succeeded).toBe(PILOT_USER_STATE.done);
    expect(PILOT_CONSOLE_STATUS_LABELS.failed).toBe(PILOT_USER_STATE.failed);
    expect(isTerminalPilotConsoleStatus('blocked')).toBe(false);
    expect(isTerminalPilotConsoleStatus('succeeded')).toBe(true);
    expect(isTerminalPilotConsoleStatus('failed')).toBe(true);
  });

  it('create stays disabled unless submissionEnabled is true', () => {
    const disabled = renderToStaticMarkup(
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
    expect(disabled).toContain('data-pilot-create-enabled="false"');
    expect(disabled).toMatch(/disabled/);
    expect(disabled).not.toMatch(/Runtime|Bridge|baseline|checkout|runner/i);
  });
});

describe('closed-beta owner approval HITL', () => {
  it('shows question/reason and continue controls without raw diagnostics', () => {
    const gate = pendingGate();
    expect(isPrivilegedPilotOwnerGate(gate)).toBe(false);
    const hitl = buildPilotHitlView(gate);
    expect(hitl).toMatchObject({
      required: true,
      canContinue: true,
      questionRu: 'Нужно подтвердить формулировку в proof-файле.',
      gateId: gate.gateId,
      taskCycle: gate.taskCycle,
    });

    const html = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: gate.taskId,
          title: 'Owner question',
          status: 'awaiting_owner',
          consoleStatus: 'blocked',
          createdAt: NOW,
          updatedAt: NOW,
        },
        result: emptyResult(),
        hitl,
        hitlBusy: false,
        hitlError: null,
        onHitlContinue: () => undefined,
        onHitlCancel: () => undefined,
      }),
    );
    expect(html).toContain('data-pilot-result-card="blocked"');
    expect(html).toContain('data-pilot-hitl="true"');
    expect(html).toContain('data-pilot-hitl-continue="true"');
    expect(html).toContain(PILOT_USER_STATE.needsAnswer);
    expect(html).toContain('Нужно подтвердить формулировку в proof-файле.');
    expect(html).not.toContain('raw diagnostic payload');
    expect(html).not.toContain('schemaVersion');
    expect(html).not.toMatch(/data-pilot-merge|Approve|Reject/i);
    expect(html).not.toMatch(/\bRuntime\b|\bBridge\b|baseline|checkout/i);
  });

  it('blocks privileged merge/deploy continuation from /pilot', () => {
    const gate = pendingGate({
      action: 'merge pull request',
      allowedSideEffect: 'Merge the exact SHA into main',
      exactTarget: 'production',
      reason: 'Owner merge required',
    });
    expect(isPrivilegedPilotOwnerGate(gate)).toBe(true);
    const hitl = buildPilotHitlView(gate);
    expect(hitl?.canContinue).toBe(false);
    const html = renderToStaticMarkup(
      React.createElement(PilotHitlPanel, {
        hitl: hitl!,
        busy: false,
        error: null,
        onContinue: () => undefined,
        onCancel: () => undefined,
      }),
    );
    expect(html).toContain('data-pilot-hitl-can-continue="false"');
    expect(html).not.toContain('data-pilot-hitl-continue');
    expect(html).not.toMatch(/data-pilot-merge|data-pilot-deploy/i);
  });
});

describe('closed-beta completed and failed cards', () => {
  it('completed shows Готово without internals', () => {
    const taskId = randomUUID();
    const html = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId,
          title: 'Done',
          status: 'completed',
          consoleStatus: 'succeeded',
          createdAt: NOW,
          updatedAt: NOW,
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
    const card = buildPilotResultCardModel({
      consoleStatus: 'succeeded',
      result: {
        outcome: 'succeeded',
        summary: 'Proof markdown added',
        changedFiles: ['docs/pilot/proof.md'],
        pullRequestUrl: 'https://github.com/ASI-integration/asi-landing/pull/9',
        commitSha: 'c'.repeat(40),
        blockers: [],
      },
    });
    expect(card.headlineRu).toBe(PILOT_USER_STATE.done);
    expect(html).toContain('data-pilot-result-card="succeeded"');
    expect(html).toContain(PILOT_USER_STATE.done);
    expect(html).toContain('docs/pilot/proof.md');
    expect(html).not.toMatch(/Runtime|Bridge|baseline|checkout|schemaVersion/i);
  });

  it('failed shows Не удалось выполнить', () => {
    const html = renderToStaticMarkup(
      React.createElement(PilotTaskDetail, {
        loading: false,
        error: null,
        task: {
          taskId: randomUUID(),
          title: 'Failed',
          status: 'failed',
          consoleStatus: 'failed',
          createdAt: NOW,
          updatedAt: NOW,
        },
        result: {
          outcome: 'failed',
          summary: 'Проверка не прошла',
          changedFiles: [],
          pullRequestUrl: null,
          commitSha: null,
          blockers: [],
        },
      }),
    );
    expect(html).toContain('data-pilot-result-card="failed"');
    expect(html).toContain(PILOT_USER_STATE.failed);
    expect(html).not.toMatch(/Runtime|Bridge|baseline|checkout/i);
  });
});

describe('closed-beta status badges', () => {
  it('renders queued as Готово к работе', () => {
    const html = renderToStaticMarkup(React.createElement(PilotStatusBadge, { status: 'queued' }));
    expect(html).toContain(PILOT_USER_STATE.readyToWork);
  });
});
