import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  RuntimeRunnerReadinessRecordV1,
  RuntimeRunnerReadinessRecordV2,
} from '@/lib/asi-runtime/bridge-types';
import { parseRuntimeBridgeRunnerInput } from '@/lib/asi-runtime/bridge-schema';

vi.mock('server-only', () => ({}));

const readyEnv = {
  ASI_RUNTIME_BRIDGE_CLIENT_ID: 'owner-console',
  ASI_RUNTIME_BRIDGE_SUPABASE_URL: 'https://bridge-isolated.example.com',
  ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY: 'not-returned-by-readiness',
};

const landingSha = 'a'.repeat(40);
const runtimeSha = 'c'.repeat(40);
const checkedAt = '2026-08-01T00:00:00.000Z';
const expiresAt = '2026-08-01T00:01:00.000Z';
const runnerId = 'runner-1234567890abcdef12345678';

const runtimePr99Fixture = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../asi-runtime/__fixtures__/runner-readiness-v2-runtime-pr99.json'),
    'utf8',
  ),
) as RuntimeRunnerReadinessRecordV2;

const runtimePr100Fixture = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../asi-runtime/__fixtures__/runner-readiness-v2-runtime-pr100.json'),
    'utf8',
  ),
) as RuntimeRunnerReadinessRecordV2;

function v1Record(baselineSha: string): RuntimeRunnerReadinessRecordV1 {
  return {
    schemaVersion: 'asi.runtime.runner-readiness.v1',
    runnerId,
    checkedAt,
    expiresAt,
    baselineSha,
    capabilities: {
      checkouts: { state: 'ready', reasonCode: 'runtime_checkouts_ready' },
      baselineRecovery: { state: 'ready', reasonCode: 'runtime_baseline_recovery_ready' },
      executor: { state: 'ready', reasonCode: 'runtime_executor_ready' },
    },
  };
}

function readyV2Capabilities(): RuntimeRunnerReadinessRecordV2['capabilities'] {
  return {
    checkouts: { state: 'ready', reasonCode: 'runtime_checkouts_ready' },
    baselineRecovery: { state: 'ready', reasonCode: 'runtime_baseline_recovery_ready' },
    executor: { state: 'ready', reasonCode: 'runtime_executor_ready' },
  };
}

function repositoryEvidence(
  repositoryId: 'landing' | 'runtime',
  fullName: 'ASI-integration/asi-landing' | 'ASI-integration/asi-os-runtime',
  observedBaselineSha: string,
  overrides: Partial<RuntimeRunnerReadinessRecordV2['repositories'][number]> = {},
) {
  return {
    repositoryId,
    fullName,
    canonicalCheckoutPath: repositoryId === 'landing'
      ? '/srv/asi-landing'
      : '/srv/asi-os-runtime',
    expectedOrigin: repositoryId === 'runtime'
      ? 'git@github.com-asi-os-runtime:ASI-integration/asi-os-runtime.git'
      : `https://github.com/${fullName}.git`,
    defaultBranch: 'main' as const,
    observedBaselineSha,
    checkoutReady: true,
    originReady: true,
    baselineReady: true,
    recoveryReady: true,
    blockers: [],
    ...overrides,
  };
}

function v2Record(
  repositories: RuntimeRunnerReadinessRecordV2['repositories'],
  overrides: Partial<RuntimeRunnerReadinessRecordV2> = {},
): RuntimeRunnerReadinessRecordV2 {
  return {
    schemaVersion: 'asi.runtime.runner-readiness.v2',
    runnerId,
    checkedAt,
    expiresAt,
    capabilities: readyV2Capabilities(),
    blockers: [],
    repositories,
    ...overrides,
  };
}

function runnerStatus(record: RuntimeRunnerReadinessRecordV1 | RuntimeRunnerReadinessRecordV2) {
  return { status: 'fresh' as const, record };
}

async function actualReadiness(
  repositoryId: string,
  overrides: Record<string, unknown> = {},
) {
  const actual = await vi.importActual<typeof import('../readiness')>('../readiness');
  return actual.getDevelopmentReadiness({
    repositoryId,
    env: readyEnv,
    now: () => new Date('2026-08-01T00:00:00.000Z'),
    probeBridgeStorage: async () => {},
    probeGitHub: async () => {},
    loadRunnerReadiness: async () => runnerStatus(v1Record(landingSha)),
    resolveBaselineSha: async () => landingSha,
    ...overrides,
  });
}

