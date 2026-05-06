import type {
  CleaningTask,
  GuestCommunicationEvent,
  InboundGuestMessage,
  MaintenanceTask,
  OperationAuditEvent,
  OperationCommunicationEventType,
  OperationEscalationReason,
  OperationPhaseId,
  OperationPriority,
  OperationsBridgeResult,
  OperationsMessageClassification,
  OperatorEscalation,
} from './types';

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '') || 'message';
}

function operationIdFor(message: InboundGuestMessage): string {
  return message.bookingOperationId ?? `comm-op-${message.id}`;
}

function propertyIdFor(message: InboundGuestMessage): string {
  return message.propertyListingId ?? 'unknown-property';
}

function classifyText(textRu: string): {
  eventType: OperationCommunicationEventType;
  priority: OperationPriority;
  phaseId: OperationPhaseId;
  escalationReason: OperationEscalationReason;
  reasonRu: string;
} {
  const text = textRu.toLowerCase();
  const urgent = includesAny(text, ['срочно', 'авар', 'течет', 'протеч', 'leak', 'flood', 'water']);

  if (includesAny(text, ['жалоб', 'ужас', 'плохо', 'недовол', 'компенсац', 'complaint'])) {
    return {
      eventType: 'complaint',
      priority: 'high',
      phaseId: 'stay_support',
      escalationReason: 'guest_complaint',
      reasonRu: 'Сообщение похоже на жалобу или конфликт, нужен операторский контроль.',
    };
  }

  if (includesAny(text, ['протеч', 'течет', 'не работает', 'сломал', 'сломано', 'broken', 'leak', 'appliance'])) {
    return {
      eventType: 'maintenance_issue',
      priority: urgent ? 'urgent' : 'high',
      phaseId: 'stay_support',
      escalationReason: urgent ? 'urgent_maintenance' : 'not_required',
      reasonRu: urgent
        ? 'Обнаружен срочный maintenance issue, создается задача мастеру и эскалация.'
        : 'Обнаружена задача home master без обязательной эскалации.',
    };
  }

  if (includesAny(text, ['гряз', 'не убран', 'уборк', 'клининг', 'полотенц', 'белье', 'cleaning'])) {
    return {
      eventType: 'cleaning_issue',
      priority: 'high',
      phaseId: 'stay_support',
      escalationReason: 'not_required',
      reasonRu: 'Сообщение связано с клинингом, создается задача клининга без ручной эскалации.',
    };
  }

  if (includesAny(text, ['ранний заезд', 'заехать раньше', 'early check', 'early arrival'])) {
    return {
      eventType: 'early_checkin_request',
      priority: 'normal',
      phaseId: 'pre_arrival',
      escalationReason: 'not_required',
      reasonRu: 'Запрос раннего заезда уходит в pre-arrival коммуникацию.',
    };
  }

  if (includesAny(text, ['поздний выезд', 'выехать позже', 'late checkout', 'late check-out'])) {
    return {
      eventType: 'late_checkout_request',
      priority: 'normal',
      phaseId: 'checkout',
      escalationReason: 'policy_exception',
      reasonRu: 'Запрос позднего выезда требует проверки правил и доступности.',
    };
  }

  if (includesAny(text, ['выезд', 'checkout', 'check-out', 'ключ оставить', 'куда оставить ключ'])) {
    return {
      eventType: 'checkout_support',
      priority: 'normal',
      phaseId: 'checkout',
      escalationReason: 'not_required',
      reasonRu: 'Вопрос относится к поддержке выезда.',
    };
  }

  if (includesAny(text, ['отзыв', 'спасибо', 'review', 'feedback', 'вернемся', 'снова приедем'])) {
    return {
      eventType: 'review_follow_up',
      priority: 'low',
      phaseId: 'review_follow_up',
      escalationReason: 'not_required',
      reasonRu: 'Сообщение относится к отзыву или повторному follow-up.',
    };
  }

  return {
    eventType: 'guest_question',
    priority: 'normal',
    phaseId: 'stay_support',
    escalationReason: 'not_required',
    reasonRu: 'Обычный вопрос гостя, остается в автоматической коммуникации.',
  };
}

export function classifyInboundGuestMessage(message: InboundGuestMessage): OperationsMessageClassification {
  const mapped = classifyText(message.textRu);
  const operatorNeeded = mapped.escalationReason !== 'not_required';

  return {
    ...mapped,
    confidence: mapped.eventType === 'guest_question' ? 0.72 : 0.86,
    automationStatus: operatorNeeded ? 'manual_review' : 'automated',
  };
}

