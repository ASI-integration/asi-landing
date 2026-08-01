import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executeWithRuntimeBaselineRecovery,
  inspectRuntimeCheckoutReadiness,
  isExpectedRuntimeRemote,
  parseRuntimeCheckoutConfig,
  synchronizeRuntimeCheckouts,
} from '../../../../scripts/asi-runtime-baseline-recovery.mjs';

const run = promisify(execFile);
const temporaryDirectories: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await run('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return result.stdout.trim();
}

async function createCheckoutFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'asi-baseline-recovery-'));
  temporaryDirectories.push(root);
  const source = path.join(root, 'source');
  const remote = path.join(root, 'remote.git');
  const first = path.join(root, 'runtime-a');
  const second = path.join(root, 'runtime-b');

  await run('git', ['init', source]);
  await git(source, ['config', 'user.name', 'ASI Test']);
  await git(source, ['config', 'user.email', 'asi-test@example.invalid']);
  await writeFile(path.join(source, 'marker.txt'), 'baseline-one\n', 'utf8');
  await git(source, ['add', 'marker.txt']);
  await git(source, ['commit', '-m', 'baseline one']);
  await git(source, ['branch', '-M', 'main']);
  await run('git', ['init', '--bare', remote]);
  await git(source, ['remote', 'add', 'origin', remote]);
  await git(source, ['push', '-u', 'origin', 'main']);
  const firstSha = await git(source, ['rev-parse', 'HEAD']);
  await run('git', ['clone', '--branch', 'main', remote, first]);
  await run('git', ['clone', '--branch', 'main', remote, second]);
  await writeFile(path.join(source, 'marker.txt'), 'baseline-two\n', 'utf8');
  await git(source, ['add', 'marker.txt']);
  await git(source, ['commit', '-m', 'baseline two']);
  await git(source, ['push', 'origin', 'main']);
  const baselineSha = await git(source, ['rev-parse', 'HEAD']);

  return {
    remote,
    firstSha,
    baselineSha,
    checkouts: [
      { id: 'runtime-primary', path: first },
      { id: 'runtime-secondary', path: second },
    ],
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  )));
});

