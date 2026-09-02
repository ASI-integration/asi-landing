import { containsForbiddenStringContent } from './ingest-schema';
import { isRunnerRepositoryEvidenceBindingValid } from './runner-readiness-contract';
import type {
  RuntimeBridgeChatInput,
  RuntimeBridgeOwnerGateRequest,
  RuntimeBridgeRunnerInput,
  RuntimeBridgeSafeResult,
  RuntimeBridgeTaskRequest,
} from './bridge-types';

export const RUNTIME_BRIDGE_MAX_BODY_BYTES = 64 * 1024;
export const RUNTIME_BRIDGE_MAX_INSTRUCTIONS = 100;
export const RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS = 2000;
/** Sum of instruction line lengths; sized so UTF-8 Cyrillic stays under the 64 KiB body cap. */
export const RUNTIME_BRIDGE_MAX_INSTRUCTION_TOTAL_CHARS = 24 * 1024;

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUNNER_CHECKOUT_REASON_CODES = new Set([
  'runtime_checkouts_ready',
  'runtime_checkout_recoverable_drift',
  'runtime_checkout_config_missing',
  'runtime_checkout_config_invalid',
  'runtime_checkout_missing',
  'runtime_checkout_not_git',
  'runtime_checkout_dirty',
  'runtime_checkout_remote_missing',
  'runtime_checkout_remote_mismatch',
  'runtime_baseline_remote_unavailable',
  'runtime_baseline_remote_mismatch',
  'runtime_checkout_probe_failed',
]);
const RUNNER_BASELINE_RECOVERY_REASON_CODES = new Set([
  'runtime_baseline_recovery_ready',
  'runtime_baseline_recovery_unavailable',
]);
const RUNNER_EXECUTOR_REASON_CODES = new Set([
  'runtime_executor_ready',
  'runtime_runner_url_missing',
  'runtime_runner_url_invalid',
  'runtime_runner_credentials_invalid',
  'runtime_executor_missing',
  'runtime_executor_invalid',
  'runtime_executor_unavailable',
  'runtime_executor_entrypoint_missing',
  'runtime_executor_entrypoint_unavailable',
  'runtime_executor_probe_failed',
]);
const RUNNER_READINESS_V2_HTTPS_ORIGIN = /^https:\/\/github\.com\/ASI-integration\/(asi-landing|asi-os-runtime)(\.git)?$/;
const RUNNER_READINESS_V2_SSH_ALIAS_ORIGIN = /^git@github\.com-[a-z0-9-]+:ASI-integration\/(asi-landing|asi-os-runtime)(\.git)?$/;
const RUNNER_READINESS_V2_SSH_URL_ORIGIN = /^ssh:\/\/git@github\.com\/ASI-integration\/(asi-landing|asi-os-runtime)(\.git)?$/;
const RUNTIME_BRIDGE_CANONICAL_PULL_REQUEST_REPOSITORIES = [
  { fullName: 'ASI-integration/asi-landing', owner: 'ASI-integration', repo: 'asi-landing' },
  { fullName: 'ASI-integration/asi-os-runtime', owner: 'ASI-integration', repo: 'asi-os-runtime' },
] as const satisfies ReadonlyArray<{
  fullName: RuntimeBridgeTaskRequest['repository'];
  owner: string;
  repo: string;
}>;

function isSafePullRequestArtifactUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:'
      || url.hostname !== 'github.com'
      || url.username !== ''
      || url.password !== ''
      || url.search !== ''
      || url.hash !== '') return false;
    return RUNTIME_BRIDGE_CANONICAL_PULL_REQUEST_REPOSITORIES.some(
      (entry) => new RegExp(`^/${entry.owner}/${entry.repo}/pull/[1-9][0-9]*/?$`).test(url.pathname),
    );
  } catch {
    return false;
  }
}

/** Resolve allowlisted repository identity for a syntactically safe pull_request artifact URL. */
export function resolveBridgePullRequestArtifactRepository(
  value: string,
): RuntimeBridgeTaskRequest['repository'] | null {
  if (!isSafePullRequestArtifactUrl(value)) return null;
  const parts = new URL(value).pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const repo = parts[1];
  const match = RUNTIME_BRIDGE_CANONICAL_PULL_REQUEST_REPOSITORIES.find(
    (entry) => entry.owner === owner && entry.repo === repo,
  );
  return match?.fullName ?? null;
}

