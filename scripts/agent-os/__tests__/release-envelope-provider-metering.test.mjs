import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readAuthenticatedProviderSnapshot as readProvider} from '../check-demo-release.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function fixture({paginate = false} = {}) {
  const repository = 'ASI-integration/asi-landing';
  const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40);
  const now = Date.parse('2026-10-29T11:00:00Z');
  const expected = {repository, number:552, baseSha, headSha, independentReviewerId:20261029};
  const pr = {number:552, state:'open', user:{id:207600140},
    base:{ref:'main', sha:baseSha, repo:{full_name:repository}},
    head:{sha:headSha, repo:{full_name:repository}}};
  const runs = [
    {id:1, workflow_id:311380800, event:'pull_request', head_sha:headSha},
    {id:2, workflow_id:390653294, event:'pull_request_target', head_sha:baseSha},
  ].map(run => ({...run, run_attempt:1, status:'completed', conclusion:'success',
    repository:{full_name:repository}, updated_at:new Date(now - 1000).toISOString(),
    pull_requests:[{number:552, base:{sha:baseSha}, head:{sha:headSha}}]}));
  const review = {id:1, state:'APPROVED', commit_id:headSha,
    user:{id:expected.independentReviewerId}, submitted_at:new Date(now - 500).toISOString()};
  const calls = [], events = [];
  const input = {token:'offline-secret-fixture', expected, clock:() => now,
    fetchImpl:async (url, options) => {
      const u = new URL(url), route = u.pathname.split(repository + '/')[1] + u.search;
      calls.push({url, options}); events.push(['fetch', route]);
      let body = pr;
      if (u.pathname.endsWith('/reviews')) body = paginate
        ? u.searchParams.get('page') === '1'
          ? Array.from({length:100}, (_, i) => ({...review, id:i + 1})) : []
        : [review];
      else if (u.pathname.includes('/workflows/')) {
        const workflow_runs = runs.filter(run => run.workflow_id === Number(u.pathname.split('/').at(-2)));
        body = {total_count:workflow_runs.length, workflow_runs};
      }
      return new Response(JSON.stringify(body), {headers:{'Content-Type':'application/json'}});
    }};
  return {input, calls, events, now};
}

test('every authenticated GET, review page and PR recheck is reserved before exact wire dispatch', async () => {
  const f = fixture({paginate:true});
  f.input.beforeRequest = async descriptor => {
    assert(Object.isFrozen(descriptor));
    assert.deepEqual(Object.keys(descriptor).sort(), ['method','payloadSha256','requestSha256','route','signal']);
    assert.equal(descriptor.method, 'GET');
    assert.equal(descriptor.payloadSha256, hash(''));
    assert.equal(descriptor.requestSha256, hash(JSON.stringify({
      method:'GET', route:descriptor.route, payloadSha256:hash(''),
    })));
    assert(!JSON.stringify(descriptor).includes(f.input.token));
    assert(!descriptor.signal.aborted);
    f.events.push(['reserved', descriptor.route]);
    return true;
  };
  const result = await readProvider(f.input);
  assert.equal(result.status, 'PROVIDER_EVIDENCE_VERIFIED');
  assert.equal(result.authorized, false);
  assert.equal(result.receipt.requests, 6);
  for (let i = 0; i < f.events.length; i += 2) {
    assert.equal(f.events[i][0], 'reserved');
    assert.deepEqual(f.events[i + 1], ['fetch', f.events[i][1]]);
  }
  assert.equal(f.calls[0].url, f.calls.at(-1).url);
  assert(f.calls.every(({options}) => options.headers.Authorization === 'Bearer offline-secret-fixture'));
});

test('false, missing, proposal and reservation results cannot authorize a provider request', async () => {
  for (const value of [false, undefined, null, 1, {authorized:true}, {status:'PROPOSAL_ELIGIBLE'}, {status:'RESERVED'}]) {
    const f = fixture(); f.input.beforeRequest = async () => value;
    assert.deepEqual(await readProvider(f.input), {
      status:'BLOCKED', reason:'PROVIDER_READER_GUARD_DENIED', authorized:false,
    });
    assert.equal(f.calls.length, 0);
  }
});

