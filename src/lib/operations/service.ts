import {
  buildChecklistSet,
  checklistKeyForStage,
  checklistStageForWorkflowStage,
  createDemoOperationsState,
  operationsLinearStageOrder,
  operationsStageLabels,
} from './demo-data';
import type {
  OperationsAuditEvent,
  OperationsAuditEventType,
  OperationsChecklistStage,
  OperationsChecklistStatus,
  OperationsEscalationStatus,
  OperationsIssue,
  OperationsIssueStatus,
  OperationsIssueType,
  OperationsIssueUrgency,
  OperationsItem,
  OperationsItemIssueStatus,
  OperationsNote,
  OperationsState,
  OperationsWorkflowStage,
} from './types';

export const OPERATIONS_STORAGE_KEY = 'asi.operations.phase2.v1';

export type OperationsAction =
  | { type: 'move_next_stage'; itemId: string }
  | { type: 'mark_checkin_ready'; itemId: string }
  | { type: 'mark_guest_checked_in'; itemId: string }
  | { type: 'mark_checked_out'; itemId: string }
  | {
      type: 'create_issue';
      itemId: string;
      title: string;
      issueType: OperationsIssueType;
      urgency: OperationsIssueUrgency;
      note?: string;
    }
  | { type: 'close_issue'; itemId: string; issueId?: string }
  | { type: 'escalate_operator'; itemId: string }
  | { type: 'add_note'; itemId: string; body: string }
  | {
      type: 'set_checklist_item_status';
      itemId: string;
      checklistStage: OperationsChecklistStage;
      checklistItemId: string;
      status: OperationsChecklistStatus;
    };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function safeStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function isOperationsState(value: unknown): value is OperationsState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<OperationsState>;
  return Array.isArray(state.items) && Array.isArray(state.issues);
}

function normalizeState(state: OperationsState): OperationsState {
  return {
    ...state,
    items: state.items.map((item) => ({
      ...item,
      checklists: item.checklists ?? buildChecklistSet(),
      notes: item.notes ?? [],
      auditEvents: item.auditEvents ?? [],
      issueStatus: resolveItemIssueStatus(state.issues, item.id),
      escalationStatus: item.escalationStatus ?? 'none',
    })),
    issues: state.issues.map((issue) => ({
      ...issue,
      notes: issue.notes ?? [],
      auditEvents: issue.auditEvents ?? [],
    })),
    storageMode: state.storageMode ?? 'local_storage',
    updatedAt: state.updatedAt ?? nowIso(),
  };
}

export function loadOperationsState(storage: StorageLike | null = safeStorage()): OperationsState {
  const fallback = createDemoOperationsState();
  if (!storage) return fallback;

  try {
    const raw = storage.getItem(OPERATIONS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!isOperationsState(parsed)) return fallback;
    return normalizeState({ ...parsed, storageMode: 'local_storage' });
  } catch {
    return fallback;
  }
}

export function saveOperationsState(state: OperationsState, storage: StorageLike | null = safeStorage()): void {
  if (!storage) return;

  // TODO: Replace this localStorage adapter with a Supabase-backed repository
  // when the operations schema is promoted beyond the dashboard essentials layer.
  storage.setItem(
    OPERATIONS_STORAGE_KEY,
    JSON.stringify({
      ...state,
      storageMode: 'local_storage',
    }),
  );
}

export function resetOperationsState(storage: StorageLike | null = safeStorage()): OperationsState {
  const state = createDemoOperationsState();
  if (storage) saveOperationsState(state, storage);
  return state;
}

export function activeChecklistStage(stage: OperationsWorkflowStage): OperationsChecklistStage {
  return checklistStageForWorkflowStage(stage);
}

export function getChecklistForStage(item: OperationsItem, stage: OperationsChecklistStage) {
  return item.checklists[checklistKeyForStage(stage)];
}

export function nextWorkflowStage(stage: OperationsWorkflowStage): OperationsWorkflowStage | null {
  const currentIndex = operationsLinearStageOrder.indexOf(stage);
  if (currentIndex < 0) return null;
  return operationsLinearStageOrder[currentIndex + 1] ?? null;
}

export function applyOperationsAction(state: OperationsState, action: OperationsAction): OperationsState {
  const at = nowIso();
  let nextState = state;

  if (action.type === 'create_issue') {
    nextState = createIssue(nextState, action, at);
  } else if (action.type === 'close_issue') {
    nextState = closeIssue(nextState, action.itemId, action.issueId, at);
  } else {
    nextState = {
      ...nextState,
      items: nextState.items.map((item) => applyItemAction(item, action, at)),
    };
  }

  return normalizeState({
    ...nextState,
    updatedAt: at,
    storageMode: 'local_storage',
  });
}

