import 'server-only';
import {
  findRuntimeBridgeTaskByIdempotencyKey,
  submitRuntimeBridgeTask,
  RuntimeBridgeError,
} from '@/lib/asi-runtime/bridge-repository';
import { getRuntimeBridgeClientId } from '@/lib/asi-runtime/bridge-auth';
import { isRuntimeBridgeSupabaseConfigured } from '@/lib/asi-runtime/bridge-supabase';
import type { RuntimeBridgeTaskRequest } from '@/lib/asi-runtime/bridge-types';
import { BaselineShaError, resolveAllowlistedBaselineSha } from '@/lib/development/baseline-sha';
import { normalizeClientIdempotencyKey } from '@/lib/development/ids';
import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from '@/lib/development/repositories';
import {
  createPilotChatgptTaskId,
  createPilotConversationId,
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
  getPilotTaskForUser,
  type PilotTaskView,
} from './task-access';
import { PilotAccessError } from './errors';

function requireClientId(): string {
  const clientId = getRuntimeBridgeClientId();
  if (!clientId || !isRuntimeBridgeSupabaseConfigured()) {
    throw new PilotAccessError(
      'bridge_not_configured',
      503,
      'Runtime Bridge не настроен.',
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
      'Не удалось получить актуальный baseline SHA репозитория.',
    );
  }
  if (error instanceof RuntimeBridgeError) {
    const messages: Record<string, string> = {
      bridge_not_configured: 'Runtime Bridge не настроен.',
      task_not_found: 'Задача не найдена.',
      idempotency_conflict: 'Повторный запрос с другим содержимым отклонён.',
    };
    throw new PilotAccessError(
      error.code,
      error.status,
      messages[error.code] ?? 'Ошибка Runtime Bridge.',
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
