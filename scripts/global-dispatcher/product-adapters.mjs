// Planning contracts only. No credentials, authorizer, transport or executor ports.
import {createHash} from 'node:crypto';
import {decideQueue, WORK_ORDERS, ENGINE_PILOT, RELEASE} from '../strigunov4/ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';

export const must = (value, code) => { if (!value) throw Error(code); };
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const list = (values, check = text) => Array.isArray(values) && values.length > 0 &&
  values.length <= 100 && values.every(check) && new Set(values).size === values.length;
const safePath = value => text(value) && !value.startsWith('/') &&
  !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..');
const deniedPath = value => /(^|\/)(\.github|secrets?|deploy(?:ment)?|releases?)(\/|\.)|\.pem$|\.env|\.sql$/.test(value);

export function validateProductContract(contract) {
  must(contract?.schema === 'asi.product-route.v1' && id(contract.id) &&
    /^[\w.-]+\/[\w.-]+$/.test(contract.repository), 'PRODUCT_IDENTITY');
  must(contract.execution === 'disabled', 'PHYSICAL_EXECUTION_DISABLED');
  must(text(contract.goal?.result) && list(contract.goal?.criteria), 'FINAL_GOAL_REQUIRED');
  must(list(contract.evidence) && contract.evidence.length === 5 &&
    ['tests', 'review', 'pr', 'ci', 'report'].every(x => contract.evidence.includes(x)),
    'EVIDENCE_POLICY_REQUIRED');
  must(Array.isArray(contract.stages) && contract.stages.length > 0 && contract.stages.length <= 30,
    'ROADMAP_REQUIRED');
  const stages = new Set();
  for (const stage of contract.stages) {
    must(id(stage.id) && !stages.has(stage.id) && list(stage.criteria), 'STAGE_CONTRACT');
    must(Array.isArray(stage.dependsOn) && stage.dependsOn.every(x => stages.has(x)) &&
      (stages.size === 0 || stage.dependsOn.includes([...stages].at(-1))), 'ORDERED_STAGE_DEPENDENCIES');
    stages.add(stage.id);
  }
  must(list(contract.functions, id) && list(contract.tools, id) && list(contract.paths, safePath) &&
    !contract.paths.some(deniedPath), 'PRODUCT_FUNCTION_SCOPE');
  must(contract.maxAttemptsPerTask === 1 && Number.isSafeInteger(contract.maxPlansPerStage) &&
    contract.maxPlansPerStage >= 1 && contract.maxPlansPerStage <= 10, 'BOUNDED_PROGRESS_POLICY');
  return contract;
}

