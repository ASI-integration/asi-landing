import 'server-only';
import { getRuntimeBridgeClientId } from '@/lib/asi-runtime/bridge-auth';
import {
  findRuntimeBridgeTaskByIdempotencyKey,
  getRuntimeBridgeOwnerGate,
  getRuntimeBridgeResult,
  getRuntimeBridgeTask,
  getRuntimeBridgeTaskRecord,
  listRuntimeBridgeOwnerGates,
  RuntimeBridgeError,
  submitRuntimeBridgeOwnerDecision,
  submitRuntimeBridgeTask,
} from '@/lib/asi-runtime/bridge-repository';
import type {
  RuntimeBridgeOwnerGateView,
  RuntimeBridgeSafeResult,
  RuntimeBridgeTaskRequest,
  RuntimeBridgeTaskView,
} from '@/lib/asi-runtime/bridge-types';
import { isRuntimeBridgeSupabaseConfigured } from '@/lib/asi-runtime/bridge-supabase';
import {
  RUNTIME_BRIDGE_MAX_INSTRUCTIONS,
  RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS,
  RUNTIME_BRIDGE_MAX_INSTRUCTION_TOTAL_CHARS,
} from '@/lib/asi-runtime/bridge-schema';
import { containsForbiddenStringContent } from '@/lib/asi-runtime/ingest-schema';
import { BaselineShaError, isExactGitSha, resolveAllowlistedBaselineSha } from './baseline-sha';
import {
  controlCenterMergeDependencies,
  GitHubControlCenterError,
} from './github-control-center';
import {
  createDevelopmentChatgptTaskId,
  createDevelopmentConversationId,
  createDevelopmentDecisionId,
  normalizeClientIdempotencyKey,
} from './ids';
import {
  blockedTaskRepositoryMismatchMergeGate,
  evaluateControlCenterMergeGate,
  requestControlCenterMerge,
  unavailableControlCenterMergeGate,
  type ControlCenterMergeGateView,
  type ControlCenterMergeOutcome,
  type ControlCenterPullRequest,
} from './owner-merge-gate';
import { safeAllowlistedPullRequestUrl, resolveAllowlistedPullRequestIdentity } from './pr-url';
import { isAllowlistedDevelopmentRepositoryFullName, resolveDevelopmentRepository } from './repositories';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_PROMPT_MAX_CHARS = 4000;
const DERIVED_TITLE_MAX_CHARS = 200;

const STANDARD_SAFETY_CONSTRAINTS = [
  'Не выполнять merge или deploy и не менять production data, migrations, secrets, environment variables, DNS, payments или repository settings.',
  'Не отправлять реальные сообщения и не вызывать внешние продуктовые сервисы.',
  'Сохранять авторизацию, server-only границы, аудит и идемпотентность submit и owner-decision.',
  'Работать только в изолированном checkout, менять минимальный согласованный scope и запускать только focused checks.',
] as const;

function text(value: unknown, max: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && value === value.trim()
    && !containsForbiddenStringContent(value);
}

function textList(value: unknown, maxItems: number, maxText: number): value is string[] {
  return Array.isArray(value)
    && value.length > 0
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

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  const candidate = value.slice(0, max - 1);
  const boundary = candidate.lastIndexOf(' ');
  const prefix = boundary >= Math.floor(max * 0.6) ? candidate.slice(0, boundary) : candidate;
  return `${prefix.trimEnd()}…`;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return text(normalized, max) ? normalized : null;
}

function promptInstructionLines(prompt: string): string[] {
  const lines: string[] = [];
  let remaining = prompt.replace(/\s+/g, ' ').trim();
  while (remaining.length > RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS) {
    let boundary = remaining.lastIndexOf(' ', RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS);
    if (boundary < Math.floor(RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS * 0.6)) {
      boundary = RUNTIME_BRIDGE_MAX_INSTRUCTION_LINE_CHARS;
    }
    lines.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) lines.push(remaining);
  return lines.length ? lines : [prompt];
}

export type DerivedDevelopmentTaskPackage = {
  title: string;
  objective: string;
  instructions: string[];
  acceptanceCriteria: string[];
  safetyConstraints: string[];
};

