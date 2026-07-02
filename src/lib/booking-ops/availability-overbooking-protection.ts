import { createHash, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import type { BookingOpsCommunicationIntent, BookingOpsCommunicationPurpose } from './types';

export const AVAILABILITY_CONFLICT_STATUSES = [
  'no_conflict', 'possible_conflict', 'confirmed_conflict', 'missing_data', 'failed', 'dry_run',
] as const;
export type AvailabilityConflictStatus = (typeof AVAILABILITY_CONFLICT_STATUSES)[number];
export type AvailabilityCheckType =
  | 'pre_intake' | 'pre_confirmation' | 'pre_autorun' | 'channel_import'
  | 'manual_review' | 'communication_guard' | 'batch';
export type AvailabilityHoldSource =
  | 'booking_intake' | 'pilot_autorun' | 'channel_import' | 'operator' | 'manual_block' | 'internal';

export type AvailabilityConflict = {
  type: 'booking' | 'active_hold' | 'manual_block' | 'channel_booking' | 'channel_calendar';
  id: string;
  severity: 'possible' | 'confirmed';
};

export type AvailabilityCheckResult = {
  id: string | null;
  status: AvailabilityConflictStatus;
  propertySetupId: string | null;
  propertyId: string | null;
  bookingId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  conflicts: AvailabilityConflict[];
  warnings: string[];
  blockers: string[];
  safeSummary: string;
};

export type AvailabilityScope = {
  bookingId?: string | null;
  propertySetupId?: string | null;
  propertyId?: string | null;
};

export type AvailabilityDateRange = { dateFrom?: string | null; dateTo?: string | null };

type CheckOptions = {
  checkType?: AvailabilityCheckType;
  persist?: boolean;
  dryRun?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROPERTY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const SENSITIVE_KEY_RE = /(password|secret|token|credential|api[_-]?key|authorization|guest|phone|email|payment|access)/iu;
const CONFIRMATION_PURPOSES = new Set<BookingOpsCommunicationPurpose>([
  'request_deposit_payment', 'send_checkin_instructions', 'checkin_instructions',
  'remind_guest_before_checkin', 'arrival_confirmation_request', 'unit_ready_notice',
]);
const SAFE_PENDING_PURPOSES = new Set<BookingOpsCommunicationPurpose>([
  'neutral_booking_acknowledgement', 'neutral_status_update', 'request_missing_guest_data',
  'request_arrival_time', 'internal_status_notice', 'fallback_created_notice',
]);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeMetadata(value?: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !SENSITIVE_KEY_RE.test(key)));
}

