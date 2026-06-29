import type { BookingOpsEvent } from './events';
import type { BookingReadinessResult, BookingReadinessStatus } from './readiness';
import { syncBookingOpsTasksForReadiness } from './task-sync';
import {
  BOOKING_OPS_OPEN_TASK_STATUSES,
  BOOKING_OPS_TASK_ACTION_LABELS_RU,
  type BookingOpsTask,
  type BookingOpsTaskType,
} from './task-types';
import type { BookingOpsRecord, BookingOpsTelegramDraft } from './types';

export const BOOKING_OPS_OPERATOR_STAGES = [
  'booking_data',
  'documents',
  'contract',
  'deposit',
  'mvd',
  'telegram_drafts',
  'completed',
] as const;

export type BookingOpsOperatorStage = (typeof BOOKING_OPS_OPERATOR_STAGES)[number];
export type BookingOpsOperatorProgressStatus = 'completed' | 'current' | 'pending';

export type BookingOpsOperatorProgressItem = {
  stage: BookingOpsOperatorStage;
  label: string;
  status: BookingOpsOperatorProgressStatus;
};

export type BookingOpsOperatorGuidance = {
  stage: BookingOpsOperatorStage;
  title: string;
  description: string;
  blockingReason: string | null;
  recommendedTaskType: BookingOpsTaskType | null;
  recommendedActionLabel: string | null;
  progress: BookingOpsOperatorProgressItem[];
};

const STAGE_LABELS: Record<BookingOpsOperatorStage, string> = {
  booking_data: 'Данные брони',
  documents: 'Документы',
  contract: 'Договор',
  deposit: 'Депозит',
  mvd: 'МВД',
  telegram_drafts: 'Черновики',
  completed: 'Завершено',
};

const READINESS_STAGE: Record<BookingReadinessStatus, BookingOpsOperatorStage> = {
  missing_booking_data: 'booking_data',
  missing_documents: 'documents',
  missing_contract: 'contract',
  missing_deposit: 'deposit',
  missing_mvd_data: 'mvd',
  ready_for_drafts: 'telegram_drafts',
  drafts_created: 'telegram_drafts',
  ready_for_manual_send: 'telegram_drafts',
  completed: 'completed',
};

function progressFor(stage: BookingOpsOperatorStage): BookingOpsOperatorProgressItem[] {
  const currentIndex = BOOKING_OPS_OPERATOR_STAGES.indexOf(stage);
  return BOOKING_OPS_OPERATOR_STAGES.map((item, index) => ({
    stage: item,
    label: STAGE_LABELS[item],
    status: index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'pending',
  }));
}