export function deriveDevelopmentTaskPackage(input: {
  prompt: unknown;
  title?: unknown;
  objective?: unknown;
  instructions?: unknown;
}): DerivedDevelopmentTaskPackage {
  if (!text(input.prompt, OWNER_PROMPT_MAX_CHARS)) {
    throw new DevelopmentConsoleError(
      'invalid_prompt',
      400,
      'Опишите, что нужно сделать.',
    );
  }

  const prompt = input.prompt.trim();
  const advancedTitle = optionalText(input.title, 200);
  const advancedObjective = optionalText(input.objective, 4000);
  if ((input.title !== undefined && input.title !== null && String(input.title).trim() && !advancedTitle)
    || (input.objective !== undefined && input.objective !== null && String(input.objective).trim() && !advancedObjective)) {
    throw new DevelopmentConsoleError('invalid_task_fields', 400, 'Проверьте расширенные настройки.');
  }

  let advancedInstructions: string[] | null = null;
  if (typeof input.instructions === 'string') {
    const lines = input.instructions.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length && !instructionList(lines)) {
      throw new DevelopmentConsoleError('invalid_task_fields', 400, 'Проверьте инструкции задачи.');
    }
    advancedInstructions = lines.length ? lines : null;
  } else if (input.instructions !== undefined && input.instructions !== null) {
    if (!instructionList(input.instructions)) {
      throw new DevelopmentConsoleError('invalid_task_fields', 400, 'Проверьте инструкции задачи.');
    }
    advancedInstructions = input.instructions;
  }

  const compactPrompt = prompt.replace(/\s+/g, ' ');
  const title = advancedTitle ?? truncateText(compactPrompt, DERIVED_TITLE_MAX_CHARS);
  const objective = advancedObjective ?? truncateText(`Выполнить запрос владельца: ${compactPrompt}`, 4000);
  const instructions = advancedInstructions ?? promptInstructionLines(prompt);
  const acceptanceCriteria = [
    `Запрос владельца выполнен: ${truncateText(compactPrompt, 900)}`,
    'Добавлены или обновлены focused tests для изменённого поведения.',
    'Typecheck, ESLint для затронутых файлов и git diff --check проходят.',
  ];

  return {
    title,
    objective,
    instructions,
    acceptanceCriteria,
    safetyConstraints: [...STANDARD_SAFETY_CONSTRAINTS],
  };
}

export type DevelopmentConsoleTaskView = RuntimeBridgeTaskView & {
  repository: string;
  title: string;
};

export type DevelopmentTaskSnapshot = {
  task: DevelopmentConsoleTaskView;
  result: RuntimeBridgeSafeResult | null;
  pendingGates: RuntimeBridgeOwnerGateView[];
  mergeGate: ControlCenterMergeGateView | null;
};

function developmentTaskTitle(request: RuntimeBridgeTaskRequest | null | undefined): string {
  const title = typeof request?.title === 'string' ? request.title.trim() : '';
  return title || 'Задача разработки';
}

export class DevelopmentConsoleError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly messageRu: string,
  ) {
    super(code);
  }
}

function requireClientId(): string {
  const clientId = getRuntimeBridgeClientId();
  if (!clientId || !isRuntimeBridgeSupabaseConfigured()) {
    throw new DevelopmentConsoleError(
      'bridge_not_configured',
      503,
      'Runtime Bridge не настроен.',
    );
  }
  return clientId;
}

function requireOwnerConversation(ownerUserId: string): string {
  if (!ownerUserId || typeof ownerUserId !== 'string') {
    throw new DevelopmentConsoleError('invalid_owner', 400, 'Некорректный владелец.');
  }
  return createDevelopmentConversationId(ownerUserId);
}

function assertOwnerTaskScope(task: RuntimeBridgeTaskView, ownerUserId: string): void {
  const expectedConversationId = requireOwnerConversation(ownerUserId);
  if (task.conversationId !== expectedConversationId) {
    throw new DevelopmentConsoleError('task_not_found', 404, 'Задача не найдена.');
  }
}

