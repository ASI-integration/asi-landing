#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  executeWithRuntimeBaselineRecovery,
} from './asi-runtime-baseline-recovery.mjs';
import {
  inspectRuntimeRunnerHostReadiness,
  validateRuntimeBridgeUrl,
  validateRuntimeRunnerToken,
} from './asi-runtime-runner-config.mjs';

const baseUrl = validateRuntimeBridgeUrl(process.env.ASI_RUNTIME_BRIDGE_URL);
const token = validateRuntimeRunnerToken(process.env.ASI_RUNTIME_BRIDGE_RUNNER_TOKEN);
const executorGuard = fileURLToPath(new URL('./asi-runtime-bridge-executor-guard.mjs', import.meta.url));
const runnerIdentitySource = process.env.ASI_RUNTIME_BRIDGE_RUNNER_ID?.trim() || os.hostname();
const runnerId = `runner-${createHash('sha256').update(runnerIdentitySource).digest('hex').slice(0, 24)}`;
const leaseSeconds = boundedInt(process.env.ASI_RUNTIME_BRIDGE_LEASE_SECONDS, 120, 30, 900);
const pollMs = boundedInt(process.env.ASI_RUNTIME_BRIDGE_POLL_MS, 2_000, 250, 60_000);
const executionTimeoutMs = boundedInt(process.env.ASI_RUNTIME_BRIDGE_EXECUTION_TIMEOUT_MS, 30 * 60_000, 30_000, 6 * 60 * 60_000);
const maxOutputBytes = 512 * 1024;
let stopping = false;
let abortActiveClaim = null;
let wakePoll = null;
let readinessPublishing = false;

if (!baseUrl || !token) {
  process.stderr.write('Runtime bridge runner is not configured.\n');
  process.exit(1);
}

function auditBaselineEvent(event) {
  // Event payloads contain only stable record/checkpoint identities and commit SHAs.
  process.stderr.write(`[runtime-baseline] ${JSON.stringify(event)}\n`);
}

