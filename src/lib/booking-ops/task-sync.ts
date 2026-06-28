import type { BookingReadinessResult } from './readiness';
import type { BookingOpsRecord } from './types';
import {
  BOOKING_OPS_TASK_TYPE_LABELS_RU,
  type BookingOpsTaskPlanItem,
  type BookingOpsTaskType,
} from './task-types';

export type BookingOpsTaskSyncPlan = {
  items: BookingOpsTaskPlanItem[];
  readinessStatus: BookingReadinessResult['status'];
};

function planItem(
  taskType: BookingOpsTaskType,
  description: string | null,
  priority: BookingOpsTaskPlanItem['priority'] = 'normal',
  metadata?: Record<string, unknown>,
): BookingOpsTaskPlanItem {
  return {
    taskType,
    title: BOOKING_OPS_TASK_TYPE_LABELS_RU[taskType],
    description,
    priority,
    metadata,
  };
}

function documentVerification(
  record: BookingOpsRecord,
): 'missing' | 'uploaded' | 'verified' | 'rejected' | null {
  if (record.documentVerificationStatus) return record.documentVerificationStatus;
  switch (record.documentsStatus) {
    case 'received':
      return 'uploaded';
    case 'verified':
      return 'verified';
    case 'problem':
      return 'rejected';
    default:
      return 'missing';
  }
}

function contractIntake(
  record: BookingOpsRecord,
): 'not_required' | 'missing' | 'prepared' | 'sent' | 'signed' {
  if (record.contractIntakeStatus) return record.contractIntakeStatus;
  switch (record.contractStatus) {
    case 'prepared':
      return 'prepared';
    case 'sent':
      return 'sent';
    case 'signed':
      return 'signed';
    default:
      return 'missing';
  }
}

function depositIntake(
  record: BookingOpsRecord,
): 'not_required' | 'missing' | 'requested' | 'received' | 'held' | 'returned' | 'issue' {
  if (record.depositIntakeStatus) return record.depositIntakeStatus;
  switch (record.depositStatus) {
    case 'requested':
      return 'requested';
    case 'confirmed':
      return 'received';
    case 'problem':
      return 'issue';
    default:
      return 'missing';
  }
}

function mvdDataStatus(
  record: BookingOpsRecord,
): 'not_required' | 'missing' | 'collected' | 'prepared' | 'submitted' | 'confirmed' {
  if (record.mvdDataStatus) return record.mvdDataStatus;
  switch (record.mvdStatus) {
    case 'prepared':
      return 'prepared';
    case 'submitted':
      return 'submitted';
    case 'not_required':
      return 'not_required';
    default:
      return 'missing';
  }
}

function depositReturnTask(record: BookingOpsRecord, readiness: BookingReadinessResult): BookingOpsTaskPlanItem | null {
  if (record.depositRequired !== true) return null;
  const intake = depositIntake(record);
  if (intake !== 'received' && intake !== 'held') return null;
  if (
    readiness.status === 'missing_deposit'
    || readiness.status === 'missing_booking_data'
    || readiness.status === 'missing_documents'
    || readiness.status === 'missing_contract'
    || readiness.status === 'missing_mvd_data'
  ) {
    return null;
  }
  return planItem(
    'track_deposit_return',
    'Депозит получен или удержан — отследите возврат после выезда.',
    'normal',
    { depositIntakeStatus: intake },
  );
}

/**
 * Pure task plan from booking record + readiness result (single source of truth for sync).
 */
export function syncBookingOpsTasksForReadiness(
  record: BookingOpsRecord,
  readiness: BookingReadinessResult,
): BookingOpsTaskSyncPlan {
  const items: BookingOpsTaskPlanItem[] = [];

  switch (readiness.status) {
    case 'missing_booking_data':
      items.push(
        planItem(
          'complete_booking_data',
          readiness.missingItems.slice(0, 3).join(' ') || 'Заполните обязательные поля брони.',
          'high',
          { readinessStatus: readiness.status },
        ),
      );
      break;

    case 'missing_documents': {
      const verification = documentVerification(record);
      if (verification === 'uploaded') {
        items.push(
          planItem(
            'verify_guest_documents',
            'Документы загружены — нужна проверка оператором.',
            'normal',
            { documentVerificationStatus: verification },
          ),
        );
      } else {
        items.push(
          planItem(
            'request_guest_documents',
            'Запросите документы у гостя и отметьте получение в чеклисте.',
            'normal',
            { documentVerificationStatus: verification ?? 'missing' },
          ),
        );
      }
      break;
    }

    case 'missing_contract': {
      const intake = contractIntake(record);
      if (intake === 'prepared') {
        items.push(
          planItem(
            'send_contract_manual',
            'Договор подготовлен — отправьте гостю вручную и обновите статус.',
            'normal',
            { contractIntakeStatus: intake },
          ),
        );
      } else if (intake === 'sent') {
        items.push(
          planItem(
            'follow_up_contract_signature',
            'Договор отправлен — проконтролируйте подписание.',
            'normal',
            { contractIntakeStatus: intake },
          ),
        );
      } else {
        items.push(
          planItem(
            'prepare_contract',
            'Подготовьте договор и укажите ссылку или статус в чеклисте.',
            'normal',
            { contractIntakeStatus: intake },
          ),
        );
      }
      break;
    }

    case 'missing_deposit': {
      const intake = depositIntake(record);
      if (intake === 'requested') {
        items.push(
          planItem(
            'confirm_deposit',
            'Депозит запрошен — подтвердите поступление.',
            'normal',
            { depositIntakeStatus: intake },
          ),
        );
      } else {
        items.push(
          planItem(
            'request_deposit',
            'Запросите депозит у гостя и обновите статус в чеклисте.',
            intake === 'issue' ? 'high' : 'normal',
            { depositIntakeStatus: intake },
          ),
        );
      }
      break;
    }

    case 'missing_mvd_data': {
      const dataStatus = mvdDataStatus(record);
      if (dataStatus === 'collected') {
        items.push(
          planItem(
            'prepare_mvd_report',
            'Данные МВД собраны — подготовьте отчёт.',
            'normal',
            { mvdDataStatus: dataStatus },
          ),
        );
      } else if (dataStatus === 'prepared') {
        items.push(
          planItem(
            'submit_mvd_report',
            'Отчёт МВД подготовлен — отправьте и отметьте статус.',
            'normal',
            { mvdDataStatus: dataStatus },
          ),
        );
      } else {
        items.push(
          planItem(
            'collect_mvd_data',
            'Соберите данные для регистрации МВД.',
            'normal',
            { mvdDataStatus: dataStatus },
          ),
        );
      }
      break;
    }

    case 'ready_for_drafts':
      items.push(
        planItem(
          'generate_telegram_drafts',
          'Все шаги приёма выполнены — создайте черновики Telegram для ручной отправки.',
          'normal',
          { readinessStatus: readiness.status },
        ),
      );
      break;

    case 'drafts_created':
      items.push(
        planItem(
          'review_telegram_drafts',
          'Черновики Telegram созданы — проверьте текст перед отправкой.',
          'normal',
          { readinessStatus: readiness.status },
        ),
      );
      break;

    case 'ready_for_manual_send':
      items.push(
        planItem(
          'manual_send_telegram_drafts',
          'Черновики готовы — отправьте сообщения вручную и отметьте статус.',
          'normal',
          { readinessStatus: readiness.status },
        ),
      );
      break;

    case 'completed':
      break;

    default:
      break;
  }

  const depositReturn = depositReturnTask(record, readiness);
  if (depositReturn) items.push(depositReturn);

  return { items, readinessStatus: readiness.status };
}
