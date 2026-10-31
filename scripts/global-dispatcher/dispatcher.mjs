import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicWriteJson} from '../strigunov4/ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.mjs';
import {must, hash} from './product-adapters.mjs';
import {inspectTaskIntake} from './task-intake.mjs';

const schema = 'asi.global-routing.v1';
const own = (object, key) => Object.hasOwn(object, key);
const failure = reason => ({status: 'FAILED_LOCKED', reason, selected: null,
  executable: false, nextAction: 'Reconcile the preserved routing journal and lock against evidence; do not replay or delete them automatically.'});
function validateGoalGraph(graph, product) {
  must(graph && typeof graph === 'object' && !Array.isArray(graph), 'GOAL_GRAPH_SCHEMA');
  const {id, planHash, executable, authority, ...definition} = graph;
  must(Object.keys(definition).sort().join(',') ===
    'budget,catalogHash,contractHash,expiresAt,goal,head,nodes,notBefore,product,repository,schema,total' &&
    definition.schema === 'asi.structured-goal-plan.v1' && definition.product === product &&
    /^[a-f0-9]{64}$/.test(planHash) && hash(definition) === planHash &&
    id === 'goal-' + planHash.slice(0, 48) && executable === false && authority === null &&
    Array.isArray(definition.nodes) && definition.nodes.length > 0 && definition.nodes.length <= 100 &&
    new Set(definition.nodes.map(n => n.id)).size === definition.nodes.length,
  'GOAL_GRAPH_INTEGRITY');
  return graph;
}
async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function privateDirectory(directory) {
  must(process.platform === 'linux' && path.isAbsolute(directory), 'ISOLATED_LINUX_DIRECTORY_REQUIRED');
  must(await fs.realpath(directory) === path.resolve(directory), 'SYMLINK_DIRECTORY');
  // Prototype persistence cannot be placed anywhere under a host installation.
  must(!path.resolve(directory).startsWith('/home/project_ayfaar') && !path.resolve(directory).startsWith('/etc/'), 'LIVE_PATH_FORBIDDEN');
  const stat = await fs.stat(directory);
  must(stat.isDirectory() && stat.uid === process.getuid() && !(stat.mode & 0o077), 'PRIVATE_DIRECTORY_REQUIRED');
}
async function readState(filename) {
  const stat = await fs.lstat(filename);
  must(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 1_000_000 &&
    stat.uid === process.getuid() && !(stat.mode & 0o077), 'UNSAFE_ROUTING_STATE');
  const stored = JSON.parse(await fs.readFile(filename, 'utf8'));
  must(stored.checksum === hash(stored.state), 'ROUTING_STATE_INTEGRITY');
  const state = stored.state;
  must(state?.schema === schema && Number.isSafeInteger(state.tick) && state.tick >= 0 &&
    Array.isArray(state.products), 'ROUTING_STATE_SCHEMA');
  for (const p of state.products) {
    const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value);
    must(id(p.id) && /^[a-f0-9]{64}$/.test(p.contractHash) &&
      Number.isSafeInteger(p.lastSelected) && p.lastSelected >= 0 && p.lastSelected <= state.tick &&
      Array.isArray(p.acceptedStages) && p.acceptedStages.every(s => typeof s === 'string') &&
      new Set(p.acceptedStages).size === p.acceptedStages.length &&
      Array.isArray(p.terminal) && p.terminal.every(t => id(t.id) && ['ACCEPTED', 'PUBLISHED', 'FAILED_LOCKED'].includes(t.status)) &&
      new Set(p.terminal.map(t => t.id)).size === p.terminal.length &&
      Array.isArray(p.planned) && p.planned.every(x => id(x.id) && typeof x.stage === 'string' && /^[a-f0-9]{40}$/.test(x.head)) &&
      new Set(p.planned.map(t => t.id)).size === p.planned.length, 'PRODUCT_STATE_SCHEMA');
    if (p.intake !== undefined) {
      must(Array.isArray(p.intake) && p.intake.length <= 250 &&
        p.intake.every(r => typeof r.id === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(r.id) &&
          /^[a-f0-9]{64}$/.test(r.intentKey) &&
          ['ACCEPTED','DUPLICATE','ALREADY_DONE','NO_VALUE','OUT_OF_SCOPE',
           'ILL_LOGICAL','BLOCKED_DEPENDENCY','NEEDS_OWNER_DECISION'].includes(r.status) &&
          typeof r.reason === 'string' && r.reason.length > 0 && r.reason.length <= 900 &&
          typeof r.alternative === 'string' && r.alternative.length > 0 && r.alternative.length <= 900 &&
          /^[a-f0-9]{64}$/.test(r.goalPlanHash)) &&
        new Set(p.intake.map(r => r.id)).size === p.intake.length,
        'TASK_INTAKE_JOURNAL_INVALID');
    }
    if (p.goalGraph !== undefined) {
      validateGoalGraph(p.goalGraph, p.id);
      must([...p.planned, ...p.terminal].every(t => p.goalGraph.nodes.some(n => n.id === t.id)),
        'GOAL_CHECKPOINT_BINDING');
    }
  }
  must(new Set(state.products.map(p => p.id)).size === state.products.length, 'DUPLICATE_PRODUCT_STATE');
  return state;
}
const writeState = (filename, state) => atomicWriteJson(filename, {state, checksum: hash(state)});