// verifyEvidence is a trusted, synchronous read-only port. Payload booleans are
// never acceptance. In this prototype only test fixtures supply this port.
export function createProductAdapter(input, {verifyEvidence} = {}) {
  const contract = structuredClone(validateProductContract(input));
  must(typeof verifyEvidence === 'function', 'INDEPENDENT_EVIDENCE_VERIFIER_REQUIRED');
  const contractHash = hash(contract);
  const proof = (evidence, snapshot, subject, criteria) => {
    must(evidence?.product === contract.id && evidence.contractHash === contractHash &&
      evidence.subject === subject && evidence.head === snapshot.head &&
      evidence.repository === contract.repository && list(evidence.criteria) &&
      criteria.every(c => evidence.criteria.includes(c)) &&
      evidence.tests === 'PASS' && evidence.review === 'PASS' && evidence.ci === 'PASS' &&
      Number.isSafeInteger(evidence.pr?.number) && evidence.pr.number > 0 &&
      evidence.pr.head === snapshot.head && text(evidence.report) &&
      verifyEvidence(structuredClone(evidence)) === true, 'EXACT_RESULT_EVIDENCE_REQUIRED');
  };
  return Object.freeze({id: contract.id, contractHash, contract: structuredClone(contract),
    evaluate(snapshot) {
      must(snapshot?.product === contract.id && snapshot.contractHash === contractHash &&
        sha(snapshot.head), 'SNAPSHOT_PRODUCT_BINDING');
      must(Array.isArray(snapshot.stages) && snapshot.stages.length === contract.stages.length &&
        Array.isArray(snapshot.tasks) && snapshot.tasks.length <= 100, 'SNAPSHOT_SCHEMA');
      let active = contract.stages.length;
      const acceptedStages = [];
      snapshot.stages.forEach((stage, i) => {
        const expected = contract.stages[i];
        must(stage.id === expected.id, 'STAGE_IDENTITY');
        if (stage.status === 'ACCEPTED') {
          must(active === contract.stages.length, 'STAGE_SKIP');
          proof(stage.evidence, snapshot, `stage:${stage.id}`, expected.criteria);
          acceptedStages.push(stage.id);
        } else {
          if (active === contract.stages.length) { active = i; must(stage.status === 'OPEN', 'ACTIVE_STAGE_REQUIRED'); }
          else must(stage.status === 'NOT_STARTED', 'STAGE_SKIP');
        }
      });
      const tasks = new Map();
      for (const task of snapshot.tasks) {
        must(id(task.id) && !tasks.has(task.id) && contract.stages.some(s => s.id === task.stage), 'TASK_IDENTITY');
        must(['READY', 'WAITING', 'BLOCKED', 'FAILED_LOCKED', 'ACCEPTED', 'PUBLISHED'].includes(task.status), 'TASK_STATUS');
        must(contract.functions.includes(task.operation) && contract.tools.includes(task.tool) &&
          list(task.paths, safePath) && task.paths.every(p => contract.paths.includes(p)), 'TASK_SCOPE');
        must(Number.isSafeInteger(task.priority) && task.priority >= 0 && task.priority <= 100 &&
          Array.isArray(task.dependsOn) && new Set(task.dependsOn).size === task.dependsOn.length, 'TASK_POLICY');
        if (['ACCEPTED', 'PUBLISHED'].includes(task.status)) proof(task.evidence, snapshot, `task:${task.id}`, [task.id]);
        if (task.status !== 'READY') must(text(task.nextAction), 'CONCRETE_NEXT_ACTION_REQUIRED');
        if (acceptedStages.includes(task.stage)) must(task.status === 'ACCEPTED', 'ACCEPTED_STAGE_REOPEN');
        tasks.set(task.id, task);
      }
      const visiting = new Set(), visited = new Set();
      const visit = task => {
        must(!visiting.has(task.id), 'DEPENDENCY_CYCLE');
        if (visited.has(task.id)) return;
        visiting.add(task.id);
        for (const name of task.dependsOn) {
          const dependency = tasks.get(name);
          must(dependency && contract.stages.findIndex(s => s.id === dependency.stage) <=
            contract.stages.findIndex(s => s.id === task.stage), 'DEPENDENCY_INVALID');
          visit(dependency);
        }
        visiting.delete(task.id); visited.add(task.id);
      };
      [...tasks.values()].forEach(visit);
      const terminal = snapshot.tasks.filter(t => ['ACCEPTED', 'PUBLISHED', 'FAILED_LOCKED'].includes(t.status))
        .map(t => ({id: t.id, status: t.status}));
      if (active === contract.stages.length) {
        proof(snapshot.goalEvidence, snapshot, 'goal', contract.goal.criteria);
        return {status: 'ACCEPTED', repository: contract.repository, head: snapshot.head,
          stage: null, candidates: [], terminal, acceptedStages,
          nextAction: 'Goal accepted; no further work is authorized.'};
      }
      const stage = contract.stages[active].id;
      const current = snapshot.tasks.filter(t => t.stage === stage);
      const candidates = current.filter(t => t.status === 'READY' &&
        t.dependsOn.every(d => tasks.get(d).status === 'ACCEPTED'));
      const locked = current.find(t => t.status === 'FAILED_LOCKED');
      const blocked = current.find(t => t.status === 'BLOCKED' || t.dependsOn.some(d =>
        ['BLOCKED', 'FAILED_LOCKED'].includes(tasks.get(d).status)));
      const status = locked ? 'FAILED_LOCKED' : blocked ? 'BLOCKED' : candidates.length ? 'READY' : 'WAITING';
      return {status, repository: contract.repository, head: snapshot.head, stage,
        candidates: status === 'READY' ? candidates : [], terminal, acceptedStages,
        nextAction: locked?.nextAction || blocked?.nextAction || (status === 'READY' ?
          'Review this source-only plan; execution is disabled.' : 'Supply verified dependencies or stage acceptance; do not create filler work.')};
    }});
}

// References the existing catalog and canonical release; never copies jobs or
// infers G1 acceptance. Preserve the native queue byte-for-byte for consumers.
export function createStrigunovAdapter({enginePilot = false} = {}) {
  return Object.freeze({id: 'strigunov4', contractHash: hash({release: RELEASE, enginePilot}),
    contract: {execution: 'disabled', maxAttemptsPerTask: 1, maxPlansPerStage: 2,
      goal: {source: 'docs/agent-os/releases/strigunov4-demo.json'},
      functions: ['prepare-source'], tools: ['existing-runner-bridge'], catalog: WORK_ORDERS},
    evaluate(snapshot) {
      must(sha(snapshot?.mainSha), 'VERIFIED_MAIN_SHA_REQUIRED');
      const queue = decideQueue(snapshot, {enginePilot});
      const blocked = queue.jobs.find(job => !job.optional && job.status === 'BLOCKED');
      const candidates = queue.jobs.filter(job => job.status === 'SOURCE_PREPARATION_READY').map(job => {
        const work = [...WORK_ORDERS, ENGINE_PILOT].find(w => w.id === job.job);
        return {id: job.job, stage: queue.stage, operation: 'prepare-source', priority: 0,
          tool: 'existing-runner-bridge', paths: [...work.paths]};
      });
      return {status: blocked ? 'BLOCKED' : candidates.length ? 'READY' : 'WAITING',
        repository: 'ASI-integration/asi-landing', head: snapshot.mainSha,
        stage: queue.stage, candidates: blocked ? [] : candidates, nativeQueue: queue,
        acceptedStages: snapshot.contract.stages.filter(s => s.status === 'ACCEPTED').map(s => s.id),
        terminal: queue.jobs.filter(j => j.status === 'EXISTING_PR').map(j => ({id: j.job, status: 'PUBLISHED'})),
        nextAction: blocked ? `Reconcile ${blocked.job}: ${blocked.reason}` : queue.stop || queue.decision};
    }});
}
