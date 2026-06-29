import { supabase } from '@/lib/supabase';
import { recordBookingOpsEvent } from './events';
import { getBookingOpsRecord, syncBookingOpsTasksForRecordId, updateBookingOpsRecord } from './repository';
import { getBookingOpsTask, updateBookingOpsTask } from './tasks';
import type { BookingOpsTask, BookingOpsTaskStatus, UpdateBookingOpsTaskInput } from './task-types';
import type {
  BookingOpsDocumentVerificationStatus,
  BookingOpsContractIntakeStatus,
  BookingOpsDepositIntakeStatus,
  BookingOpsMvdDataStatus,
  BookingOpsRecord,
  UpdateBookingOpsInput,
} from './types';
import type { TelegramDraftReadinessStatus } from './readiness';

export type BookingOpsTaskCompletionUpdates = Pick<
  UpdateBookingOpsInput,
  | 'documentsStatus'
  | 'contractStatus'
  | 'depositStatus'
  | 'mvdStatus'
  | 'documentCollected'
  | 'documentVerificationStatus'
  | 'contractIntakeStatus'
  | 'depositIntakeStatus'
  | 'mvdDataStatus'
> & {
  telegramDraftStatus?: TelegramDraftReadinessStatus;
};

export type BookingOpsTaskCompletionEffectResult = {
  ok: boolean;
  appliedUpdates: BookingOpsTaskCompletionUpdates;
  suggestedUpdates: BookingOpsTaskCompletionUpdates;
  message: string;
  blockingReason: string | null;
};

const CONTRACT_ORDER: BookingOpsContractIntakeStatus[] = [
  'not_required', 'missing', 'prepared', 'sent', 'signed',
];
const DEPOSIT_ORDER: BookingOpsDepositIntakeStatus[] = [
  'not_required', 'missing', 'requested', 'received', 'held', 'returned', 'issue',
];
const MVD_ORDER: BookingOpsMvdDataStatus[] = [
  'not_required', 'missing', 'collected', 'prepared', 'submitted', 'confirmed',
];

function advances<T extends string>(current: T | null | undefined, target: T, order: T[]): boolean {
  if (!current) return true;
  if (current === 'not_required') return false;
  const currentIndex = order.indexOf(current);
  const targetIndex = order.indexOf(target);
  return currentIndex < targetIndex;
}

/**
 * Pure single source of truth for effects caused by an operator completing a task.
 * It never writes data or contacts external services.
 */
