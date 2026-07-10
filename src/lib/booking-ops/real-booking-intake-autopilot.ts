import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { text as cleanText } from '@/lib/pilot-data/test-markers';
import { initializeCheckinExecutionBaseline } from './checkin-execution-autopilot';
import { initializeInStayCheckoutBaseline } from './instay-checkout-autopilot';
import {
  attachAutoSendDecisionMetadata,
  canAutoSendCommunicationIntent,
} from './communication-auto-send-policy';
import { listBookingOpsCommunicationsForRecord } from './communication-orchestrator';
import { recordBookingOpsEvent } from './events';
import { getLifecycleStatus } from './lifecycle';
import { recomputeBookingCheckinReadiness } from './pre-checkin-control-center';
import {
  createBookingOpsRecord,
  getBookingOpsRecord,
  syncBookingOpsTasksForRecordId,
  updateBookingOpsRecord,
} from './repository';
import type {
  BookingOpsCommunicationChannel,
  BookingOpsCommunicationPurpose,
  BookingOpsRecord,
  CreateBookingOpsInput,
} from './types';
import {
  checkAvailabilityConflict,
  createAvailabilityHold,
  type AvailabilityConflictStatus,
} from './availability-overbooking-protection';

export const INBOUND_BOOKING_SOURCES = [
  'web',
  'telegram',
  'admin',
  'email_placeholder',
  'channel_manager_placeholder',
] as const;

export type InboundBookingSource = (typeof INBOUND_BOOKING_SOURCES)[number];

export const INBOUND_INTAKE_STATUSES = [
  'new',
  'processed',
  'duplicate',
  'needs_review',
  'failed',
] as const;

export type InboundIntakeStatus = (typeof INBOUND_INTAKE_STATUSES)[number];

export type InboundBookingRequest = {
  guestName?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  guestTelegram?: string | null;
  telegramUserId?: string | null;
  telegramChatId?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  guestCount?: number | null;
  propertyId?: string | null;
  propertyLabel?: string | null;
  propertyReference?: string | null;
  ownerId?: string | null;
  bookingReference?: string | null;
  externalSourceId?: string | null;
  sourceMessageId?: string | null;
  rawMessageText?: string | null;
  hasMaintenanceIssue?: boolean;
  metadata?: Record<string, unknown>;
};

export type NormalizedInboundBookingRequest = {
  guestName: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  guestTelegram: string | null;
  telegramUserId: string | null;
  telegramChatId: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  guestCount: number | null;
  propertyId: string | null;
  propertyLabel: string | null;
  ownerId: string | null;
  bookingReference: string | null;
  externalSourceId: string | null;
  sourceMessageId: string | null;
  rawMessageText: string | null;
  hasMaintenanceIssue: boolean;
  metadata: Record<string, unknown>;
};

export type InboundBookingIntakeEvent = {
  id: string;
  source: InboundBookingSource;
  sourceRef: string | null;
  idempotencyKey: string;
  status: InboundIntakeStatus;
  bookingId: string | null;
  guestId: string | null;
  ownerId: string | null;
  propertyId: string | null;
  normalizedPayload: Record<string, unknown>;
  missingFields: string[];
  automationResult: Record<string, unknown>;
  failureReason: string | null;
  duplicateOfBookingId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InboundBookingIntakeResult = {
  intakeId: string;
  bookingId: string | null;
  guestId: string | null;
  intakeStatus: InboundIntakeStatus;
  initializedModules: string[];
  createdCommunicationIntents: string[];
  missingRequiredFields: string[];
  nextRequiredActions: string[];
  fallbackCreated: boolean;
  duplicateOfBookingId: string | null;
  safeSummary: string;
};

export type ProcessInboundBookingOptions = {
  force?: boolean;
  action?:
    | 'process'
    | 'mark_duplicate'
    | 'attach_property'
    | 'attach_guest'
    | 'request_missing_data'
    | 'create_fallback';
  attachPropertyId?: string;
  attachPropertyLabel?: string;
  attachGuestName?: string;
  attachGuestPhone?: string;
  attachGuestEmail?: string;
  attachGuestTelegram?: string;
  duplicateOfBookingId?: string;
  intakeEventId?: string;
};

type IntakeEventRow = {
  id: string;
  source: InboundBookingSource;
  source_ref: string | null;
  idempotency_key: string;
  status: InboundIntakeStatus;
  booking_id: string | null;
  guest_id: string | null;
  owner_id: string | null;
  property_id: string | null;
  normalized_payload: Record<string, unknown>;
  missing_fields: string[];
  automation_result: Record<string, unknown>;
  failure_reason: string | null;
  duplicate_of_booking_id: string | null;
  created_at: string;
  updated_at: string;
};

function text(value: unknown): string {
  return cleanText(value);
}

function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return value.trim().toLowerCase();
  return digits.slice(-10);
}

