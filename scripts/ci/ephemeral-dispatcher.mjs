/**
 * Decisions for the one.com ephemeral CI dispatcher.
 * Budget comes from the read-only P1 spend ledger. Queue comes from gh api.
 * This module never boots QEMU, never requests a runner token, and never spends.
 * The sealed Gold image is only measured. Nothing here rebuilds it.
 */
import {lstatSync, readdirSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

export const REPO = 'ASI-integration/asi-landing';
export const OWNER_ID = 207600140;
export const WORKFLOW_FILES = Object.freeze({
  'PR Validation': '.github/workflows/pr-validation.yml',
  'Agent Intake Triage': '.github/workflows/agent-intake-triage.yml',
});
export const ALLOWED_EVENTS = Object.freeze(['pull_request', 'workflow_dispatch']);
export const ADMISSION_KINDS = Object.freeze(['CONTRACT-CHANGE', 'RELEASE-EXCEPTION', 'SECURITY-BASELINE-CHANGE']);
export const REQUIRED_LABELS = Object.freeze(['self-hosted', 'linux', 'x64', 'asi-vps-onecom']);
export const COMMON_CAPTURE_LABELS = Object.freeze(['linux', 'x64', 'asi-vps-onecom']);
export const GUEST_TIMEOUT_SEC = 3300;
export const KILL_AFTER_SEC = 30;
export const MIN_FREE_KB = 7 * 1024 * 1024;
export const STALE_LOCK_MS = 70 * 60 * 1000;
export const REGISTRATION_HANG_MS = 3 * 60 * 1000;
export const GOLD_BYTES = 42949672960;

const deny = (reason) => Object.freeze({action:'block', reason, boot:false, retry:false});
const SHA = /^[a-f0-9]{40}$/;

const LEDGER_PY = `
import sqlite3, sys
from pathlib import Path
p = Path(sys.argv[1])
if p.is_symlink() or not p.is_file():
    raise SystemExit('LEDGER_UNVERIFIED')
uri = p.resolve().as_uri() + '?mode=ro'
with sqlite3.connect(uri, uri=True) as db:
    row = db.execute('SELECT cap, paused FROM policy WHERE id=1').fetchone()
    if row is None:
        raise SystemExit('LEDGER_UNVERIFIED')
    calls = db.execute('SELECT count(*) FROM calls').fetchone()[0]
print(int(row[0]), int(row[1]), int(calls))
`;

function absolutePath(value) {
  return typeof value === 'string' && value.length > 1 && !value.includes('..') &&
    (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value));
}

export function readSpendLedger(dbPath, spawn = spawnSync) {
  if (!absolutePath(dbPath)) return deny('BUDGET_UNVERIFIED');
  try {
    if (lstatSync(dbPath).isSymbolicLink()) return deny('BUDGET_UNVERIFIED');
  } catch {
    return deny('BUDGET_UNVERIFIED');
  }
  const result = spawn('python3', ['-c', LEDGER_PY, dbPath], {encoding:'utf8'});
  if (!result || result.status !== 0) return deny('BUDGET_UNVERIFIED');
  const parts = String(result.stdout || '').trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isSafeInteger(part) || part < 0))
    return deny('BUDGET_UNVERIFIED');
  const [cap, paused, calls] = parts;
  if (paused !== 0 || calls !== 0) return deny('PAID_CALLS_BLOCK');
  if (cap !== 0) return deny('CAP_BLOCK');
  return Object.freeze({action:'ready', reason:'LEDGER_ZERO', boot:false, cap, paused, calls});
}

function labelNames(labels) {
  return new Set((Array.isArray(labels) ? labels : []).map(label =>
    String(typeof label === 'string' ? label : label?.name || '').toLowerCase()));
}

export function routeLabel(runId, attempt, jobName) {
  if (!Number.isSafeInteger(runId) || runId <= 0 || !Number.isSafeInteger(attempt) || attempt <= 0)
    return null;
  if (typeof jobName !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(jobName)) return null;
  return `asi-${runId}-${attempt}-${jobName}`;
}

function hasCommonCapture(labels) {
  const names = labelNames(labels);
  return names.has('self-hosted') && COMMON_CAPTURE_LABELS.every(label => names.has(label));
}

function jobRoute(run, job) {
  const names = labelNames(job?.labels);
  if (names.has('self-hosted') || COMMON_CAPTURE_LABELS.some(label => names.has(label))) return null;
  const route = routeLabel(run.id, run.runAttempt, job?.name);
  if (!route || names.size !== 1 || !names.has(route)) return null;
  return route;
}

