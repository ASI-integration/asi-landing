import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { recordBookingOpsEvent } from './events';
import {
  buildBookingOpsPatchFromGuestSubmission,
  evaluateGuestIntakeState,
  type GuestIntakeSubmission,
} from './guest-intake-state';
import {
  ensureGuestIntakePublicToken,
  mapGuestIntakeSessionRow,
  syncGuestIntakeAutopilot,
} from './guest-intake-autopilot';
import { syncBookingOpsCommunications } from './communication-orchestrator';
import { getBookingOpsRecord, requireBookingOpsRecordScope, updateBookingOpsRecord } from './repository';
import { listBookingOpsTasksForRecord } from './tasks';
import type { BookingOpsGuestIntakeSession, BookingOpsRecord } from './types';

type GuestIntakeSource = 'web' | 'telegram' | 'api';

type GuestIntakeRow = {
  id: string;
  booking_ops_record_id: string;
  booking_id: string | null;
  intake_status: BookingOpsGuestIntakeSession['intakeStatus'];
  missing_fields: string[] | null;
  collected_fields: Record<string, unknown> | null;
  validation_errors: string[] | null;
  channel: BookingOpsGuestIntakeSession['channel'];
  guest_contact_ref: string | null;
  last_guest_activity_at: string | null;
  fallback_reason: string | null;
  generated_message: string | null;
  public_token: string | null;
  token_created_at: string | null;
  token_opened_at: string | null;
  created_at: string;
  updated_at: string;
};

const SAFE_SUBMITTED_FIELD_KEYS = [
  'guestName',
  'phone',
  'email',
  'telegram',
  'arrivalDetails',
  'documentAttachmentRefs',
  'companionGuestDataPresent',
  'contractConfirmed',
  'depositConfirmed',
  'mvdDataPresent',
  'guestCannotProceed',
] as const;

function text(value: unknown, maxLength = 500): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

type ExpectedScope = { accountId: string; propertyId: string };

function guestIntakeExpectedScope(record: BookingOpsRecord): ExpectedScope | undefined {
  const accountId = text(record.accountId, 160);
  const propertyId = text(record.propertyId, 160);
  if (!accountId || accountId === 'legacy') return undefined;
  if (!propertyId) throw new Error('booking_scope_unavailable');
  return { accountId, propertyId };
}

async function revalidateGuestIntakeScope(
  recordId: string,
  expectedScope?: ExpectedScope,
): Promise<void> {
  if (expectedScope) await requireBookingOpsRecordScope(recordId, expectedScope);
}

function normalizeToken(value: unknown): string {
  return text(value, 160).replace(/[^a-zA-Z0-9_-]/g, '');
}

function arrayOfText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, 160)).filter(Boolean).slice(0, 20);
}

export function parseGuestIntakeSubmission(body: Record<string, unknown>): GuestIntakeSubmission {
  return {
    guestName: 'guestName' in body || 'guest_name' in body
      ? text(body.guestName ?? body.guest_name, 160) || null
      : undefined,
    phone: 'phone' in body || 'guestPhone' in body || 'guest_phone' in body
      ? text(body.phone ?? body.guestPhone ?? body.guest_phone, 80) || null
      : undefined,
    email: 'email' in body || 'guestEmail' in body || 'guest_email' in body
      ? text(body.email ?? body.guestEmail ?? body.guest_email, 160) || null
      : undefined,
    telegram: 'telegram' in body || 'guestTelegram' in body || 'guest_telegram' in body
      ? text(body.telegram ?? body.guestTelegram ?? body.guest_telegram, 160) || null
      : undefined,
    arrivalDetails: 'arrivalDetails' in body || 'arrival_details' in body
      ? text(body.arrivalDetails ?? body.arrival_details, 160) || null
      : undefined,
    documentAttachmentRefs: 'documentAttachmentRefs' in body || 'document_attachment_refs' in body
      ? arrayOfText(body.documentAttachmentRefs ?? body.document_attachment_refs)
      : undefined,
    companionGuestDataPresent: body.companionGuestDataPresent === true
      || body.companion_guest_data_present === true,
    contractConfirmed: body.contractConfirmed === true || body.contract_confirmed === true,
    depositConfirmed: body.depositConfirmed === true || body.deposit_confirmed === true,
    mvdDataPresent: body.mvdDataPresent === true || body.mvd_data_present === true,
    guestCannotProceed: body.guestCannotProceed === true || body.guest_cannot_proceed === true,
    fallbackReason: 'fallbackReason' in body || 'fallback_reason' in body
      ? text(body.fallbackReason ?? body.fallback_reason, 200) || null
      : undefined,
  };
}

