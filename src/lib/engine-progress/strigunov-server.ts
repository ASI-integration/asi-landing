import 'server-only';
import type { CheckState, PilotPr, PilotRoute, PilotSnapshot } from './strigunov-types';

const REPO = 'ASI-integration/asi-landing';
const API = `https://api.github.com/repos/${REPO}/`;
const SHA = /^[0-9a-f]{40}$/;
const MAP = 'docs/agent-os/releases/strigunov4-demo.json';
const MAX_PAGES = 10;
type Obj = Record<string, unknown>;
type Required = { name: string; app: number | null };
function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid source');
  return value as Obj;
}
function sha(value: unknown): string {
  if (typeof value !== 'string' || !SHA.test(value)) throw new Error('Invalid SHA');
  return value;
}
function id(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('Invalid ID');
  return value as number;
}
class SourceError extends Error { constructor(public status: number) { super('Source unavailable'); } }
async function read(path: string, token: string): Promise<unknown> {
  const response = await fetch(API + path, {
    method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) throw new SourceError(response.status);
  return response.json();
}
/** Complete bounded pages, rejecting duplicates, count drift and truncation. */
async function checksFor(head: string, token: string): Promise<Obj[]> {
  const all: Obj[] = [], seen = new Set<number>();
  let total: number | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = object(await read(`commits/${head}/check-runs?filter=all&per_page=100&page=${page}`, token));
    const count = data.total_count;
    if (!Number.isSafeInteger(count) || Number(count) < 0 || Number(count) > 1000 ||
        !Array.isArray(data.check_runs) || (total !== undefined && total !== count)) throw new Error('Incomplete checks');
    total = count as number;
    if (data.check_runs.length !== Math.min(100, total - all.length)) throw new Error('Incomplete checks');
    for (const raw of data.check_runs) {
      const check = object(raw), key = id(check.id);
      if (seen.has(key) || check.head_sha !== head) throw new Error('Invalid check');
      seen.add(key); all.push(check);
    }
    if (all.length === total) return all;
  }
  throw new Error('Incomplete checks');
}
async function reviewFor(head: string, token: string): Promise<CheckState> {
  const all: Obj[] = [], seen = new Set<number>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await read(`commits/${head}/statuses?per_page=100&page=${page}`, token);
    if (!Array.isArray(data) || data.length > 100) throw new Error('Incomplete statuses');
    for (const raw of data) {
      const status = object(raw), key = id(status.id);
      if (seen.has(key)) throw new Error('Repeated status');
      seen.add(key); all.push(status);
    }
    if (data.length < 100) {
      const latest = all.filter(s => s.context === 'CodeRabbit' &&
        object(s.creator).id === 136622811).sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (!latest) return 'missing';
      if (latest.state === 'pending') return 'pending';
      if (latest.state === 'failure' || latest.state === 'error') return 'failed';
      if (latest.state === 'success' && latest.description === 'Review completed') return 'success';
      return /skip/i.test(String(latest.description)) ? 'skipped' : 'unknown';
    }
  }
  throw new Error('Incomplete statuses');
}
function requiredFrom(branch: Obj): Required[] | null {
  try {
    if (branch.protected !== true) return null;
    const rule = object(object(branch.protection).required_status_checks);
    if (!Array.isArray(rule.checks) || !rule.checks.length || rule.checks.length > 50) return null;
    return rule.checks.map(raw => {
      const c = object(raw);
      if (typeof c.context !== 'string' || !c.context || c.context.length > 100) throw new Error('Invalid required check');
      return { name: c.context, app: c.app_id == null ? null : id(c.app_id) };
    });
  } catch { return null; }
}
const emptyPr = (number: number): PilotPr => ({ number, head: null, state: 'unknown',
  url: `https://github.com/${REPO}/pull/${number}`, checks: [], review: 'unknown', available: false });
