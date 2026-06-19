export const CRM_ROLE_VALUES = ['owner', 'manager', 'partner', 'unknown'] as const;
export type CrmRole = (typeof CRM_ROLE_VALUES)[number];

export const CRM_SOURCE_VALUES = ['telegram', 'form', 'manual', 'bragin_group', 'other'] as const;
export type CrmSource = (typeof CRM_SOURCE_VALUES)[number];

export const CRM_STATUS_VALUES = [
  'new_lead',
  'contact',
  'instruction_sent',
  'waiting_object_data',
  'access_received',
  'test_object_selected',
  'object_setup',
  'ready_for_test',
  'pilot',
  'paused',
  'rejected',
  'not_relevant',
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

export type CrmContact = {
  id: string;
  name: string;
  phone: string;
  telegramUsername: string;
  email: string | null;
  role: CrmRole;
  source: CrmSource;
  objectsCount: number;
  city: string;
  note: string;
  status: CrmStatus;
  communicationStatus: CrmCommunicationStatus;
  lastContactAt: string | null;
  nextStep: string;
  nextActionAt: string | null;
  createdAt: string;
  updatedAt: string;
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

export const CRM_ROLE_LABELS: Record<CrmRole, string> = {
  owner: 'владелец',
  manager: 'управляющий',
  partner: 'партнер',
  unknown: 'неизвестно',
};

export const CRM_SOURCE_LABELS: Record<CrmSource, string> = {
  telegram: 'Telegram',
  form: 'форма',
  manual: 'вручную',
  bragin_group: 'группа Брагина',
  other: 'другое',
};

export const CRM_STATUS_LABELS: Record<CrmStatus, string> = {
  new_lead: 'новый лид',
  contact: 'связаться',
  instruction_sent: 'инструкция отправлена',
  waiting_object_data: 'ждем данные объекта',
  access_received: 'доступ получен',
  test_object_selected: 'выбран тестовый объект',
  object_setup: 'объект на настройке',
  ready_for_test: 'готов к тесту',
  pilot: 'в пилоте',
  paused: 'пауза',
  rejected: 'отказ',
  not_relevant: 'неактуально',
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