function normalizeEmail(value: string | null): string | null {
  return value?.trim().toLowerCase() || null;
}

function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function mapEventRow(row: IntakeEventRow): InboundBookingIntakeEvent {
  return {
    id: row.id,
    source: row.source,
    sourceRef: text(row.source_ref) || null,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    bookingId: text(row.booking_id) || null,
    guestId: text(row.guest_id) || null,
    ownerId: text(row.owner_id) || null,
    propertyId: text(row.property_id) || null,
    normalizedPayload: row.normalized_payload ?? {},
    missingFields: Array.isArray(row.missing_fields) ? row.missing_fields.map(String) : [],
    automationResult: row.automation_result ?? {},
    failureReason: text(row.failure_reason) || null,
    duplicateOfBookingId: text(row.duplicate_of_booking_id) || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export function computeInboundIdempotencyKey(
  input: NormalizedInboundBookingRequest,
  source: InboundBookingSource,
): string {
  if (input.externalSourceId) {
    return `ext:${source}:${input.externalSourceId}`;
  }
  if (input.sourceMessageId) {
    return `msg:${source}:${input.sourceMessageId}`;
  }
  if (input.bookingReference) {
    return `ref:${source}:${input.bookingReference}`;
  }
  const contact = normalizePhone(input.guestPhone)
    ?? normalizeEmail(input.guestEmail)
    ?? text(input.guestTelegram)?.toLowerCase()
    ?? text(input.telegramUserId)
    ?? null;
  const dates = [input.checkInAt, input.checkOutAt].filter(Boolean).join('|');
  const property = input.propertyId ?? input.propertyLabel ?? '';
  if (contact && (dates || property)) {
    return `match:${source}:${contact}:${dates}:${property}`;
  }
  if (input.rawMessageText) {
    return `text:${source}:${hashText(input.rawMessageText.trim().toLowerCase())}`;
  }
  return `fallback:${source}:${randomUUID()}`;
}

export function normalizeInboundBookingRequest(
  input: InboundBookingRequest,
  source: InboundBookingSource,
): NormalizedInboundBookingRequest {
  const guestTelegramRaw = text(input.guestTelegram) || null;
  const telegramRef = guestTelegramRaw
    ?? (text(input.telegramUserId) ? `tg:${text(input.telegramUserId)}` : null);
  return {
    guestName: text(input.guestName) || null,
    guestPhone: text(input.guestPhone) || null,
    guestEmail: text(input.guestEmail) || null,
    guestTelegram: telegramRef,
    telegramUserId: text(input.telegramUserId) || null,
    telegramChatId: text(input.telegramChatId) || null,
    checkInAt: toIsoDate(text(input.checkInAt)),
    checkOutAt: toIsoDate(text(input.checkOutAt)),
    guestCount: typeof input.guestCount === 'number' && input.guestCount > 0
      ? Math.round(input.guestCount)
      : null,
    propertyId: text(input.propertyId ?? input.propertyReference) || null,
    propertyLabel: text(input.propertyLabel ?? input.propertyReference) || null,
    ownerId: text(input.ownerId) || null,
    bookingReference: text(input.bookingReference) || null,
    externalSourceId: text(input.externalSourceId) || null,
    sourceMessageId: text(input.sourceMessageId) || null,
    rawMessageText: text(input.rawMessageText) || null,
    hasMaintenanceIssue: input.hasMaintenanceIssue === true,
    metadata: input.metadata ?? {},
  };
}

function hasGuestContact(input: NormalizedInboundBookingRequest): boolean {
  return Boolean(
    input.guestPhone
    || input.guestEmail
    || input.guestTelegram
    || input.telegramUserId,
  );
}

export function computeMissingInboundFields(input: NormalizedInboundBookingRequest): string[] {
  const missing: string[] = [];
  if (!input.guestName && !hasGuestContact(input)) missing.push('guest_contact');
  if (!input.guestName && hasGuestContact(input)) missing.push('guest_name');
  if (!input.propertyId && !input.propertyLabel) missing.push('property');
  if (!input.checkInAt || !input.checkOutAt) missing.push('dates');
  if (!input.guestCount) missing.push('guest_count');
  return missing;
}

export function computeNextRequiredActions(
  missing: string[],
  record: BookingOpsRecord | null,
): string[] {
  const actions: string[] = [];
  if (missing.includes('property')) actions.push('attach_property');
  if (missing.includes('guest_contact')) actions.push('request_missing_data');
  if (missing.includes('guest_name')) actions.push('request_missing_data');
  if (missing.includes('dates')) actions.push('collect_dates');
  if (record?.guestIntake?.intakeStatus === 'fallback_required') actions.push('create_fallback');
  if (actions.length === 0) actions.push('continue_intake_flow');
  return actions;
}

function guestContactRef(input: NormalizedInboundBookingRequest): string | null {
  return normalizePhone(input.guestPhone)
    ?? normalizeEmail(input.guestEmail)
    ?? text(input.guestTelegram)?.toLowerCase()
    ?? (input.telegramUserId ? `tg:${input.telegramUserId}` : null);
}

export async function findOrCreateGuestFromInbound(
  input: NormalizedInboundBookingRequest,
): Promise<{ guestId: string | null; matchedRecordId: string | null }> {
  const contactRef = guestContactRef(input);
  if (!contactRef) return { guestId: null, matchedRecordId: null };

  const { data } = await supabase
    .from('booking_ops_records')
    .select('id, guest_phone, guest_email, guest_telegram')
    .or([
      input.guestPhone ? `guest_phone.eq.${input.guestPhone}` : null,
      input.guestEmail ? `guest_email.eq.${input.guestEmail}` : null,
      input.guestTelegram ? `guest_telegram.eq.${input.guestTelegram}` : null,
    ].filter(Boolean).join(','))
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    return { guestId: contactRef, matchedRecordId: text((data as { id: string }).id) };
  }
  return { guestId: contactRef, matchedRecordId: null };
}

async function findMatchingBookingRecord(
  input: NormalizedInboundBookingRequest,
): Promise<BookingOpsRecord | null> {
  if (input.bookingReference) {
    const byId = await getBookingOpsRecord(input.bookingReference);
    if (byId) return byId;
    const { data } = await supabase
      .from('booking_ops_records')
      .select('id')
      .eq('booking_id', input.bookingReference)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return getBookingOpsRecord(text((data as { id: string }).id));
  }

  const filters: string[] = [];
  if (input.guestPhone) filters.push(`guest_phone.eq.${input.guestPhone}`);
  if (input.guestEmail) filters.push(`guest_email.eq.${input.guestEmail}`);
  if (input.guestTelegram) filters.push(`guest_telegram.eq.${input.guestTelegram}`);
  if (filters.length === 0) return null;

  const { data: candidates } = await supabase
    .from('booking_ops_records')
    .select('*')
    .or(filters.join(','))
    .order('updated_at', { ascending: false })
    .limit(20);

  for (const row of (candidates ?? []) as Array<Record<string, unknown>>) {
    const sameDates = (!input.checkInAt && !input.checkOutAt)
      || (row.check_in_at === input.checkInAt && row.check_out_at === input.checkOutAt);
    const sameProperty = (!input.propertyId && !input.propertyLabel)
      || row.property_id === input.propertyId
      || row.property_label === input.propertyLabel;
    if (sameDates && sameProperty) {
      return getBookingOpsRecord(text(row.id));
    }
  }
  return null;
}

function toCreateInput(
  input: NormalizedInboundBookingRequest,
  source: InboundBookingSource,
): CreateBookingOpsInput {
  const guestName = input.guestName
    ?? (hasGuestContact(input) ? 'Гость (входящая заявка)' : 'Гость (без контакта)');
  return {
    bookingId: input.bookingReference,
    guestName,
    guestPhone: input.guestPhone,
    guestEmail: input.guestEmail,
    guestTelegram: input.guestTelegram,
    propertyId: input.propertyId,
    propertyLabel: input.propertyLabel,
    otaSource: source === 'channel_manager_placeholder' ? 'channel_manager' : source,
    checkInAt: input.checkInAt,
    checkOutAt: input.checkOutAt,
    guestCount: input.guestCount,
    notes: input.rawMessageText
      ? `Входящая заявка (${source}): ${input.rawMessageText.slice(0, 240)}`
      : `Входящая заявка (${source})`,
    ...(input.hasMaintenanceIssue ? { blockerReason: 'Сообщено о проблеме при заявке' } : {}),
  };
}

export async function findOrCreateBookingFromInbound(
  input: NormalizedInboundBookingRequest,
  source: InboundBookingSource,
): Promise<{ record: BookingOpsRecord; created: boolean }> {
  const existing = await findMatchingBookingRecord(input);
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (!existing.guestPhone && input.guestPhone) patch.guestPhone = input.guestPhone;
    if (!existing.guestEmail && input.guestEmail) patch.guestEmail = input.guestEmail;
    if (!existing.guestTelegram && input.guestTelegram) patch.guestTelegram = input.guestTelegram;
    if (!existing.checkInAt && input.checkInAt) patch.checkInAt = input.checkInAt;
    if (!existing.checkOutAt && input.checkOutAt) patch.checkOutAt = input.checkOutAt;
    if (!existing.propertyId && input.propertyId) patch.propertyId = input.propertyId;
    if (!existing.propertyLabel && input.propertyLabel) patch.propertyLabel = input.propertyLabel;
    if (Object.keys(patch).length > 0) {
      const updated = await updateBookingOpsRecord(existing.id, patch, { actorType: 'system' });
      if (updated.ok && updated.record) return { record: updated.record, created: false };
    }
    return { record: existing, created: false };
  }

  const result = await createBookingOpsRecord(toCreateInput(input, source), { actorType: 'system' });
  if (!result.ok || !result.record) {
    throw new Error(result.error ?? 'booking_create_failed');
  }
  return { record: result.record, created: true };
}

