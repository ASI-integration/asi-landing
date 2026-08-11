import { describe, expect, it } from 'vitest';
import { parseRuntimeBridgeRunnerInput } from '@/lib/asi-runtime/bridge-schema';
import { safeAllowlistedPullRequestUrl } from '../pr-url';

describe('safeAllowlistedPullRequestUrl', () => {
  it('accepts valid PR URLs for both allowlisted GitHub repositories', () => {
    expect(safeAllowlistedPullRequestUrl('https://github.com/ASI-integration/asi-landing/pull/116')).toBe(
      'https://github.com/ASI-integration/asi-landing/pull/116',
    );
    expect(safeAllowlistedPullRequestUrl('https://github.com/ASI-integration/asi-os-runtime/pull/7')).toBe(
      'https://github.com/ASI-integration/asi-os-runtime/pull/7',
    );
  });

  it('rejects an invalid URL', () => {
    expect(safeAllowlistedPullRequestUrl('not-a-url')).toBeNull();
    expect(safeAllowlistedPullRequestUrl('')).toBeNull();
  });

  it('rejects another host', () => {
    expect(
      safeAllowlistedPullRequestUrl('https://evil.example/ASI-integration/asi-landing/pull/1'),
    ).toBeNull();
  });

  it('rejects another repository', () => {
    expect(safeAllowlistedPullRequestUrl('https://github.com/ASI-integration/other-repo/pull/1')).toBeNull();
    expect(safeAllowlistedPullRequestUrl('https://github.com/other/asi-landing/pull/1')).toBeNull();
  });

  it('accepts a runtime PR result without allowing a third repository', () => {
    const input = {
      operation: 'runner_submit_result',
      input: {
        runnerId: 'runner-1',
        taskId: '11111111-1111-4111-8111-111111111111',
        leaseToken: '22222222-2222-4222-8222-222222222222',
        result: {
          schemaVersion: 'asi.runtime.result.v1',
          status: 'completed',
          summary: 'Runtime task complete.',
          changedFiles: [],
          checks: [],
          artifacts: [{
            type: 'pull_request',
            value: 'https://github.com/ASI-integration/asi-os-runtime/pull/7',
          }],
          blockers: [],
        },
      },
    };

    expect(parseRuntimeBridgeRunnerInput(input)).not.toBeNull();
    expect(parseRuntimeBridgeRunnerInput({
      ...input,
      input: {
        ...input.input,
        result: {
          ...input.input.result,
          artifacts: [{
            type: 'pull_request',
            value: 'https://github.com/ASI-integration/third-repository/pull/7',
          }],
        },
      },
    })).toBeNull();
  });
});
