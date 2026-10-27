import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('./fixtures/gis-542.tsx.source', import.meta.url), 'utf8');
const start = source.indexOf('  useEffect(() => {', source.indexOf('// GIS requires'));
const end = source.indexOf('\n  const demoMailto', start);
assert.ok(start > 0 && end > start);
const effect = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function harness(options = {}) {
  const calls = { posts: [], redirects: [], errors: [], renders: 0, clears: 0 };
  let callback, cleanup;
  const host = { replaceChildren() { calls.clears++; } };
  const ctx = {
    googleReady: true, googleOAuthMode: 'gis', googleClientId: 'mock-client',
    mode: 'login', rental: false, selectedPlanValue: 'small', afterAuthRedirect: '/dashboard',
    debugGoogle: false, isMountedRef: { current: true }, gsiButtonHostRef: { current: host },
    setGoogleStatus() {}, setLoading() {}, setError: v => calls.errors.push(v),
    loadGoogleIdentityServices: async () => {},
    readResponseJson: async r => r.json(),
    fetch: async (url, init) => { calls.posts.push({url, init}); return {ok:true,json:async()=>({})}; },
    router: { push: v => calls.redirects.push(v) },
    window: { google: { accounts: { id: {
      initialize(v) { callback = v.callback; },
      renderButton(h) { assert.equal(h,host); calls.renders++; },
    } } } },
    useEffect(fn) { cleanup=fn(); },
    ...options,
  };
  vm.runInNewContext(effect,ctx);
  await tick();
  return { calls, ctx, callback: v => callback(v), cleanup: () => cleanup?.() };
}
test('visible host; no synthetic iframe click/prompt', () => {
  assert.match(source,/data-testid="google-gis-visible-button"/);
  assert.doesNotMatch(source,/clickable\.click|top: '-9999px'|\.prompt\(/);
});
test('mount renders GIS; never posts without callback',async()=>{
  const h=await harness(); assert.equal(h.calls.renders,1);assert.equal(h.calls.posts.length,0);
});
test('mock credential callback posts to existing server and redirects',async()=>{
  const h=await harness();await h.callback({credential:'mock-only'});
  assert.equal(h.calls.posts[0].url,'/api/auth/google');
  assert.equal(h.calls.posts[0].init.method,'POST');
  assert.equal(JSON.parse(h.calls.posts[0].init.body).idToken,'mock-only');
  assert.deepEqual(h.calls.redirects,['/dashboard']);
});
test('missing credential never posts',async()=>{
  const h=await harness();await h.callback({});assert.equal(h.calls.posts.length,0);assert.ok(h.calls.errors.length);
});
test('server error does not navigate',async()=>{
  const h=await harness({fetch:async()=>({ok:false,json:async()=>({error:'mock denied'})})});
  await h.callback({credential:'mock-only'});assert.equal(h.calls.redirects.length,0);
});
test('loader failure preserves an error rather than synthetic fallback',async()=>{
  const h=await harness({loadGoogleIdentityServices:async()=>{throw Error('mock')}});
  assert.equal(h.calls.renders,0);assert.ok(h.calls.errors.length);
});
test('cleanup ignores callbacks and clears rendered host',async()=>{
  const h=await harness();h.cleanup();await h.callback({credential:'mock-only'});
  assert.equal(h.calls.posts.length,0);assert.equal(h.calls.clears,2);
});
test('remount has a fresh callback; prior callback stays cancelled',async()=>{
  const old=await harness();old.cleanup();const current=await harness();
  await old.callback({credential:'mock-only'});await current.callback({credential:'mock-only'});
  assert.equal(old.calls.posts.length,0);assert.equal(current.calls.posts.length,1);
});
test('redirect mode does not initialize GIS and retains server OAuth route',async()=>{
  const h=await harness({googleOAuthMode:'redirect'});assert.equal(h.calls.renders,0);
  assert.match(source,/window.location.assign\(url\)/);assert.match(source,/\/api\/auth\/google\/start\?/);
});
test('documented #542 defect: in-flight callback navigates after cleanup',async()=>{
  let resolve;
  const h=await harness({fetch:()=>new Promise(r=>{resolve=r})});
  const pending=h.callback({credential:'mock-only'});h.cleanup();
  resolve({ok:true,json:async()=>({})});await pending;
  // Reproduction, NOT acceptance: #542 lacks a post-await cancellation guard.
  assert.deepEqual(h.calls.redirects,['/dashboard']);
});
