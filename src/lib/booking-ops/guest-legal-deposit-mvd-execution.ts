import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { checkBookingOverbookingRisk } from './availability-overbooking-protection';
import { blockGate, completeGate, initializeLifecycleForBooking, markGateInProgress, skipGate } from './lifecycle';
import { getBookingOpsRecord, updateBookingOpsRecord } from './repository';
import type {
  BookingOpsCommunicationPurpose,
  BookingOpsContractStatus,
  BookingOpsDepositStatus,
  BookingOpsDocumentsStatus,
  BookingOpsMvdStatus,
  BookingOpsRecord,
} from './types';

export const GUEST_DOCUMENT_STATUSES = [
  'not_requested', 'requested', 'partially_received', 'received', 'needs_review',
  'verified', 'rejected', 'blocked',
] as const;
export const CONTRACT_STATUSES = [
  'not_started', 'draft_needed', 'draft_ready', 'sent_for_signature_placeholder',
  'signed_manual', 'signed_provider_placeholder', 'needs_review', 'blocked',
] as const;
export const DEPOSIT_STATUSES = [
  'not_requested', 'request_draft_ready', 'requested_placeholder', 'pending',
  'paid_manual', 'paid_provider_placeholder', 'failed', 'refunded_manual',
  'disputed', 'waived_manual', 'blocked',
] as const;
export const MVD_STATUSES = [
  'not_required', 'not_started', 'data_needed', 'draft_ready', 'export_ready',
  'submitted_manual', 'submitted_provider_placeholder', 'accepted_manual',
  'rejected', 'needs_review', 'blocked',
] as const;
export const LEGAL_READINESS_STATUSES = [
  'incomplete', 'ready_for_operator_review', 'ready_for_checkin', 'blocked',
] as const;

export type GuestDocumentStatus = (typeof GUEST_DOCUMENT_STATUSES)[number];
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];
export type MvdStatus = (typeof MVD_STATUSES)[number];
export type LegalReadinessStatus = (typeof LEGAL_READINESS_STATUSES)[number];
export type LegalExecutionEventType =
  | 'documents_requested' | 'documents_received' | 'documents_verified'
  | 'contract_draft_created' | 'contract_signed_manual' | 'deposit_request_created'
  | 'deposit_paid_manual' | 'deposit_waived_manual' | 'mvd_draft_created'
  | 'mvd_export_ready' | 'mvd_submitted_manual' | 'mvd_accepted_manual'
  | 'mvd_not_required' | 'readiness_recomputed' | 'checkin_blocked'
  | 'legal_flow_blocked' | 'note_added';

export type GuestLegalBlocker = {
  key: 'availability' | 'documents' | 'contract' | 'deposit' | 'mvd' | 'legal_flow';
  reason: string;
};

