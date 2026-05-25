import type { OperationEntityType, OperationFoundationItem, OperationStatus } from './types';

export const operationEntityLabels: Record<OperationEntityType, string> = {
  booking_intake: 'Приём брони',
  check_in: 'Доступ и заезд',
  cleaning: 'Уборка',
  maintenance: 'Мастер',
  guest_issue: 'Проблема гостя',
  owner_operator_task: 'Оператор',
};

export const operationStatusLabels: Record<OperationStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  waiting_guest: 'Ждём гостя',
  waiting_executor: 'Ждём исполнителя',
  done: 'Готово',
  escalated: 'Эскалация',
};

export const operationStatusOrder: OperationStatus[] = [
  'new',
  'in_progress',
  'waiting_guest',
  'waiting_executor',
  'done',
  'escalated',
];

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
    title: 'Принять новую бронь и проверить данные гостя',
    description: 'Заявка пришла из канала. Нужно сверить даты, объект, контакт гостя и условия заезда.',
    propertyLabel: 'Апартаменты на Тверской',
    owner: 'Менеджер брони',
    dueLabel: 'Сегодня, 12:00',
    sourceLabel: 'Новая бронь',
    nextStep: 'Подтвердить объект и перевести в подготовку заезда.',
    communicationLinked: false,
  },
  {
    id: 'ops-002',
    type: 'check_in',
    status: 'in_progress',
    title: 'Ночной заезд: подготовить доступ и инструкцию',
    description: 'Гость приезжает после 23:00. ASI показывает, что нужно проверить до отправки инструкции.',
    propertyLabel: 'Студия у метро Маяковская',
    owner: 'Оператор',
    dueLabel: 'До 21:00',
    sourceLabel: 'Бронь + сообщение',
    nextStep: 'Проверить код доступа и отправить короткую инструкцию гостю.',
    communicationLinked: true,
  },
  {
    id: 'ops-003',
    type: 'cleaning',
    status: 'waiting_executor',
    title: 'Уборка после выезда',
    description: 'Выезд отмечен. Задача ждёт подтверждения от клининга и фото готовности.',
    propertyLabel: 'Лофт на Бауманской',
    owner: 'Клининг',
    dueLabel: 'Сегодня, 16:00',
    sourceLabel: 'Выезд',
    nextStep: 'Получить отметку исполнителя и фото после уборки.',
    communicationLinked: false,
  },
  {
    id: 'ops-004',
    type: 'guest_issue',
    status: 'escalated',
    title: 'Проблема с доступом',
    description: 'Гость пишет, что код не подходит. Событие из коммуникаций стало срочной операционной задачей.',
    propertyLabel: 'Квартира на Арбате',
    owner: 'Оператор',
    dueLabel: 'Сейчас',
    sourceLabel: 'Telegram',
    nextStep: 'Проверить актуальный код и ответить гостю вручную.',
    communicationLinked: true,
  },
  {
    id: 'ops-005',
    type: 'maintenance',
    status: 'waiting_executor',
    title: 'Заявка на мастера: не работает смеситель',
    description: 'После сообщения гостя создана задача для мастера. В MVP это ручная отметка без внешней интеграции.',
    propertyLabel: 'Апартаменты на Патриарших',
    owner: 'Мастер',
    dueLabel: 'Завтра, 11:00',
    sourceLabel: 'Сообщение гостя',
    nextStep: 'Дождаться времени визита и отметить результат.',
    communicationLinked: true,
  },
  {
    id: 'ops-006',
    type: 'owner_operator_task',
    status: 'waiting_guest',
    title: 'Сообщение оператору: уточнить поздний выезд',
    description: 'Оператор запросил подтверждение у гостя. До ответа задача остаётся в ожидании гостя.',
    propertyLabel: 'Портфель Москва',
    owner: 'Оператор',
    dueLabel: '30 минут',
    sourceLabel: 'Телефон',
    nextStep: 'Получить ответ гостя и закрыть или передать менеджеру.',
    communicationLinked: true,
  },
  {
    id: 'ops-007',
    type: 'check_in',
    status: 'done',
    title: 'Заезд подтверждён',
    description: 'Гость получил инструкцию, вошёл в объект и не требует ручного действия.',
    propertyLabel: 'Мини-апарт на Садовом',
    owner: 'ASI Ops',
    dueLabel: 'Готово',
    sourceLabel: 'Операция',
    nextStep: 'Следить за обращениями во время проживания.',
    communicationLinked: false,
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
