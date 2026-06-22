import type { OpsOperatorTask, OpsTaskSource, OpsTaskStatus, OpsTaskType } from '@/lib/ops-board/types';
import type { OpsV1Origin, OpsV1Source, OpsV1Status, OpsV1Task, OpsV1TaskType } from './types';

const V1_TO_OPERATOR_TYPE: Record<OpsV1TaskType, OpsTaskType> = {
  checkin: 'prepare_checkin',
  checkout: 'prepare_checkout',
  cleaning: 'verify_cleaning',
  issue: 'verify_guest_issue',
  manual_review: 'other',
};

const OPERATOR_TO_V1_TYPE: Partial<Record<OpsTaskType, OpsV1TaskType>> = {
  prepare_checkin: 'checkin',
  prepare_checkout: 'checkout',
  verify_cleaning: 'cleaning',
  verify_guest_issue: 'issue',
  other: 'manual_review',
  request_owner_data: 'manual_review',
  verify_channel_manager: 'manual_review',
  contact_owner: 'manual_review',
};

const V1_TO_OPERATOR_STATUS: Record<OpsV1Status, OpsTaskStatus> = {
  new: 'new',
  in_progress: 'in_progress',
  done: 'done',
  needs_attention: 'needs_operator',
};

const OPERATOR_TO_V1_STATUS: Record<OpsTaskStatus, OpsV1Status> = {
  new: 'new',
  in_progress: 'in_progress',
  waiting_owner: 'needs_attention',
  needs_operator: 'needs_attention',
  done: 'done',
  closed: 'done',
};

const OPERATOR_TO_V1_SOURCE: Record<OpsTaskSource, OpsV1Source> = {
  telegram: 'telegram',
  crm: 'crm',
  communication_autopilot: 'communications',
  channel_manager: 'object_passport',
  manual: 'admin',
};

const V1_TO_OPERATOR_SOURCE: Record<OpsV1Source, OpsTaskSource> = {
  telegram: 'telegram',
  crm: 'crm',
  communications: 'communication_autopilot',
  object_passport: 'channel_manager',
  booking: 'crm',
  admin: 'manual',
};

export function mapOperatorTypeToV1(taskType: OpsTaskType): OpsV1TaskType {
  return OPERATOR_TO_V1_TYPE[taskType] ?? 'manual_review';
}

export function mapV1TypeToOperator(taskType: OpsV1TaskType): OpsTaskType {
  return V1_TO_OPERATOR_TYPE[taskType];
}

export function mapOperatorStatusToV1(taskStatus: OpsTaskStatus): OpsV1Status {
  return OPERATOR_TO_V1_STATUS[taskStatus];
}

export function mapV1StatusToOperator(status: OpsV1Status): OpsTaskStatus {
  return V1_TO_OPERATOR_STATUS[status];
}

export function mapOperatorSourceToV1(source: OpsTaskSource): OpsV1Source {
  return OPERATOR_TO_V1_SOURCE[source];
}

export function mapV1SourceToOperator(source: OpsV1Source): OpsTaskSource {
  return V1_TO_OPERATOR_SOURCE[source];
}

export function resolveOpsV1DisplaySource(task: OpsOperatorTask): OpsV1Source {
  const integration = String(task.metadata?.integration ?? '').trim();
  if (integration === 'booking') return 'booking';
  if (integration === 'object_passport' || integration === 'crm_missing_data') return 'object_passport';
  if (integration === 'crm_onboarding') return 'crm';
  if (integration === 'communications_escalation') return 'communications';
  if (task.source === 'manual') return 'admin';
  if (task.source === 'communication_autopilot') return 'communications';
  if (task.source === 'channel_manager' || task.taskType === 'request_owner_data') return 'object_passport';
  return mapOperatorSourceToV1(task.source);
}

export function resolveOpsV1Origin(task: OpsOperatorTask): OpsV1Origin {
  if (task.source === 'manual' && task.metadata?.created_by_system !== true) {
    return 'manual';
  }
  if (task.metadata?.created_by_system === true) {
    return 'auto';
  }
  if (task.source === 'manual') {
    return 'manual';
  }
  return 'auto';
}

export function mapOperatorTaskToV1(task: OpsOperatorTask): OpsV1Task {
  const scheduledAt =
    typeof task.metadata?.scheduledAt === 'string'
      ? task.metadata.scheduledAt
      : task.lastEventAt ?? task.createdAt;

  return {
    id: task.id,
    propertyId: task.objectId,
    objectLabel: task.objectLabel ?? task.objectId,
    taskType: mapOperatorTypeToV1(task.taskType),
    status: mapOperatorStatusToV1(task.taskStatus),
    source: resolveOpsV1DisplaySource(task),
    origin: resolveOpsV1Origin(task),
    scheduledAt,
    comment: task.description ?? task.lastEventText,
    title: task.title,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
