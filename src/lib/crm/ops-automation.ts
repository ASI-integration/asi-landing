import type {
  CrmContact,
  CrmOpsAutomationDecision,
  CrmOpsNextAction,
  CrmStatus,
} from './types';

export const CRM_OPS_NEXT_ACTION_LABELS: Record<CrmOpsNextAction, string> = {
  send_instruction: 'Отправить инструкцию',
  request_access: 'Запросить доступ',
  mark_access_received: 'Зафиксировать получение доступа',
  choose_test_property: 'Выбрать тестовый объект',
  open_channel_manager: 'Открыть менеджер каналов',
  start_channel_setup: 'Начать настройку каналов',
  mark_ready_for_setup: 'Отметить готовность к настройке',
  pause: 'Пауза',
  problem_detected: 'Проверить проблему',
};

const AUTOMATION_NEXT_STEP_LABELS = new Set(Object.values(CRM_OPS_NEXT_ACTION_LABELS));
const COMPLETED_STATUSES: CrmStatus[] = ['ready_for_test', 'pilot', 'active_pilot'];
const PAUSED_STATUSES: CrmStatus[] = ['paused', 'rejected', 'not_relevant'];

type DecisionDraft = Omit<CrmOpsAutomationDecision, 'currentStage' | 'evaluatedAt'>;

function decision(
  contact: CrmContact,
  evaluatedAt: string,
  draft: DecisionDraft,
): CrmOpsAutomationDecision {
  return { currentStage: contact.status, evaluatedAt, ...draft };
}

function hasProblem(contact: CrmContact): boolean {
  return (
    contact.status === 'operator_needed' ||
    contact.communicationStatus === 'has_problem' ||
    contact.communicationStatus === 'needs_manual_reaction' ||
    contact.onboarding?.status === 'needs_operator' ||
    contact.channelManagerConnection?.status === 'needs_operator' ||
    contact.channelManagerConnection?.connectionStatus === 'needs_manager_check'
  );
}

function accessIsConfirmed(contact: CrmContact): boolean {
  return (
    contact.channelManagerConnection?.accessSituation === 'has_access' ||
    contact.channelManagerConnection?.connectionStatus === 'ready_for_operator_review' ||
    contact.channelManagerConnection?.status === 'prepared' ||
    contact.channelManagerConnection?.status === 'connected'
  );
}

function setupIsReady(contact: CrmContact): boolean {
  return (
    contact.onboarding?.status === 'ready_for_channel_manager' ||
    contact.onboarding?.status === 'channel_manager_started' ||
    contact.channelManagerConnection?.status === 'ready_to_connect' ||
    contact.channelManagerConnection?.status === 'prepared' ||
    contact.channelManagerConnection?.status === 'connected'
  );
}

export function hasCrmOpsManualOverride(contact: CrmContact): boolean {
  const nextStep = contact.nextStep?.trim() ?? '';
  return nextStep.length > 0 && !AUTOMATION_NEXT_STEP_LABELS.has(nextStep);
}

