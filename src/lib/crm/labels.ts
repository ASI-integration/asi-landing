import type { CrmEventType, CrmRole, CrmSource, CrmStatus } from './types';

export const CRM_ROLE_LABELS: Record<CrmRole, string> = {
  lead: 'Лид',
  owner: 'Владелец',
  manager: 'Управляющий',
  guest: 'Гость',
  unknown: 'Неизвестный',
};

export const CRM_SOURCE_LABELS: Record<CrmSource, string> = {
  telegram: 'Telegram',
  landing: 'Лендинг',
  manual: 'Вручную',
  test: 'Тест',
};

export const CRM_STATUS_LABELS: Record<CrmStatus, string> = {
  new: 'Новый',
  needs_clarification: 'Нужно уточнить',
  qualified: 'Квалифицирован',
  creating_object: 'Создаёт объект',
  object_filled: 'Объект заполнен',
  testing_communication: 'Тестирует коммуникацию',
  pilot_active: 'Пилот активен',
  paused: 'Пауза',
  not_fit: 'Не подходит',
};

export const CRM_EVENT_TYPE_LABELS: Record<CrmEventType, string> = {
  escalation: 'Эскалация',
  missing_data: 'Не хватает данных',
  blocked: 'Заблокировано',
  auto_reply: 'Автоответ',
  message_inbound: 'Входящее сообщение',
  message_outbound: 'Исходящее сообщение',
  status_change: 'Изменение статуса',
  note: 'Заметка',
};

export const CRM_FILTER_LABELS: Record<string, string> = {
  all: 'Все',
  new: 'Новые',
  needs_reaction: 'Нужна реакция',
  testing: 'Тестируют',
  pilot_active: 'Пилот активен',
  escalations: 'Эскалации',
};
