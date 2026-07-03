import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { recomputeGuestLegalReadiness, type GuestLegalReadiness } from './guest-legal-deposit-mvd-execution';
import { ensurePhysicalTasks, type PhysicalReadiness } from './physical-readiness-execution';
import { getBookingOpsRecord } from './repository';
import type { BookingOpsRecord } from './types';

export const GUEST_INTAKE_REQUIRED_FIELDS = [
  'full_name', 'contact', 'guest_count', 'arrival_window', 'identity_status',
  'citizenship_status', 'consent_acknowledged',
] as const;

export type GuestIntakeRequiredField = (typeof GUEST_INTAKE_REQUIRED_FIELDS)[number];
export type GuestIntakeDataStatus = 'missing' | 'partial' | 'complete' | 'verified' | 'blocked';
export type CheckinReleaseStatus = 'blocked' | 'ready_for_draft' | 'draft_prepared' | 'released_simulated' | 'cancelled';

export type GuestIntakeFields = {
  fullName?: string;
  phone?: string;
  email?: string;
  telegramChatId?: string;
  telegramUsername?: string;
  guestCount?: number;
  arrivalWindow?: string;
  identityStatus?: 'missing' | 'partial' | 'complete' | 'verified';
  citizenshipStatus?: string;
  consentAcknowledged?: boolean;
};

export type GuestIntakeValidation = {
  isComplete: boolean;
  dataStatus: GuestIntakeDataStatus;
  missingFields: GuestIntakeRequiredField[];
  validationErrors: string[];
  blockerReasons: string[];
};

export function computeCheckinReleaseGate(input: {
  validation: GuestIntakeValidation;
  intakeStatus: string;
  legalStatus: string;
  physicalReady: boolean;
}): { canPrepareCheckinReleaseDraft: boolean; blockerReasons: string[] } {
  const blockerReasons = [
    ...input.validation.blockerReasons,
    ...(input.intakeStatus === 'fallback_required' ? ['guest_intake_needs_operator'] : []),
    ...(input.legalStatus === 'ready_for_checkin' ? [] : ['legal_gate_blocked']),
    ...(input.physicalReady ? [] : ['physical_readiness_blocked']),
  ];
  const unique = [...new Set(blockerReasons)];
  return { canPrepareCheckinReleaseDraft: unique.length === 0, blockerReasons: unique };
}

type SessionRow = {
  id: string;
  booking_ops_record_id: string;
  booking_id: string | null;
  property_id: string | null;
  intake_status: string;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  required_fields: GuestIntakeRequiredField[] | null;
  submitted_fields: GuestIntakeFields | null;
  missing_fields: string[] | null;
  validation_errors: string[] | null;
  operator_notes: string | null;
  fallback_reason: string | null;
  escalation_status: string;
  completed_at: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  event_type: string;
  event_payload: Record<string, unknown> | null;
  actor_type: string;
  actor_id: string | null;
  created_at: string;
};

