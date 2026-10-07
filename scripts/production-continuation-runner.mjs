#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TASKS = {
  'telegram-text': {
    productionUrl: 'https://asi-global.ru',
    deployWorkflow: '258346411',
    deployInputs: (sha) => ({
      confirm_production_deploy: 'DEPLOY_PRODUCTION',
      sha,
    }),
    acceptanceWorkflow: '329907340',
    acceptanceInputs: {
      mode: 'text_acceptance',
      safety_acknowledgement: 'authorized_for_selected_mode',
    },
  },
};

const EXIT = {
  OK: 0,
  TIMEOUT: 2,
  CONFIG: 3,
  INTERNAL: 4,
};

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

export function latestCheckRollupGreen(checks) {
  const latest = new Map();
  for (const check of Array.isArray(checks) ? checks : []) {
    const key = String(check?.name ?? '').trim();
    if (!key) continue;
    const current = latest.get(key);
    const startedAt = Date.parse(check?.startedAt ?? 0) || 0;
    const currentStartedAt = Date.parse(current?.startedAt ?? 0) || 0;
    if (!current || startedAt >= currentStartedAt) latest.set(key, check);
  }
  if (latest.size === 0) return false;
  return [...latest.values()].every((check) =>
    check?.status === 'COMPLETED' &&
    ['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(String(check?.conclusion ?? '').toUpperCase()),
  );
}

export function buildStatusPatch(base, patch) {
  return {
    ...base,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepSync(ms) {
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waitArray, 0, 0, ms);
}

export function isTransientGhFailure(value) {
  const text = String(value ?? '').toLowerCase();
  return [
    'tls handshake timeout',
    'i/o timeout',
    'context deadline exceeded',
    'connection reset by peer',
    'connection reset',
    'connection refused',
    'temporary failure in name resolution',
    'could not resolve host',
    'failed to connect',
    'unexpected eof',
    'stream error',
    'http 502',
    'http 503',
    'http 504',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
  ].some((needle) => text.includes(needle));
}

function safeJson(text, context) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${context}`);
  }
}

function runGh(args, { input, allowFailure = false, transientRetries = 0 } = {}) {
  const attempts = Math.max(1, Number(transientRetries) + 1);
  let lastResult = null;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync('gh', args, {
      encoding: 'utf8',
      input,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    lastResult = result;

    const stdout = String(result.stdout ?? '');
    const stderr = String(result.stderr ?? '');
    const detail = String(result.error?.message || stderr || stdout || '').trim().slice(-2000);
    const transient = isTransientGhFailure(detail);

    if (!result.error && result.status === 0) {
      return {
        status: 0,
        stdout,
        stderr,
      };
    }

    if (transient && attempt < attempts) {
      sleepSync(Math.min(8000, 500 * (2 ** (attempt - 1))));
      continue;
    }

    lastError = result.error ?? null;
    if (allowFailure && !result.error) {
      return {
        status: result.status ?? 1,
        stdout,
        stderr,
      };
    }
    break;
  }

  if (lastError) throw lastError;
  const detail = String(lastResult?.stderr || lastResult?.stdout || '').trim().slice(-2000);
  throw new Error(`gh ${args.join(' ')} failed (${lastResult?.status ?? 1}): ${detail}`);
}

function ghJson(args) {
  const result = runGh(args, { transientRetries: 4 });
  return safeJson(result.stdout, `gh ${args.join(' ')}`);
}

function normalizeRepo(repo) {
  const value = String(repo ?? '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('Expected --repo owner/name');
  }
  return value;
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function atomicWriteJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(lockPath) {
  ensureDir(path.dirname(lockPath));
  if (existsSync(lockPath)) {
    try {
      const existing = safeJson(readFileSync(lockPath, 'utf8'), 'runner lock');
      if (processAlive(Number(existing.pid))) {
        throw new Error(`Runner already active with pid=${existing.pid}`);
      }
    } catch (error) {
      if (String(error?.message ?? '').startsWith('Runner already active')) throw error;
    }
    rmSync(lockPath, { force: true });
  }
  const fd = openSync(lockPath, 'wx');
  writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
  closeSync(fd);
}

async function fetchJson(url) {
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    } catch (error) {
      if (attempt >= attempts) throw error;
      await sleep(Math.min(8000, 500 * (2 ** (attempt - 1))));
      continue;
    }

    const text = await response.text();
    if (response.ok) return safeJson(text, url);

    const retryableStatus = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
    if (!retryableStatus || attempt >= attempts) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    await sleep(Math.min(8000, 500 * (2 ** (attempt - 1))));
  }
  throw new Error(`Unable to fetch ${url}`);
}

async function readProduction(productionUrl) {
  const base = productionUrl.replace(/\/$/, '');
  const [health, version] = await Promise.all([
    fetchJson(`${base}/api/health`),
    fetchJson(`${base}/api/version`),
  ]);
  return {
    healthOk: health?.ok === true,
    sha: String(version?.sha ?? ''),
    appVersion: version?.appVersion ?? null,
    deployedAt: version?.deployedAt ?? null,
  };
}

function workflowRunList(repo, workflow) {
  return ghJson([
    'run', 'list',
    '--repo', repo,
    '--workflow', String(workflow),
    '--event', 'workflow_dispatch',
    '--limit', '20',
    '--json', 'databaseId,status,conclusion,headSha,createdAt,url',
  ]);
}

async function dispatchWorkflow({ repo, workflow, ref = 'main', inputs, targetSha, log }) {
  const beforeIds = new Set(
    workflowRunList(repo, workflow).map((run) => Number(run.databaseId)),
  );
  const dispatchedAt = Date.now();
  const args = ['workflow', 'run', String(workflow), '--repo', repo, '--ref', ref];
  for (const [key, value] of Object.entries(inputs ?? {})) {
    args.push('-f', `${key}=${value}`);
  }
  runGh(args);
  log(`workflow dispatched workflow=${workflow} targetSha=${targetSha}`);

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const runs = workflowRunList(repo, workflow);
    const candidate = runs.find((run) => {
      const created = Date.parse(run.createdAt ?? 0) || 0;
      const isNewRun = !beforeIds.has(Number(run.databaseId));
      return isNewRun && created >= dispatchedAt - 5000;
    });
    if (candidate) {
      if (targetSha && candidate.headSha !== targetSha) {
        log(
          `workflow run resolved on different SHA workflow=${workflow} expected=${targetSha} actual=${candidate.headSha}`,
        );
      }
      return candidate;
    }
    await sleep(3000);
  }
  throw new Error(`Unable to resolve dispatched workflow run for workflow=${workflow}`);
}

function pendingDeployments(repo, runId) {
  return ghJson(['api', `repos/${repo}/actions/runs/${runId}/pending_deployments`]);
}

function approvePendingDeployments(repo, runId, log) {
  const pending = pendingDeployments(repo, runId);
  if (!Array.isArray(pending) || pending.length === 0) return false;
  const environmentIds = pending
    .map((entry) => Number(entry?.environment?.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (environmentIds.length === 0) return false;
  const body = JSON.stringify({
    environment_ids: [...new Set(environmentIds)],
    state: 'approved',
    comment: 'Owner-authorized ASI production continuation runner.',
  });
  runGh(
    ['api', '--method', 'POST', `repos/${repo}/actions/runs/${runId}/pending_deployments`, '--input', '-'],
    { input: body },
  );
  log(`approved production gate run=${runId} environments=${environmentIds.join(',')}`);
  return true;
}

async function waitForRun({ repo, runId, approveProduction, pollMs, status, setStatus, log }) {
  let lastSignature = '';
  while (true) {
    const run = ghJson([
      'run', 'view', String(runId),
      '--repo', repo,
      '--json', 'status,conclusion,url,headSha,jobs',
    ]);
    const signature = `${run.status}:${run.conclusion}`;
    if (signature !== lastSignature) {
      log(`run=${runId} status=${run.status} conclusion=${run.conclusion || '-'}`);
      lastSignature = signature;
    }

    setStatus({
      ...status(),
      runId,
      runUrl: run.url,
      runStatus: run.status,
      runConclusion: run.conclusion || null,
      heartbeatAt: new Date().toISOString(),
    });

    if (run.status === 'waiting') {
      if (approveProduction) {
        try {
          approvePendingDeployments(repo, runId, log);
        } catch (error) {
          log(`production approval check failed run=${runId}: ${error.message}`);
        }
      } else {
        setStatus({
          ...status(),
          phase: 'awaiting_production_approval',
          heartbeatAt: new Date().toISOString(),
        });
      }
    }

    if (run.status === 'completed') return run;
    await sleep(pollMs);
  }
}

function currentMainSha(repo) {
  return String(ghJson(['api', `repos/${repo}/commits/main`])?.sha ?? '').trim();
}

async function waitForMainChange({ repo, oldSha, pollMs, deadline, status, setStatus, log }) {
  log(`waiting for a new main commit after blocker sha=${oldSha}`);
  while (Date.now() < deadline) {
    const sha = currentMainSha(repo);
    setStatus({
      ...status(),
      phase: 'blocked_waiting_for_new_main',
      mainSha: sha,
      blockedOnSha: oldSha,
      heartbeatAt: new Date().toISOString(),
    });
    if (sha && sha !== oldSha) {
      log(`new main detected old=${oldSha} new=${sha}`);
      return sha;
    }
    await sleep(pollMs);
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskName = String(args.task ?? 'telegram-text');
  const task = TASKS[taskName];
  if (!task) {
    console.error(`Unknown task "${taskName}". Available: ${Object.keys(TASKS).join(', ')}`);
    process.exit(EXIT.CONFIG);
  }

  const repo = normalizeRepo(args.repo ?? 'ASI-integration/asi-landing');
  const pollSeconds = Math.max(5, Number(args['poll-seconds'] ?? 15));
  const pollMs = pollSeconds * 1000;
  const maxHours = Math.max(0.25, Number(args['max-hours'] ?? 8));
  const watchMain = Boolean(args['watch-main']);
  const allowProduction = Boolean(args['allow-production']);
  const stateDir = path.resolve(
    String(args['state-dir'] ?? path.join(homedir(), '.asi', 'continuation', taskName)),
  );
  const statusPath = path.join(stateDir, 'status.json');
  const logPath = path.join(stateDir, 'runner.log');
  const lockPath = path.join(stateDir, 'runner.lock');

  if (args.status) {
    if (!existsSync(statusPath)) {
      console.log(JSON.stringify({ task: taskName, status: 'not_started', statusPath }, null, 2));
      return;
    }
    process.stdout.write(readFileSync(statusPath, 'utf8'));
    return;
  }

  ensureDir(stateDir);
  acquireLock(lockPath);

  let state = {
    schemaVersion: 1,
    task: taskName,
    repo,
    runnerPid: process.pid,
    host: hostname(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    status: 'running',
    phase: 'starting',
    watchMain,
    allowProduction,
    pollSeconds,
    maxHours,
    statusPath,
    logPath,
  };

  const setStatus = (patch) => {
    state = buildStatusPatch(state, patch);
    atomicWriteJson(statusPath, state);
  };
  const status = () => state;
  const log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    appendFileSync(logPath, line + '\n', 'utf8');
    console.log(line);
  };
  const cleanup = (finalStatus, extra = {}) => {
    try {
      setStatus({ status: finalStatus, ...extra, heartbeatAt: new Date().toISOString() });
    } finally {
      rmSync(lockPath, { force: true });
    }
  };

  const stop = (signal) => {
    log(`received ${signal}; stopping`);
    cleanup('stopped', { phase: 'stopped', signal });
    process.exit(130);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  const deadline = Date.now() + maxHours * 60 * 60 * 1000;
  setStatus(state);
  log(`runner started task=${taskName} repo=${repo} pid=${process.pid}`);

  try {
    let targetSha = currentMainSha(repo);
    if (!targetSha) throw new Error('Unable to resolve origin main SHA');

    while (Date.now() < deadline) {
      setStatus({
        status: 'running',
        phase: 'production_probe',
        mainSha: targetSha,
        targetSha,
        blocker: null,
        heartbeatAt: new Date().toISOString(),
      });

      let production;
      try {
        production = await readProduction(task.productionUrl);
      } catch (error) {
        log(`production probe failed: ${error.message}`);
        production = { healthOk: false, sha: '', appVersion: null, deployedAt: null };
      }
      setStatus({
        productionSha: production.sha || null,
        productionHealthy: production.healthOk,
        productionAppVersion: production.appVersion,
        productionDeployedAt: production.deployedAt,
      });

      if (!production.healthOk || production.sha !== targetSha) {
        if (!allowProduction) {
          log('production change required, but --allow-production was not supplied');
          setStatus({
            status: 'waiting',
            phase: 'awaiting_production_permission',
            blocker: 'production_change_requires_allow_production',
          });
          await sleep(pollMs);
          targetSha = currentMainSha(repo);
          continue;
        }

        setStatus({ phase: 'deploy_dispatch', blocker: null });
        const deployRun = await dispatchWorkflow({
          repo,
          workflow: task.deployWorkflow,
          ref: 'main',
          inputs: task.deployInputs(targetSha),
          targetSha,
          log,
        });
        setStatus({
          phase: 'deploy_wait',
          deployRunId: deployRun.databaseId,
          deployRunUrl: deployRun.url,
        });
        const deployResult = await waitForRun({
          repo,
          runId: deployRun.databaseId,
          approveProduction: true,
          pollMs,
          status,
          setStatus,
          log,
        });
        if (String(deployResult.conclusion).toLowerCase() !== 'success') {
          const blocker = `deploy_failed:${deployResult.databaseId}`;
          log(blocker);
          setStatus({ status: 'blocked', phase: 'deploy_failed', blocker });
          if (!watchMain) {
            cleanup('blocked', { phase: 'deploy_failed', blocker });
            process.exit(EXIT.INTERNAL);
          }
          const nextSha = await waitForMainChange({
            repo, oldSha: targetSha, pollMs, deadline, status, setStatus, log,
          });
          if (!nextSha) break;
          targetSha = nextSha;
          continue;
        }

        production = await readProduction(task.productionUrl);
        setStatus({
          phase: 'post_deploy_verify',
          productionSha: production.sha || null,
          productionHealthy: production.healthOk,
          productionAppVersion: production.appVersion,
          productionDeployedAt: production.deployedAt,
        });
        if (!production.healthOk || production.sha !== targetSha) {
          const blocker = 'post_deploy_production_sha_or_health_mismatch';
          log(blocker);
          setStatus({ status: 'blocked', phase: 'post_deploy_verify_failed', blocker });
          if (!watchMain) {
            cleanup('blocked', { phase: 'post_deploy_verify_failed', blocker });
            process.exit(EXIT.INTERNAL);
          }
          const nextSha = await waitForMainChange({
            repo, oldSha: targetSha, pollMs, deadline, status, setStatus, log,
          });
          if (!nextSha) break;
          targetSha = nextSha;
          continue;
        }
      }

      if (!allowProduction) {
        setStatus({
          status: 'waiting',
          phase: 'awaiting_acceptance_permission',
          blocker: 'production_acceptance_requires_allow_production',
        });
        await sleep(pollMs);
        targetSha = currentMainSha(repo);
        continue;
      }

      setStatus({ phase: 'acceptance_dispatch', blocker: null });
      const acceptanceRun = await dispatchWorkflow({
        repo,
        workflow: task.acceptanceWorkflow,
        ref: 'main',
        inputs: task.acceptanceInputs,
        targetSha,
        log,
      });
      setStatus({
        phase: 'acceptance_wait',
        acceptanceRunId: acceptanceRun.databaseId,
        acceptanceRunUrl: acceptanceRun.url,
      });
      const acceptanceResult = await waitForRun({
        repo,
        runId: acceptanceRun.databaseId,
        approveProduction: true,
        pollMs,
        status,
        setStatus,
        log,
      });

      if (String(acceptanceResult.conclusion).toLowerCase() !== 'success') {
        const blocker = `acceptance_failed:${acceptanceResult.databaseId}`;
        log(blocker);
        setStatus({
          status: 'blocked',
          phase: 'acceptance_failed',
          blocker,
          acceptanceRunId: acceptanceResult.databaseId,
          acceptanceRunUrl: acceptanceResult.url,
        });
        if (!watchMain) {
          cleanup('blocked', { phase: 'acceptance_failed', blocker });
          process.exit(EXIT.INTERNAL);
        }
        const nextSha = await waitForMainChange({
          repo, oldSha: targetSha, pollMs, deadline, status, setStatus, log,
        });
        if (!nextSha) break;
        targetSha = nextSha;
        continue;
      }

      const latestMain = currentMainSha(repo);
      const finalProduction = await readProduction(task.productionUrl);
      if (latestMain !== targetSha) {
        log(`main advanced during validation target=${targetSha} latest=${latestMain}; continuing`);
        targetSha = latestMain;
        continue;
      }
      if (!finalProduction.healthOk || finalProduction.sha !== targetSha) {
        log('final production verification changed; continuing');
        continue;
      }

      log(`DONE task=${taskName} sha=${targetSha} acceptanceRun=${acceptanceResult.databaseId}`);
      cleanup('done', {
        phase: 'done',
        blocker: null,
        mainSha: targetSha,
        productionSha: finalProduction.sha,
        productionHealthy: finalProduction.healthOk,
        acceptanceRunId: acceptanceResult.databaseId,
        acceptanceRunUrl: acceptanceResult.url,
        completedAt: new Date().toISOString(),
      });
      process.exit(EXIT.OK);
    }

    log('runner deadline reached');
    cleanup('timeout', { phase: 'timeout', completedAt: new Date().toISOString() });
    process.exit(EXIT.TIMEOUT);
  } catch (error) {
    log(`runner fatal error: ${error instanceof Error ? error.message : String(error)}`);
    cleanup('error', {
      phase: 'error',
      blocker: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });
    process.exit(EXIT.INTERNAL);
  }
}

const invokedDirectly = Boolean(
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)),
);
if (invokedDirectly) {
  main();
}
