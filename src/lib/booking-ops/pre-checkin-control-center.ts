import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { buildAutoSendDecisionMetadata } from './communication-auto-send-policy';
import { getBookingOpsRecord, listBookingOpsRecords, updateBookingOpsRecord } from './repository';
import {
  adminUpdateLifecycleGate,
  blockGate,
  completeGate,
  getLifecycleStatus,
  initializeLifecycleForBooking,
} from './lifecycle';
import {
  BOOKING_LIFECYCLE_GATE_LABELS_RU,
  type BookingLifecycleGate,
  type BookingLifecycleGateKey,
  type BookingLifecycleSnapshot,
} from './lifecycle-types';
import type { BookingOpsCommunicationIntent, BookingOpsCommunicationPurpose, BookingOpsRecord } from './types';
import { listBookingOpsTasksForRecord } from './tasks';
import type { BookingOpsTask, BookingOpsTaskType } from './task-types';

export const PRE_CHECKIN_READINESS_STATUSES = [
  'ready_for_checkin',
  'needs_attention',
  'blocked',
  'overdue',
  'checked_in',
  'closed',
] as const;

export type PreCheckinReadinessStatus = (typeof PRE_CHECKIN_READINESS_STATUSES)[number];

export const PRE_CHECKIN_READINESS_STATUS_LABELS_RU: Record<PreCheckinReadinessStatus, string> = {
  ready_for_checkin: 'Готово к заезду',
  needs_attention: 'Требует внимания',
  blocked: 'Заблокировано',
  overdue: 'Просрочено',
  checked_in: 'Заселён',
  closed: 'Закрыто',
};

export type PreCheckinSeverity = 'missing' | 'blocked' | 'overdue' | 'warning';

export type PreCheckinReadinessItem = {
  key: string;
  gateKey: BookingLifecycleGateKey | null;
  title: string;
  reason: string;
  severity: PreCheckinSeverity;
  source: 'lifecycle' | 'legal_payment' | 'task' | 'communication' | 'booking';
  fallbackEligible: boolean;
};

export type PreCheckinTimelineItem = {
  key: string;
  title: string;
  status: string;
  updatedAt: string | null;
};

export type PreCheckinRequiredAction = {
  key: string;
  title: string;
  action: string;
  gateKey: BookingLifecycleGateKey | null;
};

export type PreCheckinReadinessSnapshot = {
  bookingId: string;
  status: PreCheckinReadinessStatus;
  readinessScore: number;
  hardBlockers: PreCheckinReadinessItem[];
  warnings: PreCheckinReadinessItem[];
  requiredActions: PreCheckinRequiredAction[];
  timeline: PreCheckinTimelineItem[];
  topBlocker: PreCheckinReadinessItem | null;
  lifecycleScore: number;
  lastRecomputedAt: string;
  metadata: Record<string, unknown>;
};

type ComputeInput = {
  bookingId: string;
  record?: Partial<BookingOpsRecord> | null;
  lifecycle: BookingLifecycleSnapshot | null;
  tasks?: BookingOpsTask[];
  communications?: BookingOpsCommunicationIntent[];
  now?: Date;
};

const REQUIRED_GATES: Array<{ gateKey: BookingLifecycleGateKey; title: string }> = [
  { gateKey: 'guest_data_completed', title: 'Данные гостя заполнены' },
  { gateKey: 'documents_verified', title: 'Документы проверены' },
  { gateKey: 'contract_signed', title: 'Договор подписан' },
  { gateKey: 'deposit_received', title: 'Депозит получен' },
  { gateKey: 'mvd_report_prepared', title: 'Отчёт МВД подготовлен' },
  { gateKey: 'cleaning_scheduled', title: 'Уборка назначена' },
  { gateKey: 'linen_scheduled', title: 'Бельё запланировано' },
  { gateKey: 'inspection_scheduled', title: 'Осмотр назначен' },
  { gateKey: 'property_ready', title: 'Объект готов' },
  { gateKey: 'checkin_instructions_sent', title: 'Инструкции заезда отправлены' },
];

const WARNING_GATES: Array<{ gateKey: BookingLifecycleGateKey; title: string; reason: string }> = [
  {
    gateKey: 'mvd_report_submitted',
    title: 'Отчёт МВД не отправлен',
    reason: 'Отправка МВД не блокирует заезд, но требует контроля.',
  },
];

