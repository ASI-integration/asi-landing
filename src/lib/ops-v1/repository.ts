import {
  createOpsOperatorTask,
  listOpsOperatorTasks,
  updateOpsOperatorTask,
} from '@/lib/ops-board/repository';
import { OPS_TASK_TYPE_LABELS } from '@/lib/ops-board/types';
import { syncAutoOpsTasks } from './auto-tasks';
import { mapOperatorTaskToV1, mapV1StatusToOperator, mapV1TypeToOperator } from './mapping';
import type {
  CreateOpsV1TaskInput,
  OpsV1ListFilter,
  OpsV1Summary,
  OpsV1Task,
  UpdateOpsV1TaskInput,
} from './types';

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

export function isActiveV1Status(status: OpsV1Task['status']): boolean {
  return status !== 'done';
}

export function buildOpsV1Summary(tasks: OpsV1Task[]): OpsV1Summary {
  const activeTasks = tasks.filter((task) => isActiveV1Status(task.status));

  return {
    checkinsToday: activeTasks.filter(
      (task) => task.taskType === 'checkin' && isToday(task.scheduledAt),
    ).length,
    checkoutsToday: activeTasks.filter(
      (task) => task.taskType === 'checkout' && isToday(task.scheduledAt),
    ).length,
    cleaningNeeded: activeTasks.filter((task) => task.taskType === 'cleaning').length,
    needsAttention: activeTasks.filter((task) => task.status === 'needs_attention').length,
  };
}

function mapListFilterToOperator(filter: OpsV1ListFilter): 'active' | 'done' | 'all' {
  if (filter === 'done') return 'done';
  if (filter === 'all') return 'all';
  return 'active';
}

export async function listOpsV1Tasks(options?: {
  syncAuto?: boolean;
  filter?: OpsV1ListFilter;
}): Promise<{
  ok: boolean;
  tasks: OpsV1Task[];
  summary: OpsV1Summary;
  autoSync?: { created: number; scanned: number };
  error?: string;
}> {
  const filter = options?.filter ?? 'active';
  let autoSync: { created: number; scanned: number } | undefined;

  if (options?.syncAuto !== false) {
    try {
      autoSync = await syncAutoOpsTasks();
    } catch (error) {
      console.warn('[ops-v1] auto sync failed', error);
    }
  }

  try {
    const activeResult = await listOpsOperatorTasks({ status: 'active' });
    const activeTasks = activeResult.ok ? activeResult.tasks.map(mapOperatorTaskToV1) : [];
    const summary = buildOpsV1Summary(activeTasks);

    const listResult = await listOpsOperatorTasks({ status: mapListFilterToOperator(filter) });
    if (!listResult.ok) {
      console.warn('[ops-v1] list tasks failed, returning empty', listResult.error);
      return { ok: true, tasks: [], summary, autoSync };
    }

    const tasks = listResult.tasks.map(mapOperatorTaskToV1);
    return { ok: true, tasks, summary, autoSync };
  } catch (error) {
    console.warn('[ops-v1] list tasks error, returning empty', error);
    return { ok: true, tasks: [], summary: buildOpsV1Summary([]), autoSync };
  }
}

export async function createOpsV1Task(
  input: CreateOpsV1TaskInput,
): Promise<{ ok: boolean; task: OpsV1Task | null; created: boolean; error?: string }> {
  const operatorType = mapV1TypeToOperator(input.taskType);
  const title = OPS_TASK_TYPE_LABELS[operatorType];

  const result = await createOpsOperatorTask({
    taskType: operatorType,
    source: 'manual',
    title,
    description: input.comment?.trim() || null,
    objectId: input.propertyId?.trim() || null,
    objectLabel: input.objectLabel?.trim() || input.propertyId?.trim() || null,
    metadata: {
      created_by_system: false,
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
    },
  });

  if (!result.ok || !result.task) {
    return { ok: false, task: null, created: false, error: result.error };
  }

  return { ok: true, task: mapOperatorTaskToV1(result.task), created: result.created };
}

export async function updateOpsV1Task(
  taskId: string,
  input: UpdateOpsV1TaskInput,
): Promise<{ ok: boolean; task: OpsV1Task | null; error?: string }> {
  const result = await updateOpsOperatorTask(taskId, {
    taskStatus: mapV1StatusToOperator(input.status),
  });

  if (!result.ok || !result.task) {
    return { ok: false, task: null, error: result.error };
  }

  return { ok: true, task: mapOperatorTaskToV1(result.task) };
}
