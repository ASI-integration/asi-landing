import type { OperationEntityType, OperationFoundationItem, OperationStatus } from './types';

export const operationEntityLabels: Record<OperationEntityType, string> = {
  booking_intake: 'Новая бронь',
  check_in: 'Заезд',
  cleaning: 'Уборка',
  maintenance: 'Ремонт',
  guest_issue: 'Вопрос гостя',
  owner_operator_task: 'Задача команды',
};

export const operationStatusLabels: Record<OperationStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  waiting: 'Ждём',
  done: 'Готово',
  escalated: 'Срочно',
};

export const operationStatusOrder: OperationStatus[] = ['new', 'in_progress', 'waiting', 'done', 'escalated'];

export const operationEntityOrder: OperationEntityType[] = [
  'booking_intake',
  'check_in',
  'cleaning',
  'maintenance',
  'guest_issue',
  'owner_operator_task',
];

export const operationsFoundationItems: OperationFoundationItem[] = [
  {
    id: 'ops-001',
    type: 'booking_intake',
    status: 'new',
    title: 'Проверить новую заявку перед подтверждением',
    propertyLabel: 'Апартаменты на Тверской',
    owner: 'Менеджер брони',
    dueLabel: 'Сегодня',
    sourceLabel: 'Ручной ввод',
  },
  {
    id: 'ops-002',
    type: 'check_in',
    status: 'in_progress',
    title: 'Подготовить инструкцию к заезду',
    propertyLabel: 'Студия у метро Маяковская',
    owner: 'Оператор',
    dueLabel: 'До 15:00',
    sourceLabel: 'Коммуникации',
  },
  {
    id: 'ops-003',
    type: 'cleaning',
    status: 'waiting',
    title: 'Дождаться фото после уборки',
    propertyLabel: 'Лофт на Бауманской',
    owner: 'Клининг',
    dueLabel: 'Сегодня',
    sourceLabel: 'Внутренняя задача',
  },
  {
    id: 'ops-004',
    type: 'maintenance',
    status: 'escalated',
    title: 'Проверить жалобу на протечку',
    propertyLabel: 'Квартира на Арбате',
    owner: 'Техник',
    dueLabel: 'Сейчас',
    sourceLabel: 'Гость',
  },
  {
    id: 'ops-005',
    type: 'guest_issue',
    status: 'in_progress',
    title: 'Ответить гостю по раннему заезду',
    propertyLabel: 'Апартаменты на Патриарших',
    owner: 'Оператор',
    dueLabel: '30 минут',
    sourceLabel: 'Telegram',
  },
  {
    id: 'ops-006',
    type: 'owner_operator_task',
    status: 'done',
    title: 'Сверить правило по позднему выезду',
    propertyLabel: 'Портфель Москва',
    owner: 'Старший менеджер',
    dueLabel: 'Готово',
    sourceLabel: 'Команда',
  },
];

export function countOperationsByStatus(items: OperationFoundationItem[]): Record<OperationStatus, number> {
  return operationStatusOrder.reduce(
    (counts, status) => ({
      ...counts,
      [status]: items.filter((item) => item.status === status).length,
    }),
    {} as Record<OperationStatus, number>,
  );
}
