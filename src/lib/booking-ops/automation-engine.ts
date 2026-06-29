import {
  BOOKING_OPS_TASK_TYPE_LABELS_RU,
  type BookingOpsTask,
  type BookingOpsTaskPlanItem,
  type BookingOpsTaskType,
} from './task-types';
import type { BookingOpsRecord, BookingOpsUnitReadinessStatus } from './types';

export const BOOKING_OPS_AUTOMATION_TASK_TYPES = [
  'cleaning_needed',
  'linen_pickup_needed',
  'inspection_needed',
  'supplies_check_needed',
  'maintenance_needed',
  'unit_ready_confirmation',
] as const satisfies readonly BookingOpsTaskType[];

export type BookingOpsAutomationTaskType =
  (typeof BOOKING_OPS_AUTOMATION_TASK_TYPES)[number];

export type BookingOpsPreparationNextAction =
  | 'Указать даты заезда и выезда'
  | 'Запланировать уборку'
  | 'Проверить бельё'
  | 'Провести осмотр'
  | 'Подтвердить готовность объекта'
  | 'Разобрать блокировку'
  | 'Подготовка завершена';

export type BookingOpsPreparationPlan = {
  eligible: boolean;
  items: BookingOpsTaskPlanItem[];
  requiredTaskTypes: BookingOpsAutomationTaskType[];
  unitReadinessStatus: BookingOpsUnitReadinessStatus;
  nextAction: BookingOpsPreparationNextAction;
};

const COMPLETION_ALIASES: Partial<Record<BookingOpsAutomationTaskType, BookingOpsTaskType[]>> = {
  cleaning_needed: ['cleaning_done'],
  linen_pickup_needed: ['linen_replaced', 'laundry_return_needed'],
  inspection_needed: ['unit_inspection_needed'],
  unit_ready_confirmation: ['unit_ready_for_next_guest'],
};

const REPAIR_SIGNAL = /(авар|полом|ремонт|мастер|сантех|электр|протеч|сломан|repair|maintenance|broken|plumb|electric|leak)/i;

function isFinished(
  taskType: BookingOpsAutomationTaskType,
  tasks: BookingOpsTask[],
): boolean {
  const accepted = new Set<BookingOpsTaskType>([
    taskType,
    ...(COMPLETION_ALIASES[taskType] ?? []),
  ]);
  return tasks.some((task) => accepted.has(task.taskType) && task.status === 'completed');
}

function hasTerminalTask(
  taskType: BookingOpsAutomationTaskType,
  tasks: BookingOpsTask[],
): boolean {
  const accepted = new Set<BookingOpsTaskType>([
    taskType,
    ...(COMPLETION_ALIASES[taskType] ?? []),
  ]);
  return tasks.some((task) =>
    accepted.has(task.taskType) && (task.status === 'completed' || task.status === 'cancelled'));
}

function hasRepairSignal(record: BookingOpsRecord): boolean {
  const reason = [record.blockerReason, record.notes]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' ');
  return REPAIR_SIGNAL.test(reason);
}

function planItem(
  taskType: BookingOpsAutomationTaskType,
  description: string,
  priority: BookingOpsTaskPlanItem['priority'] = 'normal',
): BookingOpsTaskPlanItem {
  return {
    taskType,
    title: BOOKING_OPS_TASK_TYPE_LABELS_RU[taskType],
    description,
    priority,
    metadata: { contour: 'preparation', automationEngine: 'v1' },
  };
}

function requiredTypes(record: BookingOpsRecord): BookingOpsAutomationTaskType[] {
  const types: BookingOpsAutomationTaskType[] = [
    'cleaning_needed',
    'linen_pickup_needed',
    'inspection_needed',
    'supplies_check_needed',
  ];
  if (hasRepairSignal(record)) types.push('maintenance_needed');
  types.push('unit_ready_confirmation');
  return types;
}

function taskDescription(taskType: BookingOpsAutomationTaskType): string {
  const descriptions: Record<BookingOpsAutomationTaskType, string> = {
    cleaning_needed: 'Запланируйте и проконтролируйте уборку до следующего заезда.',
    linen_pickup_needed: 'Проверьте смену белья и полотенец.',
    inspection_needed: 'Проведите финальный осмотр объекта.',
    supplies_check_needed: 'Проверьте и пополните расходники.',
    maintenance_needed: 'Устраните поломку или другую техническую проблему.',
    unit_ready_confirmation: 'Подтвердите, что объект готов к следующему заезду.',
  };
  return descriptions[taskType];
}

/** Pure internal preparation plan. It never performs external communication. */
export function planBookingOpsPreparation(
  record: BookingOpsRecord,
  existingTasks: BookingOpsTask[],
): BookingOpsPreparationPlan {
  const eligible = Boolean(record.checkInAt && record.checkOutAt);
  if (!eligible) {
    return {
      eligible: false,
      items: [],
      requiredTaskTypes: [],
      unitReadinessStatus: record.isBlocked ? 'blocked' : 'not_ready',
      nextAction: record.isBlocked
        ? 'Разобрать блокировку'
        : 'Указать даты заезда и выезда',
    };
  }

  const requiredTaskTypes = requiredTypes(record);
  const relevantTypes = new Set<BookingOpsTaskType>([
    ...BOOKING_OPS_AUTOMATION_TASK_TYPES,
    'cleaning_done',
    'linen_replaced',
    'laundry_return_needed',
    'unit_inspection_needed',
    'unit_ready_for_next_guest',
  ]);
  const hasBlockedTask = existingTasks.some(
    (task) => relevantTypes.has(task.taskType) && task.status === 'blocked',
  );
  const completed = (taskType: BookingOpsAutomationTaskType) =>
    isFinished(taskType, existingTasks);

  let unitReadinessStatus: BookingOpsUnitReadinessStatus;
  let nextAction: BookingOpsPreparationNextAction;
  if (record.isBlocked || hasBlockedTask) {
    unitReadinessStatus = 'blocked';
    nextAction = 'Разобрать блокировку';
  } else if (!completed('cleaning_needed')) {
    unitReadinessStatus = 'cleaning_pending';
    nextAction = 'Запланировать уборку';
  } else if (!completed('linen_pickup_needed')) {
    unitReadinessStatus = 'linen_pending';
    nextAction = 'Проверить бельё';
  } else if (
    !completed('inspection_needed')
    || !completed('supplies_check_needed')
    || (requiredTaskTypes.includes('maintenance_needed') && !completed('maintenance_needed'))
  ) {
    unitReadinessStatus = 'inspection_pending';
    nextAction = 'Провести осмотр';
  } else if (!completed('unit_ready_confirmation')) {
    unitReadinessStatus = 'inspection_pending';
    nextAction = 'Подтвердить готовность объекта';
  } else {
    unitReadinessStatus = 'ready';
    nextAction = 'Подготовка завершена';
  }

  const items = requiredTaskTypes
    .filter((taskType) => !hasTerminalTask(taskType, existingTasks))
    .map((taskType) => planItem(
      taskType,
      taskDescription(taskType),
      taskType === 'maintenance_needed' || taskType === 'unit_ready_confirmation' ? 'high' : 'normal',
    ));

  return { eligible, items, requiredTaskTypes, unitReadinessStatus, nextAction };
}
