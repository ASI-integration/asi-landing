import 'server-only';
import { getRuntimeBridgeClientId } from '@/lib/asi-runtime/bridge-auth';
import {
  getRuntimeBridgeResult,
  getRuntimeBridgeTask,
  listRuntimeBridgeOwnerGates,
  RuntimeBridgeError,
  submitRuntimeBridgeOwnerDecision,
  submitRuntimeBridgeTask,
} from '@/lib/asi-runtime/bridge-repository';
import type {
  RuntimeBridgeOwnerGateView,
  RuntimeBridgeSafeResult,
  RuntimeBridgeTaskView,
} from '@/lib/asi-runtime/bridge-types';
import { containsForbiddenStringContent } from '@/lib/asi-runtime/ingest-schema';
import { BaselineShaError, resolveAllowlistedBaselineSha } from './baseline-sha';
import {
  createDevelopmentChatgptTaskId,
  createDevelopmentConversationId,
  createDevelopmentDecisionId,
  createDevelopmentIdempotencyKey,
  normalizeClientIdempotencyKey,
} from './ids';
import { resolveDevelopmentRepository } from './repositories';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export type DevelopmentTaskSnapshot = {
  task: RuntimeBridgeTaskView & { repository: string };
  result: RuntimeBridgeSafeResult | null;
  pendingGates: RuntimeBridgeOwnerGateView[];
};

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
  if (!clientId) {
    throw new DevelopmentConsoleError(
      'bridge_not_configured',
      503,
      'Runtime Bridge не настроен.',
    );
  }
  return clientId;
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

export async function buildDevelopmentTaskSnapshot(taskId: string): Promise<DevelopmentTaskSnapshot> {
  const clientId = requireClientId();
  if (!UUID.test(taskId)) {
    throw new DevelopmentConsoleError('invalid_task_id', 400, 'Некорректный идентификатор задачи.');
  }

  try {
    const task = await getRuntimeBridgeTask(clientId, taskId);
    let result: RuntimeBridgeSafeResult | null = null;
    let pendingGates: RuntimeBridgeOwnerGateView[] = [];

    if (task.status === 'completed' || task.status === 'failed') {
      const payload = await getRuntimeBridgeResult(clientId, taskId);
      result = payload.result;
    }

    if (task.status === 'awaiting_owner') {
      const gates = await listRuntimeBridgeOwnerGates(clientId);
      pendingGates = gates.filter((gate) => gate.taskId === task.taskId && gate.status === 'pending');
    }

    return {
      task: {
        ...task,
        repository: 'ASI-integration/asi-landing',
      },
      result,
      pendingGates,
    };
  } catch (error) {
    mapBridgeError(error);
  }
}

export async function submitDevelopmentTask(input: {
  ownerUserId: string;
  repositoryId: unknown;
  title: unknown;
  objective: unknown;
  instructions: unknown;
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

  if (!text(input.title, 200) || !text(input.objective, 4000)) {
    throw new DevelopmentConsoleError(
      'invalid_task_fields',
      400,
      'Проверьте название и цель задачи.',
    );
  }

  let instructions: string[];
  if (typeof input.instructions === 'string') {
    const lines = input.instructions
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!textList(lines, 30, 2000)) {
      throw new DevelopmentConsoleError(
        'invalid_task_fields',
        400,
        'Проверьте инструкции задачи.',
      );
    }
    instructions = lines;
  } else if (textList(input.instructions, 30, 2000)) {
    instructions = input.instructions;
  } else {
    throw new DevelopmentConsoleError(
      'invalid_task_fields',
      400,
      'Проверьте инструкции задачи.',
    );
  }

  const idempotencyKey =
    normalizeClientIdempotencyKey(input.idempotencyKey) ?? createDevelopmentIdempotencyKey();

  const clientId = requireClientId();

  try {
    const baselineSha = await resolveAllowlistedBaselineSha(repository);
    const submitted = await submitRuntimeBridgeTask(clientId, {
      chatgptTaskId: createDevelopmentChatgptTaskId(),
      conversationId: createDevelopmentConversationId(input.ownerUserId),
      idempotencyKey,
      task: {
        title: input.title,
        objective: input.objective,
        instructions,
        repository: repository.fullName,
        baselineSha,
      },
    });

    const snapshot = await buildDevelopmentTaskSnapshot(submitted.task.taskId);
    snapshot.task.repository = repository.fullName;
    return { snapshot, deduplicated: submitted.deduplicated };
  } catch (error) {
    mapBridgeError(error);
  }
}

export async function submitDevelopmentOwnerDecision(input: {
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
    const gates = await listRuntimeBridgeOwnerGates(clientId);
    const gate = gates.find((item) => item.gateId === gateId);
    if (!gate || gate.taskId !== taskId) {
      throw new DevelopmentConsoleError(
        'owner_gate_mismatch',
        409,
        'Gate не принадлежит этой задаче или уже недоступен.',
      );
    }
    if (gate.status !== 'pending') {
      throw new DevelopmentConsoleError(
        'owner_gate_unavailable',
        409,
        'Gate уже обработан или истёк.',
      );
    }
    if (gate.taskCycle !== taskCycle) {
      throw new DevelopmentConsoleError(
        'owner_gate_mismatch',
        409,
        'Cycle gate не совпадает с ожидаемым.',
      );
    }
    if (Date.parse(gate.expiresAt) <= Date.now()) {
      throw new DevelopmentConsoleError(
        'owner_gate_expired',
        409,
        'Срок действия gate истёк.',
      );
    }

    const decided = await submitRuntimeBridgeOwnerDecision(clientId, {
      taskId,
      gateId,
      taskCycle,
      decision,
      decisionId: createDevelopmentDecisionId({ taskId, gateId, taskCycle, decision }),
      source: 'explicit_owner_message',
      note,
    });

    const snapshot = await buildDevelopmentTaskSnapshot(decided.task.taskId);
    return { snapshot, deduplicated: decided.deduplicated };
  } catch (error) {
    mapBridgeError(error);
  }
}
