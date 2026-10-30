/**
 * Source-only cooperative ordering for the EXISTING Beget Engine/Dispatcher.
 * This file has no I/O, timers, writer, daemon, GitHub client or live admission.
 * Its output is an ADVISORY CANDIDATE, never an execution grant, heartbeat,
 * authorization, server status or license to amend the two-witness catalog.
 *
 * A future protected integration must independently revalidate the actual
 * root-owned signed catalog, current admission, same Engine lock, budget,
 * review, fencing, exact repo/branch/path and durable state immediately before
 * every selected action. It must not call this helper to bypass those gates.
 */

const REPO = 'ASI-integration/asi-landing';
const KNOWN_IDS = Object.freeze(['engine', 'ru-auth', 'p0-integration', 'p0-trust', 'p0-atomic-budget']);
const SHA = /^[a-f0-9]{40}$/;
const IDENT = /^[a-z0-9][a-z0-9-]{0,79}$/;
const BRANCH = /^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,150}$/;
const MAX_WAIT_MS = 60 * 60 * 1000;
const BASE_WAIT_MS = 60 * 1000;
const MAX_RETRIES = 7;

const response = (kind, reason, lanes = [], candidate = null) => Object.freeze({
  schema: 'asi.beget-five-lane-advisory.v1', kind, reason, candidate,
  lanes: Object.freeze(lanes.map(x => Object.freeze(x))),
  authority: 'NONE_SOURCE_ONLY',
});
const safeMs = n => Number.isSafeInteger(n) && n >= 0;

/** For tests and later protected native integration; not an execution budget. */
export function minimumBackoffMs(retries) {
  if (!Number.isSafeInteger(retries) || retries < 1 || retries > MAX_RETRIES) return null;
  return Math.min(MAX_WAIT_MS, BASE_WAIT_MS * (2 ** (retries - 1)));
}

/**
 * @param {object} snapshot - an already-observed source *snapshot*, NOT an
 *   authority token. `laneDefinitions` must come from static OWNER_LANES;
 *   `admittedCatalog` must come from the existing native authority verifier;
 *   `journal` must be a durable, same-lock, root-bound state read.
 * @returns {object} advisory read-only plan. No mutation or refresh happens.
 */