function taskContentMatches(
  stored: RuntimeBridgeTaskRequest,
  next: {
    title: string;
    objective: string;
    instructions: string[];
    acceptanceCriteria: string[];
    safetyConstraints: string[];
    repository: string;
  },
): boolean {
  return stored.title === next.title
    && stored.objective === next.objective
    && stored.repository === next.repository
    && stored.instructions.length === next.instructions.length
    && stored.instructions.every((line, index) => line === next.instructions[index])
    && (stored.acceptanceCriteria ?? []).length === next.acceptanceCriteria.length
    && (stored.acceptanceCriteria ?? []).every((line, index) => line === next.acceptanceCriteria[index])
    && (stored.safetyConstraints ?? []).length === next.safetyConstraints.length
    && (stored.safetyConstraints ?? []).every((line, index) => line === next.safetyConstraints[index]);
}

function mapBridgeError(error: unknown): never {
  if (error instanceof DevelopmentConsoleError) throw error;
  if (error instanceof BaselineShaError) {
    throw new DevelopmentConsoleError(
      error.code,
      502,
      'Не удалось получить актуальный baseline SHA репозитория.',
    );
  }
  if (error instanceof RuntimeBridgeError) {
    const messages: Record<string, string> = {
      bridge_not_configured: 'Runtime Bridge не настроен.',
      task_not_found: 'Задача не найдена.',
      idempotency_conflict: 'Повторный запрос с другим содержимым отклонён.',
      decision_conflict: 'Решение по этому gate уже принято с другим значением.',
      owner_gate_mismatch: 'Gate не принадлежит этой задаче или уже недоступен.',
    };
    throw new DevelopmentConsoleError(
      error.code,
      error.status,
      messages[error.code] ?? 'Ошибка Runtime Bridge.',
    );
  }
  throw new DevelopmentConsoleError('runtime_bridge_error', 500, 'Не удалось выполнить операцию.');
}

function pullRequestArtifact(result: RuntimeBridgeSafeResult | null): string | null {
  const value = result?.artifacts.find((artifact) => artifact.type === 'pull_request')?.value;
  return safeAllowlistedPullRequestUrl(value);
}

function commitArtifact(result: RuntimeBridgeSafeResult | null): string | null {
  const value = result?.artifacts.find((artifact) => artifact.type === 'commit')?.value ?? '';
  return isExactGitSha(value) ? value : null;
}

function resolveStoredTaskRepository(
  value: string | null | undefined,
): string | null {
  const fullName = String(value ?? '').trim();
  if (!fullName || !isAllowlistedDevelopmentRepositoryFullName(fullName)) {
    return null;
  }
  return fullName;
}

function unavailablePullRequest(
  pullRequestUrl: string,
  expectedSha: string,
): ControlCenterPullRequest {
  const parsed = resolveAllowlistedPullRequestIdentity(pullRequestUrl);
  return {
    repository: parsed.repository,
    pullRequestNumber: parsed.pullRequestNumber,
    pullRequestUrl: parsed.safeUrl,
    headSha: expectedSha,
    merged: false,
    mergeCommitSha: null,
  };
}

function repositoryMismatchPullRequest(
  pullRequestUrl: string,
  expectedSha: string,
): ControlCenterPullRequest {
  return unavailablePullRequest(pullRequestUrl, expectedSha);
}

