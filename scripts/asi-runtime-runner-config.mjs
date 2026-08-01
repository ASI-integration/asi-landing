import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BRIDGE_TOKEN_NAMES = [
  'ASI_RUNTIME_BRIDGE_CHAT_TOKEN',
  'ASI_RUNTIME_BRIDGE_OWNER_TOKEN',
  'ASI_RUNTIME_BRIDGE_RUNNER_TOKEN',
];

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

function runnerCredentialsReady(env) {
  const tokens = BRIDGE_TOKEN_NAMES.map((name) => String(env[name] ?? '').trim());
  return tokens.every((token) => token.length >= 32) && new Set(tokens).size === tokens.length;
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
  if (!runnerCredentialsReady(env)) {
    return { ready: false, reasonCode: 'runtime_runner_credentials_invalid' };
  }
  const rawExecutor = String(env.ASI_RUNTIME_BRIDGE_EXECUTOR_JSON ?? '').trim();
  if (!rawExecutor) return { ready: false, reasonCode: 'runtime_executor_missing' };
  const executor = parseRuntimeExecutorConfig(rawExecutor);
  if (!executor) return { ready: false, reasonCode: 'runtime_executor_invalid' };
  if (!await executableAvailable(executor[0], cwd)) {
    return { ready: false, reasonCode: 'runtime_executor_unavailable' };
  }
  return { ready: true, reasonCode: 'runtime_executor_ready' };
}