describe('runner-readiness.v2 reconciliation', () => {
  it('A: valid landing task readiness uses landing repository evidence', async () => {
    const readiness = await actualReadiness('asi-landing', {
      resolveBaselineSha: async () => landingSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ])),
    });
    expect(readiness.canLaunch).toBe(true);
    expect(readiness.runnerEvidence?.schemaVersion).toBe('asi.runtime.runner-readiness.v2');
    expect(readiness.runnerEvidence?.repositoryId).toBe('asi-landing');
    expect(readiness.runnerEvidence?.observedBaselineSha).toBe(landingSha);
  });

  it('B: valid runtime task readiness uses runtime repository evidence', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ])),
    });
    expect(readiness.canLaunch).toBe(true);
    expect(readiness.runnerEvidence?.repositoryId).toBe('asi-os-runtime');
    expect(readiness.runnerEvidence?.observedBaselineSha).toBe(runtimeSha);
  });

  it('C: divergent repository baselines stay independent', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ])),
    });
    expect(readiness.components.checkouts.reasonCode).not.toBe('runtime_baseline_remote_mismatch');
  });

  it('D: missing repository-specific evidence fails closed without v1 fallback', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
      ] as RuntimeRunnerReadinessRecordV2['repositories'])),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_runner_repository_evidence_missing');
  });

  it('E: wrong origin blocks launch', async () => {
    const readiness = await actualReadiness('asi-landing', {
      resolveBaselineSha: async () => landingSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha, { originReady: false }),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ])),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkout_remote_mismatch');
  });

  it('F: stale readiness blocks launch', async () => {
    const actual = await vi.importActual<typeof import('../readiness')>('../readiness');
    const readiness = await actual.getDevelopmentReadiness({
      repositoryId: 'asi-landing',
      env: readyEnv,
      now: () => new Date('2026-08-01T00:02:00.000Z'),
      probeBridgeStorage: async () => {},
      probeGitHub: async () => {},
      resolveBaselineSha: async () => landingSha,
      loadRunnerReadiness: async () => ({
        status: 'stale' as const,
        record: v2Record([
          repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
          repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
        ]),
      }),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_runner_readiness_stale');
  });

  it('G: baseline SHA mismatch blocks launch', async () => {
    const readiness = await actualReadiness('asi-landing', {
      resolveBaselineSha: async () => 'b'.repeat(40),
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ])),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_baseline_remote_mismatch');
  });

  it('H: supported v1 compatibility for landing remains functional', async () => {
    const readiness = await actualReadiness('asi-landing', {
      resolveBaselineSha: async () => landingSha,
      loadRunnerReadiness: async () => runnerStatus(v1Record(landingSha)),
    });
    expect(readiness.canLaunch).toBe(true);
    expect(readiness.runnerEvidence?.schemaVersion).toBe('asi.runtime.runner-readiness.v1');
  });

  it('I: supported v1 compatibility for runtime ignores landing-only baselineSha', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v1Record(landingSha)),
    });
    expect(readiness.canLaunch).toBe(true);
    expect(readiness.components.checkouts.reasonCode).not.toBe('runtime_baseline_remote_mismatch');
  });

  it('J: unknown repository id fails closed', async () => {
    const readiness = await actualReadiness('forged-repo-id');
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.baseline.reasonCode).toBe('repository_not_allowed');
  });
});