export function selectJob(runs, activeJobId = null, deniedIds = []) {
  if (!Array.isArray(runs)) return deny('QUEUE_UNVERIFIED');
  const denied = new Set(deniedIds);
  const waiting = [];
  for (const run of runs) {
    if (!run || run.repository !== REPO || run.fork === true) continue;
    if (!ALLOWED_EVENTS.includes(run.event)) continue;
    if (!Object.values(WORKFLOW_FILES).includes(run.workflowFile)) continue;
    if (!Number.isSafeInteger(run.workflowId) || run.workflowId !== run.expectedWorkflowId) continue;
    if (typeof run.headSha !== 'string' || run.headSha !== run.exactHead || !SHA.test(run.headSha)) continue;
    if (run.event === 'pull_request' && run.admission !== 'owner-comment') continue;
    if (run.event === 'workflow_dispatch' && run.admission !== 'default-branch') continue;
    if (!Array.isArray(run.jobs)) return deny('QUEUE_UNVERIFIED');
    for (const job of run.jobs) {
      const id = Number.isSafeInteger(job?.id) && job.id > 0 ? job.id : null;
      if (!id || job.status !== 'queued' || job.conclusion) continue;
      const route = jobRoute(run, job);
      if (!route || id === activeJobId || denied.has(id)) continue;
      waiting.push({
        runId:run.id, runAttempt:run.runAttempt, jobId:id, workflow:run.name, workflowId:run.workflowId,
        workflowFile:run.workflowFile, headSha:run.headSha, event:run.event, name:job.name,
        routeLabel:route,
      });
    }
  }
  waiting.sort((a, b) => a.runId - b.runId || a.jobId - b.jobId);
  if (waiting.length === 0) return Object.freeze({action:'idle', reason:'QUEUE_EMPTY', boot:false, retry:false});
  return Object.freeze({
    action:'boot', reason:'QUEUED', boot:true, retry:false, job:waiting[0], waiting:waiting.length,
    timeoutSec:GUEST_TIMEOUT_SEC, killAfterSec:KILL_AFTER_SEC,
  });
}

export function assessHost(host = {}, spawn = spawnSync) {
  const ledger = readSpendLedger(host.ledgerPath, spawn);
  if (ledger.action === 'block') return ledger;
  const runners = host.runners;
  if (!runners || runners.total_count !== runners.runners?.length || !Array.isArray(runners.runners))
    return deny('RUNNERS_UNVERIFIED');
  if (runners.runners.some(runner => runner?.ephemeral !== true && hasCommonCapture(runner.labels)))
    return deny('PERSISTENT_RUNNER_BLOCK');
  const gold = host.gold || {};
  if (gold.symlink === true || gold.uid !== 0 || gold.mode !== '0444' || gold.virtualBytes !== GOLD_BYTES)
    return deny('GOLD_SEAL_BLOCK');
  if (host.qemuAlive === true) return Object.freeze({action:'wait', reason:'SLOT_BUSY', boot:false, retry:false});
  if (Number.isSafeInteger(host.lockAgeMs) && host.lockAgeMs > STALE_LOCK_MS)
    return Object.freeze({action:'clear-lock', reason:'STALE_LOCK', boot:false, retry:false});
  if (!Number.isSafeInteger(host.memAvailableKb) || host.memAvailableKb < MIN_FREE_KB)
    return Object.freeze({action:'wait', reason:'WAIT_MEMORY', boot:false, retry:false});
  return Object.freeze({action:'ready', reason:'HOST_READY', boot:false, retry:false, ledger});
}

function ownerComment(comment, prNumber, headSha) {
  return comment?.user?.id === OWNER_ID && comment.user.type === 'User' &&
    comment.author_association === 'OWNER' && comment.performed_via_github_app == null &&
    ADMISSION_KINDS.some(kind => String(comment.body || '').trim() ===
      `ASI-OWNER-APPROVE:${kind}:${prNumber}:${headSha}`);
}

