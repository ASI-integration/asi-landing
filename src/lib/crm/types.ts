export const CRM_ROLE_VALUES = ['owner', 'manager', 'partner', 'unknown'] as const;
export type CrmRole = (typeof CRM_ROLE_VALUES)[number];

export const CRM_SOURCE_VALUES = ['telegram', 'web', 'dashboard', 'unknown', 'form', 'manual', 'bragin_group', 'other'] as const;
export type CrmSource = (typeof CRM_SOURCE_VALUES)[number];

export const PILOT_ROLLOUT_STATUS_VALUES = [
  'new',
  'waitlist',
  'invited',
  'onboarding',
  'active_pilot',
  'paused',
  'rejected',
] as const;
export type PilotRolloutStatus = (typeof PILOT_ROLLOUT_STATUS_VALUES)[number];

export const CRM_LEGACY_STATUS_VALUES = [
  'new_lead',
  'contact',
  'contact_sent',
  'operator_needed',
  'access_requested',
  'instruction_sent',
  'waiting_object_data',
  'access_received',
  'test_object_selected',
  'ready_for_setup',
  'object_setup',
  'ready_for_test',
  'pilot',
  'not_relevant',
] as const;

export const CRM_STATUS_VALUES = [
  ...PILOT_ROLLOUT_STATUS_VALUES,
  ...CRM_LEGACY_STATUS_VALUES,
] as const;
export type CrmStatus = (typeof CRM_STATUS_VALUES)[number];

export const CRM_COMMUNICATION_STATUS_VALUES = [
  'no_contact',
  'wrote_first',
  'waiting_reply',
  'replied',
  'needs_manual_reaction',
  'has_problem',
  'escalation_closed',
] as const;
export type CrmCommunicationStatus = (typeof CRM_COMMUNICATION_STATUS_VALUES)[number];

export const CRM_ONBOARDING_STATUS_VALUES = [
  'onboarding_started',
  'missing_required_data',
  'ready_for_channel_manager',
  'channel_manager_started',
  'needs_operator',
] as const;
export type CrmOnboardingStatus = (typeof CRM_ONBOARDING_STATUS_VALUES)[number];

export type CrmOwnerObject = {
  objectId: string;
  title: string;
  readinessPercent: number | null;
  isActiveSession: boolean;
};

export type CrmChannelManagerConnection = {
  objectId: string | null;
  contactId: string | null;
  method: 'realtycalendar' | 'bnovo' | 'manual_import' | 'other' | 'none_yet' | null;
  customManagerName: string | null;
  accessSituation: 'has_access' | 'from_scratch' | 'needs_help' | null;
  status:
    | 'ready_to_connect'
    | 'waiting_access'
    | 'verifying_data'
    | 'prepared'
    | 'needs_operator'
    | 'connected'
    | 'primary_setup_needed';
  nextStepRu: string;
  selectedChannelManager?: string | null;
  channelManagerRoute?: 'has_manager' | 'no_manager' | 'unknown' | null;
  objectInChannelManager?: 'yes' | 'no' | 'unknown' | null;
  targetPlacementChannels?: string[];
  connectionStatus?:
    | 'needs_manager_check'
    | 'needs_manager_selection'
    | 'needs_object_preparation'
    | 'needs_access_confirmation'
    | 'ready_for_operator_review'
    | 'waiting_for_owner'
    | 'done'
    | null;
  nextOperatorAction?: string | null;
  nextOwnerMessage?: string | null;
  updatedAt: string | null;
};

export type CrmOnboarding = {
  status: CrmOnboardingStatus;
  statusLabel: string;
  missing: string[];
  lastMessage: string;
  channelManagerHref: string | null;
  readinessPercent: number | null;
  readinessStatusLabel: string | null;
  nextBestStep: string | null;
  missingOptional: string[];
  objectType?: string | null;
  checkinTime?: string | null;
  checkoutTime?: string | null;
  channels?: string[];
  rules?: string[];
  wifiName?: string | null;
  wifiPassword?: string | null;
  photosCount?: number | null;
};

export const CRM_OPS_NEXT_ACTION_VALUES = [
  'send_instruction',
  'request_access',
  'mark_access_received',
  'choose_test_property',
  'open_channel_manager',
  'start_channel_setup',
  'mark_ready_for_setup',
  'pause',
  'problem_detected',
] as const;
export type CrmOpsNextAction = (typeof CRM_OPS_NEXT_ACTION_VALUES)[number];

export type CrmOpsAutomationState =
  | 'action_required'
  | 'waiting'
  | 'automatic_action_available'
  | 'needs_operator_attention'
  | 'manual_override'
  | 'paused'
  | 'completed';