async function resolveDevelopmentMergeGate(
  result: RuntimeBridgeSafeResult | null,
  taskRepositoryValue: string | null | undefined,
): Promise<ControlCenterMergeGateView | null> {
  const pullRequestUrl = pullRequestArtifact(result);
  if (!pullRequestUrl) return null;
  const resultSha = commitArtifact(result) ?? '0000000000000000000000000000000000000000';
  const taskRepository = resolveStoredTaskRepository(taskRepositoryValue);
  let pullRequestIdentity: ReturnType<typeof resolveAllowlistedPullRequestIdentity> | null = null;
  try {
    pullRequestIdentity = resolveAllowlistedPullRequestIdentity(pullRequestUrl);
  } catch {
    pullRequestIdentity = null;
  }

  if (!taskRepository || !pullRequestIdentity || taskRepository !== pullRequestIdentity.repository) {
    return blockedTaskRepositoryMismatchMergeGate({
      pullRequest: repositoryMismatchPullRequest(pullRequestUrl, resultSha),
      expectedSha: resultSha,
    });
  }

  let pullRequest: ControlCenterPullRequest;
  try {
    pullRequest = await controlCenterMergeDependencies.loadPullRequest(pullRequestUrl);
  } catch {
    return unavailableControlCenterMergeGate({
      pullRequest: unavailablePullRequest(pullRequestUrl, resultSha),
      expectedSha: resultSha,
      message: 'Не удалось проверить текущую версию PR. Объединение заблокировано.',
    });
  }

  try {
    const records = await controlCenterMergeDependencies.loadOwnerDecisionRecords(pullRequest);
    return evaluateControlCenterMergeGate({
      pullRequest,
      expectedSha: pullRequest.headSha,
      records,
    });
  } catch (error) {
    const transportFailure = error instanceof GitHubControlCenterError
      && error.code === 'owner_gate_unavailable';
    return unavailableControlCenterMergeGate({
      pullRequest,
      expectedSha: pullRequest.headSha,
      message: transportFailure
        ? 'Не удалось связаться с GitHub для проверки решения владельца. Объединение заблокировано.'
        : 'Не удалось проверить решение владельца. Объединение заблокировано.',
    });
  }
}

export async function buildDevelopmentTaskSnapshot(
  taskId: string,
  ownerUserId: string,
): Promise<DevelopmentTaskSnapshot> {
  const clientId = requireClientId();
  if (!UUID.test(taskId)) {
    throw new DevelopmentConsoleError('invalid_task_id', 400, 'Некорректный идентификатор задачи.');
  }

  try {
    const record = await getRuntimeBridgeTaskRecord(clientId, taskId);
    assertOwnerTaskScope(record, ownerUserId);

    let result: RuntimeBridgeSafeResult | null = null;
    let pendingGates: RuntimeBridgeOwnerGateView[] = [];
    let mergeGate: ControlCenterMergeGateView | null = null;

    if (record.status === 'completed' || record.status === 'failed') {
      const payload = await getRuntimeBridgeResult(clientId, taskId);
      result = payload.result;
      mergeGate = await resolveDevelopmentMergeGate(result, record.request.repository);
    }

    if (record.status === 'awaiting_owner') {
      const gates = await listRuntimeBridgeOwnerGates(clientId);
      pendingGates = gates.filter((gate) => gate.taskId === record.taskId && gate.status === 'pending');
    }

    return {
      task: {
        taskId: record.taskId,
        chatgptTaskId: record.chatgptTaskId,
        conversationId: record.conversationId,
        status: record.status,
        attemptCount: record.attemptCount,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        repository: String(record.request.repository ?? '').trim(),
        title: developmentTaskTitle(record.request),
      },
      result,
      pendingGates,
      mergeGate,
    };
  } catch (error) {
    mapBridgeError(error);
  }
}

