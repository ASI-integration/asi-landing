import { getBookingOpsActionTemplateById } from './action-templates';
import { recordBookingOpsEvent } from './events';
import {
  canCreateTelegramDraftForAction,
  computeBookingReadiness,
  fetchTelegramDraftStatusesForRecord,
} from './readiness';
import {
  createTelegramDraftFromBookingOpsAction,
  listBookingOpsTelegramDrafts,
} from './telegram-drafts';
import {
  BOOKING_OPS_TASK_TYPE_LABELS_RU,
  type BookingOpsTask,
  type BookingOpsTaskStatus,
  type BookingOpsTaskType,
} from './task-types';
import type {
  BookingOpsOperatorActionId,
  BookingOpsRecord,
  BookingOpsTelegramDraft,
  BookingOpsTelegramDraftActionId,
} from './types';
import {
  BOOKING_OPS_CONTRACT_PROVIDER_LABELS_RU,
  BOOKING_OPS_TELEGRAM_DRAFT_ACTIONS,
  BOOKING_OPS_TELEGRAM_DRAFT_STATUS_LABELS_RU,
} from './types';

export type BookingOpsTaskActionResult = {
  ok: boolean;
  actionType: BookingOpsTaskType;
  message: string;
  createdDraftIds: string[] | null;
  checklist: string[] | null;
  nextTaskStatusSuggestion: BookingOpsTaskStatus | null;
  blockingReason: string | null;
};

const REUSABLE_DRAFT_STATUSES = new Set(['draft', 'copied']);

const TASK_OPERATOR_ACTION: Partial<Record<BookingOpsTaskType, BookingOpsOperatorActionId>> = {
  request_guest_documents: 'request_guest_documents',
  verify_guest_documents: 'verify_guest_documents',
  prepare_contract: 'prepare_contract',
  send_contract_manual: 'send_contract',
  request_deposit: 'request_deposit',
  confirm_deposit: 'confirm_deposit',
  prepare_mvd_report: 'prepare_mvd_report',
  submit_mvd_report: 'submit_mvd_report',
};

const TASK_TELEGRAM_DRAFT_ACTION: Partial<
  Record<BookingOpsTaskType, BookingOpsTelegramDraftActionId>
> = {
  request_guest_documents: 'request_guest_documents',
  send_contract_manual: 'send_contract',
  request_deposit: 'request_deposit',
};

function guestNameLabel(record: BookingOpsRecord): string {
  const name = String(record.guestName ?? '').trim();
  return name || '[имя гостя]';
}

function propertyLabel(record: BookingOpsRecord): string {
  const label = String(record.propertyLabel ?? '').trim();
  if (label) return label;
  const id = String(record.propertyId ?? '').trim();
  return id || '[объект]';
}

function contractProviderInstruction(record: BookingOpsRecord): string | null {
  const provider = record.contractProvider;
  if (!provider || provider === 'none') return null;
  const label = BOOKING_OPS_CONTRACT_PROVIDER_LABELS_RU[provider];
  if (provider === 'okidoki') {
    return `${label}: создайте договор в личном кабинете Okidoki (API пока не подключён).`;
  }
  return `${label}: подготовьте договор вручную и сохраните ссылку в карточке брони.`;
}

function followUpContractMessage(record: BookingOpsRecord): string {
  const name = guestNameLabel(record);
  const property = propertyLabel(record);
  return `Здравствуйте, ${name}!

Напоминаем о договоре на проживание в «${property}». Пожалуйста, ознакомьтесь и подпишите его, если ещё не сделали.

Если возникли вопросы — напишите нам.`;
}

function collectMvdDataChecklist(): string[] {
  return [
    'Получить паспортные данные из проверенных документов гостя.',
    'Сверить ФИО, дату рождения и гражданство с бронью.',
    'Записать адрес объекта и сроки проживания для регистрации.',
    'Сохранить собранные данные в заметках брони или внутреннем чеклисте.',
    'Отметьте статус данных МВД в карточке брони после сбора.',
  ];
}