const COMMUNICATION_DRAFT_PURPOSES = new Set<BookingOpsCommunicationPurpose>([
  'send_checkin_instructions',
  'remind_guest_before_checkin',
]);

const CLEANING_TYPES = new Set<BookingOpsTaskType>(['cleaning_needed', 'cleaning_assigned', 'cleaning_in_progress']);
const LINEN_TYPES = new Set<BookingOpsTaskType>([
  'linen_pickup_needed',
  'linen_replaced',
  'laundry_dropoff_needed',
  'laundry_return_needed',
]);
const INSPECTION_TYPES = new Set<BookingOpsTaskType>(['unit_inspection_needed', 'inspection_needed']);
const MAINTENANCE_TYPES = new Set<BookingOpsTaskType>(['maintenance_needed']);

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function isDone(gate: BookingLifecycleGate | undefined): boolean {
  return gate?.status === 'completed' || gate?.status === 'skipped';
}

function isBad(gate: BookingLifecycleGate | undefined): boolean {
  return gate?.status === 'blocked' || gate?.status === 'failed';
}

function isGateOverdue(gate: BookingLifecycleGate | undefined, now: Date): boolean {
  if (!gate) return false;
  const metadata = gate.metadata ?? {};
  if (metadata.overdue === true) return true;
  const dueAt = text(metadata.dueAt ?? metadata.due_at);
  if (!dueAt) return false;
  const parsed = new Date(dueAt);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < now.getTime() && !isDone(gate);
}

function taskIsOpen(task: BookingOpsTask): boolean {
  return task.status === 'open' || task.status === 'in_progress' || task.status === 'blocked';
}

function taskIsOverdue(task: BookingOpsTask, now: Date): boolean {
  if (!task.dueAt || !taskIsOpen(task)) return false;
  const parsed = new Date(task.dueAt);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < now.getTime();
}

function latestTask(tasks: BookingOpsTask[], types: Set<BookingOpsTaskType>): BookingOpsTask | null {
  return tasks.find((task) => types.has(task.taskType)) ?? null;
}

function makeItem(input: {
  gateKey: BookingLifecycleGateKey | null;
  title: string;
  reason: string;
  severity: PreCheckinSeverity;
  source: PreCheckinReadinessItem['source'];
  fallbackEligible?: boolean;
}): PreCheckinReadinessItem {
  return {
    key: input.gateKey ?? input.title,
    gateKey: input.gateKey,
    title: input.title,
    reason: input.reason,
    severity: input.severity,
    source: input.source,
    fallbackEligible: input.fallbackEligible ?? false,
  };
}

function gateLabel(gateKey: BookingLifecycleGateKey): string {
  return BOOKING_LIFECYCLE_GATE_LABELS_RU[gateKey] ?? gateKey;
}

function gateMap(lifecycle: BookingLifecycleSnapshot | null): Map<BookingLifecycleGateKey, BookingLifecycleGate> {
  return new Map((lifecycle?.gates ?? []).map((gate) => [gate.gateKey, gate]));
}

function addRequiredGateItem(
  items: PreCheckinReadinessItem[],
  gate: BookingLifecycleGate | undefined,
  gateKey: BookingLifecycleGateKey,
  title: string,
  now: Date,
) {
  if (isDone(gate)) return;
  if (isBad(gate)) {
    items.push(makeItem({
      gateKey,
      title,
      reason: gate?.reason ?? `${gateLabel(gateKey)} заблокирован.`,
      severity: 'blocked',
      source: 'lifecycle',
      fallbackEligible: true,
    }));
    return;
  }
  if (isGateOverdue(gate, now)) {
    items.push(makeItem({
      gateKey,
      title,
      reason: `${gateLabel(gateKey)} просрочен.`,
      severity: 'overdue',
      source: 'lifecycle',
      fallbackEligible: true,
    }));
    return;
  }
  items.push(makeItem({
    gateKey,
    title,
    reason: `${gateLabel(gateKey)} ещё не завершён.`,
    severity: 'missing',
    source: 'lifecycle',
  }));
}