function safeSubmittedFields(submission: GuestIntakeSubmission): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of SAFE_SUBMITTED_FIELD_KEYS) {
    const value = submission[key];
    if (value === undefined) continue;
    if (key === 'documentAttachmentRefs') {
      fields.documentAttachmentRefCount = Array.isArray(value) ? value.length : 0;
      continue;
    }
    if (typeof value === 'boolean') fields[key] = value;
    else fields[key] = Boolean(text(value));
  }
  return fields;
}

function collectAttachmentRefs(submission: GuestIntakeSubmission): string[] {
  return submission.documentAttachmentRefs ?? [];
}

function validationStatusFromPlan(
  plan: ReturnType<typeof evaluateGuestIntakeState>,
): 'partially_completed' | 'validation_needed' | 'completed' | 'fallback_required' {
  if (plan.intakeStatus === 'completed') return 'completed';
  if (plan.intakeStatus === 'fallback_required') return 'fallback_required';
  if (plan.validationErrors.length > 0 || plan.intakeStatus === 'validation_needed') {
    return 'validation_needed';
  }
  return 'partially_completed';
}

async function getSessionByToken(
  token: string,
): Promise<BookingOpsGuestIntakeSession | null> {
  const publicToken = normalizeToken(token);
  if (!publicToken) return null;
  const { data, error } = await supabase
    .from('booking_ops_guest_intake_sessions')
    .select('*')
    .eq('public_token', publicToken)
    .maybeSingle();
  if (error || !data) return null;
  return mapGuestIntakeSessionRow(data as GuestIntakeRow);
}

export async function loadGuestIntakeByToken(token: string): Promise<{
  ok: boolean;
  session?: BookingOpsGuestIntakeSession;
  record?: BookingOpsRecord;
  error?: string;
}> {
  const session = await getSessionByToken(token);
  if (!session) return { ok: false, error: 'not_found' };
  const record = await getBookingOpsRecord(session.bookingOpsRecordId);
  if (!record) return { ok: false, error: 'record_not_found' };
  try {
    const expectedScope = guestIntakeExpectedScope(record);
    await revalidateGuestIntakeScope(record.id, expectedScope);
    const ensuredSession = await ensureGuestIntakePublicToken(session, expectedScope);
    await revalidateGuestIntakeScope(record.id, expectedScope);
    return { ok: true, session: ensuredSession, record };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'booking_scope_unavailable' };
  }
}

export async function recordGuestIntakeLinkOpened(token: string): Promise<{
  ok: boolean;
  session?: BookingOpsGuestIntakeSession;
  record?: BookingOpsRecord;
  error?: string;
}> {
  const loaded = await loadGuestIntakeByToken(token);
  if (!loaded.ok || !loaded.session || !loaded.record) return loaded;
  let expectedScope: ExpectedScope | undefined;
  try {
    expectedScope = guestIntakeExpectedScope(loaded.record);
    await revalidateGuestIntakeScope(loaded.record.id, expectedScope);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'booking_scope_unavailable' };
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('booking_ops_guest_intake_sessions')
    .update({ token_opened_at: now, last_guest_activity_at: now, updated_at: now })
    .eq('id', loaded.session.id)
    .eq('booking_ops_record_id', loaded.record.id)
    .select('*')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  await revalidateGuestIntakeScope(loaded.record.id, expectedScope);
  const session = data ? mapGuestIntakeSessionRow(data as GuestIntakeRow) : loaded.session;
  await revalidateGuestIntakeScope(loaded.record.id, expectedScope);
  await recordBookingOpsEvent({
    bookingOpsRecordId: loaded.record.id,
    eventType: 'guest_intake_link_opened',
    title: 'Гость открыл форму данных',
    description: 'Гость открыл безопасную форму сбора данных.',
    actorType: 'system',
    metadata: {
      guestIntakeSessionId: session.id,
      guestIntakeStatus: session.intakeStatus,
    },
    dedupeKey: `guest-intake-opened:${session.id}:${now.slice(0, 13)}`,
  });
  await revalidateGuestIntakeScope(loaded.record.id, expectedScope);
  return { ok: true, session, record: loaded.record };
}

