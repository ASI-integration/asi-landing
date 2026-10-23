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

// Pure advisory matrix shared by product adapters. The trusted read-only reader
// attests provenance/completeness, NOT the decision. No execution port is accepted.
export function publicationOversight(context, evidence, verifyEvidence) {
  const result = {Product: context.product, Milestone: context.milestone,
    ConfirmedAchievements: [], Blocker: 'EVIDENCE_UNAVAILABLE', RootCauseConfidence: 'UNKNOWN',
    NextAction: 'SUPPLY_MISSING_BOUND_EVIDENCE', ExecutionAllowed: false,
    OwnerApprovalRequired: true, AcceptanceCriteria: [], EvidenceReferences: [],
    PUBLICATION: 'UNKNOWN', REPUBLISH_FORBIDDEN: true, ENGINE_E2E: 'INCOMPLETE',
    ROOT_CAUSE: 'UNKNOWN', EngineState: 'UNKNOWN', Status: 'BLOCKED', EvidenceStatus: 'UNKNOWN'};
  const stop = (code, conflict = false, action = 'SUPPLY_MISSING_BOUND_EVIDENCE') => {
    result.Blocker = code;
    result.EvidenceStatus = conflict ? 'EVIDENCE_CONFLICT' : 'UNKNOWN';
    result.NextAction = conflict ? 'RESOLVE_EVIDENCE_CONFLICT' : action;
    return result;
  };
  try {
    if (!evidence || typeof verifyEvidence !== 'function' ||
        verifyEvidence(structuredClone(evidence)) !== true) return stop('EVIDENCE_NOT_VERIFIED');
    const e = evidence, task = e.task, op = e.publication;
    if (e.product !== context.product || e.repository !== context.repository ||
        e.contractHash !== context.contractHash || e.milestone !== context.milestone ||
        task?.workOrderId !== context.workOrderId || task.repo !== context.repository ||
        task.stage !== context.milestone) return stop('PRODUCT_OPERATION_BINDING', true);
    if (!id(task.id) || !sha(task.sha) || !text(task.branch)) return stop('TASK_IDENTITY_UNAVAILABLE');
    if (!Array.isArray(e.references) || !e.references.length ||
        !e.references.every(r => text(r.source) && text(r.ref) && Number.isFinite(Date.parse(r.at)))) {
      return stop('EVIDENCE_REFERENCES_MISSING');
    }
    result.EvidenceReferences = e.references.map(({source, ref, at}) => ({source, ref, at}));
    if (e.serverAvailable !== true) return stop('SERVER_SNAPSHOT_UNAVAILABLE');
    const job = e.ledger?.jobs?.[task.id];
    if (!job || !e.ledger?.mode) return stop('ENGINE_STATE_UNAVAILABLE');
    result.EngineState = e.ledger.mode;
    if (e.ledger.mode === 'FAILED_LOCKED' && job.mode === 'FAILED_LOCKED') {
      result.ConfirmedAchievements.push('ENGINE_FAILED_LOCKED');
    }
    const historical = e.receiptProof?.historical, current = e.receiptProof?.current;
    const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    if (!digest(historical?.sha256) || !digest(current?.sha256) ||
        !Array.isArray(historical.completed) || !Array.isArray(current.completed)) return stop('RECEIPT_HISTORY_UNAVAILABLE');
    // Independent retained bytes, not a caller-provided "unchanged" boolean.
    if (historical.sha256 !== current.sha256 || hash(historical.completed) !== hash(current.completed)) {
      return stop('HISTORICAL_RECEIPT_CHANGED', true);
    }
    const receipts = current.completed.filter(r => r.id === task.id);
    if (receipts.length !== 1) return stop('TERMINAL_RECEIPT_AMBIGUOUS', receipts.length > 1);
    const receipt = receipts[0];
    if (receipt.sha !== task.sha || job.sha !== task.sha) return stop('LEDGER_RECEIPT_BINDING', true);
    if (receipt.status === 'FAILED') result.ConfirmedAchievements.push('HISTORICAL_FAILED_PRESERVED');
    if (!op || !text(op.operationId) || !sha(op.head) || !Number.isSafeInteger(op.pr) || op.pr <= 0) {
      return stop('PUBLICATION_IDENTITY_UNAVAILABLE');
    }
    if (op.taskBinding !== hash(task) || op.baseSha !== task.sha || op.branch !== task.branch) {
      return stop('PUBLICATION_OPERATION_BINDING', true);
    }
    // Null PR in an exception receipt is missing information, not denial that
    // publication happened. Explicit, different IDs/HEADs are contradictions.
    if ([job.pr, job.publishedPr, receipt.pr].some(n => n != null && n !== op.pr) ||
        (job.head != null && job.head !== op.head)) return stop('LEDGER_PUBLICATION_CONFLICT', true);
    result.Target = {repository: context.repository, taskId: task.id, workOrderId: task.workOrderId,
      operationId: op.operationId, pr: op.pr, head: op.head, branch: op.branch,
      historicalReceiptSha256: historical.sha256};
    const github = e.github;
    if (github?.available !== true) return stop('GITHUB_UNAVAILABLE');
    if (github.complete !== true || !Array.isArray(github.publications)) return stop('PUBLICATION_HISTORY_INCOMPLETE');
    if (github.publications.length > 1) return stop('DUPLICATE_PUBLICATION', true);
    if (!github.publications.length) return stop('PUBLISHED_PR_ABSENT', true);
    const pr = github.publications[0];
    if (pr.repository !== context.repository || pr.headRepository !== context.repository || pr.number !== op.pr ||
        pr.head !== op.head || pr.branch !== op.branch) return stop('PR_IDENTITY_HEAD_CONFLICT', true);
    result.PUBLICATION = 'CONFIRMED';
    result.ConfirmedAchievements.push('PR_PUBLICATION_CONFIRMED', 'EXACT_HEAD_CONFIRMED', 'SINGLE_PUBLICATION_CONFIRMED');
    const ci = e.ci, review = e.review;
    if (!ci || !review) return stop('CHECK_EVIDENCE_UNAVAILABLE');
    if (ci.head !== op.head || review.head !== op.head || ci.pr !== op.pr || review.pr !== op.pr) {
      return stop('CHECK_IDENTITY_CONFLICT', true);
    }
    if (!list(ci.required) || !ci.checks || ci.required.some(name => ci.checks[name] !== 'success') || ci.status !== 'PASS') {
      return stop('CI_NOT_SUCCESSFUL', false, 'AWAIT_REQUIRED_CI_RESULT');
    }
    result.ConfirmedAchievements.push('REQUIRED_CI_PASS');
    if (review.status !== 'PASS' || review.completed !== true || review.actionable !== false) {
      return stop('CODERABBIT_NOT_SUCCESSFUL', false, 'AWAIT_CODERABBIT_RESULT');
    }
    result.ConfirmedAchievements.push('CODERABBIT_PASS');
    const service = e.service;
    if (!service || service.ActiveState !== 'inactive' || service.SubState !== 'dead' || String(service.MainPID) !== '0') {
      return stop('ENGINE_STOP_NOT_CONFIRMED');
    }
    result.ConfirmedAchievements.push('ENGINE_STOPPED');
    result.Patches = (e.patches || []).map(p => ({sha: p.sha,
      status: sha(p.sha) && p.files?.length && p.files.every(f => digest(f.installed) && digest(f.patch)) ?
        p.files.every(f => f.installed === f.patch) ? 'INSTALLED' :
          p.files.every(f => f.installed === f.admitted && f.installed !== f.patch) ? 'PREPARED_NOT_INSTALLED' :
            'MIXED_OR_DIFFERENT' : 'UNKNOWN'}));
    if (e.ledger.mode !== 'FAILED_LOCKED' || job.mode !== 'FAILED_LOCKED' || receipt.status !== 'FAILED') {
      return stop('STATE_OUTSIDE_RECONCILIATION_CASE');
    }
    // UNHANDLED is not evidence of a specific crash phase or root cause.
    if (e.rootCause !== 'UNKNOWN') return stop('ROOT_CAUSE_OUTSIDE_UNKNOWN_CASE');
    result.EvidenceStatus = 'VERIFIED';
    result.Blocker = 'FAILED_TERMINAL_RECEIPT_WITH_UNKNOWN_CAUSE';
    result.NextAction = 'PREPARE_AUTHORIZED_RECONCILIATION_EXISTING_PR';
    result.AcceptanceCriteria = ['Bind a separate V1 procedure to Target and retained evidence.',
      'Preserve the historical FAILED receipt, generations, locks and existing PR/branch/HEAD.',
      'No publication, old-operation replay, automatic retry or inferred authority.',
      'Use the existing Engine only after separate exact authorization; reconcile with a distinct linked record.',
      'Control restart only after verified reconciliation terminal receipt and IDLE under that procedure.',
      'Report reconciled completion separately; never relabel historical FAILED as autonomous E2E PASS.'];
    return result;
  } catch { return stop('EVIDENCE_NOT_VERIFIABLE'); }
}

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
      if (snapshot.oversight !== undefined) {
        const workOrderId = snapshot.oversight?.task?.workOrderId;
        const task = tasks.get(workOrderId);
        must(task && task.stage === contract.stages[active]?.id, 'OVERSIGHT_WORK_ORDER_OUTSIDE_QUEUE');
        const oversight = publicationOversight({product: contract.id, repository: contract.repository,
          contractHash, milestone: task.stage, workOrderId}, snapshot.oversight, verifyEvidence);
        return {status: oversight.EngineState === 'FAILED_LOCKED' ? 'FAILED_LOCKED' : 'BLOCKED',
          repository: contract.repository, head: snapshot.head, stage: task.stage, candidates: [],
          acceptedStages, terminal: oversight.EngineState === 'FAILED_LOCKED' ?
            [...terminal.filter(t => t.id !== workOrderId), {id: workOrderId, status: 'FAILED_LOCKED'}] : terminal,
          oversight, nextAction: oversight.NextAction};
      }
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
export function createStrigunovAdapter({enginePilot = false, verifyEvidence} = {}) {
  const contractHash = hash({release: RELEASE, enginePilot});
  return Object.freeze({id: 'strigunov4', contractHash,
    contract: {execution: 'disabled', maxAttemptsPerTask: 1, maxPlansPerStage: 2,
      goal: {source: 'docs/agent-os/releases/strigunov4-demo.json'},
      functions: ['prepare-source'], tools: ['existing-runner-bridge'], catalog: WORK_ORDERS},
    evaluate(snapshot) {
      must(sha(snapshot?.mainSha), 'VERIFIED_MAIN_SHA_REQUIRED');
      const queue = decideQueue(snapshot, {enginePilot});
      if (snapshot.oversight !== undefined) {
        const workOrderId = snapshot.oversight?.task?.workOrderId;
        must(queue.jobs.some(j => j.job === workOrderId), 'OVERSIGHT_WORK_ORDER_OUTSIDE_QUEUE');
        const oversight = publicationOversight({product: 'strigunov4', contractHash,
          repository: 'ASI-integration/asi-landing', milestone: queue.stage, workOrderId}, snapshot.oversight, verifyEvidence);
        return {status: oversight.EngineState === 'FAILED_LOCKED' ? 'FAILED_LOCKED' : 'BLOCKED',
          repository: 'ASI-integration/asi-landing', head: snapshot.mainSha, stage: queue.stage,
          candidates: [], nativeQueue: queue, oversight,
          terminal: oversight.EngineState === 'FAILED_LOCKED' ? [{id: workOrderId, status: 'FAILED_LOCKED'}] : [],
          acceptedStages: snapshot.contract.stages.filter(s => s.status === 'ACCEPTED').map(s => s.id),
          nextAction: oversight.NextAction};
      }
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