/** Authoritative task repository must match every pull_request artifact repository. */
export function validateBridgeResultArtifactsMatchTaskRepository(
  result: RuntimeBridgeSafeResult,
  taskRepository: RuntimeBridgeTaskRequest['repository'],
): boolean {
  for (const artifact of result.artifacts) {
    if (artifact.type !== 'pull_request') continue;
    const artifactRepository = resolveBridgePullRequestArtifactRepository(artifact.value);
    if (!artifactRepository || artifactRepository !== taskRepository) return false;
  }
  return true;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
    && keys.every((key) => Object.hasOwn(value, key));
}

function text(value: unknown, max: number, pattern?: RegExp): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && value === value.trim()
    && !containsForbiddenStringContent(value)
    && (!pattern || pattern.test(value));
}

function textList(value: unknown, maxItems: number, maxText: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => text(item, maxText));
}

function instructionList(value: unknown): value is string[] {
  if (!textList(value, RUNTIME_BRIDGE_MAX_INSTRUCTIONS, RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS)) {
    return false;
  }
  let total = 0;
  for (const line of value) {
    total += line.length;
    if (total > RUNTIME_BRIDGE_MAX_INSTRUCTION_TOTAL_CHARS) return false;
  }
  return true;
}

function repoPath(value: unknown): value is string {
  return text(value, 500)
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').includes('..')
    && !/^[A-Za-z]:/.test(value);
}

function safeArtifact(value: unknown): boolean {
  if (!object(value) || !exact(value, ['type', 'value']) || !text(value.value, 2000)) return false;
  if (value.type === 'commit') return SHA.test(value.value);
  if (value.type === 'report') return repoPath(value.value) && value.value.startsWith('docs/');
  if (value.type !== 'pull_request') return false;
  return isSafePullRequestArtifactUrl(value.value);
}

function parseTask(value: unknown): RuntimeBridgeTaskRequest | null {
  const required = ['title', 'objective', 'instructions', 'repository', 'baselineSha'];
  const allowed = [...required, 'acceptanceCriteria', 'safetyConstraints'];
  if (!object(value)
    || !Object.keys(value).every((key) => allowed.includes(key))
    || !required.every((key) => Object.hasOwn(value, key))) return null;
  if (!text(value.title, 200) || !text(value.objective, 4000) || !instructionList(value.instructions)) return null;
  const packageLists = [value.acceptanceCriteria, value.safetyConstraints]
    .filter((item) => item !== undefined);
  if (packageLists.some((item) => !textList(item, 10, 1000))) return null;
  const packageChars = packageLists
    .flatMap((item) => item as string[])
    .reduce((total, item) => total + item.length, 0);
  if (packageChars > 4 * 1024) return null;
  const allowedRepositories = new Set([
    'ASI-integration/asi-landing',
    'ASI-integration/asi-os-runtime',
  ]);
  if (!allowedRepositories.has(String(value.repository)) || !text(value.baselineSha, 40, SHA)) return null;
  return value as RuntimeBridgeTaskRequest;
}