export async function attachBookingToOwnerProperty(
  bookingOpsRecordId: string,
  input: { ownerId?: string | null; propertyId?: string | null; propertyLabel?: string | null },
): Promise<BookingOpsRecord | null> {
  const patch: Record<string, unknown> = {};
  if (input.propertyId) patch.propertyId = input.propertyId;
  if (input.propertyLabel) patch.propertyLabel = input.propertyLabel;
  if (Object.keys(patch).length === 0) return getBookingOpsRecord(bookingOpsRecordId);

  const result = await updateBookingOpsRecord(bookingOpsRecordId, patch, { actorType: 'admin' });
  if (!result.ok || !result.record) return null;

  if (input.ownerId) {
    await recordBookingOpsEvent({
      bookingOpsRecordId,
      eventType: 'booking_updated',
      title: 'Объект привязан к заявке',
      description: 'Входящая заявка связана с объектом.',
      actorType: 'admin',
      metadata: { ownerId: input.ownerId, propertyId: input.propertyId ?? null },
      dedupeKey: `intake-attach-property:${bookingOpsRecordId}:${input.propertyId ?? 'label'}`,
    });
  }
  return result.record;
}

async function preferredGuestChannel(record: BookingOpsRecord): Promise<BookingOpsCommunicationChannel> {
  if (record.guestTelegram) return 'telegram';
  if (record.guestEmail) return 'email';
  return 'manual';
}

