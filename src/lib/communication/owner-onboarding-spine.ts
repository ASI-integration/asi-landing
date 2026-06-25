import { getCrmContactById } from '@/lib/crm/repository';
import { buildAutoOpsDedupKey, createOpsOperatorTask } from '@/lib/ops-board/repository';
import { OPS_TASK_TYPE_LABELS } from '@/lib/ops-board/types';
import { runPilotChainForContact } from '@/lib/pilot-chain/orchestrator';
import type { OwnerOnboardingState, OwnerOnboardingStatus } from './telegram-owner-onboarding';
import {
  WIZARD_FIELD_LABELS,
  type OwnerOnboardingWizardField,
} from './telegram-owner-onboarding-wizard';

function text(value: unknown, max = 400): string {
  return String(value ?? '').trim().slice(0, max);
}

function stuckFieldLabel(field: OwnerOnboardingWizardField | undefined): string {
  if (!field) return 'данные объекта';
  return WIZARD_FIELD_LABELS[field] ?? field;
}

function buildBlockerDescription(params: {
  ownerName: string;
  objectLabel: string;
  stuckField: OwnerOnboardingWizardField | undefined;
  lastMessage: string;
  clarificationQuestion?: string;
}): string {
  const fieldLabel = stuckFieldLabel(params.stuckField);
  const lines = [
    `Владелец: ${params.ownerName}`,
    `Объект: ${params.objectLabel}`,
    `Остановился на вопросе: ${fieldLabel}`,
    params.clarificationQuestion
      ? `Последний уточняющий вопрос: ${params.clarificationQuestion}`
      : null,
    params.lastMessage ? `Последнее сообщение: ${params.lastMessage}` : null,
    `Оператору: помочь заполнить «${fieldLabel}» и продолжить подключение объекта.`,
  ];
  return lines.filter(Boolean).join('\n');
}

export async function ensureOwnerOnboardingBlockerOpsTask(params: {
  contactId: string;
  objectId: string;
  ownerName: string;
  objectLabel: string;
  state: OwnerOnboardingState;
}): Promise<string | null> {
  const stuckField = params.state.missing[0];
  const description = buildBlockerDescription({
    ownerName: params.ownerName,
    objectLabel: params.objectLabel,
    stuckField,
    lastMessage: text(params.state.lastMessage, 200),
    clarificationQuestion: params.state.lastClarificationQuestion,
  });

  const dedupKey = buildAutoOpsDedupKey({
    source: 'owner_onboarding',
    sourceId: `${params.contactId}:${params.objectId}`,
    taskType: 'request_owner_data',
  });

  const result = await createOpsOperatorTask({
    taskType: 'request_owner_data',
    taskStatus: 'needs_operator',
    priority: 'normal',
    source: 'communication_autopilot',
    contactId: params.contactId,
    objectId: params.objectId,
    ownerName: params.ownerName,
    objectLabel: params.objectLabel,
    title: OPS_TASK_TYPE_LABELS.request_owner_data,
    description,
    lastEventText: `Владелец застрял на шаге: ${stuckFieldLabel(stuckField)}`,
    dedupKey,
    metadata: {
      created_by_system: true,
      integration: 'owner_onboarding',
      onboarding_status: params.state.status,
      stuck_field: stuckField ?? null,
      stuck_field_label: stuckFieldLabel(stuckField),
      missing_fields: params.state.missing,
      last_message: text(params.state.lastMessage, 200),
    },
    updateIfExists: {
      description,
      lastEventText: `Владелец застрял на шаге: ${stuckFieldLabel(stuckField)}`,
      taskStatus: 'needs_operator',
    },
  });

  if (!result.ok) return null;
  return result.task?.id ?? null;
}

export async function syncOwnerOnboardingAutomation(params: {
  contactId?: string;
  objectId: string;
  previousStatus: OwnerOnboardingStatus;
  status: OwnerOnboardingStatus;
  state: OwnerOnboardingState;
  ownerName: string;
  objectLabel: string;
}): Promise<{ pilotChainRan: boolean; opsTaskId: string | null }> {
  if (!params.contactId) {
    return { pilotChainRan: false, opsTaskId: null };
  }

  let pilotChainRan = false;
  let opsTaskId: string | null = null;

  if (
    params.status === 'ready_for_channel_manager' &&
    params.previousStatus !== 'ready_for_channel_manager'
  ) {
    try {
      await runPilotChainForContact(params.contactId);
      pilotChainRan = true;
    } catch (error) {
      console.warn('[owner-onboarding] pilot chain failed', {
        contactId: params.contactId,
        objectId: params.objectId,
        error,
      });
    }
  }

  if (params.status === 'needs_operator' && params.previousStatus !== 'needs_operator') {
    opsTaskId = await ensureOwnerOnboardingBlockerOpsTask({
      contactId: params.contactId,
      objectId: params.objectId,
      ownerName: params.ownerName,
      objectLabel: params.objectLabel,
      state: params.state,
    });
  }

  return { pilotChainRan, opsTaskId };
}

export async function loadOwnerNameForContact(contactId: string, fallback: string): Promise<string> {
  try {
    const contact = await getCrmContactById(contactId);
    return contact?.name?.trim() || fallback;
  } catch {
    return fallback;
  }
}