describe('Runtime baseline recovery', () => {
  it('requires exactly two distinct absolute checkout identities and credential-free GitHub origin', () => {
    expect(parseRuntimeCheckoutConfig(JSON.stringify([
      { id: 'runtime-primary', path: path.join(os.tmpdir(), 'runtime-primary') },
      { id: 'runtime-secondary', path: path.join(os.tmpdir(), 'runtime-secondary') },
    ]))).toHaveLength(2);
    expect(() => parseRuntimeCheckoutConfig(JSON.stringify([
      { id: 'runtime-primary', path: path.join(os.tmpdir(), 'runtime-primary') },
    ]))).toThrow('runtime_checkout_config_invalid');
    expect(isExpectedRuntimeRemote(
      'https://github.com/ASI-integration/asi-landing.git',
      'ASI-integration/asi-landing',
    )).toBe(true);
    expect(isExpectedRuntimeRemote(
      'https://token@github.com/ASI-integration/asi-landing.git',
      'ASI-integration/asi-landing',
    )).toBe(false);
  });

  it('synchronizes both clean Runtime checkouts to the exact baseline', async () => {
    const fixture = await createCheckoutFixture();
    expect(await git(fixture.checkouts[0].path, ['rev-parse', 'HEAD'])).toBe(fixture.firstSha);

    const evidence = await synchronizeRuntimeCheckouts({
      checkouts: fixture.checkouts,
      repository: 'ASI-integration/asi-landing',
      branch: 'main',
      baselineSha: fixture.baselineSha,
      validateRemote: (remoteUrl) => remoteUrl === fixture.remote,
    });

    expect(evidence).toEqual([
      expect.objectContaining({ checkoutId: 'runtime-primary', afterSha: fixture.baselineSha }),
      expect.objectContaining({ checkoutId: 'runtime-secondary', afterSha: fixture.baselineSha }),
    ]);
    expect(await git(fixture.checkouts[0].path, ['status', '--porcelain'])).toBe('');
    expect(await git(fixture.checkouts[1].path, ['status', '--porcelain'])).toBe('');
  }, 20_000);

  it('probes checkout readiness without mutating drift or dirty state', async () => {
    const fixture = await createCheckoutFixture();
    const inspect = () => inspectRuntimeCheckoutReadiness({
      checkouts: fixture.checkouts,
      repository: 'ASI-integration/asi-landing',
      branch: 'main',
      baselineSha: fixture.baselineSha,
      validateRemote: (remoteUrl: string) => remoteUrl === fixture.remote,
    });

    const drift = await inspect();
    expect(drift).toMatchObject({
      state: 'degraded',
      reasonCode: 'runtime_checkout_recoverable_drift',
    });
    expect(await git(fixture.checkouts[0].path, ['rev-parse', 'HEAD'])).toBe(fixture.firstSha);

    await writeFile(path.join(fixture.checkouts[1].path, 'local-change.txt'), 'keep me\n', 'utf8');
    await expect(inspect()).rejects.toMatchObject({ code: 'runtime_checkout_dirty' });
    expect(await git(fixture.checkouts[1].path, ['status', '--porcelain'])).toContain('local-change.txt');

    await expect(inspectRuntimeCheckoutReadiness({
      checkouts: [
        fixture.checkouts[0],
        { id: 'runtime-missing', path: path.join(path.dirname(fixture.remote), 'missing') },
      ],
      repository: 'ASI-integration/asi-landing',
      branch: 'main',
      baselineSha: fixture.baselineSha,
      validateRemote: (remoteUrl: string) => remoteUrl === fixture.remote,
    })).rejects.toMatchObject({ code: 'runtime_checkout_missing', checkoutId: 'runtime-missing' });
  }, 20_000);

  it('hides a recoverable mismatch and retries the same task exactly once', async () => {
    const task = {
      taskId: '11111111-1111-4111-8111-111111111111',
      request: { repository: 'ASI-integration/asi-landing', baselineSha: 'a'.repeat(40) },
    };
    const executeTask = vi.fn()
      .mockResolvedValueOnce({ type: 'result', result: {
        schemaVersion: 'asi.runtime.result.v1', status: 'failed', summary: 'failed',
        changedFiles: [], checks: [], artifacts: [], blockers: ['runtime_baseline_mismatch'],
      } })
      .mockResolvedValueOnce({ type: 'result', result: {
        schemaVersion: 'asi.runtime.result.v1', status: 'completed', summary: 'done',
        changedFiles: [], checks: [], artifacts: [], blockers: [],
      } });
    const synchronize = vi.fn().mockResolvedValue([]);

    const outcome = await executeWithRuntimeBaselineRecovery({
      task,
      checkouts: [{ id: 'a', path: 'A' }, { id: 'b', path: 'B' }],
      executeTask,
      synchronize,
    });

    expect(outcome.result.status).toBe('completed');
    expect(JSON.stringify(outcome)).not.toMatch(/runtime_baseline_mismatch/);
    expect(executeTask).toHaveBeenCalledTimes(2);
    expect(executeTask.mock.calls[0][0]).toBe(task);
    expect(executeTask.mock.calls[1][0]).toBe(task);
    expect(synchronize).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('returns an auditable terminal blocker when a dirty checkout cannot recover', async () => {
    const fixture = await createCheckoutFixture();
    await writeFile(path.join(fixture.checkouts[1].path, 'local-change.txt'), 'keep me\n', 'utf8');
    const task = {
      taskId: '22222222-2222-4222-8222-222222222222',
      request: { repository: 'ASI-integration/asi-landing', baselineSha: fixture.baselineSha },
    };
    const executeTask = vi.fn();

    const outcome = await executeWithRuntimeBaselineRecovery({
      task,
      checkouts: fixture.checkouts,
      executeTask,
      synchronize: (input) => synchronizeRuntimeCheckouts({
        ...input,
        validateRemote: (remoteUrl) => remoteUrl === fixture.remote,
      }),
    });

    expect(outcome.result.status).toBe('failed');
    expect(outcome.result.blockers).toEqual(expect.arrayContaining([
      'runtime_baseline_recovery_failed',
      'record_identity:22222222-2222-4222-8222-222222222222',
    ]));
    expect(JSON.stringify(outcome)).not.toContain(fixture.checkouts[1].path);
    expect(executeTask).not.toHaveBeenCalled();
  }, 20_000);

  it('stops after one failed recovery retry and preserves record identity', async () => {
    const task = {
      taskId: '33333333-3333-4333-8333-333333333333',
      request: { repository: 'ASI-integration/asi-landing', baselineSha: 'b'.repeat(40) },
    };
    const mismatch = { type: 'result', result: {
      schemaVersion: 'asi.runtime.result.v1', status: 'failed', summary: 'failed',
      changedFiles: [], checks: [], artifacts: [], blockers: ['runtime_baseline_mismatch'],
    } };
    const executeTask = vi.fn().mockResolvedValue(mismatch);
    const synchronize = vi.fn().mockResolvedValue([]);

    const outcome = await executeWithRuntimeBaselineRecovery({
      task,
      checkouts: [{ id: 'a', path: 'A' }, { id: 'b', path: 'B' }],
      executeTask,
      synchronize,
    });

    expect(outcome.result.status).toBe('failed');
    expect(outcome.result.blockers).toContain('runtime_baseline_retry_failed');
    expect(outcome.result.blockers).toContain('record_identity:33333333-3333-4333-8333-333333333333');
    expect(executeTask).toHaveBeenCalledTimes(2);
    expect(synchronize).toHaveBeenCalledTimes(2);
  });
});