// Explicit one-time initialization; never overwrites existing or crashed state.
export async function initializeRoutingState(stateDir) {
  await privateDirectory(stateDir);
  must((await fs.readdir(stateDir)).length === 0, 'EMPTY_ISOLATED_DIRECTORY_REQUIRED');
  const lock = await fs.open(path.join(stateDir, 'routing.lock'), 'wx', 0o600);
  try {
    await lock.sync();
    await syncDirectory(stateDir);
    // Recheck under the lock: another initializer may have committed after our
    // first directory read and released its lock before this one was acquired.
    must((await fs.readdir(stateDir)).every(name => name === 'routing.lock'),
      'STATE_APPEARED_DURING_INITIALIZATION');
    await writeState(path.join(stateDir, 'routing.json'), {schema, tick: 0, products: []});
    await fs.unlink(path.join(stateDir, 'routing.lock'));
    await syncDirectory(stateDir);
  } finally { await lock.close(); }
}

/** Advisory routing within the existing Engine, never an execution service.
 * Each selected task is durably reserved ONCE. Polling does not consume retries.
 * A restart cannot grant permission or retry an uncertain publication. */
export function createGlobalDispatcher({stateDir, adapters} = {}) {
  must(typeof stateDir === 'string' && Array.isArray(adapters) && adapters.length > 0 && adapters.length <= 30,
    'ROUTING_CONFIGURATION');
  must(adapters.every(a => /^[a-z][a-z0-9-]{0,79}$/.test(a.id) &&
    /^[a-f0-9]{64}$/.test(a.contractHash) && a.contract?.execution === 'disabled' &&
    (a.triage === undefined || (a.goalPlanning === true && typeof a.triage === 'function')) &&
    a.contract.maxAttemptsPerTask === 1 && Number.isSafeInteger(a.contract.maxPlansPerStage) &&
    a.contract.maxPlansPerStage >= 1 && a.contract.maxPlansPerStage <= 10 && typeof a.evaluate === 'function') &&
    new Set(adapters.map(a => a.id)).size === adapters.length, 'UNIQUE_DISABLED_ADAPTERS_REQUIRED');
  must(adapters.every(a => a.goalPlanning !== true || Number.isSafeInteger(a.maxConcurrentPlans) &&
    a.maxConcurrentPlans >= 1 && a.maxConcurrentPlans <= 4), 'GOAL_CONCURRENCY_LIMIT');
  // Capture admission limits; callers cannot expand them by later mutating a
  // contract object that was already registered against a persistent hash.
  const routes = adapters.map(a => ({id: a.id, contractHash: a.contractHash,
    evaluate: a.evaluate.bind(a), maxPlansPerStage: a.contract.maxPlansPerStage,
    goalPlanning: a.goalPlanning === true, maxConcurrentPlans: a.maxConcurrentPlans ?? 1,
    triage: a.triage === undefined ? null : a.triage.bind(a)}));
  return Object.freeze({async plan(snapshots) {
    let lock;
    const lockPath = path.join(stateDir, 'routing.lock');
    try {
      await privateDirectory(stateDir);
      lock = await fs.open(lockPath, 'wx', 0o600);
      await lock.sync();
      await syncDirectory(stateDir);
    } catch { await lock?.close(); return failure('ROUTING_LOCK_OR_DIRECTORY_UNSAFE'); }
    let durable = false;
    try {
      const filename = path.join(stateDir, 'routing.json');
      const state = await readState(filename);
      must(state.products.every(p => routes.some(a => a.id === p.id && a.contractHash === p.contractHash)),
        'PRODUCT_REMOVAL_OR_CONTRACT_CHANGE_REQUIRES_RECONCILIATION');
      const results = [];
      for (const adapter of routes) {
        let product = state.products.find(p => p.id === adapter.id);
        if (!product) {
          product = {id: adapter.id, contractHash: adapter.contractHash, lastSelected: 0,
            acceptedStages: [], terminal: [], planned: []};
          state.products.push(product);
        }
        let result;
        try {
          must(snapshots && own(snapshots, adapter.id), 'PRODUCT_SNAPSHOT_MISSING');
          result = structuredClone(adapter.evaluate(structuredClone(snapshots[adapter.id])));
          must(['READY', 'WAITING', 'BLOCKED', 'FAILED_LOCKED', 'ACCEPTED'].includes(result.status) &&
            typeof result.nextAction === 'string' && Array.isArray(result.candidates) &&
            Array.isArray(result.acceptedStages) && Array.isArray(result.terminal), 'ADAPTER_RESULT_INVALID');
          const validId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value);
          must(result.acceptedStages.every(s => typeof s === 'string') &&
            new Set(result.acceptedStages).size === result.acceptedStages.length &&
            result.terminal.every(t => validId(t?.id) && ['ACCEPTED', 'PUBLISHED', 'FAILED_LOCKED'].includes(t.status)) &&
            new Set(result.terminal.map(t => t.id)).size === result.terminal.length &&
            (result.status !== 'READY' || (typeof result.stage === 'string' &&
              typeof result.head === 'string' && /^[a-f0-9]{40}$/.test(result.head) &&
              result.candidates.every(c => validId(c?.id) && typeof c.operation === 'string' &&
                typeof c.tool === 'string' && Number.isSafeInteger(c.priority) &&
                Array.isArray(c.paths) && c.paths.every(p => typeof p === 'string')))), 'ADAPTER_RESULT_INVALID');
          result.terminal = result.terminal.map(({id, status}) => ({id, status}));
          if (adapter.goalPlanning || product.goalGraph !== undefined || result.goalGraph !== undefined) {
            must(adapter.goalPlanning, 'GOAL_ADAPTER_REQUIRED');
            const graph = validateGoalGraph(result.goalGraph, adapter.id);
            must(graph.repository === result.repository && graph.head === result.head,
              'GOAL_RESULT_BINDING');
            if (product.goalGraph === undefined) {
              must(product.planned.length === 0 && product.terminal.length === 0,
                'GOAL_ADOPTION_REQUIRES_RECONCILIATION');
            } else must(hash(product.goalGraph) === hash(graph), 'GOAL_CHANGE_REQUIRES_RECONCILIATION');
            must([...result.candidates, ...result.terminal].every(t => graph.nodes.some(n => n.id === t.id)),
              'GOAL_RESULT_OUTSIDE_GRAPH');
            // Same journal and lock: the full immutable plan is retained with
            // its existing planned/terminal checkpoints, never a second queue.
            product.goalGraph = structuredClone(graph);
          }
          must(product.acceptedStages.every((s, i) => result.acceptedStages[i] === s), 'ACCEPTED_STAGE_REGRESSION');
          must(!result.terminal.some(t => t.status !== 'FAILED_LOCKED' &&
            product.terminal.some(p => p.id === t.id && p.status === 'FAILED_LOCKED')),
          'HISTORICAL_FAILED_REWRITE_FORBIDDEN');
          product.acceptedStages = result.acceptedStages;
          for (const terminal of result.terminal) {
            const previous = product.terminal.find(t => t.id === terminal.id);
            if (!previous) product.terminal.push(terminal);
            else if (terminal.status === 'FAILED_LOCKED') previous.status = 'FAILED_LOCKED';
          }
          if (product.terminal.some(t => t.status === 'FAILED_LOCKED')) {
            // Keep an observed failure durable, without throwing away the
            // product's concrete read-only reconciliation recommendation.
            if (result.status !== 'FAILED_LOCKED') {
              result.nextAction = 'Reconcile the preserved failed task; automatic retry is disabled.';
            }
            result.status = 'FAILED_LOCKED';
            result.candidates = [];
          }
          const eligible = result.candidates.filter(c => !product.terminal.some(t => t.id === c.id));
          const repeated = eligible.some(c => product.planned.some(p => p.id === c.id));
          const exhausted = eligible.length > 0 && product.planned.filter(p => p.stage === result.stage).length >= adapter.maxPlansPerStage;
          const atCapacity = adapter.goalPlanning && product.planned.filter(p =>
            !product.terminal.some(t => t.id === p.id)).length >= adapter.maxConcurrentPlans;
          // The same job is never automatically reissued, even on a new SHA or
          // after a cosmetic change. Explicit evidence reconciliation is a later gate.
          result.candidates = eligible.filter(c => !product.planned.some(p => p.id === c.id));
          if (result.status === 'READY' && ((!adapter.goalPlanning && repeated) || exhausted || atCapacity || !result.candidates.length)) {
            result.status = repeated || exhausted || atCapacity ? 'BLOCKED' : 'WAITING';
            result.candidates = [];
            result.nextAction = atCapacity ? 'Await verified results for the bounded in-flight reservations; do not reissue them.' :
              'Reconcile the existing task reservation/publication or supply stage acceptance; automatic retry is disabled.';
          }
        } catch (error) {
          const reason = /^[A-Z_]{3,100}$/.test(error?.message || '') ? error.message : 'PRODUCT_SNAPSHOT_INVALID';
          result = {status: reason === 'FAILED_TASK_REQUIRES_RECONCILIATION' ? 'FAILED_LOCKED' : 'BLOCKED',
            reason, stage: null, candidates: [], nextAction:
            `Resolve ${reason} with product-bound evidence; no retry or stage advancement is authorized.`};
        }
        results.push({product: adapter.id, ...result});
      }
      const ready = results.filter(r => r.status === 'READY' && r.candidates.length);
      // Least-recently-served first bounds starvation to N eligible turns;
      // task priority applies within a product, never steals another product's turn.
      ready.sort((a, b) => state.products.find(p => p.id === a.product).lastSelected -
        state.products.find(p => p.id === b.product).lastSelected || a.product.localeCompare(b.product));
      // Evaluate useful work BEFORE consuming the existing routing slot.
      // A triage result never implies a native Engine or Publisher capability.
      let selected = null;
      for (const winner of ready) {
        if (selected) break;
        const route=routes.find(x=>x.id===winner.product);
        const product=state.products.find(x=>x.id===winner.product);
        for(const candidate of [...winner.candidates].sort((a,b)=>
          b.priority-a.priority||a.id.localeCompare(b.id))) {
          if(route.triage){
            product.intake ??= [];
            if(product.intake.some(x=>x.id===candidate.id))continue;
            let assessment;
            try{assessment=route.triage(Object.freeze({
              product:winner.product,candidate:structuredClone(candidate),
              goalGraph:structuredClone(product.goalGraph)
            }));}catch{assessment=null;}
            const verdict=inspectTaskIntake({product:winner.product,
              task:candidate,goalGraph:product.goalGraph,assessment,
              history:product.intake});
            let status=verdict.status,reason=verdict.reason;
            if(status==='ACCEPTED'&&state.products.some(other=>
              other.planned.some(plan=>
                !other.terminal.some(t=>t.id===plan.id)&&
                other.goalGraph?.nodes.find(n=>n.id===plan.id)?.paths?.some(path=>
                  candidate.paths.includes(path))))){
              status='BLOCKED_DEPENDENCY';
              reason='OVERLAPPING_IN_FLIGHT_CODE_PATH';
            }
            const intentKey=verdict.intentKey??hash({product:winner.product,id:candidate.id});
            product.intake.push({id:candidate.id,intentKey,status,reason,
              alternative:verdict.alternative,goalPlanHash:product.goalGraph.planHash});
            if(status!=='ACCEPTED'){
              winner.intakeDecision={taskId:candidate.id,status,reason,
                alternative:verdict.alternative};
              winner.status='BLOCKED';winner.candidates=[];
              winner.nextAction='Reject task '+candidate.id+': '+reason+
                '; alternative: '+verdict.alternative;
              continue;
            }
          }
        // Never forward arbitrary snapshot fields (including authority-shaped data).
        const task = {id: candidate.id, stage: winner.stage, operation: candidate.operation,
          tool: candidate.tool, paths: [...candidate.paths]};
        must(Number.isSafeInteger(state.tick + 1), 'ROUTING_COUNTER_EXHAUSTED');
        product.lastSelected = ++state.tick;
        product.planned.push({id: task.id, stage: winner.stage, head: winner.head});
        selected = {product: winner.product, contractHash: product.contractHash,
          repository: winner.repository, head: winner.head, task,
          ...(product.goalGraph ? {goalPlanHash: product.goalGraph.planHash} : {}),
          executable: false, authority: null};
          break;
        }
      }
      must(Buffer.byteLength(JSON.stringify({state, checksum: hash(state)}, null, 2) + '\n') < 900_000,
        'ROUTING_JOURNAL_FULL');
      await writeState(filename, state); durable = true;
      const status = selected ? 'READY' : results.some(r => r.status === 'FAILED_LOCKED') ? 'FAILED_LOCKED' :
        results.some(r => r.status === 'BLOCKED') ? 'BLOCKED' :
        results.every(r => r.status === 'ACCEPTED') ? 'ACCEPTED' : 'WAITING';
      return {status, selected, products: results, executable: false,
        nextAction: selected ? 'Source plan only; use the existing authority and execution chain after separate admission.' :
          'IDLE: follow the product-specific next action; no artificial task was created.'};
    } catch { return failure('ROUTING_STATE_RECONCILIATION_REQUIRED'); }
    finally {
      try {
        await lock.close();
        // Uncertain writes/crashes retain the stop marker. No stale-lock takeover.
        if (durable) { await fs.unlink(lockPath); await syncDirectory(stateDir); }
      } catch {
        // A failed lock release is an unknown outcome, even after journal commit.
        const marker = await fs.open(lockPath, 'wx', 0o600).catch(() => null);
        if (marker) { await marker.sync().catch(() => {}); await marker.close(); }
        return failure('ROUTING_LOCK_RELEASE_UNCERTAIN');
      }
    }
  }});
}