describe('runner-readiness.v2 recoverable checkout drift self-healing', () => {
  function recoverableDriftEvidence(
    repositoryId: 'landing' | 'runtime',
    fullName: 'ASI-integration/asi-landing' | 'ASI-integration/asi-os-runtime',
    observedBaselineSha: string,
    overrides: Partial<RuntimeRunnerReadinessRecordV2['repositories'][number]> = {},
  ) {
    return repositoryEvidence(repositoryId, fullName, observedBaselineSha, {
      checkoutReady: false,
      blockers: ['runtime_checkout_recoverable_drift'],
      ...overrides,
    });
  }

  function degradedCheckoutsCapabilities(): RuntimeRunnerReadinessRecordV2['capabilities'] {
    return {
      checkouts: { state: 'degraded', reasonCode: 'runtime_checkout_recoverable_drift' },
      baselineRecovery: { state: 'ready', reasonCode: 'runtime_baseline_recovery_ready' },
      executor: { state: 'ready', reasonCode: 'runtime_executor_ready' },
    };
  }

  it('allows launch when recoverable drift has valid safety evidence for runtime', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ], {
        capabilities: degradedCheckoutsCapabilities(),
      })),
    });
    expect(readiness.canLaunch).toBe(true);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkout_recoverable_drift');
    expect(readiness.components.checkouts.blockingLaunch).toBe(false);
    expect(readiness.components.checkouts.state).toBe('degraded');
    expect(readiness.overallState).toBe('degraded');
    expect(readiness.runnerEvidence?.readinessState).toBe('degraded');
    expect(readiness.runnerEvidence?.blockingReason).toBeNull();
  });

  it('allows launch when recoverable drift has valid safety evidence for landing', async () => {
    const readiness = await actualReadiness('asi-landing', {
      resolveBaselineSha: async () => landingSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        recoverableDriftEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ], {
        capabilities: degradedCheckoutsCapabilities(),
      })),
    });
    expect(readiness.canLaunch).toBe(true);
    expect(readiness.components.checkouts.blockingLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkout_recoverable_drift');
  });

  it('blocks recoverable drift when originReady is false', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          originReady: false,
        }),
      ], {
        capabilities: degradedCheckoutsCapabilities(),
      })),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkout_remote_mismatch');
  });

  it('blocks recoverable drift when baselineReady is false', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          baselineReady: false,
        }),
      ], {
        capabilities: degradedCheckoutsCapabilities(),
      })),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkout_recoverable_drift');
    expect(readiness.components.checkouts.blockingLaunch).toBe(true);
  });

  it('blocks recoverable drift when observedBaselineSha mismatches verified main', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', 'd'.repeat(40)),
      ], {
        capabilities: degradedCheckoutsCapabilities(),
      })),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkout_recoverable_drift');
    expect(readiness.components.checkouts.blockingLaunch).toBe(true);
  });

  it('blocks recoverable drift when recoveryReady is false', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          recoveryReady: false,
        }),
      ], {
        capabilities: degradedCheckoutsCapabilities(),
      })),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkout_recoverable_drift');
    expect(readiness.components.checkouts.blockingLaunch).toBe(true);
  });

  it('blocks recoverable drift when baselineRecovery capability is unavailable', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ], {
        capabilities: {
          ...degradedCheckoutsCapabilities(),
          baselineRecovery: { state: 'blocked', reasonCode: 'runtime_baseline_recovery_unavailable' },
        },
      })),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_baseline_recovery_unavailable');
  });

  it('blocks recoverable drift when executor is unavailable', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ], {
        capabilities: {
          ...degradedCheckoutsCapabilities(),
          executor: { state: 'blocked', reasonCode: 'runtime_executor_unavailable' },
        },
      })),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.executor.blockingLaunch).toBe(true);
  });

  it('blocks recoverable drift when runner has global blockers', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ], {
        capabilities: degradedCheckoutsCapabilities(),
        blockers: ['runtime_global_blocker'],
      })),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.blockingLaunch).toBe(true);
  });

  it('blocks dirty checkout even when other flags resemble recoverable drift', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          blockers: ['runtime_checkout_dirty'],
        }),
      ], {
        capabilities: {
          checkouts: { state: 'blocked', reasonCode: 'runtime_checkout_dirty' },
          baselineRecovery: { state: 'ready', reasonCode: 'runtime_baseline_recovery_ready' },
          executor: { state: 'ready', reasonCode: 'runtime_executor_ready' },
        },
      })),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkout_dirty');
  });

  it('blocks when capability checkouts state is ready despite recoverable repository drift', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ], {
        capabilities: {
          checkouts: { state: 'ready', reasonCode: 'runtime_checkouts_ready' },
          baselineRecovery: { state: 'ready', reasonCode: 'runtime_baseline_recovery_ready' },
          executor: { state: 'ready', reasonCode: 'runtime_executor_ready' },
        },
      })),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkout_recoverable_drift');
    expect(readiness.components.checkouts.blockingLaunch).toBe(true);
  });

  it('blocks when repository blockers omit recoverable drift even if capability claims it', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          blockers: [],
        }),
      ], {
        capabilities: degradedCheckoutsCapabilities(),
      })),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.blockingLaunch).toBe(true);
  });

  it('blocks when canonical checkout path is not an approved binding', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          canonicalCheckoutPath: '/tmp/untrusted-runtime-checkout',
        }),
      ], {
        capabilities: degradedCheckoutsCapabilities(),
      })),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.blockingLaunch).toBe(true);
  });

  it('blocks stale readiness even when recoverable drift evidence would otherwise allow launch', async () => {
    const actual = await vi.importActual<typeof import('../readiness')>('../readiness');
    const readiness = await actual.getDevelopmentReadiness({
      repositoryId: 'asi-os-runtime',
      env: readyEnv,
      now: () => new Date('2026-08-01T00:02:00.000Z'),
      probeBridgeStorage: async () => {},
      probeGitHub: async () => {},
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => ({
        status: 'stale' as const,
        record: v2Record([
          repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
          recoverableDriftEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
        ], {
          capabilities: degradedCheckoutsCapabilities(),
        }),
      }),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_runner_readiness_stale');
  });

  it('preserves v1 recoverable drift launch compatibility for landing', async () => {
    const readiness = await actualReadiness('asi-landing', {
      resolveBaselineSha: async () => landingSha,
      loadRunnerReadiness: async () => runnerStatus({
        ...v1Record(landingSha),
        capabilities: {
          checkouts: { state: 'degraded', reasonCode: 'runtime_checkout_recoverable_drift' },
          baselineRecovery: { state: 'ready', reasonCode: 'runtime_baseline_recovery_ready' },
          executor: { state: 'ready', reasonCode: 'runtime_executor_ready' },
        },
      }),
    });
    expect(readiness.canLaunch).toBe(true);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkout_recoverable_drift');
    expect(readiness.components.checkouts.blockingLaunch).toBe(false);
    expect(readiness.runnerEvidence?.schemaVersion).toBe('asi.runtime.runner-readiness.v1');
  });
});

