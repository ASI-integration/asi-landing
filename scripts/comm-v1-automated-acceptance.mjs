import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REQUIRED_CONFIRM = 'RUN_COMM_V1_AUTOMATED_ACCEPTANCE';
const RUNNER_TS = resolve(__dirname, 'comm-v1-automated-acceptance.runner.ts');

function printFail(message, error) {
  console.error(`[comm-v1-acceptance] FAIL: ${message}`);
  if (error instanceof Error) {
    if (error.message && error.message !== message) {
      console.error(`[comm-v1-acceptance] error: ${error.message}`);
    }
    if (error.stack) console.error(error.stack);
  } else if (error !== undefined) {
    console.error(`[comm-v1-acceptance] error: ${String(error)}`);
  }
}

function runWithTsx(runnerPath) {
  return spawnSync('npx', ['--yes', 'tsx', runnerPath], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'test' },
    cwd: ROOT,
    shell: process.platform === 'win32',
  });
}

function reportRunnerResult(result) {
  if (result.error) {
    printFail('failed to start acceptance runner (tsx)', result.error);
    process.exit(1);
  }

  const code = result.status ?? 1;
  if (code === 0) {
    console.log('[comm-v1-acceptance] PASS');
    process.exit(0);
  }

  console.error(`[comm-v1-acceptance] FAIL: runner exited with code ${code}`);
  if (result.signal) {
    console.error(`[comm-v1-acceptance] signal: ${result.signal}`);
  }
  process.exit(code);
}

function main() {
  try {
    const confirm = process.env.COMM_V1_ACCEPTANCE_CONFIRM?.trim();
    if (confirm !== REQUIRED_CONFIRM) {
      console.log(
        `[comm-v1-acceptance] SKIPPED: no changes. Set COMM_V1_ACCEPTANCE_CONFIRM=${REQUIRED_CONFIRM} to run automated acceptance.`,
      );
      process.exit(0);
    }

    const result = runWithTsx(RUNNER_TS);
    reportRunnerResult(result);
  } catch (error) {
    printFail('unexpected error in acceptance launcher', error);
    process.exit(1);
  }
}

main();
