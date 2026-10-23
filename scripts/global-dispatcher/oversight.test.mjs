import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {hash, publicationOversight, createProductAdapter} from './product-adapters.mjs';
import {createGlobalDispatcher, initializeRoutingState} from './dispatcher.mjs';

const head = 'a'.repeat(40), base = 'b'.repeat(40), receiptHash = 'c'.repeat(64);
const next = 'PREPARE_AUTHORIZED_RECONCILIATION_EXISTING_PR';
// Synthetic products only. Real observation is a separate, retained run.
function fixture(product = 'atlas', number = 71) {
  const context = {product, repository: `ASI-fixture/${product}`, contractHash: hash(product),
    milestone: 'g1', workOrderId: 'first'};
  const task = {id: 'saved-operation', workOrderId: context.workOrderId, repo: context.repository,
    stage: context.milestone, sha: base, branch: `asi/${product}/source`};
  const receipt = {id: task.id, sha: base, status: 'FAILED', pr: null};
  const proof = {sha256: receiptHash, completed: [receipt]};
  const evidence = {...context, task, serverAvailable: true,
    ledger: {mode: 'FAILED_LOCKED', jobs: {[task.id]: {mode: 'FAILED_LOCKED', sha: base, pr: null}}},
    receiptProof: {historical: structuredClone(proof), current: structuredClone(proof)},
    publication: {operationId: 'retained-operation', taskBinding: hash(task), baseSha: base,
      head, pr: number, branch: task.branch},
    github: {available: true, complete: true, publications: [{number, head, branch: task.branch,
      repository: context.repository, headRepository: context.repository}]},
    ci: {head, pr: number, status: 'PASS', required: ['validate', 'governance'],
      checks: {validate: 'success', governance: 'success'}},
    review: {head, pr: number, status: 'PASS', completed: true, actionable: false},
    service: {ActiveState: 'inactive', SubState: 'dead', MainPID: '0'}, rootCause: 'UNKNOWN',
    patches: [{sha: 'd'.repeat(40), files: [{installed: receiptHash, admitted: receiptHash, patch: 'e'.repeat(64)}]}],
    references: [{source: 'isolated-fixture-reader', ref: 'fixture:retained', at: '2026-10-23T00:00:00Z'}]};
  return {context, evidence};
}
function decide(f, verify = () => true) { return publicationOversight(f.context, f.evidence, verify); }
function blocked(r, reason, conflict = false) {
  assert.equal(r.Status, 'BLOCKED'); assert.equal(r.ExecutionAllowed, false);
  assert.equal(r.REPUBLISH_FORBIDDEN, true); assert.equal(r.ENGINE_E2E, 'INCOMPLETE');
  assert.equal(r.Blocker, reason); assert.notEqual(r.NextAction, next);
  assert.equal(r.EvidenceStatus, conflict ? 'EVIDENCE_CONFLICT' : 'UNKNOWN');
}