async function recordSubmissionAudit(input: {
  recordId: string;
  sessionId: string;
  source: GuestIntakeSource;
  submission: GuestIntakeSubmission;
  validationStatus: string;
  validationErrors: string[];
  expectedScope?: ExpectedScope;
}): Promise<void> {
  await revalidateGuestIntakeScope(input.recordId, input.expectedScope);
  const result = await supabase.from('booking_ops_guest_intake_submissions').insert({
    id: randomUUID(),
    booking_ops_record_id: input.recordId,
    guest_intake_session_id: input.sessionId,
    submission_source: input.source,
    submitted_fields: safeSubmittedFields(input.submission),
    attachment_refs: collectAttachmentRefs(input.submission),
    validation_status: input.validationStatus,
    validation_errors: input.validationErrors,
    created_at: new Date().toISOString(),
  });
  if (result.error) throw new Error(result.error.message);
  await revalidateGuestIntakeScope(input.recordId, input.expectedScope);
}

async function syncDownstream(
  record: BookingOpsRecord,
  expectedScope?: ExpectedScope,
): Promise<void> {
  await revalidateGuestIntakeScope(record.id, expectedScope);
  const tasks = await listBookingOpsTasksForRecord(record.id, { expectedScope });
  if (!tasks.ok) return;
  await syncBookingOpsCommunications({ record, tasks: tasks.tasks, expectedScope });
  await revalidateGuestIntakeScope(record.id, expectedScope);
}

