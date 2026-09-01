import { describe, expect, it, vi } from 'vitest';
import type { RuntimeRunnerReadinessRecord } from '@/lib/asi-runtime/bridge-types';

vi.mock('server-only', () => ({}));

const readyEnv = {
  ASI_RUNTIME_BRIDGE_CLIENT_ID: 'owner-console',
  ASI_RUNTIME_BRIDGE_SUPABASE_URL: 'https://bridge-isolated.example.com',
  ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY: 'not-returned-by-readiness',
};

function runnerStatus(
  baselineSha: string,
  capabilities: Record<string, unknown> = {},
) {
  const record: RuntimeRunnerReadinessRecord = {
    schemaVersion: 'asi.runtime.runner-readiness.v1',
    runnerId: 'runner-1234567890abcdef12345678',
    checkedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-01T00:01:00.000Z',
    baselineSha,
    capabilities: {
      checkouts: { state: 'ready', reasonCode: 'runtime_checkouts_ready' },
      baselineRecovery: { state: 'ready', reasonCode: 'runtime_baseline_recovery_ready' },
      executor: { state: 'ready', reasonCode: 'runtime_executor_ready' },
      ...capabilities,
    },
  };
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
    loadRunnerReadiness: async () => runnerStatus('a'.repeat(40)),
    resolveBaselineSha: async () => 'a'.repeat(40),
    ...overrides,
  });
}

describe('repository-aware runner-readiness v1 reconciliation', () => {
  const landingSha = 'a'.repeat(40);
  const landingShaB = 'b'.repeat(40);
  const runtimeSha = 'c'.repeat(40);

  it('A: asi-landing with matching runner v1 baseline and GitHub baseline can launch', async () => {
    const readiness = await actualReadiness('asi-landing', {
      resolveBaselineSha: async () => landingSha,
      loadRunnerReadiness: async () => runnerStatus(landingSha),
    });
    expect(readiness.canLaunch).toBe(true);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkouts_ready');
  });

  it('B: asi-landing with runner v1 baseline mismatch blocks launch', async () => {
    const readiness = await actualReadiness('asi-landing', {
      resolveBaselineSha: async () => landingShaB,
      loadRunnerReadiness: async () => runnerStatus(landingSha),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_baseline_remote_mismatch');
  });

  it('C: asi-os-runtime ignores landing-only runner v1 baselineSha when runtime baseline differs', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(landingSha),
    });
    expect(readiness.canLaunch).toBe(true);
    expect(readiness.components.checkouts.reasonCode).not.toBe('runtime_baseline_remote_mismatch');
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkouts_ready');
  });

  it('D: asi-os-runtime with blocked checkouts cannot launch', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(landingSha, {
        checkouts: { state: 'blocked', reasonCode: 'runtime_checkout_dirty' },
      }),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_checkout_dirty');
  });

  it('E: asi-os-runtime with blocked baselineRecovery cannot launch', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(landingSha, {
        baselineRecovery: { state: 'blocked', reasonCode: 'runtime_baseline_recovery_unavailable' },
      }),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.checkouts.reasonCode).toBe('runtime_baseline_recovery_unavailable');
  });

  it('F: asi-os-runtime with blocked executor cannot launch', async () => {
    const readiness = await actualReadiness('asi-os-runtime', {
      resolveBaselineSha: async () => runtimeSha,
      loadRunnerReadiness: async () => runnerStatus(landingSha, {
        executor: { state: 'blocked', reasonCode: 'runtime_executor_unavailable' },
      }),
    });
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.components.executor.reasonCode).toBe('runtime_executor_unavailable');
  });

  it('G: forged repository id fails closed', async () => {
    const readiness = await actualReadiness('forged-repo-id');
    expect(readiness.canLaunch).toBe(false);
    expect(readiness.overallState).toBe('blocked');
    expect(readiness.components.baseline.reasonCode).toBe('repository_not_allowed');
  });
});
