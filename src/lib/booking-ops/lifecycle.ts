import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import type { BookingOpsRecord } from './types';
import type { BookingOpsTask, BookingOpsTaskType } from './task-types';
import {
  BOOKING_LIFECYCLE_GATE_KEYS,
  BOOKING_LIFECYCLE_SOURCES,
  BOOKING_LIFECYCLE_STATUSES,
  type BookingLifecycleException,
  type BookingLifecycleGate,
  type BookingLifecycleGateKey,
  type BookingLifecycleSnapshot,
  type BookingLifecycleSource,
  type BookingLifecycleStatus,
} from './lifecycle-types';

export {
  BOOKING_LIFECYCLE_GATE_KEYS,
  BOOKING_LIFECYCLE_GATE_LABELS_RU,
  BOOKING_LIFECYCLE_SOURCES,
  BOOKING_LIFECYCLE_STATUS_LABELS_RU,
  BOOKING_LIFECYCLE_STATUSES,
} from './lifecycle-types';
export type {
  BookingLifecycleException,
  BookingLifecycleGate,
  BookingLifecycleGateKey,
  BookingLifecycleSnapshot,
  BookingLifecycleSource,
  BookingLifecycleStatus,
} from './lifecycle-types';

type GateRow = {
  id: string;
  booking_id: string;
  gate_key: BookingLifecycleGateKey;
  status: BookingLifecycleStatus;
  source: BookingLifecycleSource;
  updated_at: string;
  completed_at: string | null;
  reason: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
};

