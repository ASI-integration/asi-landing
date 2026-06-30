import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { buildAutoSendDecisionMetadata } from './communication-auto-send-policy';
import { getBookingOpsRecord, updateBookingOpsRecord } from './repository';
import {
  blockGate,
  completeGate,
  getLifecycleStatus,
  initializeLifecycleForBooking,
  markGateInProgress,
} from './lifecycle';
import type { BookingLifecycleSnapshot } from './lifecycle-types';
import type {
  BookingOpsCommunicationChannel,
  BookingOpsCommunicationIntent,
  BookingOpsCommunicationPurpose,
  BookingOpsRecord,
} from './types';

export type BookingGuestDocumentStatus =
  | 'requested'
  | 'received'
  | 'verified'
  | 'rejected'
  | 'expired'
  | 'missing';

export type BookingContractStatus =
  | 'not_started'
  | 'prepared'
  | 'sent'
  | 'signed'
  | 'rejected'
  | 'expired'
  | 'failed';

export type BookingDepositStatus =
  | 'not_requested'
  | 'requested'
  | 'received'
  | 'refunded'
  | 'partially_refunded'
  | 'failed'
  | 'waived';

export type BookingMvdReportStatus =
  | 'not_started'
  | 'prepared'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'failed';

export type BookingGuestDocument = {
  id: string;
  bookingId: string;
  guestId: string | null;
  documentType: string;
  status: BookingGuestDocumentStatus;
  storageRef: string | null;
  maskedDocumentNumber: string | null;
  issuedCountry: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  rejectionReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BookingContract = {
  id: string;
  bookingId: string;
  provider: 'manual' | 'okidoki' | 'other';
  providerRef: string | null;
  status: BookingContractStatus;
  templateKey: string | null;
  documentRef: string | null;
  sentAt: string | null;
  signedAt: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BookingDeposit = {
  id: string;
  bookingId: string;
  provider: 'manual' | 'payment_link' | 'stripe' | 'yoo_money' | 'other';
  providerRef: string | null;
  amount: number;
  currency: string;
  status: BookingDepositStatus;
  requestedAt: string | null;
  receivedAt: string | null;
  refundedAt: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BookingMvdReport = {
  id: string;
  bookingId: string;
  provider: 'manual' | 'integration' | 'other';
  providerRef: string | null;
  status: BookingMvdReportStatus;
  preparedAt: string | null;
  submittedAt: string | null;
  acceptedAt: string | null;
  rejectionReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type LegalPaymentBlocker = {
  gateKey: string;
  reason: string;
};

export type LegalPaymentStatus = {
  bookingId: string;
  documents: BookingGuestDocument[];
  contract: BookingContract | null;
  deposit: BookingDeposit | null;
  mvdReport: BookingMvdReport | null;
  blockers: LegalPaymentBlocker[];
  communications: BookingOpsCommunicationIntent[];
  lifecycle: BookingLifecycleSnapshot | null;
};

type DocumentRow = {
  id: string;
  booking_id: string;
  guest_id: string | null;
  document_type: string;
  status: BookingGuestDocumentStatus;
  storage_ref: string | null;
  masked_document_number: string | null;
  issued_country: string | null;
  expires_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  rejection_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type ContractRow = {
  id: string;
  booking_id: string;
  provider: BookingContract['provider'];
  provider_ref: string | null;
  status: BookingContractStatus;
  template_key: string | null;
  document_ref: string | null;
  sent_at: string | null;
  signed_at: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type DepositRow = {
  id: string;
  booking_id: string;
  provider: BookingDeposit['provider'];
  provider_ref: string | null;
  amount: number | string;
  currency: string;
  status: BookingDepositStatus;
  requested_at: string | null;
  received_at: string | null;
  refunded_at: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type MvdRow = {
  id: string;
  booking_id: string;
  provider: BookingMvdReport['provider'];
  provider_ref: string | null;
  status: BookingMvdReportStatus;
  prepared_at: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  rejection_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type CommunicationRow = {
  id: string;
  booking_ops_record_id: string;
  booking_id: string | null;
  related_task_id: string | null;
  actor_type: string;
  actor_label: string | null;
  purpose: BookingOpsCommunicationPurpose;
  channel: BookingOpsCommunicationChannel;
  status: BookingOpsCommunicationIntent['status'];
  message_text: string;
  message_template_key: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  superseded_at: string | null;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapDocument(row: DocumentRow): BookingGuestDocument {
  return {
    id: row.id,
    bookingId: row.booking_id,
    guestId: text(row.guest_id) || null,
    documentType: row.document_type,
    status: row.status,
    storageRef: text(row.storage_ref) || null,
    maskedDocumentNumber: text(row.masked_document_number) || null,
    issuedCountry: text(row.issued_country) || null,
    expiresAt: row.expires_at,
    verifiedAt: row.verified_at,
    verifiedBy: text(row.verified_by) || null,
    rejectionReason: text(row.rejection_reason) || null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContract(row: ContractRow): BookingContract {
  return {
    id: row.id,
    bookingId: row.booking_id,
    provider: row.provider,
    providerRef: text(row.provider_ref) || null,
    status: row.status,
    templateKey: text(row.template_key) || null,
    documentRef: text(row.document_ref) || null,
    sentAt: row.sent_at,
    signedAt: row.signed_at,
    failureReason: text(row.failure_reason) || null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDeposit(row: DepositRow): BookingDeposit {
  return {
    id: row.id,
    bookingId: row.booking_id,
    provider: row.provider,
    providerRef: text(row.provider_ref) || null,
    amount: Number(row.amount) || 0,
    currency: row.currency,
    status: row.status,
    requestedAt: row.requested_at,
    receivedAt: row.received_at,
    refundedAt: row.refunded_at,
    failureReason: text(row.failure_reason) || null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMvdReport(row: MvdRow): BookingMvdReport {
  return {
    id: row.id,
    bookingId: row.booking_id,
    provider: row.provider,
    providerRef: text(row.provider_ref) || null,
    status: row.status,
    preparedAt: row.prepared_at,
    submittedAt: row.submitted_at,
    acceptedAt: row.accepted_at,
    rejectionReason: text(row.rejection_reason) || null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCommunication(row: CommunicationRow): BookingOpsCommunicationIntent {
  return {
    id: row.id,
    bookingOpsRecordId: row.booking_ops_record_id,
    bookingId: text(row.booking_id) || null,
    relatedTaskId: text(row.related_task_id) || null,
    actorType: row.actor_type as BookingOpsCommunicationIntent['actorType'],
    actorLabel: text(row.actor_label) || null,
    purpose: row.purpose,
    channel: row.channel,
    status: row.status,
    messageText: row.message_text,
    messageTemplateKey: row.message_template_key,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    supersededAt: row.superseded_at,
  };
}

function guestName(record: BookingOpsRecord): string {
  return text(record.guestName) || 'гость';
}

function propertyName(record: BookingOpsRecord): string {
  return text(record.propertyLabel) || text(record.propertyId) || 'объект';
}

function preferredGuestChannel(record: BookingOpsRecord): BookingOpsCommunicationChannel {
  if (record.guestTelegram) return 'telegram';
  if (record.guestEmail) return 'email';
  return 'manual';
}

async function ensureBookingRecord(bookingId: string): Promise<BookingOpsRecord | null> {
  const id = text(bookingId);
  if (!id) return null;
  return getBookingOpsRecord(id);
}

async function listDocuments(bookingId: string): Promise<BookingGuestDocument[]> {
  const { data, error } = await supabase
    .from('booking_guest_documents')
    .select('*')
    .eq('booking_id', bookingId)
    .order('updated_at', { ascending: false });
  if (error) return [];
  return ((data ?? []) as DocumentRow[]).map(mapDocument);
}

async function latestContract(bookingId: string): Promise<BookingContract | null> {
  const { data, error } = await supabase
    .from('booking_contracts')
    .select('*')
    .eq('booking_id', bookingId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapContract(data as ContractRow);
}

async function latestDeposit(bookingId: string): Promise<BookingDeposit | null> {
  const { data, error } = await supabase
    .from('booking_deposits')
    .select('*')
    .eq('booking_id', bookingId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapDeposit(data as DepositRow);
}

async function latestMvdReport(bookingId: string): Promise<BookingMvdReport | null> {
  const { data, error } = await supabase
    .from('booking_mvd_reports')
    .select('*')
    .eq('booking_id', bookingId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapMvdReport(data as MvdRow);
}

async function listCommunications(bookingId: string): Promise<BookingOpsCommunicationIntent[]> {
  const { data, error } = await supabase
    .from('booking_ops_communication_intents')
    .select('*')
    .eq('booking_ops_record_id', bookingId)
    .order('updated_at', { ascending: false });
  if (error) return [];
  return ((data ?? []) as CommunicationRow[]).map(mapCommunication);
}

async function upsertContract(
  bookingId: string,
  patch: Partial<ContractRow>,
): Promise<void> {
  const existing = await latestContract(bookingId);
  const now = new Date().toISOString();
  await supabase
    .from('booking_contracts')
    .upsert({
      id: existing?.id ?? randomUUID(),
      booking_id: bookingId,
      provider: patch.provider ?? existing?.provider ?? 'manual',
      provider_ref: patch.provider_ref ?? existing?.providerRef ?? null,
      status: patch.status ?? existing?.status ?? 'not_started',
      template_key: patch.template_key ?? existing?.templateKey ?? null,
      document_ref: patch.document_ref ?? existing?.documentRef ?? null,
      sent_at: patch.sent_at ?? existing?.sentAt ?? null,
      signed_at: patch.signed_at ?? existing?.signedAt ?? null,
      failure_reason: patch.failure_reason ?? existing?.failureReason ?? null,
      metadata: { ...(existing?.metadata ?? {}), ...(patch.metadata ?? {}) },
      created_at: existing?.createdAt ?? now,
      updated_at: now,
    }, { onConflict: 'booking_id,provider' });
}

async function upsertDeposit(
  bookingId: string,
  patch: Partial<DepositRow>,
): Promise<void> {
  const existing = await latestDeposit(bookingId);
  const now = new Date().toISOString();
  await supabase
    .from('booking_deposits')
    .upsert({
      id: existing?.id ?? randomUUID(),
      booking_id: bookingId,
      provider: patch.provider ?? existing?.provider ?? 'manual',
      provider_ref: patch.provider_ref ?? existing?.providerRef ?? null,
      amount: patch.amount ?? existing?.amount ?? 0,
      currency: text(patch.currency ?? existing?.currency) || 'RUB',
      status: patch.status ?? existing?.status ?? 'not_requested',
      requested_at: patch.requested_at ?? existing?.requestedAt ?? null,
      received_at: patch.received_at ?? existing?.receivedAt ?? null,
      refunded_at: patch.refunded_at ?? existing?.refundedAt ?? null,
      failure_reason: patch.failure_reason ?? existing?.failureReason ?? null,
      metadata: { ...(existing?.metadata ?? {}), ...(patch.metadata ?? {}) },
      created_at: existing?.createdAt ?? now,
      updated_at: now,
    }, { onConflict: 'booking_id,provider' });
}

async function upsertMvdReport(
  bookingId: string,
  patch: Partial<MvdRow>,
): Promise<void> {
  const existing = await latestMvdReport(bookingId);
  const now = new Date().toISOString();
  await supabase
    .from('booking_mvd_reports')
    .upsert({
      id: existing?.id ?? randomUUID(),
      booking_id: bookingId,
      provider: patch.provider ?? existing?.provider ?? 'manual',
      provider_ref: patch.provider_ref ?? existing?.providerRef ?? null,
      status: patch.status ?? existing?.status ?? 'not_started',
      prepared_at: patch.prepared_at ?? existing?.preparedAt ?? null,
      submitted_at: patch.submitted_at ?? existing?.submittedAt ?? null,
      accepted_at: patch.accepted_at ?? existing?.acceptedAt ?? null,
      rejection_reason: patch.rejection_reason ?? existing?.rejectionReason ?? null,
      metadata: { ...(existing?.metadata ?? {}), ...(patch.metadata ?? {}) },
      created_at: existing?.createdAt ?? now,
      updated_at: now,
    }, { onConflict: 'booking_id,provider' });
}

async function createOrUpdateCommunication(input: {
  record: BookingOpsRecord;
  purpose: BookingOpsCommunicationPurpose;
  templateKey: string;
  messageText: string;
  status?: 'draft_ready' | 'waiting_for_external_input';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const now = new Date().toISOString();
  const channel = preferredGuestChannel(input.record);
  const metadata = await buildAutoSendDecisionMetadata({
    actorType: 'guest',
    purpose: input.purpose,
    channel,
    messageText: input.messageText,
    metadata: input.metadata ?? {},
  }, {
    bookingId: input.record.bookingId,
    propertyId: input.record.propertyId,
    guestRef: input.record.guestTelegram ?? input.record.guestEmail ?? input.record.guestPhone,
  });
  const { data } = await supabase
    .from('booking_ops_communication_intents')
    .select('*')
    .eq('booking_ops_record_id', input.record.id)
    .eq('actor_type', 'guest')
    .eq('purpose', input.purpose)
    .in('status', ['draft_ready', 'waiting_for_external_input'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = {
    booking_ops_record_id: input.record.id,
    booking_id: input.record.bookingId,
    related_task_id: null,
    actor_type: 'guest',
    actor_label: guestName(input.record),
    purpose: input.purpose,
    channel,
    status: input.status ?? 'draft_ready',
    message_text: input.messageText,
    message_template_key: input.templateKey,
    metadata,
    updated_at: now,
  };

  if (data) {
    await supabase
      .from('booking_ops_communication_intents')
      .update(payload)
      .eq('id', (data as CommunicationRow).id);
    return;
  }

  await supabase
    .from('booking_ops_communication_intents')
    .insert({
      id: randomUUID(),
      ...payload,
      created_at: now,
    });
}

async function updateOpsSummary(
  bookingId: string,
  patch: Parameters<typeof updateBookingOpsRecord>[1],
): Promise<void> {
  await updateBookingOpsRecord(bookingId, patch, { actorType: 'system' });
}

export async function initializeLegalPaymentForBooking(bookingId: string): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  await initializeLifecycleForBooking(record.id);
  await upsertContract(record.id, { status: 'not_started', provider: 'manual', metadata: { initialized: true } });
  await upsertDeposit(record.id, { status: 'not_requested', provider: 'manual', metadata: { initialized: true } });
  await upsertMvdReport(record.id, { status: 'not_started', provider: 'manual', metadata: { initialized: true } });
  return getLegalPaymentStatus(record.id);
}

export async function requestGuestDocuments(
  bookingId: string,
  requiredDocuments: string[],
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  await initializeLifecycleForBooking(record.id);
  const now = new Date().toISOString();
  const docs = (requiredDocuments.length ? requiredDocuments : ['passport']).map((documentType) => ({
    id: randomUUID(),
    booking_id: record.id,
    guest_id: null,
    document_type: text(documentType) || 'passport',
    status: 'requested' as const,
    storage_ref: null,
    masked_document_number: null,
    issued_country: null,
    expires_at: null,
    verified_at: null,
    verified_by: null,
    rejection_reason: null,
    metadata: metadata(extraMetadata),
    created_at: now,
    updated_at: now,
  }));
  await supabase.from('booking_guest_documents').insert(docs);
  await completeGate(record.id, 'documents_requested', { requiredDocuments: docs.map((item) => item.document_type) });
  await updateOpsSummary(record.id, { documentsStatus: 'requested', documentRequired: true });
  await createOrUpdateCommunication({
    record,
    purpose: 'request_guest_documents',
    templateKey: 'guest.legal_payment.documents_request.v1',
    messageText: `Здравствуйте, ${guestName(record)}. Для подготовки заезда по объекту ${propertyName(record)} нужны документы гостей. Пришлите их, пожалуйста, удобным способом.`,
    metadata: { requiredDocuments: docs.map((item) => item.document_type) },
  });
  return getLegalPaymentStatus(record.id);
}

export async function markDocumentsReceived(
  bookingId: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  const now = new Date().toISOString();
  await supabase
    .from('booking_guest_documents')
    .update({ status: 'received', metadata: metadata(extraMetadata), updated_at: now })
    .eq('booking_id', record.id)
    .in('status', ['requested', 'missing']);
  await completeGate(record.id, 'documents_received', metadata(extraMetadata));
  await updateOpsSummary(record.id, { documentsStatus: 'received', documentCollected: true });
  return getLegalPaymentStatus(record.id);
}

export async function verifyGuestDocuments(
  bookingId: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  const now = new Date().toISOString();
  await supabase
    .from('booking_guest_documents')
    .update({
      status: 'verified',
      verified_at: now,
      metadata: metadata(extraMetadata),
      updated_at: now,
    })
    .eq('booking_id', record.id)
    .in('status', ['requested', 'received', 'missing']);
  await completeGate(record.id, 'documents_received', metadata(extraMetadata));
  await completeGate(record.id, 'documents_verified', metadata(extraMetadata));
  await updateOpsSummary(record.id, {
    documentsStatus: 'verified',
    documentCollected: true,
    documentVerificationStatus: 'verified',
  });
  await recomputePreCheckinReadiness(record.id);
  return getLegalPaymentStatus(record.id);
}

export async function rejectGuestDocuments(
  bookingId: string,
  reason: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  const now = new Date().toISOString();
  const cleanReason = text(reason) || 'Документы отклонены';
  await supabase
    .from('booking_guest_documents')
    .update({
      status: 'rejected',
      rejection_reason: cleanReason,
      metadata: metadata(extraMetadata),
      updated_at: now,
    })
    .eq('booking_id', record.id);
  await blockGate(record.id, 'documents_verified', cleanReason, metadata(extraMetadata));
  await updateOpsSummary(record.id, {
    documentsStatus: 'problem',
    documentVerificationStatus: 'rejected',
    documentNotes: cleanReason,
  });
  return getLegalPaymentStatus(record.id);
}

export async function prepareContract(
  bookingId: string,
  templateKey?: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  await upsertContract(record.id, {
    status: 'prepared',
    template_key: text(templateKey) || null,
    metadata: metadata(extraMetadata),
  });
  await completeGate(record.id, 'contract_prepared', metadata(extraMetadata));
  await updateOpsSummary(record.id, {
    contractStatus: 'prepared',
    contractRequired: true,
    contractProvider: 'manual',
    contractIntakeStatus: 'prepared',
  });
  return getLegalPaymentStatus(record.id);
}

export async function markContractSent(
  bookingId: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  await upsertContract(record.id, {
    status: 'sent',
    sent_at: new Date().toISOString(),
    metadata: metadata(extraMetadata),
  });
  await completeGate(record.id, 'contract_prepared', metadata(extraMetadata));
  await completeGate(record.id, 'contract_sent', metadata(extraMetadata));
  await updateOpsSummary(record.id, { contractStatus: 'sent', contractIntakeStatus: 'sent' });
  await createOrUpdateCommunication({
    record,
    purpose: 'request_contract_confirmation',
    templateKey: 'guest.legal_payment.contract_signature.v1',
    messageText: `Здравствуйте, ${guestName(record)}. Договор по объекту ${propertyName(record)} подготовлен. Проверьте его, пожалуйста, и подтвердите подписание.`,
    metadata: metadata(extraMetadata),
  });
  return getLegalPaymentStatus(record.id);
}

export async function markContractSigned(
  bookingId: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  await upsertContract(record.id, {
    status: 'signed',
    signed_at: new Date().toISOString(),
    metadata: metadata(extraMetadata),
  });
  await completeGate(record.id, 'contract_prepared', metadata(extraMetadata));
  await completeGate(record.id, 'contract_sent', metadata(extraMetadata));
  await completeGate(record.id, 'contract_signed', metadata(extraMetadata));
  await updateOpsSummary(record.id, { contractStatus: 'signed', contractIntakeStatus: 'signed' });
  await recomputePreCheckinReadiness(record.id);
  return getLegalPaymentStatus(record.id);
}

export async function requestDeposit(
  bookingId: string,
  amount: number,
  currency: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  const cleanAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const cleanCurrency = text(currency).toUpperCase() || 'RUB';
  await upsertDeposit(record.id, {
    status: 'requested',
    amount: cleanAmount,
    currency: cleanCurrency,
    requested_at: new Date().toISOString(),
    metadata: metadata(extraMetadata),
  });
  await completeGate(record.id, 'deposit_requested', { amount: cleanAmount, currency: cleanCurrency });
  await updateOpsSummary(record.id, {
    depositStatus: 'requested',
    depositRequired: true,
    depositAmount: cleanAmount,
    depositIntakeStatus: 'requested',
  });
  await createOrUpdateCommunication({
    record,
    purpose: 'request_deposit_payment',
    templateKey: 'guest.legal_payment.deposit_request.v1',
    messageText: `Здравствуйте, ${guestName(record)}. Для завершения подготовки брони по объекту ${propertyName(record)} нужно внести депозит ${cleanAmount} ${cleanCurrency}. Подскажите, пожалуйста, когда будет удобно оплатить.`,
    metadata: { amount: cleanAmount, currency: cleanCurrency },
  });
  return getLegalPaymentStatus(record.id);
}

export async function markDepositReceived(
  bookingId: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  await upsertDeposit(record.id, {
    status: 'received',
    received_at: new Date().toISOString(),
    metadata: metadata(extraMetadata),
  });
  await completeGate(record.id, 'deposit_requested', metadata(extraMetadata));
  await completeGate(record.id, 'deposit_received', metadata(extraMetadata));
  await updateOpsSummary(record.id, { depositStatus: 'confirmed', depositIntakeStatus: 'received' });
  await recomputePreCheckinReadiness(record.id);
  return getLegalPaymentStatus(record.id);
}

export async function waiveDeposit(
  bookingId: string,
  reason: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  await upsertDeposit(record.id, {
    status: 'waived',
    failure_reason: text(reason) || 'Депозит отменён вручную',
    metadata: metadata(extraMetadata),
  });
  await completeGate(record.id, 'deposit_requested', metadata(extraMetadata));
  await completeGate(record.id, 'deposit_received', { waived: true, reason: text(reason) });
  await updateOpsSummary(record.id, {
    depositStatus: 'confirmed',
    depositRequired: false,
    depositIntakeStatus: 'not_required',
    depositNotes: text(reason) || null,
  });
  await recomputePreCheckinReadiness(record.id);
  return getLegalPaymentStatus(record.id);
}

export async function prepareMvdReport(
  bookingId: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  await upsertMvdReport(record.id, {
    status: 'prepared',
    prepared_at: new Date().toISOString(),
    metadata: metadata(extraMetadata),
  });
  await completeGate(record.id, 'mvd_report_prepared', metadata(extraMetadata));
  await updateOpsSummary(record.id, {
    mvdStatus: 'prepared',
    mvdRequired: true,
    mvdDataStatus: 'prepared',
  });
  return getLegalPaymentStatus(record.id);
}

export async function markMvdReportSubmitted(
  bookingId: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  await upsertMvdReport(record.id, {
    status: 'submitted',
    submitted_at: new Date().toISOString(),
    metadata: metadata(extraMetadata),
  });
  await completeGate(record.id, 'mvd_report_prepared', metadata(extraMetadata));
  await completeGate(record.id, 'mvd_report_submitted', metadata(extraMetadata));
  await updateOpsSummary(record.id, { mvdStatus: 'submitted', mvdDataStatus: 'submitted' });
  await recomputePreCheckinReadiness(record.id);
  return getLegalPaymentStatus(record.id);
}

export async function markMvdReportAccepted(
  bookingId: string,
  extraMetadata?: Record<string, unknown>,
): Promise<LegalPaymentStatus> {
  const record = await ensureBookingRecord(bookingId);
  if (!record) throw new Error('booking_not_found');
  await upsertMvdReport(record.id, {
    status: 'accepted',
    accepted_at: new Date().toISOString(),
    metadata: metadata(extraMetadata),
  });
  await completeGate(record.id, 'mvd_report_prepared', metadata(extraMetadata));
  await completeGate(record.id, 'mvd_report_submitted', metadata(extraMetadata));
  await updateOpsSummary(record.id, { mvdStatus: 'submitted', mvdDataStatus: 'confirmed' });
  await recomputePreCheckinReadiness(record.id);
  return getLegalPaymentStatus(record.id);
}

export async function getLegalPaymentBlockers(bookingId: string): Promise<LegalPaymentBlocker[]> {
  const documents = await listDocuments(bookingId);
  const contract = await latestContract(bookingId);
  const deposit = await latestDeposit(bookingId);
  const mvdReport = await latestMvdReport(bookingId);
  const blockers: LegalPaymentBlocker[] = [];

  if (documents.some((doc) => doc.status === 'rejected')) {
    blockers.push({ gateKey: 'documents_verified', reason: 'Документы отклонены' });
  }
  if (documents.some((doc) => doc.status === 'expired' || doc.status === 'missing')) {
    blockers.push({ gateKey: 'documents_received', reason: 'Документы отсутствуют или просрочены' });
  }
  if (contract && ['failed', 'rejected', 'expired'].includes(contract.status)) {
    blockers.push({ gateKey: 'contract_signed', reason: contract.failureReason ?? 'Проблема с договором' });
  }
  if (deposit?.status === 'failed') {
    blockers.push({ gateKey: 'deposit_received', reason: deposit.failureReason ?? 'Проблема с депозитом' });
  }
  if (mvdReport && ['rejected', 'failed'].includes(mvdReport.status)) {
    blockers.push({ gateKey: 'mvd_report_submitted', reason: mvdReport.rejectionReason ?? 'Проблема с МВД' });
  }
  return blockers;
}

export async function recomputePreCheckinReadiness(bookingId: string): Promise<LegalPaymentStatus> {
  const id = text(bookingId);
  const status = await getLegalPaymentStatus(id);
  const gates = status.lifecycle?.gates ?? [];
  const required = [
    'documents_verified',
    'contract_signed',
    'deposit_received',
    'mvd_report_submitted',
  ];
  const completeOrSkipped = required.every((gateKey) => {
    const gate = gates.find((item) => item.gateKey === gateKey);
    return gate?.status === 'completed' || gate?.status === 'skipped';
  });
  if (completeOrSkipped && status.blockers.length === 0) {
    await completeGate(id, 'property_ready', { legalPaymentReady: true });
  } else if (status.blockers.length > 0) {
    await markGateInProgress(id, 'property_ready', { legalPaymentReady: false });
    const record = await ensureBookingRecord(id);
    if (record) {
      await createOrUpdateCommunication({
        record,
        purpose: 'remind_guest_before_checkin',
        templateKey: 'guest.legal_payment.precheckin_blockers.v1',
        messageText: `Здравствуйте, ${guestName(record)}. По брони ${propertyName(record)} остались шаги перед заездом. Оператор проверит детали и подскажет следующий шаг.`,
        status: 'draft_ready',
        metadata: { blockers: status.blockers },
      });
    }
  }
  return getLegalPaymentStatus(id);
}

export async function getLegalPaymentStatus(bookingId: string): Promise<LegalPaymentStatus> {
  const id = text(bookingId);
  await initializeLifecycleForBooking(id);
  const [documents, contract, deposit, mvdReport, communications, lifecycleResult] = await Promise.all([
    listDocuments(id),
    latestContract(id),
    latestDeposit(id),
    latestMvdReport(id),
    listCommunications(id),
    getLifecycleStatus(id),
  ]);
  return {
    bookingId: id,
    documents,
    contract,
    deposit,
    mvdReport,
    blockers: await getLegalPaymentBlockers(id),
    communications,
    lifecycle: lifecycleResult.lifecycle ?? null,
  };
}
