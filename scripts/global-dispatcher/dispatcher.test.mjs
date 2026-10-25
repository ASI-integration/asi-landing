import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {createProductAdapter, createStrigunovAdapter, validateProductContract, hash} from './product-adapters.mjs';
import {createGlobalDispatcher, initializeRoutingState} from './dispatcher.mjs';
import {decideQueue, WORK_ORDERS} from '../strigunov4/ASI-STRIGUNOV4-MULTIJOB-20261020.mjs';
import {createOrchestrator} from '../strigunov4/ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.mjs';

const HEAD = 'a'.repeat(40);
// Atlas/Location are deliberately fixtures, not product roadmaps or admissions.
function contract(id = 'atlas') {
  return {schema: 'asi.product-route.v1', id, repository: 'ASI-integration/asi-landing', execution: 'disabled',
    goal: {result: 'Fixture-only accepted existing-file change', criteria: ['fixture goal accepted']},
    evidence: ['tests', 'review', 'pr', 'ci', 'report'],
    stages: [{id: 'g1', criteria: ['g1 accepted'], dependsOn: []},
      {id: 'g2', criteria: ['g2 accepted'], dependsOn: ['g1']}],
    functions: ['prepare-source'], tools: ['isolated-check'], paths: ['fixture.txt'],
    maxAttemptsPerTask: 1, maxPlansPerStage: 3};
}
function adapter(id = 'atlas', verifyEvidence = e => e.report === 'fixture:independently-verified') {
  return createProductAdapter(contract(id), {verifyEvidence});
}
function snapshot(a, names = ['first']) {
  return {product: a.id, contractHash: a.contractHash, head: HEAD,
    stages: [{id: 'g1', status: 'OPEN'}, {id: 'g2', status: 'NOT_STARTED'}],
    tasks: names.map((id, i) => ({id, stage: 'g1', status: 'READY', operation: 'prepare-source',
      tool: 'isolated-check', paths: ['fixture.txt'], dependsOn: [], priority: i}))};
}
function evidence(a, s, subject, criteria) {
  return {product: a.id, contractHash: a.contractHash, repository: a.contract.repository,
    subject, head: s.head, criteria, tests: 'PASS', review: 'PASS', ci: 'PASS',
    pr: {number: 1, head: s.head}, report: 'fixture:independently-verified'};
}
function acceptTask(a, s, id) {
  const task = s.tasks.find(t => t.id === id);
  task.status = 'ACCEPTED'; task.nextAction = 'Observe verified acceptance.';
  task.evidence = evidence(a, s, `task:${id}`, [id]);
}
async function setup(t, adapters = [adapter()]) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asi-global-'));
  t.after(() => fs.rm(stateDir, {recursive: true, force: true}));
  await initializeRoutingState(stateDir);
  return {stateDir, dispatcher: createGlobalDispatcher({stateDir, adapters})};
}
async function read(stateDir) { return JSON.parse(await fs.readFile(path.join(stateDir, 'routing.json'), 'utf8')); }
function strigunov() {
  return {mainSha: HEAD, contract: {schemaVersion: 'asi.demo-release.v1', releaseId: 'STRIGUNOV4-READY-FOR-DEMO',
    state: 'FROZEN_ON_OWNER_MERGE', stages: [1, 2, 3, 4, 5, 6].map(i => ({id: `S4-G${i}`,
      status: i === 1 ? 'IN_PROGRESS' : 'NOT_STARTED',
      files: i === 1 ? [...WORK_ORDERS.find(w => w.kind === 'prepare-source').paths,
        'scripts/strigunov4/test_c4_unit_readonly.py'] : []}))},
    issues: {511: {number: 511, state: 'open', labels: ['agent-source-ready']}}, project: {511: 'PREPARATION_ONLY'},
    prs: Object.fromEntries(WORK_ORDERS.filter(w => w.pr).map(w => [w.pr,
      {number: w.pr, head: w.head, state: 'closed', merged: true}])), ledger: {}};
}