export type GuestLegalReadiness = {
  id: string;
  bookingId: string;
  propertySetupId: string | null;
  propertyId: string | null;
  status: LegalReadinessStatus;
  documentsStatus: GuestDocumentStatus;
  contractStatus: ContractStatus;
  depositStatus: DepositStatus;
  mvdStatus: MvdStatus;
  availabilityStatus: string | null;
  blockers: GuestLegalBlocker[];
  warnings: string[];
  safeSummary: string | null;
  nextAction: string | null;
  lastCheckedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type GuestLegalExecutionEvent = {
  id: string;
  bookingId: string;
  eventType: LegalExecutionEventType;
  status: string;
  safeSummary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type ReadinessInput = Pick<GuestLegalReadiness,
  'documentsStatus' | 'contractStatus' | 'depositStatus' | 'mvdStatus' | 'availabilityStatus'> & {
  explicitlyBlocked?: boolean;
};

type SafeDocumentPayload = {
  documentReceived?: boolean;
  documentType?: string;
  maskedDocumentReference?: string;
  missingFields?: string[];
  safeNotes?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UNSAFE_KEY_RE = /(passport|scan|file|image|card|cvv|cvc|pan|secret|token|password|credential|access.?code|full.?number)/iu;
const UNSAFE_VALUE_RE = /(?:\b\d[ -]?){12,19}\b/u;

function text(value: unknown, max = 500): string {
  return String(value ?? '').trim().slice(0, max);
}

function requireBookingId(value: unknown): string {
  const id = text(value, 64);
  if (!UUID_RE.test(id)) throw new Error('Некорректный ID брони.');
  return id;
}

function safeMetadata(value?: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value ?? {})) {
    if (UNSAFE_KEY_RE.test(key)) continue;
    if (typeof raw === 'string') {
      if (UNSAFE_VALUE_RE.test(raw)) continue;
      result[key] = text(raw);
    } else if (typeof raw === 'boolean' || typeof raw === 'number' || raw === null) {
      result[key] = raw;
    } else if (Array.isArray(raw)) {
      result[key] = raw.slice(0, 20).map((item) => text(item, 120)).filter(Boolean);
    }
  }
  return result;
}

function mapLegacyDocumentStatus(value: unknown): GuestDocumentStatus {
  const status = text(value, 40);
  if ((GUEST_DOCUMENT_STATUSES as readonly string[]).includes(status)) return status as GuestDocumentStatus;
  return status === 'expired' || status === 'missing' ? 'blocked' : 'not_requested';
}

function mapLegacyContractStatus(value: unknown): ContractStatus {
  const status = text(value, 50);
  if ((CONTRACT_STATUSES as readonly string[]).includes(status)) return status as ContractStatus;
  return ({ prepared: 'draft_ready', sent: 'sent_for_signature_placeholder', signed: 'signed_manual', rejected: 'blocked', expired: 'blocked', failed: 'blocked' } as Record<string, ContractStatus>)[status] ?? 'not_started';
}

function mapLegacyDepositStatus(value: unknown): DepositStatus {
  const status = text(value, 50);
  if ((DEPOSIT_STATUSES as readonly string[]).includes(status)) return status as DepositStatus;
  return ({ requested: 'requested_placeholder', received: 'paid_manual', refunded: 'refunded_manual', partially_refunded: 'refunded_manual', waived: 'waived_manual' } as Record<string, DepositStatus>)[status] ?? 'not_requested';
}

function mapLegacyMvdStatus(value: unknown): MvdStatus {
  const status = text(value, 50);
  if ((MVD_STATUSES as readonly string[]).includes(status)) return status as MvdStatus;
  return ({ prepared: 'draft_ready', submitted: 'submitted_manual', accepted: 'accepted_manual', failed: 'blocked' } as Record<string, MvdStatus>)[status] ?? 'not_started';
}

export function computeGuestLegalReadiness(input: ReadinessInput): {
  status: LegalReadinessStatus;
  blockers: GuestLegalBlocker[];
  warnings: string[];
  nextAction: string | null;
  safeSummary: string;
} {
  const blockers: GuestLegalBlocker[] = [];
  const warnings: string[] = [];
  if (input.explicitlyBlocked) blockers.push({ key: 'legal_flow', reason: 'Юридический контур заблокирован оператором.' });
  if (input.availabilityStatus !== 'no_conflict') {
    blockers.push({
      key: 'availability',
      reason: input.availabilityStatus === 'missing_data'
        ? 'Недостаточно данных для проверки доступности.'
        : 'Доступность не подтверждена или найден конфликт.',
    });
  }
  if (input.documentsStatus !== 'verified') blockers.push({ key: 'documents', reason: 'Документы не проверены вручную.' });
  if (!['signed_manual', 'signed_provider_placeholder'].includes(input.contractStatus)) blockers.push({ key: 'contract', reason: 'Договор не отмечен как подписанный.' });
  if (!['paid_manual', 'paid_provider_placeholder', 'waived_manual'].includes(input.depositStatus)) blockers.push({ key: 'deposit', reason: 'Залог не оплачен и не отменён оператором.' });
  if (!['not_required', 'submitted_manual', 'submitted_provider_placeholder', 'accepted_manual'].includes(input.mvdStatus)) blockers.push({ key: 'mvd', reason: 'Статус МВД не позволяет готовить инструкции заезда.' });
  if (input.contractStatus === 'signed_provider_placeholder') warnings.push('Подпись провайдера требует проверки оператором.');
  if (input.depositStatus === 'paid_provider_placeholder') warnings.push('Оплата провайдера требует проверки оператором.');
  if (input.mvdStatus === 'submitted_provider_placeholder') warnings.push('Отправка провайдером требует проверки оператором.');

  const hardBlocked = input.explicitlyBlocked
    || ['blocked', 'rejected'].includes(input.documentsStatus)
    || input.contractStatus === 'blocked'
    || ['blocked', 'failed', 'disputed'].includes(input.depositStatus)
    || ['blocked', 'rejected'].includes(input.mvdStatus)
    || ['confirmed_conflict', 'possible_conflict', 'failed'].includes(input.availabilityStatus ?? '');
  const status: LegalReadinessStatus = hardBlocked
    ? 'blocked'
    : blockers.length === 0
      ? (warnings.length ? 'ready_for_operator_review' : 'ready_for_checkin')
      : 'incomplete';
  const nextAction = blockers[0]?.reason ?? (warnings[0] ?? null);
  const safeSummary = blockers.length === 0
    ? (warnings.length ? 'Основные условия выполнены, нужна проверка оператора.' : 'Юридические условия заезда выполнены.')
    : `До заезда нужно устранить блокеры: ${blockers.length}.`;
  return { status, blockers, warnings, nextAction, safeSummary };
}

async function requireRecord(bookingId: string): Promise<BookingOpsRecord> {
  const id = requireBookingId(bookingId);
  const record = await getBookingOpsRecord(id);
  if (!record) throw new Error('Бронь не найдена.');
  return record;
}

async function latestStatus(table: string, bookingId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from(table).select('*').eq('booking_id', bookingId)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

async function allDocuments(bookingId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase.from('booking_guest_documents').select('*')
    .eq('booking_id', bookingId).order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}

function aggregateDocuments(rows: Array<Record<string, unknown>>): GuestDocumentStatus {
  if (!rows.length) return 'not_requested';
  const statuses = rows.map((row) => mapLegacyDocumentStatus(row.status));
  if (statuses.some((status) => status === 'blocked')) return 'blocked';
  if (statuses.some((status) => status === 'rejected')) return 'rejected';
  if (statuses.some((status) => status === 'needs_review')) return 'needs_review';
  if (statuses.every((status) => status === 'verified')) return 'verified';
  if (statuses.some((status) => status === 'received')) return statuses.some((status) => status === 'requested') ? 'partially_received' : 'received';
  if (statuses.some((status) => status === 'partially_received')) return 'partially_received';
  if (statuses.some((status) => status === 'requested')) return 'requested';
  return 'not_requested';
}

async function recordEvent(bookingId: string, eventType: LegalExecutionEventType, status: string, safeSummary: string, metadata?: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('booking_legal_execution_events').insert({
    id: randomUUID(), booking_id: bookingId, event_type: eventType, status: text(status, 80),
    safe_summary: text(safeSummary) || null, metadata: safeMetadata(metadata),
  });
  if (error) throw new Error(error.message);
}

async function upsertSingleton(table: 'booking_contracts' | 'booking_deposits' | 'booking_mvd_reports', bookingId: string, values: Record<string, unknown>): Promise<void> {
  const existing = await latestStatus(table, bookingId);
  const now = new Date().toISOString();
  const provider = 'manual';
  const payload = {
    id: existing?.id ?? randomUUID(), booking_id: bookingId, provider,
    created_at: existing?.created_at ?? now, updated_at: now,
    metadata: { ...(existing?.metadata as Record<string, unknown> ?? {}), ...safeMetadata(values.metadata as Record<string, unknown> | undefined) },
    ...Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'metadata')),
  };
  const { error } = await supabase.from(table).upsert(payload, { onConflict: 'booking_id,provider' });
  if (error) throw new Error(error.message);
}

