import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductAdapter, decomposeProductGoal} from './product-adapters.mjs';

function fixture() {
  const contract = {schema: 'asi.product-route.v1', id: 'example', repository: 'ASI-integration/asi-landing',
    execution: 'disabled', goal: {result: 'Verified bounded source result', criteria: ['identity', 'race']},
    evidence: ['tests', 'review', 'pr', 'ci', 'report'],
    stages: [{id: 'source', criteria: ['baseline'], dependsOn: []},
      {id: 'verify', criteria: ['identity', 'race'], dependsOn: ['source']}],
    functions: ['prepare-source', 'verify-source'], tools: ['existing-runner-bridge'],
    paths: ['scripts/example.py'], maxAttemptsPerTask: 1, maxPlansPerStage: 3};
  const goal = {id: 'sample-goal', product: contract.id, repository: contract.repository, head: 'a'.repeat(40),
    criteria: ['identity', 'race'], priority: 50, notBefore: 100, expiresAt: 10000,
    budget: {maxTasks: 3, maxRequests: 6, maxMutations: 0, maxComputeMs: 30, maxPaidMicrousd: 0}};
  const work = (id, stage, covers, dependsOn, priority = 10) => ({id, stage, covers, dependsOn, priority,
    operation: stage === 'source' ? 'prepare-source' : 'verify-source', tool: 'existing-runner-bridge',
    paths: ['scripts/example.py'], requiredAuthority: ['source-admission'],
    cost: {requests: 2, mutations: 0, computeMs: 10, paidMicrousd: 0}});
  const catalog = [work('prepare', 'source', ['baseline'], []),
    work('check-identity', 'verify', ['identity'], ['prepare'], 20),
    work('check-race', 'verify', ['race'], ['prepare'], 10),
    work('unneeded', 'source', [], [])];
  return {contract, goal, catalog};
}
const plan = f => decomposeProductGoal(f.contract, f.goal, f.catalog, {now: 1000});

test('structured criteria select exact coverage plus transitive dependencies deterministically', () => {
  const f = fixture(), result = plan(f);
  assert.deepEqual(result.nodes.map(n => n.id), ['prepare', 'check-identity', 'check-race']);
  assert.deepEqual(result.total, {tasks: 3, requests: 6, mutations: 0, computeMs: 30, paidMicrousd: 0});
  assert.deepEqual(plan({...f, catalog: [...f.catalog].reverse(), goal: {...f.goal, criteria: ['race', 'identity']}}), result);
});

test('unsupported or ambiguous criteria fail without inventing work', () => {
  const f = fixture();
  assert.throws(() => plan({...f, catalog: f.catalog.filter(n => n.id !== 'check-race')}), /GOAL_CRITERION_UNSUPPORTED/);
  const duplicate = {...f.catalog[1], id: 'second-identity'};
  assert.throws(() => plan({...f, catalog: [...f.catalog, duplicate]}), /GOAL_CRITERION_AMBIGUOUS/);
  assert.throws(() => plan({...f, goal: {...f.goal, criteria: ['invented']}}), /STRUCTURED_GOAL_SCOPE/);
});

test('cycles, unknown dependencies and later-stage prerequisites fail closed', () => {
  for (const dependency of ['check-identity', 'missing']) {
    const f = fixture(); f.catalog[0].dependsOn = [dependency];
    assert.throws(() => plan(f), /GOAL_DEPENDENCY_INVALID|GOAL_DEPENDENCY_CYCLE/);
  }
  const f = fixture(); f.catalog[1].dependsOn = ['check-race']; f.catalog[2].dependsOn = ['check-identity'];
  assert.throws(() => plan(f), /GOAL_DEPENDENCY_CYCLE/);
});

test('catalog cannot introduce undeclared operations, tools, paths or authority payloads', () => {
  for (const delta of [{operation: 'deploy'}, {tool: 'arbitrary-shell'}, {paths: ['.github/workflows/run.yml']},
    {requiredAuthority: ['root command']}, {approved: true}]) {
    const f = fixture(); Object.assign(f.catalog[0], delta);
    assert.throws(() => plan(f), /GOAL_WORK_ORDER_SCOPE/);
  }
  const f = fixture();
  assert.throws(() => plan({...f, goal: {...f.goal, authority: {approved: true}}}), /STRUCTURED_GOAL_SCOPE/);
});