async function upsertInboundCommunication(input: {
  record: BookingOpsRecord;
  purpose: BookingOpsCommunicationPurpose;
  templateKey: string;
  messageText: string;
  actorType?: 'guest' | 'admin';
  channel?: BookingOpsCommunicationChannel;
}): Promise<string | null> {
  const channel = input.channel ?? await preferredGuestChannel(input.record);
  const actorType = input.actorType ?? 'guest';
  const autoSendDecision = await canAutoSendCommunicationIntent({
    actorType,
    purpose: input.purpose,
    channel,
    messageText: input.messageText,
    metadata: { messageType: input.purpose },
  }, {
    bookingId: input.record.bookingId,
    propertyId: input.record.propertyId,
    guestRef: input.record.guestTelegram ?? input.record.guestEmail ?? input.record.guestPhone,
  });
  const metadata = attachAutoSendDecisionMetadata(
    { messageType: input.purpose, intakeAutopilot: true },
    autoSendDecision,
  );
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('booking_ops_communication_intents')
    .select('id')
    .eq('booking_ops_record_id', input.record.id)
    .eq('purpose', input.purpose)
    .in('status', ['draft_ready', 'waiting_for_external_input'])
    .maybeSingle();

  if (existing) {
    await supabase
      .from('booking_ops_communication_intents')
      .update({
        message_text: input.messageText,
        message_template_key: input.templateKey,
        channel,
        metadata,
        updated_at: now,
      })
      .eq('id', (existing as { id: string }).id);
    return (existing as { id: string }).id;
  }

  const id = randomUUID();
  await supabase.from('booking_ops_communication_intents').insert({
    id,
    booking_ops_record_id: input.record.id,
    booking_id: input.record.bookingId,
    related_task_id: null,
    actor_type: actorType,
    actor_label: input.record.guestName ?? 'Гость',
    purpose: input.purpose,
    channel,
    status: 'draft_ready',
    message_text: input.messageText,
    message_template_key: input.templateKey,
    metadata,
    created_at: now,
    updated_at: now,
  });
  return id;
}

