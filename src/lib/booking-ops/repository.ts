import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { text as cleanText } from '@/lib/pilot-data/test-markers';
import { attachBookingOpsAlerts } from './alerts';
import { lookupPropertyKnowledge, lookupPropertyKnowledgeBatch } from './property-knowledge';
import type {
  BookingOpsRecord,
  CreateBookingOpsInput,
  UpdateBookingOpsInput,
} from './types';
import {
  normalizeBookingOpsCheckinReadinessStatus,
  normalizeBookingOpsContractStatus,
  normalizeBookingOpsDepositStatus,
  normalizeBookingOpsDocumentsStatus,
  normalizeBookingOpsMvdStatus,
  normalizeBookingOpsStatus,
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
  notes: string | null;
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

async function enrichRecord(record: BookingOpsRecord): Promise<BookingOpsRecord> {
  const lookup = await lookupPropertyKnowledge({
    propertyId: record.propertyId,
    propertyLabel: record.propertyLabel,
  });
  return attachAutomation({
    ...record,
    propertyKnowledge: lookup.knowledge,
    propertyKnowledgeMatch: lookup.match,
  });
}

async function enrichRecords(records: BookingOpsRecord[]): Promise<BookingOpsRecord[]> {
  const lookups = await lookupPropertyKnowledgeBatch(records.map((record) => ({
    key: record.id,
    propertyId: record.propertyId,
    propertyLabel: record.propertyLabel,
  })));
  return records.map((record) => {
    const lookup = lookups.get(record.id) ?? { knowledge: null, match: 'none' as const };
    return attachAutomation({
      ...record,
      propertyKnowledge: lookup.knowledge,
      propertyKnowledgeMatch: lookup.match,
    });
  });
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
    notes: text(row.notes) || null,
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

export async function createBookingOpsRecord(input: CreateBookingOpsInput): Promise<{
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
    notes: text(input.notes) || null,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('booking_ops_records')
    .insert(row)
    .select('*')
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, record: await enrichRecord(mapRow(data as BookingOpsRow)) };
}

export async function updateBookingOpsRecord(
  id: string,
  input: UpdateBookingOpsInput,
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
  if (input.notes !== undefined) patch.notes = text(input.notes) || null;

  const { data, error } = await supabase
    .from('booking_ops_records')
    .update(patch)
    .eq('id', recordId)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'not_found' };
  return { ok: true, record: await enrichRecord(mapRow(data as BookingOpsRow)) };
}