export function evaluateCrmOpsAutomation(
  contact: CrmContact,
  evaluatedAt = new Date().toISOString(),
): CrmOpsAutomationDecision {
  if (hasCrmOpsManualOverride(contact)) {
    return decision(contact, evaluatedAt, {
      nextAction: 'pause',
      automationState: 'manual_override',
      needsOperatorAction: false,
      canAutoPerform: false,
      recommendedStatus: null,
      reason: 'Сохранён ручной следующий шаг. Автоматизация не меняет его и статус заявки.',
    });
  }

  if (hasProblem(contact)) {
    return decision(contact, evaluatedAt, {
      nextAction: 'problem_detected',
      automationState: 'needs_operator_attention',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedStatus: contact.status === 'operator_needed' ? null : 'operator_needed',
      reason: 'Зафиксирован проблемный или неоднозначный сигнал; требуется проверка оператора.',
    });
  }

  if (PAUSED_STATUSES.includes(contact.status)) {
    return decision(contact, evaluatedAt, {
      nextAction: 'pause',
      automationState: 'paused',
      needsOperatorAction: false,
      canAutoPerform: false,
      recommendedStatus: null,
      reason: 'Заявка остановлена вручную или сейчас не подходит.',
    });
  }

  if (COMPLETED_STATUSES.includes(contact.status)) {
    return decision(contact, evaluatedAt, {
      nextAction: 'pause',
      automationState: 'completed',
      needsOperatorAction: false,
      canAutoPerform: false,
      recommendedStatus: null,
      reason: 'Текущий этап setup-контура завершён.',
    });
  }

  switch (contact.status) {
    case 'new':
    case 'new_lead':
    case 'contact':
    case 'waitlist':
    case 'invited':
      return decision(contact, evaluatedAt, {
        nextAction: 'send_instruction',
        automationState: 'action_required',
        needsOperatorAction: true,
        canAutoPerform: false,
        recommendedStatus: null,
        reason: 'Для продолжения владелец должен получить инструкцию; автоматическая отправка не включена.',
      });
    case 'contact_sent':
    case 'instruction_sent':
    case 'waiting_object_data':
      return decision(contact, evaluatedAt, {
        nextAction: 'request_access',
        automationState: 'action_required',
        needsOperatorAction: true,
        canAutoPerform: false,
        recommendedStatus: null,
        reason: 'Инструкция уже отправлена; следующий контролируемый шаг — запросить доступ.',
      });
    case 'access_requested':
      if (accessIsConfirmed(contact)) {
        return decision(contact, evaluatedAt, {
          nextAction: 'mark_access_received',
          automationState: 'automatic_action_available',
          needsOperatorAction: false,
          canAutoPerform: true,
          recommendedStatus: 'access_received',
          reason: 'В данных менеджера каналов есть однозначное подтверждение доступа.',
        });
      }
      return decision(contact, evaluatedAt, {
        nextAction: 'request_access',
        automationState: 'waiting',
        needsOperatorAction: false,
        canAutoPerform: false,
        recommendedStatus: null,
        reason: 'Доступ запрошен; подтверждения получения пока нет.',
      });
    case 'access_received':
      if (contact.ownerObjects?.length === 1 || (contact.objectsCount === 1 && contact.activeObjectTitle)) {
        return decision(contact, evaluatedAt, {
          nextAction: 'choose_test_property',
          automationState: 'automatic_action_available',
          needsOperatorAction: false,
          canAutoPerform: true,
          recommendedStatus: 'test_object_selected',
          reason: 'У заявки ровно один подтверждённый объект; выбор тестового объекта однозначен.',
        });
      }
      return decision(contact, evaluatedAt, {
        nextAction: 'choose_test_property',
        automationState: 'needs_operator_attention',
        needsOperatorAction: true,
        canAutoPerform: false,
        recommendedStatus: null,
        reason: 'Нельзя безопасно выбрать тестовый объект без решения оператора.',
      });
    case 'test_object_selected':
      if (setupIsReady(contact)) {
        return decision(contact, evaluatedAt, {
          nextAction: 'mark_ready_for_setup',
          automationState: 'automatic_action_available',
          needsOperatorAction: false,
          canAutoPerform: true,
          recommendedStatus: 'ready_for_setup',
          reason: 'Тестовый объект выбран и данные готовы для настройки менеджера каналов.',
        });
      }
      return decision(contact, evaluatedAt, {
        nextAction: 'open_channel_manager',
        automationState: 'action_required',
        needsOperatorAction: true,
        canAutoPerform: false,
        recommendedStatus: null,
        reason: 'Объект выбран, но готовность к настройке ещё не подтверждена.',
      });
    case 'ready_for_setup':
      return decision(contact, evaluatedAt, {
        nextAction: 'open_channel_manager',
        automationState: 'action_required',
        needsOperatorAction: true,
        canAutoPerform: false,
        recommendedStatus: null,
        reason: 'Заявка готова; оператору нужно открыть менеджер каналов.',
      });
    case 'object_setup':
    case 'onboarding':
      return decision(contact, evaluatedAt, {
        nextAction: 'start_channel_setup',
        automationState: 'waiting',
        needsOperatorAction: false,
        canAutoPerform: false,
        recommendedStatus: null,
        reason: 'Настройка объекта уже идёт; автоматический переход ждёт подтверждения результата.',
      });
    default:
      return decision(contact, evaluatedAt, {
        nextAction: 'problem_detected',
        automationState: 'needs_operator_attention',
        needsOperatorAction: true,
        canAutoPerform: false,
        recommendedStatus: null,
        reason: 'Состояние заявки не распознано как безопасный автоматический сценарий.',
      });
  }
}

export type CrmOpsAutomationPatch = Pick<CrmContact, 'status' | 'nextStep'>;

export function buildCrmOpsAutomationPatch(
  contact: CrmContact,
  evaluatedAt = new Date().toISOString(),
): Partial<CrmOpsAutomationPatch> {
  const currentDecision = evaluateCrmOpsAutomation(contact, evaluatedAt);
  if (currentDecision.automationState === 'manual_override') return {};

  const patch: Partial<CrmOpsAutomationPatch> = {};
  const recommendedStatus = currentDecision.canAutoPerform ? currentDecision.recommendedStatus : null;
  if (recommendedStatus && recommendedStatus !== contact.status) patch.status = recommendedStatus;

  const postTransitionContact = recommendedStatus ? { ...contact, status: recommendedStatus } : contact;
  const nextDecision = evaluateCrmOpsAutomation(postTransitionContact, evaluatedAt);
  const recommendedNextStep = CRM_OPS_NEXT_ACTION_LABELS[nextDecision.nextAction];
  const currentNextStep = contact.nextStep?.trim() ?? '';
  if (!currentNextStep || AUTOMATION_NEXT_STEP_LABELS.has(currentNextStep)) {
    if (contact.nextStep !== recommendedNextStep) patch.nextStep = recommendedNextStep;
  }
  return patch;
}