function mapReadinessRow(row: Record<string, unknown>): GuestLegalReadiness {
  const blockers = Array.isArray(row.blockers) ? row.blockers as GuestLegalBlocker[] : [];
  const warnings = Array.isArray(row.warnings) ? row.warnings.map(String) : [];
  return {
    id: String(row.id), bookingId: String(row.booking_id), propertySetupId: text(row.property_setup_id) || null,
    propertyId: text(row.property_id) || null, status: row.status as LegalReadinessStatus,
    documentsStatus: mapLegacyDocumentStatus(row.documents_status), contractStatus: mapLegacyContractStatus(row.contract_status),
    depositStatus: mapLegacyDepositStatus(row.deposit_status), mvdStatus: mapLegacyMvdStatus(row.mvd_status),
    availabilityStatus: text(row.availability_status) || null, blockers, warnings,
    safeSummary: text(row.safe_summary) || null,
    nextAction: blockers[0]?.reason ?? warnings[0] ?? null,
    lastCheckedAt: text(row.last_checked_at) || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapDocumentsStatusToBookingOps(status: GuestDocumentStatus): BookingOpsDocumentsStatus {
  if (status === 'verified') return 'verified';
  if (status === 'received' || status === 'partially_received') return 'received';
  if (status === 'requested') return 'requested';
  if (status === 'needs_review' || status === 'rejected' || status === 'blocked') return 'problem';
  return 'not_started';
}

function mapContractStatusToBookingOps(status: ContractStatus): BookingOpsContractStatus {
  if (status === 'signed_manual' || status === 'signed_provider_placeholder') return 'signed';
  if (status === 'sent_for_signature_placeholder') return 'sent';
  if (status === 'draft_ready') return 'prepared';
  if (status === 'needs_review' || status === 'blocked') return 'problem';
  return 'not_started';
}

function mapDepositStatusToBookingOps(status: DepositStatus): BookingOpsDepositStatus {
  if (status === 'paid_manual' || status === 'paid_provider_placeholder' || status === 'waived_manual') return 'confirmed';
  if (status === 'request_draft_ready' || status === 'requested_placeholder' || status === 'pending') return 'requested';
  if (status === 'failed' || status === 'disputed' || status === 'blocked') return 'problem';
  return 'not_started';
}

function mapMvdStatusToBookingOps(status: MvdStatus): BookingOpsMvdStatus {
  if (status === 'not_required') return 'not_required';
  if (status === 'submitted_manual' || status === 'submitted_provider_placeholder' || status === 'accepted_manual') return 'submitted';
  if (status === 'draft_ready' || status === 'export_ready') return 'prepared';
  if (status === 'rejected' || status === 'needs_review' || status === 'blocked') return 'problem';
  return 'required';
}

export async function syncGuestLegalReadinessToBookingOpsRecord(
  readiness: GuestLegalReadiness,
): Promise<{ ok: boolean; changed: boolean; error?: string }> {
  const record = await getBookingOpsRecord(readiness.bookingId);
  if (!record) return { ok: false, changed: false, error: 'booking_not_found' };

  const next = {
    documentsStatus: mapDocumentsStatusToBookingOps(readiness.documentsStatus),
    contractStatus: mapContractStatusToBookingOps(readiness.contractStatus),
    depositStatus: mapDepositStatusToBookingOps(readiness.depositStatus),
    mvdStatus: mapMvdStatusToBookingOps(readiness.mvdStatus),
  };
  const changed =
    record.documentsStatus !== next.documentsStatus
    || record.contractStatus !== next.contractStatus
    || record.depositStatus !== next.depositStatus
    || record.mvdStatus !== next.mvdStatus;

  if (!changed) return { ok: true, changed: false };

  const result = await updateBookingOpsRecord(record.id, next, { actorType: 'system' });
  return result.ok
    ? { ok: true, changed: true }
    : { ok: false, changed: false, error: result.error };
}

async function syncLifecycle(bookingId: string, readiness: GuestLegalReadiness): Promise<void> {
  await initializeLifecycleForBooking(bookingId);
  if (readiness.documentsStatus === 'verified') await completeGate(bookingId, 'documents_verified', { source: 'guest_legal_execution_v1', manual: true });
  else await markGateInProgress(bookingId, 'documents_verified', { source: 'guest_legal_execution_v1' });
  if (['signed_manual', 'signed_provider_placeholder'].includes(readiness.contractStatus)) await completeGate(bookingId, 'contract_signed', { source: 'guest_legal_execution_v1', status: readiness.contractStatus });
  else await markGateInProgress(bookingId, 'contract_signed', { source: 'guest_legal_execution_v1' });
  if (['paid_manual', 'paid_provider_placeholder', 'waived_manual'].includes(readiness.depositStatus)) await completeGate(bookingId, 'deposit_received', { source: 'guest_legal_execution_v1', status: readiness.depositStatus });
  else await markGateInProgress(bookingId, 'deposit_received', { source: 'guest_legal_execution_v1' });
  if (readiness.mvdStatus === 'not_required') await skipGate(bookingId, 'mvd_report_submitted', 'МВД не требуется: подтверждено оператором.');
  else if (['submitted_manual', 'submitted_provider_placeholder', 'accepted_manual'].includes(readiness.mvdStatus)) await completeGate(bookingId, 'mvd_report_submitted', { source: 'guest_legal_execution_v1', status: readiness.mvdStatus });
  else await markGateInProgress(bookingId, 'mvd_report_submitted', { source: 'guest_legal_execution_v1' });
}

export async function initializeGuestLegalExecution(bookingId: string, options: Record<string, unknown> = {}): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const docs = await allDocuments(record.id);
  if (!docs.length) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('booking_guest_documents').insert({
      id: randomUUID(), booking_id: record.id, guest_id: null, document_type: 'guest_identity',
      status: 'not_requested', storage_ref: null, masked_document_number: null,
      metadata: { initialized: true }, created_at: now, updated_at: now,
    });
    if (error) throw new Error(error.message);
  }
  if (!await latestStatus('booking_contracts', record.id)) {
    await upsertSingleton('booking_contracts', record.id, { status: 'not_started', metadata: { initialized: true } });
  }
  if (!await latestStatus('booking_deposits', record.id)) {
    await upsertSingleton('booking_deposits', record.id, { status: 'not_requested', amount: 0, currency: 'RUB', metadata: { initialized: true } });
  }
  if (!await latestStatus('booking_mvd_reports', record.id)) {
    await upsertSingleton('booking_mvd_reports', record.id, { status: 'not_started', metadata: { initialized: true } });
  }
  return recomputeGuestLegalReadiness(record.id, options);
}

