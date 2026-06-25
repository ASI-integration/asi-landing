import type { CrmCommunicationStatus, CrmStatus } from '@/lib/crm/types';
import type { OpsTaskStatus } from '@/lib/ops-board/types';

export const OPS_PILOT_STAGE_VALUES = [
  'new_lead',
  'access_received',
  'object_created',
  'object_filling',
  'cm_preparing',
  'ready_for_cm_check',
  'ops_task_created',
  'needs_manual_control',
  'ready_for_next_step',
] as const;

export type OpsPilotStage = (typeof OPS_PILOT_STAGE_VALUES)[number];

export const OPS_PILOT_STAGE_LABELS: Record<OpsPilotStage, string> = {
  new_lead: 'Новый лид',
  access_received: 'Доступ/контакт получен',
  object_created: 'Объект создан',
  object_filling: 'Объект заполняется',
  cm_preparing: 'Менеджер каналов готовится',
  ready_for_cm_check: 'Готов к проверке МК',
  ops_task_created: 'OPS-задача создана',
  needs_manual_control: 'Нужен ручной контроль',
  ready_for_next_step: 'Готов к следующему шагу',
};

export const OPS_PILOT_BLOCKER_KEYS = [
  'no_linked_object',
  'object_not_filled',
  'missing_cm_data',
  'no_ops_task',
  'no_owner_contact',
  'stalled',
] as const;

export type OpsPilotBlockerKey = (typeof OPS_PILOT_BLOCKER_KEYS)[number];

export type OpsPilotBlocker = {
  key: OpsPilotBlockerKey;
  labelRu: string;
};

export type OpsPilotQuickLinks = {
  crmHref: string;
  objectHref: string | null;
  channelManagerHref: string | null;
  opsTaskHref: string | null;
};

export type OpsPilotOpsTaskSummary = {
  id: string;
  title: string;
  status: OpsTaskStatus;
  statusLabelRu: string;
  updatedAt: string;
};

export type OpsPilotParticipant = {
  contactId: string;
  name: string;
  phone: string;
  telegramUsername: string;
  crmStatus: CrmStatus;
  crmStatusLabelRu: string;
  communicationStatus: CrmCommunicationStatus;
  objectId: string | null;
  objectTitle: string | null;
  readinessPercent: number | null;
  readinessLabelRu: string | null;
  channelManagerStatusLabelRu: string | null;
  channelManagerNextStepRu: string | null;
  stage: OpsPilotStage;
  stageLabelRu: string;
  nextActionRu: string;
  blockers: OpsPilotBlocker[];
  isStalled: boolean;
  needsManualHelp: boolean;
  opsTask: OpsPilotOpsTaskSummary | null;
  lastUpdatedAt: string | null;
  links: OpsPilotQuickLinks;
  operatorNote: string;
};

export type OpsPilotOperatorAction = 'mark_manual_control' | 'mark_waiting_owner' | 'add_note';
