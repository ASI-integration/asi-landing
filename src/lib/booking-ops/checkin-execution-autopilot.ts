import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { buildAutoSendDecisionMetadata } from './communication-auto-send-policy';
import { listBookingOpsCommunicationsForRecord } from './communication-orchestrator';
import {
  adminUpdateLifecycleGate,
  blockGate,
  completeGate,
  getLifecycleStatus,
  initializeLifecycleForBooking,
  markGateInProgress,
} from './lifecycle';
import { getPreCheckinStatus, type PreCheckinReadinessSnapshot } from './pre-checkin-control-center';
import { getBookingOpsRecord, updateBookingOpsRecord } from './repository';
import { shouldBlockCheckinInstructions } from './guest-legal-deposit-mvd-execution';
import type {
  BookingOpsCommunicationChannel,
  BookingOpsCommunicationIntent,
  BookingOpsCommunicationPurpose,
  BookingOpsRecord,
} from './types';

export const CHECKIN_EXECUTION_STATUSES = [
  'not_ready',
  'ready_to_send_instructions',
  'instructions_queued',
  'instructions_sent',
  'arrival_pending',
  'arrival_confirmed',
  'access_ready',
  'access_issue',
  'checked_in',
  'blocked',
] as const;

export type CheckinExecutionStatus = (typeof CHECKIN_EXECUTION_STATUSES)[number];

export type CheckinInstructionsStatus = 'not_prepared' | 'prepared' | 'queued' | 'sent' | 'failed';
export type CheckinArrivalStatus = 'unknown' | 'requested' | 'confirmed' | 'missed' | 'changed';
export type CheckinAccessStatus = 'unknown' | 'ready' | 'issue' | 'resolved';