export async function recomputeGuestLegalReadiness(bookingId: string, options: Record<string, unknown> = {}): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const [documents, contract, deposit, mvd, existing, availability] = await Promise.all([
    allDocuments(record.id), latestStatus('booking_contracts', record.id), latestStatus('booking_deposits', record.id),
    latestStatus('booking_mvd_reports', record.id), latestStatus('booking_guest_legal_readiness', record.id),
    checkBookingOverbookingRisk(record.id, { checkType: 'manual_review' }),
  ]);
  const input: ReadinessInput = {
    documentsStatus: aggregateDocuments(documents), contractStatus: mapLegacyContractStatus(contract?.status),
    depositStatus: mapLegacyDepositStatus(deposit?.status), mvdStatus: mapLegacyMvdStatus(mvd?.status),
    availabilityStatus: availability.status,
    explicitlyBlocked: Boolean(existing?.metadata && (existing.metadata as Record<string, unknown>).explicitlyBlocked === true),
  };
  const computed = computeGuestLegalReadiness(input);
  const now = new Date().toISOString();
  const payload = {
    id: existing?.id ?? randomUUID(), booking_id: record.id, property_setup_id: null,
    property_id: record.propertyId ?? null, status: computed.status,
    documents_status: input.documentsStatus, contract_status: input.contractStatus,
    deposit_status: input.depositStatus, mvd_status: input.mvdStatus,
    availability_status: availability.status, blockers: computed.blockers, warnings: computed.warnings,
    safe_summary: computed.safeSummary, last_checked_at: now,
    metadata: { ...(existing?.metadata as Record<string, unknown> ?? {}), ...safeMetadata(options) },
    created_at: existing?.created_at ?? now, updated_at: now,
  };
  const { data, error } = await supabase.from('booking_guest_legal_readiness').upsert(payload, { onConflict: 'booking_id' }).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось пересчитать готовность.');
  const readiness = mapReadinessRow(data as Record<string, unknown>);
  await syncLifecycle(record.id, readiness);
  const bridge = await syncGuestLegalReadinessToBookingOpsRecord(readiness);
  if (!bridge.ok) throw new Error(bridge.error ?? 'booking_ops_summary_sync_failed');
  await recordEvent(record.id, 'readiness_recomputed', readiness.status, readiness.safeSummary ?? 'Готовность пересчитана.', { blockerCount: readiness.blockers.length });
  return readiness;
}