export async function submitGuestIntake(input: {
  token: string;
  source?: GuestIntakeSource;
  submission: GuestIntakeSubmission;
}): Promise<{
  ok: boolean;
  session?: BookingOpsGuestIntakeSession;
  record?: BookingOpsRecord;
  validationErrors?: string[];
  message?: string;
  error?: string;
}> {
  const loaded = await loadGuestIntakeByToken(input.token);
  if (!loaded.ok || !loaded.session || !loaded.record) {
    return { ok: false, error: loaded.error ?? 'not_found' };
  }

  let expectedScope: ExpectedScope | undefined;
  try {
    expectedScope = guestIntakeExpectedScope(loaded.record);
    await revalidateGuestIntakeScope(loaded.record.id, expectedScope);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'booking_scope_unavailable' };
  }

  const built = buildBookingOpsPatchFromGuestSubmission(input.submission);
  const now = new Date().toISOString();
  const forcedFallback = input.submission.guestCannotProceed === true;
  const patch = {
    ...built.patch,
    ...(forcedFallback ? {
      isBlocked: true,
      blockerReason: text(input.submission.fallbackReason, 200) || 'Гость не может завершить ввод данных',
      checkinReadinessStatus: 'problem' as const,
    } : null),
  };

  const update = Object.keys(patch).length > 0
    ? await updateBookingOpsRecord(loaded.record.id, patch, { actorType: 'system', expectedScope })
    : { ok: true as const, record: loaded.record };
  if (!update.ok || !update.record) {
    return { ok: false, error: update.error ?? 'record_update_failed' };
  }
  try {
    await revalidateGuestIntakeScope(update.record.id, expectedScope);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'booking_scope_unavailable' };
  }

  const basePlan = evaluateGuestIntakeState({
    record: update.record,
    existingSession: loaded.session,
  });
  const validationErrors = [...new Set([...built.validationErrors, ...basePlan.validationErrors])];
  const validationStatus = forcedFallback ? 'fallback_required' : validationStatusFromPlan({
    ...basePlan,
    validationErrors,
    intakeStatus: validationErrors.length > 0 ? 'validation_needed' : basePlan.intakeStatus,
  });

  await recordSubmissionAudit({
    recordId: update.record.id,
    sessionId: loaded.session.id,
    source: input.source ?? 'web',
    submission: input.submission,
    validationStatus,
    validationErrors,
    expectedScope,
  });

  const fallbackReason = forcedFallback
    ? text(input.submission.fallbackReason, 200) || 'Гость не может завершить ввод данных'
    : validationErrors[0] ?? basePlan.fallbackReason;
  const status = forcedFallback
    ? 'fallback_required'
    : validationErrors.length > 0
      ? 'validation_needed'
      : basePlan.intakeStatus;

  await revalidateGuestIntakeScope(update.record.id, expectedScope);
  const { data, error } = await supabase
    .from('booking_ops_guest_intake_sessions')
    .update({
      intake_status: status,
      missing_fields: basePlan.missingFields,
      collected_fields: basePlan.collectedFields,
      validation_errors: validationErrors,
      channel: input.source === 'telegram' ? 'telegram' : 'web',
      guest_contact_ref: basePlan.guestContactRef,
      last_guest_activity_at: now,
      fallback_reason: fallbackReason ?? null,
      generated_message: basePlan.generatedMessage,
      updated_at: now,
    })
    .eq('id', loaded.session.id)
    .eq('booking_ops_record_id', update.record.id)
    .select('*')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (expectedScope && !data) return { ok: false, error: 'booking_scope_mismatch' };
  await revalidateGuestIntakeScope(update.record.id, expectedScope);

  const session = data
    ? mapGuestIntakeSessionRow(data as GuestIntakeRow)
    : loaded.session;
  const eventType =
    status === 'completed'
      ? 'guest_intake_completed'
      : status === 'fallback_required'
        ? 'guest_intake_fallback_required'
        : status === 'validation_needed'
          ? 'guest_intake_validation_failed'
          : 'guest_intake_partially_completed';
  await revalidateGuestIntakeScope(update.record.id, expectedScope);
  await recordBookingOpsEvent({
    bookingOpsRecordId: update.record.id,
    eventType: 'guest_intake_submission_received',
    title: 'Гость отправил данные',
    description: 'Получены данные из гостевой формы. Документы в историю не записывались.',
    actorType: 'system',
    metadata: {
      guestIntakeSessionId: session.id,
      guestIntakeStatus: status,
      submissionSource: input.source ?? 'web',
      validationStatus,
    },
    dedupeKey: `guest-intake-submission:${session.id}:${now}`,
  });
  await revalidateGuestIntakeScope(update.record.id, expectedScope);
  await recordBookingOpsEvent({
    bookingOpsRecordId: update.record.id,
    eventType,
    title:
      eventType === 'guest_intake_completed'
        ? 'Данные гостя собраны'
        : eventType === 'guest_intake_fallback_required'
          ? 'Гостю нужна ручная помощь'
          : eventType === 'guest_intake_validation_failed'
            ? 'Данные гостя требуют проверки'
            : 'Данные гостя частично заполнены',
    description: 'Состояние сбора данных обновлено без записи чувствительных значений.',
    actorType: 'system',
    metadata: {
      guestIntakeSessionId: session.id,
      guestIntakeStatus: status,
      validationStatus,
      missingCount: basePlan.missingFields.length,
      fallbackReason,
    },
    dedupeKey: `guest-intake-status:${session.id}:${status}:${now}`,
  });
  await revalidateGuestIntakeScope(update.record.id, expectedScope);

  const synced = await syncGuestIntakeAutopilot(
    { ...update.record, guestIntake: session },
    expectedScope,
  );
  await revalidateGuestIntakeScope(update.record.id, expectedScope);
  const finalSession = synced.session ?? session;
  const finalRecord = { ...update.record, guestIntake: finalSession };
  await syncDownstream(finalRecord, expectedScope);

  return {
    ok: true,
    session: finalSession,
    record: finalRecord,
    validationErrors,
    message: validationStatus === 'completed'
      ? 'Спасибо, данные получены.'
      : validationStatus === 'fallback_required'
        ? 'Спасибо. Оператор поможет завершить подготовку.'
        : validationErrors.length > 0
          ? 'Спасибо. Данные получены, оператор проверит детали.'
          : 'Спасибо. Часть данных получена, можно продолжить позже.',
  };
}
