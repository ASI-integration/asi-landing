import { describe, expect, it, vi } from 'vitest';
import { PilotAccessError } from '../errors';
import { evaluatePilotReadiness } from '../readiness';
import type { DevelopmentReadinessSnapshot } from '@/lib/development/readiness-types';
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
    schemaVersion: 'asi.runtime.runner-readiness.v1',
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

describe('evaluatePilotReadiness fail-closed AND-gate', () => {
  it('fully healthy enables submit', () => {
    const verdict = evaluatePilotReadiness({
      snapshot: healthySnapshot(),
      lane: { canAccept: true },
      nowMs: NOW_MS,
    });
    expect(verdict.ok).toBe(true);
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
      lane: { canAccept: true },
      nowMs: NOW_MS,
    });
    expect(verdict.ok).toBe(false);
  });

  it('Bridge unavailable fails closed', () => {
    const snapshot = healthySnapshot();
    snapshot.components.bridge = component('blocked', 'bridge_storage_unreachable', true);
    snapshot.canLaunch = false;
    expect(evaluatePilotReadiness({
      snapshot,
      lane: { canAccept: true },
      nowMs: NOW_MS,
    }).ok).toBe(false);
  });

  it('stale readiness fails closed', () => {
    const snapshot = healthySnapshot({
      runnerEvidence: runnerEvidence({
        checkedAt: '2026-09-08T11:50:00.000Z',
        expiresAt: STALE_EXPIRY,
        readinessState: 'blocked',
        blockingReason: 'runtime_runner_readiness_stale',
      }),
    });
    snapshot.components.checkouts = component('blocked', 'runtime_runner_readiness_stale', true);
    snapshot.components.executor = component('blocked', 'runtime_runner_readiness_stale', true);
    snapshot.canLaunch = false;
    expect(evaluatePilotReadiness({
      snapshot,
      lane: { canAccept: true },
      nowMs: NOW_MS,
    }).ok).toBe(false);
  });

  it('checkout unavailable fails closed', () => {
    const snapshot = healthySnapshot();
    snapshot.components.checkouts = component('blocked', 'runtime_checkout_missing', true);
    snapshot.canLaunch = false;
    expect(evaluatePilotReadiness({
      snapshot,
      lane: { canAccept: true },
      nowMs: NOW_MS,
    }).ok).toBe(false);
  });

  it('invalid repository origin fails closed', () => {
    const snapshot = healthySnapshot();
    snapshot.components.checkouts = component('blocked', 'runtime_checkout_remote_mismatch', true);
    snapshot.canLaunch = false;
    expect(evaluatePilotReadiness({
      snapshot,
      lane: { canAccept: true },
      nowMs: NOW_MS,
    }).ok).toBe(false);
  });

  it('baseline unavailable/mismatch fails closed', () => {
    const unavailable = healthySnapshot();
    unavailable.components.baseline = component('blocked', 'baseline_unavailable', true);
    unavailable.canLaunch = false;
    expect(evaluatePilotReadiness({
      snapshot: unavailable,
      lane: { canAccept: true },
      nowMs: NOW_MS,
    }).ok).toBe(false);

    const mismatch = healthySnapshot();
    mismatch.components.checkouts = component('blocked', 'runtime_baseline_remote_mismatch', true);
    mismatch.canLaunch = false;
    expect(evaluatePilotReadiness({
      snapshot: mismatch,
      lane: { canAccept: true },
      nowMs: NOW_MS,
    }).ok).toBe(false);
  });

  it('executor blocked fails closed', () => {
    const snapshot = healthySnapshot();
    snapshot.components.executor = component('blocked', 'runtime_executor_unavailable', true);
    snapshot.canLaunch = false;
    expect(evaluatePilotReadiness({
      snapshot,
      lane: { canAccept: true },
      nowMs: NOW_MS,
    }).ok).toBe(false);
  });

  it('lane occupied fails closed', () => {
    expect(evaluatePilotReadiness({
      snapshot: healthySnapshot(),
      lane: { canAccept: false },
      nowMs: NOW_MS,
    }).ok).toBe(false);
  });

  it('unknown snapshot or lane fails closed', () => {
    expect(evaluatePilotReadiness({
      snapshot: null,
      lane: { canAccept: true },
      nowMs: NOW_MS,
    }).ok).toBe(false);
    expect(evaluatePilotReadiness({
      snapshot: healthySnapshot(),
      lane: null,
      nowMs: NOW_MS,
    }).ok).toBe(false);
  });
});

describe('getPilotReadiness public view', () => {
  it('fully healthy returns Готово к работе without internals', async () => {
    const { getPilotReadiness } = await import('../readiness');
    const view = await getPilotReadiness({
      loadOwnerReadiness: async () => healthySnapshot(),
      probeExecutionLane: async () => ({ canAccept: true }),
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

  it('lane occupied disables create and does not claim the system is ready', async () => {
    const { getPilotReadiness, assertPilotSubmissionReady } = await import('../readiness');
    const view = await getPilotReadiness({
      loadOwnerReadiness: async () => healthySnapshot(),
      probeExecutionLane: async () => ({ canAccept: false }),
      now: () => new Date(NOW),
    });
    expect(view.canSubmit).toBe(false);
    expect(view.state).toBe('not_ready');
    expect(view.messageRu).toBe(PILOT_USER_STATE.temporarilyUnavailable);
    await expect(assertPilotSubmissionReady({
      loadOwnerReadiness: async () => healthySnapshot(),
      probeExecutionLane: async () => ({ canAccept: false }),
    })).rejects.toBeInstanceOf(PilotAccessError);
  });

  it('lane probe failure is error, not ready', async () => {
    const { getPilotReadiness } = await import('../readiness');
    const view = await getPilotReadiness({
      loadOwnerReadiness: async () => healthySnapshot(),
      probeExecutionLane: async () => {
        throw new Error('offline');
      },
      now: () => new Date(NOW),
    });
    expect(view.state).toBe('error');
    expect(view.canSubmit).toBe(false);
    expect(view.messageRu).toBe(PILOT_USER_STATE.temporarilyUnavailable);
  });
});
