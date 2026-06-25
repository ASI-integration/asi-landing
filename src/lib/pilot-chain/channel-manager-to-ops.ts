import { isReadyForChannelManagerFlow } from '@/lib/channel-manager-connection/flow';
import type { CrmContact } from '@/lib/crm/types';
import { computeObjectReadiness } from '@/lib/object-readiness/engine';
import { buildAutoOpsDedupKey, createOpsOperatorTask } from '@/lib/ops-board/repository';
import { OPS_TASK_TYPE_LABELS } from '@/lib/ops-board/types';
import { emitPilotChainAuditEvent, logPilotChainStep } from './audit-events';
import {
  defaultObjectTitleForContact,
  missingFieldLabelsForOps,
  readinessInputFromContact,
} from './note-blocks';
import type { PilotChainStepResult } from './types';

function buildOpsDescription(contact: CrmContact, objectId: string, missingLabels: string[]): string {
  const filled: string[] = [];
  const onboarding = contact.onboarding;
  if (contact.city) filled.push('город');
  if (onboarding?.objectType) filled.push('тип объекта');
  if (onboarding?.checkinTime && onboarding?.checkoutTime) filled.push('время заезда/выезда');
  if (onboarding?.channels?.length) filled.push('каналы');
  if (onboarding?.rules?.length) filled.push('правила');
  if (onboarding?.wifiName || onboarding?.wifiPassword) filled.push('Wi‑Fi');

  const filledText = filled.length > 0 ? `Заполнено: ${filled.join(', ')}.` : 'Заполнено: минимальный черновик.';
  const missingText =
    missingLabels.length > 0 ? `Нужно: ${missingLabels.join(', ')}.` : 'Данные готовы к настройке каналов.';
  const cmStatus = contact.channelManagerConnection?.status ?? 'ready_to_connect';
  return `${filledText} ${missingText} Статус МК: ${cmStatus}. Объект: ${objectId}.`;
}

export async function ensureOpsCaseForChannelSetup(
  contact: CrmContact,
  objectId: string,
): Promise<{ step: PilotChainStepResult; opsTaskId: string | null }> {
  const readiness = computeObjectReadiness(readinessInputFromContact(contact));
  const onboardingStatus = contact.onboarding?.status ?? null;
  const flowReady = isReadyForChannelManagerFlow({
    objectId,
    contactId: contact.id,
    objectTitle: defaultObjectTitleForContact(contact),
    readinessPercent: readiness.readiness_percent,
    onboardingStatus,
  });

  if (!flowReady) {
    return {
      step: { step: 'channel_manager_to_ops', outcome: 'not_applicable', objectId },
      opsTaskId: null,
    };
  }

  const dedupKey = buildAutoOpsDedupKey({
    source: 'pilot_chain',
    sourceId: `${contact.id}:${objectId}`,
    taskType: 'verify_channel_manager',
  });
  const missingLabels = missingFieldLabelsForOps(readiness);
  const description = buildOpsDescription(contact, objectId, missingLabels);

  const result = await createOpsOperatorTask({
    taskType: 'verify_channel_manager',
    taskStatus: 'new',
    priority: 'normal',
    source: 'crm',
    contactId: contact.id,
    objectId,
    ownerName: contact.name,
    objectLabel: defaultObjectTitleForContact(contact),
    title: OPS_TASK_TYPE_LABELS.verify_channel_manager,
    description,
    lastEventText: 'Объект готов к настройке каналов — проверить контур пилота',
    dedupKey,
    metadata: {
      created_by_system: true,
      integration: 'pilot_chain',
      readiness_percent: readiness.readiness_percent,
      missing_fields: readiness.missing_required_fields,
      missing_labels: missingLabels,
      cm_status: contact.channelManagerConnection?.status ?? null,
      cm_method: contact.channelManagerConnection?.method ?? null,
      filled_summary: description,
    },
  });

  if (!result.ok || !result.task) {
    return {
      step: { step: 'channel_manager_to_ops', outcome: 'skipped', objectId },
      opsTaskId: null,
    };
  }

  if (!result.created) {
    logPilotChainStep('skipped_existing_ops', {
      contactId: contact.id,
      objectId,
      opsTaskId: result.task.id,
    });
    await emitPilotChainAuditEvent({
      contactId: contact.id,
      eventType: 'skipped_existing_ops',
      objectId,
      metadata: { ops_task_id: result.task.id },
    });
    return {
      step: {
        step: 'channel_manager_to_ops',
        outcome: 'skipped',
        auditEvent: 'skipped_existing_ops',
        objectId,
        opsTaskId: result.task.id,
      },
      opsTaskId: result.task.id,
    };
  }

  logPilotChainStep('ops_case_created', {
    contactId: contact.id,
    objectId,
    opsTaskId: result.task.id,
  });
  await emitPilotChainAuditEvent({
    contactId: contact.id,
    eventType: 'ops_case_created',
    objectId,
    metadata: { ops_task_id: result.task.id },
  });

  return {
    step: {
      step: 'channel_manager_to_ops',
      outcome: 'created',
      auditEvent: 'ops_case_created',
      objectId,
      opsTaskId: result.task.id,
    },
    opsTaskId: result.task.id,
  };
}

export async function runChannelManagerToOpsStep(
  contact: CrmContact,
  objectId: string | null,
): Promise<{ step: PilotChainStepResult; opsTaskId: string | null }> {
  if (!objectId) {
    return {
      step: { step: 'channel_manager_to_ops', outcome: 'not_applicable' },
      opsTaskId: null,
    };
  }
  return ensureOpsCaseForChannelSetup(contact, objectId);
}
