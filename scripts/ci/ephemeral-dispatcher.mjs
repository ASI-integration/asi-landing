/**
 * Decisions for the one.com ephemeral CI dispatcher.
 * This module never boots QEMU, never contacts GitHub, and never spends.
 * The sealed Gold image is an input path. Nothing here rebuilds it.
 */
export const OWNER_WORKFLOWS = Object.freeze(['PR Validation', 'Agent Intake Triage']);
export const ALLOWED_EVENTS = Object.freeze(['pull_request', 'workflow_dispatch']);
export const GUEST_TIMEOUT_SEC = 3300;
export const KILL_AFTER_SEC = 30;
export const MIN_FREE_KB = 7 * 1024 * 1024;
export const STALE_LOCK_MS = 70 * 60 * 1000;
export const REGISTRATION_HANG_MS = 3 * 60 * 1000;
export const GOLD_BYTES = 42949672960;

const deny = (reason) => Object.freeze({action:'block', reason, boot:false});

function jobId(job) {
  return Number.isSafeInteger(job?.id) && job.id > 0 ? job.id : null;
}

export function selectJob(runs, activeJobId = null) {
  if (!Array.isArray(runs)) return deny('QUEUE_UNVERIFIED');
  const waiting = [];
  for (const run of runs) {
    if (!run || run.fork === true || !ALLOWED_EVENTS.includes(run.event)) continue;
    if (!OWNER_WORKFLOWS.includes(run.name)) continue;
    if (!Array.isArray(run.jobs)) return deny('QUEUE_UNVERIFIED');
    for (const job of run.jobs) {
      const id = jobId(job);
      if (!id || job.status !== 'queued' || job.conclusion) continue;
      if (id === activeJobId) continue;
      waiting.push({runId:run.id, jobId:id, workflow:run.name, name:job.name});
    }
  }
  waiting.sort((a, b) => a.runId - b.runId || a.jobId - b.jobId);
  if (waiting.length === 0) return Object.freeze({action:'idle', reason:'QUEUE_EMPTY', boot:false});
  return Object.freeze({action:'boot', reason:'QUEUED', boot:true, job:waiting[0], waiting:waiting.length});
}

export function assessHost(host = {}) {
  if (host.paidCalls !== 'NO') return deny('PAID_CALLS_BLOCK');
  if (host.capKopecks !== 0) return deny('CAP_BLOCK');
  const runners = Array.isArray(host.runners) ? host.runners : null;
  if (!runners) return deny('RUNNERS_UNVERIFIED');
  if (runners.some(runner => runner?.online === true && runner.ephemeral !== true &&
      Array.isArray(runner.labels) && runner.labels.includes('asi-vps-onecom')))
    return deny('PERSISTENT_RUNNER_BLOCK');
  const gold = host.gold || {};
  if (gold.symlink === true || gold.uid !== 0 || gold.mode !== '0444' || gold.virtualBytes !== GOLD_BYTES)
    return deny('GOLD_SEAL_BLOCK');
  if (host.qemuAlive === true) return Object.freeze({action:'wait', reason:'SLOT_BUSY', boot:false});
  if (Number.isSafeInteger(host.lockAgeMs) && host.lockAgeMs > STALE_LOCK_MS)
    return Object.freeze({action:'clear-lock', reason:'STALE_LOCK', boot:false});
  if (!Number.isSafeInteger(host.memAvailableKb) || host.memAvailableKb < MIN_FREE_KB)
    return Object.freeze({action:'wait', reason:'WAIT_MEMORY', boot:false});
  return Object.freeze({action:'ready', reason:'HOST_READY', boot:false});
}

export function planTick(host, runs) {
  const gate = assessHost(host);
  if (gate.action === 'block' || gate.action === 'wait' || gate.action === 'clear-lock') return gate;
  const selected = selectJob(runs, host.activeJobId ?? null);
  if (!selected.boot) return selected;
  if (host.slot?.activeJobId) return Object.freeze({action:'wait', reason:'SLOT_BUSY', boot:false});
  return Object.freeze({...selected, timeoutSec:GUEST_TIMEOUT_SEC, killAfterSec:KILL_AFTER_SEC});
}