export function normalizeAvailabilityDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const direct = /^\d{4}-\d{2}-\d{2}$/u.test(raw) ? raw : raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(direct)) return null;
  const parsed = new Date(`${direct}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== direct ? null : direct;
}

export function rangesOverlap(
  existingDateFrom: string,
  existingDateTo: string,
  requestedDateFrom: string,
  requestedDateTo: string,
): boolean {
  return existingDateFrom < requestedDateTo && requestedDateFrom < existingDateTo;
}

export function classifyAvailabilityConflicts(conflicts: AvailabilityConflict[]): AvailabilityConflictStatus {
  if (conflicts.some((item) => item.severity === 'confirmed')) return 'confirmed_conflict';
  if (conflicts.length > 0) return 'possible_conflict';
  return 'no_conflict';
}

function validateScope(scope: AvailabilityScope): AvailabilityScope {
  const bookingId = text(scope.bookingId) || null;
  const propertySetupId = text(scope.propertySetupId) || null;
  const propertyId = text(scope.propertyId) || null;
  if (bookingId && !UUID_RE.test(bookingId)) throw new Error('Некорректный ID брони.');
  if (propertySetupId && !UUID_RE.test(propertySetupId)) throw new Error('Некорректный ID профиля объекта.');
  if (propertyId && !PROPERTY_RE.test(propertyId)) throw new Error('Некорректный ID объекта.');
  return { bookingId, propertySetupId, propertyId };
}

function validateRange(range: AvailabilityDateRange): { dateFrom: string; dateTo: string } {
  const dateFrom = normalizeAvailabilityDate(range.dateFrom);
  const dateTo = normalizeAvailabilityDate(range.dateTo);
  if (!dateFrom || !dateTo) throw new Error('Укажите даты заезда и выезда.');
  if (dateFrom >= dateTo) throw new Error('Дата заезда должна быть раньше даты выезда.');
  return { dateFrom, dateTo };
}

async function resolveScopeAndRange(
  scopeInput: AvailabilityScope,
  rangeInput: AvailabilityDateRange = {},
): Promise<Required<AvailabilityScope> & { dateFrom: string | null; dateTo: string | null }> {
  const scope = validateScope(scopeInput);
  let propertyId = scope.propertyId;
  let propertySetupId = scope.propertySetupId;
  let dateFrom = normalizeAvailabilityDate(rangeInput.dateFrom);
  let dateTo = normalizeAvailabilityDate(rangeInput.dateTo);
  if (scope.bookingId) {
    const { data, error } = await supabase.from('booking_ops_records')
      .select('id,property_id,check_in_at,check_out_at').eq('id', scope.bookingId).maybeSingle();
    if (error) throw new Error(error.message);
    propertyId ??= text(data?.property_id) || null;
    dateFrom ??= normalizeAvailabilityDate(data?.check_in_at);
    dateTo ??= normalizeAvailabilityDate(data?.check_out_at);
  }
  if (propertySetupId && !propertyId) {
    const { data, error } = await supabase.from('booking_property_setup_profiles')
      .select('property_id').eq('id', propertySetupId).maybeSingle();
    if (error) throw new Error(error.message);
    propertyId = text(data?.property_id) || null;
  }
  if (propertyId && !propertySetupId) {
    const { data } = await supabase.from('booking_property_setup_profiles')
      .select('id').eq('property_id', propertyId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    propertySetupId = text(data?.id) || null;
  }
  return { bookingId: scope.bookingId ?? null, propertySetupId: propertySetupId ?? null, propertyId: propertyId ?? null, dateFrom, dateTo };
}

function scopeOr(propertySetupId: string | null, propertyId: string | null): string {
  return [
    propertySetupId ? `property_setup_id.eq.${propertySetupId}` : '',
    propertyId ? `property_id.eq.${propertyId}` : '',
  ].filter(Boolean).join(',');
}

async function persistCheck(result: AvailabilityCheckResult, checkType: AvailabilityCheckType): Promise<string | null> {
  const { data, error } = await supabase.from('booking_overbooking_conflict_checks').insert({
    id: randomUUID(), property_setup_id: result.propertySetupId, property_id: result.propertyId,
    booking_id: result.bookingId, check_type: checkType, status: result.status,
    requested_date_from: result.dateFrom, requested_date_to: result.dateTo,
    conflicts: result.conflicts, warnings: result.warnings, blockers: result.blockers,
    safe_summary: result.safeSummary,
  }).select('id').single();
  if (error) return null;
  return text(data?.id) || null;
}

async function updateBookingRisk(result: AvailabilityCheckResult): Promise<void> {
  if (!result.bookingId) return;
  const availabilityStatus = result.status === 'no_conflict' ? 'held'
    : result.status === 'missing_data' ? 'missing_data'
      : result.status === 'failed' ? 'blocked' : 'conflict';
  await supabase.from('booking_ops_records').update({
    availability_status: availabilityStatus,
    overbooking_risk_status: result.status,
    availability_summary: { status: result.status, check_id: result.id, blockers: result.blockers },
    updated_at: new Date().toISOString(),
  }).eq('id', result.bookingId);
}

export async function checkAvailabilityConflict(
  input: AvailabilityScope & AvailabilityDateRange,
  options: CheckOptions = {},
): Promise<AvailabilityCheckResult> {
  let resolved: Awaited<ReturnType<typeof resolveScopeAndRange>>;
  try {
    resolved = await resolveScopeAndRange(input, input);
  } catch (error) {
    return {
      id: null, status: 'failed', propertySetupId: text(input.propertySetupId) || null,
      propertyId: text(input.propertyId) || null, bookingId: text(input.bookingId) || null,
      dateFrom: normalizeAvailabilityDate(input.dateFrom), dateTo: normalizeAvailabilityDate(input.dateTo),
      conflicts: [], warnings: [], blockers: ['Не удалось проверить доступность.'],
      safeSummary: error instanceof Error ? error.message : 'Не удалось проверить доступность.',
    };
  }
  const missing = [!resolved.propertyId && !resolved.propertySetupId ? 'Не указан объект.' : '',
    !resolved.dateFrom || !resolved.dateTo ? 'Не указаны даты проживания.' : ''].filter(Boolean);
  if (missing.length) {
    const result: AvailabilityCheckResult = {
      id: null, status: 'missing_data', ...resolved, conflicts: [], warnings: [], blockers: missing,
      safeSummary: 'Недостаточно данных для проверки доступности.',
    };
    if (options.persist !== false) result.id = await persistCheck(result, options.checkType ?? 'manual_review');
    await updateBookingRisk(result);
    return result;
  }
  if (resolved.dateFrom! >= resolved.dateTo!) {
    const result: AvailabilityCheckResult = {
      id: null, status: 'failed', ...resolved, conflicts: [], warnings: [],
      blockers: ['Дата заезда должна быть раньше даты выезда.'], safeSummary: 'Некорректный диапазон дат.',
    };
    if (options.persist !== false) result.id = await persistCheck(result, options.checkType ?? 'manual_review');
    await updateBookingRisk(result);
    return result;
  }
  if (options.dryRun) {
    return { id: null, status: 'dry_run', ...resolved, conflicts: [], warnings: [], blockers: [], safeSummary: 'Проверка запланирована.' };
  }

  const conflicts: AvailabilityConflict[] = [];
  const errors: string[] = [];
  const orFilter = scopeOr(resolved.propertySetupId, resolved.propertyId);
  const [holdsResult, blocksResult, bookingsResult] = await Promise.all([
    supabase.from('booking_availability_holds').select('id,booking_id,status,hold_expires_at')
      .or(orFilter).in('status', ['active', 'confirmed']).lt('date_from', resolved.dateTo!)
      .gt('date_to', resolved.dateFrom!),
    supabase.from('booking_availability_blocks').select('id,status').or(orFilter)
      .in('status', ['active', 'blocked']).lt('date_from', resolved.dateTo!).gt('date_to', resolved.dateFrom!),
    resolved.propertyId
      ? supabase.from('booking_ops_records').select('id').eq('property_id', resolved.propertyId)
        .lt('check_in_at', `${resolved.dateTo}T00:00:00.000Z`)
        .gt('check_out_at', `${resolved.dateFrom}T00:00:00.000Z`)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (holdsResult.error || blocksResult.error || bookingsResult.error) errors.push('Основной календарь временно недоступен.');
  const now = Date.now();
  for (const row of holdsResult.data ?? []) {
    if (resolved.bookingId && row.booking_id === resolved.bookingId) continue;
    if (row.hold_expires_at && new Date(row.hold_expires_at).getTime() <= now) continue;
    conflicts.push({ type: 'active_hold', id: String(row.id), severity: 'possible' });
  }
  for (const row of blocksResult.data ?? []) conflicts.push({ type: 'manual_block', id: String(row.id), severity: 'confirmed' });
  for (const row of bookingsResult.data ?? []) {
    if (resolved.bookingId && row.id === resolved.bookingId) continue;
    conflicts.push({ type: 'booking', id: String(row.id), severity: 'confirmed' });
  }

  if (resolved.propertyId || resolved.propertySetupId) {
    let objectsQuery = supabase.from('booking_channel_imported_objects')
      .select('connection_id,external_object_id,matched_property_id,matched_property_setup_id');
    objectsQuery = resolved.propertySetupId
      ? objectsQuery.eq('matched_property_setup_id', resolved.propertySetupId)
      : objectsQuery.eq('matched_property_id', resolved.propertyId!);
    const { data: objects, error: objectsError } = await objectsQuery;
    if (objectsError) errors.push('Снимок менеджера каналов временно недоступен.');
    for (const object of objects ?? []) {
      const [{ data: imported, error: importedError }, { data: calendar, error: calendarError }] = await Promise.all([
        supabase.from('booking_channel_imported_bookings').select('id,matched_booking_id')
          .eq('connection_id', object.connection_id).eq('external_object_id', object.external_object_id)
          .neq('status', 'cancelled').lt('checkin_date', resolved.dateTo!).gt('checkout_date', resolved.dateFrom!),
        supabase.from('booking_channel_calendar_snapshots').select('id').eq('connection_id', object.connection_id)
          .eq('external_object_id', object.external_object_id).in('availability_status', ['booked', 'blocked'])
          .gte('date', resolved.dateFrom!).lt('date', resolved.dateTo!),
      ]);
      if (importedError || calendarError) errors.push('Часть импортированного календаря не проверена.');
      for (const row of imported ?? []) {
        if (resolved.bookingId && row.matched_booking_id === resolved.bookingId) continue;
        conflicts.push({ type: 'channel_booking', id: String(row.id), severity: 'confirmed' });
      }
      for (const row of calendar ?? []) conflicts.push({ type: 'channel_calendar', id: String(row.id), severity: 'confirmed' });
    }
  }

  const status = errors.length > 0 ? 'failed' : classifyAvailabilityConflicts(conflicts);
  const result: AvailabilityCheckResult = {
    id: null, status, ...resolved, conflicts, warnings: errors,
    blockers: status === 'no_conflict' ? [] : [status === 'failed'
      ? 'Не удалось подтвердить доступность.' : 'Найдено пересечение дат. Нужна проверка оператора.'],
    safeSummary: status === 'no_conflict' ? 'Пересечений не найдено.'
      : status === 'failed' ? 'Проверка доступности не завершена.' : `Найдено пересечений: ${conflicts.length}.`,
  };
  if (options.persist !== false) result.id = await persistCheck(result, options.checkType ?? 'manual_review');
  await updateBookingRisk(result);
  return result;
}

export async function createAvailabilityHold(
  input: AvailabilityScope & AvailabilityDateRange & { source: AvailabilityHoldSource; holdMinutes?: number; safeSummary?: string },
  options?: { metadata?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const resolved = await resolveScopeAndRange(input, input);
  if (!resolved.propertyId && !resolved.propertySetupId) throw new Error('Укажите объект.');
  const range = validateRange(resolved);
  const holdMinutes = Math.min(7 * 24 * 60, Math.max(5, Math.round(input.holdMinutes ?? 30)));
  const expiresAt = new Date(Date.now() + holdMinutes * 60_000).toISOString();
  const key = createHash('sha256').update([
    resolved.bookingId ?? '-', resolved.propertySetupId ?? '-', resolved.propertyId ?? '-', range.dateFrom, range.dateTo, input.source,
  ].join('|')).digest('hex');
  const { data, error } = await supabase.rpc('create_booking_availability_hold_atomic', {
    p_property_setup_id: resolved.propertySetupId, p_property_id: resolved.propertyId,
    p_booking_id: resolved.bookingId, p_source: input.source, p_date_from: range.dateFrom,
    p_date_to: range.dateTo, p_hold_expires_at: expiresAt,
    p_safe_summary: text(input.safeSummary) || 'Временная бронь дат.',
    p_metadata: safeMetadata(options?.metadata), p_idempotency_key: key,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}

export async function releaseAvailabilityHold(holdId: string, metadata?: Record<string, unknown>) {
  if (!UUID_RE.test(text(holdId))) throw new Error('Некорректный ID удержания.');
  const { data, error } = await supabase.from('booking_availability_holds').update({
    status: 'released', metadata: safeMetadata(metadata), updated_at: new Date().toISOString(),
  }).eq('id', holdId).in('status', ['active', 'blocked']).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function confirmAvailabilityHold(holdId: string, bookingId?: string, metadata?: Record<string, unknown>) {
  if (!UUID_RE.test(text(holdId)) || (bookingId && !UUID_RE.test(text(bookingId)))) throw new Error('Некорректный ID.');
  const patch: Record<string, unknown> = { status: 'confirmed', hold_expires_at: null, metadata: safeMetadata(metadata), updated_at: new Date().toISOString() };
  if (bookingId) patch.booking_id = bookingId;
  const { data, error } = await supabase.from('booking_availability_holds').update(patch)
    .eq('id', holdId).eq('conflict_status', 'no_conflict').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Удержание нельзя подтвердить без успешной проверки.');
  return data;
}

export async function expireAvailabilityHolds(options?: { propertyId?: string; before?: string }) {
  let query = supabase.from('booking_availability_holds').update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('status', 'active').lte('hold_expires_at', options?.before ?? new Date().toISOString());
  if (options?.propertyId) query = query.eq('property_id', validateScope({ propertyId: options.propertyId }).propertyId!);
  const { data, error } = await query.select('id');
  if (error) throw new Error(error.message);
  return { expired: data?.length ?? 0 };
}

export async function createAvailabilityBlock(
  input: AvailabilityScope & AvailabilityDateRange & { source?: 'operator' | 'maintenance' | 'owner_stay' | 'channel_import' | 'internal'; reason?: string },
  metadata?: Record<string, unknown>,
) {
  const resolved = await resolveScopeAndRange(input, input);
  if (!resolved.propertyId && !resolved.propertySetupId) throw new Error('Укажите объект.');
  const range = validateRange(resolved);
  const { data, error } = await supabase.from('booking_availability_blocks').insert({
    id: randomUUID(), property_setup_id: resolved.propertySetupId, property_id: resolved.propertyId,
    source: input.source ?? 'operator', status: 'active', date_from: range.dateFrom, date_to: range.dateTo,
    reason: text(input.reason).slice(0, 500) || null, safe_summary: 'Даты закрыты оператором.', metadata: safeMetadata(metadata),
  }).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

export async function releaseAvailabilityBlock(blockId: string, metadata?: Record<string, unknown>) {
  if (!UUID_RE.test(text(blockId))) throw new Error('Некорректный ID блокировки.');
  const { data, error } = await supabase.from('booking_availability_blocks').update({
    status: 'released', metadata: safeMetadata(metadata), updated_at: new Date().toISOString(),
  }).eq('id', blockId).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function checkBookingOverbookingRisk(bookingId: string, options?: CheckOptions) {
  return checkAvailabilityConflict({ bookingId }, { ...options, checkType: options?.checkType ?? 'pre_confirmation' });
}

export async function checkPropertyDateRange(
  property: { propertySetupId?: string; propertyId?: string }, dateFrom: string, dateTo: string, options?: CheckOptions,
) {
  return checkAvailabilityConflict({ ...property, dateFrom, dateTo }, options);
}

export async function getAvailabilityStatus(scopeInput: AvailabilityScope, dateRange: AvailabilityDateRange = {}) {
  const resolved = await resolveScopeAndRange(scopeInput, dateRange);
  const orFilter = scopeOr(resolved.propertySetupId, resolved.propertyId);
  if (!orFilter) return {
    status: 'missing_data', activeHolds: [], activeBlocks: [], conflicts: [], lastCheck: null,
    blockers: ['Не указан объект.'], nextAction: 'Укажите объект и даты проживания.', range: resolved,
  };
  const now = new Date().toISOString();
  const [holds, blocks, checks] = await Promise.all([
    supabase.from('booking_availability_holds').select('*').or(orFilter).in('status', ['active', 'confirmed'])
      .or(`hold_expires_at.is.null,hold_expires_at.gt.${now}`).order('date_from'),
    supabase.from('booking_availability_blocks').select('*').or(orFilter).in('status', ['active', 'blocked']).order('date_from'),
    supabase.from('booking_overbooking_conflict_checks').select('*').or(orFilter).order('created_at', { ascending: false }).limit(50),
  ]);
  if (holds.error || blocks.error || checks.error) throw new Error(holds.error?.message ?? blocks.error?.message ?? checks.error?.message);
  const conflictRows = (checks.data ?? []).filter((row) => ['possible_conflict', 'confirmed_conflict', 'failed', 'missing_data'].includes(row.status));
  const lastCheck = checks.data?.[0] ?? null;
  const blockers = lastCheck?.blockers && Array.isArray(lastCheck.blockers) ? lastCheck.blockers.map(String) : [];
  const horizonStart = new Date().toISOString().slice(0, 10);
  const horizonEnd = (days: number) => {
    const date = new Date(`${horizonStart}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
  };
  const countRanges = (days: number) => [...(holds.data ?? []), ...(blocks.data ?? [])]
    .filter((row) => text(row.date_from) < horizonEnd(days) && horizonStart < text(row.date_to)).length;
  return {
    status: lastCheck?.status ?? 'unchecked', activeHolds: holds.data ?? [], activeBlocks: blocks.data ?? [],
    conflicts: conflictRows, lastCheck, blockers,
    nextAction: blockers[0] ?? (conflictRows.length ? 'Проверить пересечения и принять решение.' : 'Запустить проверку доступности.'),
    range: resolved, horizon: { next7Days: countRanges(7), next14Days: countRanges(14) },
  };
}

