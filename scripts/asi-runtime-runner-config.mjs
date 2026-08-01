import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  inspectRuntimeCheckoutReadiness,
  parseRuntimeCheckoutConfig,
} from './asi-runtime-baseline-recovery.mjs';

const execFileAsync = promisify(execFile);
const INTERPRETERS = new Set([
  'node', 'node.exe',
  'python', 'python.exe', 'python3', 'python3.exe',
  'bash', 'bash.exe', 'sh', 'sh.exe',
  'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe',
]);
const OPTIONS_WITH_VALUES = new Set([
  '-r', '--require', '--loader', '--import', '--conditions',
  '--inspect-port', '--title', '--openssl-config',
]);
const CHECKOUT_REASON_CODES = new Set([
  'runtime_checkout_missing',
  'runtime_checkout_not_git',
  'runtime_checkout_dirty',
  'runtime_checkout_remote_missing',
  'runtime_checkout_remote_mismatch',
  'runtime_checkout_recoverable_drift',
  'runtime_checkouts_ready',
  'runtime_baseline_remote_unavailable',
  'runtime_baseline_remote_mismatch',
]);

export function validateRuntimeBridgeUrl(raw) {
  try {
    const url = new URL(raw ?? '');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function parseRuntimeExecutorConfig(raw) {
  try {
    const value = JSON.parse(raw ?? '');
    return Array.isArray(value) && value.length > 0 && value.length <= 20
      && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 1000)
      ? value : null;
  } catch {
    return null;
  }
}

export function validateRuntimeRunnerToken(raw) {
  const token = String(raw ?? '');
  return token.length >= 32 && token === token.trim() ? token : null;
}

async function executableAvailable(command, cwd) {
  const candidate = path.isAbsolute(command) || command.includes('/') || command.includes('\\')
    ? path.resolve(cwd, command)
    : null;
  if (candidate) {
    try {
      return (await stat(candidate)).isFile();
    } catch {
      return false;
    }
  }

  try {
    await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'which', [command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

function interpreterEntrypoint(executor) {
  const interpreter = path.basename(executor[0]).toLowerCase();
  if (!INTERPRETERS.has(interpreter)) return undefined;
  if (interpreter === 'pwsh' || interpreter === 'pwsh.exe'
    || interpreter === 'powershell' || interpreter === 'powershell.exe') {
    const fileIndex = executor.findIndex((item) => /^-file$/i.test(item));
    return fileIndex >= 0 ? executor[fileIndex + 1] ?? null : null;
  }
  let skipNext = false;
  for (let index = 1; index < executor.length; index += 1) {
    const argument = executor[index];
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (argument === '--') return executor[index + 1] ?? null;
    if (OPTIONS_WITH_VALUES.has(argument)) {
      skipNext = true;
      continue;
    }
    if (argument.startsWith('-')) continue;
    return argument;
  }
  return null;
}

async function readableFile(file, cwd) {
  const candidate = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  try {
    const details = await stat(candidate);
    if (!details.isFile()) return false;
    await access(candidate, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Returns fixed reason codes only; configuration values never leave this module. */
export async function inspectRuntimeRunnerPrerequisites(
  env = /** @type {Record<string, string | undefined>} */ (process.env),
  cwd = process.cwd(),
) {
  const rawUrl = String(env.ASI_RUNTIME_BRIDGE_URL ?? '').trim();
  if (!rawUrl) return { ready: false, reasonCode: 'runtime_runner_url_missing' };
  if (!validateRuntimeBridgeUrl(rawUrl)) {
    return { ready: false, reasonCode: 'runtime_runner_url_invalid' };
  }
  if (!validateRuntimeRunnerToken(env.ASI_RUNTIME_BRIDGE_RUNNER_TOKEN)) {
    return { ready: false, reasonCode: 'runtime_runner_credentials_invalid' };
  }
  const rawExecutor = String(env.ASI_RUNTIME_BRIDGE_EXECUTOR_JSON ?? '').trim();
  if (!rawExecutor) return { ready: false, reasonCode: 'runtime_executor_missing' };
  const executor = parseRuntimeExecutorConfig(rawExecutor);
  if (!executor) return { ready: false, reasonCode: 'runtime_executor_invalid' };
  if (!await executableAvailable(executor[0], cwd)) {
    return { ready: false, reasonCode: 'runtime_executor_unavailable' };
  }
  const entrypoint = interpreterEntrypoint(executor);
  if (entrypoint === null) {
    return { ready: false, reasonCode: 'runtime_executor_entrypoint_missing' };
  }
  if (entrypoint !== undefined && !await readableFile(entrypoint, cwd)) {
    return { ready: false, reasonCode: 'runtime_executor_entrypoint_unavailable' };
  }
  return { ready: true, reasonCode: 'runtime_executor_ready' };
}

function safeCheckoutReason(error) {
  const code = error && typeof error === 'object' ? String(error.code ?? '') : '';
  return CHECKOUT_REASON_CODES.has(code) ? code : 'runtime_checkout_probe_failed';
}

/** Probes the actual runner host and returns a safe record payload plus local-only checkouts. */
export async function inspectRuntimeRunnerHostReadiness(
  env = /** @type {Record<string, string | undefined>} */ (process.env),
  cwd = process.cwd(),
) {
  const executorConfig = parseRuntimeExecutorConfig(env.ASI_RUNTIME_BRIDGE_EXECUTOR_JSON);
  const executor = await inspectRuntimeRunnerPrerequisites(env, cwd).catch(() => ({
    ready: false,
    reasonCode: 'runtime_executor_probe_failed',
  }));
  let runtimeCheckouts = null;
  let baselineSha = null;
  let checkoutCapability;
  let baselineRecovery;
  const rawCheckouts = String(env.ASI_RUNTIME_BRIDGE_CHECKOUTS_JSON ?? '').trim();
  if (!rawCheckouts) {
    checkoutCapability = { state: 'blocked', reasonCode: 'runtime_checkout_config_missing' };
    baselineRecovery = { state: 'blocked', reasonCode: 'runtime_baseline_recovery_unavailable' };
  } else {
    try {
      runtimeCheckouts = parseRuntimeCheckoutConfig(rawCheckouts);
    } catch {
      checkoutCapability = { state: 'blocked', reasonCode: 'runtime_checkout_config_invalid' };
      baselineRecovery = { state: 'blocked', reasonCode: 'runtime_baseline_recovery_unavailable' };
    }
  }
  if (runtimeCheckouts) {
    try {
      const inspected = await inspectRuntimeCheckoutReadiness({
        checkouts: runtimeCheckouts,
        repository: 'ASI-integration/asi-landing',
        branch: 'main',
      });
      baselineSha = inspected.baselineSha;
      checkoutCapability = {
        state: inspected.state === 'degraded' ? 'degraded' : 'ready',
        reasonCode: inspected.reasonCode,
      };
      baselineRecovery = { state: 'ready', reasonCode: 'runtime_baseline_recovery_ready' };
    } catch (error) {
      checkoutCapability = { state: 'blocked', reasonCode: safeCheckoutReason(error) };
      baselineRecovery = { state: 'blocked', reasonCode: 'runtime_baseline_recovery_unavailable' };
    }
  }
  const capabilities = {
    checkouts: checkoutCapability,
    baselineRecovery,
    executor: {
      state: executor.ready ? 'ready' : 'blocked',
      reasonCode: executor.reasonCode,
    },
  };
  return {
    baselineSha,
    capabilities,
    runtimeCheckouts,
    executorConfig,
    canExecute: capabilities.checkouts.state !== 'blocked'
      && capabilities.baselineRecovery.state === 'ready'
      && capabilities.executor.state === 'ready'
      && executorConfig !== null,
  };
}
