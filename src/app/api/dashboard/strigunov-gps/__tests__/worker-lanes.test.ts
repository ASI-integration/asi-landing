import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const requireDevelopmentOwnerSession = vi.fn();
const getMissionControlDashboard = vi.fn();
const verifiedG1Run = vi.fn();

vi.mock('@/lib/development/api-auth', () => ({requireDevelopmentOwnerSession}));
vi.mock('@/lib/mission-control/store', () => ({getMissionControlDashboard}));
vi.mock('@/lib/strigunov-gps/proof', () => ({verifiedG1Run}));

const originalToken = process.env.GITHUB_TOKEN;
const stages = Array.from({length: 6}, (_, i) => ({
  id: 'S4-G' + (i + 1), title: 'Stage ' + (i + 1),
  status: i === 0 ? 'ACCEPTED' : i === 1 ? 'IN_PROGRESS' : 'NOT_STARTED',
  acceptance: [], proof: [],
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  requireDevelopmentOwnerSession.mockReset();
  getMissionControlDashboard.mockReset().mockResolvedValue([]);
  verifiedG1Run.mockReset();
  process.env.GITHUB_TOKEN = 'inert-test-token';
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
});

function fixtureGitHubFetch(atomicMissing = false) {
  const reply = (data: unknown, status = 200) => Promise.resolve(new Response(
    JSON.stringify(data), {status, headers: {'content-type':'application/json'}}));
  return vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/contents/docs/agent-os/releases/strigunov4-demo.json')) {
      return reply({
        sha: 'a'.repeat(40), encoding: 'base64',
        content: Buffer.from(JSON.stringify({
          schemaVersion:'asi.demo-release.v1',
          releaseId:'STRIGUNOV4-READY-FOR-DEMO', stages,
        })).toString('base64'),
      });
    }
    if (url.endsWith('/issues/511')) return reply({number:511, state:'open', updated_at:'2026-10-29T10:00:00Z'});
    if (/\/pulls\/\d+$/.test(url)) {
      const n = Number(url.match(/\/pulls\/(\d+)$/)?.[1]);
      return reply({number:n,state:'open',draft:true,merged:false,
        updated_at:'2026-10-29T10:00:00Z',head:{sha:String(n).padStart(40,'a')}});
    }
    if (url.includes('/actions/runs?')) return reply({workflow_runs:[]});
    if (url.includes('/commits/asi%2Fp0-atomic-budget') && atomicMissing)
      return reply({message:'not found'},404);
    if (url.includes('/commits/asi%2Fp0-')) return reply({
      sha:'c'.repeat(40), commit:{committer:{date:'2026-10-29T09:30:00Z'}},
    });
    throw new Error('Unexpected fixture URL: ' + url);
  });
}

describe('owner-only GPS and five ASI workstreams', () => {
  it('denies unauthenticated users before any GitHub requests', async () => {
    const fetcher = fixtureGitHubFetch();
    vi.stubGlobal('fetch', fetcher);
    requireDevelopmentOwnerSession.mockResolvedValue({
      error: NextResponse.json({ok:false},{status:401}),
    });
    const {GET} = await import('../route');
    expect((await GET()).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports five distinct source lanes, never invents live 24/7 agent status', async () => {
    const fetcher = fixtureGitHubFetch();
    vi.stubGlobal('fetch', fetcher);
    requireDevelopmentOwnerSession.mockResolvedValue({session:{userId:'owner'}});
    const {GET} = await import('../route');
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.workerLanes.map((lane: {id: string})=>lane.id)).toEqual([
      'engine', 'ru-auth','p0-lead','trusted-evidence','atomic-budget',
    ]);
    expect(body.workerLanes.every((lane: {runVerified: boolean})=>lane.runVerified===false)).toBe(true);
    expect(body.workerLanes[3].lastCodeAt).toBe('2026-10-29T09:30:00Z');
    expect(body.workerLanes[0].lastCodeAt).toBeNull();
    expect(body.workerLanes[0].lastPrUpdateAt).toBe('2026-10-29T10:00:00Z');
    expect(body.stages[0].status).toBe('ACCEPTED');
    expect(body.serverEvidence.available).toBe(false);
    expect(fetcher).toHaveBeenCalled();
  });

  it('shows missing independent worker as UNKNOWN, not FAILED or RUNNING', async () => {
    vi.stubGlobal('fetch', fixtureGitHubFetch(true));
    requireDevelopmentOwnerSession.mockResolvedValue({session:{userId:'owner'}});
    const {GET} = await import('../route');
    const body = await (await GET()).json();
    expect(body.workerLanes[4]).toMatchObject({
      id:'atomic-budget',state:'UNKNOWN',head:null,runVerified:false,
    });
    expect(body.partialSources).toBe(true);
  });

  it('uses bounded public-repo GitHub reads without bearer token', async () => {
    delete process.env.GITHUB_TOKEN;
    const fetcher=fixtureGitHubFetch();
    vi.stubGlobal('fetch',fetcher);
    requireDevelopmentOwnerSession.mockResolvedValue({session:{userId:'owner'}});
    const {GET} = await import('../route');
    const response=await GET();
    const body=await response.json();
    expect(response.status).toBe(200);
    expect(body.githubMode).toBe('public-read-only');
    expect(body.githubRefreshSeconds).toBe(1800);
    expect(body.workerLanes).toHaveLength(5);
    for (const [, init] of fetcher.mock.calls) {
      const headers=(init as RequestInit).headers as Record<string,string>;
      expect(headers).not.toHaveProperty('Authorization');
      expect((init as RequestInit & {next?: {revalidate:number}}).next?.revalidate).toBe(1800);
    }
  });
});