type ReleaseRow = {
  id: string;
  booking_id: string;
  guest_intake_session_id: string;
  status: CheckinReleaseStatus;
  blocker_reasons: string[] | null;
  draft_channel: 'telegram' | 'manual';
  draft_recipient: string | null;
  draft_body: string | null;
  prepared_at: string | null;
  approved_at: string | null;
  released_simulated_at: string | null;
  created_at: string;
  updated_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PHONE_RE = /^\+?[0-9 ()-]{7,24}$/u;

function text(value: unknown, max = 1000): string {
  return String(value ?? '').trim().slice(0, max);
}

function requireBookingId(value: unknown): string {
  const id = text(value, 64);
  if (!UUID_RE.test(id)) throw new Error('Некорректный ID брони.');
  return id;
}

function cleanFields(value: unknown): GuestIntakeFields {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const count = Number(input.guestCount);
  return {
    fullName: text(input.fullName, 160) || undefined,
    phone: text(input.phone, 40) || undefined,
    email: text(input.email, 160) || undefined,
    telegramChatId: text(input.telegramChatId, 80) || undefined,
    telegramUsername: text(input.telegramUsername, 80).replace(/^@/u, '') || undefined,
    guestCount: Number.isInteger(count) ? count : undefined,
    arrivalWindow: text(input.arrivalWindow, 160) || undefined,
    identityStatus: ['missing', 'partial', 'complete', 'verified'].includes(text(input.identityStatus))
      ? text(input.identityStatus) as GuestIntakeFields['identityStatus']
      : undefined,
    citizenshipStatus: text(input.citizenshipStatus, 120) || undefined,
    consentAcknowledged: input.consentAcknowledged === true,
  };
}

export function validateGuestIntakeFields(value: unknown): GuestIntakeValidation {
  const fields = cleanFields(value);
  const missing: GuestIntakeRequiredField[] = [];
  const errors: string[] = [];
  if (!fields.fullName) missing.push('full_name');
  if (!fields.phone && !fields.telegramChatId && !fields.telegramUsername) missing.push('contact');
  if (!fields.guestCount) missing.push('guest_count');
  if (!fields.arrivalWindow) missing.push('arrival_window');
  if (!fields.identityStatus || !['complete', 'verified'].includes(fields.identityStatus)) missing.push('identity_status');
  if (!fields.citizenshipStatus) missing.push('citizenship_status');
  if (!fields.consentAcknowledged) missing.push('consent_acknowledged');
  if (fields.phone && !PHONE_RE.test(fields.phone)) errors.push('Телефон указан в неверном формате.');
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(fields.email)) errors.push('E-mail указан в неверном формате.');
  if (fields.guestCount !== undefined && fields.guestCount < 1) errors.push('Количество гостей должно быть больше нуля.');
  const isComplete = missing.length === 0 && errors.length === 0;
  const presentCount = Object.values(fields).filter((item) => item !== undefined && item !== false).length;
  return {
    isComplete,
    dataStatus: isComplete ? (fields.identityStatus === 'verified' ? 'verified' : 'complete') : presentCount ? 'partial' : 'missing',
    missingFields: missing,
    validationErrors: errors,
    blockerReasons: isComplete
      ? []
      : ['guest_intake_incomplete', ...(missing.length ? ['guest_required_fields_missing'] : [])],
  };
}

async function requireRecord(bookingId: unknown): Promise<BookingOpsRecord> {
  const id = requireBookingId(bookingId);
  const record = await getBookingOpsRecord(id);
  if (!record) throw new Error('Бронь не найдена.');
  return record;
}

async function addEvent(session: SessionRow, eventType: string, payload: Record<string, unknown>, actorType = 'system', actorId?: string) {
  const { error } = await supabase.from('booking_ops_guest_intake_events').insert({
    id: randomUUID(), session_id: session.id, booking_id: session.booking_ops_record_id,
    event_type: eventType, event_payload: payload, actor_type: actorType,
    actor_id: text(actorId, 160) || null,
  });
  if (error) throw new Error(error.message);
}

async function getSession(recordId: string): Promise<SessionRow | null> {
  const { data, error } = await supabase.from('booking_ops_guest_intake_sessions')
    .select('*').eq('booking_ops_record_id', recordId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as SessionRow | null;
}

export async function ensureGuestIntakeSession(bookingId: unknown): Promise<SessionRow> {
  const record = await requireRecord(bookingId);
  const existing = await getSession(record.id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_ops_guest_intake_sessions').upsert({
    id: randomUUID(), booking_ops_record_id: record.id, booking_id: record.bookingId,
    property_id: record.propertyId, intake_status: 'not_started', channel: record.guestTelegram ? 'telegram' : 'manual',
    guest_contact_ref: record.guestTelegram ?? record.guestPhone ?? record.guestEmail ?? null,
    telegram_username: record.guestTelegram ?? null, guest_phone: record.guestPhone ?? null,
    guest_email: record.guestEmail ?? null, required_fields: GUEST_INTAKE_REQUIRED_FIELDS,
    submitted_fields: {}, missing_fields: GUEST_INTAKE_REQUIRED_FIELDS, validation_errors: [],
    escalation_status: 'none', created_at: now, updated_at: now,
  }, { onConflict: 'booking_ops_record_id' }).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось создать сбор данных гостя.');
  const session = data as SessionRow;
  await addEvent(session, 'session_created', { draftOnly: true, requiredFields: GUEST_INTAKE_REQUIRED_FIELDS });
  return session;
}

