import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DISABLED_HOOKS_PATH = process.platform === 'win32' ? 'NUL' : '/dev/null';
export const RUNTIME_BASELINE_MISMATCH = 'runtime_baseline_mismatch';

export class RuntimeBaselineRecoveryError extends Error {
  constructor(code, checkoutId = null) {
    super(code);
    this.code = code;
    this.checkoutId = checkoutId;
  }
}

function absolutePath(value) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

export function parseRuntimeCheckoutConfig(raw) {
  let value;
  try {
    value = JSON.parse(raw ?? '');
  } catch {
    throw new RuntimeBaselineRecoveryError('runtime_checkout_config_invalid');
  }
  if (!Array.isArray(value) || value.length !== 2) {
    throw new RuntimeBaselineRecoveryError('runtime_checkout_config_invalid');
  }
  const checkouts = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some((key) => !['id', 'path'].includes(key))
      || typeof item.id !== 'string'
      || !SAFE_ID.test(item.id)
      || typeof item.path !== 'string'
      || !absolutePath(item.path)
      || path.normalize(item.path) === path.parse(path.normalize(item.path)).root) {
      throw new RuntimeBaselineRecoveryError('runtime_checkout_config_invalid');
    }
    return { id: item.id, path: path.normalize(item.path) };
  });
  if (new Set(checkouts.map((item) => item.id)).size !== checkouts.length
    || new Set(checkouts.map((item) => item.path.toLowerCase())).size !== checkouts.length) {
    throw new RuntimeBaselineRecoveryError('runtime_checkout_config_invalid');
  }
  return checkouts;
}

function repositoryFromRemote(remoteUrl) {
  const value = String(remoteUrl ?? '').trim();
  const scp = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(value);
  if (scp) return `${scp[1]}/${scp[2]}`;
  try {
    const url = new URL(value);
    if (!['https:', 'ssh:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'github.com') {
      return null;
    }
    if (url.password || url.search || url.hash
      || (url.protocol === 'https:' && url.username)
      || (url.protocol === 'ssh:' && url.username !== 'git')) return null;
    const match = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.pathname);
    return match ? `${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}

export function isExpectedRuntimeRemote(remoteUrl, repository) {
  const resolved = repositoryFromRemote(remoteUrl);
  return Boolean(resolved && resolved.toLowerCase() === String(repository).toLowerCase());
}

async function git(checkout, args, options = {}) {
  try {
    const result = await execFileAsync('git', [
      '-c', `core.hooksPath=${DISABLED_HOOKS_PATH}`,
      '-C', checkout.path,
      ...args,
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: options.timeout ?? 60_000,
      maxBuffer: 256 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
      },
    });
    return String(result.stdout ?? '').trim();
  } catch {
    throw new RuntimeBaselineRecoveryError(options.code ?? 'runtime_checkout_git_failed', checkout.id);
  }
}

async function inspectCheckout(checkout, repository, validateRemote) {
  let checkoutStat;
  try {
    checkoutStat = await stat(checkout.path);
  } catch {
    throw new RuntimeBaselineRecoveryError('runtime_checkout_missing', checkout.id);
  }
  if (!checkoutStat.isDirectory()) {
    throw new RuntimeBaselineRecoveryError('runtime_checkout_missing', checkout.id);
  }
  const insideWorkTree = await git(checkout, ['rev-parse', '--is-inside-work-tree'], {
    code: 'runtime_checkout_not_git',
    timeout: 5_000,
  });
  if (insideWorkTree !== 'true') {
    throw new RuntimeBaselineRecoveryError('runtime_checkout_not_git', checkout.id);
  }
  const status = await git(checkout, ['status', '--porcelain=v1', '--untracked-files=all'], {
    code: 'runtime_checkout_status_failed',
    timeout: 5_000,
  });
  if (status) throw new RuntimeBaselineRecoveryError('runtime_checkout_dirty', checkout.id);
  const remote = await git(checkout, ['config', '--get', 'remote.origin.url'], {
    code: 'runtime_checkout_remote_missing',
    timeout: 5_000,
  });
  if (!validateRemote(remote, repository)) {
    throw new RuntimeBaselineRecoveryError('runtime_checkout_remote_mismatch', checkout.id);
  }
  const beforeSha = await git(checkout, ['rev-parse', 'HEAD'], {
    code: 'runtime_checkout_head_invalid',
    timeout: 5_000,
  });
  if (!SHA.test(beforeSha)) {
    throw new RuntimeBaselineRecoveryError('runtime_checkout_head_invalid', checkout.id);
  }
  let beforeRef = null;
  try {
    beforeRef = await git(checkout, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      code: 'runtime_checkout_detached',
    });
  } catch (error) {
    if (!(error instanceof RuntimeBaselineRecoveryError) || error.code !== 'runtime_checkout_detached') {
      throw error;
    }
  }
  return { ...checkout, beforeSha, beforeRef };
}

/**
 * Read-only readiness probe for the two Runtime checkouts. It never fetches,
 * checks out, resets, or writes refs. Remote branch resolution uses ls-remote.
 */
export async function inspectRuntimeCheckoutReadiness({
  checkouts,
  repository,
  branch = 'main',
  baselineSha,
  validateRemote = isExpectedRuntimeRemote,
}) {
  if (!Array.isArray(checkouts) || checkouts.length !== 2
    || repository !== 'ASI-integration/asi-landing'
    || branch !== 'main'
    || (baselineSha !== undefined && !SHA.test(String(baselineSha)))) {
    throw new RuntimeBaselineRecoveryError('runtime_baseline_request_invalid');
  }

  const inspected = [];
  for (const checkout of checkouts) {
    inspected.push(await inspectCheckout(checkout, repository, validateRemote));
  }

  let observedBaselineSha = baselineSha;
  for (const checkout of inspected) {
    const remoteHead = await git(checkout, [
      'ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`,
    ], { code: 'runtime_baseline_remote_unavailable', timeout: 10_000 });
    const remoteSha = remoteHead.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
    if (!SHA.test(remoteSha)) {
      throw new RuntimeBaselineRecoveryError('runtime_baseline_remote_unavailable', checkout.id);
    }
    observedBaselineSha ??= remoteSha;
    if (remoteSha !== observedBaselineSha) {
      throw new RuntimeBaselineRecoveryError('runtime_baseline_remote_mismatch', checkout.id);
    }
  }

  const driftedCheckoutIds = inspected
    .filter((checkout) => checkout.beforeSha !== observedBaselineSha)
    .map((checkout) => checkout.id);
  return {
    state: driftedCheckoutIds.length ? 'degraded' : 'ready',
    reasonCode: driftedCheckoutIds.length
      ? 'runtime_checkout_recoverable_drift'
      : 'runtime_checkouts_ready',
    baselineSha: observedBaselineSha,
    driftedCheckoutIds,
  };
}