export function applyBookingOpsTaskCompletionEffect(
  record: BookingOpsRecord,
  task: BookingOpsTask,
  newStatus: BookingOpsTaskStatus,
): BookingOpsTaskCompletionEffectResult {
  const none: BookingOpsTaskCompletionUpdates = {};
  if (newStatus !== 'completed' || task.status === 'completed') {
    return {
      ok: true,
      appliedUpdates: none,
      suggestedUpdates: {},
      message: newStatus === 'completed' ? 'Задача уже была выполнена.' : 'Статус задачи обновлён.',
      blockingReason: null,
    };
  }

  const result = (
    appliedUpdates: BookingOpsTaskCompletionUpdates,
    message: string,
    suggestedUpdates: BookingOpsTaskCompletionUpdates = {},
  ): BookingOpsTaskCompletionEffectResult => ({
    ok: true,
    appliedUpdates,
    suggestedUpdates,
    message,
    blockingReason: null,
  });

  switch (task.taskType) {
    case 'complete_booking_data':
      return result({}, 'Готовность и операционные задачи пересчитаны. Недостающие данные не изменялись.');

    case 'request_guest_documents': {
      const current = record.documentVerificationStatus;
      const suggested: BookingOpsTaskCompletionUpdates = {};
      if (!current || current === 'missing') {
        suggested.documentVerificationStatus = 'uploaded';
        suggested.documentCollected = true;
      }
      return result(
        {},
        Object.keys(suggested).length
          ? 'Документы не отмечены проверенными. Предлагается подтвердить их загрузку в чеклисте.'
          : 'Статус документов уже отражает загрузку или проверку.',
        suggested,
      );
    }

    case 'verify_guest_documents': {
      const current: BookingOpsDocumentVerificationStatus | null | undefined =
        record.documentVerificationStatus;
      if (current === 'verified') return result({}, 'Документы уже отмечены как проверенные.');
      return result(
        {
          documentsStatus: 'verified',
          documentVerificationStatus: 'verified',
          documentCollected: true,
        },
        'Документы отмечены как проверенные оператором.',
      );
    }

    case 'prepare_contract':
      return advances(record.contractIntakeStatus, 'prepared', CONTRACT_ORDER)
        ? result(
            { contractStatus: 'prepared', contractIntakeStatus: 'prepared' },
            'Договор отмечен как подготовленный.',
          )
        : result({}, 'Статус договора уже находится на более позднем этапе.');

    case 'send_contract_manual':
      return advances(record.contractIntakeStatus, 'sent', CONTRACT_ORDER)
        ? result(
            { contractStatus: 'sent', contractIntakeStatus: 'sent' },
            'Договор отмечен как отправленный вручную.',
          )
        : result({}, 'Статус договора уже находится на более позднем этапе.');

    case 'follow_up_contract_signature':
      return result({}, 'Подписание договора автоматически не подтверждено. Проверьте статус вручную.');

    case 'request_deposit':
      return advances(record.depositIntakeStatus, 'requested', DEPOSIT_ORDER)
        ? result(
            { depositStatus: 'requested', depositIntakeStatus: 'requested' },
            'Депозит отмечен как запрошенный.',
          )
        : result({}, 'Статус депозита уже находится на более позднем этапе.');

    case 'confirm_deposit':
      return advances(record.depositIntakeStatus, 'received', DEPOSIT_ORDER)
        ? result(
            { depositStatus: 'confirmed', depositIntakeStatus: 'received' },
            'Получение депозита подтверждено оператором.',
          )
        : result({}, 'Статус депозита уже находится на более позднем этапе.');

    case 'track_deposit_return':
      return record.depositIntakeStatus === 'returned'
        ? result({}, 'Возврат депозита уже отмечен.')
        : result({ depositIntakeStatus: 'returned' }, 'Возврат депозита подтверждён оператором.');

    case 'collect_mvd_data':
      return advances(record.mvdDataStatus, 'collected', MVD_ORDER)
        ? result(
            { mvdStatus: 'required', mvdDataStatus: 'collected' },
            'Данные МВД отмечены как собранные.',
          )
        : result({}, 'Статус данных МВД уже находится на более позднем этапе.');

    case 'prepare_mvd_report':
      return advances(record.mvdDataStatus, 'prepared', MVD_ORDER)
        ? result(
            { mvdStatus: 'prepared', mvdDataStatus: 'prepared' },
            'Отчёт МВД отмечен как подготовленный.',
          )
        : result({}, 'Статус данных МВД уже находится на более позднем этапе.');

    case 'submit_mvd_report':
      return advances(record.mvdDataStatus, 'submitted', MVD_ORDER)
        ? result(
            { mvdStatus: 'submitted', mvdDataStatus: 'submitted' },
            'Отчёт МВД отмечен как отправленный вручную.',
          )
        : result({}, 'Статус данных МВД уже находится на более позднем этапе.');

    case 'generate_telegram_drafts':
      return result({ telegramDraftStatus: 'drafts_created' }, 'Черновики Telegram созданы. Автоотправка не выполнялась.');

    case 'review_telegram_drafts':
      return result(
        { telegramDraftStatus: 'ready_for_manual_send' },
        'Черновики отмечены как готовые к ручной отправке. Автоотправка не выполнялась.',
      );

    case 'manual_send_telegram_drafts':
      return result(
        { telegramDraftStatus: 'completed' },
        'Ручная отправка подтверждена оператором. Автоотправка не выполнялась.',
      );

    default:
      return result({}, 'Задача выполнена. Готовность и операционные задачи пересчитаны.');
  }
}

type CompletionDependencies = {
  getRecord: typeof getBookingOpsRecord;
  getTask: typeof getBookingOpsTask;
  updateRecord: typeof updateBookingOpsRecord;
  updateTask: typeof updateBookingOpsTask;
  syncTasks: typeof syncBookingOpsTasksForRecordId;
  applyTelegramDraftStatus: typeof applyTelegramDraftStatus;
};

const DEFAULT_DEPENDENCIES: CompletionDependencies = {
  getRecord: getBookingOpsRecord,
  getTask: getBookingOpsTask,
  updateRecord: updateBookingOpsRecord,
  updateTask: updateBookingOpsTask,
  syncTasks: syncBookingOpsTasksForRecordId,
  applyTelegramDraftStatus,
};