function fieldLabels(fields: readonly string[]): string[] {
  const labels: Record<string, string> = {
    full_name: 'имя и фамилия', contact: 'телефон или Telegram', guest_count: 'количество гостей',
    arrival_window: 'ожидаемое время прибытия', identity_status: 'статус документов',
    citizenship_status: 'гражданство или статус проживания', consent_acknowledged: 'подтверждение согласия',
  };
  return fields.map((field) => labels[field] ?? field);
}

function guestDraftBody(record: BookingOpsRecord, session: SessionRow, kind: 'initial' | 'reminder'): string {
  const validation = validateGuestIntakeFields(session.submitted_fields);
  const requested = fieldLabels(kind === 'initial' ? GUEST_INTAKE_REQUIRED_FIELDS : validation.missingFields);
  return [
    'Здравствуйте! Для подготовки вашего заезда нужны данные по брони.',
    `Бронь: ${record.bookingId ?? record.id}.`,
    record.propertyLabel ? `Объект: ${record.propertyLabel}.` : null,
    record.checkInAt ? `Дата заезда: ${new Date(record.checkInAt).toLocaleString('ru-RU')}.` : null,
    `${kind === 'initial' ? 'Пожалуйста, укажите' : 'Пожалуйста, дополните'}: ${requested.join(', ')}.`,
    'Инструкции заезда будут подготовлены только после выполнения всех обязательных шагов.',
    'Это черновик сообщения. Автоматическая отправка отключена.',
  ].filter(Boolean).join('\n');
}

async function ensureTelegramDraft(record: BookingOpsRecord, session: SessionRow, actionId: string, body: string) {
  const { data: existing, error: findError } = await supabase.from('booking_ops_telegram_drafts')
    .select('*').eq('booking_ops_record_id', record.id).eq('action_id', actionId)
    .in('status', ['draft', 'copied']).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (findError) throw new Error(findError.message);
  if (existing) return existing;
  const { data, error } = await supabase.from('booking_ops_telegram_drafts').insert({
    id: randomUUID(), booking_ops_record_id: record.id, source_booking_id: record.bookingId,
    telegram_target: session.telegram_username ?? session.telegram_chat_id ?? record.guestTelegram ?? null,
    action_id: actionId, message_text: body, status: 'draft',
    warning: 'Черновик не отправлен. Проверьте получателя и текст вручную.',
    metadata: { draftOnly: true, noExternalSend: true, guestIntakeSessionId: session.id },
  }).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось создать черновик.');
  return data;
}

export async function prepareGuestIntakeDraft(bookingId: unknown, kind: 'initial' | 'reminder' = 'initial') {
  const record = await requireRecord(bookingId);
  const session = await ensureGuestIntakeSession(record.id);
  const draft = await ensureTelegramDraft(record, session, kind === 'initial' ? 'initial_guest_intake' : 'missing_guest_data', guestDraftBody(record, session, kind));
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_ops_guest_intake_sessions').update({
    intake_status: session.intake_status === 'not_started' ? 'waiting_for_guest' : session.intake_status,
    updated_at: now,
  }).eq('id', session.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось обновить сбор данных.');
  await addEvent(data as SessionRow, 'guest_message_draft_created', { draftId: draft.id, kind, sent: false });
  return { session: data as SessionRow, draft };
}