function addTaskCategoryItem(input: {
  items: PreCheckinReadinessItem[];
  tasks: BookingOpsTask[];
  types: Set<BookingOpsTaskType>;
  gateKey: BookingLifecycleGateKey;
  title: string;
  now: Date;
}) {
  const task = latestTask(input.tasks, input.types);
  if (!task || task.status === 'completed' || task.status === 'cancelled') return;
  if (task.status === 'blocked') {
    input.items.push(makeItem({
      gateKey: input.gateKey,
      title: input.title,
      reason: task.description ?? `${input.title} заблокирована.`,
      severity: 'blocked',
      source: 'task',
      fallbackEligible: true,
    }));
    return;
  }
  if (taskIsOverdue(task, input.now)) {
    input.items.push(makeItem({
      gateKey: input.gateKey,
      title: input.title,
      reason: `${input.title} просрочена.`,
      severity: 'overdue',
      source: 'task',
      fallbackEligible: true,
    }));
  }
}

function hasDraft(communications: BookingOpsCommunicationIntent[]): boolean {
  return communications.some((item) =>
    COMMUNICATION_DRAFT_PURPOSES.has(item.purpose) && item.status === 'draft_ready');
}

function hasSentCheckinInstructions(communications: BookingOpsCommunicationIntent[]): boolean {
  return communications.some((item) =>
    item.purpose === 'send_checkin_instructions' && item.status === 'completed');
}

export function computePreCheckinReadinessSnapshot(input: ComputeInput): PreCheckinReadinessSnapshot {
  const now = input.now ?? new Date();
  const gates = gateMap(input.lifecycle);
  const tasks = input.tasks ?? [];
  const communications = input.communications ?? [];
  const hardBlockers: PreCheckinReadinessItem[] = [];
  const warnings: PreCheckinReadinessItem[] = [];

  const closedGate = gates.get('booking_closed');
  const checkedInGate = gates.get('guest_checked_in');
  if (isDone(closedGate)) {
    return buildSnapshot(input, 'closed', [], warnings, now);
  }
  if (isDone(checkedInGate)) {
    return buildSnapshot(input, 'checked_in', [], warnings, now);
  }

  for (const required of REQUIRED_GATES) {
    addRequiredGateItem(hardBlockers, gates.get(required.gateKey), required.gateKey, required.title, now);
  }

  const maintenanceRequired = gates.get('maintenance_required');
  const maintenanceResolved = gates.get('maintenance_resolved');
  if (isDone(maintenanceRequired) && !isDone(maintenanceResolved)) {
    hardBlockers.push(makeItem({
      gateKey: 'maintenance_resolved',
      title: 'Ремонт закрыт',
      reason: 'Есть незакрытая задача по ремонту.',
      severity: 'blocked',
      source: 'lifecycle',
      fallbackEligible: true,
    }));
  }

  addTaskCategoryItem({
    items: hardBlockers,
    tasks,
    types: CLEANING_TYPES,
    gateKey: 'cleaning_scheduled',
    title: 'Уборка',
    now,
  });
  addTaskCategoryItem({
    items: hardBlockers,
    tasks,
    types: LINEN_TYPES,
    gateKey: 'linen_scheduled',
    title: 'Бельё',
    now,
  });
  addTaskCategoryItem({
    items: hardBlockers,
    tasks,
    types: INSPECTION_TYPES,
    gateKey: 'inspection_scheduled',
    title: 'Осмотр',
    now,
  });
  addTaskCategoryItem({
    items: hardBlockers,
    tasks,
    types: MAINTENANCE_TYPES,
    gateKey: 'maintenance_resolved',
    title: 'Ремонт',
    now,
  });

  for (const warningGate of WARNING_GATES) {
    const gate = gates.get(warningGate.gateKey);
    if (!isDone(gate)) {
      warnings.push(makeItem({
        gateKey: warningGate.gateKey,
        title: warningGate.title,
        reason: warningGate.reason,
        severity: 'warning',
        source: 'lifecycle',
      }));
    }
  }

  if (input.record?.manualNextAction && /время|заезд|arrival/i.test(input.record.manualNextAction)) {
    warnings.push(makeItem({
      gateKey: null,
      title: 'Время прибытия не подтверждено',
      reason: 'Оператору нужно уточнить время прибытия гостя.',
      severity: 'warning',
      source: 'booking',
    }));
  }

  if (hasDraft(communications) && !hasSentCheckinInstructions(communications)) {
    warnings.push(makeItem({
      gateKey: 'checkin_instructions_sent',
      title: 'Есть черновик сообщения',
      reason: 'Черновик готов, но ещё не отмечен как отправленный.',
      severity: 'warning',
      source: 'communication',
    }));
  }

  const status = resolveStatus(hardBlockers);
  return buildSnapshot(input, status, dedupeItems(hardBlockers), dedupeItems(warnings), now);
}

