import { isReadyForChannelManagerFlow } from '@/lib/channel-manager-connection/flow';
import { CHANNEL_MANAGER_CONNECTION_STATUS_LABELS } from '@/lib/channel-manager-connection/labels';
import { isPilotParticipantStatus, pilotRolloutStatusLabel, resolvePilotRolloutStatus } from '@/lib/crm/pilot-rollout';
import type { CrmContact } from '@/lib/crm/types';
import { CRM_COMMUNICATION_STATUS_LABELS } from '@/lib/crm/types';
import { computeObjectReadiness } from '@/lib/object-readiness/engine';
import { buildAutoOpsDedupKey } from '@/lib/ops-board/repository';
import {
  OPS_DONE_STATUSES,
  OPS_OPEN_STATUSES,
  OPS_TASK_STATUS_LABELS,
  type OpsOperatorTask,
} from '@/lib/ops-board/types';
import {
  buildChannelManagerHrefForContact,
  buildObjectSetupHref,
  defaultObjectTitleForContact,
  extractLinkedObjectId,
  readinessInputFromContact,
} from '@/lib/pilot-chain/note-blocks';
import { shouldAutoProvisionObjectFromLead } from '@/lib/pilot-chain/status-triggers';
import { OPS_PILOT_STALLED_DAYS } from './constants';
import {
  OPS_PILOT_STAGE_LABELS,
  type OpsPilotBlocker,
  type OpsPilotOpsTaskSummary,
  type OpsPilotParticipant,
  type OpsPilotStage,
} from './types';