function boundedInt(raw, fallback, min, max) {
  const value = Number(raw ?? fallback);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

async function bridge(operation, input, timeoutMs = 30_000) {
  const response = await fetch(`${baseUrl}/api/internal/asi-runtime/bridge/runner`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ operation, input }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error(String(body.error || `bridge_http_${response.status}`));
  return body.data;
}

function execute(task, signal, executor) {
  return new Promise((resolve, reject) => {
    const executorEnv = Object.fromEntries(
      ['PATH', 'Path', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']
        .filter((key) => typeof process.env[key] === 'string')
        .map((key) => [key, process.env[key]]),
    );
    const encodedExecutor = Buffer.from(JSON.stringify(executor), 'utf8').toString('base64url');
    const child = spawn(process.execPath, [executorGuard, encodedExecutor], {
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...executorEnv,
        ASI_RUNTIME_BRIDGE_TASK_ID: task.taskId,
        ASI_RUNTIME_BRIDGE_LEASE_TOKEN: task.leaseToken,
      },
    });
    let terminationTimer;
    let forcedSettlementTimer;
    let outputExceeded = false;
    let executorFinished = false;
    let executorPid = null;
    let taskSent = false;
    let cleanupStarted = false;
    let settled = false;
    const executionTreeAlive = () => {
      try {
        if (process.platform === 'win32') {
          if (!executorPid) return false;
          process.kill(executorPid, 0);
        } else {
          if (!child.pid) return false;
          process.kill(-child.pid, 0);
        }
        return true;
      } catch {
        return false;
      }
    };
    const confirmExecutionTreeExit = (callback, attempts = 50) => {
      if (!executionTreeAlive()) {
        callback(true);
        return;
      }
      if (attempts <= 0) {
        callback(false);
        return;
      }
      setTimeout(() => confirmExecutionTreeExit(callback, attempts - 1), 100);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(terminationTimer);
      clearTimeout(forcedSettlementTimer);
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    const terminate = () => {
      forcedSettlementTimer ??= setTimeout(() => {
        settle(reject, new Error(
          executionTreeAlive() ? 'executor_cleanup_unconfirmed' : 'executor_termination_timeout',
        ));
      }, 10_000);
      forcedSettlementTimer.unref();
      if (!child.pid) return;
      if (process.platform === 'win32' && child.exitCode === null) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          shell: false, windowsHide: true, stdio: 'ignore',
        });
        killer.unref();
      } else if (process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      }
      terminationTimer ??= setTimeout(() => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          if (child.exitCode === null) child.kill('SIGKILL');
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      }, 5_000);
      terminationTimer.unref();
    };
    const abort = () => terminate();
    signal.addEventListener('abort', abort, { once: true });
    const taskEnvelope = JSON.stringify({
      schemaVersion: 'asi.runtime.task.v1',
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      chatgptTaskId: task.chatgptTaskId,
      conversationId: task.conversationId,
      attemptCount: task.attemptCount,
      request: task.request,
      ownerDecision: task.ownerDecision,
    });
    child.on('message', (message) => {
      if (!message || typeof message !== 'object'
          || !Number.isInteger(message.pid) || message.pid <= 0) return;
      if (message.type === 'executor_started' && !taskSent) {
        executorPid = message.pid;
        taskSent = true;
        child.stdin.end(taskEnvelope);
      } else if (message.type === 'executor_finished' && message.pid === executorPid) {
        executorFinished = true;
        if (child.connected) {
          try { child.send({ type: 'executor_finished_ack', pid: executorPid }); } catch { /* guard exited */ }
        }
      }
    });
    let stdout = '';
    let stderrBytes = 0;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (outputExceeded) return;
      if (Buffer.byteLength(stdout, 'utf8') + Buffer.byteLength(chunk, 'utf8') > maxOutputBytes) {
        outputExceeded = true;
        stdout = '';
        child.stdout.destroy();
        terminate();
        return;
      }
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (outputExceeded) return;
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > maxOutputBytes) {
        outputExceeded = true;
        child.stderr.destroy();
        terminate();
      }
    });
    const finish = (code) => {
      if (settled) return;
      if (signal.aborted) return settle(reject, new Error('executor_aborted'));
      if (outputExceeded) return settle(reject, new Error('executor_output_limit'));
      if (code !== 0 || !executorFinished) return settle(reject, new Error('executor_failed'));
      try {
        const parsed = JSON.parse(stdout);
        if (!parsed || !['result', 'owner_gate'].includes(parsed.type)) throw new Error('executor_invalid_output');
        settle(resolve, parsed);
      } catch {
        settle(reject, new Error('executor_invalid_output'));
      }
    };
    const cleanupAfterGuardExit = (code) => {
      if (cleanupStarted || settled) return;
      cleanupStarted = true;
      const finishCleanup = () => {
        confirmExecutionTreeExit((confirmed) => {
          if (!confirmed) return settle(reject, new Error('executor_cleanup_unconfirmed'));
          if (signal.aborted) return settle(reject, new Error('executor_aborted'));
          if (outputExceeded) return settle(reject, new Error('executor_output_limit'));
          settle(reject, new Error('executor_failed'));
        });
      };
      if (process.platform === 'win32') {
        if (!executorPid) {
          finishCleanup();
          return;
        }
        const killer = spawn('taskkill.exe', ['/PID', String(executorPid), '/T', '/F'], {
          shell: false, windowsHide: true, stdio: 'ignore',
        });
        let cleanupHandled = false;
        const confirmCleanup = () => {
          if (cleanupHandled) return;
          cleanupHandled = true;
          finishCleanup();
        };
        killer.once('error', confirmCleanup);
        killer.once('close', confirmCleanup);
        return;
      }
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ESRCH') {
          settle(reject, new Error('executor_cleanup_unconfirmed'));
          return;
        }
      }
      finishCleanup();
    };
    child.on('error', (error) => settle(reject, error));
    child.on('exit', (code) => {
      if (!executorFinished) cleanupAfterGuardExit(code);
    });
    child.on('close', (code) => {
      if (executorFinished) {
        finish(code);
        return;
      }
      cleanupAfterGuardExit(code);
    });
  });
}

