import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const ts = require(require.resolve('typescript', { paths: [root, 'C:/asi-landing'] }));
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const sha = 'a'.repeat(40);
const jobs = ['Runtime security and staging bridge (ubuntu-latest)', 'Runtime security and staging bridge (windows-latest)', 'Windows artifact and mock-control acceptance'];
function compile(file, imports, globals = {}) {
  const code = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => { assert.ok(id in imports, 'unreviewed import ' + id); return imports[id]; }, ...globals }, { timeout: 1000 });
  return exports;
}
function harness({ token = 'synthetic-not-a-secret', fail = false, oldSha = false, conclusion = 'success' } = {}) {
  let calls = 0;
  const roadmap = compile('src/lib/engine-progress/roadmap.ts', {});
  const api = compile('src/lib/engine-progress/server.ts', {
    'server-only': {},
    '@/lib/mission-control/store': { getMissionControlDashboard: async () => [] },
    './roadmap': roadmap,
  }, {
    process: { env: { GITHUB_TOKEN: token } }, Date, AbortController, setTimeout, clearTimeout,
    fetch: async url => {
      calls++;
      if (fail) throw Error('synthetic failure');
      const data = url.includes('/pulls/') ? { state: 'open', head: { sha, repo: { full_name: 'ASI-integration/asi-os-runtime' } } }
        : url.includes('/jobs?') ? { jobs: jobs.map(name => ({ name, status: 'completed', conclusion })) }
        : { workflow_runs: [{ id: 42, name: 'CI', event: 'pull_request', head_sha: oldSha ? 'b'.repeat(40) : sha, updated_at: '2026-10-11T06:00:00Z' }] };
      return { ok: true, json: async () => data };
    },
  });
  return { api, calls: () => calls };
}
test('only exact-head GitHub steps can become PASS; dated plan stays unknown', async () => {
  const h = harness(), s = await h.api.getEngineProgressSnapshot();
  assert.equal(s.steps.filter(x => x.status === 'done').length, 4);
  assert.ok(s.steps.filter(x => x.source === 'snapshot').every(x => x.status === 'unknown'));
  assert.equal(s.ci.sourceEventAt, '2026-10-11T06:00:00Z');
  assert.equal(s.ci.runUrl, 'https://github.com/ASI-integration/asi-os-runtime/actions/runs/42');
  assert.ok(!JSON.stringify(s).includes('synthetic-not-a-secret'));
});
test('old SHA cannot supply successful CI', async () => {
  const s = await harness({ oldSha: true }).api.getEngineProgressSnapshot();
  assert.ok(s.steps.every(x => x.status !== 'done'));
});
test('missing credential performs no GitHub request', async () => {
  const h = harness({ token: '' }), s = await h.api.getEngineProgressSnapshot();
  assert.equal(h.calls(), 0); assert.equal(s.ci.available, false);
});
test('failed source remains unknown and negative cache bounds polling', async () => {
  const h = harness({ fail: true });
  const values = await Promise.all(Array.from({ length: 12 }, () => h.api.getEngineCi()));
  assert.equal(h.calls(), 1); assert.ok(values.every(x => !x.available));
  await h.api.getEngineCi(); assert.equal(h.calls(), 1);
});
test('concurrent successful polls share one read sequence', async () => {
  const h = harness(); await Promise.all(Array.from({ length: 12 }, () => h.api.getEngineCi()));
  assert.equal(h.calls(), 3);
});
test('failed CI produces BLOCK, never live authorization', async () => {
  const s = await harness({ conclusion: 'failure' }).api.getEngineProgressSnapshot();
  assert.equal(s.steps.find(x => x.id === '2.4').status, 'blocked');
  assert.ok(s.steps.filter(x => x.milestoneId >= 4).every(x => x.status === 'unknown'));
});
test('owner API preserves 401/403 before reading source and private cache on success', async () => {
  for (const status of [401, 403, 200]) {
    let reads = 0;
    const auth = status === 200 ? { session: {} } : { error: { status } };
    const route = compile('src/app/api/dashboard/engine-progress/route.ts', {
      'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
      '@/lib/development/api-auth': { requireDevelopmentOwnerSession: async () => auth },
      '@/lib/engine-progress/server': { getEngineProgressSnapshot: async () => { reads++; return {}; } },
    });
    const out = await route.GET();
    assert.equal(reads, status === 200 ? 1 : 0);
    if (status !== 200) assert.equal(out.status, status);
    else assert.match(out.headers['cache-control'], /private, no-store/);
  }
});
test('Russian owner view names all five projects and clears obsolete PASS on failed refresh', () => {
  const s = source('src/app/dashboard/engine-progress/EngineProgressClient.tsx');
  for (const title of ['Диспетчер', 'Движок', 'Booking Ops', 'Ким', 'Орис']) assert.ok(s.includes(title));
  assert.match(s, /catch\s*\{\s*setSnapshot\(null\)/);
  assert.ok(s.includes('sourceEventAt')); assert.ok(s.includes('Источник не подключён'));
  assert.match(s, /POLL_MS = 15000/);
  const diagnostics = ts.transpileModule(s, { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX } }).diagnostics || [];
  assert.equal(diagnostics.filter(x => x.category === ts.DiagnosticCategory.Error).length, 0);
});

test('owner cards render source provenance and NOT_RUN projects using actual React renderer', async () => {
  const react = require(require.resolve('react', { paths: [root, 'C:/asi-landing'] }));
  const jsx = require(require.resolve('react/jsx-runtime', { paths: [root, 'C:/asi-landing'] }));
  const renderer = require(require.resolve('react-dom/server', { paths: [root, 'C:/asi-landing'] }));
  const snapshot = { ok: true, ...await harness().api.getEngineProgressSnapshot() };
  let stateIndex = 0;
  const states = [snapshot, false, false, null, 'all'];
  const Component = compile('src/app/dashboard/engine-progress/EngineProgressClient.tsx', {
    'react/jsx-runtime': jsx,
    react: { ...react, useState: () => [states[stateIndex++], () => {}], useEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn },
    'next/link': { default: ({ children, ...props }) => react.createElement('a', props, children) },
  }).default;
  const html = renderer.renderToStaticMarkup(react.createElement(Component));
  for (const title of ['Диспетчер', 'Движок', 'Booking Ops', 'Ким', 'Орис']) assert.ok(html.includes(title));
  assert.ok(html.includes('NOT_RUN')); assert.ok(html.includes('Последнее событие'));
  assert.ok(html.includes('https://github.com/ASI-integration/asi-os-runtime/actions/runs/42'));
  assert.ok(!html.includes('synthetic-not-a-secret'));
});
