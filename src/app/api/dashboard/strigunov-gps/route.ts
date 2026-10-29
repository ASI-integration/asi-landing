import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import { getMissionControlDashboard } from '@/lib/mission-control/store';
import { verifiedG1Run } from '@/lib/strigunov-gps/proof';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPO = 'ASI-integration/asi-landing';
const BASE = 'https://api.github.com/repos/' + REPO;
const RELEASE_PATH = 'docs/agent-os/releases/strigunov4-demo.json';
// Include the current infrastructure and G2 integration PRs. Keep legacy G1 context.
const PR_NUMBERS = [529, 532, 533, 537, 549, 550, 552];
const STAGE_IDS = [1, 2, 3, 4, 5, 6].map(n => 'S4-G' + n);
type GitHubPR = { number: number; state: string; draft: boolean; merged: boolean; updated_at: string; head: { sha: string } };
type Workflow = { id: number; name: string; status: string; conclusion: string | null; head_sha: string; html_url: string };
type ReleaseStage = { id: string; title: string; status: string; proof: unknown[]; acceptance: string[]; acceptanceSha?: string };
let memo: { at: number; value: unknown } | null = null;

async function github<T>(url: string, token: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET', cache: 'no-store', signal: ctrl.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error('GitHub read failed: ' + res.status);
    return await res.json() as T;
  } finally { clearTimeout(timer); }
}
/** Only the existing owner-approved physical host workflow can unlock G1. */
async function verifyPhysicalG1(stage: ReleaseStage, token: string): Promise<boolean> {
  if (stage.id !== 'S4-G1' || stage.status !== 'ACCEPTED' || !stage.proof.length)
    return false;
  try {
    const verified = await Promise.all(stage.proof.map(async proof => {
      if (typeof proof !== 'string') return false;
      const match = /^https:\/\/github\.com\/ASI-integration\/asi-landing\/actions\/runs\/([1-9][0-9]*)$/.exec(proof);
      if (!match) return false;
      const uri = BASE + '/actions/runs/' + match[1];
      const [run, approvals, jobs] = await Promise.all([
        github<Parameters<typeof verifiedG1Run>[2]>(uri, token),
        github<Parameters<typeof verifiedG1Run>[3]>(uri + '/approvals', token),
        github<Parameters<typeof verifiedG1Run>[4]>(uri + '/jobs?per_page=100', token),
      ]);
      return verifiedG1Run(stage, proof, run, approvals, jobs);
    }));
    return verified.length > 0 && verified.every(Boolean);
  } catch { return false; }
}
const noStore = { 'cache-control': 'private, no-store, max-age=0', 'x-content-type-options': 'nosniff' };