export function pollQueue(api) {
  if (!api || typeof api.get !== 'function') return deny('QUEUE_UNVERIFIED');
  const repo = api.get(`repos/${REPO}`);
  if (repo?.full_name !== REPO) return deny('REPO_UNVERIFIED');
  const expected = new Map();
  for (const [name, file] of Object.entries(WORKFLOW_FILES)) {
    const workflow = api.get(`repos/${REPO}/actions/workflows/${file.split('/').pop()}`);
    if (!Number.isSafeInteger(workflow?.id) || workflow.path !== file || workflow.name !== name)
      return deny('WORKFLOW_ID_UNVERIFIED');
    expected.set(workflow.id, {name, file});
  }
  const queuedRuns = api.get(`repos/${REPO}/actions/runs?status=queued&per_page=20`);
  const activeRuns = api.get(`repos/${REPO}/actions/runs?status=in_progress&per_page=20`);
  if (!Array.isArray(queuedRuns?.workflow_runs) || !Array.isArray(activeRuns?.workflow_runs))
    return deny('QUEUE_UNVERIFIED');
  const listed = {workflow_runs:[]};
  const seen = new Set();
  for (const run of [...queuedRuns.workflow_runs, ...activeRuns.workflow_runs]) {
    if (!run || !Number.isSafeInteger(run.id) || seen.has(run.id)) continue;
    seen.add(run.id);
    listed.workflow_runs.push(run);
  }
  const runners = api.get(`repos/${REPO}/actions/runners?per_page=100`);
  const main = api.get(`repos/${REPO}/commits/main`);
  if (typeof main?.sha !== 'string' || !SHA.test(main.sha)) return deny('HEAD_UNVERIFIED');
  const runs = [];
  for (const listedRun of listed.workflow_runs) {
    const known = expected.get(listedRun?.workflow_id);
    const repository = listedRun?.head_repository?.full_name;
    if (!known || repository !== REPO || !ALLOWED_EVENTS.includes(listedRun.event)) continue;
    if (!SHA.test(listedRun.head_sha || '')) continue;
    if (!Number.isSafeInteger(listedRun.run_attempt) || listedRun.run_attempt <= 0) continue;
    const jobsPayload = api.get(`repos/${REPO}/actions/runs/${listedRun.id}/jobs?per_page=100`);
    if (!Array.isArray(jobsPayload?.jobs)) return deny('QUEUE_UNVERIFIED');
    let admission = null;
    let exactHead = null;
    let prNumber = null;
    if (listedRun.event === 'pull_request') {
      prNumber = listedRun.pull_requests?.[0]?.number;
      if (!Number.isSafeInteger(prNumber) || prNumber <= 0) continue;
      const pull = api.get(`repos/${REPO}/pulls/${prNumber}`);
      if (pull?.head?.sha !== listedRun.head_sha) continue;
      let found = false;
      for (let page = 1; page <= 10; page += 1) {
        const comments = api.get(`repos/${REPO}/issues/${prNumber}/comments?per_page=100&page=${page}`);
        if (!Array.isArray(comments)) return deny('OWNER_ADMISSION_UNVERIFIED');
        if (comments.some(comment => ownerComment(comment, prNumber, listedRun.head_sha))) found = true;
        if (comments.length < 100) break;
      }
      if (!found) continue;
      admission = 'owner-comment';
      exactHead = listedRun.head_sha;
    } else if (listedRun.head_sha === main.sha) {
      admission = 'default-branch';
      exactHead = main.sha;
    } else {
      continue;
    }
    runs.push({
      id:listedRun.id, name:known.name, event:listedRun.event, repository:REPO, fork:false,
      workflowId:listedRun.workflow_id, expectedWorkflowId:listedRun.workflow_id, workflowFile:known.file,
      headSha:listedRun.head_sha, exactHead, admission, runAttempt:listedRun.run_attempt, prNumber,
      jobs:jobsPayload.jobs.map(job => ({
        id:job.id, name:job.name, status:job.status, conclusion:job.conclusion ?? null, labels:job.labels || [],
      })),
    });
  }
  return Object.freeze({action:'ready', reason:'QUEUE_READ', boot:false, retry:false, runs, runners});
}