test('Strigunov native queue stays identical for ready, failed optional, mandatory, published and pilot states', () => {
  for (const enginePilot of [false, true]) {
    const a = createStrigunovAdapter({enginePilot});
    const s = strigunov();
    const cases = [structuredClone(s)];
    s.prs[520].merged = false; cases.push(structuredClone(s));
    s.prs[509].merged = false; cases.push(structuredClone(s));
    s.prs[509].merged = true; s.ledger['g1-unit-apply-source'] = {publishedPr: 540, head: HEAD}; cases.push(s);
    for (const input of cases) assert.deepEqual(a.evaluate(input).nativeQueue, decideQueue(input, {enginePilot}));
  }
});
test('existing orchestrator consumes native selection without an execution port being called', async t => {
  const a = createStrigunovAdapter(), s = strigunov();
  const {dispatcher, stateDir} = await setup(t, [a]);
  const plan = await dispatcher.plan({strigunov4: s});
  assert.equal(plan.selected.task.id, 'g1-unit-apply-source');
  const forbidden = () => { throw Error('NO_EXECUTOR_CALL_ALLOWED'); };
  const orchestrator = createOrchestrator({stateDir, fetchSnapshot: async () => s,
    choose: () => plan.products[0].nativeQueue, authorize: forbidden, dispatch: forbidden, verifyPublication: forbidden});
  assert.equal((await orchestrator.iteration({execute: false})).mode, 'SOURCE_PLAN_AVAILABLE');
});
test('Strigunov refuses G1 to G2 skip and keeps final owner acceptance WAITING', () => {
  const a = createStrigunovAdapter(), s = strigunov();
  s.contract.stages[1].status = 'IN_PROGRESS'; assert.throws(() => a.evaluate(s), /RELEASE_SKIP_STAGE/);
  s.contract.stages.forEach(st => { st.status = 'ACCEPTED'; });
  assert.equal(a.evaluate(s).status, 'WAITING');
  assert.equal(a.evaluate(s).nativeQueue.decision, 'AWAIT_FINAL_OWNER_ACCEPTANCE');
});
test('complete contracts required and protected functions cannot be inferred', () => {
  for (const mutate of [c => { c.goal.criteria = []; }, c => { c.execution = 'enabled'; },
    c => { c.stages[1].dependsOn = []; }, c => { c.paths = ['.github/workflows/deploy.yml']; },
    c => { c.paths = ['../fixture.txt']; }, c => { c.evidence = ['tests']; },
    c => { c.evidence.push('unimplemented-owner-signature'); }]) {
    const c = contract(); mutate(c); assert.throws(() => validateProductContract(c));
  }
  assert.throws(() => createProductAdapter(contract()), /VERIFIER_REQUIRED/);
});
test('scope and product identity never transfer via supplied authority', async t => {
  const a = adapter('atlas'), l = adapter('location');
  const {dispatcher} = await setup(t, [a, l]);
  const s = snapshot(a); s.authority = {approved: true, product: 'location'};
  s.tasks[0].authority = s.authority;
  const result = await dispatcher.plan({atlas: s, location: s});
  assert.equal(result.products[1].status, 'BLOCKED');
  assert.equal(result.selected.product, 'atlas'); assert.equal(result.selected.authority, null);
  assert.equal(result.selected.task.authority, undefined); assert.equal(result.selected.head, HEAD);
  assert.equal(result.executable, false); assert.deepEqual(Object.keys(dispatcher), ['plan']);
  for (const mutate of [v => { v.tasks[0].paths = ['other.txt']; }, v => { v.tasks[0].tool = 'shell'; },
    v => { v.tasks[0].operation = 'deploy'; }, v => { v.tasks[0].priority = NaN; }]) {
    const input = snapshot(a); mutate(input); assert.throws(() => a.evaluate(input));
  }
});
test('dependencies and priority select a valid next task, not a blocked higher-priority dependent', async t => {
  const a = adapter(), s = snapshot(a, ['first', 'second']);
  s.tasks[1].dependsOn = ['first']; s.tasks[1].priority = 100;
  const {dispatcher} = await setup(t, [a]);
  assert.equal((await dispatcher.plan({atlas: s})).selected.task.id, 'first');
  acceptTask(a, s, 'first');
  assert.equal((await dispatcher.plan({atlas: s})).selected.task.id, 'second');
});
test('failed mandatory dependency locks instead of selecting unrelated work', async t => {
  const a = adapter(), s = snapshot(a, ['first', 'second']);
  s.tasks[0].status = 'FAILED_LOCKED'; s.tasks[0].nextAction = 'Reconcile the failed source operation.';
  s.tasks[1].dependsOn = ['first'];
  const {dispatcher} = await setup(t, [a]);
  assert.equal((await dispatcher.plan({atlas: s})).status, 'FAILED_LOCKED');
  s.tasks[0].status = 'READY';
  assert.equal((await dispatcher.plan({atlas: s})).status, 'FAILED_LOCKED');
});
test('dependency cycles, unknown and later-stage dependencies are rejected', () => {
  const a = adapter();
  for (const names of [['second', 'first'], ['missing', 'first']]) {
    const s = snapshot(a, ['first', 'second']);
    s.tasks.forEach((v, i) => { v.dependsOn = [names[i]]; });
    assert.throws(() => a.evaluate(s), /DEPENDENCY/);
  }
  const s = snapshot(a, ['first', 'second']); s.tasks[1].stage = 'g2'; s.tasks[0].dependsOn = ['second'];
  assert.throws(() => a.evaluate(s), /DEPENDENCY_INVALID/);
});
test('stage transition needs exact independent evidence; signed-looking booleans and async verdicts fail', () => {
  const a = adapter(), s = snapshot(a, []);
  s.stages[0].status = 'ACCEPTED'; s.stages[1].status = 'OPEN';
  s.stages[0].evidence = {approved: true}; assert.throws(() => a.evaluate(s), /EVIDENCE/);
  s.stages[0].evidence = evidence(a, s, 'stage:g1', ['g1 accepted']);
  assert.equal(a.evaluate(s).stage, 'g2');
  for (const field of ['head', 'product', 'subject', 'contractHash', 'report']) {
    const bad = structuredClone(s); bad.stages[0].evidence[field] = 'forged';
    assert.throws(() => a.evaluate(bad), /EVIDENCE/);
  }
  assert.throws(() => adapter('atlas', async () => true).evaluate(s), /EVIDENCE/);
});
test('accepted stages cannot be skipped or reopened, including after restart', async t => {
  const a = adapter(), s = snapshot(a, []);
  s.stages[1].status = 'OPEN'; assert.throws(() => a.evaluate(s), /STAGE_SKIP/);
  s.stages[0].status = 'ACCEPTED'; s.stages[0].evidence = evidence(a, s, 'stage:g1', ['g1 accepted']);
  const {dispatcher, stateDir} = await setup(t, [a]);
  await dispatcher.plan({atlas: s});
  const resumed = createGlobalDispatcher({stateDir, adapters: [a]});
  assert.equal((await resumed.plan({atlas: snapshot(a)})).products[0].reason, 'ACCEPTED_STAGE_REGRESSION');
});
test('goal completion requires independent final criteria and creates no new work', async t => {
  const a = adapter(), s = snapshot(a, []);
  s.stages.forEach(st => { st.status = 'ACCEPTED'; st.evidence = evidence(a, s, `stage:${st.id}`, [`${st.id} accepted`]); });
  assert.throws(() => a.evaluate(s), /EVIDENCE/);
  s.goalEvidence = evidence(a, s, 'goal', ['fixture goal accepted']);
  const {dispatcher} = await setup(t, [a]);
  const result = await dispatcher.plan({atlas: s});
  assert.equal(result.status, 'ACCEPTED'); assert.equal(result.selected, null);
});
test('fairness survives restart and priority cannot starve another product', async t => {
  const adapters = ['atlas', 'location', 'other'].map(id => adapter(id));
  const inputs = Object.fromEntries(adapters.map(a => [a.id, snapshot(a, ['first', 'second'])]));
  inputs.atlas.tasks.forEach(task => { task.priority = 100; });
  const {stateDir} = await setup(t, adapters);
  const order = [];
  for (let i = 0; i < 6; i++) {
    const d = createGlobalDispatcher({stateDir, adapters});
    const selected = (await d.plan(inputs)).selected;
    order.push(selected.product);
    const a = adapters.find(v => v.id === selected.product);
    acceptTask(a, inputs[a.id], selected.task.id);
  }
  assert.deepEqual(order, ['atlas', 'location', 'other', 'atlas', 'location', 'other']);
});
test('blocked products do not starve a healthy product', async t => {
  const a = adapter(), l = adapter('location');
  const {dispatcher} = await setup(t, [a, l]);
  const result = await dispatcher.plan({atlas: {invalid: true}, location: snapshot(l)});
  assert.equal(result.selected.product, 'location'); assert.equal(result.products[0].status, 'BLOCKED');
});
test('same task cannot replay on polling, restart, new head or lost returned decision', async t => {
  const a = adapter(), s = snapshot(a), {dispatcher, stateDir} = await setup(t, [a]);
  await dispatcher.plan({atlas: s}); // Simulate caller losing the response.
  s.head = 'b'.repeat(40);
  const resumed = createGlobalDispatcher({stateDir, adapters: [a]});
  for (let i = 0; i < 4; i++) assert.equal((await resumed.plan({atlas: s})).selected, null);
  assert.equal((await read(stateDir)).state.tick, 1);
});
test('published and accepted task tombstones prevent duplicate PR planning after stale input', async t => {
  for (const status of ['PUBLISHED', 'ACCEPTED']) {
    const a = adapter(status.toLowerCase()), s = snapshot(a);
    acceptTask(a, s, 'first'); s.tasks[0].status = status;
    const {dispatcher} = await setup(t, [a]); await dispatcher.plan({[a.id]: s});
    const stale = snapshot(a);
    assert.equal((await dispatcher.plan({[a.id]: stale})).selected, null);
  }
});
test('bounded stage budget stops new-name cosmetic activity without acceptance', async t => {
  const a = adapter(), {dispatcher} = await setup(t, [a]);
  a.contract.maxPlansPerStage = 1000; // A post-registration mutation cannot raise admission limits.
  for (let i = 0; i < 3; i++) assert.ok((await dispatcher.plan({atlas: snapshot(a, [`fix-${i}`])})).selected);
  const result = await dispatcher.plan({atlas: snapshot(a, ['fix-again'])});
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.selected, null);
});
test('empty product queue waits with a concrete next action and no journal activity growth', async t => {
  const a = adapter(), {dispatcher, stateDir} = await setup(t, [a]);
  for (let i = 0; i < 3; i++) {
    const result = await dispatcher.plan({atlas: snapshot(a, [])});
    assert.equal(result.status, 'WAITING'); assert.equal(result.selected, null);
    assert.match(result.products[0].nextAction, /stage acceptance/);
  }
  assert.equal((await read(stateDir)).state.tick, 0);
});
test('parallel callers reserve once, and another caller cannot steal a held lock', async t => {
  const a = adapter(), {stateDir} = await setup(t, [a]);
  const results = await Promise.all([1, 2, 3].map(() => createGlobalDispatcher({stateDir, adapters: [a]}).plan({atlas: snapshot(a)})));
  assert.equal(results.filter(r => r.selected).length, 1);
  assert.ok(results.some(r => r.status === 'FAILED_LOCKED'));
});
test('corrupt, truncated, symlinked and invalid-schema state never reinitializes', async t => {
  const a = adapter();
  for (const content of ['{', JSON.stringify({state: {}, checksum: 'wrong'}),
    JSON.stringify({state: {schema: 'bad'}, checksum: hash({schema: 'bad'})})]) {
    const {stateDir, dispatcher} = await setup(t, [a]);
    await fs.writeFile(path.join(stateDir, 'routing.json'), content);
    assert.equal((await dispatcher.plan({atlas: snapshot(a)})).status, 'FAILED_LOCKED');
    assert.equal(await fs.readFile(path.join(stateDir, 'routing.json'), 'utf8'), content);
    await assert.rejects(initializeRoutingState(stateDir), /EMPTY/);
  }
  const {stateDir, dispatcher} = await setup(t, [a]);
  await fs.rename(path.join(stateDir, 'routing.json'), path.join(stateDir, 'original.json'));
  await fs.symlink('original.json', path.join(stateDir, 'routing.json'));
  assert.equal((await dispatcher.plan({atlas: snapshot(a)})).status, 'FAILED_LOCKED');
});
test('removing a product or changing a bound contract cannot reset its history', async t => {
  const a = adapter(), {dispatcher, stateDir} = await setup(t, [a]);
  await dispatcher.plan({atlas: snapshot(a)});
  const changed = contract(); changed.goal.result = 'changed';
  const replacement = createProductAdapter(changed, {verifyEvidence: () => false});
  for (const adapters of [[replacement], [adapter('other')]]) {
    assert.equal((await createGlobalDispatcher({stateDir, adapters}).plan({})).status, 'FAILED_LOCKED');
  }
});
test('real SIGKILL during evaluation preserves lock and never returns a replay plan', {timeout: 10_000}, async t => {
  const a = adapter(), {stateDir} = await setup(t, [a]);
  const moduleUrl = new URL('./dispatcher.mjs', import.meta.url).href;
  const childFile = path.join(stateDir, 'crash-child.mjs');
  await fs.writeFile(childFile, `import {createGlobalDispatcher} from ${JSON.stringify(moduleUrl)};
    const adapter = {id:'atlas', contractHash:'a'.repeat(64),
      contract:{execution:'disabled',maxAttemptsPerTask:1,maxPlansPerStage:3},
      evaluate(){ process.send('locked'); for(;;){} }};
    await createGlobalDispatcher({stateDir:process.argv[2],adapters:[adapter]}).plan({atlas:{}});`);
  const child = fork(childFile, [stateDir], {stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', () => reject(Error('Exited before lock'))); });
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
  const result = await createGlobalDispatcher({stateDir, adapters: [a]}).plan({atlas: snapshot(a)});
  assert.equal(result.status, 'FAILED_LOCKED'); assert.equal(result.selected, null);
  assert.equal((await read(stateDir)).state.tick, 0);
});
test('private state directory and duplicate registrations are mandatory', async t => {
  const a = adapter(), {stateDir} = await setup(t, [a]);
  assert.throws(() => createGlobalDispatcher({stateDir, adapters: [a, a]}), /UNIQUE/);
  assert.throws(() => createGlobalDispatcher({stateDir, adapters: [{...a,
    contract: {execution: 'disabled'}}]}), /UNIQUE/);
  await fs.chmod(stateDir, 0o755);
  assert.equal((await createGlobalDispatcher({stateDir, adapters: [a]}).plan({atlas: snapshot(a)})).status, 'FAILED_LOCKED');
});
test('initializer preserves state that appears between empty-directory check and lock acquisition', async t => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asi-global-init-race-'));
  t.after(() => fs.rm(stateDir, {recursive: true, force: true}));
  const originalOpen = fs.open;
  fs.open = async (filename, ...args) => {
    const handle = await originalOpen(filename, ...args);
    if (filename === path.join(stateDir, 'routing.lock')) {
      // Deterministically simulate another initializer committing and releasing
      // immediately before this initializer acquires the same lock.
      await fs.writeFile(path.join(stateDir, 'routing.json'), 'concurrent state; preserve me', {mode: 0o600});
    }
    return handle;
  };
  try { await assert.rejects(initializeRoutingState(stateDir), /STATE_APPEARED/); }
  finally { fs.open = originalOpen; }
  assert.equal(await fs.readFile(path.join(stateDir, 'routing.json'), 'utf8'), 'concurrent state; preserve me');
  assert.ok((await fs.stat(path.join(stateDir, 'routing.lock'))).isFile());
});
