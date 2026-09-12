import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseRuntimeBridgeRunnerInput } from '@/lib/asi-runtime/bridge-schema';
import { PilotAccessError } from '../errors';
import { evaluatePilotReadiness } from '../readiness';
import { buildPilotHitlView, canContinuePilotOwnerGate } from '../hitl';
import type { DevelopmentReadinessSnapshot } from '@/lib/development/readiness-types';
import type { RuntimeBridgeOwnerGateView } from '@/lib/asi-runtime/bridge-types';
import { PILOT_USER_STATE } from '../user-copy';

vi.mock('server-only', () => ({}));

const NOW = '2026-09-08T12:00:00.000Z';
const FRESH_EXPIRY = '2026-09-08T12:01:00.000Z';
const STALE_EXPIRY = '2026-09-08T11:59:00.000Z';
const NOW_MS = Date.parse(NOW);

function component(
  state: 'ready' | 'blocked' | 'degraded',
  reasonCode: string,
  blockingLaunch: boolean,
) {
  return { state, reasonCode, message: reasonCode, blockingLaunch };
}

function runnerEvidence(
  overrides: Partial<NonNullable<DevelopmentReadinessSnapshot['runnerEvidence']>> = {},
): NonNullable<DevelopmentReadinessSnapshot['runnerEvidence']> {
  return {
    identity: 'runner-host-secret',
    checkedAt: NOW,
    expiresAt: FRESH_EXPIRY,
    schemaVersion: 'asi.runtime.runner-readiness.v2',
    repositoryId: 'asi-landing',
    canonicalRepository: 'ASI-integration/asi-landing',
    observedBaselineSha: 'a'.repeat(40),
    verifiedBaselineSha: 'a'.repeat(40),
    readinessState: 'ready',
    blockingReason: null,
    evidenceAgeMs: 1_000,
    ...overrides,
  };
}

function healthySnapshot(overrides: Partial<DevelopmentReadinessSnapshot> = {}): DevelopmentReadinessSnapshot {
  return {
    schemaVersion: 'asi.owner-console.readiness.v1',
    overallState: 'ready',
    canLaunch: true,
    checkedAt: NOW,
    runnerEvidence: runnerEvidence(),
    components: {
      bridge: component('ready', 'bridge_ready', false),
      checkouts: component('ready', 'runtime_checkouts_ready', false),
      baseline: component('ready', 'baseline_ready', false),
      executor: component('ready', 'runtime_executor_ready', false),
      github: component('degraded', 'github_provider_unreachable', false),
    },
    ...overrides,
  };
}

function pendingGate(): RuntimeBridgeOwnerGateView {
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
  };
}