export function authorize(binding, requestedJobId) {
  const jobId = Number(requestedJobId);
  if (!binding || binding.repository !== REPO || binding.jobId !== jobId || !SHA.test(binding.headSha || ''))
    return deny('UNAUTHORIZED_JOB');
  const route = routeLabel(binding.runId, binding.runAttempt, binding.jobName);
  const names = labelNames(binding.labels);
  if (!route || binding.routeLabel !== route || names.has('self-hosted') || COMMON_CAPTURE_LABELS.some(label => names.has(label)))
    return deny('UNAUTHORIZED_JOB');
  if (!Number.isSafeInteger(binding.workflowId) || names.size !== 1 || !names.has(route))
    return deny('UNAUTHORIZED_JOB');
  if (binding.event === 'pull_request' && binding.admission !== 'owner-comment') return deny('UNAUTHORIZED_JOB');
  return Object.freeze({action:'allow', reason:'AUTHORIZED_JOB', boot:false, retry:false, jobId});
}

export function classifyRuntime(obs = {}) {
  const stop = (reason, extra = {}) => Object.freeze({action:'stop', reason, signal:'TERM', retry:false, ...extra});
  if (obs.conclusion && obs.qemuAlive === true) return stop('JOB_FINISHED');
  if (obs.jobStatus === 'queued' && Number.isSafeInteger(obs.registeredAgoMs) && obs.registeredAgoMs > REGISTRATION_HANG_MS)
    return stop('REGISTRATION_HANG');
  if (obs.seedDetached !== true && Number.isSafeInteger(obs.qemuAgeMs) && obs.qemuAgeMs > 4 * 60 * 1000)
    return stop('SEED_HANG', {signal:obs.qmpRetried === true ? 'TERM' : 'QMP_ONCE'});
  if (obs.seedDetached === true && Number.isSafeInteger(obs.qemuAgeMs) && obs.qemuAgeMs >= GUEST_TIMEOUT_SEC * 1000)
    return stop('GUEST_JOB_HANG', {killAfterSec:KILL_AFTER_SEC});
  if (obs.conclusion === 'failure' || obs.timedOut === true)
    return Object.freeze({action:'cleanup', reason:'NO_RETRY', retry:false});
  return Object.freeze({action:'hold', reason:'RUNNING', retry:false});
}

function walkFiles(dir, out) {
  for (const entry of readdirSync(dir, {withFileTypes:true})) {
    const file = join(dir, entry.name);
    if (entry.isSymbolicLink()) { out.push(file); continue; }
    if (entry.isDirectory()) walkFiles(file, out);
    else if (entry.isFile()) out.push(file);
  }
}

export function recover(inventory = {}) {
  const gold = inventory.goldPath;
  const work = inventory.workDir;
  if (!absolutePath(gold) || !absolutePath(work) || gold === work || work === '/' || work.length < 8)
    return deny('RECOVERY_PATHS');
  const kill = [];
  for (const pid of Array.isArray(inventory.qemuPids) ? inventory.qemuPids : []) {
    if (Number.isSafeInteger(pid) && pid > 1) kill.push(pid);
  }
  const remove = [];
  const keep = [];
  for (const file of Array.isArray(inventory.files) ? inventory.files : []) {
    if (typeof file !== 'string') return deny('RECOVERY_PATHS');
    if (file === gold || inventory.symlinks?.includes(file)) { keep.push(file); continue; }
    const owned = file.startsWith(`${work}/`) && (file.endsWith('.qcow2') || file.endsWith('.iso'));
    if (owned) remove.push(file);
    else keep.push(file);
  }
  return Object.freeze({action:'recover', reason:'REBOOT', boot:false, retry:false, kill, remove, keep, rebuildGold:false});
}

