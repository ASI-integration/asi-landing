/** Source contract only. No local state, demo acceptance, timers or external senders. */
export const HANDOFF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const HANDOFF_STATUSES = ['needs_operator', 'assigned', 'acknowledged', 'escalated', 'manual_overdue', 'closed'] as const;
export type HandoffAction = 'assign' | 'ack' | 'decline' | 'reassign' | 'close';
export type HandoffRequest = {
  contactId: string; action: HandoffAction; expectedGeneration: number; idempotencyKey: string;
  assigneeId?: string; backupId?: string; reasonCode?: 'resolved' | 'withdrawn';
};
export type OperatorHandoff = {
  contactId: string; status: typeof HANDOFF_STATUSES[number] | 'unavailable'; generation: number | null;
  assigneeAlias: string | null; backupAlias: string | null; assignedAt: string | null;
  ackDueAt: string | null; acknowledgedAt: string | null; escalatedAt: string | null; closedAt: string | null;
  overdue: boolean; needsOperator: boolean; reasonCode: string;
};
const reasons = ['unassigned', 'assigned', 'acknowledged', 'declined', 'backup_unavailable',
  'backup_takeover', 'manual_overdue', 'reassigned', 'resolved', 'withdrawn'];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && HANDOFF_UUID.test(v);

export function parseHandoffRequest(value: unknown): HandoffRequest | null {
  if (!isObject(value)) return null;
  const fields = ['contactId', 'action', 'expectedGeneration', 'idempotencyKey', 'assigneeId', 'backupId', 'reasonCode'];
  if (Object.keys(value).some((key) => !fields.includes(key)) ||
      !uuid(value.contactId) || !uuid(value.idempotencyKey) ||
      !Number.isSafeInteger(value.expectedGeneration) || Number(value.expectedGeneration) < 0 ||
      Number(value.expectedGeneration) >= 2147483647 ||
      !['assign', 'ack', 'decline', 'reassign', 'close'].includes(String(value.action))) return null;
  const assignment = value.action === 'assign' || value.action === 'reassign';
  if (assignment ? !uuid(value.assigneeId) || (value.backupId !== undefined &&
      (!uuid(value.backupId) || value.backupId.toLowerCase() === String(value.assigneeId).toLowerCase())) :
      value.assigneeId !== undefined || value.backupId !== undefined) return null;
  if (value.action === 'close' ? !['resolved', 'withdrawn'].includes(String(value.reasonCode)) :
      value.reasonCode !== undefined) return null;
  return {
    contactId: value.contactId.toLowerCase(), action: value.action as HandoffAction,
    expectedGeneration: Number(value.expectedGeneration), idempotencyKey: value.idempotencyKey.toLowerCase(),
    ...(assignment ? { assigneeId: String(value.assigneeId).toLowerCase(),
      ...(value.backupId ? { backupId: String(value.backupId).toLowerCase() } : {}) } : {}),
    ...(value.action === 'close' ? { reasonCode: value.reasonCode as 'resolved' | 'withdrawn' } : {}),
  };
}

export function unavailableHandoff(contactId: string): OperatorHandoff {
  return { contactId, status: 'unavailable', generation: null, assigneeAlias: null, backupAlias: null,
    assignedAt: null, ackDueAt: null, acknowledgedAt: null, escalatedAt: null, closedAt: null,
    overdue: false, needsOperator: true, reasonCode: 'reconciliation_required' };
}

/** Explicit output allowlist: even a faulty transport cannot add PII or authority fields. */
export function parseHandoffProjection(value: unknown): OperatorHandoff | null {
  if (!isObject(value) || !uuid(value.contactId) ||
      !HANDOFF_STATUSES.includes(value.status as typeof HANDOFF_STATUSES[number]) ||
      !Number.isSafeInteger(value.generation) || Number(value.generation) < 0 ||
      typeof value.overdue !== 'boolean' || typeof value.needsOperator !== 'boolean' ||
      !reasons.includes(String(value.reasonCode))) return null;
  const aliases = ['assigneeAlias', 'backupAlias'] as const;
  const times = ['assignedAt', 'ackDueAt', 'acknowledgedAt', 'escalatedAt', 'closedAt'] as const;
  if (aliases.some((key) => value[key] !== null &&
      (typeof value[key] !== 'string' || !/^op-[a-f0-9]{12}$/.test(value[key]))) ||
      times.some((key) => value[key] !== null &&
        (typeof value[key] !== 'string' || !Number.isFinite(Date.parse(value[key]))))) return null;
  if (['assigned', 'escalated', 'acknowledged'].includes(String(value.status)) &&
      (!value.assigneeAlias || !value.assignedAt || !value.ackDueAt)) return null;
  if ((value.status === 'acknowledged' && !value.acknowledgedAt) ||
      (value.status === 'closed' && !value.closedAt) ||
      (value.status !== 'acknowledged' && value.status !== 'closed' && value.acknowledgedAt !== null) ||
      (value.status !== 'closed' && value.closedAt !== null) ||
      (!['acknowledged', 'closed'].includes(String(value.status)) && !value.needsOperator)) return null;
  return {
    contactId: value.contactId.toLowerCase(), status: value.status as OperatorHandoff['status'],
    generation: Number(value.generation), assigneeAlias: value.assigneeAlias as string | null,
    backupAlias: value.backupAlias as string | null, assignedAt: value.assignedAt as string | null,
    ackDueAt: value.ackDueAt as string | null, acknowledgedAt: value.acknowledgedAt as string | null,
    escalatedAt: value.escalatedAt as string | null, closedAt: value.closedAt as string | null,
    overdue: value.overdue, needsOperator: value.needsOperator, reasonCode: String(value.reasonCode),
  };
}

export function withOperatorHandoffs<T extends { id: string; needsOperator: boolean }>(
  items: T[], projections: Record<string, OperatorHandoff>,
): (T & { operatorHandoff: OperatorHandoff })[] {
  return items.map((item) => {
    const operatorHandoff = projections[item.id.toLowerCase()] ?? unavailableHandoff(item.id);
    return { ...item, needsOperator: item.needsOperator || operatorHandoff.needsOperator, operatorHandoff };
  });
}

/** Actual bytes, not Content-Length. No unbounded req.text()/json() before the bound. */
export async function readHandoffBody(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('HANDOFF_INVALID');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error('HANDOFF_INVALID'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