function v2Fixture(): Record<string, unknown> {
  const fixture = JSON.parse(
    readFileSync(
      resolve('src/lib/asi-runtime/__fixtures__/runner-readiness-v2-runtime-pr99.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;
  fixture.checkedAt = new Date().toISOString();
  fixture.expiresAt = new Date(Date.now() + 45_000).toISOString();
  return fixture;
}

describe('evaluatePilotReadiness fail-closed AND-gate', () => {
  it('A: fresh v2 + executor ready + repository gates healthy enables submit', () => {
    const verdict = evaluatePilotReadiness({
      snapshot: healthySnapshot(),
      nowMs: NOW_MS,
    });
    expect(verdict.ok).toBe(true);
  });

  it('accepts diagnostic executor reason codes when state is ready', () => {
    const snapshot = healthySnapshot();
    snapshot.components.executor = component('ready', 'runtime_execution_lane_ready', false);
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(true);
  });

  it('does not treat canLaunch-only as ready', () => {
    const verdict = evaluatePilotReadiness({
      snapshot: {
        ...healthySnapshot(),
        runnerEvidence: null,
        components: {
          bridge: component('ready', 'bridge_ready', false),
          checkouts: component('degraded', 'runtime_checkout_recoverable_drift', false),
          baseline: component('ready', 'baseline_ready', false),
          executor: component('ready', 'runtime_executor_ready', false),
          github: component('ready', 'github_provider_ready', false),
        },
      },
      nowMs: NOW_MS,
    });
    expect(verdict.ok).toBe(false);
  });

  it('Bridge unavailable fails closed', () => {
    const snapshot = healthySnapshot();
    snapshot.components.bridge = component('blocked', 'bridge_storage_unreachable', true);
    snapshot.canLaunch = false;
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);
  });

  it('E: stale readiness fails closed even if executor says ready', () => {
    const snapshot = healthySnapshot({
      runnerEvidence: runnerEvidence({
        checkedAt: '2026-09-08T11:50:00.000Z',
        expiresAt: STALE_EXPIRY,
        readinessState: 'blocked',
        blockingReason: 'runtime_runner_readiness_stale',
      }),
    });
    snapshot.components.checkouts = component('blocked', 'runtime_runner_readiness_stale', true);
    snapshot.components.executor = component('ready', 'runtime_executor_ready', false);
    snapshot.canLaunch = false;
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);

    const stillStale = healthySnapshot({
      runnerEvidence: runnerEvidence({
        checkedAt: '2026-09-08T11:50:00.000Z',
        expiresAt: STALE_EXPIRY,
      }),
    });
    stillStale.components.executor = component('ready', 'runtime_executor_ready', false);
    expect(evaluatePilotReadiness({ snapshot: stillStale, nowMs: NOW_MS }).ok).toBe(false);
  });

  it('checkout unavailable fails closed', () => {
    const snapshot = healthySnapshot();
    snapshot.components.checkouts = component('blocked', 'runtime_checkout_missing', true);
    snapshot.canLaunch = false;
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);
  });

  it('invalid repository origin fails closed', () => {
    const snapshot = healthySnapshot();
    snapshot.components.checkouts = component('blocked', 'runtime_checkout_remote_mismatch', true);
    snapshot.canLaunch = false;
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);
  });

  it('baseline unavailable/mismatch fails closed', () => {
    const unavailable = healthySnapshot();
    unavailable.components.baseline = component('blocked', 'baseline_unavailable', true);
    unavailable.canLaunch = false;
    expect(evaluatePilotReadiness({ snapshot: unavailable, nowMs: NOW_MS }).ok).toBe(false);

    const mismatch = healthySnapshot();
    mismatch.components.checkouts = component('blocked', 'runtime_baseline_remote_mismatch', true);
    mismatch.canLaunch = false;
    expect(evaluatePilotReadiness({ snapshot: mismatch, nowMs: NOW_MS }).ok).toBe(false);
  });

  it('B: executor blocked fails closed', () => {
    const snapshot = healthySnapshot();
    snapshot.components.executor = component(
      'blocked',
      'runtime_execution_lane_owner_action_required',
      true,
    );
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);
  });

  it('C: executor missing fails closed', () => {
    const snapshot = healthySnapshot();
    snapshot.components.executor = component('blocked', 'runtime_executor_missing', true);
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);
    const omitted = healthySnapshot();
    delete (omitted.components as { executor?: unknown }).executor;
    expect(evaluatePilotReadiness({ snapshot: omitted, nowMs: NOW_MS }).ok).toBe(false);
  });

  it('G: absence of blockers cannot make a non-ready executor ready', () => {
    const snapshot = healthySnapshot();
    snapshot.components.executor = component('blocked', 'runtime_execution_lane_occupied', true);
    snapshot.canLaunch = true;
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);
  });

  it('F: healthy Bridge with no lease inference cannot make executor ready', () => {
    const snapshot = healthySnapshot();
    snapshot.components.bridge = component('ready', 'bridge_ready', false);
    snapshot.components.executor = component('blocked', 'runtime_execution_lane_unavailable', true);
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);
  });

  it('unknown snapshot fails closed', () => {
    expect(evaluatePilotReadiness({ snapshot: null, nowMs: NOW_MS }).ok).toBe(false);
  });

  it('v1 runner evidence is not authoritative for /pilot', () => {
    const snapshot = healthySnapshot({
      runnerEvidence: runnerEvidence({ schemaVersion: 'asi.runtime.runner-readiness.v1' }),
    });
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);
  });
});