export type CrmOpsAutomationDecision = {
  currentStage: CrmStatus;
  nextAction: CrmOpsNextAction;
  automationState: CrmOpsAutomationState;
  needsOperatorAction: boolean;
  canAutoPerform: boolean;
  recommendedStatus: CrmStatus | null;
  reason: string;
  evaluatedAt: string;
};

export type CrmContact = {
  id: string;
  name: string;
  phone: string;
  telegramUsername: string;
  telegramId?: string;
  email: string | null;
  role: CrmRole;
  source: CrmSource;
  interestContext?: 'channel_manager_setup' | 'asi_connection' | 'support' | 'unknown';
  objectsCount: number;
  city: string;
  note: string;
  status: CrmStatus;
  communicationStatus: CrmCommunicationStatus;
  responsibleName?: string;
  responsibleTelegram?: string;
  responsiblePhone?: string;
  lastMessage?: string;
  lastReason?: string;
  lastContactAt: string | null;
  nextStep: string;
  nextActionAt: string | null;
  createdAt: string;
  updatedAt: string;
  crmArchived?: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  onboarding?: CrmOnboarding | null;
  channelManagerConnection?: CrmChannelManagerConnection | null;
  ownerObjects?: CrmOwnerObject[];
  activeObjectTitle?: string | null;
  opsAutomation?: CrmOpsAutomationDecision;
};

export type CrmContactInput = {
  name?: unknown;
  phone?: unknown;
  telegramUsername?: unknown;
  email?: unknown;
  role?: unknown;
  source?: unknown;
  objectsCount?: unknown;
  city?: unknown;
  note?: unknown;
  status?: unknown;
  communicationStatus?: unknown;
  lastContactAt?: unknown;
  nextStep?: unknown;
  nextActionAt?: unknown;
};

export type GuestTestQuestionOutcome =
  | 'answered_from_property_data'
  | 'answered_from_global_rule'
  | 'answered_by_concierge_autopilot'
  | 'missing_data'
  | 'operator_followup_required';

export const CRM_ROLE_LABELS: Record<CrmRole, string> = {
  owner: 'владелец',
  manager: 'управляющий',
  partner: 'партнер',
  unknown: 'неизвестно',
};

export const CRM_SOURCE_LABELS: Record<CrmSource, string> = {
  telegram: 'Telegram',
  web: 'сайт',
  dashboard: 'дашборд',
  unknown: 'неизвестно',
  form: 'форма',
  manual: 'вручную',
  bragin_group: 'группа Брагина',
  other: 'другое',
};

export const PILOT_ROLLOUT_STATUS_LABELS: Record<PilotRolloutStatus, string> = {
  new: 'Новая заявка',
  waitlist: 'Лист ожидания',
  invited: 'Приглашён в пилот',
  onboarding: 'Настройка объекта',
  active_pilot: 'Участник пилота',
  paused: 'Пауза',
  rejected: 'Не подходит сейчас',
};

export const CRM_STATUS_LABELS: Record<CrmStatus, string> = {
  new: 'Новая заявка',
  waitlist: 'Лист ожидания',
  invited: 'Приглашён в пилот',
  onboarding: 'Настройка объекта',
  active_pilot: 'Участник пилота',
  paused: 'Пауза',
  rejected: 'Не подходит сейчас',
  new_lead: 'Новая заявка',
  contact: 'Связаться',
  contact_sent: 'Инструкция отправлена',
  operator_needed: 'Нужен оператор',
  access_requested: 'Доступ запрошен',
  instruction_sent: 'Инструкция отправлена',
  waiting_object_data: 'Ждём данные объекта',
  access_received: 'Доступ получен',
  test_object_selected: 'Выбран тестовый объект',
  ready_for_setup: 'Готов к настройке',
  object_setup: 'Объект на настройке',
  ready_for_test: 'Готов к тесту',
  pilot: 'Участник пилота',
  not_relevant: 'Не подходит сейчас',
};

export const CRM_COMMUNICATION_STATUS_LABELS: Record<CrmCommunicationStatus, string> = {
  no_contact: 'нет контакта',
  wrote_first: 'написал первым',
  waiting_reply: 'ждем ответа',
  replied: 'ответил',
  needs_manual_reaction: 'нужна ручная реакция',
  has_problem: 'есть проблема',
  escalation_closed: 'эскалация закрыта',
};

export const CRM_ONBOARDING_STATUS_LABELS: Record<CrmOnboardingStatus, string> = {
  onboarding_started: 'онбординг начат',
  missing_required_data: 'не хватает данных',
  ready_for_channel_manager: 'готов к менеджеру каналов',
  channel_manager_started: 'менеджер каналов открыт',
  needs_operator: 'нужна реакция оператора',
};