function resolveStatus(items: PreCheckinReadinessItem[]): PreCheckinReadinessStatus {
  if (items.some((item) => item.severity === 'blocked')) return 'blocked';
  if (items.some((item) => item.severity === 'overdue')) return 'overdue';
  if (items.length > 0) return 'needs_attention';
  return 'ready_for_checkin';
}

function dedupeItems(items: PreCheckinReadinessItem[]): PreCheckinReadinessItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.gateKey ?? item.key}:${item.severity}:${item.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSnapshot(
  input: ComputeInput,
  status: PreCheckinReadinessStatus,
  hardBlockers: PreCheckinReadinessItem[],
  warnings: PreCheckinReadinessItem[],
  now: Date,
): PreCheckinReadinessSnapshot {
  const lifecycleScore = input.lifecycle?.readinessScore ?? 0;
  const completed = REQUIRED_GATES.length - hardBlockers.filter((item) => item.source === 'lifecycle').length;
  const readinessScore = status === 'ready_for_checkin' || status === 'checked_in' || status === 'closed'
    ? 100
    : Math.max(0, Math.min(99, Math.round((completed / REQUIRED_GATES.length) * 100)));
  const requiredActions = hardBlockers.slice(0, 6).map((item) => ({
    key: item.key,
    title: item.title,
    action: item.severity === 'missing' ? 'Завершить этап' : 'Разобрать блокер',
    gateKey: item.gateKey,
  }));
  const gates = input.lifecycle?.gates ?? [];
  return {
    bookingId: input.bookingId,
    status,
    readinessScore,
    hardBlockers,
    warnings,
    requiredActions,
    timeline: gates
      .filter((gate) => REQUIRED_GATES.some((item) => item.gateKey === gate.gateKey))
      .map((gate) => ({
        key: gate.gateKey,
        title: gateLabel(gate.gateKey),
        status: gate.status,
        updatedAt: gate.updatedAt,
      })),
    topBlocker: hardBlockers[0] ?? null,
    lifecycleScore,
    lastRecomputedAt: now.toISOString(),
    metadata: {
      source: 'pre_checkin_control_center_v1',
      warningCount: warnings.length,
    },
  };
}

async function listCommunications(bookingId: string): Promise<BookingOpsCommunicationIntent[]> {
  const { data, error } = await supabase
    .from('booking_ops_communication_intents')
    .select('*')
    .eq('booking_ops_record_id', bookingId)
    .order('updated_at', { ascending: false });
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: text(row.id),
    bookingOpsRecordId: text(row.booking_ops_record_id),
    bookingId: text(row.booking_id) || null,
    relatedTaskId: text(row.related_task_id) || null,
    actorType: text(row.actor_type) as BookingOpsCommunicationIntent['actorType'],
    actorLabel: text(row.actor_label) || null,
    purpose: text(row.purpose) as BookingOpsCommunicationPurpose,
    channel: text(row.channel) as BookingOpsCommunicationIntent['channel'],
    status: text(row.status) as BookingOpsCommunicationIntent['status'],
    messageText: text(row.message_text),
    messageTemplateKey: text(row.message_template_key),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    supersededAt: text(row.superseded_at) || null,
  }));
}

async function loadSnapshotInputs(bookingId: string) {
  const id = text(bookingId);
  if (!id) throw new Error('booking_id_required');
  const record = await getBookingOpsRecord(id);
  if (!record) throw new Error('booking_not_found');
  await initializeLifecycleForBooking(record.id);
  const [lifecycleResult, tasksResult, communications] = await Promise.all([
    getLifecycleStatus(record.id),
    listBookingOpsTasksForRecord(record.id),
    listCommunications(record.id),
  ]);
  return {
    record,
    lifecycle: lifecycleResult.lifecycle ?? null,
    tasks: tasksResult.ok ? tasksResult.tasks : [],
    communications,
  };
}

export async function getPreCheckinStatus(bookingId: string): Promise<PreCheckinReadinessSnapshot> {
  const input = await loadSnapshotInputs(bookingId);
  return computePreCheckinReadinessSnapshot({
    bookingId: input.record.id,
    record: input.record,
    lifecycle: input.lifecycle,
    tasks: input.tasks,
    communications: input.communications,
  });
}