describe('runner-readiness.v2 bridge parsing', () => {
  it('accepts valid v2 publish payload', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ]),
    });
    expect(parsed?.operation).toBe('runner_publish_readiness');
  });

  it('accepts absolute checkout paths from Runtime producer', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha, {
          canonicalCheckoutPath: '/srv/asi-landing',
        }),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          canonicalCheckoutPath: '/srv/asi-os-runtime',
        }),
      ]),
    });
    expect(parsed?.operation).toBe('runner_publish_readiness');
  });

  it('accepts repository-pool checkout paths from Runtime producer', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha, {
          canonicalCheckoutPath: '/var/lib/asi-runtime/repos/asi-landing',
        }),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          canonicalCheckoutPath: '/var/lib/asi-runtime/repos/asi-os-runtime',
        }),
      ]),
    });
    expect(parsed?.operation).toBe('runner_publish_readiness');
  });

  it('accepts mixed srv and repository-pool checkout layouts', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha, {
          canonicalCheckoutPath: '/var/lib/asi-runtime/repos/asi-landing',
        }),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          canonicalCheckoutPath: '/srv/asi-os-runtime',
        }),
      ]),
    });
    expect(parsed?.operation).toBe('runner_publish_readiness');
  });

  it('rejects wrong repository binding between repositoryId and fullName', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-os-runtime', landingSha),
      ] as RuntimeRunnerReadinessRecordV2['repositories']),
    });
    expect(parsed).toBeNull();
  });

  it('rejects checkout paths bound to the wrong repository identity', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha, {
          canonicalCheckoutPath: '/srv/asi-os-runtime',
        }),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          canonicalCheckoutPath: '/srv/asi-landing',
        }),
      ]),
    });
    expect(parsed).toBeNull();
  });

  it('rejects unrelated checkout locations', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha, {
          canonicalCheckoutPath: '/tmp/asi-landing',
        }),
      ] as RuntimeRunnerReadinessRecordV2['repositories']),
    });
    expect(parsed).toBeNull();
  });

  it('rejects malformed checkout path values', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha, {
          canonicalCheckoutPath: '/var/lib/asi-runtime/repos/../asi-landing',
        }),
      ] as RuntimeRunnerReadinessRecordV2['repositories']),
    });
    expect(parsed).toBeNull();
  });

  it('accepts bounded publication with one allowlisted repository', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
      ] as RuntimeRunnerReadinessRecordV2['repositories']),
    });
    expect(parsed?.operation).toBe('runner_publish_readiness');
  });

  it('rejects unsupported readiness version', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: {
        ...v2Record([
          repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
          repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
        ]),
        schemaVersion: 'asi.runtime.runner-readiness.v3',
      },
    });
    expect(parsed).toBeNull();
  });

  it('accepts blocked runtime evidence with empty expectedOrigin when origin is missing', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          expectedOrigin: '',
          observedBaselineSha: null,
          checkoutReady: false,
          originReady: false,
          baselineReady: false,
          recoveryReady: false,
          blockers: ['runtime_repository_origin_missing'],
        }),
      ]),
    });
    expect(parsed?.operation).toBe('runner_publish_readiness');
  });

  it('rejects empty expectedOrigin without runtime_repository_origin_missing blocker', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          expectedOrigin: '',
          observedBaselineSha: null,
          checkoutReady: false,
          originReady: false,
          baselineReady: false,
          recoveryReady: false,
          blockers: ['runtime_checkout_probe_failed'],
        }),
      ]),
    });
    expect(parsed).toBeNull();
  });

  it('rejects empty expectedOrigin when originReady is true', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          expectedOrigin: '',
          observedBaselineSha: null,
          checkoutReady: false,
          originReady: true,
          baselineReady: false,
          recoveryReady: false,
          blockers: ['runtime_repository_origin_missing'],
        }),
      ]),
    });
    expect(parsed).toBeNull();
  });

  it('rejects empty expectedOrigin when any readiness flag is true', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          expectedOrigin: '',
          observedBaselineSha: null,
          checkoutReady: true,
          originReady: false,
          baselineReady: false,
          recoveryReady: false,
          blockers: ['runtime_repository_origin_missing'],
        }),
      ]),
    });
    expect(parsed).toBeNull();
  });

  it('rejects malformed non-empty expectedOrigin', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha, {
          expectedOrigin: 'https://github.com/other-org/asi-os-runtime.git',
        }),
      ]),
    });
    expect(parsed).toBeNull();
  });
});