async function applyTelegramDraftStatus(
  recordId: string,
  status: TelegramDraftReadinessStatus,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('booking_ops_telegram_drafts')
    .select('id, status')
    .eq('booking_ops_record_id', recordId)
    .in('status', ['draft', 'copied', 'sent_manually']);

  if (error) return { ok: false, error: error.message };
  const drafts = (data ?? []) as Array<{ id: string; status: string }>;
  if (drafts.length === 0) return { ok: false, error: 'telegram_drafts_missing' };
  if (status === 'drafts_created') return { ok: true };

  const nextStatus = status === 'completed' ? 'sent_manually' : 'copied';
  const ids = drafts
    .filter((draft) => draft.status !== nextStatus)
    .map((draft) => draft.id);
  if (ids.length === 0) return { ok: true };

  const updated = await supabase
    .from('booking_ops_telegram_drafts')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .in('id', ids);
  return updated.error ? { ok: false, error: updated.error.message } : { ok: true };
}

export async function updateBookingOpsTaskWithCompletionEffects(
  recordId: string,
  taskId: string,
  input: UpdateBookingOpsTaskInput,
  dependencies: CompletionDependencies = DEFAULT_DEPENDENCIES,
): Promise<
  | { ok: true; task: BookingOpsTask; effectResult: BookingOpsTaskCompletionEffectResult | null }
  | { ok: false; error: string; message: string; effectResult?: BookingOpsTaskCompletionEffectResult }
> {
  if (input.status !== 'completed') {
    const updated = await dependencies.updateTask(recordId, taskId, input);
    return updated.ok
      ? { ok: true, task: updated.task, effectResult: null }
      : { ok: false, error: updated.error, message: 'Не удалось обновить задачу.' };
  }

  const [record, taskResult] = await Promise.all([
    dependencies.getRecord(recordId),
    dependencies.getTask(recordId, taskId),
  ]);
  if (!record) return { ok: false, error: 'not_found', message: 'Операционная запись не найдена.' };
  if (!taskResult.ok) return { ok: false, error: taskResult.error, message: 'Задача не найдена.' };

  const effectResult = applyBookingOpsTaskCompletionEffect(record, taskResult.task, 'completed');
  const { telegramDraftStatus, ...recordUpdates } = effectResult.appliedUpdates;

  if (Object.keys(recordUpdates).length > 0) {
    const recordUpdate = await dependencies.updateRecord(recordId, recordUpdates);
    if (!recordUpdate.ok) {
      return {
        ok: false,
        error: recordUpdate.error ?? 'record_update_failed',
        message: 'Не удалось применить изменения к брони. Статус задачи не изменён.',
        effectResult,
      };
    }
  }

  if (telegramDraftStatus) {
    const draftUpdate = await dependencies.applyTelegramDraftStatus(recordId, telegramDraftStatus);
    if (!draftUpdate.ok) {
      const blocked: BookingOpsTaskCompletionEffectResult = {
        ...effectResult,
        ok: false,
        appliedUpdates: recordUpdates,
        blockingReason: draftUpdate.error ?? 'telegram_draft_update_failed',
        message: draftUpdate.error === 'telegram_drafts_missing'
          ? 'Сначала создайте черновики Telegram. Статус задачи не изменён.'
          : 'Не удалось обновить статусы черновиков Telegram. Статус задачи не изменён.',
      };
      return { ok: false, error: draftUpdate.error ?? 'telegram_draft_update_failed', message: blocked.message, effectResult: blocked };
    }
  }

  const taskUpdate = await dependencies.updateTask(recordId, taskId, input);
  if (!taskUpdate.ok) {
    return { ok: false, error: taskUpdate.error, message: 'Не удалось обновить задачу.', effectResult };
  }

  const sync = await dependencies.syncTasks(recordId);
  if (!sync.ok) {
    return {
      ok: false,
      error: sync.error ?? 'task_sync_failed',
      message: 'Задача выполнена, но не удалось обновить готовность и список задач.',
      effectResult,
    };
  }

  const appliedFields = Object.keys(effectResult.appliedUpdates).sort();
  const suggestedFields = Object.keys(effectResult.suggestedUpdates).sort();
  const applied = appliedFields.length > 0;
  await recordBookingOpsEvent({
    bookingOpsRecordId: recordId,
    eventType: applied ? 'completion_effect_applied' : 'completion_effect_suggested',
    title: applied ? 'Результат завершения применён' : 'После завершения нужна ручная проверка',
    description: effectResult.message,
    actorType: 'task_runner',
    metadata: {
      taskId: taskResult.task.id,
      taskType: taskResult.task.taskType,
      effectFields: applied ? appliedFields : suggestedFields,
      actionOutcome: applied ? 'applied' : 'suggested',
    },
    dedupeKey: `completion-effect:${taskResult.task.id}:${applied ? 'applied' : 'suggested'}:${(applied ? appliedFields : suggestedFields).join(',')}`,
  });

  return { ok: true, task: taskUpdate.task, effectResult };
}