test('dynamic product/PR facts choose one advisory action without mutating inputs or claiming E2E', () => {
  for (const [product, number] of [['atlas', 71], ['location', 903]]) {
    const f = fixture(product, number), before = JSON.stringify(f), r = decide(f);
    assert.equal(r.Product, product); assert.equal(r.Target.pr, number); assert.equal(r.NextAction, next);
    assert.equal(r.PUBLICATION, 'CONFIRMED'); assert.equal(r.EvidenceStatus, 'VERIFIED');
    assert.equal(r.ROOT_CAUSE, 'UNKNOWN'); assert.equal(r.RootCauseConfidence, 'UNKNOWN');
    assert.equal(r.ExecutionAllowed, false); assert.equal(r.OwnerApprovalRequired, true);
    assert.equal(r.REPUBLISH_FORBIDDEN, true); assert.equal(r.ENGINE_E2E, 'INCOMPLETE');
    assert.equal(r.Patches[0].status, 'PREPARED_NOT_INSTALLED');
    assert.equal(JSON.stringify(f), before);
  }
});
test('missing/unconfirmed PR or incomplete history never grants a reconciliation route', () => {
  let f = fixture(); f.evidence.github.publications = [];
  blocked(decide(f), 'PUBLISHED_PR_ABSENT', true);
  f = fixture(); f.evidence.github.complete = false;
  blocked(decide(f), 'PUBLICATION_HISTORY_INCOMPLETE');
  f = fixture(); delete f.evidence.publication.pr;
  blocked(decide(f), 'PUBLICATION_IDENTITY_UNAVAILABLE');
});
test('GitHub outage is UNKNOWN, not ledger corruption; proven retained conflict still wins', () => {
  const f = fixture(); f.evidence.github = {available: false};
  blocked(decide(f), 'GITHUB_UNAVAILABLE');
  f.evidence.receiptProof.current.completed[0].status = 'PASS';
  blocked(decide(f), 'HISTORICAL_RECEIPT_CHANGED', true);
});
test('HEAD, PR, branch, fork and operation mismatches are evidence conflicts', () => {
  for (const key of ['head', 'number', 'branch', 'repository', 'headRepository']) {
    const f = fixture(); f.evidence.github.publications[0][key] = key === 'number' ? 72 : 'wrong';
    blocked(decide(f), 'PR_IDENTITY_HEAD_CONFLICT', true);
  }
  const f = fixture(); f.evidence.publication.taskBinding = '0'.repeat(64);
  blocked(decide(f), 'PUBLICATION_OPERATION_BINDING', true);
});
test('pending, failed, missing and differently bound CI/review block the action', () => {
  for (const state of ['pending', 'failure', undefined]) {
    const f = fixture(); f.evidence.ci.checks.governance = state;
    blocked(decide(f), 'CI_NOT_SUCCESSFUL');
  }
  for (const update of [{status: 'PENDING'}, {completed: false}, {actionable: true}]) {
    const f = fixture(); Object.assign(f.evidence.review, update);
    blocked(decide(f), 'CODERABBIT_NOT_SUCCESSFUL');
  }
  for (const kind of ['ci', 'review']) {
    const f = fixture(); f.evidence[kind].head = base;
    blocked(decide(f), 'CHECK_IDENTITY_CONFLICT', true);
  }
});
test('ledger null PR is unknown detail; an explicit contradictory PR/HEAD is a conflict', () => {
  for (const update of [{pr: 72}, {publishedPr: 72}, {head: base}]) {
    const f = fixture(); Object.assign(f.evidence.ledger.jobs[f.evidence.task.id], update);
    blocked(decide(f), 'LEDGER_PUBLICATION_CONFLICT', true);
  }
});
test('duplicate publication and historical FAILED replacement are blocked', () => {
  let f = fixture(); f.evidence.github.publications.push({...f.evidence.github.publications[0], number: 72});
  blocked(decide(f), 'DUPLICATE_PUBLICATION', true);
  f = fixture(); f.evidence.receiptProof.current.sha256 = 'f'.repeat(64);
  blocked(decide(f), 'HISTORICAL_RECEIPT_CHANGED', true);
  f = fixture(); f.evidence.receiptProof.current.completed[0].status = 'PASS';
  blocked(decide(f), 'HISTORICAL_RECEIPT_CHANGED', true);
});
test('unavailable server/history, live Engine and asserted crash cause cannot meet the case', () => {
  let f = fixture(); f.evidence.serverAvailable = false;
  blocked(decide(f), 'SERVER_SNAPSHOT_UNAVAILABLE');
  f = fixture(); delete f.evidence.receiptProof.historical;
  blocked(decide(f), 'RECEIPT_HISTORY_UNAVAILABLE');
  f = fixture(); f.evidence.service.MainPID = '123';
  blocked(decide(f), 'ENGINE_STOP_NOT_CONFIRMED');
  f = fixture(); f.evidence.rootCause = 'CRASH_ON_COMMIT_PHASE';
  blocked(decide(f), 'ROOT_CAUSE_OUTSIDE_UNKNOWN_CASE');
});
test('untrusted, asynchronous, throwing, cross-product and cross-contract evidence is rejected', () => {
  for (const verifier of [() => false, () => Promise.resolve(true), () => { throw Error('private detail'); }]) {
    const r = decide(fixture(), verifier);
    assert.equal(r.ExecutionAllowed, false); assert.notEqual(r.NextAction, next);
    assert.ok(!JSON.stringify(r).includes('private detail'));
  }
  const f = fixture();
  blocked(publicationOversight(f.context, f.evidence), 'EVIDENCE_NOT_VERIFIED');
  for (const key of ['product', 'contractHash', 'repository', 'milestone']) {
    const changed = fixture(); changed.evidence[key] = 'different';
    blocked(decide(changed), 'PRODUCT_OPERATION_BINDING', true);
  }
});

