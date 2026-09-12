import 'server-only';
import {
  findRuntimeBridgeTaskByIdempotencyKey,
  getRuntimeBridgeOwnerGate,
  submitRuntimeBridgeOwnerDecision,
  submitRuntimeBridgeTask,
  RuntimeBridgeError,
} from '@/lib/asi-runtime/bridge-repository';
import { getRuntimeBridgeClientId } from '@/lib/asi-runtime/bridge-auth';
import { isRuntimeBridgeSupabaseConfigured } from '@/lib/asi-runtime/bridge-supabase';
import type { RuntimeBridgeTaskRequest } from '@/lib/asi-runtime/bridge-types';
import { containsForbiddenStringContent } from '@/lib/asi-runtime/ingest-schema';
import { BaselineShaError, resolveAllowlistedBaselineSha } from '@/lib/development/baseline-sha';
import { normalizeClientIdempotencyKey } from '@/lib/development/ids';
import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from '@/lib/development/repositories';
import { canContinuePilotOwnerGate } from './hitl';
import {
  createPilotChatgptTaskId,
  createPilotConversationId,
  createPilotDecisionId,
} from './ids';
import {
  assertNoPrivilegedPilotFields,
  buildPilotGreenTemplate,
  PILOT_FIXED_REPOSITORY,
  PILOT_FIXED_REPOSITORY_ID,
  toBridgeTaskRequest,
  type PilotGreenTemplatePackage,
} from './template';
import { assertPilotCreateRateLimit } from './rate-limit';
import { assertPilotBridgeHandoffInput } from './provenance';
import { assertPilotSubmissionReady } from './readiness';
import {
  assertPilotTaskScope,
  getPilotTaskDetailForUser,
  getPilotTaskForUser,
  type PilotTaskDetail,
  type PilotTaskView,
} from './task-access';
import { PilotAccessError } from './errors';
import { PILOT_USER_STATE } from './user-copy';

function requireClientId(): string {
  const clientId = getRuntimeBridgeClientId();
  if (!clientId || !isRuntimeBridgeSupabaseConfigured()) {
    throw new PilotAccessError(
      'bridge_not_configured',
      503,
      'Временно недоступно',
    );
  }
  return clientId;
}

function pilotRepositoryDefinition() {
  const repo = DEVELOPMENT_REPOSITORY_ALLOWLIST.find((item) => item.id === PILOT_FIXED_REPOSITORY_ID);
  if (!repo || repo.fullName !== PILOT_FIXED_REPOSITORY) {
    throw new PilotAccessError(
      'pilot_repository_misconfigured',
      500,
      'Репозиторий пилота не настроен.',
    );
  }
  return repo;
}

function taskContentMatches(
  stored: RuntimeBridgeTaskRequest,
  next: RuntimeBridgeTaskRequest,
): boolean {
  return stored.title === next.title
    && stored.objective === next.objective
    && stored.repository === next.repository
    && stored.instructions.length === next.instructions.length
    && stored.instructions.every((line, index) => line === next.instructions[index])
    && (stored.acceptanceCriteria ?? []).length === (next.acceptanceCriteria ?? []).length
    && (stored.acceptanceCriteria ?? []).every((line, index) => line === (next.acceptanceCriteria ?? [])[index])
    && (stored.safetyConstraints ?? []).length === (next.safetyConstraints ?? []).length
    && (stored.safetyConstraints ?? []).every((line, index) => line === (next.safetyConstraints ?? [])[index]);
}

function mapBridgeError(error: unknown): never {
  if (error instanceof PilotAccessError) throw error;
  if (error instanceof BaselineShaError) {
    throw new PilotAccessError(
      error.code,
      502,
      'Временно недоступно',
    );
  }
  if (error instanceof RuntimeBridgeError) {
    const messages: Record<string, string> = {
      bridge_not_configured: 'Временно недоступно',
      task_not_found: 'Задача не найдена.',
      admission_busy: 'Временно недоступно',
      idempotency_conflict: 'Повторный запрос с другим содержимым отклонён.',
      owner_gate_mismatch: 'Нельзя продолжить задачу. Обновите страницу.',
      decision_conflict: 'Это решение уже обработано.',
    };
    throw new PilotAccessError(
      error.code,
      error.status,
      messages[error.code] ?? 'Временно недоступно',
    );
  }
  throw new PilotAccessError('runtime_bridge_error', 500, 'Не удалось выполнить операцию.');
}

export type SubmitPilotTaskResult = {
  task: PilotTaskView;
  deduplicated: boolean;
  template: PilotGreenTemplatePackage;
};

/**
 * SP-02: validate green template, bind pilot conversation, submit via existing Bridge seam.
 */
