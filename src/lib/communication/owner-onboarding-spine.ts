import { channelManagerDisplayName } from '@/lib/channel-manager/registry';
import { getCrmContactById } from '@/lib/crm/repository';
import { buildAutoOpsDedupKey, createOpsOperatorTask } from '@/lib/ops-board/repository';
import { OPS_TASK_TYPE_LABELS } from '@/lib/ops-board/types';
import { runPilotChainForContact } from '@/lib/pilot-chain/orchestrator';
import type { OwnerMkFollowupKind } from './owner-mk-onboarding-router';
import { resolveOwnerMkFollowupKind } from './owner-mk-onboarding-router';
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

function placementChannelsLabel(state: OwnerOnboardingState): string | null {
  const labels = state.target_placement_channels ?? state.channels_list ?? [];
  if (!labels.length) return null;
  return labels.join(', ');
}

function operatorNextStepForFollowup(kind: OwnerMkFollowupKind): string {
  switch (kind) {
    case 'channel_manager_existing_check':
      return 'Проверить возможность подключения ASI к существующему менеджеру каналов и связаться с владельцем при необходимости.';
    case 'channel_manager_selection_needed':
      return 'Подобрать или подключить менеджер каналов и подготовить объект к передаче на выбранные площадки.';
    case 'channel_manager_explain_and_select':
      return 'Помочь владельцу понять, нужен ли менеджер каналов, и предложить подходящий вариант.';
    default:
      return 'Продолжить подключение объекта через менеджер каналов.';
  }
}

function operatorChecklistForFollowup(kind: OwnerMkFollowupKind): string[] {
  switch (kind) {
    case 'channel_manager_existing_check':
      return [
        'проверить выбранный МК',
        'уточнить, есть ли технический способ подключения ASI',
        'проверить, нужен ли доступ владельца',
        'проверить, какие площадки уже подключены',
        'связаться с владельцем, если нужен доступ или подтверждение',
      ];
    case 'channel_manager_selection_needed':
      return [
        'посмотреть объект',
        'оценить подходящий МК',
        'проверить желаемые площадки',
        'предложить владельцу следующий шаг',
        'не обещать прямое подключение OTA',
      ];
    case 'channel_manager_explain_and_select':
      return [
        'объяснить владельцу роль менеджера каналов',
        'уточнить, есть ли у него уже PMS/МК',
        'если нет, предложить путь подготовки объекта',
      ];
    default:
      return ['проверить следующий шаг подключения через менеджер каналов'];
  }
}

function followupTitle(kind: OwnerMkFollowupKind): string {
  switch (kind) {
    case 'channel_manager_existing_check':
      return 'Проверить подключение ASI к существующему МК';
    case 'channel_manager_selection_needed':
      return 'Подобрать менеджер каналов для объекта';
    case 'channel_manager_explain_and_select':
      return 'Помочь с выбором менеджера каналов';
    default:
      return OPS_TASK_TYPE_LABELS.verify_channel_manager;
  }
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

function buildMkFollowupDescription(params: {
  ownerName: string;
  objectLabel: string;
  state: OwnerOnboardingState;
  kind: OwnerMkFollowupKind;
}): string {
  const cmLabel = channelManagerDisplayName(params.state.selected_channel_manager);
  const placements = placementChannelsLabel(params.state);
  const checklist = operatorChecklistForFollowup(params.kind);
  const lines = [
    `Тип: ${params.kind}`,
    `Владелец: ${params.ownerName}`,
    `Объект: ${params.objectLabel}`,
    params.state.owner_contact ? `Контакт: ${params.state.owner_contact}` : null,
    cmLabel ? `Менеджер каналов: ${cmLabel}` : null,
    params.state.property_in_channel_manager
      ? `Объект в МК: ${
          params.state.property_in_channel_manager === 'yes'
            ? 'да'
            : params.state.property_in_channel_manager === 'no'
              ? 'нет'
              : 'неизвестно'
        }`
      : null,
    placements ? `Желаемые площадки: ${placements}` : null,
    `Следующий шаг оператора: ${operatorNextStepForFollowup(params.kind)}`,
    '',
    'Checklist:',
    ...checklist.map((item) => `- ${item}`),
  ];
  return lines.filter(Boolean).join('\n');
}

export async function ensureOwnerMkFollowupOpsTask(params: {
  contactId: string;
  objectId: string;
  ownerName: string;
  objectLabel: string;
  state: OwnerOnboardingState;
  kind: OwnerMkFollowupKind;
}): Promise<string | null> {
  const description = buildMkFollowupDescription({
    ownerName: params.ownerName,
    objectLabel: params.objectLabel,
    state: params.state,
    kind: params.kind,
  });
  const dedupKey = buildAutoOpsDedupKey({
    source: 'owner_onboarding',
    sourceId: `${params.contactId}:${params.objectId}:${params.kind}`,
    taskType: 'verify_channel_manager',
  });

  const result = await createOpsOperatorTask({
    taskType: 'verify_channel_manager',
    taskStatus: 'new',
    priority: 'normal',
    source: 'communication_autopilot',
    contactId: params.contactId,
    objectId: params.objectId,
    ownerName: params.ownerName,
    objectLabel: params.objectLabel,
    title: followupTitle(params.kind),
    description,
    lastEventText: 'Владелец завершил шаг онбординга — нужен следующий шаг по менеджеру каналов',
    dedupKey,
    metadata: {
      created_by_system: true,
      integration: 'owner_onboarding',
      type: params.kind,
      mk_followup_kind: params.kind,
      checklist: operatorChecklistForFollowup(params.kind),
      onboarding_status: params.state.status,
      owner_contact: params.state.owner_contact ?? null,
      selected_channel_manager: params.state.selected_channel_manager ?? null,
      property_in_channel_manager: params.state.property_in_channel_manager ?? null,
      target_placement_channels: params.state.target_placement_channels ?? params.state.channels_list ?? [],
      readiness_percent: params.state.readiness?.readiness_percent ?? null,
    },
    updateIfExists: {
      description,
      lastEventText: 'Владелец завершил шаг онбординга — нужен следующий шаг по менеджеру каналов',
      taskStatus: 'new',
    },
  });

  if (!result.ok) return null;
  return result.task?.id ?? null;
}

/** @deprecated Use ensureOwnerMkFollowupOpsTask */
export async function ensureOwnerOnboardingReadyFollowupOpsTask(params: {
  contactId: string;
  objectId: string;
  ownerName: string;
  objectLabel: string;
  state: OwnerOnboardingState;
}): Promise<string | null> {
  return ensureOwnerMkFollowupOpsTask({
    ...params,
    kind: resolveOwnerMkFollowupKind(params.state),
  });
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

function shouldRunPilotChain(state: OwnerOnboardingState): boolean {
  if (state.mk_collection_mode === 'minimal') return false;
  if (state.mk_route === 'has_cm' && state.property_in_channel_manager === 'yes') return false;
  return false;
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
    if (shouldRunPilotChain(params.state)) {
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

    opsTaskId = await ensureOwnerMkFollowupOpsTask({
      contactId: params.contactId,
      objectId: params.objectId,
      ownerName: params.ownerName,
      objectLabel: params.objectLabel,
      state: params.state,
      kind: resolveOwnerMkFollowupKind(params.state),
    });
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