export function planCooperativeOwnerLane(snapshot) {
  const {laneDefinitions, admittedCatalog, journal, nowMs} = snapshot ?? {};
  if (!safeMs(nowMs)) return response('UNKNOWN', 'CLOCK_UNVERIFIED');
  if (!Array.isArray(laneDefinitions) || laneDefinitions.length !== KNOWN_IDS.length ||
      laneDefinitions.some((lane, index) => !lane || lane.id !== KNOWN_IDS[index] ||
        lane.repository !== REPO || typeof lane.branch !== 'string' || !BRANCH.test(lane.branch)) ||
      new Set(laneDefinitions.map(x => x.branch)).size !== KNOWN_IDS.length)
    return response('UNKNOWN', 'STATIC_LANE_DEFINITIONS_INVALID');
  if (!Array.isArray(admittedCatalog) || admittedCatalog.length < 1 || admittedCatalog.length > 20)
    return response('UNKNOWN', 'NATIVE_CATALOG_NOT_VERIFIED');
  if (!journal || journal.schema !== 'asi.beget-owner-lane-journal.v1' ||
      !journal.lanes || typeof journal.lanes !== 'object' || Array.isArray(journal.lanes) ||
      !['IDLE', 'FAILED_LOCKED', 'UNKNOWN'].includes(journal.engineMode))
    return response('UNKNOWN', 'DURABLE_ENGINE_JOURNAL_NOT_VERIFIED');
  if (journal.engineMode !== 'IDLE')
    return response('STOPPED', 'GLOBAL_ENGINE_LOCK_OR_EVIDENCE_UNCERTAIN');

  const matched = new Map(), usedTaskIds = new Set(), paths = new Set();
  for (const lane of laneDefinitions) {
    const hits = admittedCatalog.filter(t => t?.branch === lane.branch && t?.repo === lane.repository);
    if (hits.length > 1) return response('STOPPED', 'DUPLICATE_ADMITTED_BRANCH');
    if (!hits.length) continue;
    const task = hits[0];
    if (!IDENT.test(task.id ?? '') || !SHA.test(task.sha ?? '') ||
        task.stage !== 'S4-G2' || task.kind !== 'github-publisher' ||
        !Array.isArray(task.changes) || task.changes.length < 1 || task.changes.length > 20 ||
        usedTaskIds.has(task.id)) return response('STOPPED', 'ADMITTED_TASK_SCOPE_INVALID');
    usedTaskIds.add(task.id);
    for (const c of task.changes) {
      if (!c || typeof c.path !== 'string' || !/^([a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(c.path) ||
          c.path.includes('..') || paths.has(c.path)) return response('STOPPED', 'OVERLAPPING_OR_UNSAFE_ADMITTED_PATH');
      paths.add(c.path);
    }
    matched.set(lane.id, task);
  }

  const states = [], ready = [];
  for (const lane of laneDefinitions) {
    const task = matched.get(lane.id);
    if (!task) {
      states.push({id: lane.id, mode: 'BLOCKED', reason: 'NOT_IN_SIGNED_EXECUTION_CATALOG'});
      continue;
    }
    const state = journal.lanes[lane.id];
    if (!state || typeof state !== 'object' || Array.isArray(state) ||
        state.taskId !== task.id || state.taskSha !== task.sha ||
        !safeMs(state.lastServedAtMs) || !safeMs(state.nextEligibleAtMs) ||
        !Number.isSafeInteger(state.retries) || state.retries < 0 || state.retries > MAX_RETRIES ||
        !['READY', 'BACKOFF', 'DONE', 'BLOCKED', 'UNKNOWN', 'FAILED_LOCKED'].includes(state.mode) ||
        state.lastServedAtMs > nowMs || state.nextEligibleAtMs > Number.MAX_SAFE_INTEGER) {
      states.push({id: lane.id, mode: 'UNKNOWN', reason: 'DURABLE_LANE_IDENTITY_OR_STATE_INVALID'});
      continue;
    }
    if (state.mode === 'FAILED_LOCKED')
      return response('STOPPED', 'FAILED_LOCKED_REQUIRES_RECONCILIATION', states);
    if (state.mode === 'UNKNOWN' || state.mode === 'BLOCKED' || state.mode === 'DONE') {
      states.push({id: lane.id, mode: state.mode, reason: 'NO_AUTOMATIC_RETRY'});
      continue;
    }
    if (state.mode === 'BACKOFF') {
      const delay = minimumBackoffMs(state.retries);
      if (delay === null || state.lastServedAtMs + delay > state.nextEligibleAtMs) {
        states.push({id: lane.id, mode: 'UNKNOWN', reason: 'BACKOFF_BYPASS_OR_INVALID'});
        continue;
      }
    } else if (state.retries !== 0 || state.nextEligibleAtMs !== 0) {
      states.push({id: lane.id, mode: 'UNKNOWN', reason: 'READY_MUST_NOT_BYPASS_RETRY'});
      continue;
    }
    if (state.nextEligibleAtMs > nowMs) {
      states.push({id: lane.id, mode: 'BACKOFF', reason: 'WAIT_UNTIL_ELIGIBLE'});
      continue;
    }
    states.push({id: lane.id, mode: 'READY', reason: 'CANDIDATE_ONLY'});
    ready.push({lane, task, lastServedAtMs: state.lastServedAtMs});
  }
  // Fairness only after all admission, dependencies and safety gates. Ties are
  // stable; this is not a queue or a release/CI/review decision.
  ready.sort((a, b) => a.lastServedAtMs - b.lastServedAtMs ||
    KNOWN_IDS.indexOf(a.lane.id) - KNOWN_IDS.indexOf(b.lane.id));
  const selected = ready[0];
  if (!selected) return response('NONE', 'NO_READY_ADMITTED_LANE', states);
  return response('CANDIDATE', 'REQUIRES_REVALIDATION_UNDER_EXISTING_ENGINE_LOCK', states,
    Object.freeze({laneId: selected.lane.id, taskId: selected.task.id,
      taskSha: selected.task.sha, repository: selected.lane.repository, branch: selected.lane.branch}));
}
