import { auditLog } from './audit';
import { AuditEventType } from './types';

export type CommunicationOperationsActionSourceChannel =
  | 'telegram'
  | 'email'
  | 'phone-placeholder';

export type CommunicationOperationsActionCategory =
  | 'operator_access_support'
  | 'cleaning'
  | 'maintenance';

export type CommunicationOperationsActionPriority = 'high' | 'normal';

export type CommunicationOperationsActionStatus = 'open' | 'acknowledged' | 'resolved';

export type CommunicationOperationsActionReference = {
  guestId?: string;
  sessionId?: string;
  bookingId?: string;
  objectId?: string;
  chatId?: number;
  updateId?: number;
  providerMessageId?: string;
};

export type CommunicationOperationsAction = {
  id: string;
  sourceChannel: CommunicationOperationsActionSourceChannel;
  category: CommunicationOperationsActionCategory;
  priority: CommunicationOperationsActionPriority;
  status: CommunicationOperationsActionStatus;
  createdAt: string;
  updatedAt: string;
  reference: CommunicationOperationsActionReference;
  reason: string;
  dedupeCount: number;
};

export type UpsertCommunicationOperationsActionInput = {
  sourceChannel: CommunicationOperationsActionSourceChannel;
  category: CommunicationOperationsActionCategory;
  priority: CommunicationOperationsActionPriority;
  reference: CommunicationOperationsActionReference;
  reason: string;
  now?: Date;
};

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

let nextActionNumber = 1;
const actions = new Map<string, CommunicationOperationsAction>();

export function upsertCommunicationOperationsAction(
  input: UpsertCommunicationOperationsActionInput,
): { action: CommunicationOperationsAction; lifecycle: 'created' | 'deduped' } {
  const now = input.now ?? new Date();
  const existing = findReusableOpenAction(input, now);

  if (existing) {
    const updated: CommunicationOperationsAction = {
      ...existing,
      updatedAt: now.toISOString(),
      reference: {
        ...existing.reference,
        ...compactReference(input.reference),
      },
      reason: input.reason,
      dedupeCount: existing.dedupeCount + 1,
    };
    actions.set(updated.id, updated);
    auditOperationsAction('deduped', updated);
    return { action: updated, lifecycle: 'deduped' };
  }

  const action: CommunicationOperationsAction = {
    id: `comm-op-action-${nextActionNumber++}`,
    sourceChannel: input.sourceChannel,
    category: input.category,
    priority: input.priority,
    status: 'open',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    reference: compactReference(input.reference),
    reason: input.reason,
    dedupeCount: 0,
  };
  actions.set(action.id, action);
  auditOperationsAction('created', action);
  return { action, lifecycle: 'created' };
}

export function __listCommunicationOperationsActionsForTests(): CommunicationOperationsAction[] {
  return [...actions.values()].map((action) => ({
    ...action,
    reference: { ...action.reference },
  }));
}

export function __resetCommunicationOperationsActionsForTests(): void {
  actions.clear();
  nextActionNumber = 1;
}

function findReusableOpenAction(
  input: UpsertCommunicationOperationsActionInput,
  now: Date,
): CommunicationOperationsAction | null {
  const sessionKey = referenceSessionKey(input.reference);
  if (!sessionKey) return null;

  for (const action of actions.values()) {
    if (action.status !== 'open') continue;
    if (action.sourceChannel !== input.sourceChannel) continue;
    if (action.category !== input.category) continue;
    if (referenceSessionKey(action.reference) !== sessionKey) continue;

    const ageMs = now.getTime() - new Date(action.updatedAt).getTime();
    if (ageMs >= 0 && ageMs <= DEDUPE_WINDOW_MS) return action;
  }

  return null;
}

function referenceSessionKey(reference: CommunicationOperationsActionReference): string | null {
  if (reference.sessionId) return `session:${reference.sessionId}`;
  if (reference.guestId) return `guest:${reference.guestId}`;
  if (reference.chatId !== undefined) return `chat:${reference.chatId}`;
  return null;
}

function compactReference(
  reference: CommunicationOperationsActionReference,
): CommunicationOperationsActionReference {
  return Object.fromEntries(
    Object.entries(reference).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as CommunicationOperationsActionReference;
}

function auditOperationsAction(
  lifecycle: 'created' | 'deduped',
  action: CommunicationOperationsAction,
): void {
  auditLog({
    type:
      lifecycle === 'created'
        ? AuditEventType.OperationsActionCreated
        : AuditEventType.OperationsActionDeduped,
    chat_id: action.reference.chatId,
    update_id: action.reference.updateId,
    detail: JSON.stringify({
      action_id: action.id,
      source_channel: action.sourceChannel,
      category: action.category,
      priority: action.priority,
      status: action.status,
      session_id: action.reference.sessionId,
      booking_id: action.reference.bookingId,
      object_id: action.reference.objectId,
      reason: action.reason,
      dedupe_count: action.dedupeCount,
    }),
  });
}