export async function getAvailabilityBlockers(scope: AvailabilityScope) {
  return (await getAvailabilityStatus(scope)).blockers;
}

export async function explainAvailabilityConflict(input: { checkId?: string; bookingId?: string }) {
  let query = supabase.from('booking_overbooking_conflict_checks').select('*');
  if (input.checkId) query = query.eq('id', input.checkId);
  else if (input.bookingId) query = query.eq('booking_id', input.bookingId).order('created_at', { ascending: false }).limit(1);
  else throw new Error('Укажите ID проверки или брони.');
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id, status: data.status, safeSummary: data.safe_summary,
    blockers: Array.isArray(data.blockers) ? data.blockers.map(String) : [],
    conflicts: Array.isArray(data.conflicts) ? data.conflicts : [], createdAt: data.created_at,
  };
}

export async function buildAvailabilitySummaryForBookingOps(bookingId: string) {
  const [risk, status] = await Promise.all([
    checkBookingOverbookingRisk(bookingId, { checkType: 'manual_review' }),
    getAvailabilityStatus({ bookingId }),
  ]);
  return { risk, status, nextAction: risk.blockers[0] ?? status.nextAction };
}

export async function shouldBlockBookingConfirmation(bookingId: string) {
  const check = await checkBookingOverbookingRisk(bookingId, { checkType: 'pre_confirmation' });
  return { block: check.status !== 'no_conflict', check };
}

