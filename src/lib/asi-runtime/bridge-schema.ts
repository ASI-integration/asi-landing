import { containsForbiddenStringContent } from './ingest-schema';
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
  try {
    const url = new URL(value.value);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
      && /^\/ASI-integration\/asi-landing\/pull\/[1-9][0-9]*\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function parseTask(value: unknown): RuntimeBridgeTaskRequest | null {
  if (!object(value) || !exact(value, ['title', 'objective', 'instructions', 'repository', 'baselineSha'])) return null;
  if (!text(value.title, 200) || !text(value.objective, 4000) || !instructionList(value.instructions)) return null;
  if (value.repository !== 'ASI-integration/asi-landing' || !text(value.baselineSha, 40, SHA)) return null;
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

export function parseRuntimeBridgeRunnerInput(value: unknown): RuntimeBridgeRunnerInput | null {
  if (!object(value) || !exact(value, ['operation', 'input']) || !object(value.input)) return null;
  const input = value.input;
  const runner = text(input.runnerId, 200, ID);
  if (!runner) return null;
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
