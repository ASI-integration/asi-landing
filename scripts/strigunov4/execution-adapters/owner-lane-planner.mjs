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
// Exact owner-named workstreams. These names do not grant execution rights.
const OWNER_LANES = Object.freeze([
  ['engine', 'asi/beget-one-engine-20261028'],
  ['ru-auth', 'feat/ru-unified-auth-20261029'],
  ['p0-integration', 'asi/standing-delegation-551'],
  ['p0-trust', 'asi/p0-trusted-evidence-worker-20261029'],
  ['p0-atomic-budget', 'asi/p0-atomic-budget-worker-20261029'],
]);
const KNOWN_IDS = Object.freeze(OWNER_LANES.map(([id]) => id));
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
// Durable evidence must be plain owned data: prototypes/accessors cannot supply
// catalog, scope or journal fields that were never persistently recorded.
const ownDataRecord = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return fields.every(field => {
    const property = Object.getOwnPropertyDescriptor(value, field);
    return property && Object.hasOwn(property, 'value');
  });
};
// Forbid custom array methods, inherited elements, sparse indexes and iterator
// overrides that could skip static branch validation yet suggest a candidate.
const ownDenseArray = (value, min, max) => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < min || value.length > max ||
      Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i += 1) {
    const item = Object.getOwnPropertyDescriptor(value, String(i));
    if (!item || !Object.hasOwn(item, 'value') || !item.enumerable) return false;
  }
  return true;
};
const MODES = Object.freeze(['READY', 'BACKOFF', 'DONE', 'BLOCKED', 'UNKNOWN', 'FAILED_LOCKED']);
// Missing, stale, or corrupt records are not made harmless by catalog withdrawal.
function validDurableRecord(s, nowMs) {
  if (!ownDataRecord(s, ['mode', 'taskId', 'taskSha', 'lastServedAtMs',
    'nextEligibleAtMs', 'retries']) || !MODES.includes(s.mode) ||
      !safeMs(s.lastServedAtMs) || s.lastServedAtMs > nowMs ||
      !safeMs(s.nextEligibleAtMs) || !Number.isSafeInteger(s.retries) ||
      s.retries < 0 || s.retries > MAX_RETRIES) return false;
  const pinned = typeof s.taskId === 'string' && IDENT.test(s.taskId) &&
    typeof s.taskSha === 'string' && SHA.test(s.taskSha);
  const neverAdmitted = s.taskId === null && s.taskSha === null && s.mode === 'BLOCKED' &&
    s.lastServedAtMs === 0 && s.nextEligibleAtMs === 0 && s.retries === 0;
  return pinned || neverAdmitted;
}

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
  try { return planValidatedSnapshot(snapshot); }
  catch { return response('UNKNOWN', 'UNREADABLE_OR_HOSTILE_SNAPSHOT'); }
}
function planValidatedSnapshot(snapshot) {
  if (!ownDataRecord(snapshot, ['laneDefinitions', 'admittedCatalog', 'journal', 'nowMs']))
    return response('UNKNOWN', 'SNAPSHOT_MUST_HAVE_OWN_DATA');
  const {laneDefinitions, admittedCatalog, journal, nowMs} = snapshot;
  if (!safeMs(nowMs)) return response('UNKNOWN', 'CLOCK_UNVERIFIED');
  if (!ownDenseArray(laneDefinitions, OWNER_LANES.length, OWNER_LANES.length) ||
      laneDefinitions.some((lane, index) => !ownDataRecord(lane, ['id', 'repository', 'branch']) ||
        lane.id !== OWNER_LANES[index][0] ||
        lane.repository !== REPO || lane.branch !== OWNER_LANES[index][1] || !BRANCH.test(lane.branch)) ||
      new Set(laneDefinitions.map(x => x.branch)).size !== KNOWN_IDS.length)
    return response('UNKNOWN', 'STATIC_LANE_DEFINITIONS_INVALID');
  if (!ownDenseArray(admittedCatalog, 1, 20) ||
      admittedCatalog.some(task => !ownDataRecord(task,
        ['id', 'sha', 'repo', 'branch', 'stage', 'kind', 'changes'])))
    return response('UNKNOWN', 'NATIVE_CATALOG_NOT_VERIFIED');
  if (!ownDataRecord(journal, ['schema', 'engineMode', 'lanes']) ||
      journal.schema !== 'asi.beget-owner-lane-journal.v1' ||
      !ownDataRecord(journal.lanes, []) ||
      !['IDLE', 'FAILED_LOCKED', 'UNKNOWN'].includes(journal.engineMode))
    return response('UNKNOWN', 'DURABLE_ENGINE_JOURNAL_NOT_VERIFIED');
  if (journal.engineMode !== 'IDLE')
    return response('STOPPED', 'GLOBAL_ENGINE_LOCK_OR_EVIDENCE_UNCERTAIN');

  // An execution-catalog withdrawal does not erase historical durable locks.
  // Even lanes without a currently admitted task must retain a valid journal
  // record, and unknown lane IDs never create a new workstream implicitly.
  // Object.keys hides non-enumerable and Symbol records. Durable lane maps
  // must expose their entire own-data inventory before any work is suggested.
  if (Reflect.ownKeys(journal.lanes).some(id => {
    if (typeof id !== 'string' || !KNOWN_IDS.includes(id)) return true;
    const descriptor = Object.getOwnPropertyDescriptor(journal.lanes, id);
    return !descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable;
  })) return response('STOPPED', 'UNRECOGNIZED_DURABLE_LANE');
  for (const lane of laneDefinitions) {
    if (admittedCatalog.some(t => t?.branch === lane.branch && t?.repo === lane.repository)) continue;
    // A missing own record must not be supplied by Object.prototype.
    const state = Object.hasOwn(journal.lanes, lane.id) ? journal.lanes[lane.id] : null;
    if (!validDurableRecord(state, nowMs) ||
        (state.mode === 'READY' && (state.retries !== 0 || state.nextEligibleAtMs !== 0)) ||
        (state.mode === 'BACKOFF' && (state.retries < 1 ||
          state.lastServedAtMs + minimumBackoffMs(state.retries) > state.nextEligibleAtMs)))
      return response('STOPPED', 'UNADMITTED_LANE_JOURNAL_INVALID');
    if (state.mode === 'UNKNOWN' || state.mode === 'FAILED_LOCKED')
      return response('STOPPED', 'HISTORICAL_LANE_LOCK_REQUIRES_RECONCILIATION');
  }

  // Signed G2-only witnesses remain inert, but never silently ignore a sixth
  // catalog entry once any owner-lane task is eligible for consideration.
  // A future protected catalog must be explicitly reviewed as a WHOLE.
  const ownerCatalogCount = admittedCatalog.filter(t =>
    laneDefinitions.some(lane => t?.branch === lane.branch && t?.repo === lane.repository)).length;
  if (ownerCatalogCount !== 0 && ownerCatalogCount !== admittedCatalog.length)
    return response('STOPPED', 'MIXED_OR_UNRECOGNIZED_ADMITTED_SCOPE');

  const matched = new Map(), usedTaskIds = new Set(), paths = [];
  for (const lane of laneDefinitions) {
    const hits = admittedCatalog.filter(t => t?.branch === lane.branch && t?.repo === lane.repository);
    if (hits.length > 1) return response('STOPPED', 'DUPLICATE_ADMITTED_BRANCH');
    if (!hits.length) continue;
    const task = hits[0];
    if (!IDENT.test(task.id ?? '') || !SHA.test(task.sha ?? '') ||
        task.stage !== 'S4-G2' || task.kind !== 'github-publisher' ||
        !ownDenseArray(task.changes, 1, 20) ||
        usedTaskIds.has(task.id)) return response('STOPPED', 'ADMITTED_TASK_SCOPE_INVALID');
    usedTaskIds.add(task.id);
    for (const c of task.changes) {
      if (!ownDataRecord(c, ['path']) || typeof c.path !== 'string' || !/^([a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(c.path) ||
          c.path.includes('..') || c.path.split('/').some(seg => seg === '.' || seg === '..' || seg.toLowerCase() === '.git') ||
          paths.some(p => p === c.path || p.startsWith(c.path + '/') || c.path.startsWith(p + '/')))
        return response('STOPPED', 'OVERLAPPING_OR_UNSAFE_ADMITTED_PATH');
      paths.push(c.path);
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
    // A missing own record must not be supplied by Object.prototype.
    const state = Object.hasOwn(journal.lanes, lane.id) ? journal.lanes[lane.id] : null;
    if (!validDurableRecord(state, nowMs) ||
        state.taskId !== task.id || state.taskSha !== task.sha) {
      return response('STOPPED', 'DURABLE_LANE_IDENTITY_OR_STATE_INVALID', states);
    }
    if (state.mode === 'FAILED_LOCKED')
      return response('STOPPED', 'FAILED_LOCKED_REQUIRES_RECONCILIATION', states);
    if (state.mode === 'UNKNOWN')
      return response('STOPPED', 'LANE_UNKNOWN_REQUIRES_RECONCILIATION', states);
    if (state.mode === 'BLOCKED' || state.mode === 'DONE') {
      states.push({id: lane.id, mode: state.mode, reason: 'NO_AUTOMATIC_RETRY'});
      continue;
    }
    if (state.mode === 'BACKOFF') {
      const delay = minimumBackoffMs(state.retries);
      if (delay === null || state.lastServedAtMs + delay > state.nextEligibleAtMs) {
        return response('STOPPED', 'BACKOFF_BYPASS_OR_INVALID', states);
      }
    } else if (state.retries !== 0 || state.nextEligibleAtMs !== 0) {
      return response('STOPPED', 'READY_MUST_NOT_BYPASS_RETRY', states);
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