export async function queueInitialBookingCommunications(
  bookingOpsRecordId: string,
  context?: { missingFields?: string[] },
): Promise<string[]> {
  const record = await getBookingOpsRecord(bookingOpsRecordId);
  if (!record) return [];

  const created: string[] = [];
  const guest = record.guestName?.trim() || 'гость';
  const property = record.propertyLabel?.trim() || record.propertyId?.trim() || 'объект';
  const missing = context?.missingFields ?? computeMissingInboundFields({
    guestName: record.guestName,
    guestPhone: record.guestPhone,
    guestEmail: record.guestEmail,
    guestTelegram: record.guestTelegram,
    telegramUserId: null,
    telegramChatId: null,
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt,
    guestCount: record.guestCount ?? null,
    propertyId: record.propertyId,
    propertyLabel: record.propertyLabel,
    ownerId: null,
    bookingReference: record.bookingId,
    externalSourceId: null,
    sourceMessageId: null,
    rawMessageText: null,
    hasMaintenanceIssue: false,
    metadata: {},
  });

  const ackId = await upsertInboundCommunication({
    record,
    purpose: 'neutral_booking_acknowledgement',
    templateKey: 'guest.booking_ack.v1',
    messageText: `Здравствуйте, ${guest}. Мы получили вашу заявку по объекту ${property}. Скоро вернёмся с уточнениями.`,
  });
  if (ackId) created.push(ackId);

  if (missing.includes('guest_contact') || missing.includes('guest_name')) {
    const id = await upsertInboundCommunication({
      record,
      purpose: 'request_missing_guest_data',
      templateKey: 'guest.missing_data.v1',
      messageText: 'Здравствуйте! Чтобы продолжить бронирование, пришлите, пожалуйста, имя и контакт для связи.',
    });
    if (id) created.push(id);
  }

  if (record.checkInAt) {
    const id = await upsertInboundCommunication({
      record,
      purpose: 'request_arrival_time',
      templateKey: 'guest.arrival_time.v1',
      messageText: `Здравствуйте, ${guest}. Подскажите, пожалуйста, планируемое время заезда.`,
    });
    if (id) created.push(id);
  }

  const internalId = await upsertInboundCommunication({
    record,
    purpose: 'internal_status_notice',
    templateKey: 'internal.intake_received.v1',
    messageText: `Новая входящая заявка: ${guest}, объект ${property}. Статус intake обработан автоматически.`,
    actorType: 'admin',
    channel: 'internal',
  });
  if (internalId) created.push(internalId);

  return created;
}

export async function initializeBookingAutomationStack(
  bookingOpsRecordId: string,
  context?: { missingFields?: string[]; source?: InboundBookingSource },
): Promise<{ initializedModules: string[] }> {
  const modules: string[] = ['lifecycle_gates', 'legal_payment_placeholders', 'guest_intake_autopilot'];

  await initializeCheckinExecutionBaseline(bookingOpsRecordId);
  modules.push('checkin_execution_baseline');

  await initializeInStayCheckoutBaseline(bookingOpsRecordId);
  modules.push('instay_checkout_baseline');

  await recomputeBookingCheckinReadiness(bookingOpsRecordId);
  modules.push('pre_checkin_readiness');

  await syncBookingOpsTasksForRecordId(bookingOpsRecordId);
  modules.push('ops_tasks');

  const lifecycle = await getLifecycleStatus(bookingOpsRecordId);
  if (lifecycle.ok) modules.push('lifecycle_sync');

  const comms = await queueInitialBookingCommunications(bookingOpsRecordId, context);
  if (comms.length > 0) modules.push('communication_intents');

  await recordBookingOpsEvent({
    bookingOpsRecordId,
    eventType: 'booking_updated',
    title: 'Автоматизация заявки запущена',
    description: `Входящая заявка инициализировала модули: ${modules.join(', ')}.`,
    actorType: 'system',
    metadata: {
      source: context?.source ?? 'inbound_intake',
      modules,
      missingFields: context?.missingFields ?? [],
    },
    dedupeKey: `intake-automation:${bookingOpsRecordId}`,
  });

  return { initializedModules: modules };
}

async function initializeBookingAvailability(
  record: BookingOpsRecord,
): Promise<{ status: AvailabilityConflictStatus; initialized: boolean }> {
  if (!record.propertyId || !record.checkInAt || !record.checkOutAt) {
    const check = await checkAvailabilityConflict(
      { bookingId: record.id },
      { checkType: 'pre_intake' },
    );
    return { status: check.status, initialized: false };
  }
  const hold = await createAvailabilityHold({
    bookingId: record.id,
    propertyId: record.propertyId,
    dateFrom: record.checkInAt,
    dateTo: record.checkOutAt,
    source: 'booking_intake',
    holdMinutes: 30,
    safeSummary: 'Даты заявки временно удерживаются на время проверки.',
  }, { metadata: { intake_autopilot: true } });
  return {
    status: String(hold.conflict_status ?? 'failed') as AvailabilityConflictStatus,
    initialized: hold.status === 'active',
  };
}

async function getIntakeEventByKey(idempotencyKey: string): Promise<InboundBookingIntakeEvent | null> {
  const { data, error } = await supabase
    .from('booking_inbound_intake_events')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error || !data) return null;
  return mapEventRow(data as IntakeEventRow);
}

