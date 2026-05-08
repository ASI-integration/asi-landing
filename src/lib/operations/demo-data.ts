import type {
  OperationsAuditEvent,
  OperationsChecklistItem,
  OperationsChecklistSet,
  OperationsChecklistStage,
  OperationsIssue,
  OperationsIssueStatus,
  OperationsNote,
  OperationsState,
  OperationsWorkflowStage,
} from './types';

type ChecklistTemplateItem = Pick<OperationsChecklistItem, 'id' | 'label' | 'note'>;

export const operationsStageLabels: Record<OperationsWorkflowStage, string> = {
  new_inquiry: 'Новый запрос',
  booking_intake: 'Прием бронирования',
  pre_checkin: 'Подготовка к заезду',
  checkin: 'Заезд',
  in_stay: 'Проживание',
  checkout: 'Выезд',
  review_followup: 'Отзыв / связь после выезда',
  needs_operator: 'Эскалация оператору',
};

export const operationsStageOrder: OperationsWorkflowStage[] = [
  'new_inquiry',
  'booking_intake',
  'pre_checkin',
  'checkin',
  'in_stay',
  'checkout',
  'review_followup',
  'needs_operator',
];

export const operationsLinearStageOrder: OperationsWorkflowStage[] = [
  'new_inquiry',
  'booking_intake',
  'pre_checkin',
  'checkin',
  'in_stay',
  'checkout',
  'review_followup',
];

export const operationsChecklistTemplates: Record<OperationsChecklistStage, ChecklistTemplateItem[]> = {
  pre_checkin: [
    { id: 'pre-policy-configured', label: 'Проверить, что политика объекта настроена' },
    { id: 'pre-contact-available', label: 'Подтвердить, что контакт гостя доступен' },
    { id: 'pre-access-context-exists', label: 'Подтвердить, что инструкции доступа существуют для этого объекта' },
    { id: 'pre-communication-escalations', label: 'Проверить открытые эскалации коммуникаций' },
  ],
  checkin: [
    { id: 'checkin-readiness-reviewed', label: 'Проверить готовность заезда по настроенной политике объекта' },
    { id: 'checkin-contact-available', label: 'Подтвердить доступность контакта гостя' },
    { id: 'checkin-open-escalations', label: 'Проверить открытые коммуникационные эскалации' },
    { id: 'checkin-arrival-recorded', label: 'Отметить подтверждение заезда гостя' },
  ],
  in_stay: [
    { id: 'stay-support-monitored', label: 'Проверить открытые обращения гостя' },
    { id: 'stay-policy-context', label: 'Проверить, что ответы опираются на настроенный контекст объекта' },
    { id: 'stay-escalations-reviewed', label: 'Проверить активные эскалации оператору' },
  ],
  checkout: [
    { id: 'checkout-contact-available', label: 'Подтвердить доступность контакта гостя' },
    { id: 'checkout-open-issues', label: 'Проверить открытые операционные вопросы' },
    { id: 'checkout-completed', label: 'Отметить выезд завершенным' },
  ],
  review_followup: [
    { id: 'followup-issues-resolved', label: 'Проверить, что вопросы по размещению закрыты' },
    { id: 'followup-review-decision', label: 'Определить следующий шаг по отзыву или follow-up' },
    { id: 'followup-audit-complete', label: 'Проверить журнал действий по размещению' },
  ],
};

export function checklistKeyForStage(stage: OperationsChecklistStage): keyof OperationsChecklistSet {
  if (stage === 'pre_checkin') return 'preCheckIn';
  if (stage === 'checkin') return 'checkIn';
  if (stage === 'in_stay') return 'inStay';
  if (stage === 'checkout') return 'checkout';
  return 'reviewFollowup';
}

export function checklistStageForWorkflowStage(stage: OperationsWorkflowStage): OperationsChecklistStage {
  if (stage === 'checkin') return 'checkin';
  if (stage === 'in_stay') return 'in_stay';
  if (stage === 'checkout') return 'checkout';
  if (stage === 'review_followup') return 'review_followup';
  return 'pre_checkin';
}

