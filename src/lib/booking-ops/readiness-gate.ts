import type { BookingOpsTask, BookingOpsTaskType } from './task-types';
import type { BookingOpsRecord } from './types';

export const PROPERTY_READINESS_GATE_STATUSES = [
  'not_ready',
  'cleaning_required',
  'linen_required',
  'inspection_required',
  'ready',
] as const;

export type PropertyReadinessGateStatus = (typeof PROPERTY_READINESS_GATE_STATUSES)[number];

export type PropertyReadinessPrerequisiteKey =
  | 'cleaning_incomplete'
  | 'linen_incomplete'
  | 'inspection_incomplete'
  | 'property_not_ready';

export type PropertyReadinessPrerequisite = {
  key: PropertyReadinessPrerequisiteKey;
  message: string;
};

export type PropertyReadinessGate = {
  status: PropertyReadinessGateStatus;
  ready: boolean;
  requiredTaskTypes: BookingOpsTaskType[];
  missingPrerequisites: PropertyReadinessPrerequisite[];
  nextAction: string;
};

const TURNOVER_TASK_TYPES = new Set<BookingOpsTaskType>([
  'checkout_confirmed',
  'cleaning_needed',
  'cleaning_assigned',
  'cleaning_in_progress',
  'cleaning_done',
  'linen_pickup_needed',
  'linen_replaced',
  'laundry_dropoff_needed',
  'laundry_return_needed',
  'supplies_check_needed',
  'unit_inspection_needed',
  'inspection_needed',
  'unit_ready_for_next_guest',
  'unit_ready_confirmation',
]);

const CLEANING_COMPLETE_TYPES = new Set<BookingOpsTaskType>(['cleaning_done']);
const LINEN_COMPLETE_TYPES = new Set<BookingOpsTaskType>(['linen_replaced', 'laundry_return_needed']);
const INSPECTION_COMPLETE_TYPES = new Set<BookingOpsTaskType>([
  'unit_inspection_needed',
  'inspection_needed',
  'unit_ready_for_next_guest',
  'unit_ready_confirmation',
]);

function completed(tasks: BookingOpsTask[], types: Set<BookingOpsTaskType>): boolean {
  return tasks.some((task) => types.has(task.taskType) && task.status === 'completed');
}

function hasTurnoverStarted(record: BookingOpsRecord, tasks: BookingOpsTask[]): boolean {
  if (record.unitReadinessStatus !== 'not_ready') return true;
  return tasks.some((task) => TURNOVER_TASK_TYPES.has(task.taskType));
}

function prerequisite(key: PropertyReadinessPrerequisiteKey, message: string): PropertyReadinessPrerequisite {
  return { key, message };
}

export function computePropertyReadinessGate(
  record: BookingOpsRecord,
  tasks: BookingOpsTask[],
): PropertyReadinessGate {
  if (!hasTurnoverStarted(record, tasks)) {
    return {
      status: 'not_ready',
      ready: false,
      requiredTaskTypes: [],
      missingPrerequisites: [
        prerequisite('property_not_ready', 'Property readiness has not been confirmed for the next check-in.'),
      ],
      nextAction: 'Wait for checkout and start readiness tasks',
    };
  }

  const cleaningDone = completed(tasks, CLEANING_COMPLETE_TYPES) || record.unitReadinessStatus === 'ready';
  const linenDone = completed(tasks, LINEN_COMPLETE_TYPES) || record.unitReadinessStatus === 'ready';
  const inspectionDone = completed(tasks, INSPECTION_COMPLETE_TYPES) || record.unitReadinessStatus === 'ready';

  if (!cleaningDone) {
    return {
      status: 'cleaning_required',
      ready: false,
      requiredTaskTypes: ['cleaning_needed', 'cleaning_done'],
      missingPrerequisites: [
        prerequisite('cleaning_incomplete', 'Cleaning is not complete.'),
        prerequisite('property_not_ready', 'Property readiness is not ready.'),
      ],
      nextAction: 'Complete cleaning',
    };
  }

  if (!linenDone) {
    return {
      status: 'linen_required',
      ready: false,
      requiredTaskTypes: ['linen_pickup_needed', 'linen_replaced', 'laundry_return_needed'],
      missingPrerequisites: [
        prerequisite('linen_incomplete', 'Linen readiness is not complete.'),
        prerequisite('property_not_ready', 'Property readiness is not ready.'),
      ],
      nextAction: 'Complete linen replacement',
    };
  }

  if (!inspectionDone) {
    return {
      status: 'inspection_required',
      ready: false,
      requiredTaskTypes: ['unit_inspection_needed', 'unit_ready_for_next_guest'],
      missingPrerequisites: [
        prerequisite('inspection_incomplete', 'Inspection or readiness confirmation is not complete.'),
        prerequisite('property_not_ready', 'Property readiness is not ready.'),
      ],
      nextAction: 'Confirm inspection and readiness',
    };
  }

  return {
    status: 'ready',
    ready: true,
    requiredTaskTypes: [],
    missingPrerequisites: [],
    nextAction: 'Property ready for next check-in',
  };
}