async function upsertIntakeEvent(input: {
  id?: string;
  source: InboundBookingSource;
  sourceRef?: string | null;
  idempotencyKey: string;
  status: InboundIntakeStatus;
  bookingId?: string | null;
  guestId?: string | null;
  ownerId?: string | null;
  propertyId?: string | null;
  normalizedPayload: Record<string, unknown>;
  missingFields: string[];
  automationResult?: Record<string, unknown>;
  failureReason?: string | null;
  duplicateOfBookingId?: string | null;
}): Promise<InboundBookingIntakeEvent> {
  const now = new Date().toISOString();
  const row = {
    id: input.id ?? randomUUID(),
    source: input.source,
    source_ref: input.sourceRef ?? null,
    idempotency_key: input.idempotencyKey,
    status: input.status,
    booking_id: input.bookingId ?? null,
    guest_id: input.guestId ?? null,
    owner_id: input.ownerId ?? null,
    property_id: input.propertyId ?? null,
    normalized_payload: input.normalizedPayload,
    missing_fields: input.missingFields,
    automation_result: input.automationResult ?? {},
    failure_reason: input.failureReason ?? null,
    duplicate_of_booking_id: input.duplicateOfBookingId ?? null,
    updated_at: now,
    ...(input.id ? {} : { created_at: now }),
  };

  const { data, error } = await supabase
    .from('booking_inbound_intake_events')
    .upsert(row, { onConflict: 'idempotency_key' })
    .select('*')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'intake_event_upsert_failed');
  return mapEventRow(data as IntakeEventRow);
}

export async function getInboundBookingIntakeStatus(
  lookup: { intakeId?: string; bookingId?: string },
): Promise<InboundBookingIntakeResult | null> {
  let event: InboundBookingIntakeEvent | null = null;

  if (lookup.intakeId) {
    const { data } = await supabase
      .from('booking_inbound_intake_events')
      .select('*')
      .eq('id', lookup.intakeId)
      .maybeSingle();
    if (data) event = mapEventRow(data as IntakeEventRow);
  } else if (lookup.bookingId) {
    const { data } = await supabase
      .from('booking_inbound_intake_events')
      .select('*')
      .eq('booking_id', lookup.bookingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) event = mapEventRow(data as IntakeEventRow);
  }

  if (!event) return null;

  const automation = event.automationResult;
  return {
    intakeId: event.id,
    bookingId: event.bookingId,
    guestId: event.guestId,
    intakeStatus: event.status,
    initializedModules: Array.isArray(automation.initializedModules)
      ? automation.initializedModules.map(String)
      : [],
    createdCommunicationIntents: Array.isArray(automation.createdCommunicationIntents)
      ? automation.createdCommunicationIntents.map(String)
      : [],
    missingRequiredFields: event.missingFields,
    nextRequiredActions: Array.isArray(automation.nextRequiredActions)
      ? automation.nextRequiredActions.map(String)
      : [],
    fallbackCreated: automation.fallbackCreated === true,
    duplicateOfBookingId: event.duplicateOfBookingId,
    safeSummary: text(automation.safeSummary) || 'Статус входящей заявки доступен.',
  };
}