type IntentLike = Pick<BookingOpsCommunicationIntent, 'purpose' | 'messageText'>
  & Partial<Pick<BookingOpsCommunicationIntent, 'bookingOpsRecordId' | 'bookingId'>>;

export function isConfirmationLikeCommunication(intent: Pick<IntentLike, 'purpose' | 'messageText'>): boolean {
  if (SAFE_PENDING_PURPOSES.has(intent.purpose)) return false;
  if (CONFIRMATION_PURPOSES.has(intent.purpose)) return true;
  return /(?:бронь|бронирован\w*|даты).{0,40}(?:подтвержден\w*|гарантирован\w*)|оплат(?:ите|а).{0,40}(?:подтвержден\w*|брон)/iu.test(intent.messageText);
}

export async function shouldBlockCommunicationIntent(intent: IntentLike) {
  if (!isConfirmationLikeCommunication(intent)) {
    return { block: false, status: 'not_applicable' as const, summary: 'Нейтральное сообщение разрешено.' };
  }
  const bookingId = text(intent.bookingOpsRecordId) || text(intent.bookingId);
  if (!bookingId || !UUID_RE.test(bookingId)) {
    return { block: true, status: 'missing_data' as const, summary: 'Нет данных брони для подтверждения доступности.' };
  }
  const check = await checkAvailabilityConflict({ bookingId }, { checkType: 'communication_guard' });
  return {
    block: check.status !== 'no_conflict', status: check.status,
    summary: check.status === 'no_conflict' ? 'Доступность подтверждена проверкой.' : 'Подтверждающее сообщение заблокировано до проверки доступности.',
    check,
  };
}

