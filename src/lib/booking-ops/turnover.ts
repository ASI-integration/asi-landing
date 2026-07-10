import type { BookingReadinessResult } from './readiness';
import {
  BOOKING_OPS_TASK_TYPE_LABELS_RU,
  type BookingOpsTask,
  type BookingOpsTaskPlanItem,
  type BookingOpsTaskType,
} from './task-types';
import type { BookingOpsRecord, BookingOpsUnitReadinessStatus } from './types';
import { BOOKING_OPS_UNIT_READINESS_STATUS_LABELS_RU } from './types';
import { BOOKING_OPS_AUTOMATION_TASK_TYPES, planBookingOpsPreparation } from './automation-engine';

export { BOOKING_OPS_UNIT_READINESS_STATUS_LABELS_RU };

/** Turnover task types created after post-stay / checkout flow begins. */
export const BOOKING_OPS_TURNOVER_TASK_TYPES = [
  'checkout_confirmed',
  'cleaning_needed',
  'cleaning_assigned',
  'cleaning_in_progress',
  'cleaning_done',
  'unit_inspection_needed',
  'unit_ready_for_next_guest',
  'linen_pickup_needed',
  'linen_replaced',
  'laundry_dropoff_needed',
  'laundry_return_needed',
  'supplies_check_needed',
] as const;

export type BookingOpsTurnoverTaskType = (typeof BOOKING_OPS_TURNOVER_TASK_TYPES)[number];

const CLEANING_CHAIN: BookingOpsTurnoverTaskType[] = [
  'cleaning_needed',
  'cleaning_assigned',
  'cleaning_in_progress',
  'cleaning_done',
];

const LINEN_CHAIN: BookingOpsTurnoverTaskType[] = [
  'linen_pickup_needed',
  'linen_replaced',
  'laundry_dropoff_needed',
  'laundry_return_needed',
];

function planItem(
  taskType: BookingOpsTurnoverTaskType,
  description: string,
  priority: BookingOpsTaskPlanItem['priority'] = 'normal',
): BookingOpsTaskPlanItem {
  return {
    taskType,
    title: BOOKING_OPS_TASK_TYPE_LABELS_RU[taskType],
    description,
    priority,
    metadata: { contour: 'turnover' },
  };
}

function completedTurnoverTypes(tasks: BookingOpsTask[]): Set<BookingOpsTaskType> {
  return new Set(
    tasks
      .filter(
        (task) =>
          (BOOKING_OPS_TURNOVER_TASK_TYPES as readonly string[]).includes(task.taskType)
          && task.status === 'completed',
      )
      .map((task) => task.taskType),
  );
}

/** Post-stay begins when intake is completed and checkout date is known. */
export function isTurnoverEligible(
  record: BookingOpsRecord,
  readiness: BookingReadinessResult,
): boolean {
  return Boolean(record.checkOutAt) && readiness.status === 'completed';
}

function nextInChain(
  chain: BookingOpsTurnoverTaskType[],
  completed: Set<BookingOpsTaskType>,
): BookingOpsTurnoverTaskType | null {
  let furthestCompleted = -1;
  for (let index = 0; index < chain.length; index += 1) {
    if (completed.has(chain[index])) furthestCompleted = index;
  }
  if (furthestCompleted === chain.length - 1) return null;
  return chain[furthestCompleted + 1] ?? chain[0];
}

/**
 * Pure turnover task plan from record + readiness + existing tasks.
 * Plans parallel tracks (cleaning, linen, supplies) after checkout is confirmed.
 */
