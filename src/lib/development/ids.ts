import { createHash, randomUUID } from 'node:crypto';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function isSafeBridgeId(value: string): boolean {
  return ID.test(value);
}

export function createDevelopmentChatgptTaskId(ownerUserId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${ownerUserId}|${idempotencyKey}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `dev-console-task-${digest}`;
}

export function createDevelopmentConversationId(ownerUserId: string): string {
  const digest = createHash('sha256').update(ownerUserId, 'utf8').digest('hex').slice(0, 24);
  return `dev-console-owner-${digest}`;
}

export function createDevelopmentIdempotencyKey(): string {
  return `dev-console-idem-${randomUUID()}`;
}

export function createDevelopmentDecisionId(input: {
  taskId: string;
  gateId: string;
  taskCycle: string;
  decision: 'approved' | 'rejected';
}): string {
  const digest = createHash('sha256')
    .update(`${input.taskId}|${input.gateId}|${input.taskCycle}|${input.decision}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `dev-console-decision-${digest}`;
}

export function normalizeClientIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!isSafeBridgeId(trimmed)) return null;
  return trimmed;
}