export async function getPreCheckinBlockers(bookingId: string): Promise<PreCheckinReadinessItem[]> {
  return (await getPreCheckinStatus(bookingId)).hardBlockers;
}

export async function getPreCheckinWarnings(bookingId: string): Promise<PreCheckinReadinessItem[]> {
  return (await getPreCheckinStatus(bookingId)).warnings;
}

export async function getPreCheckinTimeline(bookingId: string): Promise<PreCheckinTimelineItem[]> {
  return (await getPreCheckinStatus(bookingId)).timeline;
}

export async function getPreCheckinRequiredActions(bookingId: string): Promise<PreCheckinRequiredAction[]> {
  return (await getPreCheckinStatus(bookingId)).requiredActions;
}

async function ensureCheckinInstructionsDraft(record: BookingOpsRecord): Promise<void> {
  const communications = await listCommunications(record.id);
  const existing = communications.find((item) =>
    item.purpose === 'send_checkin_instructions'
    && (item.status === 'draft_ready' || item.status === 'waiting_for_external_input'));
  if (existing) return;
  const now = new Date().toISOString();
  const channel = record.guestTelegram ? 'telegram' : record.guestEmail ? 'email' : 'manual';
  const messageText = 'Здравствуйте. Инструкции заезда готовы к проверке оператором.';
  const metadata = await buildAutoSendDecisionMetadata({
    actorType: 'guest',
    purpose: 'send_checkin_instructions',
    channel,
    messageText,
    metadata: { source: 'pre_checkin_control_center_v1' },
  }, {
    bookingId: record.bookingId,
    propertyId: record.propertyId,
    guestRef: record.guestTelegram ?? record.guestEmail ?? record.guestPhone,
  });
  await supabase.from('booking_ops_communication_intents').insert({
    id: randomUUID(),
    booking_ops_record_id: record.id,
    booking_id: record.bookingId,
    related_task_id: null,
    actor_type: 'guest',
    actor_label: text(record.guestName) || 'Гость',
    purpose: 'send_checkin_instructions',
    channel,
    status: 'draft_ready',
    message_text: messageText,
    message_template_key: 'guest.pre_checkin.instructions.v1',
    metadata,
    created_at: now,
    updated_at: now,
    superseded_at: null,
  });
}

export async function recomputeBookingCheckinReadiness(bookingId: string): Promise<PreCheckinReadinessSnapshot> {
  const input = await loadSnapshotInputs(bookingId);
  const prepGates = gateMap(input.lifecycle);
  const preparationDone = ['cleaning_scheduled', 'linen_scheduled', 'inspection_scheduled']
    .every((gateKey) => isDone(prepGates.get(gateKey as BookingLifecycleGateKey)));
  if (preparationDone && isDone(prepGates.get('maintenance_required')) && !isDone(prepGates.get('maintenance_resolved'))) {
    await blockGate(input.record.id, 'maintenance_resolved', 'Есть незакрытая задача по ремонту', {
      source: 'pre_checkin_control_center_v1',
    });
  } else if (preparationDone && !isDone(prepGates.get('property_ready'))) {
    await completeGate(input.record.id, 'property_ready', { source: 'pre_checkin_control_center_v1' });
  }

  const refreshed = await loadSnapshotInputs(input.record.id);
  let snapshot = computePreCheckinReadinessSnapshot({
    bookingId: refreshed.record.id,
    record: refreshed.record,
    lifecycle: refreshed.lifecycle,
    tasks: refreshed.tasks,
    communications: refreshed.communications,
  });

  const allExceptInstructions = snapshot.hardBlockers.every((item) =>
    item.gateKey === 'checkin_instructions_sent' && item.severity === 'missing');
  if (allExceptInstructions && snapshot.hardBlockers.length === 1) {
    await ensureCheckinInstructionsDraft(refreshed.record);
    snapshot = await getPreCheckinStatus(refreshed.record.id);
  }

  if (snapshot.status === 'ready_for_checkin') {
    await updateBookingOpsRecord(refreshed.record.id, {
      opsStatus: 'ready_for_checkin',
      checkinReadinessStatus: 'ready',
    }, { actorType: 'system' });
  } else if (snapshot.status === 'blocked' || snapshot.status === 'overdue') {
    await updateBookingOpsRecord(refreshed.record.id, {
      opsStatus: 'problem_blocked',
      checkinReadinessStatus: 'problem',
      blockerReason: snapshot.topBlocker?.reason ?? null,
    }, { actorType: 'system' });
  }
  return snapshot;
}