test('throwing guards and invalid hook types fail closed without disclosure or retries', async () => {
  const f = fixture(); f.input.beforeRequest = async () => {throw new Error(f.input.token);};
  const result = await readProvider(f.input);
  assert.equal(result.reason, 'PROVIDER_READER_UNAVAILABLE');
  assert(!JSON.stringify(result).includes(f.input.token)); assert.equal(f.calls.length, 0);
  const g = fixture(); g.input.beforeRequest = {};
  assert.equal((await readProvider(g.input)).reason, 'PROVIDER_READER_CONTEXT');
  assert.equal(g.calls.length, 0);
});

test('denial on a later GET preserves completed reads and never fetches or retries denied request', async () => {
  const f = fixture(); let reservations = 0;
  f.input.beforeRequest = async () => ++reservations < 3;
  assert.equal((await readProvider(f.input)).reason, 'PROVIDER_READER_GUARD_DENIED');
  assert.equal(reservations, 3); assert.equal(f.calls.length, 2);
});

test('reservation clock exhaustion or rollback denies dispatch after the await', async () => {
  for (const advance of [30000, -1, NaN]) {
    const f = fixture(); let now = f.now;
    f.input.clock = () => now;
    f.input.beforeRequest = async () => {now += advance; return true;};
    assert.equal((await readProvider(f.input)).reason, 'PROVIDER_READER_BUDGET');
    assert.equal(f.calls.length, 0);
  }
});

test('real deadline settles an abort-ignoring guard and its late success cannot fetch', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = fixture(); let release, signal;
  f.input.beforeRequest = descriptor => {
    signal = descriptor.signal;
    return new Promise(resolve => {release = resolve;});
  };
  const pending = readProvider(f.input);
  t.mock.timers.tick(5001);
  assert.equal((await pending).reason, 'PROVIDER_READER_TIMEOUT');
  assert.equal(signal.aborted, true); assert.equal(f.calls.length, 0);
  release(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.calls.length, 0);
});

test('abort-ignoring fetch cannot produce accepted evidence or later requests after its deadline', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = fixture(); let release, requests = 0;
  f.input.beforeRequest = async () => true;
  f.input.fetchImpl = () => {requests++; return new Promise(resolve => {release = resolve;});};
  const pending = readProvider(f.input);
  await Promise.resolve();
  assert.equal(requests, 1);
  t.mock.timers.tick(5001);
  assert.equal((await pending).reason, 'PROVIDER_READER_TIMEOUT');
  release(new Response('{}', {headers:{'Content-Type':'application/json'}}));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(requests, 1);
});

test('caller target and token changes during guard do not retarget authenticated GETs', async () => {
  const f = fixture();
  f.input.beforeRequest = async () => {
    Object.assign(f.input.expected, {repository:'attacker/repo', number:999, headSha:'c'.repeat(40)});
    f.input.token = 'replacement'; return true;
  };
  const result = await readProvider(f.input);
  assert.equal(result.status, 'PROVIDER_EVIDENCE_VERIFIED');
  assert.equal(result.receipt.number, 552);
  assert(f.calls.every(({url, options}) => !url.includes('attacker') && !url.includes('999') &&
    options.headers.Authorization === 'Bearer offline-secret-fixture'));
});


test('expected provider pins reject getters, inherited fields and coercible values before guard or network', async () => {
  let getters = 0;
  for (const make of [
    expected => ({...expected, get number() {getters++; return getters === 1 ? 552 : 999;}}),
    expected => Object.create(expected),
    expected => ({...expected, headSha:new String(expected.headSha)}),
    expected => ({...expected, baseSha:{toString() {getters++; return expected.baseSha;}}}),
    expected => ({...expected, number:new Number(expected.number)}),
    expected => ({...expected, extra:true}),
  ]) {
    const f = fixture(); let guarded = 0;
    f.input.expected = make(f.input.expected);
    f.input.beforeRequest = async () => {guarded++; return true;};
    assert.equal((await readProvider(f.input)).reason, 'PROVIDER_READER_CONTEXT');
    assert.equal(guarded, 0); assert.equal(f.calls.length, 0);
  }
  assert.equal(getters, 0);
});
