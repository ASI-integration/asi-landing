/** Strict, read-only parsing of ASI Engine's owner GitHub status receipts.
 * Never treat a process RUNNING as verified work, or a reported CI as accepted CI. */
export type AsIWorker = {
  slot: number;
  taskId: string;
  state: string;
};

export type AsIStatusReport = {
  version: 'ASI_V14_CODEX_SALVAGE_20261112' | 'ASI_V15_20261112';
  wave: number | null;
  workers: AsIWorker[];
  modelReservations: number;
  modelLimit: number;
  githubReservations: number;
  githubLimit: number;
  prLinks: { taskId: string; number: number; url: string }[];
};

const REPORT_TITLE = '## ASI V14 recovered Codex results — Grok/PR campaign';
const PR_BASE = 'https://github.com/ASI-integration/asi-landing/pull/';

/** Return null rather than produce misleading status from malformed or foreign comments. */
function parseV14StatusReport(body: unknown): AsIStatusReport | null {
  if (typeof body !== 'string' || body.length > 60_000 || !body.includes(REPORT_TITLE)) return null;
  if (!/^Version:\s*ASI_V14_CODEX_SALVAGE_20261112\s*$/m.test(body)) return null;

  const workers = [...body.matchAll(/^\|\s*([1-5])\s*\|\s*(asi-v14-[a-z0-9-]+)\s*\|\s*([A-Z][A-Z0-9_]*)\s*\|$/gm)]
    .map(m => ({ slot: Number(m[1]), taskId: m[2], state: m[3] }));
  if (workers.length !== 5 || new Set(workers.map(w => w.slot)).size !== 5 ||
      new Set(workers.map(w => w.taskId)).size !== 5) return null;

  const models = /^New Grok reservations:\s*([0-9]+)\/([0-9]+)\s*$/m.exec(body);
  const github = /^New GitHub effects:\s*([0-9]+)\/([0-9]+)\s*$/m.exec(body);
  if (!models || !github) return null;
  const [modelReservations, modelLimit, githubReservations, githubLimit] =
    [models[1], models[2], github[1], github[2]].map(Number);
  if (!(modelLimit > 0 && modelLimit <= 1000 && githubLimit > 0 && githubLimit <= 1000) ||
      modelReservations > modelLimit || githubReservations > githubLimit) return null;

  const prLinks: AsIStatusReport['prLinks'] = [];
  const linkLines = body.split('Draft PR receipts:')[1] ?? '';
  for (const match of linkLines.matchAll(/^-\s*(asi-v14-[a-z0-9-]+):\s*(https:\/\/github\.com\/ASI-integration\/asi-landing\/pull\/([1-9][0-9]*))\s*$/gm)) {
    if (workers.some(w => w.taskId === match[1]) && !prLinks.some(p => p.number === Number(match[3]))) {
      prLinks.push({ taskId: match[1], number: Number(match[3]), url: PR_BASE + match[3] });
    }
  }
  return { version: 'ASI_V14_CODEX_SALVAGE_20261112', wave: null, workers: workers.sort((a, b) => a.slot - b.slot),
    modelReservations, modelLimit, githubReservations, githubLimit, prLinks };
}

/** The V15 supervisor reports all historical waves, but only the five slots in
 * the currently active wave form the fleet. Reject partial or forged waves.
 * Prior-wave PR receipts remain visible for cumulative evidence. */
function parseV15StatusReport(body: unknown): AsIStatusReport | null {
  if (typeof body !== 'string' || body.length > 80_000 ||
      !body.includes('## ASI V15 — autonomous five-agent continuous G2 engineering') ||
      !/^Version:\s*ASI_V15_20261112\s*$/m.test(body)) return null;
  const waveMatch = /^Wave:\s*([1-3])\/3\s*$/m.exec(body);
  if (!waveMatch) return null;
  const wave = Number(waveMatch[1]);
  const all = [...body.matchAll(/^\|\s*([1-5])\s*\|\s*(asi-v15-w([0-9]{2})-[a-z0-9-]+)\s*\|\s*([A-Z][A-Z0-9_]*)\s*\|$/gm)]
    .map(m => ({slot: Number(m[1]), taskId: m[2], wave: Number(m[3]), state: m[4]}));
  if (all.length !== wave * 5 ||
      new Set(all.map(t => t.taskId)).size !== all.length ||
      all.some(t => t.wave < 1 || t.wave > wave)) return null;
  for (let n = 1; n <= wave; n++) {
    const members = all.filter(t => t.wave === n);
    if (members.length !== 5 || new Set(members.map(t => t.slot)).size !== 5) return null;
  }
  const current = all.filter(t => t.wave === wave).map(({slot,taskId,state}) => ({slot,taskId,state}));
  const models = /^Model reservations:\s*([0-9]+)\/([0-9]+)\s*$/m.exec(body);
  const github = /^GitHub effects:\s*([0-9]+)\/([0-9]+)\s*$/m.exec(body);
  if (!models || !github) return null;
  const [modelReservations,modelLimit,githubReservations,githubLimit] =
    [models[1],models[2],github[1],github[2]].map(Number);
  if (modelLimit !== 30 || githubLimit !== 90 ||
      modelReservations < wave * 10 || modelReservations > modelLimit ||
      githubReservations > githubLimit) return null;

  const prLinks: AsIStatusReport['prLinks'] = [];
  const section = body.split('Verified PR receipts:')[1] ?? '';
  for (const m of section.matchAll(/^-\s*(asi-v15-w[0-9]{2}-[a-z0-9-]+):\s*(https:\/\/github\.com\/ASI-integration\/asi-landing\/pull\/([1-9][0-9]*))\s*$/gm)) {
    if (all.some(t => t.taskId === m[1]) && !prLinks.some(p => p.number === Number(m[3]))) {
      prLinks.push({taskId: m[1], number: Number(m[3]), url: PR_BASE + m[3]});
    }
  }
  return {version:'ASI_V15_20261112',wave,
    workers:current.sort((a,b) => a.slot - b.slot),
    modelReservations,modelLimit,githubReservations,githubLimit,prLinks};
}

export function parseAsIStatusReport(body: unknown): AsIStatusReport | null {
  return parseV15StatusReport(body) ?? parseV14StatusReport(body);
}

export type EnginePrStatus = {
  taskId: string;
  number: number;
  url: string;
  head: string | null;
  isDraft: boolean | null;
  isMerged?: boolean;
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
  campaign: AsIStatusReport['version'] | null;
  wave: number | null;
};

export function checkConclusion(value: string | null | undefined, status?: string): 'passed' | 'failed' | 'pending' | 'unknown' {
  if (value === 'success') return 'passed';
  if (value === 'failure' || value === 'cancelled' || value === 'timed_out' ||
      value === 'action_required') return 'failed';
  if (status === 'queued' || status === 'in_progress' || status === 'requested' ||
      status === 'waiting' || value === null) return 'pending';
  return 'unknown';
}