function createGuestCommunicationEvent(
  message: InboundGuestMessage,
  classification: OperationsMessageClassification,
): GuestCommunicationEvent {
  return {
    id: `comm-event-${slug(message.id)}`,
    operationId: operationIdFor(message),
    atRu: message.receivedAtRu,
    channelRu: message.channelRu,
    direction: 'inbound',
    actor: 'guest',
    intentRu: classification.eventType,
    messageRu: message.textRu,
    automated: classification.automationStatus === 'automated',
    status: classification.escalationReason === 'not_required' ? 'active' : 'needs_human',
  };
}

function maybeCreateCleaningTask(
  message: InboundGuestMessage,
  classification: OperationsMessageClassification,
): CleaningTask | undefined {
  if (classification.eventType !== 'cleaning_issue') return undefined;

  return {
    id: `cleaning-from-comm-${slug(message.id)}`,
    operationId: operationIdFor(message),
    propertyListingId: propertyIdFor(message),
    titleRu: 'Проверить проблему клининга от гостя',
    assignedToRu: 'Клининг / дежурная смена',
    scheduledForRu: 'Ближайшее доступное окно',
    status: 'assigned',
    checklistRu: ['Проверить сообщение гостя', 'Связаться с клинингом', 'Зафиксировать фото/подтверждение'],
    notesRu: message.textRu,
  };
}

function maybeCreateMaintenanceTask(
  message: InboundGuestMessage,
  classification: OperationsMessageClassification,
): MaintenanceTask | undefined {
  if (classification.eventType !== 'maintenance_issue') return undefined;

  return {
    id: `maintenance-from-comm-${slug(message.id)}`,
    operationId: operationIdFor(message),
    propertyListingId: propertyIdFor(message),
    titleRu: 'Home master task из сообщения гостя',
    assignedToRu: 'Домашний мастер / maintenance',
    scheduledForRu: classification.priority === 'urgent' ? 'Срочно' : 'В рабочее окно',
    priority: classification.priority,
    status: classification.priority === 'urgent' ? 'needs_human' : 'assigned',
    issueRu: message.textRu,
    handoffRequired: classification.priority === 'urgent',
  };
}

function maybeCreateOperatorEscalation(
  message: InboundGuestMessage,
  classification: OperationsMessageClassification,
): OperatorEscalation | undefined {
  if (classification.escalationReason === 'not_required') return undefined;

  return {
    id: `escalation-from-comm-${slug(message.id)}`,
    operationId: operationIdFor(message),
    status: 'open',
    reasonRu: classification.reasonRu,
    assignedToRu: 'Оператор смены',
    createdAtRu: message.receivedAtRu,
    decisionNeededRu: escalationDecisionRu(classification.escalationReason),
  };
}

function escalationDecisionRu(reason: OperationEscalationReason): string {
  switch (reason) {
    case 'urgent_maintenance':
      return 'Подтвердить срочный выезд мастера и сообщение гостю.';
    case 'guest_complaint':
      return 'Разобрать жалобу, выбрать тон ответа и возможную компенсацию.';
    case 'cleaning_gap':
      return 'Проверить клининг и подтвердить корректирующее действие.';
    case 'policy_exception':
      return 'Проверить правила объекта и разрешить исключение.';
    case 'low_confidence':
      return 'Проверить классификацию вручную.';
    case 'not_required':
      return 'Решение оператора не требуется.';
  }
}

function createAuditEvent(
  message: InboundGuestMessage,
  classification: OperationsMessageClassification,
): OperationAuditEvent {
  return {
    id: `audit-from-comm-${slug(message.id)}`,
    atRu: message.receivedAtRu,
    actor: 'asi',
    titleRu: 'Сообщение гостя преобразовано в Operations action',
    detailRu: `${classification.reasonRu} Исходный канал: ${message.channelRu}.`,
    status: classification.escalationReason === 'not_required' ? 'active' : 'needs_human',
  };
}

function reviewActionRu(classification: OperationsMessageClassification): string | undefined {
  if (classification.eventType !== 'review_follow_up') return undefined;
  return 'Подготовить ответ на отзыв и отметить гостя для повторного контакта.';
}