export async function submitGuestIntakeSimulated(bookingId: unknown, value: unknown, actorId?: string) {
  const session = await ensureGuestIntakeSession(bookingId);
  const merged = { ...(session.submitted_fields ?? {}), ...cleanFields(value) };
  const validation = validateGuestIntakeFields(merged);
  const now = new Date().toISOString();
  const status = validation.isComplete ? 'completed' : 'partially_completed';
  const { data, error } = await supabase.from('booking_ops_guest_intake_sessions').update({
    intake_status: status, submitted_fields: merged, missing_fields: validation.missingFields,
    validation_errors: validation.validationErrors, telegram_chat_id: merged.telegramChatId ?? session.telegram_chat_id,
    telegram_username: merged.telegramUsername ?? session.telegram_username,
    guest_phone: merged.phone ?? session.guest_phone, guest_email: merged.email ?? session.guest_email,
    last_guest_activity_at: now, completed_at: validation.isComplete ? now : null, updated_at: now,
  }).eq('id', session.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось сохранить тестовые данные.');
  const updated = data as SessionRow;
  await addEvent(updated, 'guest_submission_received', { simulated: true, submittedKeys: Object.keys(cleanFields(value)) }, 'guest_simulated', actorId);
  await addEvent(updated, validation.isComplete ? 'validation_passed' : 'validation_failed', {
    missingFields: validation.missingFields, validationErrors: validation.validationErrors,
  }, 'system');
  if (validation.isComplete) await addEvent(updated, 'intake_completed', { simulated: true }, 'system');
  return { session: updated, validation };
}

export async function escalateGuestIntake(bookingId: unknown, reason: unknown, operatorId?: string) {
  const record = await requireRecord(bookingId);
  const session = await ensureGuestIntakeSession(record.id);
  const cleanReason = text(reason, 500);
  if (!cleanReason) throw new Error('Укажите причину передачи оператору.');
  const validation = validateGuestIntakeFields(session.submitted_fields);
  const body = [
    'Нужна помощь оператора со сбором данных гостя.', `Бронь: ${record.bookingId ?? record.id}.`,
    `Статус: ${session.intake_status}.`, `Не хватает: ${fieldLabels(validation.missingFields).join(', ') || 'нет'}.`,
    `Причина: ${cleanReason}.`, 'Рекомендуемое действие: связаться с гостем вручную и проверить данные.',
    'Это внутренний черновик. Он не отправлен гостю.',
  ].join('\n');
  const draft = await ensureTelegramDraft(record, session, 'operator_guest_intake', body);
  const { data, error } = await supabase.from('booking_ops_guest_intake_sessions').update({
    intake_status: 'fallback_required', fallback_reason: cleanReason, operator_notes: cleanReason,
    escalation_status: 'draft_prepared', updated_at: new Date().toISOString(),
  }).eq('id', session.id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось создать эскалацию.');
  await addEvent(data as SessionRow, 'operator_escalation_created', { draftId: draft.id, completed: false }, 'operator', operatorId);
  return { session: data as SessionRow, draft };
}

function mapRelease(row: ReleaseRow | null) {
  if (!row) return null;
  return {
    id: row.id, status: row.status, blockerReasons: row.blocker_reasons ?? [],
    draftChannel: row.draft_channel, draftRecipient: row.draft_recipient, draftBody: row.draft_body,
    preparedAt: row.prepared_at, approvedAt: row.approved_at,
    releasedSimulatedAt: row.released_simulated_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function releaseRow(recordId: string): Promise<ReleaseRow | null> {
  const { data, error } = await supabase.from('booking_ops_checkin_release_drafts').select('*').eq('booking_id', recordId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as ReleaseRow | null;
}

export async function getGuestIntakeReleaseSnapshot(bookingId: unknown) {
  const record = await requireRecord(bookingId);
  const session = await ensureGuestIntakeSession(record.id);
  const validation = validateGuestIntakeFields(session.submitted_fields);
  const [legal, physical, release, eventResult, draftResult] = await Promise.all([
    recomputeGuestLegalReadiness(record.id), ensurePhysicalTasks(record.id), releaseRow(record.id),
    supabase.from('booking_ops_guest_intake_events').select('*').eq('session_id', session.id).order('created_at', { ascending: false }).limit(20),
    supabase.from('booking_ops_telegram_drafts').select('*').eq('booking_ops_record_id', record.id)
      .in('action_id', ['initial_guest_intake', 'missing_guest_data', 'operator_guest_intake', 'final_checkin_instructions'])
      .order('created_at', { ascending: false }).limit(20),
  ]);
  if (eventResult.error) throw new Error(eventResult.error.message);
  if (draftResult.error) throw new Error(draftResult.error.message);
  const gate = computeCheckinReleaseGate({
    validation, intakeStatus: session.intake_status, legalStatus: legal.status, physicalReady: physical.finalReady,
  });
  return {
    session, validation, legal, physical, blockers: gate.blockerReasons,
    canPrepareCheckinReleaseDraft: gate.canPrepareCheckinReleaseDraft,
    release: mapRelease(release), events: (eventResult.data ?? []) as EventRow[], drafts: draftResult.data ?? [],
  };
}

function finalDraftBody(record: BookingOpsRecord): string {
  return [
    'Инструкции по заезду подготовлены.', `Бронь: ${record.bookingId ?? record.id}.`,
    record.propertyLabel ? `Объект: ${record.propertyLabel}.` : 'Объект: указан в брони.',
    record.checkInAt ? `Заезд: ${new Date(record.checkInAt).toLocaleString('ru-RU')}.` : 'Время заезда: по правилам объекта.',
    'Доступ: добавьте проверенные инструкции доступа перед ручной отправкой.',
    'Поддержка: добавьте актуальный контакт поддержки.',
    'Правила проживания: используйте подтверждённые правила объекта.',
    'Это финальный черновик. Сообщение гостю не отправлено.',
  ].join('\n');
}

export async function prepareCheckinReleaseDraft(bookingId: unknown, operatorId?: string) {
  const record = await requireRecord(bookingId);
  const snapshot = await getGuestIntakeReleaseSnapshot(record.id);
  if (!snapshot.canPrepareCheckinReleaseDraft) {
    await addEvent(snapshot.session, 'checkin_release_blocked', { blockers: snapshot.blockers }, 'operator', operatorId);
    throw new Error(`Инструкции заблокированы: ${snapshot.blockers.join(', ')}`);
  }
  const body = finalDraftBody(record);
  const telegramDraft = await ensureTelegramDraft(record, snapshot.session, 'final_checkin_instructions', body);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_ops_checkin_release_drafts').upsert({
    id: snapshot.release?.id ?? randomUUID(), booking_id: record.id, property_id: record.propertyId,
    guest_intake_session_id: snapshot.session.id, status: 'draft_prepared', blocker_reasons: [],
    draft_channel: 'telegram', draft_recipient: snapshot.session.telegram_username ?? snapshot.session.telegram_chat_id ?? record.guestTelegram ?? null,
    draft_body: body, prepared_at: snapshot.release?.preparedAt ?? now, approved_at: now,
    metadata: { draftOnly: true, noExternalSend: true, telegramDraftId: telegramDraft.id }, updated_at: now,
  }, { onConflict: 'booking_id' }).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось подготовить инструкции.');
  await addEvent(snapshot.session, 'checkin_release_draft_created', { releaseDraftId: data.id, sent: false }, 'operator', operatorId);
  return { release: mapRelease(data as ReleaseRow), telegramDraft };
}

export async function simulateCheckinRelease(bookingId: unknown, confirmed: unknown, operatorId?: string) {
  if (confirmed !== true) throw new Error('Нужно явно подтвердить тестовую выдачу инструкций.');
  const snapshot = await getGuestIntakeReleaseSnapshot(bookingId);
  if (!snapshot.canPrepareCheckinReleaseDraft || snapshot.release?.status !== 'draft_prepared') {
    throw new Error('Тестовая выдача недоступна: черновик или обязательные проверки не готовы.');
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('booking_ops_checkin_release_drafts').update({
    status: 'released_simulated', released_simulated_at: now, updated_at: now,
    metadata: { draftOnly: true, noExternalSend: true, simulatedRelease: true },
  }).eq('booking_id', snapshot.session.booking_ops_record_id).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Не удалось выполнить тестовую выдачу.');
  await addEvent(snapshot.session, 'release_simulated', { releaseDraftId: data.id, externalCalls: false }, 'test', operatorId);
  return mapRelease(data as ReleaseRow);
}

export type GuestIntakeReleaseSnapshot = Awaited<ReturnType<typeof getGuestIntakeReleaseSnapshot>>;
export type { GuestLegalReadiness, PhysicalReadiness };