export async function submitDevelopmentMergeRequest(input: {
  ownerUserId: string;
  taskId: unknown;
  pullRequestUrl: unknown;
  expectedHeadSha: unknown;
}): Promise<ControlCenterMergeOutcome> {
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  const expectedHeadSha = typeof input.expectedHeadSha === 'string'
    ? input.expectedHeadSha.trim().toLowerCase()
    : '';
  const pullRequestUrl = safeAllowlistedPullRequestUrl(
    typeof input.pullRequestUrl === 'string' ? input.pullRequestUrl : null,
  );
  if (!UUID.test(taskId) || !pullRequestUrl || !isExactGitSha(expectedHeadSha)) {
    throw new DevelopmentConsoleError('invalid_merge_request', 400, 'Некорректный запрос на объединение PR.');
  }

  const clientId = requireClientId();
  try {
    const record = await getRuntimeBridgeTaskRecord(clientId, taskId);
    assertOwnerTaskScope(record, input.ownerUserId);
    if (record.status !== 'completed') {
      throw new DevelopmentConsoleError(
        'merge_task_not_completed',
        409,
        'Задача ещё не завершена. Объединение заблокировано.',
      );
    }
    const result = (await getRuntimeBridgeResult(clientId, taskId)).result;
    if (pullRequestArtifact(result) !== pullRequestUrl) {
      throw new DevelopmentConsoleError(
        'merge_pull_request_mismatch',
        409,
        'PR не принадлежит этой задаче.',
      );
    }

    const taskRepository = resolveStoredTaskRepository(record.request.repository);
    let pullRequestIdentity: ReturnType<typeof resolveAllowlistedPullRequestIdentity> | null = null;
    try {
      pullRequestIdentity = resolveAllowlistedPullRequestIdentity(pullRequestUrl);
    } catch {
      pullRequestIdentity = null;
    }
    if (!taskRepository || !pullRequestIdentity || taskRepository !== pullRequestIdentity.repository) {
      const gate = blockedTaskRepositoryMismatchMergeGate({
        pullRequest: repositoryMismatchPullRequest(pullRequestUrl, expectedHeadSha),
        expectedSha: expectedHeadSha,
      });
      return { gate, merged: false, deduplicated: false, mergeCommitSha: null };
    }

    let pullRequest: ControlCenterPullRequest;
    try {
      pullRequest = await controlCenterMergeDependencies.loadPullRequest(pullRequestUrl);
    } catch {
      pullRequest = unavailablePullRequest(pullRequestUrl, expectedHeadSha);
      const gate = unavailableControlCenterMergeGate({
        pullRequest,
        expectedSha: expectedHeadSha,
        message: 'Не удалось проверить текущую версию PR. Объединение заблокировано.',
      });
      return { gate, merged: false, deduplicated: false, mergeCommitSha: null };
    }

    try {
      return await requestControlCenterMerge(
        { pullRequestUrl, expectedSha: expectedHeadSha },
        controlCenterMergeDependencies,
      );
    } catch (error) {
      const provider = error instanceof GitHubControlCenterError ? error.code : 'merge_provider_rejected';
      const code = provider === 'merge_provider_not_configured'
        ? 'merge_provider_not_configured'
        : provider === 'owner_gate_unavailable'
          ? 'owner_gate_unavailable'
          : 'merge_provider_rejected';
      const message = code === 'merge_provider_not_configured'
        ? 'Серверное объединение PR не настроено.'
        : code === 'owner_gate_unavailable'
          ? 'Не удалось проверить решение владельца. Объединение заблокировано.'
          : 'GitHub отклонил объединение. Запрос безопасно остановлен.';
      const gate = unavailableControlCenterMergeGate({
        pullRequest,
        expectedSha: expectedHeadSha,
        code,
        message,
      });
      return { gate, merged: false, deduplicated: false, mergeCommitSha: pullRequest.mergeCommitSha };
    }
  } catch (error) {
    mapBridgeError(error);
  }
}

export async function submitDevelopmentTask(input: {
  ownerUserId: string;
  repositoryId: unknown;
  prompt: unknown;
  title?: unknown;
  objective?: unknown;
  instructions?: unknown;
  idempotencyKey?: unknown;
  /** Must be ignored if present — never trusted from the browser. */
  baselineSha?: unknown;
}): Promise<{ snapshot: DevelopmentTaskSnapshot; deduplicated: boolean }> {
  if (input.baselineSha !== undefined) {
    throw new DevelopmentConsoleError(
      'baseline_sha_forbidden',
      400,
      'Baseline SHA задаётся только сервером.',
    );
  }

  const repository = resolveDevelopmentRepository(
    typeof input.repositoryId === 'string' ? input.repositoryId : null,
  );
  if (!repository) {
    throw new DevelopmentConsoleError(
      'repository_not_allowed',
      400,
      'Репозиторий не разрешён для консоли разработки.',
    );
  }

  const taskPackage = deriveDevelopmentTaskPackage(input);

  const idempotencyKey = normalizeClientIdempotencyKey(input.idempotencyKey);
  if (!idempotencyKey) {
    throw new DevelopmentConsoleError(
      'idempotency_key_required',
      400,
      'Требуется корректный ключ идемпотентности.',
    );
  }

  const clientId = requireClientId();
  const conversationId = requireOwnerConversation(input.ownerUserId);
  const chatgptTaskId = createDevelopmentChatgptTaskId(input.ownerUserId, idempotencyKey);
  const normalizedContent = {
    ...taskPackage,
    repository: repository.fullName,
  };

  try {
    const existing = await findRuntimeBridgeTaskByIdempotencyKey(clientId, idempotencyKey);
    if (existing) {
      if (
        existing.conversationId !== conversationId
        || !taskContentMatches(existing.request, normalizedContent)
      ) {
        throw new DevelopmentConsoleError(
          'idempotency_conflict',
          409,
          'Повторный запрос с другим содержимым отклонён.',
        );
      }

      const snapshot = await buildDevelopmentTaskSnapshot(existing.taskId, input.ownerUserId);
      snapshot.task.repository = repository.fullName;
      return { snapshot, deduplicated: true };
    }

    const baselineSha = await resolveAllowlistedBaselineSha(repository);
    const submitted = await submitRuntimeBridgeTask(clientId, {
      chatgptTaskId,
      conversationId,
      idempotencyKey,
      task: {
        ...taskPackage,
        repository: repository.fullName,
        baselineSha,
      },
    });

    const snapshot = await buildDevelopmentTaskSnapshot(submitted.task.taskId, input.ownerUserId);
    snapshot.task.repository = repository.fullName;
    return { snapshot, deduplicated: submitted.deduplicated };
  } catch (error) {
    mapBridgeError(error);
  }
}