export function classifyRuntime(obs = {}) {
  if (obs.conclusion && obs.qemuAlive === true)
    return Object.freeze({action:'stop', reason:'JOB_FINISHED', signal:'TERM', retry:false});
  if (obs.jobStatus === 'queued' && Number.isSafeInteger(obs.registeredAgoMs) && obs.registeredAgoMs > REGISTRATION_HANG_MS)
    return Object.freeze({action:'stop', reason:'REGISTRATION_HANG', signal:'TERM', retry:false});
  if (obs.seedDetached !== true && Number.isSafeInteger(obs.qemuAgeMs) && obs.qemuAgeMs > 4 * 60 * 1000)
    return Object.freeze({action:'stop', reason:'SEED_HANG', signal:obs.qmpRetried === true ? 'TERM' : 'QMP_ONCE', retry:false});
  if (obs.seedDetached === true && Number.isSafeInteger(obs.qemuAgeMs) && obs.qemuAgeMs >= GUEST_TIMEOUT_SEC * 1000)
    return Object.freeze({action:'stop', reason:'GUEST_JOB_HANG', signal:'TERM', killAfterSec:KILL_AFTER_SEC, retry:false});
  if (obs.conclusion === 'failure')
    return Object.freeze({action:'cleanup', reason:'NO_RETRY', retry:false});
  return Object.freeze({action:'hold', reason:'RUNNING', retry:false});
}

export function recover(inventory = {}) {
  const gold = inventory.goldPath;
  const work = inventory.workDir;
  if (typeof gold !== 'string' || typeof work !== 'string' || !gold.startsWith('/') || !work.startsWith('/') ||
      gold.includes('..') || work.includes('..') || gold === work)
    return deny('RECOVERY_PATHS');
  const kill = [];
  for (const pid of Array.isArray(inventory.qemuPids) ? inventory.qemuPids : []) {
    if (Number.isSafeInteger(pid) && pid > 1) kill.push(pid);
  }
  const remove = [];
  const keep = [];
  for (const file of Array.isArray(inventory.files) ? inventory.files : []) {
    if (typeof file !== 'string') return deny('RECOVERY_PATHS');
    if (file === gold) { keep.push(file); continue; }
    const overlay = file.startsWith(`${work}/`) && (file.endsWith('.qcow2') || file.endsWith('.iso'));
    if (overlay) remove.push(file);
    else keep.push(file);
  }
  return Object.freeze({action:'recover', reason:'REBOOT', boot:false, kill, remove, keep, rebuildGold:false});
}

export function runsFromGh(payload = {}) {
  const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : null;
  if (!runs || payload.jobsByRunId == null || typeof payload.jobsByRunId !== 'object') return null;
  return runs.map(run => {
    const jobsPayload = payload.jobsByRunId[String(run?.id)];
    const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : null;
    return {
      id: run?.id,
      name: run?.name,
      event: run?.event,
      fork: run?.head_repository?.full_name !== 'ASI-integration/asi-landing',
      jobs: jobs ? jobs.map(job => ({id:job.id, name:job.name, status:job.status, conclusion:job.conclusion ?? null})) : null,
    };
  });
}

const entry = process.argv[1] ? process.argv[1].replaceAll('\\', '/') : '';
if (entry.endsWith('/ephemeral-dispatcher.mjs')) {
  const {readFileSync} = await import('node:fs');
  const mode = process.argv[2] || 'plan';
  const raw = readFileSync(0, 'utf8');
  const input = raw.trim() ? JSON.parse(raw) : {};
  let out;
  if (mode === 'plan') out = planTick(input.host || {}, input.runs || []);
  else if (mode === 'recover') out = recover(input);
  else if (mode === 'normalize') {
    const runs = runsFromGh(input);
    if (!runs) { process.stderr.write('QUEUE_UNVERIFIED\n'); process.exit(2); }
    out = {runs};
  } else {
    process.stderr.write('USAGE: ephemeral-dispatcher.mjs plan|recover|normalize\n');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(out)}\n`);
}