function parseGate(value: unknown): RuntimeBridgeOwnerGateRequest | null {
  const keys = ['schemaVersion', 'action', 'exactTarget', 'identity', 'reason', 'evidence', 'allowedSideEffect', 'rollback', 'postActionVerification', 'taskCycle', 'expiresAt'];
  if (!object(value) || !exact(value, keys) || value.schemaVersion !== 'asi.runtime.owner-gate.v1') return null;
  if (!text(value.action, 120) || !text(value.exactTarget, 500) || !text(value.identity, 500)) return null;
  if (!text(value.reason, 2000) || !textList(value.evidence, 20, 1000)) return null;
  if (!text(value.allowedSideEffect, 1000) || !text(value.rollback, 1000)) return null;
  if (!textList(value.postActionVerification, 20, 1000) || !text(value.taskCycle, 200, ID)) return null;
  if (!text(value.expiresAt, 64) || Number.isNaN(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) return null;
  return value as RuntimeBridgeOwnerGateRequest;
}

function parseResult(value: unknown): RuntimeBridgeSafeResult | null {
  if (!object(value) || !exact(value, ['schemaVersion', 'status', 'summary', 'changedFiles', 'checks', 'artifacts', 'blockers'])) return null;
  if (value.schemaVersion !== 'asi.runtime.result.v1' || !['completed', 'failed'].includes(String(value.status))) return null;
  if (!text(value.summary, 4000)
    || !Array.isArray(value.changedFiles) || value.changedFiles.length > 200 || !value.changedFiles.every(repoPath)
    || !textList(value.blockers, 50, 1000)) return null;
  if (!Array.isArray(value.checks) || value.checks.length > 100 || !value.checks.every((item) =>
    object(item)
    && Object.keys(item).every((key) => ['name', 'status', 'detail'].includes(key))
    && text(item.name, 200)
    && ['PASS', 'FAIL', 'SKIP'].includes(String(item.status))
    && (item.detail === undefined || text(item.detail, 1000)))) return null;
  if (!Array.isArray(value.artifacts) || value.artifacts.length > 50 || !value.artifacts.every(safeArtifact)) return null;
  return value as RuntimeBridgeSafeResult;
}

export async function readRuntimeBridgeBody(request: Request): Promise<unknown | null> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return null;
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > RUNTIME_BRIDGE_MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (!raw || Buffer.byteLength(raw, 'utf8') > RUNTIME_BRIDGE_MAX_BODY_BYTES) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

export function parseRuntimeBridgeChatInput(value: unknown): RuntimeBridgeChatInput | null {
  if (!object(value) || !exact(value, ['operation', 'input']) || !object(value.input)) return null;
  const input = value.input;
  switch (value.operation) {
    case 'runtime_submit_task': {
      if (!exact(input, ['chatgptTaskId', 'conversationId', 'idempotencyKey', 'task'])) return null;
      const task = parseTask(input.task);
      if (!text(input.chatgptTaskId, 200, ID) || !text(input.conversationId, 200, ID) || !text(input.idempotencyKey, 200, ID) || !task) return null;
      return { operation: value.operation, input: { ...input, task } } as RuntimeBridgeChatInput;
    }
    case 'runtime_get_task':
    case 'runtime_get_result':
      return exact(input, ['taskId']) && text(input.taskId, 36, UUID) ? value as RuntimeBridgeChatInput : null;
    case 'runtime_list_owner_gates':
      return Object.keys(input).length === 0 ? value as RuntimeBridgeChatInput : null;
    case 'runtime_submit_owner_decision': {
      const required = ['taskId', 'gateId', 'decisionId', 'taskCycle', 'decision', 'source'];
      const keys = Object.keys(input);
      if (!keys.every((key) => [...required, 'note'].includes(key)) || !required.every((key) => Object.hasOwn(input, key))) return null;
      if (!text(input.taskId, 36, UUID) || !text(input.gateId, 36, UUID) || !text(input.decisionId, 200, ID) || !text(input.taskCycle, 200, ID)) return null;
      if (!['approved', 'rejected'].includes(String(input.decision)) || input.source !== 'explicit_owner_message') return null;
      if (input.note !== undefined && !text(input.note, 2000)) return null;
      return value as RuntimeBridgeChatInput;
    }
    default: return null;
  }
}

function parseRunnerExecutorCapability(value: unknown): { state: 'ready' | 'blocked'; reasonCode: string } | null {
  if (!object(value) || !exact(value, ['state', 'reasonCode'])
    || !['ready', 'blocked'].includes(String(value.state))
    || !text(value.reasonCode, 120, ID)
    || !RUNNER_EXECUTOR_REASON_CODES.has(value.reasonCode)) return null;
  return { state: value.state as 'ready' | 'blocked', reasonCode: value.reasonCode };
}

function parseRunnerCheckoutCapability(value: unknown): { state: 'ready' | 'blocked' | 'degraded'; reasonCode: string } | null {
  if (!object(value) || !exact(value, ['state', 'reasonCode'])
    || !['ready', 'blocked', 'degraded'].includes(String(value.state))
    || !text(value.reasonCode, 120, ID)
    || !RUNNER_CHECKOUT_REASON_CODES.has(value.reasonCode)) return null;
  return { state: value.state as 'ready' | 'blocked' | 'degraded', reasonCode: value.reasonCode };
}

function parseRunnerBaselineRecoveryCapability(value: unknown): { state: 'ready' | 'blocked'; reasonCode: string } | null {
  if (!object(value) || !exact(value, ['state', 'reasonCode'])
    || !['ready', 'blocked'].includes(String(value.state))
    || !text(value.reasonCode, 120, ID)
    || !RUNNER_BASELINE_RECOVERY_REASON_CODES.has(value.reasonCode)) return null;
  return { state: value.state as 'ready' | 'blocked', reasonCode: value.reasonCode };
}

function boundedCheckoutPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 500
    && value === value.trim()
    && !value.split('/').includes('..')
    && !value.includes('\\');
}