export async function getGuestLegalReadiness(bookingId: string): Promise<GuestLegalReadiness | null> {
  const id = requireBookingId(bookingId);
  const row = await latestStatus('booking_guest_legal_readiness', id);
  return row ? mapReadinessRow(row) : null;
}

export async function getGuestLegalBlockers(bookingId: string): Promise<GuestLegalBlocker[]> {
  return (await getGuestLegalReadiness(bookingId))?.blockers ?? [];
}

export async function requestGuestDocumentsDraft(bookingId: string, options: Record<string, unknown> = {}): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const now = new Date().toISOString();
  const docs = await allDocuments(record.id);
  if (docs.length) {
    const { error } = await supabase.from('booking_guest_documents').update({ status: 'requested', metadata: safeMetadata(options), updated_at: now }).eq('booking_id', record.id).in('status', ['not_requested', 'missing']);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('booking_guest_documents').insert({ id: randomUUID(), booking_id: record.id, document_type: 'guest_identity', status: 'requested', metadata: safeMetadata(options), created_at: now, updated_at: now });
    if (error) throw new Error(error.message);
  }
  await recordEvent(record.id, 'documents_requested', 'requested', 'Подготовлен черновик запроса документов.', options);
  return recomputeGuestLegalReadiness(record.id);
}