export function planRecovery(goldPath, workDir) {
  if (!absolutePath(goldPath) || !absolutePath(workDir) || goldPath === workDir || workDir === '/' || workDir.length < 8)
    return deny('RECOVERY_PATHS');
  const files = [];
  const symlinks = [];
  try {
    const found = [];
    try { walkFiles(workDir, found); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    for (const file of found) {
      if (lstatSync(file).isSymbolicLink()) symlinks.push(file);
      else files.push(file);
    }
    files.push(...symlinks);
    try {
      if (!lstatSync(goldPath).isSymbolicLink()) files.push(goldPath);
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  } catch {
    return deny('RECOVERY_PATHS');
  }
  return recover({goldPath, workDir, files, symlinks, qemuPids:[]});
}

function ghGet(binary, path) {
  if (typeof path !== 'string' || path.includes('..') || /(^|[ ?&])-X\b|registration-token|\s/.test(path))
    return {ok:false, reason:'GH_METHOD_BLOCKED'};
  const result = spawnSync(binary, ['api', path], {encoding:'utf8'});
  if (!result || result.status !== 0) return {ok:false, reason:'QUEUE_UNVERIFIED'};
  try { return {ok:true, body:JSON.parse(result.stdout)}; }
  catch { return {ok:false, reason:'QUEUE_UNVERIFIED'}; }
}

function writeOut(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

const entry = process.argv[1] ? process.argv[1].replaceAll('\\', '/') : '';
if (entry.endsWith('/ephemeral-dispatcher.mjs')) {
  const mode = process.argv[2] || 'decide';
  if (mode === 'authorize') {
    const binding = JSON.parse(readFileSync(process.argv[4], 'utf8'));
    const decision = authorize(binding, process.argv[3]);
    writeOut(decision);
    process.exit(decision.action === 'allow' ? 0 : 2);
  }
  if (mode === 'recover-plan') {
    writeOut(planRecovery(process.env.ASI_GOLD_IMAGE, process.env.ASI_WORK_DIR));
    process.exit(0);
  }
  if (mode === 'decide') {
    const ledger = readSpendLedger(process.env.ASI_SPEND_LEDGER || '');
    if (ledger.action === 'block') { writeOut(ledger); process.exit(2); }
    const gh = process.env.ASI_GH || 'gh';
    const calls = [];
    const api = {
      get(path) {
        calls.push(path);
        const result = ghGet(gh, path);
        if (!result.ok) throw Object.assign(new Error(result.reason), {reason:result.reason});
        return result.body;
      },
    };
    let polled;
    try { polled = pollQueue(api); }
    catch (error) { writeOut(deny(error.reason || 'QUEUE_UNVERIFIED')); process.exit(2); }
    if (polled.action === 'block') { writeOut(polled); process.exit(2); }
    if (calls.some(path => path.includes('registration-token') || path.includes('-X'))) {
      writeOut(deny('GH_METHOD_BLOCKED'));
      process.exit(2);
    }
    const noRetry = process.env.ASI_NO_RETRY_FILE || '';
    let denied = [];
    if (noRetry) {
      if (!absolutePath(noRetry)) { writeOut(deny('RECOVERY_PATHS')); process.exit(2); }
      try {
        denied = readFileSync(noRetry, 'utf8').split(/\s+/).map(Number).filter(Number.isSafeInteger);
      } catch { denied = []; }
    }
    let mem = NaN;
    try {
      const line = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m);
      mem = line ? Number(line[1]) : NaN;
    } catch { mem = NaN; }
    const goldPath = process.env.ASI_GOLD_IMAGE || '';
    let gold = {symlink:true, uid:-1, mode:'', virtualBytes:0};
    if (absolutePath(goldPath)) {
      try {
        const st = lstatSync(goldPath);
        if (!st.isSymbolicLink()) {
          const info = spawnSync('qemu-img', ['info', '-f', 'qcow2', goldPath], {encoding:'utf8'});
          const match = String(info.stdout || '').match(/\(([0-9]+) bytes\)/);
          gold = {
            symlink:false, uid:st.uid,
            mode:(st.mode & 0o777).toString(8).padStart(4, '0'),
            virtualBytes:match ? Number(match[1]) : 0,
          };
        }
      } catch { gold = {symlink:true, uid:-1, mode:'', virtualBytes:0}; }
    }
    const host = assessHost({
      ledgerPath:process.env.ASI_SPEND_LEDGER,
      runners:polled.runners,
      gold, memAvailableKb:mem, qemuAlive:process.env.ASI_QEMU_ALIVE === 'YES',
    });
    if (host.action !== 'ready') { writeOut(host); process.exit(host.action === 'block' ? 2 : 0); }
    const selected = selectJob(polled.runs, null, denied);
    const selectedRun = polled.runs.find(run => run.id === selected.job?.runId);
    writeOut(selected.boot ? {...selected, binding:{
      repository:REPO, jobId:selected.job.jobId, runId:selected.job.runId, runAttempt:selected.job.runAttempt,
      jobName:selected.job.name, routeLabel:selected.job.routeLabel, prNumber:selectedRun?.prNumber ?? null,
      workflowId:selected.job.workflowId, workflowFile:selected.job.workflowFile, headSha:selected.job.headSha,
      event:selected.job.event, admission:selectedRun?.admission,
      labels:[selected.job.routeLabel],
    }} : selected);
    process.exit(0);
  }
  process.stderr.write('USAGE: ephemeral-dispatcher.mjs decide|authorize JOB BINDING|recover-plan\n');
  process.exit(2);
}