export async function submitDevelopmentOwnerDecision(input: {
  ownerUserId: string;
  taskId: unknown;
  gateId: unknown;
  taskCycle: unknown;
  decision: unknown;
  note?: unknown;
}): Promise<{ snapshot: DevelopmentTaskSnapshot; deduplicated: boolean }> {
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  const gateId = typeof input.gateId === 'string' ? input.gateId.trim() : '';
  const taskCycle = typeof input.taskCycle === 'string' ? input.taskCycle.trim() : '';
  const decision = input.decision;

  if (!UUID.test(taskId) || !UUID.test(gateId)) {
    throw new DevelopmentConsoleError('invalid_decision', 400, 'Некорректные идентификаторы решения.');
  }
  if (!taskCycle || taskCycle.length > 200) {
    throw new DevelopmentConsoleError('invalid_decision', 400, 'Некорректный цикл задачи.');
  }
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new DevelopmentConsoleError('invalid_decision', 400, 'Допустимы только approved или rejected.');
  }

  let note: string | undefined;
  if (input.note !== undefined) {
    if (typeof input.note !== 'string' || input.note.trim().length === 0 || input.note.length > 2000) {
      throw new DevelopmentConsoleError('invalid_note', 400, 'Комментарий слишком длинный или пустой.');
    }
    if (containsForbiddenStringContent(input.note.trim())) {
      throw new DevelopmentConsoleError('invalid_note', 400, 'Комментарий содержит недопустимые данные.');
    }
    note = input.note.trim();
  }

  const clientId = requireClientId();

  try {
    const task = await getRuntimeBridgeTask(clientId, taskId);
    assertOwnerTaskScope(task, input.ownerUserId);

    const gate = await getRuntimeBridgeOwnerGate(clientId, gateId);
    if (!gate || gate.taskId !== taskId) {
      throw new DevelopmentConsoleError(
        'owner_gate_mismatch',
        409,
        'Gate не принадлежит этой задаче или уже недоступен.',
      );
    }
    if (gate.taskCycle !== taskCycle) {
      throw new DevelopmentConsoleError(
        'owner_gate_mismatch',
        409,
        'Cycle gate не совпадает с ожидаемым.',
      );
    }
    if (gate.status === 'expired' || (gate.status === 'pending' && Date.parse(gate.expiresAt) <= Date.now())) {
      throw new DevelopmentConsoleError(
        'owner_gate_expired',
        409,
        'Срок действия gate истёк.',
      );
    }

    // Already-decided gates must reach the Bridge RPC so exact retries can dedupe.
    const decided = await submitRuntimeBridgeOwnerDecision(clientId, {
      taskId,
      gateId,
      taskCycle,
      decision,
      decisionId: createDevelopmentDecisionId({ taskId, gateId, taskCycle, decision }),
      source: 'explicit_owner_message',
      note,
    });

    const snapshot = await buildDevelopmentTaskSnapshot(decided.task.taskId, input.ownerUserId);
    return { snapshot, deduplicated: decided.deduplicated };
  } catch (error) {
    mapBridgeError(error);
  }
}