export async function GET() {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;
  if (memo && Date.now() - memo.at < 20000)
    return NextResponse.json(memo.value, { headers: noStore });
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return NextResponse.json({ok: false, reason: 'Нет серверного доступа к GitHub'}, {status: 503, headers: noStore});
  try {
    // The canonical release file is mandatory, but an optional PR/issue outage
    // must not hide the whole map. Missing data always remains UNKNOWN.
    const [file, issue, prResults] = await Promise.all([
      github<{ content: string; encoding: string; sha: string }>(BASE + '/contents/' + RELEASE_PATH + '?ref=main', token),
      github<{ number: number; state: string; updated_at: string }>(BASE + '/issues/511', token).catch(() => null),
      Promise.all(PR_NUMBERS.map(n => github<GitHubPR>(BASE + '/pulls/' + n, token).catch(() => null))),
    ]);
    const partialPrData = prResults.some(p => p === null);
    const prList = prResults.filter((p): p is GitHubPR => p !== null);
    if (file.encoding !== 'base64') throw new Error('Unrecognized release encoding');
    const release = JSON.parse(Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8')) as {
      schemaVersion: string; releaseId: string; stages: ReleaseStage[];
    };
    if (release.schemaVersion !== 'asi.demo-release.v1' ||
        release.releaseId !== 'STRIGUNOV4-READY-FOR-DEMO' ||
        !Array.isArray(release.stages) ||
        release.stages.length !== 6 ||
        release.stages.some((s, i) => s.id !== STAGE_IDS[i] ||
          !['IN_PROGRESS', 'NOT_STARTED', 'BLOCKED', 'ACCEPTED'].includes(s.status) ||
          !Array.isArray(s.acceptance) || !Array.isArray(s.proof)))
      throw new Error('Invalid canonical release');
    const prs = await Promise.all(prList.map(async p => {
      if (typeof p.head?.sha !== 'string' || !/^[0-9a-f]{40}$/.test(p.head.sha))
        throw new Error('Invalid PR head');
      let ciAvailable = false;
      let ci: Array<{id: number; name: string; conclusion: string | null; url: string}> = [];
      try {
        const result = await github<{ workflow_runs: Workflow[] }>(
          BASE + '/actions/runs?head_sha=' + p.head.sha + '&event=pull_request&per_page=100', token);
        if (!Array.isArray(result.workflow_runs)) throw new Error('Invalid workflows');
        ci = result.workflow_runs.filter(run =>
          run.head_sha === p.head.sha &&
          run.status === 'completed' &&
          /PR Validation|Strigunov 4 multi-job|Strigunov4 backup/i.test(run.name)
        ).map(run => ({id: run.id, name: run.name, conclusion: run.conclusion, url: run.html_url}));
        ciAvailable = true;
      } catch { /* Unknown CI is never PASS. */ }
      return {
        number: p.number, state: p.state, draft: p.draft, merged: p.merged,
        head: p.head.sha, updatedAt: p.updated_at, ci, ciAvailable,
        url: 'https://github.com/' + REPO + '/pull/' + p.number,
      };
    }));
    const telemetry = await getMissionControlDashboard().then(rows => {
      const row = rows.find(x => x.projectId === 'asi');
      return row ? {
        available: !row.stale, stale: row.stale,
        status: row.stale ? 'UNKNOWN' : row.status,
        stage: row.stale ? null : row.stage,
        updatedAt: row.updatedAt,
        physicalProof: false,
      } : {available: false, stale: true, status: 'UNKNOWN', stage: null, updatedAt: null, physicalProof: false};
    }, () => ({available: false, stale: true, status: 'UNKNOWN', stage: null, updatedAt: null, physicalProof: false}));
    const g1Accepted = await verifyPhysicalG1(release.stages[0], token);
    const payload = {
      ok: true, observedAt: new Date().toISOString(), mapSha: file.sha,
      partialSources: partialPrData || issue === null || prs.some(p => !p.ciAvailable),
      mapUrl: 'https://github.com/' + REPO + '/blob/main/' + RELEASE_PATH,
      issue: {number: 511, state: issue?.state ?? 'UNKNOWN', updatedAt: issue?.updated_at ?? null,
        url: 'https://github.com/' + REPO + '/issues/511'},
      stages: release.stages.map(s => ({
        id: s.id, title: s.title, status: s.status, proofCount: s.proof.length,
        acceptance: s.acceptance,
      })),
      prs, telemetry,
      // Only the protected, owner-approved, exact-SHA run can unlock G1.
      // Other stages require separate, reviewed proof validators.
      serverEvidence: {
        available: g1Accepted,
        verifiedStages: g1Accepted ? ['S4-G1'] : [] as string[],
        reason: g1Accepted
          ? 'Подтверждён защищённый физический запуск и приёмка S4-G1.'
          : 'Физическая приёмка пока не доказана. GitHub PR/CI и Mission Control её не заменяют.',
      },
    };
    memo = { at: Date.now(), value: payload };
    return NextResponse.json(payload, {headers: noStore});
  } catch {
    return NextResponse.json({ok: false, reason: 'Не удалось подтвердить данные GitHub.'},
      {status: 503, headers: noStore});
  }
}