function isCanonicalRunnerExpectedOrigin(value: string): boolean {
  return RUNNER_READINESS_V2_HTTPS_ORIGIN.test(value)
    || RUNNER_READINESS_V2_SSH_ALIAS_ORIGIN.test(value)
    || RUNNER_READINESS_V2_SSH_URL_ORIGIN.test(value);
}

function isBlockedMissingOriginRepositoryEvidence(value: Record<string, unknown>): boolean {
  return value.expectedOrigin === ''
    && value.originReady === false
    && value.checkoutReady === false
    && value.baselineReady === false
    && value.recoveryReady === false
    && Array.isArray(value.blockers)
    && value.blockers.includes('runtime_repository_origin_missing');
}

function allowedRunnerRepositoryExpectedOrigin(value: unknown, evidence: Record<string, unknown>): boolean {
  if (value === '' && isBlockedMissingOriginRepositoryEvidence(evidence)) return true;
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return false;
  if (value !== value.trim() || containsForbiddenStringContent(value)) return false;
  return isCanonicalRunnerExpectedOrigin(value);
}

function parseRunnerReadinessV1Input(input: Record<string, unknown>): RuntimeBridgeRunnerInput | null {
  if (!exact(input, ['schemaVersion', 'runnerId', 'checkedAt', 'expiresAt', 'baselineSha', 'capabilities'])
    || input.schemaVersion !== 'asi.runtime.runner-readiness.v1'
    || !text(input.checkedAt, 64) || !text(input.expiresAt, 64)
    || Number.isNaN(Date.parse(input.checkedAt)) || Number.isNaN(Date.parse(input.expiresAt))
    || (input.baselineSha !== null && !text(input.baselineSha, 40, SHA))
    || !object(input.capabilities)
    || !exact(input.capabilities, ['checkouts', 'baselineRecovery', 'executor'])) return null;
  const { checkouts, baselineRecovery, executor } = input.capabilities;
  if (!object(checkouts) || !exact(checkouts, ['state', 'reasonCode'])
    || !['ready', 'blocked', 'degraded'].includes(String(checkouts.state))
    || !text(checkouts.reasonCode, 120, ID)
    || !RUNNER_CHECKOUT_REASON_CODES.has(checkouts.reasonCode)) return null;
  if (!object(baselineRecovery) || !exact(baselineRecovery, ['state', 'reasonCode'])
    || !['ready', 'blocked'].includes(String(baselineRecovery.state))
    || !text(baselineRecovery.reasonCode, 120, ID)
    || !RUNNER_BASELINE_RECOVERY_REASON_CODES.has(baselineRecovery.reasonCode)) return null;
  if (!parseRunnerExecutorCapability(executor)) return null;
  if ((checkouts.state !== 'blocked' || baselineRecovery.state === 'ready')
    && typeof input.baselineSha !== 'string') return null;
  return {
    operation: 'runner_publish_readiness',
    input: input as Extract<RuntimeBridgeRunnerInput, { operation: 'runner_publish_readiness' }>['input'],
  };
}

function parseRunnerRepositoryEvidenceV2(value: unknown) {
  const keys = [
    'repositoryId', 'fullName', 'canonicalCheckoutPath', 'expectedOrigin', 'defaultBranch',
    'observedBaselineSha', 'checkoutReady', 'originReady', 'baselineReady', 'recoveryReady', 'blockers',
  ];
  if (!object(value) || !exact(value, keys)) return null;
  if (!boundedCheckoutPath(value.canonicalCheckoutPath)
    || !isRunnerRepositoryEvidenceBindingValid(
      value.repositoryId,
      value.fullName,
      value.canonicalCheckoutPath,
    )
    || !allowedRunnerRepositoryExpectedOrigin(value.expectedOrigin, value)
    || value.defaultBranch !== 'main'
    || !(value.observedBaselineSha === null || text(value.observedBaselineSha, 40, SHA))
    || typeof value.checkoutReady !== 'boolean'
    || typeof value.originReady !== 'boolean'
    || typeof value.baselineReady !== 'boolean'
    || typeof value.recoveryReady !== 'boolean'
    || !Array.isArray(value.blockers)
    || value.blockers.length > 20
    || !value.blockers.every((item) => text(item, 120, ID))) return null;
  return value;
}