function applyItemAction(item: OperationsItem, action: OperationsAction, at: string): OperationsItem {
  if (item.id !== action.itemId) return item;

  if (action.type === 'move_next_stage') {
    const nextStage = nextWorkflowStage(item.stage);
    if (!nextStage) return item;
    return setStage(item, nextStage, at);
  }

  if (action.type === 'mark_checkin_ready') {
    const updated = updateChecklistItem(item, 'pre_checkin', 'pre-access-context-exists', 'done', at);
    const targetStage = item.stage === 'new_inquiry' || item.stage === 'booking_intake' ? 'pre_checkin' : item.stage;
    const staged =
      item.stage === targetStage
        ? {
            ...updated,
            updatedAt: at,
          }
        : setStage(
            {
              ...updated,
              updatedAt: at,
            },
            targetStage,
            at,
          );

    return appendAudit(
      staged,
      'checkin_ready',
      'Готовность к заезду отмечена',
      'Проверка выполнена без добавления фактов объекта в операционный слой.',
      at,
      'success',
    );
  }

  if (action.type === 'mark_guest_checked_in') {
    const updated = updateChecklistItem(item, 'checkin', 'checkin-arrival-recorded', 'done', at);
    const staged =
      item.stage === 'in_stay'
        ? {
            ...updated,
            updatedAt: at,
          }
        : setStage(
            {
              ...updated,
              updatedAt: at,
            },
            'in_stay',
            at,
          );

    return appendAudit(
      staged,
      'checked_in',
      'Гость отмечен как заехавший',
      undefined,
      at,
      'success',
    );
  }

  if (action.type === 'mark_checked_out') {
    const updated = updateChecklistItem(item, 'checkout', 'checkout-completed', 'done', at);
    const staged =
      item.stage === 'review_followup'
        ? {
            ...updated,
            updatedAt: at,
          }
        : setStage(
            {
              ...updated,
              updatedAt: at,
            },
            'review_followup',
            at,
          );

    return appendAudit(
      staged,
      'checked_out',
      'Выезд отмечен завершенным',
      undefined,
      at,
      'success',
    );
  }

  if (action.type === 'escalate_operator') {
    const staged =
      item.stage === 'needs_operator'
        ? {
            ...item,
            updatedAt: at,
          }
        : setStage(
            {
              ...item,
              updatedAt: at,
            },
            'needs_operator',
            at,
          );

    return appendAudit(
      {
        ...staged,
        escalationStatus: 'pending_operator',
        updatedAt: at,
      },
      'escalated',
      'Передано оператору',
      item.communicationReviewId
        ? `Связано с коммуникационным обзором ${item.communicationReviewId}.`
        : 'Коммуникационный обзор не привязан.',
      at,
      'warn',
    );
  }

  if (action.type === 'add_note') {
    const body = action.body.trim();
    if (!body) return item;
    return appendAudit(
      {
        ...item,
        notes: [...item.notes, createNote(body, at)],
        updatedAt: at,
      },
      'note_added',
      'Заметка добавлена',
      body,
      at,
    );
  }

  if (action.type === 'set_checklist_item_status') {
    const updated = updateChecklistItem(item, action.checklistStage, action.checklistItemId, action.status, at);
    if (updated === item) return item;
    if (action.status !== 'done') return { ...updated, updatedAt: at };

    const checklistItem = getChecklistForStage(updated, action.checklistStage).find(
      (entry) => entry.id === action.checklistItemId,
    );

    return appendAudit(
      {
        ...updated,
        updatedAt: at,
      },
      'checklist_item_completed',
      'Пункт чек-листа выполнен',
      checklistItem?.label,
      at,
      'success',
    );
  }

  return item;
}

function setStage(item: OperationsItem, stage: OperationsWorkflowStage, at: string): OperationsItem {
  const from = operationsStageLabels[item.stage];
  const to = operationsStageLabels[stage];
  return appendAudit(
    {
      ...item,
      stage,
      updatedAt: at,
    },
    'stage_changed',
    'Стадия изменена',
    `${from} -> ${to}`,
    at,
  );
}