export async function listBookingsByReadinessStatus(filters?: {
  status?: PreCheckinReadinessStatus;
  limit?: number;
}): Promise<PreCheckinReadinessSnapshot[]> {
  const listed = await listBookingOpsRecords({ limit: filters?.limit ?? 100 });
  if (!listed.ok) throw new Error(listed.error ?? 'booking_list_failed');
  const snapshots = await Promise.all(listed.records.map((record) => getPreCheckinStatus(record.id)));
  return filters?.status ? snapshots.filter((item) => item.status === filters.status) : snapshots;
}

export async function createPreCheckinFallbackIfNeeded(
  bookingId: string,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<{ ok: boolean; created: boolean; snapshot: PreCheckinReadinessSnapshot; error?: string }> {
  const snapshot = await getPreCheckinStatus(bookingId);
  const blocker = snapshot.hardBlockers.find((item) => item.fallbackEligible && item.gateKey);
  if (!blocker?.gateKey) return { ok: true, created: false, snapshot };
  const result = await blockGate(bookingId, blocker.gateKey, text(reason) || blocker.reason, {
    ...(metadata ?? {}),
    source: 'pre_checkin_control_center_v1',
    blocker: blocker.key,
  });
  if (!result.ok) return { ok: false, created: false, snapshot, error: result.error };
  return { ok: true, created: true, snapshot: await getPreCheckinStatus(bookingId) };
}

export async function runPreCheckinAction(input: {
  bookingId: string;
  action: string;
  gateKey?: unknown;
  reason?: unknown;
  note?: unknown;
  metadata?: Record<string, unknown>;
}): Promise<PreCheckinReadinessSnapshot> {
  const bookingId = text(input.bookingId);
  const reason = text(input.reason);
  const note = text(input.note);
  switch (input.action) {
    case 'recompute':
      return recomputeBookingCheckinReadiness(bookingId);
    case 'mark_ready_override':
      await adminUpdateLifecycleGate({
        bookingId,
        gateKey: 'property_ready',
        status: 'completed',
        reason: reason || 'Готовность подтверждена вручную',
        note,
        metadata: { manualOverride: true, ...(input.metadata ?? {}) },
      });
      await adminUpdateLifecycleGate({
        bookingId,
        gateKey: 'checkin_instructions_sent',
        status: 'completed',
        reason: reason || 'Инструкции подтверждены вручную',
        note,
        metadata: { manualOverride: true, ...(input.metadata ?? {}) },
      });
      break;
    case 'clear_ready_override':
      await adminUpdateLifecycleGate({
        bookingId,
        gateKey: 'property_ready',
        status: 'in_progress',
        reason: reason || 'Ручное подтверждение снято',
        note,
        metadata: input.metadata ?? {},
      });
      break;
    case 'create_fallback':
      await createPreCheckinFallbackIfNeeded(bookingId, reason || 'Создан ручной fallback', input.metadata);
      break;
    case 'resolve_fallback':
      await adminUpdateLifecycleGate({
        bookingId,
        gateKey: input.gateKey,
        status: 'in_progress',
        reason: reason || 'Fallback разобран',
        note,
        metadata: input.metadata ?? {},
      });
      break;
    case 'add_note': {
      const record = await getBookingOpsRecord(bookingId);
      await updateBookingOpsRecord(bookingId, {
        notes: [record?.notes, note || reason].filter(Boolean).join('\n'),
      }, { actorType: 'admin' });
      break;
    }
    case 'block_gate':
      await adminUpdateLifecycleGate({
        bookingId,
        gateKey: input.gateKey,
        status: 'blocked',
        reason: reason || 'Заблокировано вручную',
        note,
        metadata: input.metadata ?? {},
      });
      break;
    case 'skip_gate':
      await adminUpdateLifecycleGate({
        bookingId,
        gateKey: input.gateKey,
        status: 'skipped',
        reason: reason || 'Пропущено вручную',
        note,
        metadata: input.metadata ?? {},
      });
      break;
    default:
      throw new Error('invalid_action');
  }
  return getPreCheckinStatus(bookingId);
}