function product(id) {
  return {schema: 'asi.product-route.v1', id, repository: `ASI-fixture/${id}`, execution: 'disabled',
    goal: {result: 'Fixture goal', criteria: ['accepted']},
    evidence: ['tests', 'review', 'pr', 'ci', 'report'],
    stages: [{id: 'g1', criteria: ['accepted'], dependsOn: []}],
    functions: ['prepare-source'], tools: ['fixture-reader'], paths: ['fixture.txt'],
    maxAttemptsPerTask: 1, maxPlansPerStage: 1};
}
function input(adapter, oversight) {
  return {product: adapter.id, contractHash: adapter.contractHash, head: base,
    stages: [{id: 'g1', status: 'OPEN'}],
    tasks: [{id: 'first', stage: 'g1', status: 'READY', operation: 'prepare-source',
      tool: 'fixture-reader', paths: ['fixture.txt'], dependsOn: [], priority: 1}],
    ...(oversight ? {oversight} : {})};
}
test('existing generic adapter and dispatcher retain advice and failure across restart, isolate healthy products', async t => {
  const f = fixture(), trusted = new Set();
  const a = createProductAdapter(product('atlas'), {verifyEvidence: e => trusted.has(hash(e))});
  f.evidence.contractHash = a.contractHash; trusted.add(hash(f.evidence));
  const b = createProductAdapter(product('location'), {verifyEvidence: () => false});
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asi-oversight-'));
  t.after(() => fs.rm(stateDir, {recursive: true, force: true}));
  await initializeRoutingState(stateDir);
  const make = () => createGlobalDispatcher({stateDir, adapters: [a, b]});
  const r = await make().plan({atlas: input(a, f.evidence), location: input(b)});
  const atlas = r.products.find(p => p.product === a.id);
  assert.equal(atlas.nextAction, next); assert.equal(atlas.status, 'FAILED_LOCKED');
  assert.equal(atlas.candidates.length, 0); assert.equal(r.selected.product, 'location');
  assert.equal(r.selected.executable, false); assert.equal(r.selected.authority, null);
  const later = await make().plan({atlas: input(a), location: input(b)});
  assert.equal(later.selected, null); assert.equal(later.products[0].status, 'FAILED_LOCKED');
  const s = input(a); s.tasks[0].status = 'ACCEPTED'; s.tasks[0].nextAction = 'Forged completion';
  s.tasks[0].evidence = {product: a.id, contractHash: a.contractHash, repository: a.contract.repository,
    head: base, subject: 'task:first', criteria: ['first'], tests: 'PASS', review: 'PASS', ci: 'PASS',
    pr: {number: 71, head: base}, report: 'fixture:external-pass-does-not-replace-failure'};
  trusted.add(hash(s.tasks[0].evidence));
  const rewritten = await make().plan({atlas: s, location: input(b)});
  assert.equal(rewritten.products[0].reason, 'HISTORICAL_FAILED_REWRITE_FORBIDDEN');
  assert.equal(rewritten.selected, null);
  const saved = JSON.parse(await fs.readFile(path.join(stateDir, 'routing.json')));
  assert.equal(saved.state.products[0].terminal[0].status, 'FAILED_LOCKED');
});

test('malformed adapter output cannot poison the durable journal or block another product', async t => {
  for (const mutate of [r => { delete r.head; }, r => { r.stage = null; },
    r => { r.candidates[0].id = '../bad'; }, r => { r.candidates[0].paths = null; },
    r => { r.acceptedStages = ['g0', 'g0']; }, r => { r.acceptedStages = [1]; },
    r => { r.terminal = [{id: '../bad', status: 'PUBLISHED'}]; },
    r => { r.terminal = [{id: 'first', status: 'INVALID'}]; }]) {
    const a = createProductAdapter(product('atlas'), {verifyEvidence: () => false});
    const b = createProductAdapter(product('location'), {verifyEvidence: () => false});
    const broken = {...a, evaluate(s) { const r = a.evaluate(s); mutate(r); return r; }};
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asi-output-validation-'));
    t.after(() => fs.rm(stateDir, {recursive: true, force: true}));
    await initializeRoutingState(stateDir);
    const run = () => createGlobalDispatcher({stateDir, adapters: [broken, b]}).plan({atlas: input(a), location: input(b)});
    const first = await run(); assert.equal(first.products[0].reason, 'ADAPTER_RESULT_INVALID');
    assert.equal(first.selected.product, 'location');
    const second = await run(); assert.equal(second.products[0].reason, 'ADAPTER_RESULT_INVALID');
    assert.notEqual(second.reason, 'ROUTING_STATE_RECONCILIATION_REQUIRED');
    const saved = JSON.parse(await fs.readFile(path.join(stateDir, 'routing.json')));
    assert.deepEqual(saved.state.products[0].acceptedStages, []);
    assert.deepEqual(saved.state.products[0].terminal, []);
  }
});

test('journal limit measures serialized UTF-8 bytes and preserves the previous readable journal', async t => {
  const a = createProductAdapter(product('atlas'), {verifyEvidence: () => false});
  // Compact character count passes the former guard while UTF-8 bytes exceed
  // the on-disk reader limit. No external state or executable task is involved.
  const oversized = {...a, evaluate() { return {status: 'WAITING', candidates: [], terminal: [],
    acceptedStages: ['界'.repeat(350000)], nextAction: 'Wait'}; }};
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'asi-journal-limit-'));
  t.after(() => fs.rm(stateDir, {recursive: true, force: true}));
  await initializeRoutingState(stateDir);
  const before = await fs.readFile(path.join(stateDir, 'routing.json'));
  const r = await createGlobalDispatcher({stateDir, adapters: [oversized]}).plan({atlas: {}});
  assert.equal(r.status, 'FAILED_LOCKED'); assert.equal(r.selected, null);
  assert.deepEqual(await fs.readFile(path.join(stateDir, 'routing.json')), before);
});
