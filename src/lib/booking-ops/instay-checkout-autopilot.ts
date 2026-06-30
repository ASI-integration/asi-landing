import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { listBookingOpsCommunicationsForRecord } from './communication-orchestrator';
import {
  adminUpdateLifecycleGate,
  blockGate,
  completeGate,
  getLifecycleStatus,
  initializeLifecycleForBooking,
  markGateInProgress,
} from './lifecycle';
import { getBookingOpsRecord } from './repository';
import type {
  BookingOpsCommunicationChannel,
  BookingOpsCommunicationIntent,
  BookingOpsCommunicationPurpose,
  BookingOpsRecord,
} from './types';

export const INSTAY_CHECKOUT_STATUSES = [
  'not_checked_in',
  'in_stay',
  'guest_issue_open',
  'guest_issue_blocked',
  'checkout_preparing',
  'checkout_instructions_queued',
  'checkout_pending',
  'checked_out',
  'inspection_pending',
  'inspection_done',
  'deposit_return_ready',
  'ready_to_close',
  'closed',
  'blocked',
] as const;

export type InStayCheckoutStatus = (typeof INSTAY_CHECKOUT_STATUSES)[number];

export type CheckoutInstructionsStatus = 'not_prepared' | 'prepared' | 'queued' | 'sent' | 'failed';
export type CheckoutConfirmationStatus = 'not_requested' | 'requested' | 'confirmed' | 'missed';
export type CheckoutInspectionStatus = 'not_started' | 'scheduled' | 'done' | 'issue_found' | 'failed';
export type DepositReturnStatus = 'not_ready' | 'ready' | 'held' | 'partially_held' | 'returned' | 'waived';
export type CheckoutClosureStatus = 'open' | 'ready_to_close' | 'closed' | 'blocked';

export type GuestStayIssueSeverity = 'low' | 'medium' | 'high' | 'urgent';
export type GuestStayIssueStatus = 'open' | 'triaged' | 'assigned' | 'resolved' | 'blocked' | 'cancelled';
export type GuestStayIssueSource = 'guest' | 'admin' | 'cleaner' | 'master' | 'system';