function hasOwnerContact(contact: CrmContact): boolean {
  if (contact.phone?.trim()) return true;
  if (contact.telegramUsername?.trim()) return true;
  if (contact.email?.trim()) return true;
  return false;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function resolveLastUpdatedAt(
  contact: CrmContact,
  opsTask: OpsOperatorTask | null,
): string | null {
  const candidates = [
    contact.updatedAt,
    contact.lastContactAt,
    contact.channelManagerConnection?.updatedAt,
    opsTask?.updatedAt ?? null,
  ];
  let best: string | null = null;
  let bestTs = -1;
  for (const value of candidates) {
    const ts = parseTimestamp(value);
    if (ts !== null && ts > bestTs) {
      bestTs = ts;
      best = value!;
    }
  }
  return best;
}

function isStalled(lastUpdatedAt: string | null, now = new Date()): boolean {
  const ts = parseTimestamp(lastUpdatedAt);
  if (ts === null) return false;
  const diffDays = (now.getTime() - ts) / (24 * 60 * 60 * 1000);
  return diffDays >= OPS_PILOT_STALLED_DAYS;
}

function findPilotOpsTask(
  tasks: OpsOperatorTask[],
  contactId: string,
  objectId: string | null,
): OpsOperatorTask | null {
  const dedupKey =
    objectId &&
    buildAutoOpsDedupKey({
      source: 'pilot_chain',
      sourceId: `${contactId}:${objectId}`,
      taskType: 'verify_channel_manager',
    });

  if (dedupKey) {
    const byDedup = tasks.find((task) => task.dedupKey === dedupKey);
    if (byDedup) return byDedup;
  }

  const openForContact = tasks.filter(
    (task) =>
      task.contactId === contactId &&
      task.taskType === 'verify_channel_manager' &&
      OPS_OPEN_STATUSES.includes(task.taskStatus),
  );
  if (openForContact.length > 0) return openForContact[0]!;

  const anyForContact = tasks.filter(
    (task) => task.contactId === contactId && task.taskType === 'verify_channel_manager',
  );
  return anyForContact[0] ?? null;
}

function mapOpsTaskSummary(task: OpsOperatorTask): OpsPilotOpsTaskSummary {
  return {
    id: task.id,
    title: task.title,
    status: task.taskStatus,
    statusLabelRu: OPS_TASK_STATUS_LABELS[task.taskStatus],
    updatedAt: task.updatedAt,
  };
}

function resolveStage(input: {
  contact: CrmContact;
  objectId: string | null;
  flowReady: boolean;
  opsTask: OpsOperatorTask | null;
  readinessPercent: number;
  missingRequiredCount: number;
}): OpsPilotStage {
  const { contact, objectId, flowReady, opsTask, readinessPercent, missingRequiredCount } = input;

  if (
    contact.communicationStatus === 'needs_manual_reaction' ||
    contact.communicationStatus === 'has_problem' ||
    contact.onboarding?.status === 'needs_operator'
  ) {
    return 'needs_manual_control';
  }

  const cmStatus = contact.channelManagerConnection?.status;
  const cmConnected = cmStatus === 'connected' || cmStatus === 'prepared';
  const rollout = resolvePilotRolloutStatus(contact.status);

  if (
    rollout === 'active_pilot' &&
    (cmConnected || (opsTask && OPS_DONE_STATUSES.includes(opsTask.taskStatus)))
  ) {
    return 'ready_for_next_step';
  }

  if (opsTask && OPS_OPEN_STATUSES.includes(opsTask.taskStatus)) {
    return 'ops_task_created';
  }

  if (flowReady && objectId) {
    return 'ready_for_cm_check';
  }

  if (contact.onboarding?.status === 'channel_manager_started' || contact.channelManagerConnection?.method) {
    return 'cm_preparing';
  }

  if (objectId) {
    if (missingRequiredCount > 0 || (readinessPercent > 0 && readinessPercent < 100)) {
      return 'object_filling';
    }
    return 'object_created';
  }

  const hasContactChannel =
    contact.communicationStatus === 'replied' ||
    contact.communicationStatus === 'wrote_first' ||
    hasOwnerContact(contact);

  if (contact.status === 'invited' || contact.status === 'access_received' || hasContactChannel) {
    return 'access_received';
  }

  return 'new_lead';
}

function resolveNextActionRu(input: {
  contact: CrmContact;
  objectId: string | null;
  stage: OpsPilotStage;
  readinessNextStep: string;
  missingLabels: string[];
  opsTask: OpsOperatorTask | null;
  flowReady: boolean;
}): string {
  const { contact, objectId, stage, readinessNextStep, missingLabels, opsTask, flowReady } = input;

  if (stage === 'needs_manual_control') {
    return 'Связаться с владельцем и разобрать блокер';
  }

  if (stage === 'ready_for_next_step') {
    return 'Готов к следующему шагу';
  }

  if (!objectId) {
    if (shouldAutoProvisionObjectFromLead(contact.status) || isPilotParticipantStatus(contact.status)) {
      return 'Создать объект из заявки CRM';
    }
    return 'Уточнить данные объекта';
  }

  if (missingLabels.length > 0) {
    return `Дозаполнить обязательные поля: ${missingLabels.join(', ')}`;
  }

  if (opsTask && OPS_OPEN_STATUSES.includes(opsTask.taskStatus)) {
    return 'Проверить OPS-задачу';
  }

  if (flowReady) {
    return 'Проверить готовность менеджера каналов';
  }

  if (contact.channelManagerConnection?.nextStepRu?.trim()) {
    return contact.channelManagerConnection.nextStepRu.trim();
  }

  if (readinessNextStep.trim()) {
    return readinessNextStep.trim();
  }

  return 'Открыть настройку объекта';
}

function resolveBlockers(input: {
  contact: CrmContact;
  objectId: string | null;
  missingLabels: string[];
  flowReady: boolean;
  opsTask: OpsOperatorTask | null;
  lastUpdatedAt: string | null;
}): OpsPilotBlocker[] {
  const { contact, objectId, missingLabels, flowReady, opsTask, lastUpdatedAt } = input;
  const blockers: OpsPilotBlocker[] = [];

  if (!objectId) {
    blockers.push({ key: 'no_linked_object', labelRu: 'Нет связанного объекта' });
  }

  if (objectId && missingLabels.length > 0) {
    blockers.push({
      key: 'object_not_filled',
      labelRu: `Объект создан, но не заполнен: не хватает ${missingLabels.join(', ')}`,
    });
  }

  if (objectId && !flowReady && missingLabels.length > 0) {
    blockers.push({
      key: 'missing_cm_data',
      labelRu: `Нет обязательных данных для МК: ${missingLabels.join(', ')}`,
    });
  }

  if (flowReady && objectId && (!opsTask || OPS_DONE_STATUSES.includes(opsTask.taskStatus))) {
    blockers.push({ key: 'no_ops_task', labelRu: 'Нет открытой OPS-задачи' });
  }

  if (!hasOwnerContact(contact)) {
    blockers.push({ key: 'no_owner_contact', labelRu: 'Нет контакта владельца' });
  }

  if (isStalled(lastUpdatedAt)) {
    blockers.push({
      key: 'stalled',
      labelRu: `Давно не было движения (более ${OPS_PILOT_STALLED_DAYS} дн.)`,
    });
  }

  return blockers;
}

function buildCrmHref(contact: CrmContact): string {
  const query = contact.name.trim() || contact.phone.trim() || contact.id;
  return `/dashboard/crm?search=${encodeURIComponent(query)}`;
}

export function buildOpsPilotParticipantSnapshot(
  contact: CrmContact,
  opsTasks: OpsOperatorTask[],
): OpsPilotParticipant {
  const objectId = extractLinkedObjectId(contact);
  const readiness = computeObjectReadiness(readinessInputFromContact(contact));
  const flowReady = objectId
    ? isReadyForChannelManagerFlow({
        objectId,
        contactId: contact.id,
        objectTitle: defaultObjectTitleForContact(contact),
        readinessPercent: readiness.readiness_percent,
        onboardingStatus: contact.onboarding?.status ?? null,
      })
    : false;

  const opsTask = findPilotOpsTask(opsTasks, contact.id, objectId);
  const lastUpdatedAt = resolveLastUpdatedAt(contact, opsTask);
  const stage = resolveStage({
    contact,
    objectId,
    flowReady,
    opsTask,
    readinessPercent: readiness.readiness_percent,
    missingRequiredCount: readiness.missing_required_fields.length,
  });
  const missingLabels = readiness.missing_required_labels_ru;
  const blockers = resolveBlockers({
    contact,
    objectId,
    missingLabels,
    flowReady,
    opsTask,
    lastUpdatedAt,
  });
  const stalled = blockers.some((item) => item.key === 'stalled');
  const needsManualHelp =
    stage === 'needs_manual_control' ||
    contact.communicationStatus === 'needs_manual_reaction' ||
    contact.communicationStatus === 'has_problem' ||
    contact.onboarding?.status === 'needs_operator' ||
    blockers.length > 0;

  const channelManagerHref =
    objectId &&
    (contact.onboarding?.channelManagerHref ?? buildChannelManagerHrefForContact(contact.id, objectId));

  return {
    contactId: contact.id,
    name: contact.name,
    phone: contact.phone,
    telegramUsername: contact.telegramUsername,
    crmStatus: contact.status,
    crmStatusLabelRu: pilotRolloutStatusLabel(contact.status),
    communicationStatus: contact.communicationStatus,
    objectId,
    objectTitle: objectId ? defaultObjectTitleForContact(contact) : null,
    readinessPercent: objectId ? readiness.readiness_percent : null,
    readinessLabelRu: objectId ? readiness.readiness_status_label_ru : null,
    channelManagerStatusLabelRu: contact.channelManagerConnection?.status
      ? CHANNEL_MANAGER_CONNECTION_STATUS_LABELS[contact.channelManagerConnection.status]
      : null,
    channelManagerNextStepRu: contact.channelManagerConnection?.nextStepRu ?? null,
    stage,
    stageLabelRu: OPS_PILOT_STAGE_LABELS[stage],
    nextActionRu: resolveNextActionRu({
      contact,
      objectId,
      stage,
      readinessNextStep: readiness.next_best_step_ru,
      missingLabels,
      opsTask,
      flowReady,
    }),
    blockers,
    isStalled: stalled,
    needsManualHelp,
    opsTask: opsTask ? mapOpsTaskSummary(opsTask) : null,
    lastUpdatedAt,
    links: {
      crmHref: buildCrmHref(contact),
      objectHref: objectId ? buildObjectSetupHref(objectId) : null,
      channelManagerHref: channelManagerHref || null,
      opsTaskHref: opsTask ? `/dashboard/ops?taskId=${encodeURIComponent(opsTask.id)}` : null,
    },
    operatorNote: contact.nextStep?.trim() ?? '',
  };
}

export function formatCommunicationStatusRu(status: CrmContact['communicationStatus']): string {
  return CRM_COMMUNICATION_STATUS_LABELS[status];
}
