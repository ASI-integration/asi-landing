import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PilotRouteView } from '@/app/dashboard/engine-progress/StrigunovProgress';

vi.mock('server-only', () => ({}));
const A = 'a'.repeat(40), B = 'b'.repeat(40), MAIN = 'c'.repeat(40);
const token = 'server-token-never-in-browser';
const check = (id: number, name = 'validate', conclusion = 'success') => ({ id, name,
  head_sha: A, status: 'completed', conclusion, app: { id: 15368 } });
const map = () => ({ releaseId: 'STRIGUNOV4-READY-FOR-DEMO', stages: Array.from({ length: 6 }, (_, i) =>
  ({ id: `S4-G${i + 1}`, status: i ? 'NOT_STARTED' : 'IN_PROGRESS' })) });
let checks: ReturnType<typeof check>[], count: number, reviewDescription: string;
let creator: number, move: boolean, fail: boolean, mainMap: boolean, invalidMap: boolean;
let protectedBranch: boolean;
let reads: Record<string, number>;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  expect(init?.method).toBe('GET');
  expect(url.startsWith('https://api.github.com/repos/ASI-integration/asi-landing/')).toBe(true);
  expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
  if (fail) throw new Error(token);
  let data: unknown;
  let status = 200;
  if (url.endsWith('branches/main')) data = { commit: { sha: MAIN }, protected: protectedBranch,
    protection: { required_status_checks: { checks: [{ context: 'validate', app_id: 15368 }] } } };
  else if (/pulls\/(510|517)$/.test(url)) {
    const number = Number(url.split('/').pop()); reads[number] = (reads[number] ?? 0) + 1;
    data = { number, state: 'open', merged: false, head: { sha: move && reads[number] > 1 ? B : A,
      repo: { full_name: 'ASI-integration/asi-landing' } } };
  } else if (url.includes('/check-runs?')) {
    const page = Number(new URL(url).searchParams.get('page'));
    data = { total_count: count, check_runs: checks.slice((page - 1) * 100, page * 100) };
  } else if (url.includes('/statuses?')) data = [
    { id: 20, context: 'CodeRabbit', state: 'success', description: reviewDescription, creator: { id: creator } },
    { id: 10, context: 'CodeRabbit', state: 'success', description: 'Review completed', creator: { id: creator } },
  ];
  else if (url.includes('/contents/')) {
    if (!mainMap && url.endsWith(MAIN)) { status = 404; data = {}; }
    else {
      const value = map();
      if (invalidMap) value.stages[0].status = 'ACCEPTED';
      data = { encoding: 'base64', content: Buffer.from(JSON.stringify(value)).toString('base64') };
    }
  } else throw new Error('Unexpected path');
  return { ok: status === 200, status, json: async () => data };
});
beforeEach(() => {
  vi.resetModules(); vi.stubEnv('GITHUB_TOKEN', token); vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear(); checks = [check(1), check(2, 'channel-manager-recovery-postgres')];
  count = 2; reviewDescription = 'Review completed'; creator = 136622811;
  move = fail = mainMap = invalidMap = false; protectedBranch = true; reads = {};
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
async function snapshot() { return (await import('../strigunov-server')).getStrigunovProgress(); }

it('reads both exact heads, required checks and candidate map; returns no token', async () => {
  const s = await snapshot();
  expect(s.available).toBe(true); expect(s.route?.source).toBe('candidate'); expect(s.route?.sha).toBe(A);
  expect(s.prs.map(p => p.head)).toEqual([A, A]); expect(s.prs[0].review).toBe('success');
  expect(s.prs[0].checks.map(c => c.required)).toEqual([true, false]);
  expect(JSON.stringify(s)).not.toContain(token);
});
it.each(['failure', 'cancelled'])('newest %s overrides old PASS', async result => {
  checks.push(check(3, 'validate', result)); count++;
  expect((await snapshot()).prs[0].checks[0].state).toBe('failed');
});
it('new pending run is not old PASS', async () => {
  checks.push({ ...check(3), status: 'in_progress' }); count++;
  expect((await snapshot()).prs[0].checks[0].state).toBe('pending');
});
it('a failing check on page two overrides page-one success', async () => {
  checks = Array.from({ length: 100 }, (_, i) => check(i + 1)); checks.push(check(101, 'validate', 'failure')); count = 101;
  expect((await snapshot()).prs[0].checks[0].state).toBe('failed');
  expect(fetchMock.mock.calls.some(([u]) => u.includes('check-runs') && u.endsWith('page=2'))).toBe(true);
});
it('incomplete pages fail closed', async () => {
  count = 101; const s = await snapshot(); expect(s.prs[0].available).toBe(false); expect(s.prs[0].checks).toEqual([]);
});
it('wrong head or duplicate IDs cannot pass', async () => {
  checks[1] = { ...checks[0], head_sha: B };
  expect((await snapshot()).prs[0].available).toBe(false);
});
it('a newer skipped review never inherits an old completed review', async () => {
  reviewDescription = 'Review skipped'; expect((await snapshot()).prs[0].review).toBe('skipped');
});
it('a forged CodeRabbit status from another creator is not a review', async () => {
  creator = 1; expect((await snapshot()).prs[0].review).toBe('missing');
});
it('moving PR head invalidates the entire PR observation', async () => {
  move = true; const s = await snapshot(); expect(s.prs[0].available).toBe(false); expect(s.prs[0].head).toBeNull();
});
it('no token makes no network calls', async () => {
  vi.stubEnv('GITHUB_TOKEN', ''); expect((await snapshot()).available).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
});
it('errors never leak token or preserve an old PASS after cache expiry', async () => {
  vi.useFakeTimers(); const first = await snapshot(); expect(first.available).toBe(true);
  vi.advanceTimersByTime(20001); fail = true;
  const second = await snapshot(); expect(second.available).toBe(false); expect(second.prs[0].head).toBeNull();
  expect(JSON.stringify(second)).not.toContain(token);
});
it('coalesces concurrent reads and bounds the polling cache', async () => {
  const [a, b] = await Promise.all([snapshot(), snapshot()]); expect(a).toEqual(b);
  const calls = fetchMock.mock.calls.length; await snapshot(); expect(fetchMock).toHaveBeenCalledTimes(calls);
});
it('unprotected or unavailable required-check policy is visibly unknown', async () => {
  protectedBranch = false; const s = await snapshot(); expect(s.requiredKnown).toBe(false); expect(s.available).toBe(false);
});
it('uses main map when present, but candidate ACCEPTED cannot advance the route', async () => {
  invalidMap = true; expect((await snapshot()).route).toBeNull();
  vi.resetModules(); mainMap = true; const s = await snapshot(); expect(s.route?.source).toBe('main');
});
it('renders the curve, six stages, exact heads and honest remaining count', async () => {
  const s = await snapshot();
  const html = renderToStaticMarkup(<PilotRouteView snapshot={s} />);
  for (const text of ['S4-G1', 'S4-G6', 'Мы здесь', 'из 6 этапов', 'не процент готовности', A, 'PR #510', 'PR #517']) expect(html).toContain(text);
  expect(html).toContain('<svg'); expect(html).not.toContain('aria-valuenow'); expect(html).not.toContain(token);
});