function parseRunnerReadinessV2Input(input: Record<string, unknown>): RuntimeBridgeRunnerInput | null {
  if (!exact(input, ['schemaVersion', 'runnerId', 'checkedAt', 'expiresAt', 'capabilities', 'blockers', 'repositories'])
    || input.schemaVersion !== 'asi.runtime.runner-readiness.v2'
    || !text(input.checkedAt, 64) || !text(input.expiresAt, 64)
    || Number.isNaN(Date.parse(input.checkedAt)) || Number.isNaN(Date.parse(input.expiresAt))
    || !object(input.capabilities)
    || !exact(input.capabilities, ['checkouts', 'baselineRecovery', 'executor'])
    || !parseRunnerCheckoutCapability(input.capabilities.checkouts)
    || !parseRunnerBaselineRecoveryCapability(input.capabilities.baselineRecovery)
    || !parseRunnerExecutorCapability(input.capabilities.executor)
    || !Array.isArray(input.blockers)
    || input.blockers.length > 20
    || !input.blockers.every((item) => text(item, 120, ID))
    || !Array.isArray(input.repositories)
    || input.repositories.length < 1
    || input.repositories.length > 2
    || !input.repositories.every((item) => parseRunnerRepositoryEvidenceV2(item))) return null;
  const repositoryIds = input.repositories.map((item) => String((item as { repositoryId: string }).repositoryId));
  if (new Set(repositoryIds).size !== repositoryIds.length) return null;
  return {
    operation: 'runner_publish_readiness',
    input: input as Extract<RuntimeBridgeRunnerInput, { operation: 'runner_publish_readiness' }>['input'],
  };
}

function parseRunnerReadinessInput(input: Record<string, unknown>): RuntimeBridgeRunnerInput | null {
  if (input.schemaVersion === 'asi.runtime.runner-readiness.v1') {
    return parseRunnerReadinessV1Input(input);
  }
  if (input.schemaVersion === 'asi.runtime.runner-readiness.v2') {
    return parseRunnerReadinessV2Input(input);
  }
  return null;
}

export function parseRuntimeBridgeRunnerInput(value: unknown): RuntimeBridgeRunnerInput | null {
  if (!object(value) || !exact(value, ['operation', 'input']) || !object(value.input)) return null;
  const input = value.input;
  const runner = text(input.runnerId, 200, ID);
  if (!runner) return null;
  if (value.operation === 'runner_publish_readiness') {
    return parseRunnerReadinessInput(input);
  }
  if (value.operation === 'runner_claim_task') {
    return exact(input, ['runnerId', 'leaseSeconds']) && Number.isInteger(input.leaseSeconds) && Number(input.leaseSeconds) >= 30 && Number(input.leaseSeconds) <= 900
      ? value as RuntimeBridgeRunnerInput : null;
  }
  const base = ['runnerId', 'taskId', 'leaseToken'];
  if (!text(input.taskId, 36, UUID) || !text(input.leaseToken, 36, UUID)) return null;
  if (value.operation === 'runner_heartbeat') {
    return exact(input, [...base, 'leaseSeconds']) && Number.isInteger(input.leaseSeconds) && Number(input.leaseSeconds) >= 30 && Number(input.leaseSeconds) <= 900
      ? value as RuntimeBridgeRunnerInput : null;
  }
  if (value.operation === 'runner_submit_result') {
    const result = parseResult(input.result);
    return exact(input, [...base, 'result']) && result ? { operation: value.operation, input: { ...input, result } } as RuntimeBridgeRunnerInput : null;
  }
  if (value.operation === 'runner_submit_owner_gate') {
    const gate = parseGate(input.gate);
    return exact(input, [...base, 'gate']) && gate ? { operation: value.operation, input: { ...input, gate } } as RuntimeBridgeRunnerInput : null;
  }
  if (value.operation === 'runner_fail_task') {
    return exact(input, [...base, 'retryable', 'errorCode'])
      && typeof input.retryable === 'boolean'
      && text(input.errorCode, 120, ID) ? value as RuntimeBridgeRunnerInput : null;
  }
  return null;
}
