import { createHash, randomUUID } from 'node:crypto';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function isSafePilotBridgeId(value: string): boolean {
  return ID.test(value);
}

/**
 * Stable Bridge conversation namespace for a pilot user.
 * Distinct from Owner Dev Console (`dev-console-owner-…`) so the same
 * authenticated userId never shares task scope across surfaces.
 */
export function createPilotConversationId(pilotUserId: string): string {
  const digest = createHash('sha256').update(`pilot_beta|${pilotUserId}`, 'utf8').digest('hex').slice(0, 24);
  return `pilot-beta-${digest}`;
}

export function createPilotChatgptTaskId(pilotUserId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`pilot_beta|${pilotUserId}|${idempotencyKey}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `pilot-beta-task-${digest}`;
}

export function createPilotIdempotencyKey(): string {
  return `pilot-beta-idem-${randomUUID()}`;
}

export function createPilotDecisionId(input: {
  taskId: string;
  gateId: string;
  taskCycle: string;
  decision: 'approved' | 'rejected';
}): string {
  const digest = createHash('sha256')
    .update(`pilot_beta|${input.taskId}|${input.gateId}|${input.taskCycle}|${input.decision}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `pilot-beta-decision-${digest}`;
}