export async function submitPilotTask(input: {
  pilotUserId: string;
  body: Record<string, unknown>;
}): Promise<SubmitPilotTaskResult> {
  assertNoPrivilegedPilotFields(input.body);
  assertPilotCreateRateLimit(input.pilotUserId);
  await assertPilotSubmissionReady();

  const taskPackage = buildPilotGreenTemplate({
    goal: input.body.goal,
    title: input.body.title,
    objective: input.body.objective,
    description: input.body.description,
  });

  const idempotencyKey = normalizeClientIdempotencyKey(input.body.idempotencyKey);
  if (!idempotencyKey) {
    throw new PilotAccessError(
      'idempotency_key_required',
      400,
      'Требуется корректный ключ идемпотентности.',
    );
  }

  const clientId = requireClientId();
  const conversationId = createPilotConversationId(input.pilotUserId);
  const chatgptTaskId = createPilotChatgptTaskId(input.pilotUserId, idempotencyKey);
  const repository = pilotRepositoryDefinition();

  try {
    const existing = await findRuntimeBridgeTaskByIdempotencyKey(clientId, idempotencyKey);
    if (existing) {
      assertPilotTaskScope(existing, input.pilotUserId);
      // Compare without baselineSha — existing row already has server SHA.
      const comparable = {
        title: taskPackage.title,
        objective: taskPackage.objective,
        instructions: taskPackage.instructions,
        acceptanceCriteria: [...taskPackage.acceptanceCriteria],
        safetyConstraints: [...taskPackage.safetyConstraints],
        repository: taskPackage.repository,
        baselineSha: existing.request.baselineSha,
      };
      if (
        existing.conversationId !== conversationId
        || !taskContentMatches(existing.request, comparable)
      ) {
        throw new PilotAccessError(
          'idempotency_conflict',
          409,
          'Повторный запрос с другим содержимым отклонён.',
        );
      }
      const task = await getPilotTaskForUser(existing.taskId, input.pilotUserId);
      return { task, deduplicated: true, template: taskPackage };
    }

    const baselineSha = await resolveAllowlistedBaselineSha(repository);
    const bridgeTask = toBridgeTaskRequest(taskPackage, baselineSha);
    assertPilotBridgeHandoffInput({
      conversationId,
      chatgptTaskId,
      task: bridgeTask,
    });
    const submitted = await submitRuntimeBridgeTask(clientId, {
      chatgptTaskId,
      conversationId,
      idempotencyKey,
      task: bridgeTask,
    });

    const task = await getPilotTaskForUser(submitted.task.taskId, input.pilotUserId);
    return { task, deduplicated: submitted.deduplicated, template: taskPackage };
  } catch (error) {
    mapBridgeError(error);
  }
}

export type SubmitPilotOwnerDecisionResult = PilotTaskDetail & {
  deduplicated: boolean;
};

/**
 * Continue or cancel the SAME awaiting-owner task via the existing owner-gate RPC.
 * Never creates a duplicate task. Privileged merge/deploy gates stay fail-closed.
 */
export async function submitPilotOwnerDecision(input: {
  pilotUserId: string;
  taskId: string;
  body: Record<string, unknown>;
}): Promise<SubmitPilotOwnerDecisionResult> {
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  const gateId = typeof input.body.gateId === 'string' ? input.body.gateId.trim() : '';
  const taskCycle = typeof input.body.taskCycle === 'string' ? input.body.taskCycle.trim() : '';
  const rawDecision = input.body.decision;
  const decision = rawDecision === 'continue'
    ? 'approved'
    : rawDecision === 'cancel'
      ? 'rejected'
      : null;

  if (!taskId || !gateId || !taskCycle || !decision) {
    throw new PilotAccessError(
      'invalid_decision',
      400,
      'Некорректный ответ по задаче.',
    );
  }

  let note: string | undefined;
  if (input.body.note !== undefined) {
    if (typeof input.body.note !== 'string' || input.body.note.trim().length === 0 || input.body.note.length > 2000) {
      throw new PilotAccessError('invalid_note', 400, 'Комментарий слишком длинный или пустой.');
    }
    if (containsForbiddenStringContent(input.body.note.trim())) {
      throw new PilotAccessError('invalid_note', 400, 'Комментарий содержит недопустимые данные.');
    }
    note = input.body.note.trim();
  }

  const owned = await getPilotTaskForUser(taskId, input.pilotUserId);
  if (owned.status !== 'awaiting_owner') {
    throw new PilotAccessError(
      'hitl_not_available',
      409,
      PILOT_USER_STATE.needsAnswer,
    );
  }

  const clientId = requireClientId();
  try {
    const gate = await getRuntimeBridgeOwnerGate(clientId, gateId);
    if (!gate || gate.taskId !== taskId || gate.taskCycle !== taskCycle) {
      throw new PilotAccessError(
        'owner_gate_mismatch',
        409,
        'Нельзя продолжить задачу. Обновите страницу.',
      );
    }
    if (!canContinuePilotOwnerGate(gate)) {
      throw new PilotAccessError(
        'hitl_not_available',
        403,
        'Этот вопрос нельзя закрыть из пилота. Обратитесь к владельцу ASI.',
      );
    }

    const decided = await submitRuntimeBridgeOwnerDecision(clientId, {
      taskId,
      gateId,
      taskCycle,
      decision,
      decisionId: createPilotDecisionId({ taskId, gateId, taskCycle, decision }),
      source: 'explicit_owner_message',
      note,
    });

    if (decided.task.taskId !== taskId) {
      throw new PilotAccessError('runtime_bridge_error', 500, 'Временно недоступно');
    }

    const detail = await getPilotTaskDetailForUser(taskId, input.pilotUserId);
    return { ...detail, deduplicated: decided.deduplicated };
  } catch (error) {
    mapBridgeError(error);
  }
}