async function restoreCheckout(checkout) {
  if (checkout.beforeRef) {
    await git(checkout, ['checkout', checkout.beforeRef], { code: 'runtime_checkout_rollback_failed' });
  } else {
    await git(checkout, ['checkout', '--detach', checkout.beforeSha], {
      code: 'runtime_checkout_rollback_failed',
    });
  }
}

export async function synchronizeRuntimeCheckouts({
  checkouts,
  repository,
  branch = 'main',
  baselineSha,
  validateRemote = isExpectedRuntimeRemote,
}) {
  if (!Array.isArray(checkouts) || checkouts.length !== 2
    || typeof repository !== 'string' || repository !== 'ASI-integration/asi-landing'
    || branch !== 'main' || !SHA.test(String(baselineSha ?? ''))) {
    throw new RuntimeBaselineRecoveryError('runtime_baseline_request_invalid');
  }

  const inspected = [];
  for (const checkout of checkouts) {
    inspected.push(await inspectCheckout(checkout, repository, validateRemote));
  }
  if (inspected.every((checkout) => checkout.beforeSha === baselineSha)) {
    return inspected.map((checkout) => ({
      checkoutId: checkout.id,
      beforeSha: checkout.beforeSha,
      afterSha: checkout.beforeSha,
      synchronized: false,
    }));
  }

  for (const checkout of inspected.filter((item) => item.beforeSha !== baselineSha)) {
    await git(checkout, [
      'fetch', '--no-tags', 'origin',
      `refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ], { code: 'runtime_baseline_fetch_failed', timeout: 120_000 });
    await git(checkout, ['cat-file', '-e', `${baselineSha}^{commit}`], {
      code: 'runtime_baseline_missing',
    });
    await git(checkout, ['merge-base', '--is-ancestor', baselineSha, `origin/${branch}`], {
      code: 'runtime_baseline_not_on_branch',
    });
  }

  const changed = [];
  try {
    for (const checkout of inspected.filter((item) => item.beforeSha !== baselineSha)) {
      await git(checkout, ['checkout', '--detach', baselineSha], {
        code: 'runtime_baseline_checkout_failed',
      });
      changed.push(checkout);
      const afterSha = await git(checkout, ['rev-parse', 'HEAD'], {
        code: 'runtime_baseline_verify_failed',
      });
      const afterStatus = await git(checkout, ['status', '--porcelain=v1', '--untracked-files=all'], {
        code: 'runtime_baseline_verify_failed',
      });
      if (afterSha !== baselineSha || afterStatus) {
        throw new RuntimeBaselineRecoveryError('runtime_baseline_verify_failed', checkout.id);
      }
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const checkout of [...changed].reverse()) {
      try { await restoreCheckout(checkout); } catch { rollbackFailed = true; }
    }
    if (rollbackFailed) {
      throw new RuntimeBaselineRecoveryError('runtime_baseline_rollback_failed', error?.checkoutId);
    }
    throw error;
  }

  return inspected.map((checkout) => ({
    checkoutId: checkout.id,
    beforeSha: checkout.beforeSha,
    afterSha: baselineSha,
    synchronized: checkout.beforeSha !== baselineSha,
  }));
}

export function containsRuntimeBaselineMismatch(outcome) {
  if (!outcome || outcome.type !== 'result' || !outcome.result || outcome.result.status !== 'failed') {
    return false;
  }
  const evidence = [
    outcome.result.summary,
    ...(Array.isArray(outcome.result.blockers) ? outcome.result.blockers : []),
    ...(Array.isArray(outcome.result.checks)
      ? outcome.result.checks.map((check) => check?.detail)
      : []),
  ];
  return evidence.some((item) => typeof item === 'string'
    && new RegExp(`(?:^|[^A-Za-z0-9_])${RUNTIME_BASELINE_MISMATCH}(?:$|[^A-Za-z0-9_])`).test(item));
}

function safeRecoveryCode(error, fallback) {
  const code = error instanceof RuntimeBaselineRecoveryError ? error.code : fallback;
  return /^[A-Za-z0-9._:-]{1,120}$/.test(code) ? code : fallback;
}

function terminalRecoveryFailure(taskId, code, checkoutId = null) {
  const blockers = [
    'runtime_baseline_recovery_failed',
    `recovery_code:${code}`,
    `record_identity:${taskId}`,
  ];
  if (checkoutId && SAFE_ID.test(checkoutId)) blockers.push(`checkout_identity:${checkoutId}`);
  return {
    type: 'result',
    result: {
      schemaVersion: 'asi.runtime.result.v1',
      status: 'failed',
      summary: 'Не удалось безопасно подготовить Runtime checkout к выбранному baseline.',
      changedFiles: [],
      checks: [{ name: 'runtime-baseline-recovery', status: 'FAIL', detail: code }],
      artifacts: [],
      blockers,
    },
  };
}

function terminalRetryFailure(taskId) {
  return {
    type: 'result',
    result: {
      schemaVersion: 'asi.runtime.result.v1',
      status: 'failed',
      summary: 'Повторный запуск после восстановления baseline не завершился успешно.',
      changedFiles: [],
      checks: [{
        name: 'runtime-baseline-recovery-retry',
        status: 'FAIL',
        detail: 'runtime_baseline_retry_failed',
      }],
      artifacts: [],
      blockers: [
        'runtime_baseline_retry_failed',
        `record_identity:${taskId}`,
      ],
    },
  };
}

function withRecordIdentity(outcome, taskId) {
  if (outcome?.type !== 'result' || outcome.result?.status !== 'failed') return outcome;
  const identity = `record_identity:${taskId}`;
  if (outcome.result.blockers?.includes(identity)) return outcome;
  return {
    ...outcome,
    result: {
      ...outcome.result,
      blockers: [...(outcome.result.blockers ?? []), identity],
    },
  };
}

export async function executeWithRuntimeBaselineRecovery({
  task,
  checkouts,
  executeTask,
  synchronize = synchronizeRuntimeCheckouts,
  audit = () => {},
}) {
  const sync = () => synchronize({
    checkouts,
    repository: task.request.repository,
    branch: 'main',
    baselineSha: task.request.baselineSha,
  });

  if (checkouts) {
    try {
      const evidence = await sync();
      audit({ event: 'runtime_baseline_checked', taskId: task.taskId, checkouts: evidence });
    } catch (error) {
      const code = safeRecoveryCode(error, 'runtime_baseline_recovery_failed');
      audit({ event: 'runtime_baseline_recovery_failed', taskId: task.taskId, code });
      return terminalRecoveryFailure(task.taskId, code, error?.checkoutId);
    }
  }

  const firstOutcome = await executeTask(task);
  if (!containsRuntimeBaselineMismatch(firstOutcome)) return firstOutcome;

  audit({ event: 'runtime_baseline_mismatch_detected', taskId: task.taskId });
  if (!checkouts) {
    return terminalRecoveryFailure(task.taskId, 'runtime_checkout_config_missing');
  }
  try {
    const evidence = await sync();
    audit({ event: 'runtime_baseline_recovered', taskId: task.taskId, checkouts: evidence });
  } catch (error) {
    const code = safeRecoveryCode(error, 'runtime_baseline_recovery_failed');
    audit({ event: 'runtime_baseline_recovery_failed', taskId: task.taskId, code });
    return terminalRecoveryFailure(task.taskId, code, error?.checkoutId);
  }

  try {
    const retryOutcome = await executeTask(task);
    if (!containsRuntimeBaselineMismatch(retryOutcome)) {
      return withRecordIdentity(retryOutcome, task.taskId);
    }
  } catch {
    audit({ event: 'runtime_baseline_retry_failed', taskId: task.taskId, code: 'executor_failed' });
    return terminalRetryFailure(task.taskId);
  }

  audit({ event: 'runtime_baseline_retry_failed', taskId: task.taskId, code: RUNTIME_BASELINE_MISMATCH });
  return terminalRetryFailure(task.taskId);
}
