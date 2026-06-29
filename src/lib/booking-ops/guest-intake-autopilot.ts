import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { recordBookingOpsEvent } from './events';
import { createBookingOpsTask } from './tasks';
import {
  evaluateGuestIntakeState,
  type GuestIntakeStatePlan,
} from './guest-intake-state';
import type {
  BookingOpsGuestIntakeSession,
  BookingOpsGuestIntakeStatus,
  BookingOpsRecord,
} from './types';

type GuestIntakeRow = {
  id: string;
  booking_ops_record_id: string;
  booking_id: string | null;
  intake_status: BookingOpsGuestIntakeStatus;
  missing_fields: string[] | null;
  collected_fields: Record<string, unknown> | null;
  validation_errors: string[] | null;
  channel: 'telegram' | 'web' | 'manual';
  guest_contact_ref: string | null;
  last_guest_activity_at: string | null;
  fallback_reason: string | null;
  generated_message: string | null;
  created_at: string;
  updated_at: string;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function mapRow(row: GuestIntakeRow): BookingOpsGuestIntakeSession {
  return {
    id: row.id,
    bookingOpsRecordId: row.booking_ops_record_id,
    bookingId: text(row.booking_id) || null,
    intakeStatus: row.intake_status,
    missingFields: row.missing_fields ?? [],
    collectedFields: row.collected_fields ?? {},
    validationErrors: row.validation_errors ?? [],
    channel: row.channel,
    guestContactRef: text(row.guest_contact_ref) || null,
    lastGuestActivityAt: row.last_guest_activity_at,
    fallbackReason: text(row.fallback_reason) || null,
    generatedMessage: text(row.generated_message) || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getGuestIntakeSessionForRecord(
  bookingOpsRecordId: string,
): Promise<BookingOpsGuestIntakeSession | null> {
  const recordId = text(bookingOpsRecordId);
  if (!recordId) return null;
  const { data, error } = await supabase
    .from('booking_ops_guest_intake_sessions')
    .select('*')
    .eq('booking_ops_record_id', recordId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data as GuestIntakeRow);
}

export async function getGuestIntakeSessionsForRecords(
  bookingOpsRecordIds: string[],
): Promise<Map<string, BookingOpsGuestIntakeSession>> {
  const ids = [...new Set(bookingOpsRecordIds.map(text).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('booking_ops_guest_intake_sessions')
    .select('*')
    .in('booking_ops_record_id', ids)
    .order('updated_at', { ascending: false });
  if (error || !data) return new Map();
  const result = new Map<string, BookingOpsGuestIntakeSession>();
  for (const row of data as GuestIntakeRow[]) {
    if (!result.has(row.booking_ops_record_id)) result.set(row.booking_ops_record_id, mapRow(row));
  }
  return result;
}

function hasPlanChanged(
  existing: BookingOpsGuestIntakeSession,
  plan: GuestIntakeStatePlan,
): boolean {
  return (
    existing.intakeStatus !== plan.intakeStatus
    || JSON.stringify(existing.missingFields) !== JSON.stringify(plan.missingFields)
    || JSON.stringify(existing.validationErrors) !== JSON.stringify(plan.validationErrors)
    || existing.channel !== plan.channel
    || existing.guestContactRef !== plan.guestContactRef
    || existing.fallbackReason !== plan.fallbackReason
    || existing.generatedMessage !== plan.generatedMessage
  );
}

function eventTypeForStatus(status: BookingOpsGuestIntakeStatus): Parameters<typeof recordBookingOpsEvent>[0]['eventType'] {
  if (status === 'completed') return 'guest_intake_completed';
  if (status === 'fallback_required' || status === 'expired') return 'guest_intake_fallback_required';
  if (status === 'waiting_for_guest' || status === 'partially_completed') {
    return 'guest_intake_waiting_for_guest';
  }
  return 'guest_intake_updated';
}

async function recordIntakeEvent(input: {
  recordId: string;
  session: BookingOpsGuestIntakeSession;
  created: boolean;
}): Promise<void> {
  const eventType = input.created ? 'guest_intake_started' : eventTypeForStatus(input.session.intakeStatus);
  const title =
    eventType === 'guest_intake_completed'
      ? 'Данные гостя собраны'
      : eventType === 'guest_intake_fallback_required'
        ? 'Требуется ручная помощь гостю'
        : eventType === 'guest_intake_started'
          ? 'Запущен сбор данных гостя'
          : 'Сбор данных гостя обновлён';
  await recordBookingOpsEvent({
    bookingOpsRecordId: input.recordId,
    eventType,
    title,
    description: 'Состояние сбора данных гостя обновлено без записи документов в историю.',
    actorType: 'system',
    metadata: {
      guestIntakeSessionId: input.session.id,
      guestIntakeStatus: input.session.intakeStatus,
      fallbackReason: input.session.fallbackReason,
      missingCount: input.session.missingFields.length,
    },
    dedupeKey: `guest-intake:${input.session.id}:${eventType}:${input.session.updatedAt}`,
  });
}

async function ensureFallbackTask(
  record: BookingOpsRecord,
  session: BookingOpsGuestIntakeSession,
): Promise<void> {
  if (session.intakeStatus !== 'fallback_required' && session.intakeStatus !== 'validation_needed') {
    return;
  }
  await createBookingOpsTask({
    bookingOpsRecordId: record.id,
    bookingId: record.bookingId,
    taskType: 'guest_intake_operator_fallback',
    title: session.fallbackReason ?? 'Требуется ручная помощь гостю',
    description: session.fallbackReason ?? 'Гость не может завершить ввод данных самостоятельно.',
    priority: session.intakeStatus === 'validation_needed' ? 'normal' : 'high',
    source: 'system',
    metadata: {
      guestIntakeSessionId: session.id,
      guestIntakeStatus: session.intakeStatus,
      fallbackReason: session.fallbackReason,
    },
  });
}

export async function syncGuestIntakeAutopilot(record: BookingOpsRecord): Promise<{
  ok: boolean;
  session?: BookingOpsGuestIntakeSession;
  plan: GuestIntakeStatePlan;
  error?: string;
}> {
  const existing = await getGuestIntakeSessionForRecord(record.id);
  const plan = evaluateGuestIntakeState({ record, existingSession: existing });
  const now = new Date().toISOString();
  try {
    if (!existing) {
      const { data, error } = await supabase
        .from('booking_ops_guest_intake_sessions')
        .insert({
          id: randomUUID(),
          booking_ops_record_id: record.id,
          booking_id: record.bookingId,
          intake_status: plan.intakeStatus,
          missing_fields: plan.missingFields,
          collected_fields: plan.collectedFields,
          validation_errors: plan.validationErrors,
          channel: plan.channel,
          guest_contact_ref: plan.guestContactRef,
          fallback_reason: plan.fallbackReason,
          generated_message: plan.generatedMessage,
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single();
      if (error || !data) return { ok: false, plan, error: error?.message ?? 'guest_intake_create_failed' };
      const session = mapRow(data as GuestIntakeRow);
      await recordIntakeEvent({ recordId: record.id, session, created: true });
      await ensureFallbackTask(record, session);
      return { ok: true, session, plan };
    }

    if (!hasPlanChanged(existing, plan)) {
      await ensureFallbackTask(record, existing);
      return { ok: true, session: existing, plan };
    }

    const { data, error } = await supabase
      .from('booking_ops_guest_intake_sessions')
      .update({
        intake_status: plan.intakeStatus,
        missing_fields: plan.missingFields,
        collected_fields: plan.collectedFields,
        validation_errors: plan.validationErrors,
        channel: plan.channel,
        guest_contact_ref: plan.guestContactRef,
        fallback_reason: plan.fallbackReason,
        generated_message: plan.generatedMessage,
        updated_at: now,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error || !data) return { ok: false, plan, error: error?.message ?? 'guest_intake_update_failed' };
    const session = mapRow(data as GuestIntakeRow);
    await recordIntakeEvent({ recordId: record.id, session, created: false });
    await ensureFallbackTask(record, session);
    return { ok: true, session, plan };
  } catch (error) {
    return { ok: false, plan, error: error instanceof Error ? error.message : 'guest_intake_sync_failed' };
  }
}
