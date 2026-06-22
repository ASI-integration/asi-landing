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

function isOpenStatus(status: OpsV1Task['status']): boolean {
  return status !== 'done';
}

export function buildOpsV1Summary(tasks: OpsV1Task[]): OpsV1Summary {
  return {
    checkinsToday: tasks.filter(
      (task) => task.taskType === 'checkin' && isToday(task.scheduledAt) && isOpenStatus(task.status),
    ).length,
    checkoutsToday: tasks.filter(
      (task) => task.taskType === 'checkout' && isToday(task.scheduledAt) && isOpenStatus(task.status),
    ).length,
    cleaningNeeded: tasks.filter(
      (task) => task.taskType === 'cleaning' && isOpenStatus(task.status),
    ).length,
    needsAttention: tasks.filter((task) => task.status === 'needs_attention').length,
  };
}

export async function listOpsV1Tasks(options?: { syncAuto?: boolean }): Promise<{
  ok: boolean;
  tasks: OpsV1Task[];
  summary: OpsV1Summary;
  autoSync?: { created: number; scanned: number };
  error?: string;
}> {
  if (options?.syncAuto !== false) {
    try {
      const autoSync = await syncAutoOpsTasks();
      const result = await listOpsOperatorTasks({ status: 'all' });
      if (!result.ok) {
        return { ok: false, tasks: [], summary: buildOpsV1Summary([]), autoSync, error: result.error };
      }
      const tasks = result.tasks.map(mapOperatorTaskToV1);
      return { ok: true, tasks, summary: buildOpsV1Summary(tasks), autoSync };
    } catch (error) {
      console.error('[ops-v1] auto sync failed', error);
    }
  }

  const result = await listOpsOperatorTasks({ status: 'all' });
  if (!result.ok) {
    return { ok: false, tasks: [], summary: buildOpsV1Summary([]), error: result.error };
  }

  const tasks = result.tasks.map(mapOperatorTaskToV1);
  return { ok: true, tasks, summary: buildOpsV1Summary(tasks) };
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