type ExceptionRow = {
  id: string;
  booking_id: string;
  gate_key: BookingLifecycleGateKey;
  status: 'open' | 'resolved';
  reason: string;
  source: BookingLifecycleSource;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function isLifecycleStatus(value: unknown): value is BookingLifecycleStatus {
  return (BOOKING_LIFECYCLE_STATUSES as readonly string[]).includes(text(value));
}

function isLifecycleGateKey(value: unknown): value is BookingLifecycleGateKey {
  return (BOOKING_LIFECYCLE_GATE_KEYS as readonly string[]).includes(text(value));
}

function isLifecycleSource(value: unknown): value is BookingLifecycleSource {
  return (BOOKING_LIFECYCLE_SOURCES as readonly string[]).includes(text(value));
}

function mapGate(row: GateRow): BookingLifecycleGate {
  return {
    id: row.id,
    bookingId: row.booking_id,
    gateKey: row.gate_key,
    status: row.status,
    source: row.source,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    reason: text(row.reason) || null,
    note: text(row.note) || null,
    metadata: row.metadata ?? {},
  };
}

function mapException(row: ExceptionRow): BookingLifecycleException {
  return {
    id: row.id,
    bookingId: row.booking_id,
    gateKey: row.gate_key,
    status: row.status,
    reason: row.reason,
    source: row.source,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

async function listGates(bookingId: string): Promise<BookingLifecycleGate[]> {
  const { data, error } = await supabase
    .from('booking_lifecycle_gates')
    .select('*')
    .eq('booking_id', bookingId)
    .order('updated_at', { ascending: true });
  if (error) return [];
  const byKey = new Map(((data ?? []) as GateRow[]).map((row) => [row.gate_key, mapGate(row)]));
  return BOOKING_LIFECYCLE_GATE_KEYS.flatMap((gateKey) => {
    const gate = byKey.get(gateKey);
    return gate ? [gate] : [];
  });
}

async function listOpenExceptions(bookingId: string): Promise<BookingLifecycleException[]> {
  const { data, error } = await supabase
    .from('booking_lifecycle_exceptions')
    .select('*')
    .eq('booking_id', bookingId)
    .eq('status', 'open')
    .order('updated_at', { ascending: false });
  if (error) return [];
  return ((data ?? []) as ExceptionRow[]).map(mapException);
}

async function ensureException(input: {
  bookingId: string;
  gateKey: BookingLifecycleGateKey;
  reason: string;
  source: BookingLifecycleSource;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('booking_lifecycle_exceptions')
    .upsert({
      id: randomUUID(),
      booking_id: input.bookingId,
      gate_key: input.gateKey,
      status: 'open',
      reason: input.reason,
      source: input.source,
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
      resolved_at: null,
    }, { onConflict: 'booking_id,gate_key' });
}

async function resolveException(bookingId: string, gateKey: BookingLifecycleGateKey): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('booking_lifecycle_exceptions')
    .update({ status: 'resolved', updated_at: now, resolved_at: now })
    .eq('booking_id', bookingId)
    .eq('gate_key', gateKey)
    .eq('status', 'open');
}

export async function initializeLifecycleForBooking(bookingId: string): Promise<{
  ok: boolean;
  gates?: BookingLifecycleGate[];
  error?: string;
}> {
  const id = text(bookingId);
  if (!id) return { ok: false, error: 'booking_id_required' };
  const now = new Date().toISOString();
  const rows = BOOKING_LIFECYCLE_GATE_KEYS.map((gateKey) => ({
    id: randomUUID(),
    booking_id: id,
    gate_key: gateKey,
    status: gateKey === 'booking_received' ? 'completed' as const : 'pending' as const,
    source: 'system' as const,
    updated_at: now,
    completed_at: gateKey === 'booking_received' ? now : null,
    reason: null,
    note: null,
    metadata: {},
  }));
  const { error } = await supabase
    .from('booking_lifecycle_gates')
    .upsert(rows, { onConflict: 'booking_id,gate_key', ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, gates: await listGates(id) };
}

async function updateGate(input: {
  bookingId: string;
  gateKey: BookingLifecycleGateKey;
  status: BookingLifecycleStatus;
  source?: BookingLifecycleSource;
  reason?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; gate?: BookingLifecycleGate; error?: string }> {
  const id = text(input.bookingId);
  if (!id) return { ok: false, error: 'booking_id_required' };
  await initializeLifecycleForBooking(id);
  const now = new Date().toISOString();
  const source = input.source ?? 'system';
  const row = {
    booking_id: id,
    gate_key: input.gateKey,
    status: input.status,
    source,
    updated_at: now,
    completed_at: input.status === 'completed' ? now : null,
    reason: text(input.reason) || null,
    note: text(input.note) || null,
    metadata: input.metadata ?? {},
  };
  const { data, error } = await supabase
    .from('booking_lifecycle_gates')
    .upsert(row, { onConflict: 'booking_id,gate_key' })
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'gate_update_failed' };
  if (input.status === 'blocked' || input.status === 'failed') {
    await ensureException({
      bookingId: id,
      gateKey: input.gateKey,
      reason: text(input.reason) || input.status,
      source,
      metadata: input.metadata,
    });
  } else if (input.status === 'completed' || input.status === 'skipped') {
    await resolveException(id, input.gateKey);
  }
  return { ok: true, gate: mapGate(data as GateRow) };
}

export async function markGateInProgress(
  bookingId: string,
  gateKey: BookingLifecycleGateKey,
  metadata?: Record<string, unknown>,
): Promise<{ ok: boolean; gate?: BookingLifecycleGate; error?: string }> {
  return updateGate({ bookingId, gateKey, status: 'in_progress', metadata });
}

export async function completeGate(
  bookingId: string,
  gateKey: BookingLifecycleGateKey,
  metadata?: Record<string, unknown>,
): Promise<{ ok: boolean; gate?: BookingLifecycleGate; error?: string }> {
  return updateGate({ bookingId, gateKey, status: 'completed', metadata });
}

export async function blockGate(
  bookingId: string,
  gateKey: BookingLifecycleGateKey,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<{ ok: boolean; gate?: BookingLifecycleGate; error?: string }> {
  return updateGate({ bookingId, gateKey, status: 'blocked', reason, metadata });
}

export async function skipGate(
  bookingId: string,
  gateKey: BookingLifecycleGateKey,
  reason?: string,
): Promise<{ ok: boolean; gate?: BookingLifecycleGate; error?: string }> {
  return updateGate({ bookingId, gateKey, status: 'skipped', reason: reason ?? null });
}

export async function adminUpdateLifecycleGate(input: {
  bookingId: string;
  gateKey: unknown;
  status: unknown;
  reason?: unknown;
  note?: unknown;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; gate?: BookingLifecycleGate; error?: string }> {
  if (!isLifecycleGateKey(input.gateKey)) return { ok: false, error: 'invalid_gate_key' };
  if (!isLifecycleStatus(input.status)) return { ok: false, error: 'invalid_status' };
  return updateGate({
    bookingId: input.bookingId,
    gateKey: input.gateKey,
    status: input.status,
    source: 'admin',
    reason: text(input.reason) || null,
    note: text(input.note) || null,
    metadata: input.metadata ?? {},
  });
}

export function getBookingReadinessScoreFromGates(gates: BookingLifecycleGate[]): number {
  if (gates.length === 0) return 0;
  const done = gates.filter((gate) => gate.status === 'completed' || gate.status === 'skipped').length;
  return Math.round((done / gates.length) * 100);
}

export async function getBookingReadinessScore(bookingId: string): Promise<number> {
  await initializeLifecycleForBooking(bookingId);
  return getBookingReadinessScoreFromGates(await listGates(bookingId));
}

export async function getBlockedGates(bookingId: string): Promise<BookingLifecycleGate[]> {
  await initializeLifecycleForBooking(bookingId);
  return (await listGates(bookingId)).filter((gate) => gate.status === 'blocked' || gate.status === 'failed');
}

export async function getNextRequiredGates(bookingId: string): Promise<BookingLifecycleGate[]> {
  await initializeLifecycleForBooking(bookingId);
  return (await listGates(bookingId))
    .filter((gate) => gate.status === 'pending' || gate.status === 'in_progress')
    .slice(0, 5);
}

export async function getLifecycleStatus(bookingId: string): Promise<{
  ok: boolean;
  lifecycle?: BookingLifecycleSnapshot;
  error?: string;
}> {
  const id = text(bookingId);
  if (!id) return { ok: false, error: 'booking_id_required' };
  const initialized = await initializeLifecycleForBooking(id);
  if (!initialized.ok) return { ok: false, error: initialized.error };
  const gates = initialized.gates ?? await listGates(id);
  const blockedGates = gates.filter((gate) => gate.status === 'blocked' || gate.status === 'failed');
  const nextRequiredGates = gates
    .filter((gate) => gate.status === 'pending' || gate.status === 'in_progress')
    .slice(0, 5);
  return {
    ok: true,
    lifecycle: {
      bookingId: id,
      gates,
      readinessScore: getBookingReadinessScoreFromGates(gates),
      currentActiveGate: nextRequiredGates[0] ?? null,
      blockedGates,
      completedGates: gates.filter((gate) => gate.status === 'completed'),
      nextRequiredGates,
      exceptions: await listOpenExceptions(id),
    },
  };
}

const TASK_GATE_MAP: Partial<Record<BookingOpsTaskType, BookingLifecycleGateKey>> = {
  request_guest_documents: 'documents_requested',
  verify_guest_documents: 'documents_verified',
  prepare_contract: 'contract_prepared',
  send_contract_manual: 'contract_sent',
  follow_up_contract_signature: 'contract_signed',
  request_deposit: 'deposit_requested',
  confirm_deposit: 'deposit_received',
  prepare_mvd_report: 'mvd_report_prepared',
  submit_mvd_report: 'mvd_report_submitted',
  cleaning_needed: 'cleaning_scheduled',
  cleaning_assigned: 'cleaning_scheduled',
  linen_pickup_needed: 'linen_scheduled',
  linen_replaced: 'linen_scheduled',
  laundry_dropoff_needed: 'linen_scheduled',
  laundry_return_needed: 'linen_scheduled',
  unit_inspection_needed: 'inspection_scheduled',
  inspection_needed: 'inspection_scheduled',
  maintenance_needed: 'maintenance_required',
  unit_ready_for_next_guest: 'property_ready',
  unit_ready_confirmation: 'property_ready',
  checkout_confirmed: 'guest_checked_out',
  track_deposit_return: 'deposit_return_ready',
};

export async function syncLifecycleFromTask(task: BookingOpsTask): Promise<void> {
  const gateKey = TASK_GATE_MAP[task.taskType];
  if (!gateKey) return;
  const metadata = { taskId: task.id, taskType: task.taskType, taskStatus: task.status };
  if (task.status === 'blocked') {
    await blockGate(task.bookingOpsRecordId, gateKey, task.description ?? 'Задача заблокирована', metadata);
    return;
  }
  if (task.status === 'completed') {
    await completeGate(task.bookingOpsRecordId, gateKey, metadata);
    if (task.taskType === 'maintenance_needed') {
      await completeGate(task.bookingOpsRecordId, 'maintenance_resolved', metadata);
    }
    if (task.taskType === 'unit_inspection_needed' || task.taskType === 'inspection_needed') {
      await completeGate(task.bookingOpsRecordId, 'post_checkout_inspection_done', metadata);
    }
    return;
  }
  if (task.status === 'in_progress') {
    await markGateInProgress(task.bookingOpsRecordId, gateKey, metadata);
    return;
  }
  if (task.status === 'open') {
    await completeGate(task.bookingOpsRecordId, gateKey, metadata);
  }
}

export async function syncLifecycleFromBookingOpsRecord(record: BookingOpsRecord): Promise<void> {
  const metadata = { sourceBookingId: record.bookingId };
  await initializeLifecycleForBooking(record.id);
  if (record.guestIntake?.intakeStatus === 'waiting_for_guest') {
    await markGateInProgress(record.id, 'guest_data_requested', metadata);
  }
  if (record.guestIntake?.intakeStatus === 'completed') {
    await completeGate(record.id, 'guest_data_completed', metadata);
  }
  if (record.guestIntake?.intakeStatus === 'fallback_required') {
    await blockGate(record.id, 'guest_data_completed', record.guestIntake.fallbackReason ?? 'Гость не может завершить ввод данных', metadata);
  }
  if (record.documentsStatus === 'requested') await completeGate(record.id, 'documents_requested', metadata);
  if (record.documentsStatus === 'received') await completeGate(record.id, 'documents_received', metadata);
  if (record.documentsStatus === 'verified') {
    await completeGate(record.id, 'documents_received', metadata);
    await completeGate(record.id, 'documents_verified', metadata);
  }
  if (record.documentsStatus === 'problem') await blockGate(record.id, 'documents_received', 'Проблема с документами', metadata);
  if (record.contractStatus === 'prepared') await completeGate(record.id, 'contract_prepared', metadata);
  if (record.contractStatus === 'sent') await completeGate(record.id, 'contract_sent', metadata);
  if (record.contractStatus === 'signed') {
    await completeGate(record.id, 'contract_prepared', metadata);
    await completeGate(record.id, 'contract_sent', metadata);
    await completeGate(record.id, 'contract_signed', metadata);
  }
  if (record.depositStatus === 'requested') await completeGate(record.id, 'deposit_requested', metadata);
  if (record.depositStatus === 'confirmed') {
    await completeGate(record.id, 'deposit_requested', metadata);
    await completeGate(record.id, 'deposit_received', metadata);
  }
  if (record.mvdStatus === 'prepared') await completeGate(record.id, 'mvd_report_prepared', metadata);
  if (record.mvdStatus === 'submitted') {
    await completeGate(record.id, 'mvd_report_prepared', metadata);
    await completeGate(record.id, 'mvd_report_submitted', metadata);
  }
  if (record.checkinReadinessStatus === 'ready') await completeGate(record.id, 'checkin_instructions_sent', metadata);
  if (record.unitReadinessStatus === 'ready') await completeGate(record.id, 'property_ready', metadata);
  if (record.isBlocked || record.opsStatus === 'problem_blocked') {
    await blockGate(record.id, 'booking_closed', record.blockerReason ?? 'Бронь заблокирована', metadata);
  }
}