function trackDepositReturnChecklist(record: BookingOpsRecord): string[] {
  const amount =
    record.depositAmount != null ? `${record.depositAmount} ₽` : '[сумма депозита]';
  return [
    'Уточните дату и время выезда гостя.',
    'Проверьте состояние объекта после выезда.',
    `Верните депозит ${amount} гостю согласованным способом.`,
    'Сохраните подтверждение возврата (чек, выписка).',
    'Обновите статус депозита в карточке брони.',
  ];
}

function findReusableDraft(
  drafts: BookingOpsTelegramDraft[],
  actionId: BookingOpsTelegramDraftActionId,
): BookingOpsTelegramDraft | null {
  return (
    drafts.find(
      (draft) => draft.actionId === actionId && REUSABLE_DRAFT_STATUSES.has(draft.status),
    ) ?? null
  );
}

async function recordTelegramDraftReuse(
  recordId: string,
  draft: BookingOpsTelegramDraft,
): Promise<void> {
  await recordBookingOpsEvent({
    bookingOpsRecordId: recordId,
    eventType: 'telegram_draft_reused',
    title: 'Переиспользован черновик Telegram',
    description: 'Использован существующий черновик; новое сообщение не создавалось и не отправлялось.',
    actorType: 'task_runner',
    metadata: {
      draftId: draft.id,
      draftActionId: draft.actionId,
      draftStatus: draft.status,
      reused: true,
    },
    dedupeKey: `telegram-draft-reused:${draft.id}:${draft.actionId}`,
  });
}

async function createOrReuseTelegramDraft(
  record: BookingOpsRecord,
  actionId: BookingOpsTelegramDraftActionId,
  options?: { createdBy?: string | null },
): Promise<
  | { ok: true; draft: BookingOpsTelegramDraft; reused: boolean }
  | { ok: false; message: string; blockingReason: string | null }
> {
  const listed = await listBookingOpsTelegramDrafts(record.id);
  const drafts = listed.ok ? listed.drafts : [];
  const existing = findReusableDraft(drafts, actionId);
  if (existing) {
    await recordTelegramDraftReuse(record.id, existing);
    return { ok: true, draft: existing, reused: true };
  }

  const result = await createTelegramDraftFromBookingOpsAction(
    record.id,
    actionId,
    { createdBy: options?.createdBy ?? null },
  );
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      blockingReason: result.message,
    };
  }
  return { ok: true, draft: result.draft, reused: false };
}

function checklistFromOperatorAction(
  record: BookingOpsRecord,
  actionId: BookingOpsOperatorActionId,
): BookingOpsTaskActionResult | null {
  const template = getBookingOpsActionTemplateById(record, actionId);
  if (!template.isAllowed) {
    return {
      ok: false,
      actionType: 'complete_booking_data',
      message: template.blockedReason ?? 'Действие недоступно.',
      createdDraftIds: null,
      checklist: template.internalChecklist.length > 0 ? template.internalChecklist : null,
      nextTaskStatusSuggestion: null,
      blockingReason: template.blockedReason,
    };
  }
  return null;
}

function successChecklistResult(
  task: BookingOpsTask,
  message: string,
  checklist: string[],
  nextStatus: BookingOpsTaskStatus | null = 'in_progress',
): BookingOpsTaskActionResult {
  return {
    ok: true,
    actionType: task.taskType,
    message,
    createdDraftIds: null,
    checklist,
    nextTaskStatusSuggestion: nextStatus,
    blockingReason: null,
  };
}

function draftSuccessResult(
  task: BookingOpsTask,
  draft: BookingOpsTelegramDraft,
  reused: boolean,
  nextStatus: BookingOpsTaskStatus | null = 'in_progress',
): BookingOpsTaskActionResult {
  return {
    ok: true,
    actionType: task.taskType,
    message: reused
      ? 'Черновик уже есть — повторно не создан. Сообщение не отправлено.'
      : 'Черновик создан. Сообщение не отправлено — отправьте вручную после проверки.',
    createdDraftIds: [draft.id],
    checklist: null,
    nextTaskStatusSuggestion: nextStatus,
    blockingReason: null,
  };
}

