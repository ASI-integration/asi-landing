import 'server-only';
import { getRuntimeBridgeClientId } from '@/lib/asi-runtime/bridge-auth';
import {
  getRuntimeBridgeResult,
  getRuntimeBridgeTaskRecord,
  listRuntimeBridgeTasks,
  RuntimeBridgeError,
  type RuntimeBridgeTaskRecord,
} from '@/lib/asi-runtime/bridge-repository';
import type { RuntimeBridgeTaskRequest, RuntimeBridgeTaskView } from '@/lib/asi-runtime/bridge-types';
import { isRuntimeBridgeSupabaseConfigured } from '@/lib/asi-runtime/bridge-supabase';
import { createPilotConversationId } from './ids';
import { PilotAccessError } from './errors';
import { buildPilotSafeResultView, type PilotSafeResultView } from './result-view';
import { normalizePilotConsoleStatus, type PilotConsoleStatus } from './status';

export { PilotAccessError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PilotTaskView = RuntimeBridgeTaskView & {
  title: string;
  repository: string;
  consoleStatus: PilotConsoleStatus;
};

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

export function requirePilotConversation(pilotUserId: string): string {
  if (!pilotUserId || typeof pilotUserId !== 'string') {
    throw new PilotAccessError('invalid_pilot', 400, 'Некорректный пользователь пилота.');
  }
  return createPilotConversationId(pilotUserId);
}

/**
 * Server-side ownership check: task conversation must match this pilot user.
 * Cross-user access fails closed as not-found (no existence leak).
 */
export function assertPilotTaskScope(
  task: Pick<RuntimeBridgeTaskView, 'conversationId'>,
  pilotUserId: string,
): void {
  const expectedConversationId = requirePilotConversation(pilotUserId);
  if (task.conversationId !== expectedConversationId) {
    throw new PilotAccessError('task_not_found', 404, 'Задача не найдена.');
  }
}

function pilotTaskTitle(request: RuntimeBridgeTaskRequest | null | undefined): string {
  const title = typeof request?.title === 'string' ? request.title.trim() : '';
  return title || 'Задача пилота';
}

function toPilotTaskView(record: RuntimeBridgeTaskRecord): PilotTaskView {
  return {
    taskId: record.taskId,
    chatgptTaskId: record.chatgptTaskId,
    conversationId: record.conversationId,
    status: record.status,
    attemptCount: record.attemptCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    title: pilotTaskTitle(record.request),
    repository: record.request?.repository ?? 'ASI-integration/asi-landing',
    consoleStatus: normalizePilotConsoleStatus(record.status),
  };
}

function mapBridgeError(error: unknown): never {
  if (error instanceof PilotAccessError) throw error;
  if (error instanceof RuntimeBridgeError) {
    const messages: Record<string, string> = {
      bridge_not_configured: 'Runtime Bridge не настроен.',
      task_not_found: 'Задача не найдена.',
    };
    throw new PilotAccessError(
      error.code,
      error.status,
      messages[error.code] ?? 'Ошибка Runtime Bridge.',
    );
  }
  throw new PilotAccessError('runtime_bridge_error', 500, 'Не удалось выполнить операцию.');
}

export type PilotTaskHistoryItem = {
  taskId: string;
  title: string;
  status: RuntimeBridgeTaskView['status'];
  consoleStatus: PilotConsoleStatus;
  repository: string;
  createdAt: string;
  updatedAt: string;
};

export type PilotTaskDetail = {
  task: PilotTaskView;
  result: PilotSafeResultView;
};

/**
 * List only tasks in this pilot user's conversation namespace.
 */
export async function listPilotTasksForUser(
  pilotUserId: string,
  options?: { limit?: number },
): Promise<PilotTaskHistoryItem[]> {
  const clientId = requireClientId();
  const conversationId = requirePilotConversation(pilotUserId);

  try {
    const tasks = await listRuntimeBridgeTasks(clientId, conversationId, options);
    return tasks.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      consoleStatus: normalizePilotConsoleStatus(task.status),
      repository: task.repository,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }));
  } catch (error) {
    mapBridgeError(error);
  }
}

/**
 * Load one task; enforce pilot ownership on the server.
 */
export async function getPilotTaskForUser(
  taskId: string,
  pilotUserId: string,
): Promise<PilotTaskView> {
  const clientId = requireClientId();
  if (!UUID.test(taskId)) {
    throw new PilotAccessError('invalid_task_id', 400, 'Некорректный идентификатор задачи.');
  }

  try {
    const record = await getRuntimeBridgeTaskRecord(clientId, taskId);
    assertPilotTaskScope(record, pilotUserId);
    return toPilotTaskView(record);
  } catch (error) {
    mapBridgeError(error);
  }
}

/**
 * SP-04: task + normalized console status + safe result (Bridge-backed).
 */
export async function getPilotTaskDetailForUser(
  taskId: string,
  pilotUserId: string,
): Promise<PilotTaskDetail> {
  const clientId = requireClientId();
  if (!UUID.test(taskId)) {
    throw new PilotAccessError('invalid_task_id', 400, 'Некорректный идентификатор задачи.');
  }

  try {
    const record = await getRuntimeBridgeTaskRecord(clientId, taskId);
    assertPilotTaskScope(record, pilotUserId);
    const task = toPilotTaskView(record);

    let bridgeResult = null;
    if (record.status === 'completed' || record.status === 'failed') {
      const payload = await getRuntimeBridgeResult(clientId, taskId);
      bridgeResult = payload.result;
    }

    return {
      task,
      result: buildPilotSafeResultView({
        consoleStatus: task.consoleStatus,
        bridgeResult,
      }),
    };
  } catch (error) {
    mapBridgeError(error);
  }
}