export function syncTurnoverTasksForRecord(
  record: BookingOpsRecord,
  readiness: BookingReadinessResult,
  existingTasks: BookingOpsTask[],
): { items: BookingOpsTaskPlanItem[] } {
  if (!isTurnoverEligible(record, readiness)) {
    return { items: [] };
  }

  const completed = completedTurnoverTypes(existingTasks);
  if (completed.has('unit_ready_for_next_guest')) {
    return { items: [] };
  }

  const items: BookingOpsTaskPlanItem[] = [];

  if (!completed.has('checkout_confirmed')) {
    items.push(
      planItem(
        'checkout_confirmed',
        'Подтвердите выезд гостя и начните подготовку объекта к следующему заезду.',
        'high',
      ),
    );
    return { items };
  }

  const nextCleaning = nextInChain(CLEANING_CHAIN, completed);
  if (nextCleaning) {
    const cleaningDescriptions: Partial<Record<BookingOpsTurnoverTaskType, string>> = {
      cleaning_needed: 'Объект требует уборки после выезда.',
      cleaning_assigned: 'Назначьте ответственного за уборку.',
      cleaning_in_progress: 'Уборка начата — проконтролируйте ход работ.',
      cleaning_done: 'Подтвердите завершение уборки.',
    };
    items.push(planItem(nextCleaning, cleaningDescriptions[nextCleaning] ?? ''));
  }

  const nextLinen = nextInChain(LINEN_CHAIN, completed);
  if (nextLinen) {
    const linenDescriptions: Partial<Record<BookingOpsTurnoverTaskType, string>> = {
      linen_pickup_needed: 'Заберите использованное бельё и полотенца.',
      linen_replaced: 'Замените бельё и полотенца свежим комплектом.',
      laundry_dropoff_needed: 'Сдайте бельё в прачечную.',
      laundry_return_needed: 'Получите бельё из прачечной и разложите.',
    };
    items.push(planItem(nextLinen, linenDescriptions[nextLinen] ?? ''));
  }

  if (!completed.has('supplies_check_needed')) {
    items.push(
      planItem(
        'supplies_check_needed',
        'Проверьте расходники: мыло, шампунь, туалетная бумага, чай/кофе.',
      ),
    );
  }

  const cleaningDone = completed.has('cleaning_done');
  const linenDone = completed.has('laundry_return_needed');
  const suppliesDone = completed.has('supplies_check_needed');

  if (cleaningDone && linenDone && suppliesDone) {
    if (!completed.has('unit_inspection_needed')) {
      items.push(
        planItem(
          'unit_inspection_needed',
          'Проведите финальный осмотр объекта перед следующим гостем.',
        ),
      );
    } else if (!completed.has('unit_ready_for_next_guest')) {
      items.push(
        planItem(
          'unit_ready_for_next_guest',
          'Подтвердите готовность объекта к следующему заезду.',
          'high',
        ),
      );
    }
  }

  return { items };
}

export function isTurnoverTaskType(taskType: BookingOpsTaskType): boolean {
  return (BOOKING_OPS_TURNOVER_TASK_TYPES as readonly string[]).includes(taskType)
    || (BOOKING_OPS_AUTOMATION_TASK_TYPES as readonly string[]).includes(taskType);
}

/** Derive unit readiness from record state and turnover tasks. */
export function computeUnitReadinessStatus(
  record: BookingOpsRecord,
  tasks: BookingOpsTask[],
): BookingOpsUnitReadinessStatus {
  if (tasks.some((task) =>
    task.status === 'completed'
    && (task.taskType === 'unit_ready_for_next_guest' || task.taskType === 'unit_ready_confirmation'))) {
    return 'ready';
  }
  if (record.isBlocked || tasks.some((task) => task.status === 'blocked' && isTurnoverTaskType(task.taskType))) {
    return 'blocked';
  }
  if (tasks.some((task) => task.status === 'open' || task.status === 'in_progress')) {
    if (tasks.some((task) => task.status !== 'completed' && CLEANING_CHAIN.includes(task.taskType as BookingOpsTurnoverTaskType))) {
      return 'cleaning_pending';
    }
    if (tasks.some((task) => task.status !== 'completed' && LINEN_CHAIN.includes(task.taskType as BookingOpsTurnoverTaskType))) {
      return 'linen_pending';
    }
    if (tasks.some((task) => task.status !== 'completed' && (task.taskType === 'unit_inspection_needed' || task.taskType === 'inspection_needed'))) {
      return 'inspection_pending';
    }
  }
  return planBookingOpsPreparation(record, tasks).unitReadinessStatus;
}

/** Unit readiness after completing a turnover task. */
export function unitReadinessAfterTaskCompletion(
  taskType: BookingOpsTaskType,
  current: BookingOpsUnitReadinessStatus | null | undefined,
): BookingOpsUnitReadinessStatus | null {
  switch (taskType) {
    case 'checkout_confirmed':
      return 'cleaning_pending';
    case 'cleaning_needed':
    case 'cleaning_assigned':
    case 'cleaning_in_progress':
      return 'cleaning_pending';
    case 'cleaning_done':
      return current === 'linen_pending' ? 'linen_pending' : 'cleaning_pending';
    case 'linen_pickup_needed':
    case 'linen_replaced':
    case 'laundry_dropoff_needed':
    case 'laundry_return_needed':
      return 'linen_pending';
    case 'supplies_check_needed':
      return current ?? 'cleaning_pending';
    case 'unit_inspection_needed':
      return 'inspection_pending';
    case 'unit_ready_for_next_guest':
    case 'unit_ready_confirmation':
      return 'ready';
    case 'inspection_needed':
    case 'maintenance_needed':
      return 'inspection_pending';
    default:
      return null;
  }
}