async function runTelegramDraftTask(
  record: BookingOpsRecord,
  task: BookingOpsTask,
  actionId: BookingOpsTelegramDraftActionId,
  options?: { createdBy?: string | null },
): Promise<BookingOpsTaskActionResult> {
  const operatorId = TASK_OPERATOR_ACTION[task.taskType];
  if (operatorId) {
    const blocked = checklistFromOperatorAction(record, operatorId);
    if (blocked) {
      return { ...blocked, actionType: task.taskType };
    }
  }

  const draftResult = await createOrReuseTelegramDraft(record, actionId, options);
  if (!draftResult.ok) {
    return {
      ok: false,
      actionType: task.taskType,
      message: draftResult.message,
      createdDraftIds: null,
      checklist: null,
      nextTaskStatusSuggestion: null,
      blockingReason: draftResult.blockingReason,
    };
  }
  return draftSuccessResult(task, draftResult.draft, draftResult.reused);
}

async function runBookingOpsTaskActionInternal(
  record: BookingOpsRecord,
  task: BookingOpsTask,
  options?: { createdBy?: string | null },
): Promise<BookingOpsTaskActionResult> {
  const taskType = task.taskType;

  switch (taskType) {
    case 'complete_booking_data': {
      const draftStatuses = await fetchTelegramDraftStatusesForRecord(record.id);
      const readiness = computeBookingReadiness({ ...record, telegramDrafts: draftStatuses });
      const missing = readiness.missingItems.length > 0
        ? readiness.missingItems
        : readiness.checklist
            .flatMap((group) => group.items)
            .filter((item) => !item.ok && item.detail)
            .map((item) => item.detail as string);
      return successChecklistResult(
        task,
        missing.length > 0
          ? 'Заполните обязательные поля брони по чеклисту ниже.'
          : 'Обязательные поля брони заполнены.',
        missing.length > 0 ? missing : ['Все обязательные поля заполнены.'],
        missing.length > 0 ? null : 'completed',
      );
    }

    case 'request_guest_documents':
      return runTelegramDraftTask(record, task, 'request_guest_documents', options);

    case 'verify_guest_documents': {
      const blocked = checklistFromOperatorAction(record, 'verify_guest_documents');
      if (blocked) return { ...blocked, actionType: taskType };
      const template = getBookingOpsActionTemplateById(record, 'verify_guest_documents');
      return successChecklistResult(
        task,
        'Проверьте документы по чеклисту. Внешняя отправка не выполняется.',
        template.internalChecklist,
      );
    }

    case 'prepare_contract': {
      const blocked = checklistFromOperatorAction(record, 'prepare_contract');
      if (blocked) return { ...blocked, actionType: taskType };
      const template = getBookingOpsActionTemplateById(record, 'prepare_contract');
      const checklist = [...template.internalChecklist];
      const providerNote = contractProviderInstruction(record);
      if (providerNote) checklist.unshift(providerNote);
      return successChecklistResult(
        task,
        'Подготовьте договор по чеклисту. Автоматическая отправка не выполняется.',
        checklist,
      );
    }

    case 'send_contract_manual':
      return runTelegramDraftTask(record, task, 'send_contract', options);

    case 'follow_up_contract_signature': {
      const message = followUpContractMessage(record);
      return {
        ok: true,
        actionType: taskType,
        message:
          'Текст напоминания подготовлен — скопируйте и отправьте гостю вручную. Автоотправка отключена.',
        createdDraftIds: null,
        checklist: [
          'Проверьте, что договор был отправлен гостю ранее.',
          'Сверьте статус договора в карточке брони.',
          'Отправьте напоминание вручную через Telegram или другой канал.',
          '---',
          message,
        ],
        nextTaskStatusSuggestion: 'in_progress',
        blockingReason: null,
      };
    }

    case 'request_deposit':
      return runTelegramDraftTask(record, task, 'request_deposit', options);

    case 'confirm_deposit': {
      const blocked = checklistFromOperatorAction(record, 'confirm_deposit');
      if (blocked) return { ...blocked, actionType: taskType };
      const template = getBookingOpsActionTemplateById(record, 'confirm_deposit');
      return successChecklistResult(
        task,
        'Подтвердите поступление депозита по чеклисту. Платёжные интеграции не используются.',
        template.internalChecklist,
      );
    }

    case 'track_deposit_return':
      return successChecklistResult(
        task,
        'Отследите возврат депозита по чеклисту. Внешние платежи не выполняются.',
        trackDepositReturnChecklist(record),
      );

    case 'collect_mvd_data':
      return successChecklistResult(
        task,
        'Соберите данные МВД по чеклисту. Внешняя отправка в МВД не выполняется.',
        collectMvdDataChecklist(),
      );

    case 'prepare_mvd_report': {
      const blocked = checklistFromOperatorAction(record, 'prepare_mvd_report');
      if (blocked) return { ...blocked, actionType: taskType };
      const template = getBookingOpsActionTemplateById(record, 'prepare_mvd_report');
      return successChecklistResult(
        task,
        'Подготовьте отчёт МВД по чеклисту. Автоматическая отправка не подключена.',
        template.internalChecklist,
      );
    }

    case 'submit_mvd_report': {
      const blocked = checklistFromOperatorAction(record, 'submit_mvd_report');
      if (blocked) return { ...blocked, actionType: taskType };
      const template = getBookingOpsActionTemplateById(record, 'submit_mvd_report');
      return successChecklistResult(
        task,
        'Отправьте отчёт МВД вручную по чеклисту. Внешняя отправка не выполняется.',
        template.internalChecklist,
      );
    }

    case 'generate_telegram_drafts': {
      const draftStatuses = await fetchTelegramDraftStatusesForRecord(record.id);
      const readinessInput = { ...record, telegramDrafts: draftStatuses };
      const readiness = computeBookingReadiness(readinessInput);
      if (!readiness.canCreateDrafts) {
        return {
          ok: false,
          actionType: taskType,
          message: readiness.missingItems.slice(0, 3).join(' ')
            || 'Нельзя создать черновики: не выполнены условия готовности.',
          createdDraftIds: null,
          checklist: null,
          nextTaskStatusSuggestion: null,
          blockingReason: readiness.missingItems[0] ?? 'Не выполнены условия готовности.',
        };
      }

      const listed = await listBookingOpsTelegramDrafts(record.id);
      const existingDrafts = listed.ok ? listed.drafts : [];
      const createdIds: string[] = [];
      const skipped: string[] = [];

      for (const actionId of BOOKING_OPS_TELEGRAM_DRAFT_ACTIONS) {
        const gate = canCreateTelegramDraftForAction(readinessInput, actionId);
        if (!gate.allowed) {
          skipped.push(actionId);
          continue;
        }
        const reusable = findReusableDraft(existingDrafts, actionId);
        if (reusable) {
          await recordTelegramDraftReuse(record.id, reusable);
          createdIds.push(reusable.id);
          continue;
        }
        const created = await createOrReuseTelegramDraft(record, actionId, options);
        if (created.ok) {
          createdIds.push(created.draft.id);
          existingDrafts.push(created.draft);
        }
      }

      if (createdIds.length === 0) {
        return {
          ok: false,
          actionType: taskType,
          message: 'Нет доступных черновиков для создания — проверьте готовность брони.',
          createdDraftIds: null,
          checklist: null,
          nextTaskStatusSuggestion: null,
          blockingReason: 'Нет действий, прошедших проверку готовности.',
        };
      }

      return {
        ok: true,
        actionType: taskType,
        message: skipped.length > 0
          ? `Созданы или переиспользованы черновики (${createdIds.length}). Некоторые шаги пропущены из‑за готовности. Сообщения не отправлены.`
          : `Созданы или переиспользованы черновики (${createdIds.length}). Сообщения не отправлены.`,
        createdDraftIds: createdIds,
        checklist: null,
        nextTaskStatusSuggestion: 'in_progress',
        blockingReason: null,
      };
    }

    case 'review_telegram_drafts': {
      const listed = await listBookingOpsTelegramDrafts(record.id);
      const drafts = listed.ok ? listed.drafts : [];
      if (drafts.length === 0) {
        return {
          ok: false,
          actionType: taskType,
          message: 'Черновики Telegram ещё не созданы.',
          createdDraftIds: null,
          checklist: ['Сначала создайте черновики через задачу «Создать черновики Telegram».'],
          nextTaskStatusSuggestion: null,
          blockingReason: 'Нет черновиков для проверки.',
        };
      }
      const checklist = drafts.map(
        (draft) =>
          `${draft.actionId}: ${BOOKING_OPS_TELEGRAM_DRAFT_STATUS_LABELS_RU[draft.status]} — проверьте текст перед отправкой`,
      );
      return successChecklistResult(
        task,
        'Проверьте черновики перед ручной отправкой. Автоотправка отключена.',
        checklist,
      );
    }

    case 'manual_send_telegram_drafts': {
      const listed = await listBookingOpsTelegramDrafts(record.id);
      const drafts = listed.ok ? listed.drafts : [];
      const active = drafts.filter((draft) => draft.status !== 'cancelled' && draft.status !== 'failed');
      if (active.length === 0) {
        return {
          ok: false,
          actionType: taskType,
          message: 'Нет черновиков для ручной отправки.',
          createdDraftIds: null,
          checklist: null,
          nextTaskStatusSuggestion: null,
          blockingReason: 'Сначала создайте и проверьте черновики.',
        };
      }
      const checklist = [
        'Автоотправка отключена — отправьте каждое сообщение вручную.',
        'Скопируйте текст черновика и отправьте гостю в Telegram.',
        'После отправки отметьте черновик как «Отправлено вручную» в списке черновиков.',
        ...active.map(
          (draft) =>
            `• ${draft.actionId} [${BOOKING_OPS_TELEGRAM_DRAFT_STATUS_LABELS_RU[draft.status]}]`,
        ),
      ];
      return {
        ok: true,
        actionType: taskType,
        message: `Готово к ручной отправке: ${active.length} черновик(ов). sendMessage не вызывается.`,
        createdDraftIds: active.map((draft) => draft.id),
        checklist,
        nextTaskStatusSuggestion: 'in_progress',
        blockingReason: null,
      };
    }

    default:
      return {
        ok: false,
        actionType: taskType,
        message: `Неизвестный тип задачи: ${BOOKING_OPS_TASK_TYPE_LABELS_RU[taskType] ?? taskType}.`,
        createdDraftIds: null,
        checklist: null,
        nextTaskStatusSuggestion: null,
        blockingReason: 'invalid_task_type',
      };
  }
}

export async function runBookingOpsTaskAction(
  record: BookingOpsRecord,
  task: BookingOpsTask,
  options?: { createdBy?: string | null },
): Promise<BookingOpsTaskActionResult> {
  const result = await runBookingOpsTaskActionInternal(record, task, options);
  await recordBookingOpsEvent({
    bookingOpsRecordId: record.id,
    eventType: 'task_action_run',
    title: result.ok ? 'Действие по задаче выполнено' : 'Действие по задаче требует внимания',
    description: result.ok
      ? 'Результат подготовлен внутри Booking Ops; внешняя отправка не выполнялась.'
      : 'Действие остановлено до устранения условий готовности.',
    actorType: 'task_runner',
    metadata: {
      taskId: task.id,
      taskType: task.taskType,
      actionType: result.actionType,
      actionOutcome: result.ok ? 'completed' : 'blocked',
      taskStatus: task.status,
    },
    dedupeKey: `task-action:${task.id}:${result.actionType}:${result.ok ? 'ok' : 'blocked'}:${result.nextTaskStatusSuggestion ?? 'none'}`,
  });
  return result;
}
