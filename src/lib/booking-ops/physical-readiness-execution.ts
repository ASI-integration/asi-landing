import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { getBookingOpsRecord } from './repository';

export const CLEANING_STATUSES = ['pending', 'assigned', 'in_progress', 'completed', 'verified', 'blocked', 'cancelled'] as const;
export const LINEN_STATUSES = ['pending', 'pickup_needed', 'picked_up', 'in_laundry', 'delivered', 'verified', 'shortage', 'blocked', 'cancelled'] as const;
export const SUPPLIES_STATUSES = ['pending', 'ready', 'verified', 'missing', 'waived', 'blocked'] as const;
export const MAINTENANCE_STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'verified', 'deferred', 'cancelled'] as const;
export const PHYSICAL_DRAFT_TYPES = ['cleaning', 'linen', 'maintenance', 'operator'] as const;

export type CleaningStatus = (typeof CLEANING_STATUSES)[number];
export type LinenStatus = (typeof LINEN_STATUSES)[number];
export type SuppliesStatus = (typeof SUPPLIES_STATUSES)[number];
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];
export type PhysicalDraftType = (typeof PHYSICAL_DRAFT_TYPES)[number];
export type PhysicalBlockerKey =
  | 'cleaning_not_verified'
  | 'linen_not_verified'
  | 'critical_supplies_missing'
  | 'blocking_maintenance_open'
  | 'final_readiness_not_approved';

export type PhysicalReadinessBlocker = { key: PhysicalBlockerKey; reason: string };
export type PhysicalTask = {
  id: string;
  bookingId: string;
  propertyId: string | null;
  status: string;
  dueAt: string | null;
  assignedToName: string | null;
  assignedToPhone: string | null;
  assignedToTelegram: string | null;
  notes: string | null;
  reportPayload: Record<string, unknown>;
  blockerReason: string | null;
  waiverReason?: string | null;
  completedAt?: string | null;
  deliveredAt?: string | null;
  resolvedAt?: string | null;
  verifiedAt: string | null;
  title?: string;
  description?: string | null;
  priority?: string;
  isBlocking?: boolean;
  createdAt: string;
  updatedAt: string;
};
export type PhysicalCoordinationDraft = {
  id: string;
  bookingId: string;
  taskType: PhysicalDraftType;
  taskId: string | null;
  telegramTarget: string | null;
  messageText: string;
  status: 'draft' | 'cancelled';
  createdBy: string | null;
  createdAt: string;
};
export type PhysicalReadiness = {
  bookingId: string;
  propertyId: string | null;
  status: 'not_ready' | 'ready_for_review' | 'approved' | 'blocked';
  blockers: PhysicalReadinessBlocker[];
  operationalBlockers: PhysicalReadinessBlocker[];
  finalReady: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  cleaning: PhysicalTask | null;
  linen: PhysicalTask | null;
  supplies: PhysicalTask | null;
  maintenance: PhysicalTask[];
  drafts: PhysicalCoordinationDraft[];
  updatedAt: string;
};