export async function listInboundIntakeEvents(options?: {
  limit?: number;
  status?: InboundIntakeStatus;
}): Promise<InboundBookingIntakeEvent[]> {
  const limit = options?.limit ?? 50;
  let query = supabase
    .from('booking_inbound_intake_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (options?.status) query = query.eq('status', options.status);
  const { data, error } = await query;
  if (error) return [];
  return ((data ?? []) as IntakeEventRow[]).map(mapEventRow);
}

export function validatePublicWebIntakePayload(body: Record<string, unknown>): string | null {
  const normalized = normalizeInboundBookingRequest(body, 'web');
  if (!normalized.guestName && !hasGuestContact(normalized)) {
    return 'Укажите имя гостя или контакт для связи.';
  }
  if (!normalized.rawMessageText && !normalized.checkInAt && !normalized.propertyLabel && !normalized.propertyId) {
    return 'Добавьте даты, объект или текст заявки.';
  }
  return null;
}

const webRateLimit = new Map<string, { count: number; resetAt: number }>();
const WEB_RATE_LIMIT_MAX = 10;
const WEB_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export function checkWebIntakeRateLimit(clientKey: string): boolean {
  const key = clientKey.slice(0, 128) || 'unknown';
  const now = Date.now();
  const entry = webRateLimit.get(key);
  if (!entry || entry.resetAt <= now) {
    webRateLimit.set(key, { count: 1, resetAt: now + WEB_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= WEB_RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

export async function processInboundBookingRequest(
  rawInput: InboundBookingRequest,
  source: InboundBookingSource,
  options?: ProcessInboundBookingOptions,
): Promise<InboundBookingIntakeResult> {
  const normalized = normalizeInboundBookingRequest(rawInput, source);
  const idempotencyKey = computeInboundIdempotencyKey(normalized, source);
  const missingFields = computeMissingInboundFields(normalized);
  const safePayload = {
    guestName: normalized.guestName,
    hasPhone: Boolean(normalized.guestPhone),
    hasEmail: Boolean(normalized.guestEmail),
    hasTelegram: Boolean(normalized.guestTelegram),
    checkInAt: normalized.checkInAt,
    checkOutAt: normalized.checkOutAt,
    guestCount: normalized.guestCount,
    propertyId: normalized.propertyId,
    propertyLabel: normalized.propertyLabel,
    source,
  };

  const existingEvent = await getIntakeEventByKey(idempotencyKey);
  if (
    existingEvent?.bookingId
    && !options?.force
    && (!options?.action || options.action === 'process')
  ) {
    return {
      intakeId: existingEvent.id,
      bookingId: existingEvent.bookingId,
      guestId: existingEvent.guestId,
      intakeStatus: 'duplicate',
      initializedModules: [],
      createdCommunicationIntents: [],
      missingRequiredFields: existingEvent.missingFields,
      nextRequiredActions: ['none'],
      fallbackCreated: false,
      duplicateOfBookingId: existingEvent.bookingId,
      safeSummary: 'Повторная заявка — бронь уже создана.',
    };
  }

  if (options?.action === 'mark_duplicate' && options.duplicateOfBookingId) {
    const event = await upsertIntakeEvent({
      id: existingEvent?.id,
      source,
      sourceRef: normalized.sourceMessageId ?? normalized.externalSourceId,
      idempotencyKey,
      status: 'duplicate',
      bookingId: null,
      guestId: guestContactRef(normalized),
      ownerId: normalized.ownerId,
      propertyId: normalized.propertyId,
      normalizedPayload: safePayload,
      missingFields,
      duplicateOfBookingId: options.duplicateOfBookingId,
      automationResult: { safeSummary: 'Заявка отмечена как дубликат.' },
    });
    return {
      intakeId: event.id,
      bookingId: null,
      guestId: event.guestId,
      intakeStatus: 'duplicate',
      initializedModules: [],
      createdCommunicationIntents: [],
      missingRequiredFields: missingFields,
      nextRequiredActions: ['none'],
      fallbackCreated: false,
      duplicateOfBookingId: options.duplicateOfBookingId,
      safeSummary: 'Заявка отмечена как дубликат.',
    };
  }

  try {
    const { guestId } = await findOrCreateGuestFromInbound(normalized);
    let record: BookingOpsRecord;
    let created = false;

    if (options?.action === 'attach_property' && options.intakeEventId) {
      const status = await getInboundBookingIntakeStatus({ intakeId: options.intakeEventId });
      if (!status?.bookingId) throw new Error('booking_not_found');
      const attached = await attachBookingToOwnerProperty(status.bookingId, {
        ownerId: normalized.ownerId,
        propertyId: options.attachPropertyId ?? normalized.propertyId,
        propertyLabel: options.attachPropertyLabel ?? normalized.propertyLabel,
      });
      if (!attached) throw new Error('attach_property_failed');
      record = attached;
    } else if (options?.action === 'attach_guest' && options.intakeEventId) {
      const status = await getInboundBookingIntakeStatus({ intakeId: options.intakeEventId });
      if (!status?.bookingId) throw new Error('booking_not_found');
      const updated = await updateBookingOpsRecord(status.bookingId, {
        guestName: options.attachGuestName ?? normalized.guestName ?? undefined,
        guestPhone: options.attachGuestPhone ?? normalized.guestPhone ?? undefined,
        guestEmail: options.attachGuestEmail ?? normalized.guestEmail ?? undefined,
        guestTelegram: options.attachGuestTelegram ?? normalized.guestTelegram ?? undefined,
      }, { actorType: 'admin' });
      if (!updated.ok || !updated.record) throw new Error('attach_guest_failed');
      record = updated.record;
    } else {
      const bookingResult = await findOrCreateBookingFromInbound(normalized, source);
      record = bookingResult.record;
      created = bookingResult.created;

      if (normalized.ownerId || normalized.propertyId) {
        const attached = await attachBookingToOwnerProperty(record.id, {
          ownerId: normalized.ownerId,
          propertyId: normalized.propertyId,
          propertyLabel: normalized.propertyLabel,
        });
        if (attached) record = attached;
      }
    }

    let initializedModules: string[] = [];
    let createdCommunicationIntents: string[] = [];
    const fallbackCreated = record.guestIntake?.intakeStatus === 'fallback_required';
    let availabilityStatus: AvailabilityConflictStatus = 'missing_data';

    try {
      const availability = await initializeBookingAvailability(record);
      availabilityStatus = availability.status;
      if (availability.initialized) initializedModules.push('availability_hold');
    } catch {
      availabilityStatus = 'failed';
    }

    if (created || options?.force || options?.action === 'process' || !options?.action) {
      const stack = await initializeBookingAutomationStack(record.id, { missingFields, source });
      initializedModules = [...initializedModules, ...stack.initializedModules];
      createdCommunicationIntents = await queueInitialBookingCommunications(record.id, { missingFields });
    }

    if (options?.action === 'request_missing_data') {
      createdCommunicationIntents = await queueInitialBookingCommunications(record.id, { missingFields });
    }

    const nextRequiredActions = computeNextRequiredActions(missingFields, record);
    const intakeStatus: InboundIntakeStatus = missingFields.includes('property')
      ? 'needs_review'
      : 'processed';
    const safeSummary = created
      ? `Создана бронь и запущена автоматизация (${initializedModules.length} модулей).`
      : 'Заявка обновлена, автоматизация синхронизирована.';

    const event = await upsertIntakeEvent({
      id: existingEvent?.id,
      source,
      sourceRef: normalized.sourceMessageId ?? normalized.externalSourceId,
      idempotencyKey,
      status: intakeStatus,
      bookingId: record.id,
      guestId,
      ownerId: normalized.ownerId,
      propertyId: record.propertyId,
      normalizedPayload: safePayload,
      missingFields,
      automationResult: {
        initializedModules,
        createdCommunicationIntents,
        nextRequiredActions,
        fallbackCreated,
        safeSummary,
        created,
        availabilityStatus,
      },
    });

    return {
      intakeId: event.id,
      bookingId: record.id,
      guestId,
      intakeStatus,
      initializedModules,
      createdCommunicationIntents,
      missingRequiredFields: missingFields,
      nextRequiredActions,
      fallbackCreated,
      duplicateOfBookingId: null,
      safeSummary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'intake_failed';
    const event = await upsertIntakeEvent({
      id: existingEvent?.id,
      source,
      sourceRef: normalized.sourceMessageId ?? normalized.externalSourceId,
      idempotencyKey,
      status: 'failed',
      guestId: guestContactRef(normalized),
      ownerId: normalized.ownerId,
      propertyId: normalized.propertyId,
      normalizedPayload: safePayload,
      missingFields,
      failureReason: message,
      automationResult: { safeSummary: 'Не удалось обработать заявку.' },
    });
    return {
      intakeId: event.id,
      bookingId: null,
      guestId: guestContactRef(normalized),
      intakeStatus: 'failed',
      initializedModules: [],
      createdCommunicationIntents: [],
      missingRequiredFields: missingFields,
      nextRequiredActions: ['retry_or_manual'],
      fallbackCreated: false,
      duplicateOfBookingId: null,
      safeSummary: 'Не удалось обработать заявку.',
    };
  }
}

export async function listInboundIntakeEventsEnriched(limit = 30): Promise<Array<InboundBookingIntakeEvent & {
  guestContactStatus: string;
  propertyStatus: string;
  datesStatus: string;
  nextAction: string | null;
}>> {
  const events = await listInboundIntakeEvents({ limit });
  return events.map((event) => ({
    ...event,
    guestContactStatus: event.missingFields.includes('guest_contact') ? 'needs_contact' : 'known',
    propertyStatus: event.missingFields.includes('property') ? 'needs_property' : 'known',
    datesStatus: event.missingFields.includes('dates') ? 'missing' : 'known',
    nextAction: (event.automationResult.nextRequiredActions as string[] | undefined)?.[0] ?? null,
  }));
}

export async function verifyIntakeAutomationForRecord(
  bookingOpsRecordId: string,
): Promise<{
  lifecycleReady: boolean;
  checkinBaseline: boolean;
  instayBaseline: boolean;
  communicationCount: number;
  riskyPurposes: string[];
}> {
  const lifecycle = await getLifecycleStatus(bookingOpsRecordId);
  const comms = await listBookingOpsCommunicationsForRecord(bookingOpsRecordId);
  const risky = new Set([
    'request_guest_documents',
    'request_contract_confirmation',
    'request_deposit_payment',
    'request_mvd_data',
    'send_checkin_instructions',
    'checkin_instructions',
  ]);
  const communicationList = comms.ok ? comms.communications : [];
  const riskyPurposes = communicationList
    .filter((item) => risky.has(item.purpose))
    .map((item) => item.purpose);

  const { data: checkin } = await supabase
    .from('booking_checkin_execution')
    .select('id')
    .eq('booking_id', bookingOpsRecordId)
    .maybeSingle();
  const { data: instay } = await supabase
    .from('booking_instay_checkout')
    .select('id')
    .eq('booking_id', bookingOpsRecordId)
    .maybeSingle();

  return {
    lifecycleReady: lifecycle.ok === true,
    checkinBaseline: Boolean(checkin),
    instayBaseline: Boolean(instay),
    communicationCount: communicationList.length,
    riskyPurposes,
  };
}
