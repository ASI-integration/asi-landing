export const PILOT_ROLE_OPTIONS = ['owner', 'manager', 'other'] as const;
export const PILOT_CHANNEL_MANAGER_OPTIONS = ['bnovo', 'realtycalendar', 'other', 'none'] as const;
export const PILOT_PLATFORM_OPTIONS = [
  'sutochno',
  'avito',
  'ostrovok',
  'yandex_travel',
  'cian',
  'hotels_101',
  'otello',
  'other',
] as const;
export const PILOT_ACTIVE_BOOKINGS_OPTIONS = ['yes', 'no', 'soon'] as const;
export const PILOT_TEST_FOCUS_OPTIONS = ['communications', 'object_setup', 'channels', 'full_cycle'] as const;
export const PILOT_FEEDBACK_OPTIONS = ['yes', 'no', 'unsure'] as const;

export type PilotRoleOption = (typeof PILOT_ROLE_OPTIONS)[number];
export type PilotChannelManagerOption = (typeof PILOT_CHANNEL_MANAGER_OPTIONS)[number];
export type PilotPlatformOption = (typeof PILOT_PLATFORM_OPTIONS)[number];
export type PilotActiveBookingsOption = (typeof PILOT_ACTIVE_BOOKINGS_OPTIONS)[number];
export type PilotTestFocusOption = (typeof PILOT_TEST_FOCUS_OPTIONS)[number];
export type PilotFeedbackOption = (typeof PILOT_FEEDBACK_OPTIONS)[number];

export const PILOT_ROLE_LABELS: Record<PilotRoleOption, string> = {
  owner: 'Владелец',
  manager: 'Управляющий',
  other: 'Другое',
};

export const PILOT_CHANNEL_MANAGER_LABELS: Record<PilotChannelManagerOption, string> = {
  bnovo: 'Bnovo',
  realtycalendar: 'RealtyCalendar',
  other: 'Другой',
  none: 'Не использую',
};

export const PILOT_PLATFORM_LABELS: Record<PilotPlatformOption, string> = {
  sutochno: 'Суточно',
  avito: 'Авито',
  ostrovok: 'Островок',
  yandex_travel: 'Яндекс Путешествия',
  cian: 'ЦИАН',
  hotels_101: '101Hotels',
  otello: 'Отелло',
  other: 'Другое',
};

export const PILOT_ACTIVE_BOOKINGS_LABELS: Record<PilotActiveBookingsOption, string> = {
  yes: 'Да',
  no: 'Нет',
  soon: 'Скоро будут',
};

export const PILOT_TEST_FOCUS_LABELS: Record<PilotTestFocusOption, string> = {
  communications: 'Коммуникации',
  object_setup: 'Подключение объекта',
  channels: 'Каналы',
  full_cycle: 'Полный цикл',
};

export const PILOT_FEEDBACK_LABELS: Record<PilotFeedbackOption, string> = {
  yes: 'Да',
  no: 'Нет',
  unsure: 'Нужно обсудить',
};