type ComputeInput = {
  cleaningStatus?: string | null;
  linenStatus?: string | null;
  suppliesStatus?: string | null;
  suppliesWaiverReason?: string | null;
  maintenance?: Array<{ status: string; isBlocking: boolean; reason?: string | null }>;
  finalApproved?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function text(value: unknown, max = 1000): string { return String(value ?? '').trim().slice(0, max); }
function requireUuid(value: unknown, label = 'booking_id'): string {
  const id = text(value, 64);
  if (!UUID_RE.test(id)) throw new Error(`${label}_invalid`);
  return id;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function iso(value: unknown): string | null {
  const raw = text(value, 64);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error('due_at_invalid');
  return date.toISOString();
}

export function computePhysicalReadiness(input: ComputeInput): {
  status: PhysicalReadiness['status'];
  blockers: PhysicalReadinessBlocker[];
  operationalBlockers: PhysicalReadinessBlocker[];
  finalReady: boolean;
} {
  const operationalBlockers: PhysicalReadinessBlocker[] = [];
  if (input.cleaningStatus !== 'verified') operationalBlockers.push({ key: 'cleaning_not_verified', reason: 'Уборка не проверена.' });
  if (input.linenStatus !== 'verified') operationalBlockers.push({ key: 'linen_not_verified', reason: 'Готовность белья не проверена.' });
  const suppliesClear = input.suppliesStatus === 'verified'
    || (input.suppliesStatus === 'waived' && Boolean(text(input.suppliesWaiverReason)));
  if (!suppliesClear) operationalBlockers.push({ key: 'critical_supplies_missing', reason: 'Критичные расходники не подтверждены и не отменены с причиной.' });
  const maintenanceBlocks = (input.maintenance ?? []).some((ticket) => {
    if (!ticket.isBlocking) return ticket.status === 'deferred' && !text(ticket.reason);
    if (ticket.status === 'verified' || ticket.status === 'cancelled') return false;
    return !(ticket.status === 'deferred' && Boolean(text(ticket.reason)));
  });
  if (maintenanceBlocks) operationalBlockers.push({ key: 'blocking_maintenance_open', reason: 'Есть блокирующая или неподтверждённая задача ремонта.' });
  const blockers = [...operationalBlockers];
  if (!input.finalApproved) blockers.push({ key: 'final_readiness_not_approved', reason: 'Финальная готовность не подтверждена оператором.' });
  const finalReady = blockers.length === 0;
  return {
    operationalBlockers,
    blockers,
    finalReady,
    status: finalReady ? 'approved' : operationalBlockers.length ? 'blocked' : 'ready_for_review',
  };
}

export function canReleaseCheckInInstructions(input: {
  legalReady: boolean;
  physical: Pick<ReturnType<typeof computePhysicalReadiness>, 'finalReady' | 'blockers'>;
}): { allowed: boolean; blockerKeys: string[] } {
  return {
    allowed: input.legalReady && input.physical.finalReady,
    blockerKeys: [
      ...(input.legalReady ? [] : ['legal_readiness_not_complete']),
      ...input.physical.blockers.map((item) => item.key),
    ],
  };
}

export function buildPhysicalCoordinationDraftText(input: {
  taskType: PhysicalDraftType;
  property: string;
  bookingDates: string;
  deadline: string;
  instructions?: string;
  confirmationNeeded?: string;
}): string {
  const labels: Record<PhysicalDraftType, string> = { cleaning: 'уборка', linen: 'бельё и прачечная', maintenance: 'ремонт', operator: 'ручная эскалация оператору' };
  return [
    `Задача: ${labels[input.taskType]}.`, `Объект: ${input.property}.`, `Бронь: ${input.bookingDates}.`,
    `Срок: ${input.deadline}.`, `Инструкции: ${text(input.instructions) || 'выполнить задачу и сообщить о результате'}.`,
    `Подтверждение: ${text(input.confirmationNeeded) || 'нужны фото или короткий отчёт'}.`,
    'Это черновик. Отправка выполняется только вручную после проверки оператором.',
  ].join('\n');
}

function mapTask(row: Record<string, unknown>): PhysicalTask {
  return {
    id: String(row.id), bookingId: String(row.booking_id), propertyId: text(row.property_id) || null,
    status: text(row.status), dueAt: text(row.due_at) || null,
    assignedToName: text(row.assigned_to_name) || null, assignedToPhone: text(row.assigned_to_phone) || null,
    assignedToTelegram: text(row.assigned_to_telegram) || null, notes: text(row.notes) || null,
    reportPayload: object(row.report_payload), blockerReason: text(row.blocker_reason) || null,
    waiverReason: text(row.waiver_reason) || null, completedAt: text(row.completed_at) || null,
    deliveredAt: text(row.delivered_at) || null, resolvedAt: text(row.resolved_at) || null,
    verifiedAt: text(row.verified_at) || null, title: text(row.title), description: text(row.description) || null,
    priority: text(row.priority), isBlocking: Boolean(row.is_blocking),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
function mapDraft(row: Record<string, unknown>): PhysicalCoordinationDraft {
  return {
    id: String(row.id), bookingId: String(row.booking_id), taskType: row.task_type as PhysicalDraftType,
    taskId: text(row.task_id) || null, telegramTarget: text(row.telegram_target) || null,
    messageText: String(row.message_text), status: row.status as 'draft' | 'cancelled',
    createdBy: text(row.created_by) || null, createdAt: String(row.created_at),
  };
}
async function requireRecord(bookingId: unknown) {
  const id = requireUuid(bookingId);
  const record = await getBookingOpsRecord(id);
  if (!record) throw new Error('booking_not_found');
  return record;
}
async function singleton(table: string, bookingId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from(table).select('*').eq('booking_id', bookingId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}
async function list(table: string, bookingId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.from(table).select('*').eq('booking_id', bookingId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

export async function ensurePhysicalTasks(bookingId: string): Promise<PhysicalReadiness> {
  const record = await requireRecord(bookingId);
  const now = new Date().toISOString();
  const dueAt = record.checkInAt ? new Date(record.checkInAt).toISOString() : null;
  const rows = [
    ['booking_cleaning_tasks', { id: randomUUID(), booking_id: record.id, property_id: record.propertyId, status: 'pending', due_at: dueAt, report_payload: {}, created_at: now, updated_at: now }],
    ['booking_linen_tasks', { id: randomUUID(), booking_id: record.id, property_id: record.propertyId, status: 'pending', due_at: dueAt, report_payload: {}, created_at: now, updated_at: now }],
    ['booking_supplies_tasks', { id: randomUUID(), booking_id: record.id, property_id: record.propertyId, status: 'pending', due_at: dueAt, critical_items: ['туалетная бумага', 'мыло', 'полотенца', 'базовые принадлежности'], report_payload: {}, created_at: now, updated_at: now }],
  ] as const;
  for (const [table, row] of rows) {
    const { error } = await supabase.from(table).upsert(row, { onConflict: 'booking_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const existing = await singleton('booking_physical_readiness', record.id);
  if (!existing) {
    const { error } = await supabase.from('booking_physical_readiness').insert({
      id: randomUUID(), booking_id: record.id, property_id: record.propertyId, status: 'not_ready',
      blockers: [], final_ready: false, metadata: {}, created_at: now, updated_at: now,
    });
    if (error) throw new Error(error.message);
  }
  return recomputePhysicalReadiness(record.id);
}

export async function recomputePhysicalReadiness(bookingId: string): Promise<PhysicalReadiness> {
  const record = await requireRecord(bookingId);
  const [cleaningRow, linenRow, suppliesRow, maintenanceRows, readinessRow, draftRows] = await Promise.all([
    singleton('booking_cleaning_tasks', record.id), singleton('booking_linen_tasks', record.id),
    singleton('booking_supplies_tasks', record.id), list('booking_maintenance_tickets', record.id),
    singleton('booking_physical_readiness', record.id), list('booking_physical_coordination_drafts', record.id),
  ]);
  const operationalInput = {
    cleaningStatus: text(cleaningRow?.status), linenStatus: text(linenRow?.status), suppliesStatus: text(suppliesRow?.status),
    suppliesWaiverReason: text(suppliesRow?.waiver_reason),
    maintenance: maintenanceRows.map((row) => ({ status: text(row.status), isBlocking: Boolean(row.is_blocking), reason: text(row.blocker_reason) || text(row.notes) })),
  };
  const beforeApproval = computePhysicalReadiness({ ...operationalInput, finalApproved: false });
  const approvalStillValid = beforeApproval.operationalBlockers.length === 0 && Boolean(readinessRow?.approved_at);
  const computed = computePhysicalReadiness({ ...operationalInput, finalApproved: approvalStillValid });
  const now = new Date().toISOString();
  const payload = {
    id: readinessRow?.id ?? randomUUID(), booking_id: record.id, property_id: record.propertyId,
    status: computed.status, blockers: computed.blockers, final_ready: computed.finalReady,
    approved_at: approvalStillValid ? readinessRow?.approved_at : null,
    approved_by: approvalStillValid ? readinessRow?.approved_by : null,
    metadata: object(readinessRow?.metadata), created_at: readinessRow?.created_at ?? now, updated_at: now,
  };
  const { data, error } = await supabase.from('booking_physical_readiness').upsert(payload, { onConflict: 'booking_id' }).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'physical_readiness_update_failed');
  return {
    bookingId: record.id, propertyId: record.propertyId ?? null, status: computed.status,
    blockers: computed.blockers, operationalBlockers: computed.operationalBlockers, finalReady: computed.finalReady,
    approvedAt: text(data.approved_at) || null, approvedBy: text(data.approved_by) || null,
    cleaning: cleaningRow ? mapTask(cleaningRow) : null, linen: linenRow ? mapTask(linenRow) : null,
    supplies: suppliesRow ? mapTask(suppliesRow) : null, maintenance: maintenanceRows.map(mapTask),
    drafts: draftRows.map(mapDraft), updatedAt: String(data.updated_at),
  };
}

async function updateSingletonTask(table: string, bookingId: string, statuses: readonly string[], body: Record<string, unknown>): Promise<PhysicalReadiness> {
  const record = await requireRecord(bookingId);
  const status = text(body.status, 40);
  if (!statuses.includes(status)) throw new Error('status_invalid');
  const current = await singleton(table, record.id);
  if (!current) throw new Error('physical_tasks_not_initialized');
  if (table === 'booking_cleaning_tasks' && status === 'verified' && current.status !== 'completed' && current.status !== 'verified') throw new Error('cleaning_must_be_completed_first');
  if (table === 'booking_linen_tasks' && status === 'verified' && current.status !== 'delivered' && current.status !== 'verified') throw new Error('linen_must_be_delivered_first');
  if (table === 'booking_supplies_tasks' && status === 'waived' && !text(body.waiverReason ?? body.waiver_reason)) throw new Error('waiver_reason_required');
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status, due_at: body.dueAt !== undefined || body.due_at !== undefined ? iso(body.dueAt ?? body.due_at) : current.due_at,
    notes: text(body.notes) || current.notes || null, blocker_reason: text(body.blockerReason ?? body.blocker_reason) || null,
    report_payload: Object.keys(object(body.reportPayload ?? body.report_payload)).length ? object(body.reportPayload ?? body.report_payload) : object(current.report_payload),
    updated_at: now,
  };
  if (table !== 'booking_supplies_tasks') {
    patch.assigned_to_name = text(body.assignedToName ?? body.assigned_to_name) || current.assigned_to_name || null;
    patch.assigned_to_phone = text(body.assignedToPhone ?? body.assigned_to_phone) || current.assigned_to_phone || null;
    patch.assigned_to_telegram = text(body.assignedToTelegram ?? body.assigned_to_telegram) || current.assigned_to_telegram || null;
  }
  if (table === 'booking_cleaning_tasks') { patch.completed_at = status === 'completed' || status === 'verified' ? current.completed_at ?? now : current.completed_at; patch.verified_at = status === 'verified' ? now : null; }
  if (table === 'booking_linen_tasks') { patch.delivered_at = status === 'delivered' || status === 'verified' ? current.delivered_at ?? now : current.delivered_at; patch.verified_at = status === 'verified' ? now : null; }
  if (table === 'booking_supplies_tasks') { patch.waiver_reason = status === 'waived' ? text(body.waiverReason ?? body.waiver_reason) : null; patch.verified_at = status === 'verified' ? now : null; }
  const { error } = await supabase.from(table).update(patch).eq('booking_id', record.id);
  if (error) throw new Error(error.message);
  return recomputePhysicalReadiness(record.id);
}

export const updateCleaningTask = (bookingId: string, body: Record<string, unknown>) => updateSingletonTask('booking_cleaning_tasks', bookingId, CLEANING_STATUSES, body);
export const updateLinenTask = (bookingId: string, body: Record<string, unknown>) => updateSingletonTask('booking_linen_tasks', bookingId, LINEN_STATUSES, body);
export const updateSuppliesTask = (bookingId: string, body: Record<string, unknown>) => updateSingletonTask('booking_supplies_tasks', bookingId, SUPPLIES_STATUSES, body);

export async function createMaintenanceTicket(bookingId: string, body: Record<string, unknown>): Promise<PhysicalReadiness> {
  const record = await requireRecord(bookingId);
  const title = text(body.title, 200);
  if (!title) throw new Error('maintenance_title_required');
  const now = new Date().toISOString();
  const { error } = await supabase.from('booking_maintenance_tickets').insert({
    id: randomUUID(), booking_id: record.id, property_id: record.propertyId, title,
    description: text(body.description) || null, priority: ['low', 'normal', 'high', 'critical'].includes(text(body.priority)) ? text(body.priority) : 'normal',
    is_blocking: Boolean(body.isBlocking ?? body.is_blocking), status: 'open',
    assigned_to_name: text(body.assignedToName) || null, assigned_to_phone: text(body.assignedToPhone) || null,
    assigned_to_telegram: text(body.assignedToTelegram) || null, due_at: iso(body.dueAt ?? body.due_at),
    notes: text(body.notes) || null, report_payload: object(body.reportPayload), blocker_reason: text(body.blockerReason) || null,
    created_at: now, updated_at: now,
  });
  if (error) throw new Error(error.message);
  return recomputePhysicalReadiness(record.id);
}

export async function updateMaintenanceTicket(bookingId: string, body: Record<string, unknown>): Promise<PhysicalReadiness> {
  const record = await requireRecord(bookingId);
  const ticketId = requireUuid(body.ticketId ?? body.ticket_id, 'ticket_id');
  const status = text(body.status, 40);
  if (!(MAINTENANCE_STATUSES as readonly string[]).includes(status)) throw new Error('status_invalid');
  const { data: current, error: findError } = await supabase.from('booking_maintenance_tickets').select('*').eq('id', ticketId).eq('booking_id', record.id).maybeSingle();
  if (findError) throw new Error(findError.message);
  if (!current) throw new Error('maintenance_ticket_not_found');
  if (status === 'verified' && current.status !== 'resolved' && current.status !== 'verified') throw new Error('maintenance_must_be_resolved_first');
  const reason = text(body.blockerReason ?? body.reason ?? body.notes) || text(current.blocker_reason) || text(current.notes);
  if (status === 'deferred' && !reason) throw new Error('deferred_reason_required');
  const now = new Date().toISOString();
  const { error } = await supabase.from('booking_maintenance_tickets').update({
    status, is_blocking: body.isBlocking === undefined ? current.is_blocking : Boolean(body.isBlocking),
    blocker_reason: reason || null, notes: text(body.notes) || current.notes || null,
    report_payload: Object.keys(object(body.reportPayload)).length ? object(body.reportPayload) : object(current.report_payload),
    resolved_at: status === 'resolved' || status === 'verified' ? current.resolved_at ?? now : current.resolved_at,
    verified_at: status === 'verified' ? now : null, updated_at: now,
  }).eq('id', ticketId).eq('booking_id', record.id);
  if (error) throw new Error(error.message);
  return recomputePhysicalReadiness(record.id);
}

export async function createPhysicalCoordinationDraft(bookingId: string, body: Record<string, unknown>): Promise<PhysicalReadiness> {
  const record = await requireRecord(bookingId);
  const taskType = text(body.taskType ?? body.task_type) as PhysicalDraftType;
  if (!(PHYSICAL_DRAFT_TYPES as readonly string[]).includes(taskType)) throw new Error('draft_type_invalid');
  const taskId = text(body.taskId ?? body.task_id);
  if (taskId && !UUID_RE.test(taskId)) throw new Error('task_id_invalid');
  const deadline = text(body.deadline) || (record.checkInAt ? new Date(record.checkInAt).toLocaleString('ru-RU') : 'не указан');
  const messageText = text(body.messageText ?? body.message_text, 4000) || buildPhysicalCoordinationDraftText({
    taskType,
    property: record.propertyLabel ?? record.propertyId ?? 'не указан',
    bookingDates: `${record.checkInAt ? new Date(record.checkInAt).toLocaleDateString('ru-RU') : 'дата заезда не указана'} — ${record.checkOutAt ? new Date(record.checkOutAt).toLocaleDateString('ru-RU') : 'дата выезда не указана'}`,
    deadline,
    instructions: text(body.instructions),
    confirmationNeeded: text(body.confirmationNeeded),
  });
  const now = new Date().toISOString();
  const { error } = await supabase.from('booking_physical_coordination_drafts').insert({
    id: randomUUID(), booking_id: record.id, task_type: taskType, task_id: taskId || null,
    telegram_target: text(body.telegramTarget ?? body.telegram_target) || null, message_text: messageText,
    status: 'draft', created_by: text(body.createdBy ?? body.created_by) || null,
    metadata: { draftOnly: true, noExternalSend: true }, created_at: now, updated_at: now,
  });
  if (error) throw new Error(error.message);
  return recomputePhysicalReadiness(record.id);
}

export async function approveFinalPhysicalReadiness(bookingId: string, approvedBy: unknown): Promise<PhysicalReadiness> {
  const record = await requireRecord(bookingId);
  const operator = text(approvedBy, 200);
  if (!operator) throw new Error('approved_by_required');
  const current = await recomputePhysicalReadiness(record.id);
  if (current.operationalBlockers.length) throw new Error(`physical_blockers_exist:${current.operationalBlockers.map((item) => item.key).join(',')}`);
  const now = new Date().toISOString();
  const { error } = await supabase.from('booking_physical_readiness').update({ approved_at: now, approved_by: operator, updated_at: now }).eq('booking_id', record.id);
  if (error) throw new Error(error.message);
  return recomputePhysicalReadiness(record.id);
}

export async function getPhysicalReadiness(bookingId: string): Promise<PhysicalReadiness | null> {
  const id = requireUuid(bookingId);
  const existing = await singleton('booking_physical_readiness', id);
  return existing ? recomputePhysicalReadiness(id) : null;
}
