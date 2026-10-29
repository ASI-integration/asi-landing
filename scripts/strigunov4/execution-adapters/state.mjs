import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {assertLiveAdmission,BEGET} from './host-authority.mjs';

export const LIVE_ROOT = '/home/project_ayfaar/asi-strigunov-agent';
export const must = (ok, code) => { if (!ok) throw new Error(code); };
export const digest = text => createHash('sha256').update(text).digest('hex');
export const sha = s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
export const identifier = s => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(s);
const stamp = () => new Date().toISOString();
// Proof of this process's real execute lifetime, not authority or a lock-directory guess.
// Only stateAt can mint a lease. Consumers must recheck after every awaited operation.
const standingTransactions = new WeakMap();
export function inspectStandingTransaction(transaction, {write=false,taskId,taskSha}={}) {
  const read = transaction && standingTransactions.get(transaction);
  must(typeof read === 'function', 'STANDING_TRANSACTION_INVALID');
  return read({write,taskId,taskSha});
}

export async function regular(file) {
  const st = await fs.lstat(file);
  must(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, 'UNSAFE_FILE');
  return st;
}
async function directory(dir) {
  must((await fs.realpath(dir)) === path.resolve(dir), 'SYMLINK_DIRECTORY');
  const st = await fs.stat(dir);
  must(st.isDirectory(), 'NOT_DIRECTORY');
  if (process.platform !== 'win32') must(st.uid === process.getuid() && !(st.mode & 0o022), 'DIRECTORY_NOT_PRIVATE');
}
async function syncDir(dir) {
  const handle = await fs.open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
/** Atomic visibility + fsync durability, same filesystem. Caller holds the shared lock.
 * Deliberately Linux/POSIX only: do not silently weaken durability on Windows/NFS.
 */
export async function atomicWrite(file, contents, {mode = 0o600} = {}) {
  must(process.platform === 'linux', 'LINUX_DURABILITY_REQUIRED');
  await directory(path.dirname(file));
  try { await regular(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    must(Number.isInteger(mode) && mode >= 0 && mode <= 0o777, 'INVALID_FILE_MODE');
    handle = await fs.open(temp, 'wx', mode);
    await handle.chmod(mode);
    await handle.writeFile(contents, 'utf8'); await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(temp, file); await syncDir(path.dirname(file));
  } finally {
    await handle?.close();
    await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
}
export const atomicJson = (file, value) => atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
async function json(file) {
  must((await regular(file)).size < 4_000_000, 'STATE_TOO_LARGE');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export function validateTask(t) {
  must(t && identifier(t.id) && sha(t.sha) && ['S4-G1','S4-G2'].includes(t.stage), 'TASK_IDENTITY');
  must(t.repo === 'ASI-integration/asi-landing', 'REPOSITORY_NOT_ALLOWED');
  must(t.pr === null || Number.isSafeInteger(t.pr) && t.pr > 0, 'EXPLICIT_PR_OR_NULL_REQUIRED');
  must(typeof t.branch === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,150}$/.test(t.branch), 'BRANCH_REQUIRED');
}

/** No import-time I/O, no default live root and no automatic state migration. */
export async function openState({ root, isolated = false, liveAdmission }) {
  must(isolated === true && path.isAbsolute(root), 'ISOLATED_ROOT_REQUIRED');
  root = path.resolve(root);
  if(root === LIVE_ROOT || root.startsWith(LIVE_ROOT + '/') || root===BEGET.root || root.startsWith(BEGET.root+'/')){
    must(liveAdmission,'LIVE_ROOT_FORBIDDEN');assertLiveAdmission(liveAdmission,root);
  }
  await directory(root);
  for (const name of ['state', 'reports', 'scratchpads']) {
    await fs.mkdir(path.join(root, name), { mode: 0o700 });
  }
  // Creation is intentionally separate from opening existing state. Use initializeState once.
  return stateAt(root,liveAdmission);
}
export async function initializeState(root,{liveAdmission}={}) {
  const store = await openState({ root, isolated: true,liveAdmission });
  await atomicJson(store.file('receipts.json'), { version: 1, completed: [] });
  await atomicJson(store.file('autopilot-ledger.json'), {
    schemaVersion: 'asi.execution-adapters.v1', mode: 'IDLE', jobs: {},
  });
  await atomicJson(store.file('heartbeat.json'), { mode: 'WAITING', at: stamp() });
  return store;
}
export async function existingState(root,{liveAdmission}={}) {
  root = path.resolve(root);
  if(root === LIVE_ROOT || root.startsWith(LIVE_ROOT + '/') || root===BEGET.root || root.startsWith(BEGET.root+'/')){
    must(liveAdmission,'LIVE_ROOT_FORBIDDEN');assertLiveAdmission(liveAdmission,root);
  }
  for (const dir of [root, ...['state', 'reports', 'scratchpads'].map(p => path.join(root, p))]) await directory(dir);
  return stateAt(root,liveAdmission);
}
function stateAt(root,liveAdmission) {
  const file = name => path.join(root, 'state', name);
  return { root, file, async execute(kind, task, github, action) {
    if(root === LIVE_ROOT || root.startsWith(LIVE_ROOT + '/') || root===BEGET.root || root.startsWith(BEGET.root+'/'))assertLiveAdmission(liveAdmission,root);
    const lock = file('execution.lock');
    let lockCreated = false;
    try {
      await fs.mkdir(lock, { mode: 0o700 }); lockCreated = true;
      await syncDir(path.dirname(lock));
    } catch (e) {
      if (!lockCreated && e.code === 'EEXIST')
        return { mode: 'BLOCKED', reason: 'LOCK_HELD_OR_CRASHED_REQUIRES_REVIEW' };
      // If the directory was created but fsync failed, its durability is
      // unverified. Keep the lock in place and require manual reconciliation.
      if (lockCreated)return { mode: 'FAILED_LOCKED', reason: 'LOCK_DIRECTORY_DURABILITY_UNVERIFIED' };
      throw e;
    }
    let ledger, receipts, armed = false, terminal = false;
    let transaction, phase = 'closed', selected = null;
    const transactionId = randomUUID();
    const closeTransaction = () => {
      phase = 'closed';
      if (transaction) standingTransactions.delete(transaction);
    };
    const beginTransaction = () => {
      transaction = Object.freeze({}); phase = 'admission';
      standingTransactions.set(transaction, ({write,taskId,taskSha}) => {
        must(armed && phase !== 'closed' && ledger?.mode === 'FAILED_LOCKED' &&
          ledger.reason === 'IN_FLIGHT_OR_CRASHED', 'STANDING_TRANSACTION_INACTIVE');
        must(typeof write === 'boolean', 'STANDING_TRANSACTION_OPERATION');
        if (selected) {
          must(task?.id === selected.id && task?.sha === selected.sha &&
            task?.repo === selected.repo && task?.branch === selected.branch &&
            task?.pr === selected.pr && task?.stage === selected.stage, 'STANDING_TASK_CHANGED');
          must((taskId === undefined || taskId === selected.id) &&
            (taskSha === undefined || taskSha === selected.sha), 'STANDING_TASK_MISMATCH');
        } else must(taskId === undefined && taskSha === undefined, 'STANDING_TASK_UNSELECTED');
        if (write) must(phase === 'started' && kind === 'github-publisher', 'STANDING_WRITE_PHASE');
        if (phase === 'started' || phase === 'postflight') {
          const started = Object.entries(ledger.jobs).filter(([,job]) => job?.mode === 'STARTED');
          must(started.length === 1 && started[0][0] === selected.id &&
            started[0][1].sha === selected.sha && started[0][1].pr === selected.pr &&
            started[0][1].kind === kind, 'STANDING_STARTED_TASK_MISMATCH');
        }
        return Object.freeze({transactionId,phase,kind,root,ledger,
          taskId:selected?.id ?? null,taskSha:selected?.sha ?? null});
      });
    };
    const fail = async reason => {
      // Never serialize error messages from subprocess/API: they may contain secrets.
      ledger ??= { schemaVersion: 'asi.execution-adapters.v1', jobs: {} };
      ledger.mode = 'FAILED_LOCKED'; ledger.reason = reason; ledger.at = stamp();
      if (identifier(task?.id)) ledger.jobs[task.id] = { mode: 'FAILED_LOCKED', reason, sha: task.sha, pr: task.pr };
      await atomicJson(file('autopilot-ledger.json'), ledger);
      if (receipts && identifier(task?.id) && sha(task?.sha)) {
        receipts.completed.push({ id: task.id, sha: task.sha, pr: task.pr,
          status: reason === 'STALE' ? 'STALE' : 'FAILED', kind, finished: stamp(), reason });
        await atomicJson(file('receipts.json'), receipts);
      }
      await atomicJson(file('heartbeat.json'), { mode: 'BLOCKED', reason, at: stamp() });
      terminal = true;
      return { mode: 'FAILED_LOCKED', reason };
    };
    // Compute the transaction outcome separately from lock-release durability.
    let outcome, releaseFailed = false;
    const perform = async () => {
      try {
      // Read/validate before replacing anything. Corrupt/legacy state is retained; lock remains.
      ledger = await json(file('autopilot-ledger.json'));
      must(ledger.schemaVersion === 'asi.execution-adapters.v1' && ledger.jobs &&
        typeof ledger.jobs === 'object' && !Array.isArray(ledger.jobs), 'LEDGER_SCHEMA');
      if (ledger.mode === 'FAILED_LOCKED') { terminal = true; return { mode: 'FAILED_LOCKED', reason: 'PHYSICAL_REVIEW_REQUIRED' }; }
      must(ledger.mode === 'IDLE', 'LEDGER_MODE');
      receipts = await json(file('receipts.json'));
      must(receipts.version === 1 && Array.isArray(receipts.completed) && receipts.completed.length < 10000 &&
        receipts.completed.every(r => identifier(r.id) && sha(r.sha) && (r.pr === null || Number.isSafeInteger(r.pr) && r.pr > 0) &&
          ['PASS', 'FAILED', 'STALE'].includes(r.status)), 'RECEIPTS_SCHEMA');
      // Durable brake BEFORE any external read or candidate mutation. SIGKILL cannot bypass it.
      ledger.mode = 'FAILED_LOCKED'; ledger.reason = 'IN_FLIGHT_OR_CRASHED';
      await atomicJson(file('autopilot-ledger.json'), ledger); armed = true;
      beginTransaction();
      if(typeof task==='function')task=await task({ledger,receipts,transaction});
      if(task===null){
        closeTransaction();
        ledger.mode='IDLE';delete ledger.reason;
        await atomicJson(file('heartbeat.json'),{mode:'WAITING',reason:'NO_NEXT_ISOLATED_JOB',at:stamp()});
        await atomicJson(file('autopilot-ledger.json'),ledger);terminal=true;
        return {mode:'WAITING',reason:'NO_NEXT_ISOLATED_JOB'};
      }
      validateTask(task);
      selected = Object.freeze({id:task.id,sha:task.sha,repo:task.repo,branch:task.branch,pr:task.pr,stage:task.stage});
      phase = 'preflight';
      const before = await github.verifyTask(task,{transaction});
      const old = receipts.completed.filter(r => r.id === task.id);
      if (old.length || ledger.jobs[task.id]) {
        closeTransaction();
        const entry = ledger.jobs[task.id];
        if (old.length === 1 && old[0].status === 'PASS' && old[0].sha === task.sha && old[0].pr === task.pr && old[0].kind === kind &&
          entry?.mode === 'PUBLISHED' && entry.sha === task.sha && entry.pr === task.pr && entry.kind === kind) {
          // Do not turn a historical PASS into fresh CI/review evidence.
          ledger.mode = 'IDLE'; delete ledger.reason;
          await atomicJson(file('heartbeat.json'), { mode: 'WAITING', reason: 'ALREADY_RECORDED_NOT_FRESH_EVIDENCE', at: stamp() });
          await atomicJson(file('autopilot-ledger.json'), ledger); terminal = true;
          return { mode: 'WAITING', reason: 'ALREADY_RECORDED_NOT_FRESH_EVIDENCE' };
        }
        return await fail('DUPLICATE_REQUIRES_VERIFICATION');
      }
      ledger.jobs[task.id] = { mode: 'STARTED', kind, sha: task.sha, pr: task.pr, at: stamp() };
      await atomicJson(file('autopilot-ledger.json'), ledger);
      await atomicJson(file('heartbeat.json'), { mode: 'RUNNING', task: task.id, head: task.sha, at: stamp() });
      phase = 'started';
      const result = await action({transaction});
      phase = 'postflight';
      const after = await github.verifyTask(task,{transaction});
      closeTransaction();
      if (JSON.stringify(before) !== JSON.stringify(after)) return await fail('STALE');
      must(result && result.mode === undefined && ['PASS', 'WAITING', 'FAILED'].includes(result.status), 'UNKNOWN_RESULT');
      if (result.status === 'FAILED') return await fail('ADAPTER_REJECTED');
      if (result.status === 'WAITING') {
        const reportName = `${task.id}-${randomUUID()}.txt`;
        await atomicJson(path.join(root, 'reports', reportName), { kind, task:task.id, sha:task.sha, pr:task.pr, observedAt:stamp(), result });
        delete ledger.jobs[task.id]; ledger.mode = 'IDLE'; delete ledger.reason;
        await atomicJson(file('heartbeat.json'), { mode: 'WAITING', task: task.id, at: stamp() });
        await atomicJson(file('autopilot-ledger.json'), ledger); terminal = true;
        return { mode: 'WAITING' };
      }
      const report = JSON.stringify({ task: task.id, sha: task.sha, pr: task.pr, kind, observedAt: stamp(), result }, null, 2) + '\n';
      must(Buffer.byteLength(report) < 200000, 'REPORT_TOO_LARGE');
      const reportName = `${task.id}-${randomUUID()}.txt`;
      await atomicWrite(path.join(root, 'reports', reportName), report);
      receipts.completed.push({ id: task.id, sha: task.sha, pr: task.pr, status: 'PASS',
        kind, report: reportName, reportSha256: digest(report), finished: stamp() });
      await atomicJson(file('receipts.json'), receipts);
      ledger.jobs[task.id] = { mode: 'PUBLISHED', artifactType: 'LOCAL_REPORT_ONLY', kind,
        sha: task.sha, pr: task.pr, report: reportName, reportSha256: digest(report) };
      await atomicJson(file('heartbeat.json'), { mode: 'REPORT_READY', task: task.id, report: reportName, at: stamp() });
      ledger.mode = 'IDLE'; delete ledger.reason;
      // Commit point. Partial multi-file transactions always retain the durable brake.
      await atomicJson(file('autopilot-ledger.json'), ledger); terminal = true;
      return { mode: 'REPORT_READY', ...result, report: reportName };
    } catch {
      closeTransaction();
      // Deliberately do not persist raw exception text; external messages can
      // contain secrets. The fixed reason plus retained lock requires review.
      if (armed) return await fail('UNHANDLED_OR_UNKNOWN_RESULT');
      // No destructive repair of unreadable state. Lock itself is a durable stop marker.
      return { mode: 'FAILED_LOCKED', reason: 'STATE_UNREADABLE_MANUAL_RECONCILIATION' };
      }
    };
    try { outcome = await perform(); }
    finally {
      closeTransaction();
      if (terminal) {
        try {
          await fs.rmdir(lock);
          await syncDir(path.dirname(lock));
        } catch {
          // A released-but-unsynced lock is not safely cleared: restore marker.
          await fs.mkdir(lock, { mode: 0o700 }).catch(()=>{});
          await syncDir(path.dirname(lock)).catch(()=>{});
          releaseFailed = true;
        }
      }
      // No automatic lock removal after a storage error or crash.
    }
    if (releaseFailed)return { mode: 'FAILED_LOCKED', reason: 'LOCK_RELEASE_FAILED' };
    return outcome;
  } };
}
