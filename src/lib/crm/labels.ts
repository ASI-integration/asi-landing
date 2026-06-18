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
  pilot_form: 'Форма пилота',
};

export const CRM_STATUS_LABELS: Record<CrmStatus, string> = {
  new: 'Новый',
  needs_clarification: 'Нужно уточнить',
  qualified: 'Квалифицирован',
  creating_object: 'Создает объект',
  object_filled: 'Объект заполнен',
  testing_communication: 'Тестирует коммуникацию',
  needs_reaction: 'Нужна реакция',
  pilot_active: 'Пилот активен',
  pilot_candidate: 'Кандидат в пилот',
  pilot_selected: 'Выбран в пилот',
  pilot_waitlist: 'Лист ожидания',
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
  role_selected_owner: 'Выбрана роль: владелец',
  role_selected_lead: 'Выбрана роль: лид',
  role_selected_guest: 'Выбрана роль: гость',
  guest_test_ready: 'Готов к тесту гостя',
  guest_test_started: 'Запущен тест гостя',
  guest_test_question: 'Вопрос тестового гостя',
  operator_followup_required: 'Нужен ответ оператора',
  operator_followup_sent: 'Ответ оператора отправлен',
  pilot_application_submitted: 'Заявка в пилот',
  pilot_selected: 'Выбран в пилот',
  status_change: 'Изменение статуса',
  note: 'Заметка',
};

export const CRM_FILTER_LABELS: Record<string, string> = {
  all: 'Все',
  new: 'Новые',
  needs_reaction: 'Нужна реакция',
  pilot_candidates: 'Кандидаты в пилот',
  pilot_selected: 'Выбраны в пилот',
  testing: 'Тестируют',
  pilot_active: 'Пилот активен',
  escalations: 'Эскалации',
};