export async function auditChannelImportAvailability(connectionId: string) {
  if (!UUID_RE.test(text(connectionId))) throw new Error('Некорректный ID подключения.');
  const { data, error } = await supabase.from('booking_channel_imported_bookings')
    .select('id,matched_booking_id,matched_property_setup_id,external_object_id,checkin_date,checkout_date,status')
    .eq('connection_id', connectionId).neq('status', 'cancelled');
  if (error) throw new Error(error.message);
  const results: AvailabilityCheckResult[] = [];
  for (const row of data ?? []) {
    let propertySetupId = text(row.matched_property_setup_id) || null;
    let propertyId: string | null = null;
    if (!propertySetupId && row.external_object_id) {
      const { data: object } = await supabase.from('booking_channel_imported_objects')
        .select('matched_property_setup_id,matched_property_id').eq('connection_id', connectionId)
        .eq('external_object_id', row.external_object_id).maybeSingle();
      propertySetupId = text(object?.matched_property_setup_id) || null;
      propertyId = text(object?.matched_property_id) || null;
    }
    results.push(await checkAvailabilityConflict({
      bookingId: text(row.matched_booking_id) || null, propertySetupId, propertyId,
      dateFrom: row.checkin_date, dateTo: row.checkout_date,
    }, { checkType: 'channel_import' }));
  }
  return results;
}