export async function recordGuestDocumentsReceived(bookingId: string, payload: SafeDocumentPayload, metadata?: Record<string, unknown>): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const masked = text(payload.maskedDocumentReference, 80);
  if (masked && (!masked.includes('*') || UNSAFE_VALUE_RE.test(masked))) throw new Error('Разрешена только маскированная ссылка на документ.');
  const safe = {
    document_received: payload.documentReceived !== false,
    missing_fields: (payload.missingFields ?? []).slice(0, 20).map((item) => text(item, 80)).filter(Boolean),
    safe_notes: text(payload.safeNotes), ...safeMetadata(metadata),
  };
  const now = new Date().toISOString();
  const { error } = await supabase.from('booking_guest_documents').update({
    status: safe.missing_fields.length ? 'partially_received' : 'received',
    document_type: text(payload.documentType, 80) || 'guest_identity', masked_document_number: masked || null,
    storage_ref: null, metadata: safe, updated_at: now,
  }).eq('booking_id', record.id);
  if (error) throw new Error(error.message);
  await recordEvent(record.id, 'documents_received', safe.missing_fields.length ? 'partially_received' : 'received', 'Получение документов отмечено без сохранения сканов и полных номеров.', metadata);
  return recomputeGuestLegalReadiness(record.id);
}

export async function markGuestDocumentsNeedsReview(bookingId: string, reason: string, metadata?: Record<string, unknown>): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const cleanReason = text(reason);
  if (!cleanReason) throw new Error('Укажите безопасную причину проверки.');
  const { error } = await supabase.from('booking_guest_documents').update({ status: 'needs_review', rejection_reason: cleanReason, metadata: safeMetadata(metadata), updated_at: new Date().toISOString() }).eq('booking_id', record.id);
  if (error) throw new Error(error.message);
  return recomputeGuestLegalReadiness(record.id);
}

export async function markGuestDocumentsVerifiedManual(bookingId: string, metadata?: Record<string, unknown>): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const now = new Date().toISOString();
  const { error } = await supabase.from('booking_guest_documents').update({ status: 'verified', verified_at: now, verified_by: 'operator', storage_ref: null, metadata: safeMetadata(metadata), updated_at: now }).eq('booking_id', record.id).in('status', ['received', 'partially_received', 'needs_review']);
  if (error) throw new Error(error.message);
  await recordEvent(record.id, 'documents_verified', 'verified', 'Документы проверены оператором.', metadata);
  return recomputeGuestLegalReadiness(record.id);
}

export async function createContractDraft(bookingId: string, options: Record<string, unknown> = {}): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  await upsertSingleton('booking_contracts', record.id, { status: 'draft_ready', template_key: text(options.templateKey, 100) || 'manual.safe.v1', document_ref: null, provider_ref: null, metadata: { draft: true, property: text(record.propertyLabel ?? record.propertyId, 160), checkIn: record.checkInAt, checkOut: record.checkOutAt, ...safeMetadata(options) } });
  await recordEvent(record.id, 'contract_draft_created', 'draft_ready', 'Подготовлены безопасные данные черновика договора.', options);
  return recomputeGuestLegalReadiness(record.id);
}

export async function markContractSignedManual(bookingId: string, metadata?: Record<string, unknown>): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const now = new Date().toISOString();
  await upsertSingleton('booking_contracts', record.id, { status: 'signed_manual', signed_at: now, provider_ref: null, metadata: { manualProof: true, ...safeMetadata(metadata) } });
  await recordEvent(record.id, 'contract_signed_manual', 'signed_manual', 'Подписание договора подтверждено оператором.', metadata);
  return recomputeGuestLegalReadiness(record.id);
}

export async function createDepositRequestDraft(bookingId: string, options: Record<string, unknown> = {}): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const amount = Number(options.amount ?? 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) throw new Error('Некорректная сумма залога.');
  await upsertSingleton('booking_deposits', record.id, { status: 'request_draft_ready', amount, currency: text(options.currency, 12) || 'RUB', provider_ref: null, metadata: { draft: true, ...safeMetadata(options) } });
  await recordEvent(record.id, 'deposit_request_created', 'request_draft_ready', 'Подготовлен черновик запроса залога без платёжной операции.', options);
  return recomputeGuestLegalReadiness(record.id);
}

export async function markDepositPaidManual(bookingId: string, metadata?: Record<string, unknown>): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const now = new Date().toISOString();
  await upsertSingleton('booking_deposits', record.id, { status: 'paid_manual', received_at: now, provider_ref: null, metadata: { manualProof: true, ...safeMetadata(metadata) } });
  await recordEvent(record.id, 'deposit_paid_manual', 'paid_manual', 'Оплата залога подтверждена оператором.', metadata);
  return recomputeGuestLegalReadiness(record.id);
}