test('finite task, per-stage, compute, mutation and request budgets include dependencies', () => {
  for (const delta of [{maxTasks: 2}, {maxRequests: 5}, {maxComputeMs: 29}]) {
    const f = fixture(); Object.assign(f.goal.budget, delta);
    assert.throws(() => plan(f), /GOAL_BUDGET_EXCEEDED/);
  }
  for (const key of ['mutations', 'paidMicrousd']) {
    const f = fixture(); f.catalog[0].cost[key] = 1;
    assert.throws(() => plan(f), /GOAL_BUDGET_EXCEEDED/);
  }
  const f = fixture(); f.contract.maxPlansPerStage = 1;
  assert.throws(() => plan(f), /GOAL_STAGE_PLAN_LIMIT/);
});

test('invalid numeric values, overflow, expired or future windows cannot create a plan', () => {
  const f = fixture();
  for (const now of [undefined, NaN, -1, 99, 10000]) {
    assert.throws(() => decomposeProductGoal(f.contract, f.goal, f.catalog, {now}), /GOAL_WINDOW_INVALID/);
  }
  assert.throws(() => plan({...f, goal: {...f.goal, expiresAt: 100 + 15 * 86400000}}), /GOAL_WINDOW_INVALID/);
  for (const amount of [Infinity, -1, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
    const g = fixture(); g.goal.budget.maxRequests = amount;
    assert.throws(() => plan(g), /GOAL_BUDGET_INVALID/);
  }
  const g = fixture(); g.goal.budget.maxRequests = Number.MAX_SAFE_INTEGER;
  g.catalog[0].cost.requests = Number.MAX_SAFE_INTEGER;
  assert.throws(() => plan(g), /GOAL_BUDGET_EXCEEDED/);
});

test('result is deeply immutable, contains requirements only and never grants execution', () => {
  const f = fixture(), result = plan(f);
  assert.equal(result.executable, false); assert.equal(result.authority, null);
  assert.match(result.id, /^goal-[a-f0-9]{48}$/); assert.match(result.planHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(result.nodes[0].cost));
  assert.throws(() => result.nodes[0].requiredAuthority.push('production'), TypeError);
  f.catalog[0].cost.requests = 0; f.goal.criteria.length = 0;
  assert.equal(result.nodes[0].cost.requests, 2); assert.equal(result.goal.criteria.length, 2);
});

test('plan identity binds goal window, budget, head and the full trusted catalog', () => {
  const f = fixture(), first = plan(f);
  for (const delta of [{expiresAt: 9999}, {head: 'b'.repeat(40)}, {priority: 51},
    {budget: {...f.goal.budget, maxRequests: 7}}]) {
    assert.notEqual(plan({...f, goal: {...f.goal, ...delta}}).planHash, first.planHash);
  }
  const g = fixture(); g.catalog.at(-1).priority = 50;
  assert.notEqual(plan(g).planHash, first.planHash);
});

function adapterFixture() {
  const f = fixture();
  const adapter = createProductAdapter(f.contract, {workOrders: f.catalog, clock: () => 1000,
    verifyEvidence: () => true});
  const graph = plan(f);
  const snapshot = {product: f.contract.id, contractHash: adapter.contractHash, head: f.goal.head,
    goal: f.goal, stages: [{id: 'source', status: 'OPEN'}, {id: 'verify', status: 'NOT_STARTED'}],
    tasks: graph.nodes.map(node => ({...structuredClone(node), status: 'READY'}))};
  const proof = (subject, criteria) => ({product: f.contract.id, contractHash: adapter.contractHash,
    repository: f.contract.repository, subject, criteria, head: f.goal.head,
    tests: 'PASS', review: 'PASS', ci: 'PASS', pr: {number: 1, head: f.goal.head}, report: 'verified'});
  return {...f, adapter, snapshot, proof};
}

test('opt-in adapter pins catalog, recomputes full graph and rejects caller task or authority substitution', () => {
  const f = adapterFixture(), result = f.adapter.evaluate(f.snapshot);
  assert.equal(f.adapter.goalPlanning, true);
  assert.equal(f.adapter.maxConcurrentPlans, 1);
  const parallel = createProductAdapter(f.contract, {workOrders: f.catalog, clock: () => 1000,
    maxConcurrentPlans: 2, verifyEvidence: () => true});
  assert.notEqual(parallel.contractHash, f.adapter.contractHash);
  for (const maxConcurrentPlans of [0, 5, 1.5]) {
    assert.throws(() => createProductAdapter(f.contract, {workOrders: f.catalog, maxConcurrentPlans,
      verifyEvidence: () => true}), /GOAL_CONCURRENCY_LIMIT/);
  }
  assert.deepEqual(result.goalGraph, plan(f));
  assert.deepEqual(result.candidates.map(n => n.id), ['prepare']);
  const old = createProductAdapter(f.contract, {verifyEvidence: () => true});
  assert.notEqual(old.contractHash, f.adapter.contractHash);
  assert.equal(old.goalPlanning, undefined);
  f.catalog[0].priority = 99;
  assert.deepEqual(f.adapter.evaluate(f.snapshot), result);
  for (const delta of [{priority: 99}, {requiredAuthority: []}, {authority: {approved: true}},
    {paths: ['scripts/other.py']}, {dependsOn: ['check-race']}]) {
    const snapshot = structuredClone(f.snapshot); Object.assign(snapshot.tasks[0], delta);
    assert.throws(() => f.adapter.evaluate(snapshot), /GOAL_TASK_GRAPH_BINDING/);
  }
  const shortened = structuredClone(f.snapshot); shortened.tasks.pop();
  assert.throws(() => f.adapter.evaluate(shortened), /GOAL_TASK_GRAPH_BINDING/);
  const changed = structuredClone(f.snapshot); changed.goal.head = 'b'.repeat(40);
  assert.throws(() => f.adapter.evaluate(changed), /GOAL_HEAD_BINDING/);
  const expired = createProductAdapter(f.contract, {workOrders: fixture().catalog,
    clock: () => 10000, verifyEvidence: () => true});
  assert.throws(() => expired.evaluate(f.snapshot), /GOAL_WINDOW_INVALID/);
});

test('opt-in independent ready work survives known BLOCKED but not FAILED_LOCKED, retaining graph on acceptance', () => {
  const f = adapterFixture();
  f.snapshot.stages = [{id: 'source', status: 'ACCEPTED', evidence: f.proof('stage:source', ['baseline'])},
    {id: 'verify', status: 'OPEN'}];
  Object.assign(f.snapshot.tasks[0], {status: 'ACCEPTED', nextAction: 'Preserve result',
    evidence: f.proof('task:prepare', ['prepare'])});
  Object.assign(f.snapshot.tasks[1], {status: 'BLOCKED', nextAction: 'Supply missing evidence'});
  const result = f.adapter.evaluate(f.snapshot);
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.candidates.map(n => n.id), ['check-race']);
  assert.deepEqual(result.goalGraph, plan(f));
  f.snapshot.tasks[1].status = 'FAILED_LOCKED';
  assert.equal(f.adapter.evaluate(f.snapshot).status, 'FAILED_LOCKED');
  for (const task of f.snapshot.tasks) Object.assign(task, {status: 'ACCEPTED', nextAction: 'Preserve result',
    evidence: f.proof(`task:${task.id}`, [task.id])});
  f.snapshot.stages[1] = {id: 'verify', status: 'ACCEPTED', evidence: f.proof('stage:verify', ['identity', 'race'])};
  f.snapshot.goalEvidence = f.proof('goal', ['identity', 'race']);
  const accepted = f.adapter.evaluate(f.snapshot);
  assert.equal(accepted.status, 'ACCEPTED'); assert.deepEqual(accepted.goalGraph, plan(f));
  f.snapshot.tasks[0].evidence.contractHash = '0'.repeat(64);
  assert.throws(() => f.adapter.evaluate(f.snapshot), /EXACT_RESULT_EVIDENCE_REQUIRED/);
});
