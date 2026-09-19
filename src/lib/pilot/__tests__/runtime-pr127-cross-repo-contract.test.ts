/**
 * Cross-repo contract: Landing PR #272 ↔ Runtime PR #127
 * (asi-os-runtime @ 61197da129b8eb2f2d15f366cfb139d7519125a1).
 *
 * Landing must consume runner-readiness.v2 `capabilities.executor` only.
 * It must NOT parse owner-control-plane execution-slot records, Bridge leases,
 * or reinvent orphan recovery.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseRuntimeBridgeRunnerInput } from '@/lib/asi-runtime/bridge-schema';
import type { RuntimeBridgeOwnerGateView } from '@/lib/asi-runtime/bridge-types';
import {
  EXECUTION_LANE_REASON_CODES,
  LEGACY_EXECUTOR_READY_REASON,
} from '@/lib/asi-runtime/execution-lane-contract';
import type { DevelopmentReadinessSnapshot } from '@/lib/development/readiness-types';
import { buildPilotHitlView, canContinuePilotOwnerGate } from '../hitl';
import { evaluatePilotReadiness, getPilotReadiness } from '../readiness';
import { PILOT_USER_STATE } from '../user-copy';

vi.mock('server-only', () => ({}));

const NOW = '2026-09-12T12:00:00.000Z';
const FRESH_EXPIRY = '2026-09-12T12:01:00.000Z';
const NOW_MS = Date.parse(NOW);

/** Runtime PR #127 bounded executor reason codes. Only READY authorizes /pilot create. */
const RUNTIME_PR127_EXECUTOR_REASONS = {
  ready: EXECUTION_LANE_REASON_CODES.READY,
  occupied: EXECUTION_LANE_REASON_CODES.OCCUPIED,
  actionRequired: EXECUTION_LANE_REASON_CODES.OWNER_ACTION_REQUIRED,
  recoveryBlocked: EXECUTION_LANE_REASON_CODES.RECOVERY_BLOCKED,
  unavailable: EXECUTION_LANE_REASON_CODES.UNAVAILABLE,
} as const;

function component(
  state: 'ready' | 'blocked' | 'degraded',
  reasonCode: string,
  blockingLaunch: boolean,
) {
  return { state, reasonCode, message: reasonCode, blockingLaunch };
}

function healthySnapshot(
  overrides: Partial<DevelopmentReadinessSnapshot> = {},
): DevelopmentReadinessSnapshot {
  return {
    schemaVersion: 'asi.owner-console.readiness.v1',
    overallState: 'ready',
    canLaunch: true,
    checkedAt: NOW,
    runnerEvidence: {
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
    },
    components: {
      bridge: component('ready', 'bridge_ready', false),
      checkouts: component('ready', 'runtime_checkouts_ready', false),
      baseline: component('ready', 'baseline_ready', false),
      executor: component('ready', RUNTIME_PR127_EXECUTOR_REASONS.ready, false),
      github: component('degraded', 'github_provider_unreachable', false),
    },
    ...overrides,
  };
}

function withExecutor(
  state: 'ready' | 'blocked',
  reasonCode: string,
  canLaunch = state === 'ready',
): DevelopmentReadinessSnapshot {
  const snapshot = healthySnapshot();
  snapshot.components.executor = component(state, reasonCode, state !== 'ready');
  snapshot.canLaunch = canLaunch;
  if (state !== 'ready') {
    snapshot.overallState = 'blocked';
  }
  return snapshot;
}

