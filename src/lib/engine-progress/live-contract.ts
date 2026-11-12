/** Strict, read-only parsing of ASI Engine's owner GitHub status receipts.
 * Never treat a process RUNNING as verified work, or a reported CI as accepted CI. */
export type AsIWorker = {
  slot: number;
  taskId: string;
  state: string;
};

export type AsIStatusReport = {
  version: 'ASI_V13_20261112';
  workers: AsIWorker[];
  modelReservations: number;
  modelLimit: number;
  githubReservations: number;
  githubLimit: number;
  prLinks: { taskId: string; number: number; url: string }[];
};

const REPORT_TITLE = '## ASI V13 — Strigunov G2 source campaign';
const PR_BASE = 'https://github.com/ASI-integration/asi-landing/pull/';

/** Return null rather than produce misleading status from malformed or foreign comments. */
export function parseAsIStatusReport(body: unknown): AsIStatusReport | null {
  if (typeof body !== 'string' || body.length > 60_000 || !body.includes(REPORT_TITLE)) return null;
  if (!/^Version:\s*ASI_V13_20261112\s*$/m.test(body)) return null;

  const workers = [...body.matchAll(/^\|\s*([1-5])\s*\|\s*(asi-v13-[a-z0-9-]+)\s*\|\s*([A-Z][A-Z0-9_]*)\s*\|$/gm)]
    .map(m => ({ slot: Number(m[1]), taskId: m[2], state: m[3] }));
  if (workers.length !== 5 || new Set(workers.map(w => w.slot)).size !== 5 ||
      new Set(workers.map(w => w.taskId)).size !== 5) return null;

  const models = /^Model reservations:\s*([0-9]+)\/([0-9]+)\s*$/m.exec(body);
  const github = /^GitHub reservations:\s*([0-9]+)\/([0-9]+)\s*$/m.exec(body);
  if (!models || !github) return null;
  const [modelReservations, modelLimit, githubReservations, githubLimit] =
    [models[1], models[2], github[1], github[2]].map(Number);
  if (!(modelLimit > 0 && modelLimit <= 1000 && githubLimit > 0 && githubLimit <= 1000) ||
      modelReservations > modelLimit || githubReservations > githubLimit) return null;

  const prLinks: AsIStatusReport['prLinks'] = [];
  const linkLines = body.split('Published PRs:')[1] ?? '';
  for (const match of linkLines.matchAll(/^-\s*(asi-v13-[a-z0-9-]+):\s*(https:\/\/github\.com\/ASI-integration\/asi-landing\/pull\/([1-9][0-9]*))\s*$/gm)) {
    if (workers.some(w => w.taskId === match[1]) && !prLinks.some(p => p.number === Number(match[3]))) {
      prLinks.push({ taskId: match[1], number: Number(match[3]), url: PR_BASE + match[3] });
    }
  }
  return { version: 'ASI_V13_20261112', workers: workers.sort((a, b) => a.slot - b.slot),
    modelReservations, modelLimit, githubReservations, githubLimit, prLinks };
}

export type EnginePrStatus = {
  taskId: string;
  number: number;
  url: string;
  head: string | null;
  isDraft: boolean | null;
  ci: 'passed' | 'failed' | 'pending' | 'unknown';
  releaseGovernance: 'passed' | 'failed' | 'pending' | 'unknown';
  sourceValidation: 'passed' | 'failed' | 'pending' | 'unknown';
};

export type EngineLiveStatus = {
  available: boolean;
  reason: string | null;
  fetchedAt: string;
  lastReportAt: string | null;
  reportUrl: string | null;
  stale: boolean;
  workers: AsIWorker[];
  modelReservations: number | null;
  modelLimit: number | null;
  githubReservations: number | null;
  githubLimit: number | null;
  prs: EnginePrStatus[];
  source: 'private-github-report';
};

export function checkConclusion(value: string | null | undefined, status?: string): 'passed' | 'failed' | 'pending' | 'unknown' {
  if (value === 'success') return 'passed';
  if (value === 'failure' || value === 'cancelled' || value === 'timed_out' ||
      value === 'action_required') return 'failed';
  if (status === 'queued' || status === 'in_progress' || status === 'requested' ||
      status === 'waiting' || value === null) return 'pending';
  return 'unknown';
}