export function buildChecklist(
  stage: OperationsChecklistStage,
  options: {
    done?: string[];
    blocked?: string[];
    notApplicable?: string[];
    completedAt?: string;
  } = {},
): OperationsChecklistItem[] {
  const done = new Set(options.done ?? []);
  const blocked = new Set(options.blocked ?? []);
  const notApplicable = new Set(options.notApplicable ?? []);

  return operationsChecklistTemplates[stage].map((item) => ({
    ...item,
    status: done.has(item.id)
      ? 'done'
      : blocked.has(item.id)
        ? 'blocked'
        : notApplicable.has(item.id)
          ? 'not_applicable'
          : 'pending',
    completedAt: done.has(item.id) ? options.completedAt : undefined,
  }));
}

export function buildChecklistSet(
  overrides: Partial<
    Record<
      OperationsChecklistStage,
      {
        done?: string[];
        blocked?: string[];
        notApplicable?: string[];
        completedAt?: string;
      }
    >
  > = {},
): OperationsChecklistSet {
  return {
    preCheckIn: buildChecklist('pre_checkin', overrides.pre_checkin),
    checkIn: buildChecklist('checkin', overrides.checkin),
    inStay: buildChecklist('in_stay', overrides.in_stay),
    checkout: buildChecklist('checkout', overrides.checkout),
    reviewFollowup: buildChecklist('review_followup', overrides.review_followup),
  };
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(base: Date, days: number): string {
  return dateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
}

function hoursAgo(base: Date, hours: number): string {
  return new Date(base.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function note(id: string, body: string, createdAt: string): OperationsNote {
  return { id, body, createdAt, author: 'ASI Ops' };
}

function audit(
  id: string,
  type: OperationsAuditEvent['type'],
  label: string,
  createdAt: string,
  detail?: string,
  tone: OperationsAuditEvent['tone'] = 'normal',
): OperationsAuditEvent {
  return { id, type, label, detail, createdAt, tone };
}

function latestIssueStatus(issues: OperationsIssue[], itemId: string): 'none' | OperationsIssueStatus {
  const active = issues.find((issue) => issue.operationItemId === itemId && issue.status !== 'resolved');
  return active?.status ?? (issues.some((issue) => issue.operationItemId === itemId) ? 'resolved' : 'none');
}

export function createDemoOperationsState(now = new Date()): OperationsState {
  const current = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const t1 = hoursAgo(current, 26);
  const t2 = hoursAgo(current, 21);
  const t3 = hoursAgo(current, 14);
  const t4 = hoursAgo(current, 8);
  const t5 = hoursAgo(current, 3);
  const t6 = hoursAgo(current, 1);

  const issues: OperationsIssue[] = [
    {
      id: 'ops-issue-support-001',
      operationItemId: 'ops-item-stay-005',
      title: 'Требуется разбор обращения гостя',
      type: 'guest_support',
      urgency: 'normal',
      status: 'open',
      communicationReviewId: 'demo-review-direct-005',
      notes: [note('issue-support-note-001', 'Открыт общий операционный вопрос без предположений о фактах объекта.', t5)],
      auditEvents: [
        audit('issue-support-created', 'issue_created', 'Вопрос создан', t5, 'Связан с текущим размещением.', 'warn'),
      ],
      createdAt: t5,
      updatedAt: t5,
    },
    {
      id: 'ops-issue-operator-002',
      operationItemId: 'ops-item-operator-008',
      title: 'Не хватает контекста для операционного ответа',
      type: 'property_context',
      urgency: 'urgent',
      status: 'in_progress',
      communicationReviewId: 'demo-review-phone-008',
      notes: [note('issue-operator-note-001', 'Оператор должен уточнить объект или бронирование перед ответом гостю.', t6)],
      auditEvents: [
        audit('issue-operator-created', 'issue_created', 'Срочный вопрос создан', t6, 'Нужна ручная проверка контекста.', 'warn'),
        audit('issue-operator-escalated', 'escalated', 'Передано оператору', t6, 'Связано с коммуникационным обзором.', 'warn'),
      ],
      createdAt: t6,
      updatedAt: t6,
    },
  ];

  const items = [
    {
      id: 'ops-item-lead-001',
      guest: {
        name: 'Гость A',
        channel: 'telegram' as const,
        externalContactId: 'tg-demo-contact',
      },
      sourceChannel: 'telegram' as const,
      objectLabel: 'Объект еще не выбран',
      bookingDates: { checkIn: addDays(current, 2), checkOut: addDays(current, 4), nights: 2 },
      stage: 'new_inquiry' as const,
      automationMode: 'manual' as const,
      checklists: buildChecklistSet({
        pre_checkin: { blocked: ['pre-policy-configured', 'pre-access-context-exists'] },
      }),
      issueStatus: 'none' as const,
      escalationStatus: 'none' as const,
      notes: [
        note('lead-note-001', 'Запрос ожидает ручного приема бронирования.', t1),
        note('lead-note-002', 'Факты объекта не используются до выбора контекста.', t1),
      ],
      auditEvents: [
        audit('lead-created', 'item_created', 'Операция создана', t1, 'Новый запрос из канала коммуникации.'),
      ],
      createdAt: t1,
      updatedAt: t1,
    },
    {
      id: 'ops-item-intake-002',
      guest: {
        name: 'Гость B',
        channel: 'email' as const,
        email: 'guest-b@example.invalid',
      },
      sourceChannel: 'email' as const,
      propertyId: 'demo-property-02',
      objectId: 'demo-object-02',
      objectLabel: 'Объект DEMO-02',
      bookingDates: { checkIn: addDays(current, 3), checkOut: addDays(current, 6), nights: 3 },
      stage: 'booking_intake' as const,
      automationMode: 'manual' as const,
      checklists: buildChecklistSet({
        pre_checkin: { done: ['pre-contact-available'], blocked: ['pre-policy-configured'] },
      }),
      issueStatus: 'none' as const,
      escalationStatus: 'none' as const,
      communicationReviewId: 'demo-review-email-002',
      communicationSessionId: 'demo-session-email-002',
      notes: [note('intake-note-001', 'Проверяется полнота данных бронирования и контакт гостя.', t2)],
      auditEvents: [
        audit('intake-created', 'item_created', 'Прием бронирования открыт', t2),
        audit('intake-stage', 'stage_changed', 'Стадия изменена', t2, 'Новый запрос -> прием бронирования.'),
      ],
      createdAt: t2,
      updatedAt: t2,
    },
    {
      id: 'ops-item-precheckin-003',
      guest: {
        name: 'Гость C',
        channel: 'phone' as const,
        phone: '+10000000003',
      },
      sourceChannel: 'phone' as const,
      propertyId: 'demo-property-03',
      objectId: 'demo-object-03',
      objectLabel: 'Объект DEMO-03',
      bookingDates: { checkIn: addDays(current, 1), checkOut: addDays(current, 5), nights: 4 },
      stage: 'pre_checkin' as const,
      automationMode: 'semi_auto' as const,
      checklists: buildChecklistSet({
        pre_checkin: {
          done: ['pre-policy-configured', 'pre-contact-available', 'pre-communication-escalations'],
          completedAt: t3,
        },
      }),
      issueStatus: 'none' as const,
      escalationStatus: 'none' as const,
      communicationReviewId: 'demo-review-phone-003',
      notes: [note('pre-note-001', 'Подготовка к заезду идет по настроенному контексту объекта.', t3)],
      auditEvents: [
        audit('pre-created', 'item_created', 'Операция создана', t2),
        audit('pre-ready-review', 'checkin_ready', 'Готовность к заезду проверяется', t3, undefined, 'success'),
      ],
      createdAt: t2,
      updatedAt: t3,
    },
    {
      id: 'ops-item-checkin-004',
      guest: {
        name: 'Гость D',
        channel: 'telegram' as const,
        externalContactId: 'tg-demo-checkin',
      },
      sourceChannel: 'telegram' as const,
      propertyId: 'demo-property-04',
      objectId: 'demo-object-04',
      objectLabel: 'Объект DEMO-04',
      bookingDates: { checkIn: addDays(current, 0), checkOut: addDays(current, 2), nights: 2 },
      stage: 'checkin' as const,
      automationMode: 'semi_auto' as const,
      checklists: buildChecklistSet({
        pre_checkin: {
          done: [
            'pre-policy-configured',
            'pre-contact-available',
            'pre-access-context-exists',
            'pre-communication-escalations',
          ],
          completedAt: t3,
        },
        checkin: { done: ['checkin-readiness-reviewed', 'checkin-contact-available'], completedAt: t4 },
      }),
      issueStatus: 'none' as const,
      escalationStatus: 'none' as const,
      communicationReviewId: 'demo-review-telegram-004',
      communicationSessionId: 'demo-session-telegram-004',
      notes: [note('checkin-note-001', 'Заезд сегодня, ожидается подтверждение факта заезда.', t4)],
      auditEvents: [
        audit('checkin-created', 'item_created', 'Операция создана', t2),
        audit('checkin-stage', 'stage_changed', 'Переведено на стадию заезда', t4),
      ],
      createdAt: t2,
      updatedAt: t4,
    },
    {
      id: 'ops-item-stay-005',
      guest: {
        name: 'Гость E',
        channel: 'direct' as const,
        phone: '+10000000005',
      },
      sourceChannel: 'direct' as const,
      propertyId: 'demo-property-05',
      objectId: 'demo-object-05',
      objectLabel: 'Объект DEMO-05',
      bookingDates: { checkIn: addDays(current, -2), checkOut: addDays(current, 1), nights: 3 },
      stage: 'in_stay' as const,
      automationMode: 'full_auto' as const,
      checklists: buildChecklistSet({
        pre_checkin: {
          done: [
            'pre-policy-configured',
            'pre-contact-available',
            'pre-access-context-exists',
            'pre-communication-escalations',
          ],
          completedAt: t3,
        },
        checkin: {
          done: [
            'checkin-readiness-reviewed',
            'checkin-contact-available',
            'checkin-open-escalations',
            'checkin-arrival-recorded',
          ],
          completedAt: t4,
        },
        in_stay: { done: ['stay-policy-context'], completedAt: t5 },
      }),
      issueStatus: latestIssueStatus(issues, 'ops-item-stay-005'),
      escalationStatus: 'none' as const,
      communicationReviewId: 'demo-review-direct-005',
      notes: [note('stay-note-001', 'Гость находится в размещении; открыт общий вопрос поддержки.', t5)],
      auditEvents: [
        audit('stay-created', 'item_created', 'Операция создана', t1),
        audit('stay-checked-in', 'checked_in', 'Гость отмечен как заехавший', t4, undefined, 'success'),
        audit('stay-issue-created', 'issue_created', 'Вопрос создан', t5, 'Связан с коммуникационным контекстом.', 'warn'),
      ],
      createdAt: t1,
      updatedAt: t5,
    },
    {
      id: 'ops-item-checkout-006',
      guest: {
        name: 'Гость F',
        channel: 'email' as const,
        email: 'guest-f@example.invalid',
      },
      sourceChannel: 'email' as const,
      propertyId: 'demo-property-06',
      objectId: 'demo-object-06',
      objectLabel: 'Объект DEMO-06',
      bookingDates: { checkIn: addDays(current, -4), checkOut: addDays(current, 0), nights: 4 },
      stage: 'checkout' as const,
      automationMode: 'semi_auto' as const,
      checklists: buildChecklistSet({
        pre_checkin: {
          done: [
            'pre-policy-configured',
            'pre-contact-available',
            'pre-access-context-exists',
            'pre-communication-escalations',
          ],
          completedAt: t3,
        },
        checkin: {
          done: [
            'checkin-readiness-reviewed',
            'checkin-contact-available',
            'checkin-open-escalations',
            'checkin-arrival-recorded',
          ],
          completedAt: t4,
        },
        checkout: { done: ['checkout-contact-available'], completedAt: t6 },
      }),
      issueStatus: 'none' as const,
      escalationStatus: 'none' as const,
      notes: [note('checkout-note-001', 'Выезд сегодня; ожидается подтверждение завершения.', t6)],
      auditEvents: [
        audit('checkout-created', 'item_created', 'Операция создана', t1),
        audit('checkout-stage', 'stage_changed', 'Переведено на стадию выезда', t6),
      ],
      createdAt: t1,
      updatedAt: t6,
    },
    {
      id: 'ops-item-followup-007',
      guest: {
        name: 'Гость G',
        channel: 'demo' as const,
      },
      sourceChannel: 'demo' as const,
      propertyId: 'demo-property-07',
      objectId: 'demo-object-07',
      objectLabel: 'Объект DEMO-07',
      bookingDates: { checkIn: addDays(current, -7), checkOut: addDays(current, -4), nights: 3 },
      stage: 'review_followup' as const,
      automationMode: 'manual' as const,
      checklists: buildChecklistSet({
        pre_checkin: {
          done: [
            'pre-policy-configured',
            'pre-contact-available',
            'pre-access-context-exists',
            'pre-communication-escalations',
          ],
          completedAt: t3,
        },
        checkin: {
          done: [
            'checkin-readiness-reviewed',
            'checkin-contact-available',
            'checkin-open-escalations',
            'checkin-arrival-recorded',
          ],
          completedAt: t4,
        },
        checkout: {
          done: ['checkout-contact-available', 'checkout-open-issues', 'checkout-completed'],
          completedAt: t5,
        },
        review_followup: { done: ['followup-issues-resolved'], completedAt: t6 },
      }),
      issueStatus: 'resolved' as const,
      escalationStatus: 'resolved' as const,
      notes: [note('followup-note-001', 'Размещение находится на этапе послевыездной проверки.', t6)],
      auditEvents: [
        audit('followup-created', 'item_created', 'Операция создана', t1),
        audit('followup-checkout', 'checked_out', 'Выезд отмечен завершенным', t5, undefined, 'success'),
        audit('followup-ready', 'stage_changed', 'Переведено в follow-up', t6),
      ],
      createdAt: t1,
      updatedAt: t6,
    },
    {
      id: 'ops-item-operator-008',
      guest: {
        name: 'Гость H',
        channel: 'phone' as const,
        phone: '+10000000008',
      },
      sourceChannel: 'phone' as const,
      objectLabel: 'Требуется уточнить объект',
      bookingDates: { checkIn: addDays(current, 0), checkOut: addDays(current, 1), nights: 1 },
      stage: 'needs_operator' as const,
      automationMode: 'manual' as const,
      checklists: buildChecklistSet({
        pre_checkin: {
          done: ['pre-contact-available'],
          blocked: ['pre-policy-configured', 'pre-access-context-exists'],
          completedAt: t6,
        },
      }),
      issueStatus: latestIssueStatus(issues, 'ops-item-operator-008'),
      escalationStatus: 'pending_operator' as const,
      communicationReviewId: 'demo-review-phone-008',
      communicationSessionId: 'demo-session-phone-008',
      notes: [note('operator-note-001', 'Нужна ручная проверка перед ответом гостю.', t6)],
      auditEvents: [
        audit('operator-created', 'item_created', 'Операция создана', t5),
        audit('operator-escalated', 'escalated', 'Передано оператору', t6, 'Связано с коммуникационным обзором.', 'warn'),
      ],
      createdAt: t5,
      updatedAt: t6,
    },
  ];

  return {
    items,
    issues,
    storageMode: 'seed',
    updatedAt: current.toISOString(),
  };
}