export type CheckinExecutionRow = {
  id: string;
  bookingId: string;
  status: CheckinExecutionStatus;
  instructionsStatus: CheckinInstructionsStatus;
  arrivalStatus: CheckinArrivalStatus;
  accessStatus: CheckinAccessStatus;
  plannedArrivalAt: string | null;
  actualCheckinAt: string | null;
  accessMethod: string | null;
  accessSecretRefPresent: boolean;
  lastGuestTouchAt: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CheckinExecutionBlocker = {
  key: string;
  title: string;
  reason: string;
  fallbackEligible: boolean;
};

export type CheckinExecutionSnapshot = {
  bookingId: string;
  status: CheckinExecutionStatus;
  execution: CheckinExecutionRow | null;
  instructionsStatus: CheckinInstructionsStatus;
  arrivalStatus: CheckinArrivalStatus;
  accessStatus: CheckinAccessStatus;
  lifecycleReady: boolean;
  lifecycle: Awaited<ReturnType<typeof getLifecycleStatus>>['lifecycle'] | null;
  preCheckin: PreCheckinReadinessSnapshot;
  blockers: CheckinExecutionBlocker[];
  communications: BookingOpsCommunicationIntent[];
  nextAction: string | null;
  updatedAt: string;
};

type CheckinExecutionDbRow = {
  id: string;
  booking_id: string;
  status: CheckinExecutionStatus;
  instructions_status: CheckinInstructionsStatus;
  arrival_status: CheckinArrivalStatus;
  access_status: CheckinAccessStatus;
  planned_arrival_at: string | null;
  actual_checkin_at: string | null;
  access_method: string | null;
  access_secret_ref: string | null;
  last_guest_touch_at: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const ACTIVE_COMMUNICATION_STATUSES = new Set(['draft_ready', 'waiting_for_external_input']);
const SECRET_KEY_PATTERN = /(secret|password|passcode|door.?code|intercom|код|парол|token|ключ)/i;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function safeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (SECRET_KEY_PATTERN.test(key)) {
      output[key] = '[redacted]';
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = safeMetadata(value as Record<string, unknown>);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function mapRow(row: CheckinExecutionDbRow): CheckinExecutionRow {
  return {
    id: row.id,
    bookingId: row.booking_id,
    status: row.status,
    instructionsStatus: row.instructions_status,
    arrivalStatus: row.arrival_status,
    accessStatus: row.access_status,
    plannedArrivalAt: row.planned_arrival_at,
    actualCheckinAt: row.actual_checkin_at,
    accessMethod: text(row.access_method) || null,
    accessSecretRefPresent: Boolean(text(row.access_secret_ref)),
    lastGuestTouchAt: row.last_guest_touch_at,
    failureReason: text(row.failure_reason) || null,
    metadata: safeMetadata(row.metadata ?? {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getExecutionDbRow(bookingId: string): Promise<CheckinExecutionDbRow | null> {
  const { data, error } = await supabase
    .from('booking_checkin_execution')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CheckinExecutionDbRow;
}

async function getExecutionRow(bookingId: string): Promise<CheckinExecutionRow | null> {
  const row = await getExecutionDbRow(bookingId);
  return row ? mapRow(row) : null;
}

async function upsertExecution(
  bookingId: string,
  patch: Partial<{
    status: CheckinExecutionStatus;
    instructions_status: CheckinInstructionsStatus;
    arrival_status: CheckinArrivalStatus;
    access_status: CheckinAccessStatus;
    planned_arrival_at: string | null;
    actual_checkin_at: string | null;
    access_method: string | null;
    access_secret_ref: string | null;
    last_guest_touch_at: string | null;
    failure_reason: string | null;
    metadata: Record<string, unknown>;
  }>,
): Promise<CheckinExecutionRow> {
  const existingRaw = await getExecutionDbRow(bookingId);
  const existing = existingRaw ? mapRow(existingRaw) : null;
  const now = new Date().toISOString();
  const row = {
    id: existing?.id ?? randomUUID(),
    booking_id: bookingId,
    status: patch.status ?? existing?.status ?? 'not_ready',
    instructions_status: patch.instructions_status ?? existing?.instructionsStatus ?? 'not_prepared',
    arrival_status: patch.arrival_status ?? existing?.arrivalStatus ?? 'unknown',
    access_status: patch.access_status ?? existing?.accessStatus ?? 'unknown',
    planned_arrival_at: patch.planned_arrival_at ?? existing?.plannedArrivalAt ?? null,
    actual_checkin_at: patch.actual_checkin_at ?? existing?.actualCheckinAt ?? null,
    access_method: patch.access_method ?? existing?.accessMethod ?? null,
    access_secret_ref: patch.access_secret_ref ?? existingRaw?.access_secret_ref ?? null,
    last_guest_touch_at: patch.last_guest_touch_at ?? existing?.lastGuestTouchAt ?? null,
    failure_reason: patch.failure_reason ?? existing?.failureReason ?? null,
    metadata: {
      ...(existing?.metadata ?? {}),
      ...safeMetadata(patch.metadata),
    },
    created_at: existing?.createdAt ?? now,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('booking_checkin_execution')
    .upsert(row, { onConflict: 'booking_id' })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'checkin_execution_update_failed');
  return mapRow(data as CheckinExecutionDbRow);
}

function isInstructionsOnlyBlocker(preCheckin: PreCheckinReadinessSnapshot): boolean {
  return preCheckin.hardBlockers.length === 1
    && preCheckin.hardBlockers[0]?.gateKey === 'checkin_instructions_sent'
    && preCheckin.hardBlockers[0]?.severity === 'missing';
}

function resolveStatus(input: {
  execution: CheckinExecutionRow | null;
  preCheckin: PreCheckinReadinessSnapshot;
  lifecycleGuestCheckedIn: boolean;
}): CheckinExecutionStatus {
  const row = input.execution;
  if (input.lifecycleGuestCheckedIn || row?.status === 'checked_in') return 'checked_in';
  if (row?.accessStatus === 'issue' || row?.status === 'access_issue') return 'access_issue';
  if (input.preCheckin.status === 'blocked' || input.preCheckin.status === 'overdue') return 'blocked';
  if (row?.accessStatus === 'ready') return 'access_ready';
  if (row?.arrivalStatus === 'confirmed') return 'arrival_confirmed';
  if (row?.arrivalStatus === 'requested') return 'arrival_pending';
  if (row?.instructionsStatus === 'sent') return 'instructions_sent';
  if (row?.instructionsStatus === 'queued') return 'instructions_queued';
  if (row?.instructionsStatus === 'prepared') return 'ready_to_send_instructions';
  if (input.preCheckin.status === 'ready_for_checkin' || isInstructionsOnlyBlocker(input.preCheckin)) {
    return 'ready_to_send_instructions';
  }
  return 'not_ready';
}

function buildBlockers(input: {
  execution: CheckinExecutionRow | null;
  preCheckin: PreCheckinReadinessSnapshot;
}): CheckinExecutionBlocker[] {
  const blockers = input.preCheckin.hardBlockers.map((item) => ({
    key: item.key,
    title: item.title,
    reason: item.reason,
    fallbackEligible: item.fallbackEligible,
  }));
  if (input.execution?.accessStatus === 'issue') {
    blockers.unshift({
      key: 'access_issue',
      title: 'Проблема доступа',
      reason: input.execution.failureReason ?? 'Гость не может попасть в объект.',
      fallbackEligible: true,
    });
  }
  if (input.execution?.instructionsStatus === 'failed') {
    blockers.unshift({
      key: 'instructions_failed',
      title: 'Инструкции не отправлены',
      reason: input.execution.failureReason ?? 'Нужно вручную проверить инструкции для гостя.',
      fallbackEligible: true,
    });
  }
  return blockers;
}

function nextAction(status: CheckinExecutionStatus): string | null {
  switch (status) {
    case 'ready_to_send_instructions':
      return 'Подготовить или поставить инструкции в очередь';
    case 'instructions_queued':
      return 'Проверить черновик и отметить отправку';
    case 'instructions_sent':
      return 'Запросить подтверждение прибытия';
    case 'arrival_pending':
      return 'Дождаться ответа гостя';
    case 'arrival_confirmed':
      return 'Проверить готовность доступа';
    case 'access_ready':
      return 'Отметить, что гость заехал';
    case 'access_issue':
    case 'blocked':
      return 'Открыть ручной план';
    default:
      return null;
  }
}

async function loadRecord(bookingId: string): Promise<BookingOpsRecord> {
  const id = text(bookingId);
  if (!id) throw new Error('booking_id_required');
  const record = await getBookingOpsRecord(id);
  if (!record) throw new Error('booking_not_found');
  return record;
}

function preferredChannel(record: BookingOpsRecord, channel?: BookingOpsCommunicationChannel): BookingOpsCommunicationChannel {
  if (channel) return channel;
  if (record.guestTelegram) return 'telegram';
  if (record.guestEmail) return 'email';
  return 'manual';
}

async function ensureCommunicationIntent(input: {
  record: BookingOpsRecord;
  purpose: BookingOpsCommunicationPurpose;
  channel?: BookingOpsCommunicationChannel;
  messageText: string;
  messageTemplateKey: string;
  metadata?: Record<string, unknown>;
}): Promise<BookingOpsCommunicationIntent | null> {
  const existing = await listBookingOpsCommunicationsForRecord(input.record.id);
  if (existing.ok) {
    const active = existing.communications.find((item) =>
      item.actorType === 'guest'
      && item.purpose === input.purpose
      && item.relatedTaskId === null
      && ACTIVE_COMMUNICATION_STATUSES.has(item.status));
    if (active) return active;
  }

  const now = new Date().toISOString();
  const channel = preferredChannel(input.record, input.channel);
  const baseMetadata = {
    source: 'checkin_execution_autopilot_v1',
    bookingOpsRecordId: input.record.id,
    ...safeMetadata(input.metadata),
  };
  const metadata = await buildAutoSendDecisionMetadata({
    actorType: 'guest',
    purpose: input.purpose,
    channel,
    messageText: input.messageText,
    metadata: baseMetadata,
  }, {
    bookingId: input.record.bookingId,
    propertyId: input.record.propertyId,
    guestRef: input.record.guestTelegram ?? input.record.guestEmail ?? input.record.guestPhone,
  });
  const { data, error } = await supabase
    .from('booking_ops_communication_intents')
    .insert({
      id: randomUUID(),
      booking_ops_record_id: input.record.id,
      booking_id: input.record.bookingId,
      related_task_id: null,
      actor_type: 'guest',
      actor_label: text(input.record.guestName) || 'Гость',
      purpose: input.purpose,
      channel,
      status: 'draft_ready',
      message_text: input.messageText,
      message_template_key: input.messageTemplateKey,
      metadata,
      created_at: now,
      updated_at: now,
      superseded_at: null,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'communication_intent_create_failed');
  const refreshed = await listBookingOpsCommunicationsForRecord(input.record.id);
  return refreshed.ok ? refreshed.communications.find((item) => item.id === String((data as { id: string }).id)) ?? null : null;
}

export async function getCheckinExecutionStatus(bookingId: string): Promise<CheckinExecutionSnapshot> {
  const record = await loadRecord(bookingId);
  await initializeLifecycleForBooking(record.id);
  const [execution, preCheckin, lifecycleResult, communicationResult] = await Promise.all([
    getExecutionRow(record.id),
    getPreCheckinStatus(record.id),
    getLifecycleStatus(record.id),
    listBookingOpsCommunicationsForRecord(record.id),
  ]);
  const lifecycle = lifecycleResult.lifecycle ?? null;
  const guestCheckedIn = lifecycle?.gates.some((gate) =>
    gate.gateKey === 'guest_checked_in' && (gate.status === 'completed' || gate.status === 'skipped')) ?? false;
  const status = resolveStatus({ execution, preCheckin, lifecycleGuestCheckedIn: guestCheckedIn });
  return {
    bookingId: record.id,
    status,
    execution,
    instructionsStatus: execution?.instructionsStatus ?? 'not_prepared',
    arrivalStatus: execution?.arrivalStatus ?? 'unknown',
    accessStatus: execution?.accessStatus ?? 'unknown',
    lifecycleReady: preCheckin.status === 'ready_for_checkin' || isInstructionsOnlyBlocker(preCheckin),
    lifecycle,
    preCheckin,
    blockers: buildBlockers({ execution, preCheckin }),
    communications: communicationResult.ok ? communicationResult.communications : [],
    nextAction: nextAction(status),
    updatedAt: execution?.updatedAt ?? preCheckin.lastRecomputedAt,
  };
}

export async function prepareCheckinInstructions(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<CheckinExecutionSnapshot> {
  const record = await loadRecord(bookingId);
  const legalGuard = await shouldBlockCheckinInstructions(record.id);
  if (legalGuard.block) throw new Error(legalGuard.reason ?? 'Инструкции заезда заблокированы до снятия юридических ограничений.');
  await markGateInProgress(record.id, 'checkin_instructions_sent', {
    source: 'checkin_execution_autopilot_v1',
    ...safeMetadata(metadata),
  });
  await upsertExecution(record.id, {
    status: 'ready_to_send_instructions',
    instructions_status: 'prepared',
    metadata: { source: 'checkin_execution_autopilot_v1', preparedAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return getCheckinExecutionStatus(record.id);
}

export async function queueCheckinInstructions(
  bookingId: string,
  channel?: BookingOpsCommunicationChannel,
  metadata?: Record<string, unknown>,
): Promise<CheckinExecutionSnapshot> {
  const record = await loadRecord(bookingId);
  const legalGuard = await shouldBlockCheckinInstructions(record.id);
  if (legalGuard.block) throw new Error(legalGuard.reason ?? 'Инструкции заезда заблокированы до снятия юридических ограничений.');
  await ensureCommunicationIntent({
    record,
    purpose: 'checkin_instructions',
    channel,
    messageTemplateKey: 'guest.checkin.instructions.v1',
    messageText: `Здравствуйте. Инструкции по заезду для объекта ${record.propertyLabel ?? record.propertyId ?? 'вашей брони'} готовы к проверке оператором.`,
    metadata,
  });
  await upsertExecution(record.id, {
    status: 'instructions_queued',
    instructions_status: 'queued',
    metadata: { source: 'checkin_execution_autopilot_v1', queuedAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return getCheckinExecutionStatus(record.id);
}

export async function markCheckinInstructionsSent(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<CheckinExecutionSnapshot> {
  const record = await loadRecord(bookingId);
  const legalGuard = await shouldBlockCheckinInstructions(record.id);
  if (legalGuard.block) throw new Error(legalGuard.reason ?? 'Нельзя отметить инструкции отправленными: есть юридические ограничения.');
  await completeGate(record.id, 'checkin_instructions_sent', {
    source: 'checkin_execution_autopilot_v1',
    ...safeMetadata(metadata),
  });
  await upsertExecution(record.id, {
    status: 'instructions_sent',
    instructions_status: 'sent',
    metadata: { source: 'checkin_execution_autopilot_v1', sentAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  await updateBookingOpsRecord(record.id, { checkinReadinessStatus: 'ready' }, { actorType: 'system' });
  return getCheckinExecutionStatus(record.id);
}

export async function requestArrivalConfirmation(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<CheckinExecutionSnapshot> {
  const record = await loadRecord(bookingId);
  await ensureCommunicationIntent({
    record,
    purpose: 'arrival_confirmation_request',
    messageTemplateKey: 'guest.checkin.arrival_confirmation.v1',
    messageText: 'Здравствуйте. Подтвердите, пожалуйста, когда будете на месте и сможете зайти в объект.',
    metadata,
  });
  await upsertExecution(record.id, {
    status: 'arrival_pending',
    arrival_status: 'requested',
    last_guest_touch_at: new Date().toISOString(),
    metadata: { source: 'checkin_execution_autopilot_v1', arrivalRequestedAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return getCheckinExecutionStatus(record.id);
}

export async function markArrivalConfirmed(
  bookingId: string,
  arrivalTime?: string | Date | null,
  metadata?: Record<string, unknown>,
): Promise<CheckinExecutionSnapshot> {
  const record = await loadRecord(bookingId);
  const arrivedAt = arrivalTime ? new Date(arrivalTime).toISOString() : new Date().toISOString();
  await upsertExecution(record.id, {
    status: 'arrival_confirmed',
    arrival_status: 'confirmed',
    planned_arrival_at: arrivedAt,
    last_guest_touch_at: new Date().toISOString(),
    metadata: { source: 'checkin_execution_autopilot_v1', arrivalConfirmedAt: arrivedAt, ...safeMetadata(metadata) },
  });
  return getCheckinExecutionStatus(record.id);
}

export async function markAccessReady(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<CheckinExecutionSnapshot> {
  const record = await loadRecord(bookingId);
  await completeGate(record.id, 'property_ready', {
    source: 'checkin_execution_autopilot_v1',
    accessReady: true,
    ...safeMetadata(metadata),
  });
  await upsertExecution(record.id, {
    status: 'access_ready',
    access_status: 'ready',
    failure_reason: null,
    metadata: { source: 'checkin_execution_autopilot_v1', accessReadyAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return getCheckinExecutionStatus(record.id);
}

export async function reportAccessIssue(
  bookingId: string,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<CheckinExecutionSnapshot> {
  const record = await loadRecord(bookingId);
  const cleanReason = text(reason) || 'Проблема доступа при заезде';
  await blockGate(record.id, 'property_ready', cleanReason, {
    source: 'checkin_execution_autopilot_v1',
    ...safeMetadata(metadata),
  });
  await ensureCommunicationIntent({
    record,
    purpose: 'access_issue_followup',
    channel: 'internal',
    messageTemplateKey: 'operator.checkin.access_issue.v1',
    messageText: `Проблема доступа при заезде: ${cleanReason}`,
    metadata,
  });
  await upsertExecution(record.id, {
    status: 'access_issue',
    access_status: 'issue',
    failure_reason: cleanReason,
    metadata: { source: 'checkin_execution_autopilot_v1', accessIssueAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  await updateBookingOpsRecord(record.id, {
    opsStatus: 'problem_blocked',
    checkinReadinessStatus: 'problem',
    blockerReason: cleanReason,
  }, { actorType: 'system' });
  return getCheckinExecutionStatus(record.id);
}

export async function markGuestCheckedIn(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<CheckinExecutionSnapshot> {
  const record = await loadRecord(bookingId);
  const now = new Date().toISOString();
  await completeGate(record.id, 'guest_checked_in', {
    source: 'checkin_execution_autopilot_v1',
    ...safeMetadata(metadata),
  });
  await upsertExecution(record.id, {
    status: 'checked_in',
    arrival_status: 'confirmed',
    actual_checkin_at: now,
    last_guest_touch_at: now,
    metadata: { source: 'checkin_execution_autopilot_v1', checkedInAt: now, ...safeMetadata(metadata) },
  });
  await updateBookingOpsRecord(record.id, {
    opsStatus: 'ready_for_checkin',
    checkinReadinessStatus: 'ready',
  }, { actorType: 'system' });
  return getCheckinExecutionStatus(record.id);
}

export async function getCheckinBlockers(bookingId: string): Promise<CheckinExecutionBlocker[]> {
  return (await getCheckinExecutionStatus(bookingId)).blockers;
}

export async function createCheckinFallbackIfNeeded(
  bookingId: string,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<{ ok: boolean; created: boolean; snapshot: CheckinExecutionSnapshot; error?: string }> {
  const snapshot = await getCheckinExecutionStatus(bookingId);
  const blocker = snapshot.blockers.find((item) => item.fallbackEligible);
  if (!blocker) return { ok: true, created: false, snapshot };
  const cleanReason = text(reason) || blocker.reason;
  const gateKey = blocker.key === 'instructions_failed' ? 'checkin_instructions_sent' : 'property_ready';
  const result = await blockGate(bookingId, gateKey, cleanReason, {
    source: 'checkin_execution_autopilot_v1',
    blocker: blocker.key,
    ...safeMetadata(metadata),
  });
  if (!result.ok) return { ok: false, created: false, snapshot, error: result.error };
  return { ok: true, created: true, snapshot: await getCheckinExecutionStatus(bookingId) };
}

export async function runCheckinExecutionAction(input: {
  bookingId: string;
  action: string;
  channel?: BookingOpsCommunicationChannel;
  reason?: unknown;
  note?: unknown;
  arrivalTime?: unknown;
  metadata?: Record<string, unknown>;
}): Promise<CheckinExecutionSnapshot> {
  const bookingId = text(input.bookingId);
  const reason = text(input.reason);
  const note = text(input.note);
  switch (input.action) {
    case 'prepare_instructions':
      return prepareCheckinInstructions(bookingId, input.metadata);
    case 'queue_instructions':
      return queueCheckinInstructions(bookingId, input.channel, input.metadata);
    case 'mark_instructions_sent':
      return markCheckinInstructionsSent(bookingId, input.metadata);
    case 'request_arrival_confirmation':
      return requestArrivalConfirmation(bookingId, input.metadata);
    case 'mark_arrival_confirmed':
      return markArrivalConfirmed(bookingId, text(input.arrivalTime) || null, input.metadata);
    case 'mark_access_ready':
      return markAccessReady(bookingId, input.metadata);
    case 'report_access_issue':
      return reportAccessIssue(bookingId, reason || 'Проблема доступа при заезде', input.metadata);
    case 'resolve_access_issue':
      await adminUpdateLifecycleGate({
        bookingId,
        gateKey: 'property_ready',
        status: 'in_progress',
        reason: reason || 'Проблема доступа разобрана',
        note,
        metadata: { source: 'checkin_execution_autopilot_v1', ...safeMetadata(input.metadata) },
      });
      await upsertExecution(bookingId, {
        status: 'access_ready',
        access_status: 'resolved',
        failure_reason: null,
        metadata: { source: 'checkin_execution_autopilot_v1', accessIssueResolvedAt: new Date().toISOString(), note },
      });
      return getCheckinExecutionStatus(bookingId);
    case 'mark_guest_checked_in':
      return markGuestCheckedIn(bookingId, input.metadata);
    case 'create_fallback':
      return (await createCheckinFallbackIfNeeded(bookingId, reason || 'Нужен ручной план заезда', input.metadata)).snapshot;
    case 'add_note': {
      const current = await getExecutionRow(bookingId);
      const notes = Array.isArray(current?.metadata.notes) ? current?.metadata.notes : [];
      await upsertExecution(bookingId, {
        metadata: {
          source: 'checkin_execution_autopilot_v1',
          notes: [...notes, { text: note || reason, createdAt: new Date().toISOString() }].filter((item) => text((item as { text?: unknown }).text)),
        },
      });
      return getCheckinExecutionStatus(bookingId);
    }
    default:
      throw new Error('invalid_action');
  }
}

/** Baseline row for inbound intake — no instructions sent, no secrets. */
export async function initializeCheckinExecutionBaseline(bookingId: string): Promise<CheckinExecutionRow> {
  return upsertExecution(bookingId, {
    metadata: { source: 'inbound_intake_autopilot_v1', initializedAt: new Date().toISOString() },
  });
}