function pendingGate(): RuntimeBridgeOwnerGateView {
  return {
    schemaVersion: 'asi.runtime.owner-gate.v1',
    action: 'Продолжить правку документации',
    exactTarget: 'docs/pilot/proof.md',
    identity: 'task-cycle-1',
    reason: 'Нужно подтвердить формулировку в proof-файле.',
    evidence: ['should not leak'],
    allowedSideEffect: 'update the same task only',
    rollback: 'leave files unchanged',
    postActionVerification: ['same taskId'],
    taskCycle: 'cycle-1',
    expiresAt: '2026-09-12T13:00:00.000Z',
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

describe('cross-repo #272+#127: Landing consumes Runtime executor capability only', () => {
  it('A: free lane (executor ready) → pilot can submit when other gates pass', async () => {
    const snapshot = withExecutor('ready', RUNTIME_PR127_EXECUTOR_REASONS.ready);
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(true);
    const view = await getPilotReadiness({
      loadOwnerReadiness: async () => snapshot,
      now: () => new Date(NOW),
    });
    expect(view).toMatchObject({
      canSubmit: true,
      state: 'ready',
      messageRu: PILOT_USER_STATE.readyToWork,
    });
  });

  it('B: legitimate RUNNING lane → pilot cannot submit', async () => {
    const snapshot = withExecutor('blocked', RUNTIME_PR127_EXECUTOR_REASONS.occupied);
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);
    const view = await getPilotReadiness({
      loadOwnerReadiness: async () => snapshot,
      now: () => new Date(NOW),
    });
    expect(view.canSubmit).toBe(false);
    expect(view.messageRu).toBe(PILOT_USER_STATE.temporarilyUnavailable);
  });

  it('C: ACTION_REQUIRED/HITL blocks new create; same taskId remains continuable', () => {
    const snapshot = withExecutor('blocked', RUNTIME_PR127_EXECUTOR_REASONS.actionRequired);
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);

    const gate = pendingGate();
    expect(canContinuePilotOwnerGate(gate)).toBe(true);
    expect(buildPilotHitlView(gate)).toMatchObject({
      canContinue: true,
      gateId: gate.gateId,
      taskCycle: gate.taskCycle,
    });
  });

  it('D: after Runtime recovers a genuine orphan and publishes executor ready, Landing is not falsely blocked', async () => {
    // Landing has no local execution-slot / holderStartTicks cache. Once Runtime
    // publishes capabilities.executor.state=ready, create must reopen.
    const recovered = withExecutor('ready', RUNTIME_PR127_EXECUTOR_REASONS.ready);
    expect(evaluatePilotReadiness({ snapshot: recovered, nowMs: NOW_MS }).ok).toBe(true);
    const view = await getPilotReadiness({
      loadOwnerReadiness: async () => recovered,
      now: () => new Date(NOW),
    });
    expect(view.canSubmit).toBe(true);
  });

  it('E: unknown / malformed / contradictory lane evidence fails closed', () => {
    expect(evaluatePilotReadiness({
      snapshot: withExecutor('blocked', RUNTIME_PR127_EXECUTOR_REASONS.unavailable),
      nowMs: NOW_MS,
    }).ok).toBe(false);
    expect(evaluatePilotReadiness({
      snapshot: withExecutor('blocked', RUNTIME_PR127_EXECUTOR_REASONS.recoveryBlocked),
      nowMs: NOW_MS,
    }).ok).toBe(false);
    expect(evaluatePilotReadiness({ snapshot: null, nowMs: NOW_MS }).ok).toBe(false);

    const contradictory = withExecutor('blocked', RUNTIME_PR127_EXECUTOR_REASONS.occupied, true);
    // canLaunch true cannot override a non-ready executor.
    expect(evaluatePilotReadiness({ snapshot: contradictory, nowMs: NOW_MS }).ok).toBe(false);

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
          executor: { state: 'unknown', reasonCode: RUNTIME_PR127_EXECUTOR_REASONS.ready },
        },
      },
    })).toBeNull();
  });

  it('F: optional Runtime execution-slot field holderStartTicks is out of Landing scope and does not break v2 parse', () => {
    const fixture = v2Fixture();
    const capabilities = fixture.capabilities as Record<string, unknown>;
    // Landing never ingests execution-slot.json; runner-readiness.v2 remains the boundary.
    expect(JSON.stringify(fixture)).not.toMatch(/holderStartTicks|execution-slot|executionLane/);
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: {
        ...fixture,
        capabilities: {
          ...capabilities,
          executor: { state: 'ready', reasonCode: RUNTIME_PR127_EXECUTOR_REASONS.ready },
        },
      },
    })?.operation).toBe('runner_publish_readiness');
    // Extra slot-shaped fields on readiness are rejected (exact schema).
    expect(parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: {
        ...fixture,
        holderStartTicks: '12345',
      },
    })).toBeNull();
  });

  it('does not treat empty blockers or Bridge health alone as a free lane', () => {
    const snapshot = withExecutor('blocked', RUNTIME_PR127_EXECUTOR_REASONS.occupied);
    snapshot.components.bridge = component('ready', 'bridge_ready', false);
    expect(evaluatePilotReadiness({ snapshot, nowMs: NOW_MS }).ok).toBe(false);
  });

  it('rejects old lane-unaware executor readiness for /pilot create', () => {
    expect(evaluatePilotReadiness({
      snapshot: withExecutor('ready', LEGACY_EXECUTOR_READY_REASON),
      nowMs: NOW_MS,
    }).ok).toBe(false);
    expect(evaluatePilotReadiness({
      snapshot: withExecutor('ready', ''),
      nowMs: NOW_MS,
    }).ok).toBe(false);
    expect(evaluatePilotReadiness({
      snapshot: withExecutor('ready', 'runtime_unknown_reason'),
      nowMs: NOW_MS,
    }).ok).toBe(false);
    expect(evaluatePilotReadiness({
      snapshot: withExecutor('ready', RUNTIME_PR127_EXECUTOR_REASONS.occupied),
      nowMs: NOW_MS,
    }).ok).toBe(false);

    const historical = JSON.parse(
      readFileSync(
        resolve('src/lib/asi-runtime/__fixtures__/runner-readiness-v2-runtime-pr99.json'),
        'utf8',
      ),
    ) as { capabilities: { executor: { reasonCode: string } } };
    expect(historical.capabilities.executor.reasonCode).toBe(LEGACY_EXECUTOR_READY_REASON);

    const laneAware = JSON.parse(
      readFileSync(
        resolve('src/lib/asi-runtime/__fixtures__/runner-readiness-v2-runtime-pr127.json'),
        'utf8',
      ),
    ) as { capabilities: { executor: { reasonCode: string } } };
    expect(laneAware.capabilities.executor.reasonCode).toBe(RUNTIME_PR127_EXECUTOR_REASONS.ready);
    expect(evaluatePilotReadiness({
      snapshot: withExecutor('ready', laneAware.capabilities.executor.reasonCode),
      nowMs: NOW_MS,
    }).ok).toBe(true);
  });
});
