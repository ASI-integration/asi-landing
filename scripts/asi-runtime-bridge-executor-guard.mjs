#!/usr/bin/env node
import { spawn } from 'node:child_process';

const encodedSpec = process.argv[2];
const taskId = process.env.ASI_RUNTIME_BRIDGE_TASK_ID;
const leaseToken = process.env.ASI_RUNTIME_BRIDGE_LEASE_TOKEN;
let executor;
let child;
let finished = false;
let terminating = false;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

try {
  const parsed = JSON.parse(Buffer.from(encodedSpec ?? '', 'base64url').toString('utf8'));
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 20
      || !parsed.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 1000)) {
    fail('Runtime bridge executor guard received an invalid command.');
  }
  executor = parsed;
} catch {
  fail('Runtime bridge executor guard received an invalid command.');
}

if (!taskId || !leaseToken || typeof process.send !== 'function') {
  fail('Runtime bridge executor guard is not configured.');
}

function terminateTree() {
  if (finished || terminating) return;
  terminating = true;
  if (process.platform === 'win32') {
    if (!child?.pid) {
      process.exit(1);
      return;
    }
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('error', () => process.exit(1));
    killer.once('close', () => process.exit(1));
    return;
  }
  try {
    process.kill(-process.pid, 'SIGKILL');
  } catch {
    process.exit(1);
  }
}

process.once('disconnect', terminateTree);
process.once('SIGINT', terminateTree);
process.once('SIGTERM', terminateTree);
if (!process.connected) terminateTree();

child = spawn(executor[0], executor.slice(1), {
  shell: false,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
process.stdin.pipe(child.stdin);

child.once('spawn', () => {
  try {
    process.send?.({ type: 'executor_started', pid: child.pid }, (error) => {
      if (error) terminateTree();
    });
  } catch {
    terminateTree();
  }
});
child.once('error', (error) => {
  if (finished) return;
  finished = true;
  process.removeListener('disconnect', terminateTree);
  process.removeListener('SIGINT', terminateTree);
  process.removeListener('SIGTERM', terminateTree);
  process.stderr.write(`Runtime bridge executor failed to start: ${error.code ?? 'spawn_error'}\n`);
  if (process.connected) process.disconnect();
  process.exitCode = 1;
});
child.once('close', (code, signal) => {
  if (finished) return;
  finished = true;
  process.removeListener('disconnect', terminateTree);
  process.removeListener('SIGINT', terminateTree);
  process.removeListener('SIGTERM', terminateTree);
  const finish = () => {
    if (process.connected) process.disconnect();
    process.exitCode = signal ? 1 : (code ?? 1);
  };
  if (!process.connected) {
    finish();
    return;
  }
  const finishTimer = setTimeout(finish, 5_000);
  finishTimer.unref();
  process.once('message', (message) => {
    if (!message || typeof message !== 'object'
        || message.type !== 'executor_finished_ack' || message.pid !== child.pid) return;
    clearTimeout(finishTimer);
    finish();
  });
  try {
    process.send?.({ type: 'executor_finished', pid: child.pid }, (error) => {
      if (error) {
        clearTimeout(finishTimer);
        finish();
      }
    });
  } catch {
    clearTimeout(finishTimer);
    finish();
  }
});
