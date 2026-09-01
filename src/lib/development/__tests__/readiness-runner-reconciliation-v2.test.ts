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

function repositoryEvidence(
  repositoryId: 'landing' | 'runtime',
  fullName: 'ASI-integration/asi-landing' | 'ASI-integration/asi-os-runtime',
  observedBaselineSha: string,
  overrides: Partial<RuntimeRunnerReadinessRecordV2['repositories'][number]> = {},
) {
  return {
    repositoryId,
    fullName,
    checkoutPath: 'worktrees/example',
    expectedOrigin: `https://github.com/${fullName}.git`,
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
    capabilities: {
      executor: { state: 'ready', reasonCode: 'runtime_executor_ready' },
    },
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

  it('rejects malformed v2 payload with absolute checkout path', () => {
    const parsed = parseRuntimeBridgeRunnerInput({
      operation: 'runner_publish_readiness',
      input: v2Record([
        repositoryEvidence('landing', 'ASI-integration/asi-landing', landingSha, {
          checkoutPath: '/srv/asi-landing',
        }),
        repositoryEvidence('runtime', 'ASI-integration/asi-os-runtime', runtimeSha),
      ]),
    });
    expect(parsed).toBeNull();
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
});
