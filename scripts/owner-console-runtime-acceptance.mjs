#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const OWNER_CONSOLE_RUNTIME_ACCEPTANCE_CONFIRM = 'CREATE_ONE_DRAFT_PR_ONLY';
export const OWNER_CONSOLE_RUNTIME_ACCEPTANCE_MARKER = 'OWNER_CONSOLE_RUNTIME_FULL_AUTONOMOUS_E2E_READY';
export const OWNER_CONSOLE_RUNTIME_PROOF_CONTRACT = 'asi.owner-console.runtime-acceptance-proof.v1';
export const OWNER_CONSOLE_RUNTIME_PROOF_MARKER = 'OWNER_CONSOLE_RUNTIME_ACCEPTANCE_PROOF';

const REPOSITORY = 'ASI-integration/asi-landing';
const READINESS_COMPONENTS = ['bridge', 'checkouts', 'baseline', 'executor', 'github'];
const READINESS_STATES = new Set(['ready', 'degraded', 'blocked']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
const PR_PATH = /^\/ASI-integration\/asi-landing\/pull\/([1-9][0-9]*)\/?$/;

class AcceptanceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function baseUrl(raw) {
  try {
    const url = new URL(raw ?? '');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function boundedTimeout(raw) {
  const value = Number(raw ?? 20 * 60_000);
  return Number.isInteger(value) && value >= 60_000 && value <= 30 * 60_000
    ? value
    : 20 * 60_000;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLaunchableReadiness(readiness) {
  if (!isRecord(readiness)
    || readiness.schemaVersion !== 'asi.owner-console.readiness.v1'
    || !['ready', 'degraded'].includes(readiness.overallState)
    || readiness.canLaunch !== true
    || !isRecord(readiness.components)) return false;

  if (!READINESS_COMPONENTS.every((id) => Object.hasOwn(readiness.components, id))) return false;
  const componentsAreValid = Object.values(readiness.components).every((component) => (
    isRecord(component)
    && READINESS_STATES.has(component.state)
    && typeof component.reasonCode === 'string'
    && typeof component.message === 'string'
    && component.blockingLaunch === false
  ));
  if (!componentsAreValid) return false;

  const requiredStates = READINESS_COMPONENTS.map((id) => readiness.components[id].state);
  if (readiness.overallState === 'ready') {
    return requiredStates.every((state) => state === 'ready');
  }
  return requiredStates.some((state) => state === 'degraded')
    && requiredStates.every((state) => state !== 'blocked');
}

async function responseJson(response, code) {
  if (!response.ok) throw new AcceptanceError(code);
  try {
    return await response.json();
  } catch {
    throw new AcceptanceError(code);
  }
}

async function dashboard(fetchImpl, url, cookie, pathname, init = {}) {
  const response = await fetchImpl(`${url}${pathname}`, {
    ...init,
    headers: {
      accept: 'application/json',
      cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  return responseJson(response, 'dashboard_request_failed');
}

function pullRequestNumber(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com'
      || url.username || url.password || url.search || url.hash) return null;
    const match = PR_PATH.exec(url.pathname);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

async function verifyDraftPullRequest(fetchImpl, prUrl, headSha, token) {
  const number = pullRequestNumber(prUrl);
  if (!number) throw new AcceptanceError('draft_pr_artifact_invalid');
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'asi-owner-console-runtime-acceptance',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/pulls/${number}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await responseJson(response, 'draft_pr_probe_failed');
  const baseRepo = payload?.base?.repo?.full_name;
  const baseRef = payload?.base?.ref;
  const currentHeadSha = String(payload?.head?.sha ?? '').toLowerCase();
  if (payload?.draft !== true || payload?.state !== 'open' || payload?.merged === true
    || baseRepo !== REPOSITORY || baseRef !== 'main' || currentHeadSha !== headSha) {
    throw new AcceptanceError('draft_pr_contract_failed');
  }
  return { number, headers };
}

function expectedProofContent(runId) {
  return [
    '# Runtime acceptance proof',
    '',
    `Contract: ${OWNER_CONSOLE_RUNTIME_PROOF_CONTRACT}`,
    `Run ID: ${runId}`,
    `Marker: ${OWNER_CONSOLE_RUNTIME_PROOF_MARKER}`,
    '',
  ].join('\n');
}

async function verifyExactProofFile(fetchImpl, pr, headSha, runId, relativeProofPath) {
  const filesResponse = await fetchImpl(
    `https://api.github.com/repos/${REPOSITORY}/pulls/${pr.number}/files?per_page=2`,
    { method: 'GET', headers: pr.headers, cache: 'no-store', signal: AbortSignal.timeout(15_000) },
  );
  const files = await responseJson(filesResponse, 'draft_pr_files_probe_failed');
  if (!Array.isArray(files) || files.length !== 1
    || files[0]?.status !== 'added'
    || files[0]?.filename !== relativeProofPath
    || files[0]?.previous_filename !== undefined) {
    throw new AcceptanceError('draft_pr_scope_failed');
  }

  const encodedPath = relativeProofPath.split('/').map(encodeURIComponent).join('/');
  const contentResponse = await fetchImpl(
    `https://api.github.com/repos/${REPOSITORY}/contents/${encodedPath}?ref=${headSha}`,
    { method: 'GET', headers: pr.headers, cache: 'no-store', signal: AbortSignal.timeout(15_000) },
  );
  const file = await responseJson(contentResponse, 'draft_pr_content_probe_failed');
  if (file?.type !== 'file' || file?.encoding !== 'base64' || typeof file?.content !== 'string') {
    throw new AcceptanceError('draft_pr_content_failed');
  }
  let content;
  try {
    content = Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8');
  } catch {
    throw new AcceptanceError('draft_pr_content_failed');
  }
  if (content !== expectedProofContent(runId)) {
    throw new AcceptanceError('draft_pr_content_failed');
  }
}

export async function runOwnerConsoleRuntimeAcceptance({
  env = /** @type {Record<string, string | undefined>} */ (process.env),
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  createId = randomUUID,
} = {}) {
  if (env.ASI_OWNER_CONSOLE_ACCEPTANCE_CONFIRM !== OWNER_CONSOLE_RUNTIME_ACCEPTANCE_CONFIRM) {
    throw new AcceptanceError('acceptance_confirmation_missing');
  }
  const url = baseUrl(env.ASI_OWNER_CONSOLE_ACCEPTANCE_BASE_URL);
  const cookie = String(env.ASI_OWNER_CONSOLE_ACCEPTANCE_SESSION_COOKIE ?? '').trim();
  if (!url || !cookie) throw new AcceptanceError('acceptance_configuration_invalid');

  const readinessResponse = await dashboard(
    fetchImpl,
    url,
    cookie,
    '/api/dashboard/development/readiness?repositoryId=asi-landing',
  );
  const readiness = readinessResponse?.readiness;
  if (readinessResponse?.ok !== true || !isLaunchableReadiness(readiness)) {
    throw new AcceptanceError('readiness_not_ready');
  }

  const runId = createId();
  if (!UUID.test(runId)) throw new AcceptanceError('acceptance_run_id_invalid');
  const relativeProofPath = `docs/operations/runtime-acceptance/${runId}.md`;
  const proofContent = expectedProofContent(runId);
  const prompt = [
    `Выполни безопасную проверку автономного контура ${runId}.`,
    `Создай только файл ${relativeProofPath} с точно таким содержимым: ${JSON.stringify(proofContent)}.`,
    'Запусти проверки только для этого документа, создай отдельную ветку, commit и draft PR в main.',
    'Не объединяй PR, не выполняй deploy и не меняй настройки, данные, secrets или внешние сервисы.',
  ].join(' ');

  const submitted = await dashboard(fetchImpl, url, cookie, '/api/dashboard/development/tasks', {
    method: 'POST',
    body: JSON.stringify({
      repositoryId: 'asi-landing',
      prompt,
      idempotencyKey: `owner-console-runtime-acceptance-${runId}`,
    }),
  });
  const taskId = String(submitted?.taskId ?? '');
  if (submitted?.ok !== true || !UUID.test(taskId)) {
    throw new AcceptanceError('task_submission_failed');
  }

  const observedStatuses = new Set();
  if (typeof submitted?.task?.status === 'string') observedStatuses.add(submitted.task.status);
  const deadline = Date.now() + boundedTimeout(env.ASI_OWNER_CONSOLE_ACCEPTANCE_TIMEOUT_MS);
  let snapshot = submitted;
  while (!['completed', 'failed'].includes(String(snapshot?.task?.status ?? ''))) {
    if (Date.now() >= deadline) throw new AcceptanceError('task_timeout');
    await sleep(2_000);
    snapshot = await dashboard(
      fetchImpl,
      url,
      cookie,
      `/api/dashboard/development/tasks/${encodeURIComponent(taskId)}`,
    );
    if (snapshot?.ok !== true) throw new AcceptanceError('task_poll_failed');
    if (typeof snapshot?.task?.status === 'string') observedStatuses.add(snapshot.task.status);
  }

  const result = snapshot?.result;
  const attemptCount = Number(snapshot?.task?.attemptCount ?? 0);
  if (snapshot?.task?.status !== 'completed' || result?.status !== 'completed' || attemptCount < 1) {
    throw new AcceptanceError('task_execution_failed');
  }
  const prUrl = result.artifacts?.find((item) => item?.type === 'pull_request')?.value;
  const headSha = String(result.artifacts?.find((item) => item?.type === 'commit')?.value ?? '').toLowerCase();
  if (!pullRequestNumber(prUrl) || !SHA.test(headSha)) {
    throw new AcceptanceError('draft_pr_artifact_invalid');
  }
  const pullRequest = await verifyDraftPullRequest(
    fetchImpl,
    prUrl,
    headSha,
    String(env.GITHUB_TOKEN ?? '').trim(),
  );
  await verifyExactProofFile(fetchImpl, pullRequest, headSha, runId, relativeProofPath);

  return {
    ok: true,
    marker: OWNER_CONSOLE_RUNTIME_ACCEPTANCE_MARKER,
    taskId,
    draftPrUrl: prUrl,
    headSha,
    observedStatuses: [...observedStatuses],
    mergePerformed: false,
    deployPerformed: false,
  };
}

async function main() {
  try {
    const result = await runOwnerConsoleRuntimeAcceptance();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof AcceptanceError ? error.code : 'acceptance_failed';
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