export async function markDepositWaivedManual(bookingId: string, reason: string, metadata?: Record<string, unknown>): Promise<GuestLegalReadiness> {
  const cleanReason = text(reason);
  if (!cleanReason) throw new Error('Для отмены залога нужна причина.');
  const record = await requireRecord(bookingId);
  await upsertSingleton('booking_deposits', record.id, { status: 'waived_manual', failure_reason: null, metadata: { waiverReason: cleanReason, ...safeMetadata(metadata) } });
  await recordEvent(record.id, 'deposit_waived_manual', 'waived_manual', 'Залог отменён оператором с указанием причины.', { reason: cleanReason, ...metadata });
  return recomputeGuestLegalReadiness(record.id);
}

export async function createMvdDraft(bookingId: string, options: Record<string, unknown> = {}): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const enoughData = options.enoughData !== false;
  await upsertSingleton('booking_mvd_reports', record.id, { status: enoughData ? 'draft_ready' : 'data_needed', provider_ref: null, prepared_at: enoughData ? new Date().toISOString() : null, metadata: { draft: enoughData, ...safeMetadata(options) } });
  await recordEvent(record.id, 'mvd_draft_created', enoughData ? 'draft_ready' : 'data_needed', enoughData ? 'Подготовлены безопасные данные черновика МВД.' : 'Для черновика МВД нужны дополнительные данные.', options);
  return recomputeGuestLegalReadiness(record.id);
}

export async function markMvdNotRequired(bookingId: string, reason: string, metadata?: Record<string, unknown>): Promise<GuestLegalReadiness> {
  const cleanReason = text(reason);
  if (!cleanReason) throw new Error('Укажите причину, почему МВД не требуется.');
  const record = await requireRecord(bookingId);
  await upsertSingleton('booking_mvd_reports', record.id, { status: 'not_required', provider_ref: null, metadata: { notRequiredReason: cleanReason, ...safeMetadata(metadata) } });
  await recordEvent(record.id, 'mvd_not_required', 'not_required', 'Оператор отметил, что МВД не требуется.', { reason: cleanReason, ...metadata });
  return recomputeGuestLegalReadiness(record.id);
}

export async function markMvdSubmittedManual(bookingId: string, metadata?: Record<string, unknown>): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const now = new Date().toISOString();
  await upsertSingleton('booking_mvd_reports', record.id, { status: 'submitted_manual', submitted_at: now, provider_ref: null, metadata: { manualProof: true, ...safeMetadata(metadata) } });
  await recordEvent(record.id, 'mvd_submitted_manual', 'submitted_manual', 'Отправка МВД подтверждена оператором.', metadata);
  return recomputeGuestLegalReadiness(record.id);
}

export async function markMvdAcceptedManual(bookingId: string, metadata?: Record<string, unknown>): Promise<GuestLegalReadiness> {
  const record = await requireRecord(bookingId);
  const now = new Date().toISOString();
  await upsertSingleton('booking_mvd_reports', record.id, { status: 'accepted_manual', submitted_at: now, accepted_at: now, provider_ref: null, metadata: { manualProof: true, ...safeMetadata(metadata) } });
  await recordEvent(record.id, 'mvd_accepted_manual', 'accepted_manual', 'Принятие МВД подтверждено оператором.', metadata);
  return recomputeGuestLegalReadiness(record.id);
}

export async function blockGuestLegalFlow(bookingId: string, reason: string, metadata?: Record<string, unknown>): Promise<GuestLegalReadiness> {
  const cleanReason = text(reason);
  if (!cleanReason) throw new Error('Укажите причину блокировки.');
  const record = await requireRecord(bookingId);
  const current = await getGuestLegalReadiness(record.id) ?? await initializeGuestLegalExecution(record.id);
  const { error } = await supabase.from('booking_guest_legal_readiness').update({ status: 'blocked', blockers: [...current.blockers, { key: 'legal_flow', reason: cleanReason }], metadata: { ...current.metadata, explicitlyBlocked: true }, safe_summary: 'Юридический контур заблокирован оператором.', updated_at: new Date().toISOString() }).eq('booking_id', record.id);
  if (error) throw new Error(error.message);
  await blockGate(record.id, 'documents_verified', cleanReason, { source: 'guest_legal_execution_v1' });
  await recordEvent(record.id, 'legal_flow_blocked', 'blocked', cleanReason, metadata);
  return (await getGuestLegalReadiness(record.id))!;
}