export type InStayCheckoutRow = {
  id: string;
  bookingId: string;
  status: InStayCheckoutStatus;
  checkoutInstructionsStatus: CheckoutInstructionsStatus;
  checkoutConfirmationStatus: CheckoutConfirmationStatus;
  plannedCheckoutAt: string | null;
  actualCheckoutAt: string | null;
  inspectionStatus: CheckoutInspectionStatus;
  depositReturnStatus: DepositReturnStatus;
  closureStatus: CheckoutClosureStatus;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type GuestStayIssueRow = {
  id: string;
  bookingId: string;
  issueType: string;
  severity: GuestStayIssueSeverity;
  status: GuestStayIssueStatus;
  source: GuestStayIssueSource;
  description: string | null;
  resolution: string | null;
  assignedToType: string | null;
  assignedToRef: string | null;
  openedAt: string;
  resolvedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type InStayCheckoutBlocker = {
  key: string;
  title: string;
  reason: string;
  fallbackEligible: boolean;
};

export type InStayCheckoutSnapshot = {
  bookingId: string;
  status: InStayCheckoutStatus;
  execution: InStayCheckoutRow | null;
  checkoutInstructionsStatus: CheckoutInstructionsStatus;
  checkoutConfirmationStatus: CheckoutConfirmationStatus;
  inspectionStatus: CheckoutInspectionStatus;
  depositReturnStatus: DepositReturnStatus;
  closureStatus: CheckoutClosureStatus;
  openIssuesCount: number;
  openIssues: GuestStayIssueRow[];
  lifecycle: Awaited<ReturnType<typeof getLifecycleStatus>>['lifecycle'] | null;
  blockers: InStayCheckoutBlocker[];
  communications: BookingOpsCommunicationIntent[];
  nextAction: string | null;
  updatedAt: string;
};

type InStayCheckoutDbRow = {
  id: string;
  booking_id: string;
  status: InStayCheckoutStatus;
  checkout_instructions_status: CheckoutInstructionsStatus;
  checkout_confirmation_status: CheckoutConfirmationStatus;
  planned_checkout_at: string | null;
  actual_checkout_at: string | null;
  inspection_status: CheckoutInspectionStatus;
  deposit_return_status: DepositReturnStatus;
  closure_status: CheckoutClosureStatus;
  failure_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type GuestStayIssueDbRow = {
  id: string;
  booking_id: string;
  issue_type: string;
  severity: GuestStayIssueSeverity;
  status: GuestStayIssueStatus;
  source: GuestStayIssueSource;
  description: string | null;
  resolution: string | null;
  assigned_to_type: string | null;
  assigned_to_ref: string | null;
  opened_at: string;
  resolved_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const ACTIVE_COMMUNICATION_STATUSES = new Set(['draft_ready', 'waiting_for_external_input']);
const OPEN_ISSUE_STATUSES = new Set<GuestStayIssueStatus>(['open', 'triaged', 'assigned', 'blocked']);
const SECRET_KEY_PATTERN = /(secret|password|passcode|door.?code|intercom|код|парол|token|ключ|card|payment|платеж)/i;

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

function mapExecutionRow(row: InStayCheckoutDbRow): InStayCheckoutRow {
  return {
    id: row.id,
    bookingId: row.booking_id,
    status: row.status,
    checkoutInstructionsStatus: row.checkout_instructions_status,
    checkoutConfirmationStatus: row.checkout_confirmation_status,
    plannedCheckoutAt: row.planned_checkout_at,
    actualCheckoutAt: row.actual_checkout_at,
    inspectionStatus: row.inspection_status,
    depositReturnStatus: row.deposit_return_status,
    closureStatus: row.closure_status,
    failureReason: text(row.failure_reason) || null,
    metadata: safeMetadata(row.metadata ?? {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIssueRow(row: GuestStayIssueDbRow): GuestStayIssueRow {
  return {
    id: row.id,
    bookingId: row.booking_id,
    issueType: row.issue_type,
    severity: row.severity,
    status: row.status,
    source: row.source,
    description: text(row.description) || null,
    resolution: text(row.resolution) || null,
    assignedToType: text(row.assigned_to_type) || null,
    assignedToRef: text(row.assigned_to_ref) || null,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at,
    metadata: safeMetadata(row.metadata ?? {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getExecutionDbRow(bookingId: string): Promise<InStayCheckoutDbRow | null> {
  const { data, error } = await supabase
    .from('booking_instay_checkout')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (error || !data) return null;
  return data as InStayCheckoutDbRow;
}

async function getExecutionRow(bookingId: string): Promise<InStayCheckoutRow | null> {
  const row = await getExecutionDbRow(bookingId);
  return row ? mapExecutionRow(row) : null;
}

async function listIssueRows(bookingId: string): Promise<GuestStayIssueRow[]> {
  const { data, error } = await supabase
    .from('booking_guest_stay_issues')
    .select('*')
    .eq('booking_id', bookingId)
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  return (data as GuestStayIssueDbRow[]).map(mapIssueRow);
}

async function getIssueRow(bookingId: string, issueId: string): Promise<GuestStayIssueRow | null> {
  const { data, error } = await supabase
    .from('booking_guest_stay_issues')
    .select('*')
    .eq('booking_id', bookingId)
    .eq('id', issueId)
    .maybeSingle();
  if (error || !data) return null;
  return mapIssueRow(data as GuestStayIssueDbRow);
}

async function upsertExecution(
  bookingId: string,
  patch: Partial<{
    status: InStayCheckoutStatus;
    checkout_instructions_status: CheckoutInstructionsStatus;
    checkout_confirmation_status: CheckoutConfirmationStatus;
    planned_checkout_at: string | null;
    actual_checkout_at: string | null;
    inspection_status: CheckoutInspectionStatus;
    deposit_return_status: DepositReturnStatus;
    closure_status: CheckoutClosureStatus;
    failure_reason: string | null;
    metadata: Record<string, unknown>;
  }>,
): Promise<InStayCheckoutRow> {
  const existingRaw = await getExecutionDbRow(bookingId);
  const existing = existingRaw ? mapExecutionRow(existingRaw) : null;
  const now = new Date().toISOString();
  const row = {
    id: existing?.id ?? randomUUID(),
    booking_id: bookingId,
    status: patch.status ?? existing?.status ?? 'not_checked_in',
    checkout_instructions_status: patch.checkout_instructions_status ?? existing?.checkoutInstructionsStatus ?? 'not_prepared',
    checkout_confirmation_status: patch.checkout_confirmation_status ?? existing?.checkoutConfirmationStatus ?? 'not_requested',
    planned_checkout_at: patch.planned_checkout_at ?? existing?.plannedCheckoutAt ?? null,
    actual_checkout_at: patch.actual_checkout_at ?? existing?.actualCheckoutAt ?? null,
    inspection_status: patch.inspection_status ?? existing?.inspectionStatus ?? 'not_started',
    deposit_return_status: patch.deposit_return_status ?? existing?.depositReturnStatus ?? 'not_ready',
    closure_status: patch.closure_status ?? existing?.closureStatus ?? 'open',
    failure_reason: patch.failure_reason ?? existing?.failureReason ?? null,
    metadata: {
      ...(existing?.metadata ?? {}),
      ...safeMetadata(patch.metadata),
    },
    created_at: existing?.createdAt ?? now,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('booking_instay_checkout')
    .upsert(row, { onConflict: 'booking_id' })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'instay_checkout_update_failed');
  return mapExecutionRow(data as InStayCheckoutDbRow);
}

async function insertIssue(
  bookingId: string,
  input: {
    issue_type: string;
    severity: GuestStayIssueSeverity;
    source?: GuestStayIssueSource;
    description?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<GuestStayIssueRow> {
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    booking_id: bookingId,
    issue_type: text(input.issue_type) || 'general',
    severity: input.severity,
    status: 'open' as GuestStayIssueStatus,
    source: input.source ?? 'guest',
    description: text(input.description) || null,
    resolution: null,
    assigned_to_type: null,
    assigned_to_ref: null,
    opened_at: now,
    resolved_at: null,
    metadata: safeMetadata(input.metadata),
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('booking_guest_stay_issues')
    .insert(row)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'guest_stay_issue_create_failed');
  return mapIssueRow(data as GuestStayIssueDbRow);
}

async function updateIssue(
  bookingId: string,
  issueId: string,
  patch: Partial<{
    status: GuestStayIssueStatus;
    resolution: string | null;
    assigned_to_type: string | null;
    assigned_to_ref: string | null;
    resolved_at: string | null;
    metadata: Record<string, unknown>;
  }>,
): Promise<GuestStayIssueRow> {
  const existing = await getIssueRow(bookingId, issueId);
  if (!existing) throw new Error('issue_not_found');
  const now = new Date().toISOString();
  const row = {
    status: patch.status ?? existing.status,
    resolution: patch.resolution !== undefined ? patch.resolution : existing.resolution,
    assigned_to_type: patch.assigned_to_type !== undefined ? patch.assigned_to_type : existing.assignedToType,
    assigned_to_ref: patch.assigned_to_ref !== undefined ? patch.assigned_to_ref : existing.assignedToRef,
    resolved_at: patch.resolved_at !== undefined ? patch.resolved_at : existing.resolvedAt,
    metadata: {
      ...existing.metadata,
      ...safeMetadata(patch.metadata),
    },
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('booking_guest_stay_issues')
    .update(row)
    .eq('booking_id', bookingId)
    .eq('id', issueId)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'guest_stay_issue_update_failed');
  return mapIssueRow(data as GuestStayIssueDbRow);
}

function gateCompleted(
  lifecycle: Awaited<ReturnType<typeof getLifecycleStatus>>['lifecycle'] | null,
  gateKey: string,
): boolean {
  return lifecycle?.gates.some((gate) =>
    gate.gateKey === gateKey && (gate.status === 'completed' || gate.status === 'skipped')) ?? false;
}

function resolveStatus(input: {
  execution: InStayCheckoutRow | null;
  openIssues: GuestStayIssueRow[];
  lifecycleGuestCheckedIn: boolean;
  lifecycleGuestCheckedOut: boolean;
  lifecycleInspectionDone: boolean;
  lifecycleDepositReady: boolean;
  lifecycleBookingClosed: boolean;
}): InStayCheckoutStatus {
  const row = input.execution;
  if (input.lifecycleBookingClosed || row?.closureStatus === 'closed') return 'closed';
  if (row?.closureStatus === 'blocked' || row?.status === 'blocked') return 'blocked';
  if (!input.lifecycleGuestCheckedIn) return 'not_checked_in';
  if (row?.closureStatus === 'ready_to_close') return 'ready_to_close';
  if (input.lifecycleDepositReady || row?.depositReturnStatus === 'ready') return 'deposit_return_ready';
  if (input.lifecycleInspectionDone || row?.inspectionStatus === 'done') return 'inspection_done';
  if (row?.inspectionStatus === 'scheduled' || row?.inspectionStatus === 'issue_found' || row?.inspectionStatus === 'failed') {
    return 'inspection_pending';
  }
  if (input.lifecycleGuestCheckedOut || row?.actualCheckoutAt) return 'checked_out';
  if (row?.checkoutConfirmationStatus === 'requested' || row?.checkoutConfirmationStatus === 'missed') {
    return 'checkout_pending';
  }
  if (row?.checkoutInstructionsStatus === 'queued') return 'checkout_instructions_queued';
  if (row?.checkoutInstructionsStatus === 'prepared') return 'checkout_preparing';
  const blockedIssues = input.openIssues.filter((item) => item.status === 'blocked');
  if (blockedIssues.length > 0) return 'guest_issue_blocked';
  const activeIssues = input.openIssues.filter((item) => OPEN_ISSUE_STATUSES.has(item.status) && item.status !== 'blocked');
  if (activeIssues.length > 0) return 'guest_issue_open';
  return 'in_stay';
}

function buildBlockers(input: {
  execution: InStayCheckoutRow | null;
  openIssues: GuestStayIssueRow[];
}): InStayCheckoutBlocker[] {
  const blockers: InStayCheckoutBlocker[] = [];
  for (const issue of input.openIssues) {
    if (!OPEN_ISSUE_STATUSES.has(issue.status)) continue;
    const urgent = issue.severity === 'urgent' || issue.severity === 'high';
    const blocked = issue.status === 'blocked';
    blockers.push({
      key: `issue_${issue.id}`,
      title: blocked ? 'Проблема блокирует проживание' : 'Обращение гостя',
      reason: issue.description ?? issue.issueType,
      fallbackEligible: urgent || blocked,
    });
  }
  if (input.execution?.checkoutInstructionsStatus === 'failed') {
    blockers.push({
      key: 'checkout_instructions_failed',
      title: 'Инструкции выезда не отправлены',
      reason: input.execution.failureReason ?? 'Нужно вручную проверить инструкции для гостя.',
      fallbackEligible: true,
    });
  }
  if (input.execution?.checkoutConfirmationStatus === 'missed') {
    blockers.push({
      key: 'checkout_missed',
      title: 'Гость не подтвердил выезд',
      reason: input.execution.failureReason ?? 'Срок выезда прошёл без подтверждения.',
      fallbackEligible: true,
    });
  }
  if (input.execution?.inspectionStatus === 'issue_found' || input.execution?.inspectionStatus === 'failed') {
    blockers.push({
      key: 'inspection_problem',
      title: 'Проблема после осмотра',
      reason: input.execution.failureReason ?? 'Осмотр выявил проблему.',
      fallbackEligible: true,
    });
  }
  if (input.execution?.depositReturnStatus === 'held' || input.execution?.depositReturnStatus === 'partially_held') {
    blockers.push({
      key: 'deposit_held',
      title: 'Депозит удержан',
      reason: input.execution.failureReason ?? 'Возврат депозита заблокирован.',
      fallbackEligible: true,
    });
  }
  if (input.execution?.closureStatus === 'blocked') {
    blockers.push({
      key: 'closure_blocked',
      title: 'Закрытие заблокировано',
      reason: input.execution.failureReason ?? 'Администратор заблокировал закрытие.',
      fallbackEligible: true,
    });
  }
  return blockers;
}

function nextAction(status: InStayCheckoutStatus): string | null {
  switch (status) {
    case 'in_stay':
      return 'Следить за проживанием и готовить выезд';
    case 'guest_issue_open':
    case 'guest_issue_blocked':
      return 'Разобрать обращение гостя';
    case 'checkout_preparing':
      return 'Подготовить или поставить инструкции выезда в очередь';
    case 'checkout_instructions_queued':
      return 'Проверить черновик и отметить отправку';
    case 'checkout_pending':
      return 'Дождаться подтверждения выезда';
    case 'checked_out':
      return 'Запустить осмотр после выезда';
    case 'inspection_pending':
      return 'Дождаться результата осмотра';
    case 'inspection_done':
      return 'Подготовить возврат депозита';
    case 'deposit_return_ready':
      return 'Закрыть бронь';
    case 'ready_to_close':
      return 'Отметить бронь закрытой';
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
      channel: preferredChannel(input.record, input.channel),
      status: 'draft_ready',
      message_text: input.messageText,
      message_template_key: input.messageTemplateKey,
      metadata: {
        source: 'instay_checkout_autopilot_v1',
        bookingOpsRecordId: input.record.id,
        ...safeMetadata(input.metadata),
      },
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

export async function getInStayCheckoutStatus(bookingId: string): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  await initializeLifecycleForBooking(record.id);
  const [execution, issues, lifecycleResult, communicationResult] = await Promise.all([
    getExecutionRow(record.id),
    listIssueRows(record.id),
    getLifecycleStatus(record.id),
    listBookingOpsCommunicationsForRecord(record.id),
  ]);
  const lifecycle = lifecycleResult.lifecycle ?? null;
  const openIssues = issues.filter((item) => OPEN_ISSUE_STATUSES.has(item.status));
  const status = resolveStatus({
    execution,
    openIssues,
    lifecycleGuestCheckedIn: gateCompleted(lifecycle, 'guest_checked_in'),
    lifecycleGuestCheckedOut: gateCompleted(lifecycle, 'guest_checked_out'),
    lifecycleInspectionDone: gateCompleted(lifecycle, 'post_checkout_inspection_done'),
    lifecycleDepositReady: gateCompleted(lifecycle, 'deposit_return_ready'),
    lifecycleBookingClosed: gateCompleted(lifecycle, 'booking_closed'),
  });
  return {
    bookingId: record.id,
    status,
    execution,
    checkoutInstructionsStatus: execution?.checkoutInstructionsStatus ?? 'not_prepared',
    checkoutConfirmationStatus: execution?.checkoutConfirmationStatus ?? 'not_requested',
    inspectionStatus: execution?.inspectionStatus ?? 'not_started',
    depositReturnStatus: execution?.depositReturnStatus ?? 'not_ready',
    closureStatus: execution?.closureStatus ?? 'open',
    openIssuesCount: openIssues.length,
    openIssues,
    lifecycle,
    blockers: buildBlockers({ execution, openIssues: issues }),
    communications: communicationResult.ok ? communicationResult.communications : [],
    nextAction: nextAction(status),
    updatedAt: execution?.updatedAt ?? new Date().toISOString(),
  };
}

export async function openInStaySupportWindow(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  const snapshot = await getInStayCheckoutStatus(record.id);
  if (snapshot.status === 'not_checked_in') {
    throw new Error('guest_not_checked_in');
  }
  await upsertExecution(record.id, {
    status: 'in_stay',
    metadata: {
      source: 'instay_checkout_autopilot_v1',
      supportWindowOpenedAt: new Date().toISOString(),
      ...safeMetadata(metadata),
    },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function createGuestStayIssue(
  bookingId: string,
  issueType: string,
  severity: GuestStayIssueSeverity,
  description?: string,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  const snapshot = await getInStayCheckoutStatus(record.id);
  if (snapshot.status === 'not_checked_in') {
    throw new Error('guest_not_checked_in');
  }
  const issue = await insertIssue(record.id, {
    issue_type: issueType,
    severity,
    description,
    metadata,
  });
  if (severity === 'urgent' || severity === 'high') {
    await ensureCommunicationIntent({
      record,
      purpose: 'guest_issue_acknowledgement',
      messageTemplateKey: 'guest.stay.issue_ack.v1',
      messageText: 'Здравствуйте. Мы получили ваше обращение и уже разбираем ситуацию.',
      metadata: { issueId: issue.id, issueType },
    });
  }
  await upsertExecution(record.id, {
    status: severity === 'urgent' ? 'guest_issue_open' : undefined,
    metadata: { source: 'instay_checkout_autopilot_v1', lastIssueId: issue.id, ...safeMetadata(metadata) },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function triageGuestStayIssue(
  bookingId: string,
  issueId: string,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  const cleanAction = text(action);
  if (!cleanAction) throw new Error('issue_action_required');
  const issue = await getIssueRow(record.id, issueId);
  if (!issue) throw new Error('issue_not_found');

  let status: GuestStayIssueStatus = 'triaged';
  if (cleanAction === 'assign') status = 'assigned';
  if (cleanAction === 'block') status = 'blocked';
  if (cleanAction === 'escalate') status = 'triaged';

  await updateIssue(record.id, issueId, {
    status,
    assigned_to_type: text(metadata?.assignedToType) || text(metadata?.assigned_to_type) || issue.assignedToType,
    assigned_to_ref: text(metadata?.assignedToRef) || text(metadata?.assigned_to_ref) || issue.assignedToRef,
    metadata: { source: 'instay_checkout_autopilot_v1', triageAction: cleanAction, ...safeMetadata(metadata) },
  });

  if (cleanAction === 'acknowledge' || cleanAction === 'escalate') {
    await ensureCommunicationIntent({
      record,
      purpose: 'guest_stay_issue_followup',
      messageTemplateKey: 'guest.stay.issue_followup.v1',
      messageText: 'Здравствуйте. Мы продолжаем разбирать ваше обращение и скоро вернёмся с ответом.',
      metadata: { issueId },
    });
  }

  return getInStayCheckoutStatus(record.id);
}

export async function resolveGuestStayIssue(
  bookingId: string,
  issueId: string,
  resolution: string,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  const issue = await getIssueRow(record.id, issueId);
  if (!issue) throw new Error('issue_not_found');
  const now = new Date().toISOString();
  await updateIssue(record.id, issueId, {
    status: 'resolved',
    resolution: text(resolution) || 'Закрыто оператором',
    resolved_at: now,
    metadata: { source: 'instay_checkout_autopilot_v1', resolvedAt: now, ...safeMetadata(metadata) },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function prepareCheckoutInstructions(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  await upsertExecution(record.id, {
    status: 'checkout_preparing',
    checkout_instructions_status: 'prepared',
    metadata: { source: 'instay_checkout_autopilot_v1', preparedAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function queueCheckoutInstructions(
  bookingId: string,
  channel?: BookingOpsCommunicationChannel,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  await ensureCommunicationIntent({
    record,
    purpose: 'checkout_instructions',
    channel,
    messageTemplateKey: 'guest.checkout.instructions.v1',
    messageText: `Здравствуйте. Инструкции по выезду для объекта ${record.propertyLabel ?? record.propertyId ?? 'вашей брони'} готовы к проверке оператором.`,
    metadata,
  });
  await upsertExecution(record.id, {
    status: 'checkout_instructions_queued',
    checkout_instructions_status: 'queued',
    metadata: { source: 'instay_checkout_autopilot_v1', queuedAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function markCheckoutInstructionsSent(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  await upsertExecution(record.id, {
    status: 'checkout_pending',
    checkout_instructions_status: 'sent',
    metadata: { source: 'instay_checkout_autopilot_v1', sentAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function requestCheckoutConfirmation(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  await ensureCommunicationIntent({
    record,
    purpose: 'checkout_confirmation_request',
    messageTemplateKey: 'guest.checkout.confirmation.v1',
    messageText: 'Здравствуйте. Подтвердите, пожалуйста, время выезда и что вы готовы сдать объект.',
    metadata,
  });
  await upsertExecution(record.id, {
    status: 'checkout_pending',
    checkout_confirmation_status: 'requested',
    metadata: { source: 'instay_checkout_autopilot_v1', confirmationRequestedAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function markGuestCheckedOut(
  bookingId: string,
  actualCheckoutAt?: string | Date | null,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  const checkoutAt = actualCheckoutAt ? new Date(actualCheckoutAt).toISOString() : new Date().toISOString();
  await completeGate(record.id, 'guest_checked_out', {
    source: 'instay_checkout_autopilot_v1',
    ...safeMetadata(metadata),
  });
  await upsertExecution(record.id, {
    status: 'checked_out',
    checkout_confirmation_status: 'confirmed',
    actual_checkout_at: checkoutAt,
    metadata: { source: 'instay_checkout_autopilot_v1', checkedOutAt: checkoutAt, ...safeMetadata(metadata) },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function triggerPostCheckoutInspection(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  await markGateInProgress(record.id, 'post_checkout_inspection_done', {
    source: 'instay_checkout_autopilot_v1',
    ...safeMetadata(metadata),
  });
  await ensureCommunicationIntent({
    record,
    purpose: 'inspection_request',
    channel: 'internal',
    messageTemplateKey: 'operator.checkout.inspection.v1',
    messageText: `Запрос осмотра после выезда: ${record.propertyLabel ?? record.propertyId ?? record.id}`,
    metadata,
  });
  await upsertExecution(record.id, {
    status: 'inspection_pending',
    inspection_status: 'scheduled',
    metadata: { source: 'instay_checkout_autopilot_v1', inspectionTriggeredAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function markPostCheckoutInspectionDone(
  bookingId: string,
  result: string,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  const cleanResult = text(result) || 'ok';
  const inspectionStatus: CheckoutInspectionStatus =
    cleanResult === 'issue_found' ? 'issue_found'
      : cleanResult === 'failed' ? 'failed'
        : 'done';

  if (inspectionStatus === 'done') {
    await completeGate(record.id, 'post_checkout_inspection_done', {
      source: 'instay_checkout_autopilot_v1',
      result: cleanResult,
      ...safeMetadata(metadata),
    });
  } else {
    await blockGate(record.id, 'post_checkout_inspection_done', `Осмотр: ${cleanResult}`, {
      source: 'instay_checkout_autopilot_v1',
      result: cleanResult,
      ...safeMetadata(metadata),
    });
  }

  await upsertExecution(record.id, {
    status: inspectionStatus === 'done' ? 'inspection_done' : 'inspection_pending',
    inspection_status: inspectionStatus,
    failure_reason: inspectionStatus === 'done' ? null : `Осмотр: ${cleanResult}`,
    metadata: { source: 'instay_checkout_autopilot_v1', inspectionDoneAt: new Date().toISOString(), result: cleanResult, ...safeMetadata(metadata) },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function markDepositReturnReady(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  await completeGate(record.id, 'deposit_return_ready', {
    source: 'instay_checkout_autopilot_v1',
    ...safeMetadata(metadata),
  });
  await ensureCommunicationIntent({
    record,
    purpose: 'deposit_return_readiness_notice',
    messageTemplateKey: 'guest.checkout.deposit_ready.v1',
    messageText: 'Здравствуйте. Возврат депозита подготовлен. Детали уточнит оператор.',
    metadata,
  });
  await upsertExecution(record.id, {
    status: 'deposit_return_ready',
    deposit_return_status: 'ready',
    closure_status: 'ready_to_close',
    metadata: { source: 'instay_checkout_autopilot_v1', depositReadyAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function markBookingClosed(
  bookingId: string,
  metadata?: Record<string, unknown>,
): Promise<InStayCheckoutSnapshot> {
  const record = await loadRecord(bookingId);
  await completeGate(record.id, 'booking_closed', {
    source: 'instay_checkout_autopilot_v1',
    ...safeMetadata(metadata),
  });
  await upsertExecution(record.id, {
    status: 'closed',
    closure_status: 'closed',
    metadata: { source: 'instay_checkout_autopilot_v1', closedAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return getInStayCheckoutStatus(record.id);
}

export async function getCheckoutBlockers(bookingId: string): Promise<InStayCheckoutBlocker[]> {
  return (await getInStayCheckoutStatus(bookingId)).blockers;
}

export async function createCheckoutFallbackIfNeeded(
  bookingId: string,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<{ ok: boolean; created: boolean; snapshot: InStayCheckoutSnapshot; error?: string }> {
  const snapshot = await getInStayCheckoutStatus(bookingId);
  const blocker = snapshot.blockers.find((item) => item.fallbackEligible);
  if (!blocker) return { ok: true, created: false, snapshot };
  const cleanReason = text(reason) || blocker.reason;
  const gateKey =
    blocker.key.startsWith('issue_') ? 'guest_checked_out'
      : blocker.key === 'deposit_held' ? 'deposit_return_ready'
        : blocker.key === 'inspection_problem' ? 'post_checkout_inspection_done'
          : 'guest_checked_out';
  const result = await blockGate(bookingId, gateKey, cleanReason, {
    source: 'instay_checkout_autopilot_v1',
    blocker: blocker.key,
    ...safeMetadata(metadata),
  });
  if (!result.ok) return { ok: false, created: false, snapshot, error: result.error };
  await upsertExecution(bookingId, {
    status: 'blocked',
    closure_status: 'blocked',
    failure_reason: cleanReason,
    metadata: { source: 'instay_checkout_autopilot_v1', fallbackAt: new Date().toISOString(), ...safeMetadata(metadata) },
  });
  return { ok: true, created: true, snapshot: await getInStayCheckoutStatus(bookingId) };
}

export async function runInStayCheckoutAction(input: {
  bookingId: string;
  action: string;
  channel?: BookingOpsCommunicationChannel;
  reason?: unknown;
  note?: unknown;
  issueId?: unknown;
  issueType?: unknown;
  severity?: unknown;
  description?: unknown;
  resolution?: unknown;
  result?: unknown;
  actualCheckoutAt?: unknown;
  metadata?: Record<string, unknown>;
}): Promise<InStayCheckoutSnapshot> {
  const bookingId = text(input.bookingId);
  const reason = text(input.reason);
  const note = text(input.note);
  const issueId = text(input.issueId);
  switch (input.action) {
    case 'open_support_window':
      return openInStaySupportWindow(bookingId, input.metadata);
    case 'create_guest_issue':
      return createGuestStayIssue(
        bookingId,
        text(input.issueType) || 'general',
        (text(input.severity) || 'medium') as GuestStayIssueSeverity,
        text(input.description) || undefined,
        input.metadata,
      );
    case 'triage_guest_issue':
      if (!issueId) throw new Error('issue_id_required');
      return triageGuestStayIssue(bookingId, issueId, reason || 'triage', input.metadata);
    case 'resolve_guest_issue':
      if (!issueId) throw new Error('issue_id_required');
      return resolveGuestStayIssue(bookingId, issueId, text(input.resolution) || reason || note || 'Закрыто', input.metadata);
    case 'prepare_checkout_instructions':
      return prepareCheckoutInstructions(bookingId, input.metadata);
    case 'queue_checkout_instructions':
      return queueCheckoutInstructions(bookingId, input.channel, input.metadata);
    case 'mark_checkout_instructions_sent':
      return markCheckoutInstructionsSent(bookingId, input.metadata);
    case 'request_checkout_confirmation':
      return requestCheckoutConfirmation(bookingId, input.metadata);
    case 'mark_guest_checked_out':
      return markGuestCheckedOut(bookingId, text(input.actualCheckoutAt) || null, input.metadata);
    case 'trigger_post_checkout_inspection':
      return triggerPostCheckoutInspection(bookingId, input.metadata);
    case 'mark_post_checkout_inspection_done':
      return markPostCheckoutInspectionDone(bookingId, text(input.result) || 'ok', input.metadata);
    case 'mark_deposit_return_ready':
      return markDepositReturnReady(bookingId, input.metadata);
    case 'mark_booking_closed':
      return markBookingClosed(bookingId, input.metadata);
    case 'create_fallback':
      return (await createCheckoutFallbackIfNeeded(bookingId, reason || 'Нужен ручной план выезда', input.metadata)).snapshot;
    case 'add_note': {
      const current = await getExecutionRow(bookingId);
      const notes = Array.isArray(current?.metadata.notes) ? current.metadata.notes : [];
      await upsertExecution(bookingId, {
        metadata: {
          source: 'instay_checkout_autopilot_v1',
          notes: [...notes, { text: note || reason, createdAt: new Date().toISOString() }].filter((item) => text((item as { text?: unknown }).text)),
        },
      });
      return getInStayCheckoutStatus(bookingId);
    }
    default:
      throw new Error('invalid_action');
  }
}
