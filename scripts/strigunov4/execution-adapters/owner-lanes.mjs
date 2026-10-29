// Read-only projection for five owner workstreams. Importing this module performs
// no I/O, scheduling, network calls or privilege changes. It never grants work.
import {assertLiveAdmission, loadBegetAuthority, BEGET} from './host-authority.mjs';

const REPO = 'ASI-integration/asi-landing';
const definitions = [
  ['engine', 'asi/beget-one-engine-20261028', 549],
  ['ru-auth', 'feat/ru-unified-auth-20261029', 554],
  ['p0-integration', 'asi/standing-delegation-551', 552],
  ['p0-trust', 'asi/p0-trusted-evidence-worker-20261029', null],
  ['p0-atomic-budget', 'asi/p0-atomic-budget-worker-20261029', null],
];
export const OWNER_LANES = Object.freeze(definitions.map(([id, branch, pr]) =>
  Object.freeze({id, repository: REPO, branch, pr})));

const unknown = reason => OWNER_LANES.map(lane => ({...lane, status: 'UNKNOWN', reason,
  currentTask: null, result: null, lastHeartbeat: null}));

/**
 * This is an evidence-bound, read-only admission projection, not a scheduler.
 * loadBegetAuthority() mints the opaque admission token only after signature,
 * catalog and host checks. It MUST be revalidated against disk on every read.
 * A catalog match alone NEVER proves service identity, a PID or a heartbeat.
 */
export async function projectOwnerLaneAdmission() {
  // Never accept caller-supplied catalogs or verification callbacks. Read the
  // actual signed Beget artifacts through the existing native authority loader.
  let authority;
  try {
    authority = await loadBegetAuthority();
    assertLiveAdmission(authority.admission, BEGET.root);
    await authority.revalidate();
    await authority.fencingWitness();
  } catch {
    return unknown('SIGNED_ENGINE_AUTHORITY_UNVERIFIED');
  }
  const catalog = authority.catalog;
  if(!Array.isArray(catalog) || catalog.length < 1 || catalog.length > 20 ||
     catalog.some(task => !task || typeof task.id !== 'string' || typeof task.branch !== 'string' ||
       task.repo !== REPO || task.kind !== 'github-publisher' || !Array.isArray(task.changes)) ||
     new Set(catalog.map(task => task.id)).size !== catalog.length ||
     new Set(catalog.map(task => task.branch)).size !== catalog.length)
    return unknown('SIGNED_CATALOG_INVALID');

  return OWNER_LANES.map(lane => {
    const matches = catalog.filter(task => task.branch === lane.branch);
    if(matches.length !== 1) return {...lane, status: 'BLOCKED', reason: 'NOT_IN_SIGNED_EXECUTION_CATALOG',
      currentTask: null, result: null, lastHeartbeat: null};
    // Even an admitted source task is not RUNNING/IDLE until systemd identity,
    // current InvocationID/PID and durable per-lane heartbeat are independently
    // verified by an authorized local observer. No GitHub/API claim can substitute.
    return {...lane, status: 'UNKNOWN', reason: 'NO_VERIFIED_SERVER_INSTANCE_AND_LANE_HEARTBEAT',
      currentTask: null, result: null, lastHeartbeat: null};
  });
}