async function runClaim(task, hostReadiness) {
  const controller = new AbortController();
  let leaseLost = false;
  let timedOut = false;
  let heartbeatTimer;
  let leaseDeadlineTimer;
  const heartbeatTimeoutMs = Math.max(2_000, Math.min(10_000, Math.floor(leaseSeconds * 150)));
  const heartbeatDelayMs = Math.max(5_000, Math.floor(leaseSeconds * 300));
  const initialLeaseRemainingMs = Date.parse(String(task.leaseExpiresAt)) - Date.now();
  const leaseSafetyMs = Math.max(7_000, heartbeatTimeoutMs);
  if (!Number.isFinite(initialLeaseRemainingMs) || initialLeaseRemainingMs <= leaseSafetyMs + 2_000) return;
  const loseLease = () => {
    if (leaseLost) return;
    leaseLost = true;
    clearTimeout(heartbeatTimer);
    clearTimeout(leaseDeadlineTimer);
    controller.abort();
  };
  const shutdownClaim = () => loseLease();
  abortActiveClaim = shutdownClaim;
  const armLeaseDeadline = (durationMs = Math.max(5_000, leaseSeconds * 750)) => {
    clearTimeout(leaseDeadlineTimer);
    leaseDeadlineTimer = setTimeout(loseLease, durationMs);
    leaseDeadlineTimer.unref();
  };
  const scheduleHeartbeat = () => {
    heartbeatTimer = setTimeout(async () => {
      try {
        const renewed = await bridge('runner_heartbeat', {
          runnerId, taskId: task.taskId, leaseToken: task.leaseToken, leaseSeconds,
        }, heartbeatTimeoutMs);
        if (renewed !== true) return loseLease();
        armLeaseDeadline();
        scheduleHeartbeat();
      } catch {
        loseLease();
      }
    }, heartbeatDelayMs);
    heartbeatTimer.unref();
  };
  armLeaseDeadline(initialLeaseRemainingMs - leaseSafetyMs);
  scheduleHeartbeat();
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, executionTimeoutMs);
  deadline.unref();
  try {
    const outcome = await executeWithRuntimeBaselineRecovery({
      task,
      checkouts: hostReadiness.runtimeCheckouts,
      executeTask: (currentTask) => execute(
        currentTask,
        controller.signal,
        hostReadiness.executorConfig,
      ),
      audit: auditBaselineEvent,
    });
    if (leaseLost) return;
    if (outcome.type === 'result') {
      await bridge('runner_submit_result', {
        runnerId, taskId: task.taskId, leaseToken: task.leaseToken, result: outcome.result,
      });
    } else {
      await bridge('runner_submit_owner_gate', {
        runnerId, taskId: task.taskId, leaseToken: task.leaseToken, gate: outcome.gate,
      });
    }
  } catch (error) {
    if (leaseLost) return;
    const rawCode = error instanceof Error && /^[A-Za-z0-9._:-]{1,120}$/.test(error.message)
      ? error.message : 'executor_failed';
    const code = rawCode === 'executor_cleanup_unconfirmed'
      ? rawCode : (timedOut ? 'executor_timeout' : rawCode);
    await bridge('runner_fail_task', {
      runnerId,
      taskId: task.taskId,
      leaseToken: task.leaseToken,
      retryable: code !== 'executor_cleanup_unconfirmed',
      errorCode: code,
    }).catch(() => {});
  } finally {
    if (abortActiveClaim === shutdownClaim) abortActiveClaim = null;
    clearTimeout(heartbeatTimer);
    clearTimeout(leaseDeadlineTimer);
    clearTimeout(deadline);
  }
}

function stopRunner() {
  stopping = true;
  abortActiveClaim?.();
  wakePoll?.();
}
process.on('SIGINT', stopRunner);
process.on('SIGTERM', stopRunner);

async function publishRunnerReadiness() {
  if (readinessPublishing) return null;
  readinessPublishing = true;
  try {
    const hostReadiness = await inspectRuntimeRunnerHostReadiness();
    const checkedAt = new Date();
    await bridge('runner_publish_readiness', {
      schemaVersion: 'asi.runtime.runner-readiness.v1',
      runnerId,
      checkedAt: checkedAt.toISOString(),
      expiresAt: new Date(checkedAt.getTime() + 45_000).toISOString(),
      baselineSha: hostReadiness.baselineSha,
      capabilities: hostReadiness.capabilities,
    }, 10_000);
    return hostReadiness;
  } finally {
    readinessPublishing = false;
  }
}

const readinessTimer = setInterval(() => {
  void publishRunnerReadiness().catch(() => {
    // The owner endpoint fails closed when this record becomes stale.
  });
}, 15_000);
readinessTimer.unref();

while (!stopping) {
  try {
    const hostReadiness = await publishRunnerReadiness();
    if (!hostReadiness?.canExecute) throw new Error('runner_not_ready');
    const claimTimeoutMs = Math.max(2_000, Math.min(10_000, Math.floor(leaseSeconds * 150)));
    const task = await bridge('runner_claim_task', { runnerId, leaseSeconds }, claimTimeoutMs);
    if (task && !stopping) await runClaim(task, hostReadiness);
  } catch {
    // Deliberately omit response bodies and credentials from logs.
    process.stderr.write('Runtime bridge runner poll failed.\n');
  }
  if (!stopping) {
    await new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        if (wakePoll === finish) wakePoll = null;
        resolve();
      };
      const timer = setTimeout(finish, pollMs);
      wakePoll = finish;
    });
  }
}

clearInterval(readinessTimer);