describe('runner-readiness.v2 Runtime PR #99 cross-contract fixture', () => {
  it('parses the exact Runtime producer payload shape', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: runtimePr99Fixture,
    });
    expect(parsed?.operation).toBe('runner_publish_readiness');
    if (!parsed || parsed.operation !== 'runner_publish_readiness') return;
    const record = parsed.input;
    if (record.schemaVersion !== 'asi.runtime.runner-readiness.v2') return;
    expect(record.capabilities).toEqual(readyV2Capabilities());
    expect(record.repositories[0].canonicalCheckoutPath).toBe('/srv/asi-landing');
    expect(record.repositories[1].canonicalCheckoutPath).toBe('/srv/asi-os-runtime');
    expect(record.repositories[1].expectedOrigin).toBe(
      'git@github.com-asi-os-runtime:ASI-integration/asi-os-runtime.git',
    );
    expect(record.repositories[0].observedBaselineSha).toBe(landingSha);
    expect(record.repositories[1].observedBaselineSha).toBe(runtimeSha);
  });

  it('reconciles landing and runtime independently from the Runtime fixture', async () => {
    const landingReadiness = await actualReadiness('asi-landing', {
      resolveBaselineSha: async () => landingSha,
      loadRunnerReadiness: async () => runnerStatus(runtimePr99Fixture),
    });
    expect(landingReadiness.canLaunch).toBe(true);
    expect(landingReadiness.runnerEvidence?.observedBaselineSha).toBe(landingSha);

    const runtimeReadiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(runtimePr99Fixture),
    });
    expect(runtimeReadiness.canLaunch).toBe(true);
    expect(runtimeReadiness.runnerEvidence?.observedBaselineSha).toBe(runtimeSha);
  });
});

describe('runner-readiness.v2 Runtime PR #100 missing-origin cross-contract fixture', () => {
  it('parses the exact Runtime producer payload with blocked missing runtime origin', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: runtimePr100Fixture,
    });
    expect(parsed?.operation).toBe('runner_publish_readiness');
    if (!parsed || parsed.operation !== 'runner_publish_readiness') return;
    const record = parsed.input;
    if (record.schemaVersion !== 'asi.runtime.runner-readiness.v2') return;
    expect(record.repositories[1].expectedOrigin).toBe('');
    expect(record.repositories[1].blockers).toEqual(['runtime_repository_origin_missing']);
  });

  it('keeps landing launchable while runtime stays independently blocked', async () => {
    const landingReadiness = await actualReadiness('asi-landing', {
      resolveBaselineSha: async () => landingSha,
      loadRunnerReadiness: async () => runnerStatus(runtimePr100Fixture),
    });
    expect(landingReadiness.canLaunch).toBe(true);
    expect(landingReadiness.runnerEvidence?.observedBaselineSha).toBe(landingSha);

    const runtimeReadiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(runtimePr100Fixture),
    });
    expect(runtimeReadiness.canLaunch).toBe(false);
    expect(runtimeReadiness.components.checkouts.reasonCode).toBe('runtime_checkout_remote_mismatch');
    expect(runtimeReadiness.runnerEvidence?.observedBaselineSha).toBeNull();
  });
});