function prHead(raw: unknown, number: number): { head: string; state: string } {
  const p = object(raw), head = object(p.head);
  if (p.number !== number || object(head.repo).full_name !== REPO ||
      !['open', 'closed'].includes(String(p.state))) throw new Error('Unexpected PR');
  return { head: sha(head.sha), state: p.merged === true ? 'merged' : String(p.state) };
}
async function pull(number: number, required: Required[] | null, token: string): Promise<PilotPr> {
  const fallback = emptyPr(number);
  try {
    const before = prHead(await read(`pulls/${number}`, token), number);
    const [checks, review] = await Promise.all([checksFor(before.head, token), reviewFor(before.head, token)]);
    const after = prHead(await read(`pulls/${number}`, token), number);
    if (before.head !== after.head || before.state !== after.state) throw new Error('PR moved');
    const monitored = [...(required ?? [])];
    for (const name of ['validate', 'channel-manager-recovery-postgres'])
      if (!monitored.some(c => c.name === name)) monitored.push({ name, app: 15368 });
    return { ...fallback, ...before, available: true, review, checks: monitored.map(c => {
      const latest = checks.filter(x => x.name === c.name &&
        (c.app === null || object(x.app).id === c.app)).sort((a, b) => Number(b.id) - Number(a.id))[0];
      const state: CheckState = !latest ? 'missing' : latest.status !== 'completed' ? 'pending'
        : latest.conclusion === 'success' ? 'success' : latest.conclusion === 'skipped' ? 'skipped' : 'failed';
      return { name: c.name, required: !!required?.some(r => r.name === c.name), state };
    }) };
  } catch { return fallback; }
}
async function release(main: string, candidate: string | null, token: string): Promise<PilotRoute | null> {
  try {
    let ref = main, source: PilotRoute['source'] = 'main', raw: unknown;
    try { raw = await read(`contents/${MAP}?ref=${ref}`, token); }
    catch (error) {
      if (!(error instanceof SourceError) || error.status !== 404 || !candidate) throw error;
      ref = candidate; source = 'candidate'; raw = await read(`contents/${MAP}?ref=${ref}`, token);
    }
    const file = object(raw);
    if (file.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > 100000) throw new Error('Invalid map');
    const map = object(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
    if (map.releaseId !== 'STRIGUNOV4-READY-FOR-DEMO' || !Array.isArray(map.stages) || map.stages.length !== 6) throw new Error('Invalid map');
    let incomplete = false;
    const stages = map.stages.map((rawStage, index) => {
      const stage = object(rawStage);
      if (stage.id !== `S4-G${index + 1}` || !['ACCEPTED', 'IN_PROGRESS', 'NOT_STARTED', 'BLOCKED'].includes(String(stage.status))) throw new Error('Invalid stage');
      if (stage.status === 'ACCEPTED' && (incomplete || source === 'candidate')) throw new Error('Untrusted acceptance');
      incomplete ||= stage.status !== 'ACCEPTED';
      return { id: String(stage.id), status: String(stage.status) };
    });
    return { source, sha: ref, stages };
  } catch { return null; }
}
let cache: { at: number; value: PilotSnapshot } | null = null;
let pending: Promise<PilotSnapshot> | null = null;
async function collect(): Promise<PilotSnapshot> {
  const result: PilotSnapshot = { checkedAt: new Date().toISOString(), available: false,
    mainSha: null, requiredKnown: false, prs: [emptyPr(510), emptyPr(517)], route: null };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return result;
  try {
    const branch = object(await read('branches/main', token));
    result.mainSha = sha(object(branch.commit).sha);
    const required = requiredFrom(branch);
    result.requiredKnown = required !== null;
    result.prs = await Promise.all([pull(510, required, token), pull(517, required, token)]);
    result.route = await release(result.mainSha, result.prs[0].head, token);
    result.available = result.prs.every(p => p.available) && result.route !== null && result.requiredKnown;
  } catch { /* Errors and secrets are never serialized to the browser. */ }
  return result;
}
/** Owner API only: bounded cache and single-flight avoid overlapping GitHub polls. */
export async function getStrigunovProgress(): Promise<PilotSnapshot> {
  if (cache && Date.now() - cache.at < 20000) return cache.value;
  if (!pending) pending = collect().then(value => {
    cache = { at: Date.now(), value }; return value;
  }).finally(() => { pending = null; });
  return pending;
}