export function bridgeCommunicationToOperations(message: InboundGuestMessage): OperationsBridgeResult {
  const classification = classifyInboundGuestMessage(message);
  const guestCommunicationEvent = createGuestCommunicationEvent(message, classification);
  const cleaningTask = maybeCreateCleaningTask(message, classification);
  const maintenanceTask = maybeCreateMaintenanceTask(message, classification);
  const operatorEscalation = maybeCreateOperatorEscalation(message, classification);
  const reviewFollowUpActionRu = reviewActionRu(classification);
  const createdActionLabelsRu = [
    'guest communication event',
    cleaningTask ? 'cleaning task' : null,
    maintenanceTask ? 'maintenance/home master task' : null,
    operatorEscalation ? 'operator escalation' : null,
    reviewFollowUpActionRu ? 'review/follow-up action' : null,
    classification.eventType === 'checkout_support' ? 'checkout support action' : null,
    classification.eventType === 'early_checkin_request' ? 'pre-arrival action' : null,
    classification.eventType === 'late_checkout_request' ? 'checkout exception action' : null,
  ].filter((label): label is string => Boolean(label));

  return {
    inboundMessage: message,
    classification,
    guestCommunicationEvent,
    auditEvent: createAuditEvent(message, classification),
    cleaningTask,
    maintenanceTask,
    operatorEscalation,
    reviewFollowUpActionRu,
    createdActionLabelsRu,
    operatorNeeded: Boolean(operatorEscalation),
  };
}

export const communicationBridgeMockMessages: InboundGuestMessage[] = [
  {
    id: 'early-checkin',
    channel: 'telegram',
    channelRu: 'Telegram',
    conversationId: 'conv-demo-early',
    guestNameRu: 'Анна',
    propertyListingId: 'listing-tverskaya-01',
    bookingOperationId: 'booking-op-new-booking',
    textRu: 'Здравствуйте, можно заехать раньше, примерно в 12:00?',
    receivedAtRu: '10:20',
  },
  {
    id: 'leak',
    channel: 'whatsapp',
    channelRu: 'WhatsApp',
    conversationId: 'conv-demo-leak',
    guestNameRu: 'Ольга',
    propertyListingId: 'listing-tverskaya-01',
    bookingOperationId: 'booking-op-maintenance',
    textRu: 'Срочно, в ванной протечка и вода течет на пол.',
    receivedAtRu: '13:40',
  },
  {
    id: 'wifi-access',
    channel: 'telegram',
    channelRu: 'Telegram',
    conversationId: 'conv-demo-wifi',
    guestNameRu: 'Михаил',
    propertyListingId: 'listing-tverskaya-01',
    bookingOperationId: 'booking-op-guest-question',
    textRu: 'Подскажите пароль Wi-Fi и где взять ключ?',
    receivedAtRu: '11:05',
  },
  {
    id: 'complaint',
    channel: 'telegram',
    channelRu: 'Telegram',
    conversationId: 'conv-demo-complaint',
    guestNameRu: 'Ирина',
    propertyListingId: 'listing-tverskaya-01',
    textRu: 'У нас жалоба: очень шумно и квартира не соответствует описанию.',
    receivedAtRu: '21:15',
  },
  {
    id: 'cleaning-issue',
    channel: 'telegram',
    channelRu: 'Telegram',
    conversationId: 'conv-demo-cleaning',
    guestNameRu: 'Сергей',
    propertyListingId: 'listing-tverskaya-01',
    textRu: 'В квартире грязные полотенца, нужна уборка.',
    receivedAtRu: '15:30',
  },
  {
    id: 'checkout-question',
    channel: 'email',
    channelRu: 'Email',
    conversationId: 'conv-demo-checkout',
    guestNameRu: 'Дмитрий',
    propertyListingId: 'listing-tverskaya-01',
    bookingOperationId: 'booking-op-checkout',
    textRu: 'Куда оставить ключ при выезде?',
    receivedAtRu: '08:45',
  },
  {
    id: 'review-follow-up',
    channel: 'telegram',
    channelRu: 'Telegram',
    conversationId: 'conv-demo-review',
    guestNameRu: 'Елена',
    propertyListingId: 'listing-tverskaya-01',
    bookingOperationId: 'booking-op-review',
    textRu: 'Спасибо, все понравилось, оставим отзыв и вернемся снова.',
    receivedAtRu: '14:10',
  },
];

export const communicationBridgeMockResults = communicationBridgeMockMessages.map(bridgeCommunicationToOperations);