describe('getPilotReadiness public view', () => {
  it('fully healthy returns Готово к работе without internals', async () => {
    const { getPilotReadiness } = await import('../readiness');
    const view = await getPilotReadiness({
      loadOwnerReadiness: async () => healthySnapshot(),
      now: () => new Date(NOW),
    });
    expect(view).toEqual({
      state: 'ready',
      canSubmit: true,
      messageRu: PILOT_USER_STATE.readyToWork,
      checkedAt: NOW,
    });
    expect(JSON.stringify(view)).not.toMatch(/runtime|bridge|runner|baseline|checkout|executor|lane|runner-host-secret/i);
  });

  it('executor blocked disables create and does not claim the system is ready', async () => {
    const { getPilotReadiness, assertPilotSubmissionReady } = await import('../readiness');
    const snapshot = healthySnapshot();
    snapshot.components.executor = component(
      'blocked',
      'runtime_execution_lane_owner_action_required',
      true,
    );
    snapshot.canLaunch = false;
    const view = await getPilotReadiness({
      loadOwnerReadiness: async () => snapshot,
      now: () => new Date(NOW),
    });
    expect(view.canSubmit).toBe(false);
    expect(view.state).toBe('not_ready');
    expect(view.messageRu).toBe(PILOT_USER_STATE.temporarilyUnavailable);
    await expect(assertPilotSubmissionReady({
      loadOwnerReadiness: async () => snapshot,
    })).rejects.toBeInstanceOf(PilotAccessError);
  });
});

describe('H: existing-task HITL vs new-task create', () => {
  it('keeps HITL continue on the same taskId while executor-blocked create stays unavailable', () => {
    const snapshot = healthySnapshot();
    snapshot.components.executor = component(
      'blocked',
      'runtime_execution_lane_owner_action_required',
      true,
    );
    snapshot.canLaunch = false;
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);

    const gate = pendingGate();
    expect(canContinuePilotOwnerGate(gate)).toBe(true);
    const hitl = buildPilotHitlView(gate);
    expect(hitl).toMatchObject({
      canContinue: true,
      gateId: gate.gateId,
      taskCycle: gate.taskCycle,
    });
  });
});

describe('D/I: runner-readiness.v2 executor contract', () => {
  it('D: malformed executor capability is rejected', () => {
    const fixture = v2Fixture();
    const capabilities = fixture.capabilities as Record<string, unknown>;
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: {
        ...fixture,
        capabilities: {
          ...capabilities,
          executor: { state: 'ready' },
        },
      },
    })).toBeNull();
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: {
        ...fixture,
        capabilities: {
          ...capabilities,
          executor: { state: 'unknown', reasonCode: 'runtime_executor_ready' },
        },
      },
    })).toBeNull();
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: {
        ...fixture,
        capabilities: {
          ...capabilities,
          executor: { state: 'ready', reasonCode: 'runtime_executor_ready', extra: true },
        },
      },
    })).toBeNull();
  });

  it('I: executionLane is not part of the runner-readiness public contract', () => {
    const fixture = v2Fixture();
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: fixture,
    })?.operation).toBe('runner_publish_readiness');
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: {
        ...fixture,
        executionLane: {
          schemaVersion: 'asi.runtime.execution-lane.v1',
          state: 'free',
          reasonCode: 'runtime_execution_lane_free',
          checkedAt: fixture.checkedAt,
          expiresAt: fixture.expiresAt,
        },
      },
    })).toBeNull();
    expect(JSON.stringify(fixture)).not.toMatch(/executionLane/);
  });

  it('accepts bounded diagnostic executor reason codes on v2 without a Landing allowlist change', () => {
    const fixture = v2Fixture();
    const capabilities = fixture.capabilities as Record<string, unknown>;
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: {
        ...fixture,
        capabilities: {
          ...capabilities,
          executor: { state: 'blocked', reasonCode: 'runtime_execution_lane_owner_action_required' },
        },
      },
    })?.operation).toBe('runner_publish_readiness');
  });
});
