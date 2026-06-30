import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { text as cleanText } from '@/lib/pilot-data/test-markers';
import { attachBookingOpsAlerts } from './alerts';
import { attachBookingReadiness, fetchTelegramDraftStatusesForRecord } from './readiness';
import { applyBookingOpsTaskSync } from './tasks';
import {
  getGuestIntakeSessionForRecord,
  getGuestIntakeSessionsForRecords,
  syncGuestIntakeAutopilot,
} from './guest-intake-autopilot';
import { recordBookingOpsEvent, type BookingOpsEventActorType } from './events';
import { initializeLifecycleForBooking, syncLifecycleFromBookingOpsRecord } from './lifecycle';
import { lookupPropertyKnowledge, lookupPropertyKnowledgeBatch } from './property-knowledge';
import type {
  BookingOpsRecord,
  CreateBookingOpsInput,
  UpdateBookingOpsInput,
} from './types';
import {
  normalizeBookingOpsCheckinReadinessStatus,
  normalizeBookingOpsContractIntakeStatus,
  normalizeBookingOpsContractProvider,
  normalizeBookingOpsContractStatus,
  normalizeBookingOpsDepositIntakeStatus,
  normalizeBookingOpsDepositStatus,
  normalizeBookingOpsDocumentVerificationStatus,
  normalizeBookingOpsDocumentsStatus,
  normalizeBookingOpsMvdDataStatus,
  normalizeBookingOpsMvdStatus,
  normalizeBookingOpsStatus,
  normalizeBookingOpsUnitReadinessStatus,
  DEFAULT_BOOKING_OPS_INTAKE,
} from './types';

type BookingOpsRow = {
  id: string;
  booking_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  guest_telegram: string | null;
  property_id: string | null;
  property_label: string | null;
  ota_source: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  ops_status: string;
  manual_next_action: string | null;
  is_blocked: boolean;
  blocker_reason: string | null;
  documents_status: string;
  contract_status: string;
  deposit_status: string;
  mvd_status: string;
  checkin_readiness_status: string;
  unit_readiness_status: string;
  notes: string | null;
  guest_count: number | null;
  payment_status: string | null;
  document_required: boolean | null;
  document_collected: boolean | null;
  document_verification_status: string | null;
  document_notes: string | null;
  contract_required: boolean | null;
  contract_provider: string | null;
  contract_intake_status: string | null;
  contract_link: string | null;
  contract_notes: string | null;
  deposit_required: boolean | null;
  deposit_amount: number | null;
  deposit_intake_status: string | null;
  deposit_payment_method: string | null;
  deposit_notes: string | null;
  mvd_required: boolean | null;
  mvd_data_status: string | null;
  mvd_confirmation_link: string | null;
  mvd_notes: string | null;
  created_at: string;
  updated_at: string;
};

function text(value: unknown): string {
  return cleanText(value);
}

function toIsoDate(value: string | null | undefined): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function attachAutomation(record: BookingOpsRecord): BookingOpsRecord {
  return attachBookingOpsAlerts(record);
}

async function attachReadiness(record: BookingOpsRecord): Promise<BookingOpsRecord> {
  const drafts = await fetchTelegramDraftStatusesForRecord(record.id);
  return attachBookingReadiness(record, drafts);
}

async function enrichRecord(record: BookingOpsRecord): Promise<BookingOpsRecord> {
  const lookup = await lookupPropertyKnowledge({
    propertyId: record.propertyId,
    propertyLabel: record.propertyLabel,
  });
  const withAutomation = attachAutomation({
    ...record,
    propertyKnowledge: lookup.knowledge,
    propertyKnowledgeMatch: lookup.match,
  });
  const withReadiness = await attachReadiness(withAutomation);
  const guestIntake = await getGuestIntakeSessionForRecord(record.id);
  return { ...withReadiness, guestIntake };
}

async function enrichRecordWithTaskSync(record: BookingOpsRecord): Promise<BookingOpsRecord> {
  const enriched = await enrichRecord(record);
  await applyBookingOpsTaskSync(enriched);
  const intake = await syncGuestIntakeAutopilot(enriched);
  const withIntake = { ...enriched, guestIntake: intake.session ?? enriched.guestIntake ?? null };
  await syncLifecycleFromBookingOpsRecord(withIntake);
  return withIntake;
}