export async function addGuestLegalNote(bookingId: string, note: string, metadata?: Record<string, unknown>): Promise<GuestLegalReadiness> {
  const cleanNote = text(note);
  if (!cleanNote || UNSAFE_VALUE_RE.test(cleanNote)) throw new Error('Добавьте короткую безопасную заметку без персональных и платёжных данных.');
  const record = await requireRecord(bookingId);
  await recordEvent(record.id, 'note_added', 'noted', cleanNote, metadata);
  return (await getGuestLegalReadiness(record.id)) ?? recomputeGuestLegalReadiness(record.id);
}

export async function listGuestLegalEvents(bookingId: string): Promise<GuestLegalExecutionEvent[]> {
  const id = requireBookingId(bookingId);
  const { data, error } = await supabase.from('booking_legal_execution_events').select('*').eq('booking_id', id).order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, bookingId: row.booking_id, eventType: row.event_type, status: row.status, safeSummary: row.safe_summary, metadata: row.metadata ?? {}, createdAt: row.created_at })) as GuestLegalExecutionEvent[];
}

export async function shouldBlockCheckinInstructions(bookingId: string): Promise<{ block: boolean; readiness: GuestLegalReadiness; reason: string | null }> {
  const readiness = await recomputeGuestLegalReadiness(bookingId);
  const { canReleaseCheckInInstructions, ensurePhysicalTasks } = await import('./physical-readiness-execution');
  const physical = await ensurePhysicalTasks(bookingId);
  const gate = canReleaseCheckInInstructions({ legalReady: readiness.status === 'ready_for_checkin', physical });
  const block = !gate.allowed;
  const reason = readiness.status !== 'ready_for_checkin'
    ? readiness.nextAction
    : physical.blockers[0]?.reason ?? null;
  if (block) await recordEvent(readiness.bookingId, 'checkin_blocked', readiness.status, reason ?? 'Инструкции заезда заблокированы.');
  return { block, readiness, reason };
}

export function shouldBlockLegalCommunication(input: { purpose: BookingOpsCommunicationPurpose; messageText?: string }, readiness: GuestLegalReadiness): { block: boolean; reviewRequired: boolean; reason: string | null } {
  const safe = new Set<BookingOpsCommunicationPurpose>(['neutral_booking_acknowledgement', 'request_missing_guest_data', 'request_guest_documents', 'request_contract_confirmation', 'request_deposit_payment', 'request_mvd_data', 'internal_status_notice']);
  if (safe.has(input.purpose)) return { block: false, reviewRequired: false, reason: null };
  const sensitive = new Set<BookingOpsCommunicationPurpose>(['send_checkin_instructions', 'checkin_instructions', 'unit_ready_notice']);
  const textLooksSensitive = /(?:бронь полностью подтверждена|инструкции заезда|код доступа|получение ключ)/iu.test(input.messageText ?? '');
  if ((sensitive.has(input.purpose) || textLooksSensitive) && readiness.status !== 'ready_for_checkin') {
    return { block: true, reviewRequired: true, reason: readiness.nextAction ?? 'Юридическая готовность не подтверждена.' };
  }
  return { block: false, reviewRequired: readiness.status !== 'ready_for_checkin', reason: readiness.status === 'ready_for_checkin' ? null : readiness.nextAction };
}

export async function buildLegalSummaryForPreCheckin(bookingId: string) {
  const readiness = await recomputeGuestLegalReadiness(bookingId);
  return { status: readiness.status, blockers: readiness.blockers, warnings: readiness.warnings, nextAction: readiness.nextAction, safeSummary: readiness.safeSummary };
}

export async function buildLegalSummaryForBookingOps(bookingId: string) {
  const readiness = await recomputeGuestLegalReadiness(bookingId);
  const events = await listGuestLegalEvents(bookingId);
  return { readiness, nextAction: readiness.nextAction, lastEvent: events[0] ?? null };
}

export async function explainGuestLegalReadiness(bookingId: string) {
  const readiness = await recomputeGuestLegalReadiness(bookingId);
  return {
    bookingId: readiness.bookingId, status: readiness.status, safeSummary: readiness.safeSummary,
    blockers: readiness.blockers, warnings: readiness.warnings, nextAction: readiness.nextAction,
    rules: [
      'Документы считаются готовыми только после ручной проверки.',
      'Черновик договора не считается подписью.',
      'Черновик запроса залога не считается оплатой.',
      'Черновик МВД не считается отправкой.',
      'Инструкции заезда доступны только после проверки доступности и снятия всех блокеров.',
    ],
  };
}
