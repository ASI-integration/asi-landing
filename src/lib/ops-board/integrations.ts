import { createOpsOperatorTask } from './repository';
import { emitOpsTaskCreatedEvent } from './crm-events';
import type { OpsTaskPriority, OpsTaskSource } from './types';
import { OPS_TASK_TYPE_LABELS } from './types';

const CRITICAL_ESCALATION_REASONS = new Set([
  'refund_request',
  'complaint',
  'conflict',
  'legal',
  'review_threat',
]);

function priorityForEscalationReason(reason: string | null | undefined): OpsTaskPriority {
  const normalized = String(reason ?? '').trim();
  if (CRITICAL_ESCALATION_REASONS.has(normalized)) return 'critical';
  return 'urgent';
}

async function createIntegratedTask(
  input: Parameters<typeof createOpsOperatorTask>[0],
): Promise<{ created: boolean; taskId: string | null }> {
  const result = await createOpsOperatorTask(input);
  if (!result.ok || !result.task) {
    return { created: false, taskId: null };
  }

  if (result.created) {
    await emitOpsTaskCreatedEvent({
      contactId: result.task.contactId,
      taskId: result.task.id,
      taskType: result.task.taskType,
      title: result.task.title,
      source: result.task.source,
      objectId: result.task.objectId,
    });
  }

  return { created: result.created, taskId: result.task.id };
}

export async function createOpsTaskFromAutopilotEscalation(input: {
  contactId?: string | null;
  propertyId?: string | null;
  guestName?: string | null;
  objectLabel?: string | null;
  escalationReason?: string | null;
  guestQuestion?: string | null;
}): Promise<{ created: boolean; taskId: string | null }> {
  return createIntegratedTask({
    taskType: 'verify_guest_issue',
    taskStatus: 'needs_operator',
    priority: priorityForEscalationReason(input.escalationReason),
    source: 'communication_autopilot',
    contactId: input.contactId,
    objectId: input.propertyId,
    guestName: input.guestName ?? 'Гость',
    objectLabel: input.objectLabel,
    description: input.guestQuestion ?? null,
    lastEventText: input.guestQuestion
      ? `Эскалация: ${input.guestQuestion.slice(0, 200)}`
      : `Эскалация: ${input.escalationReason ?? 'требуется оператор'}`,
    metadata: {
      escalation_reason: input.escalationReason ?? null,
      integration: 'communication_autopilot',
    },
  });
}

export async function createOpsTaskFromChannelManager(input: {
  contactId: string;
  objectId: string;
  objectLabel?: string | null;
  ownerName?: string | null;
  method?: string | null;
  reason?: string | null;
}): Promise<{ created: boolean; taskId: string | null }> {
  const methodLabel = input.method ?? 'channel_manager';
  return createIntegratedTask({
    taskType: 'verify_channel_manager',
    taskStatus: 'needs_operator',
    priority: 'urgent',
    source: 'channel_manager',
    contactId: input.contactId,
    objectId: input.objectId,
    ownerName: input.ownerName,
    objectLabel: input.objectLabel,
    title: OPS_TASK_TYPE_LABELS.verify_channel_manager,
    description: input.reason ?? `Подключение МК: ${methodLabel}`,
    lastEventText: input.reason ?? 'Нужна помощь с подключением Менеджера Каналов',
    metadata: {
      method: methodLabel,
      integration: 'channel_manager',
    },
  });
}

export async function createOpsTaskFromMissingOwnerData(input: {
  contactId: string;
  objectId?: string | null;
  objectLabel?: string | null;
  ownerName?: string | null;
  missingFields?: string[];
}): Promise<{ created: boolean; taskId: string | null }> {
  const missing = input.missingFields?.filter(Boolean) ?? [];
  return createIntegratedTask({
    taskType: 'request_owner_data',
    taskStatus: 'waiting_owner',
    priority: 'normal',
    source: 'crm',
    contactId: input.contactId,
    objectId: input.objectId,
    ownerName: input.ownerName,
    objectLabel: input.objectLabel,
    description: missing.length > 0 ? `Не хватает: ${missing.join(', ')}` : 'Не хватает данных объекта',
    lastEventText: missing.length > 0 ? `Ожидаются данные: ${missing[0]}` : 'Не хватает данных объекта',
    metadata: {
      missing_fields: missing,
      integration: 'crm_missing_data',
    },
  });
}

export function resolveOpsSourceLabel(source: OpsTaskSource): string {
  const labels: Record<OpsTaskSource, string> = {
    telegram: 'Telegram',
    telegram_support: 'Поддержка Telegram',
    crm: 'CRM',
    communication_autopilot: 'Communication Autopilot',
    channel_manager: 'Channel Manager',
    manual: 'Manual',
  };
  return labels[source];
}