function guidanceCopy(
  readiness: BookingReadinessResult,
  taskType: BookingOpsTaskType | null,
  drafts: BookingOpsTelegramDraft[],
): Pick<BookingOpsOperatorGuidance, 'title' | 'description'> {
  switch (readiness.status) {
    case 'missing_booking_data':
      return {
        title: 'Заполните базовые данные брони: объект, даты, гость.',
        description: readiness.missingItems.slice(0, 3).join(' ') || 'Без базовых данных нельзя перейти к подготовке заезда.',
      };
    case 'missing_documents':
      return taskType === 'verify_guest_documents'
        ? {
            title: 'Проверьте документы и завершите задачу проверки.',
            description: 'Документы уже загружены, но оператор ещё не подтвердил их корректность.',
          }
        : {
            title: 'Запросите документы у гостя.',
            description: 'Используйте задачу request_guest_documents: она подготовит только черновик для ручной отправки.',
          };
    case 'missing_contract':
      if (taskType === 'send_contract_manual') {
        return {
          title: 'Проверьте договор и отправьте его гостю вручную.',
          description: 'Договор подготовлен; после ручной отправки обновите статус задачи и брони.',
        };
      }
      if (taskType === 'follow_up_contract_signature') {
        return {
          title: 'Проверьте подписание договора.',
          description: 'Договор уже отправлен вручную, но этап завершится только после подтверждения подписи.',
        };
      }
      return {
        title: 'Подготовьте договор.',
        description: 'Затем отметьте задачу prepare_contract выполненной — статус брони обновится через существующий обработчик.',
      };
    case 'missing_deposit':
      return taskType === 'confirm_deposit'
        ? {
            title: 'Подтвердите получение депозита.',
            description: 'Запрос уже подготовлен; вручную проверьте поступление и завершите задачу подтверждения.',
          }
        : {
            title: 'Создайте черновик запроса залога.',
            description: 'После ручной отправки отметьте request_deposit выполненной. Автоматической отправки нет.',
          };
    case 'missing_mvd_data':
      if (taskType === 'prepare_mvd_report') {
        return {
          title: 'Подготовьте отчёт МВД по собранным данным.',
          description: 'Данные уже собраны; проверьте их вручную перед следующим этапом.',
        };
      }
      if (taskType === 'submit_mvd_report') {
        return {
          title: 'Передайте отчёт МВД вручную.',
          description: 'Отчёт подготовлен; внешняя интеграция не подключена, поэтому отправку подтверждает оператор.',
        };
      }
      return {
        title: 'Соберите данные МВД.',
        description: 'Откройте чеклист задачи collect_mvd_data и отметьте её выполненной после ручной проверки.',
      };
    case 'ready_for_drafts':
      return {
        title: 'Создайте черновики Telegram.',
        description: 'Все обязательные этапы пройдены. Черновики останутся внутри Booking Ops до ручной отправки.',
      };
    case 'drafts_created':
      return {
        title: 'Проверьте черновики Telegram.',
        description: `Создано черновиков: ${drafts.length}. Проверьте текст и скопируйте сообщения перед ручной отправкой.`,
      };
    case 'ready_for_manual_send':
      return {
        title: 'Проверьте Telegram drafts и отправьте вручную.',
        description: 'Автоматической отправки нет. После ручной отправки отметьте статусы черновиков.',
      };
    case 'completed':
      return {
        title: 'Бронь операционно завершена.',
        description: 'Все обязательные этапы и ручная отправка черновиков подтверждены.',
      };
  }
}

function latestTaskAction(events: BookingOpsEvent[]): BookingOpsEvent | null {
  return events
    .filter((event) => event.eventType === 'task_action_run')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

/** Pure guidance composed from existing readiness, task-sync and timeline state. */
export function getBookingOpsOperatorGuidance(
  record: BookingOpsRecord,
  readiness: BookingReadinessResult,
  tasks: BookingOpsTask[],
  events: BookingOpsEvent[],
  drafts: BookingOpsTelegramDraft[],
): BookingOpsOperatorGuidance {
  const stage = READINESS_STAGE[readiness.status];
  const plannedTaskType = syncBookingOpsTasksForReadiness(record, readiness).items[0]?.taskType ?? null;
  const openTasks = tasks.filter((task) => BOOKING_OPS_OPEN_TASK_STATUSES.includes(task.status));
  const recommendedTask =
    openTasks.find((task) => task.taskType === plannedTaskType)
    ?? openTasks.find((task) => task.source === 'readiness_gate')
    ?? null;
  const recommendedTaskType = recommendedTask?.taskType ?? plannedTaskType;
  const latestAction = latestTaskAction(events);
  const latestActionBlocked = latestAction?.metadata.actionOutcome === 'blocked';
  const latestActionMatches = !recommendedTaskType
    || latestAction?.metadata.actionType === recommendedTaskType;
  const blockingReason = record.isBlocked
    ? record.blockerReason || 'Бронь остановлена оператором.'
    : recommendedTask?.status === 'blocked'
      ? recommendedTask.description || 'Рекомендуемая задача заблокирована.'
      : latestActionBlocked && latestActionMatches
        ? latestAction?.description || 'Последнее действие остановлено до устранения условий готовности.'
        : null;
  const copy = guidanceCopy(readiness, recommendedTaskType, drafts);

  return {
    stage,
    ...copy,
    blockingReason,
    recommendedTaskType,
    recommendedActionLabel: recommendedTaskType
      ? BOOKING_OPS_TASK_ACTION_LABELS_RU[recommendedTaskType] ?? null
      : null,
    progress: progressFor(stage),
  };
}
