import type {
  OperationAutomationStatus,
  OperationPhase,
  OperationPhaseId,
  OperationScenario,
  OperationStatus,
} from './types';

export const operationPhases: OperationPhase[] = [
  {
    id: 'booking_intake',
    order: 1,
    titleRu: 'Прием бронирования',
    goalRu: 'Зафиксировать бронь, источник, даты, объект и первичные условия.',
    automationRoleRu: 'ASI собирает данные брони и готовит контекст для следующего шага.',
    handoffTriggersRu: ['Нестандартные условия заезда', 'Конфликт дат или объекта'],
  },
  {
    id: 'guest_classification',
    order: 2,
    titleRu: 'Классификация гостя и запроса',
    goalRu: 'Понять тип гостя, намерение обращения, риск и нужный сценарий.',
    automationRoleRu: 'Система классифицирует входящее сообщение и выбирает маршрут обработки.',
    handoffTriggersRu: ['Неясный запрос', 'Высокий риск жалобы', 'Нужно решение оператора'],
  },
  {
    id: 'pre_arrival',
    order: 3,
    titleRu: 'Подготовка к заезду',
    goalRu: 'Подготовить инструкции, доступы, клининг, состояние объекта и коммуникацию.',
    automationRoleRu: 'ASI запускает чек-лист подготовки и напоминает исполнителям о дедлайнах.',
    handoffTriggersRu: ['Не готов доступ', 'Клининг не подтвержден', 'Гость просит исключение'],
  },
  {
    id: 'stay_support',
    order: 4,
    titleRu: 'Поддержка проживания',
    goalRu: 'Решать вопросы гостя во время проживания и фиксировать операционные события.',
    automationRoleRu: 'Типовые вопросы закрываются автоматически, инциденты попадают в контроль.',
    handoffTriggersRu: ['Поломка', 'Жалоба', 'Нужен выезд партнера'],
  },
  {
    id: 'checkout',
    order: 5,
    titleRu: 'Выезд',
    goalRu: 'Провести выезд, проверить состояние объекта и закрыть задачи по брони.',
    automationRoleRu: 'ASI отправляет инструкции, собирает подтверждения и ставит задачи проверки.',
    handoffTriggersRu: ['Поздний выезд', 'Ущерб', 'Гость не отвечает'],
  },
  {
    id: 'review_follow_up',
    order: 6,
    titleRu: 'Отзыв и повторный гость',
    goalRu: 'Запросить отзыв, обработать обратную связь и запустить follow-up.',
    automationRoleRu: 'Система отправляет запрос отзыва и отмечает потенциал повторного бронирования.',
    handoffTriggersRu: ['Негативный отзыв', 'VIP-гость', 'Компенсация или персональный ответ'],
  },
];

export const operationStatusLabelsRu: Record<OperationStatus, string> = {
  queued: 'В очереди',
  active: 'В работе',
  waiting_guest: 'Ждет гостя',
  waiting_partner: 'Ждет партнера',
  needs_human: 'Нужен оператор',
  completed: 'Завершено',
};

export const operationAutomationLabelsRu: Record<OperationAutomationStatus, string> = {
  automated: 'Автоматически',
  semi_automated: 'Автоматически с контролем',
  manual_review: 'Ручная проверка',
};

export function getOperationPhase(phaseId: OperationPhaseId): OperationPhase {
  const phase = operationPhases.find((item) => item.id === phaseId);

  if (!phase) {
    throw new Error(`Unknown operation phase: ${phaseId}`);
  }

  return phase;
}

export function getNextOperationPhase(phaseId: OperationPhaseId): OperationPhase | null {
  const phase = getOperationPhase(phaseId);
  return operationPhases.find((item) => item.order === phase.order + 1) ?? null;
}

export function getOperationProgress(phaseId: OperationPhaseId) {
  const phase = getOperationPhase(phaseId);

  return {
    current: phase.order,
    total: operationPhases.length,
    percent: Math.round((phase.order / operationPhases.length) * 100),
  };
}

export function isTerminalOperationStatus(status: OperationStatus): boolean {
  return status === 'completed';
}

export function needsHumanHandoff(operation: OperationScenario): boolean {
  return operation.status === 'needs_human' || operation.nextAction.handoffRequired;
}

export function getOperationLifecycleLabel(operation: OperationScenario): string {
  if (needsHumanHandoff(operation)) return 'Требуется оператор';
  if (operation.automationStatus === 'manual_review') return 'На ручной проверке';
  if (operation.status === 'waiting_guest') return 'Ожидает ответа гостя';
  if (operation.status === 'waiting_partner') return 'Ожидает исполнителя';
  if (operation.status === 'completed') return 'Сценарий закрыт';
  return 'Автопилот активен';
}

export function getOperationsByPhase(operations: OperationScenario[]) {
  return operationPhases.map((phase) => ({
    phase,
    operations: operations.filter((operation) => operation.phaseId === phase.id),
  }));
}