function createIssue(
  state: OperationsState,
  action: Extract<OperationsAction, { type: 'create_issue' }>,
  at: string,
): OperationsState {
  const item = state.items.find((entry) => entry.id === action.itemId);
  if (!item) return state;

  const title = action.title.trim() || 'Операционный вопрос';
  const issue: OperationsIssue = {
    id: createId('ops-issue'),
    operationItemId: action.itemId,
    title,
    type: action.issueType,
    urgency: action.urgency,
    status: 'open',
    communicationReviewId: item.communicationReviewId,
    notes: action.note?.trim() ? [createNote(action.note.trim(), at)] : [],
    auditEvents: [
      createAudit(
        'issue_created',
        action.urgency === 'urgent' ? 'Срочный вопрос создан' : 'Вопрос создан',
        title,
        at,
        action.urgency === 'urgent' ? 'warn' : 'normal',
      ),
    ],
    createdAt: at,
    updatedAt: at,
  };

  return {
    ...state,
    issues: [...state.issues, issue],
    items: state.items.map((entry) =>
      entry.id === action.itemId
        ? appendAudit(
            {
              ...entry,
              issueStatus: 'open',
              updatedAt: at,
            },
            'issue_created',
            action.urgency === 'urgent' ? 'Срочный вопрос создан' : 'Вопрос создан',
            title,
            at,
            action.urgency === 'urgent' ? 'warn' : 'normal',
          )
        : entry,
    ),
  };
}

function closeIssue(state: OperationsState, itemId: string, issueId: string | undefined, at: string): OperationsState {
  const targetIssue =
    (issueId ? state.issues.find((issue) => issue.id === issueId) : undefined) ??
    state.issues.find((issue) => issue.operationItemId === itemId && issue.status !== 'resolved');

  if (!targetIssue) return state;

  const issues = state.issues.map((issue) => {
    if (issue.id !== targetIssue.id) return issue;
    return {
      ...issue,
      status: 'resolved' as const,
      resolvedAt: at,
      updatedAt: at,
      auditEvents: [
        ...issue.auditEvents,
        createAudit('issue_resolved', 'Вопрос закрыт', issue.title, at, 'success'),
      ],
    };
  });

  return {
    ...state,
    issues,
    items: state.items.map((item) =>
      item.id === itemId
        ? appendAudit(
            {
              ...item,
              issueStatus: resolveItemIssueStatus(issues, item.id),
              escalationStatus: resolveEscalationAfterIssueClose(item.escalationStatus, issues, item.id),
              updatedAt: at,
            },
            'issue_resolved',
            'Вопрос закрыт',
            targetIssue.title,
            at,
            'success',
          )
        : item,
    ),
  };
}

function resolveEscalationAfterIssueClose(
  current: OperationsEscalationStatus,
  issues: OperationsIssue[],
  itemId: string,
): OperationsEscalationStatus {
  if (current === 'none') return current;
  const hasOpenIssue = issues.some((issue) => issue.operationItemId === itemId && issue.status !== 'resolved');
  return hasOpenIssue ? current : 'resolved';
}

function resolveItemIssueStatus(issues: OperationsIssue[], itemId: string): OperationsItemIssueStatus {
  const open = issues.find((issue) => issue.operationItemId === itemId && issue.status === 'open');
  if (open) return 'open';
  const inProgress = issues.find((issue) => issue.operationItemId === itemId && issue.status === 'in_progress');
  if (inProgress) return 'in_progress';
  return issues.some((issue) => issue.operationItemId === itemId) ? 'resolved' : 'none';
}

function updateChecklistItem(
  item: OperationsItem,
  stage: OperationsChecklistStage,
  checklistItemId: string,
  status: OperationsChecklistStatus,
  at: string,
): OperationsItem {
  const key = checklistKeyForStage(stage);
  let changed = false;
  const checklist = item.checklists[key].map((entry) => {
    if (entry.id !== checklistItemId) return entry;
    changed = entry.status !== status;
    return {
      ...entry,
      status,
      completedAt: status === 'done' ? at : undefined,
    };
  });

  if (!changed) return item;

  return {
    ...item,
    checklists: {
      ...item.checklists,
      [key]: checklist,
    },
  };
}

function appendAudit(
  item: OperationsItem,
  type: OperationsAuditEventType,
  label: string,
  detail: string | undefined,
  at: string,
  tone: OperationsAuditEvent['tone'] = 'normal',
): OperationsItem {
  return {
    ...item,
    auditEvents: [...item.auditEvents, createAudit(type, label, detail, at, tone)],
    updatedAt: at,
  };
}

function createAudit(
  type: OperationsAuditEventType,
  label: string,
  detail: string | undefined,
  at: string,
  tone: OperationsAuditEvent['tone'] = 'normal',
): OperationsAuditEvent {
  return {
    id: createId('ops-audit'),
    type,
    label,
    detail,
    createdAt: at,
    tone,
  };
}

function createNote(body: string, at: string): OperationsNote {
  return {
    id: createId('ops-note'),
    body,
    createdAt: at,
    author: 'Оператор',
  };
}
