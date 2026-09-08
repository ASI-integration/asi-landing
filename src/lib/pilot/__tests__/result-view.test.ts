import { describe, expect, it, vi } from 'vitest';
import type { RuntimeBridgeSafeResult } from '@/lib/asi-runtime/bridge-types';
import { buildPilotSafeResultView } from '../result-view';

vi.mock('server-only', () => ({}));

function bridgeResult(overrides: Partial<RuntimeBridgeSafeResult> = {}): RuntimeBridgeSafeResult {
  return {
    schemaVersion: 'asi.runtime.result.v1',
    status: 'completed',
    summary: 'Added proof under docs/pilot/',
    changedFiles: ['docs/pilot/proof.md'],
    checks: [{ name: 'lint', status: 'PASS' }],
    artifacts: [
      { type: 'pull_request', value: 'https://github.com/ASI-integration/asi-landing/pull/42' },
      { type: 'commit', value: 'b'.repeat(40) },
    ],
    blockers: [],
    ...overrides,
  };
}

describe('SP-04 buildPilotSafeResultView', () => {
  it('exposes only safe fields for succeeded tasks', () => {
    const view = buildPilotSafeResultView({
      consoleStatus: 'succeeded',
      bridgeResult: bridgeResult(),
    });
    expect(view).toEqual({
      outcome: 'succeeded',
      summary: 'Added proof under docs/pilot/',
      changedFiles: ['docs/pilot/proof.md'],
      pullRequestUrl: 'https://github.com/ASI-integration/asi-landing/pull/42',
      commitSha: 'b'.repeat(40),
      blockers: [],
    });
    expect(JSON.stringify(view)).not.toMatch(/schemaVersion|checks|leaseToken|SERVICE_ROLE/i);
  });

  it('returns empty result for non-terminal console statuses', () => {
    const view = buildPilotSafeResultView({
      consoleStatus: 'running',
      bridgeResult: bridgeResult(),
    });
    expect(view.outcome).toBeNull();
    expect(view.changedFiles).toEqual([]);
  });

  it('strips secret-like and absolute paths from changed files', () => {
    const view = buildPilotSafeResultView({
      consoleStatus: 'succeeded',
      bridgeResult: bridgeResult({
        changedFiles: [
          'docs/pilot/ok.md',
          'C:\\secrets\\token.txt',
          '../etc/passwd',
          'path/with/sk-abcdefghijklmnopqrstuvwxyz0123456789',
        ],
        summary: 'ok sk-abcdefghijklmnopqrstuvwxyz0123456789 leaked',
      }),
    });
    expect(view.changedFiles).toEqual(['docs/pilot/ok.md']);
    expect(view.summary).toBeNull();
  });

  it('rejects non-allowlisted PR URLs', () => {
    const view = buildPilotSafeResultView({
      consoleStatus: 'failed',
      bridgeResult: bridgeResult({
        status: 'failed',
        summary: 'Blocked',
        artifacts: [{ type: 'pull_request', value: 'https://evil.example/pr/1' }],
        blockers: ['Needs owner review'],
      }),
    });
    expect(view.outcome).toBe('failed');
    expect(view.pullRequestUrl).toBeNull();
    expect(view.blockers).toEqual(['Needs owner review']);
  });
});