async function enrichRecords(records: BookingOpsRecord[]): Promise<BookingOpsRecord[]> {
  const lookups = await lookupPropertyKnowledgeBatch(records.map((record) => ({
    key: record.id,
    propertyId: record.propertyId,
    propertyLabel: record.propertyLabel,
  })));
  const enriched = records.map((record) => {
    const lookup = lookups.get(record.id) ?? { knowledge: null, match: 'none' as const };
    return attachAutomation({
      ...record,
      propertyKnowledge: lookup.knowledge,
      propertyKnowledgeMatch: lookup.match,
    });
  });
  const withReadiness = await Promise.all(enriched.map((record) => attachReadiness(record)));
  const intakeSessions = await getGuestIntakeSessionsForRecords(withReadiness.map((record) => record.id));
  return withReadiness.map((record) => ({
    ...record,
    guestIntake: intakeSessions.get(record.id) ?? null,
  }));
}

function mapRow(row: BookingOpsRow): BookingOpsRecord {
  return {
    id: row.id,
    bookingId: text(row.booking_id) || null,
    guestName: text(row.guest_name) || null,
    guestPhone: text(row.guest_phone) || null,
    guestEmail: text(row.guest_email) || null,
    guestTelegram: text(row.guest_telegram) || null,
    propertyId: text(row.property_id) || null,
    propertyLabel: text(row.property_label) || null,
    otaSource: text(row.ota_source) || null,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    opsStatus: normalizeBookingOpsStatus(row.ops_status),
    manualNextAction: text(row.manual_next_action) || null,
    isBlocked: row.is_blocked === true,
    blockerReason: text(row.blocker_reason) || null,
    documentsStatus: normalizeBookingOpsDocumentsStatus(row.documents_status),
    contractStatus: normalizeBookingOpsContractStatus(row.contract_status),
    depositStatus: normalizeBookingOpsDepositStatus(row.deposit_status),
    mvdStatus: normalizeBookingOpsMvdStatus(row.mvd_status),
    checkinReadinessStatus: normalizeBookingOpsCheckinReadinessStatus(row.checkin_readiness_status),
    unitReadinessStatus: normalizeBookingOpsUnitReadinessStatus(row.unit_readiness_status),
    notes: text(row.notes) || null,
    ...DEFAULT_BOOKING_OPS_INTAKE,
    guestCount: row.guest_count ?? null,
    paymentStatus: text(row.payment_status) || null,
    documentRequired: row.document_required ?? null,
    documentCollected: row.document_collected ?? null,
    documentVerificationStatus: normalizeBookingOpsDocumentVerificationStatus(
      row.document_verification_status,
    ),
    documentNotes: text(row.document_notes) || null,
    contractRequired: row.contract_required ?? null,
    contractProvider: normalizeBookingOpsContractProvider(row.contract_provider),
    contractIntakeStatus: normalizeBookingOpsContractIntakeStatus(row.contract_intake_status),
    contractLink: text(row.contract_link) || null,
    contractNotes: text(row.contract_notes) || null,
    depositRequired: row.deposit_required ?? null,
    depositAmount: row.deposit_amount ?? null,
    depositIntakeStatus: normalizeBookingOpsDepositIntakeStatus(row.deposit_intake_status),
    depositPaymentMethod: text(row.deposit_payment_method) || null,
    depositNotes: text(row.deposit_notes) || null,
    mvdRequired: row.mvd_required ?? null,
    mvdDataStatus: normalizeBookingOpsMvdDataStatus(row.mvd_data_status),
    mvdConfirmationLink: text(row.mvd_confirmation_link) || null,
    mvdNotes: text(row.mvd_notes) || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBookingOpsRecords(options?: {
  limit?: number;
}): Promise<{ ok: boolean; records: BookingOpsRecord[]; error?: string }> {
  const limit = options?.limit ?? 200;
  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) return { ok: false, records: [], error: error.message };
  const records = await enrichRecords(((data ?? []) as BookingOpsRow[]).map(mapRow));
  return { ok: true, records };
}

export async function getBookingOpsRecord(id: string): Promise<BookingOpsRecord | null> {
  const recordId = text(id);
  if (!recordId) return null;

  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('*')
    .eq('id', recordId)
    .maybeSingle();

  if (error || !data) return null;
  return enrichRecord(mapRow(data as BookingOpsRow));
}

export async function getBookingOpsByBookingId(bookingId: string): Promise<BookingOpsRecord | null> {
  const sourceBookingId = text(bookingId);
  if (!sourceBookingId) return null;

  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('*')
    .eq('booking_id', sourceBookingId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return enrichRecord(mapRow(data as BookingOpsRow));
}

export async function createBookingOpsRecord(
  input: CreateBookingOpsInput,
  options?: { actorType?: BookingOpsEventActorType },
): Promise<{
  ok: boolean;
  record?: BookingOpsRecord;
  error?: string;
}> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const row = {
    id,
    booking_id: text(input.bookingId) || null,
    guest_name: text(input.guestName) || null,
    guest_phone: text(input.guestPhone) || null,
    guest_email: text(input.guestEmail) || null,
    guest_telegram: text(input.guestTelegram) || null,
    property_id: text(input.propertyId) || null,
    property_label: text(input.propertyLabel) || null,
    ota_source: text(input.otaSource) || null,
    check_in_at: toIsoDate(input.checkInAt),
    check_out_at: toIsoDate(input.checkOutAt),
    ops_status: normalizeBookingOpsStatus(input.opsStatus ?? 'created'),
    documents_status: normalizeBookingOpsDocumentsStatus(input.documentsStatus),
    contract_status: normalizeBookingOpsContractStatus(input.contractStatus),
    deposit_status: normalizeBookingOpsDepositStatus(input.depositStatus),
    mvd_status: normalizeBookingOpsMvdStatus(input.mvdStatus),
    checkin_readiness_status: normalizeBookingOpsCheckinReadinessStatus(input.checkinReadinessStatus),
    unit_readiness_status: normalizeBookingOpsUnitReadinessStatus(input.unitReadinessStatus),
    notes: text(input.notes) || null,
    guest_count: input.guestCount ?? null,
    payment_status: text(input.paymentStatus) || null,
    document_required: input.documentRequired ?? null,
    document_collected: input.documentCollected ?? null,
    document_verification_status: input.documentVerificationStatus ?? null,
    document_notes: text(input.documentNotes) || null,
    contract_required: input.contractRequired ?? null,
    contract_provider: input.contractProvider ?? null,
    contract_intake_status: input.contractIntakeStatus ?? null,
    contract_link: text(input.contractLink) || null,
    contract_notes: text(input.contractNotes) || null,
    deposit_required: input.depositRequired ?? null,
    deposit_amount: input.depositAmount ?? null,
    deposit_intake_status: input.depositIntakeStatus ?? null,
    deposit_payment_method: text(input.depositPaymentMethod) || null,
    deposit_notes: text(input.depositNotes) || null,
    mvd_required: input.mvdRequired ?? null,
    mvd_data_status: input.mvdDataStatus ?? null,
    mvd_confirmation_link: text(input.mvdConfirmationLink) || null,
    mvd_notes: text(input.mvdNotes) || null,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('booking_ops_records')
    .insert(row)
    .select('*')
    .single();

  if (error) return { ok: false, error: error.message };
  await recordBookingOpsEvent({
    bookingOpsRecordId: id,
    eventType: 'booking_created',
    title: 'Операционная бронь создана',
    description: 'Бронь добавлена в рабочий контур Booking Ops.',
    actorType: options?.actorType ?? 'system',
    metadata: { status: row.ops_status, source: row.ota_source ?? 'manual' },
    dedupeKey: `booking-created:${id}`,
  });
  await initializeLifecycleForBooking(id);
  const record = await enrichRecordWithTaskSync(mapRow(data as BookingOpsRow));
  return { ok: true, record };
}

export async function syncBookingOpsTasksForRecordId(
  recordId: string,
): Promise<{ ok: boolean; error?: string }> {
  const recordIdClean = text(recordId);
  if (!recordIdClean) return { ok: false, error: 'id_required' };

  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('*')
    .eq('id', recordIdClean)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'not_found' };

  const drafts = await fetchTelegramDraftStatusesForRecord(recordIdClean);
  const record = attachBookingReadiness(mapRow(data as BookingOpsRow), drafts);
  const result = await applyBookingOpsTaskSync(record);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function updateBookingOpsRecord(
  id: string,
  input: UpdateBookingOpsInput,
  options?: { actorType?: BookingOpsEventActorType },
): Promise<{ ok: boolean; record?: BookingOpsRecord; error?: string }> {
  const recordId = text(id);
  if (!recordId) return { ok: false, error: 'id_required' };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (input.bookingId !== undefined) patch.booking_id = text(input.bookingId) || null;
  if (input.guestName !== undefined) patch.guest_name = text(input.guestName) || null;
  if (input.guestPhone !== undefined) patch.guest_phone = text(input.guestPhone) || null;
  if (input.guestEmail !== undefined) patch.guest_email = text(input.guestEmail) || null;
  if (input.guestTelegram !== undefined) patch.guest_telegram = text(input.guestTelegram) || null;
  if (input.propertyId !== undefined) patch.property_id = text(input.propertyId) || null;
  if (input.propertyLabel !== undefined) patch.property_label = text(input.propertyLabel) || null;
  if (input.otaSource !== undefined) patch.ota_source = text(input.otaSource) || null;
  if (input.checkInAt !== undefined) patch.check_in_at = toIsoDate(input.checkInAt);
  if (input.checkOutAt !== undefined) patch.check_out_at = toIsoDate(input.checkOutAt);
  if (input.opsStatus !== undefined) patch.ops_status = normalizeBookingOpsStatus(input.opsStatus);
  if (input.manualNextAction !== undefined) {
    patch.manual_next_action = text(input.manualNextAction) || null;
  }
  if (input.isBlocked !== undefined) patch.is_blocked = input.isBlocked === true;
  if (input.blockerReason !== undefined) patch.blocker_reason = text(input.blockerReason) || null;
  if (input.documentsStatus !== undefined) {
    patch.documents_status = normalizeBookingOpsDocumentsStatus(input.documentsStatus);
  }
  if (input.contractStatus !== undefined) {
    patch.contract_status = normalizeBookingOpsContractStatus(input.contractStatus);
  }
  if (input.depositStatus !== undefined) {
    patch.deposit_status = normalizeBookingOpsDepositStatus(input.depositStatus);
  }
  if (input.mvdStatus !== undefined) patch.mvd_status = normalizeBookingOpsMvdStatus(input.mvdStatus);
  if (input.checkinReadinessStatus !== undefined) {
    patch.checkin_readiness_status = normalizeBookingOpsCheckinReadinessStatus(
      input.checkinReadinessStatus,
    );
  }
  if (input.unitReadinessStatus !== undefined) {
    patch.unit_readiness_status = normalizeBookingOpsUnitReadinessStatus(
      input.unitReadinessStatus,
    );
  }
  if (input.notes !== undefined) patch.notes = text(input.notes) || null;

  if (input.guestCount !== undefined) patch.guest_count = input.guestCount ?? null;
  if (input.paymentStatus !== undefined) patch.payment_status = text(input.paymentStatus) || null;
  if (input.documentRequired !== undefined) patch.document_required = input.documentRequired ?? null;
  if (input.documentCollected !== undefined) patch.document_collected = input.documentCollected ?? null;
  if (input.documentVerificationStatus !== undefined) {
    patch.document_verification_status = input.documentVerificationStatus ?? null;
  }
  if (input.documentNotes !== undefined) patch.document_notes = text(input.documentNotes) || null;
  if (input.contractRequired !== undefined) patch.contract_required = input.contractRequired ?? null;
  if (input.contractProvider !== undefined) patch.contract_provider = input.contractProvider ?? null;
  if (input.contractIntakeStatus !== undefined) {
    patch.contract_intake_status = input.contractIntakeStatus ?? null;
  }
  if (input.contractLink !== undefined) patch.contract_link = text(input.contractLink) || null;
  if (input.contractNotes !== undefined) patch.contract_notes = text(input.contractNotes) || null;
  if (input.depositRequired !== undefined) patch.deposit_required = input.depositRequired ?? null;
  if (input.depositAmount !== undefined) patch.deposit_amount = input.depositAmount ?? null;
  if (input.depositIntakeStatus !== undefined) {
    patch.deposit_intake_status = input.depositIntakeStatus ?? null;
  }
  if (input.depositPaymentMethod !== undefined) {
    patch.deposit_payment_method = text(input.depositPaymentMethod) || null;
  }
  if (input.depositNotes !== undefined) patch.deposit_notes = text(input.depositNotes) || null;
  if (input.mvdRequired !== undefined) patch.mvd_required = input.mvdRequired ?? null;
  if (input.mvdDataStatus !== undefined) patch.mvd_data_status = input.mvdDataStatus ?? null;
  if (input.mvdConfirmationLink !== undefined) {
    patch.mvd_confirmation_link = text(input.mvdConfirmationLink) || null;
  }
  if (input.mvdNotes !== undefined) patch.mvd_notes = text(input.mvdNotes) || null;

  const { data: previousData, error: previousError } = await supabase
    .from('booking_ops_records')
    .select('*')
    .eq('id', recordId)
    .maybeSingle();
  if (previousError) return { ok: false, error: previousError.message };
  if (!previousData) return { ok: false, error: 'not_found' };

  const { data, error } = await supabase
    .from('booking_ops_records')
    .update(patch)
    .eq('id', recordId)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'not_found' };
  const previous = previousData as BookingOpsRow;
  const changedKeys = Object.keys(patch).filter((key) => (
    key !== 'updated_at'
    && JSON.stringify(previous[key as keyof BookingOpsRow] ?? null)
      !== JSON.stringify(patch[key] ?? null)
  ));
  if (changedKeys.length > 0) {
    const identityKeys = new Set([
      'booking_id', 'guest_name', 'guest_phone', 'guest_email', 'guest_telegram',
      'property_id', 'property_label', 'ota_source', 'check_in_at', 'check_out_at', 'guest_count',
    ]);
    const readinessKeys = new Set([
      'payment_status', 'document_required', 'document_collected',
      'document_verification_status', 'contract_required', 'contract_provider',
      'contract_intake_status', 'deposit_required', 'deposit_amount',
      'deposit_intake_status', 'deposit_payment_method', 'mvd_required', 'mvd_data_status',
    ]);
    const statusKeys = new Set([
      'ops_status', 'documents_status', 'contract_status', 'deposit_status', 'mvd_status',
      'checkin_readiness_status', 'unit_readiness_status', 'manual_next_action', 'is_blocked', 'blocker_reason',
    ]);
    const groups = [
      identityKeys.size && changedKeys.some((key) => identityKeys.has(key)) ? 'booking_details' : null,
      readinessKeys.size && changedKeys.some((key) => readinessKeys.has(key)) ? 'readiness_inputs' : null,
      statusKeys.size && changedKeys.some((key) => statusKeys.has(key)) ? 'operational_status' : null,
      changedKeys.some((key) => key.endsWith('_notes') || key === 'notes' || key.endsWith('_link'))
        ? 'internal_notes'
        : null,
    ].filter((group): group is string => Boolean(group));
    await recordBookingOpsEvent({
      bookingOpsRecordId: recordId,
      eventType: 'booking_updated',
      title: 'Данные брони обновлены',
      description: 'Изменения сохранены без записи персональных данных в историю.',
      actorType: options?.actorType ?? 'system',
      metadata: { changedGroups: groups },
      dedupeKey: `booking-updated:${(data as BookingOpsRow).updated_at}`,
    });
  }
  return { ok: true, record: await enrichRecordWithTaskSync(mapRow(data as BookingOpsRow)) };
}
