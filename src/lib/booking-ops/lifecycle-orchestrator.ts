import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import {
  ensureGuestIntakeSession,
  getGuestIntakeReleaseSnapshot,
  prepareCheckinReleaseDraft,
  prepareGuestIntakeDraft,
} from './guest-intake-checkin-release';
import { initializeGuestLegalExecution } from './guest-legal-deposit-mvd-execution';
import { ensurePhysicalTasks } from './physical-readiness-execution';
import { getBookingOpsRecord } from './repository';
import {
  BOOKING_LIFECYCLE_ORCHESTRATOR_STAGES,
  type BookingLifecycleOrchestratorSnapshot,
  type BookingLifecyclePlan,
  type BookingLifecyclePlanInput,
  type BookingLifecycleSeverity,
  type BookingLifecycleSlaItem,
} from './lifecycle-orchestrator-types';

export type BookingLifecycleRunType = 'single_booking' | 'batch_due' | 'manual_dashboard' | 'probe' | 'test';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HOUR = 60 * 60 * 1000;
const SEVERITY_RANK: Record<BookingLifecycleSeverity, number> = { info: 0, warning: 1, urgent: 2, critical: 3 };

function text(value: unknown, max = 1000): string {
  return String(value ?? '').trim().slice(0, max);
}

function requireBookingId(value: unknown): string {
  const id = text(value, 64);
  if (!UUID_RE.test(id)) throw new Error('Некорректный ID брони.');
  return id;
}

function dateMs(value: string | null | undefined, fallback: number): number {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function severityFor(dueAt: number, now: number, checkInAt: number): BookingLifecycleSeverity {
  const overdueFor = now - dueAt;
  const untilCheckin = checkInAt - now;
  if (overdueFor >= 24 * HOUR || untilCheckin <= 4 * HOUR) return 'critical';
  if (overdueFor >= 6 * HOUR || untilCheckin <= 12 * HOUR) return 'urgent';
  if (overdueFor > 0 || dueAt - now <= 6 * HOUR) return 'warning';
  return 'info';
}

function makeSlaItem(input: {
  plan: BookingLifecyclePlanInput;
  stage: BookingLifecycleSlaItem['stage'];
  itemType: BookingLifecycleSlaItem['itemType'];
  dueAt: number;
  satisfied: boolean;
  blockerReason: string | null;
  recommendedAction: string;
}): BookingLifecycleSlaItem {
  const now = dateMs(input.plan.now, Date.now());
  const checkIn = dateMs(input.plan.checkInAt, Number.POSITIVE_INFINITY);
  const overdue = !input.satisfied && now > input.dueAt;
  const severity = input.satisfied ? 'info' : severityFor(input.dueAt, now, checkIn);
  return {
    bookingId: input.plan.bookingId,
    propertyId: input.plan.propertyId,
    stage: input.stage,
    itemType: input.itemType,
    status: input.satisfied ? 'satisfied' : overdue ? 'overdue' : 'pending',
    dueAt: iso(input.dueAt),
    completedAt: input.satisfied ? input.plan.now : null,
    overdueSince: overdue ? iso(input.dueAt) : null,
    overdue,
    severity,
    blockerReason: input.satisfied ? null : input.blockerReason,
    recommendedAction: input.satisfied ? null : input.recommendedAction,
    escalationNeeded: overdue && (severity === 'urgent' || severity === 'critical'),
  };
}

export function planBookingLifecycle(input: BookingLifecyclePlanInput): BookingLifecyclePlan {
  const now = dateMs(input.now, Date.now());
  const created = dateMs(input.createdAt, now);
  const checkIn = dateMs(input.checkInAt, created + 72 * HOUR);
  const due = {
    guest: Math.min(created + 12 * HOUR, checkIn - 24 * HOUR),
    legal: Math.min(created + 24 * HOUR, checkIn - 18 * HOUR),
    cleaning: checkIn - 4 * HOUR,
    linen: checkIn - 4 * HOUR,
    maintenance: Math.min(created + HOUR, checkIn - 6 * HOUR),
    final: checkIn - 2 * HOUR,
  };
  const slaItems = [
    makeSlaItem({ plan: input, stage: 'guest_intake', itemType: 'guest_intake', dueAt: due.guest, satisfied: input.guestComplete, blockerReason: input.guestBlockers[0] ?? 'guest_intake_incomplete', recommendedAction: 'Дополнить и проверить данные гостя.' }),
    makeSlaItem({ plan: input, stage: 'legal_preparation', itemType: 'legal_readiness', dueAt: due.legal, satisfied: input.legalComplete, blockerReason: input.legalBlockers[0] ?? 'legal_gate_blocked', recommendedAction: 'Проверить документы, договор, депозит и МВД.' }),
    makeSlaItem({ plan: input, stage: 'physical_preparation', itemType: 'cleaning', dueAt: due.cleaning, satisfied: input.cleaningVerified, blockerReason: 'cleaning_not_verified', recommendedAction: 'Получить подтверждение и проверить уборку.' }),
    makeSlaItem({ plan: input, stage: 'physical_preparation', itemType: 'linen', dueAt: due.linen, satisfied: input.linenVerified, blockerReason: 'linen_not_verified', recommendedAction: 'Получить подтверждение и проверить бельё.' }),
    makeSlaItem({ plan: input, stage: 'physical_preparation', itemType: 'maintenance', dueAt: due.maintenance, satisfied: !input.blockingMaintenanceOpen, blockerReason: 'blocking_maintenance_open', recommendedAction: 'Передать критичную неисправность мастеру и оператору.' }),
    makeSlaItem({ plan: input, stage: 'final_readiness_review', itemType: 'final_readiness', dueAt: due.final, satisfied: input.physicalReady, blockerReason: input.physicalBlockers[0] ?? 'physical_readiness_blocked', recommendedAction: 'Провести финальную проверку готовности объекта.' }),
  ];
  const blockers = input.cancelled ? [] : unique([
    ...input.guestBlockers,
    ...input.legalBlockers,
    ...input.physicalBlockers,
  ]);
  const finalCheckinDraftAllowed = !input.cancelled && input.guestComplete && input.legalComplete && input.physicalReady;

  let currentStage: BookingLifecyclePlan['currentStage'] = 'booking_received';
  let status: BookingLifecyclePlan['status'] = 'active';
  let nextAction: string | null = 'Запустить сбор данных гостя.';
  if (input.cancelled) {
    currentStage = 'cancelled'; status = 'cancelled'; nextAction = null;
  } else if (input.finalDraftPrepared) {
    currentStage = 'checkin_release_draft_prepared'; status = 'completed'; nextAction = null;
  } else if (!input.guestComplete) {
    currentStage = 'guest_intake'; status = 'waiting_guest'; nextAction = 'Дополнить данные гостя и проверить обязательные поля.';
  } else if (!input.legalComplete) {
    currentStage = 'legal_preparation'; status = 'waiting_operator'; nextAction = 'Закрыть юридические блокеры брони.';
  } else if (!input.physicalReady) {
    currentStage = input.cleaningVerified && input.linenVerified && !input.blockingMaintenanceOpen
      ? 'final_readiness_review' : 'physical_preparation';
    status = currentStage === 'final_readiness_review' ? 'ready_for_review' : 'waiting_worker';
    nextAction = currentStage === 'final_readiness_review'
      ? 'Подтвердить финальную готовность объекта.'
      : 'Закрыть задачи уборки, белья и ремонта.';
  } else {
    currentStage = 'checkin_release_ready'; status = 'ready_for_review';
    nextAction = 'Подготовить финальный черновик инструкций по заезду.';
  }

  const openItems = slaItems.filter((item) => item.status !== 'satisfied');
  const overdueItems = openItems.filter((item) => item.overdue);
  const severity = openItems.reduce<BookingLifecycleSeverity>(
    (highest, item) => SEVERITY_RANK[item.severity] > SEVERITY_RANK[highest] ? item.severity : highest,
    'info',
  );
  if (!input.cancelled && overdueItems.length && status !== 'completed') status = 'overdue';
  const nextItem = openItems.sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return {
    currentStage,
    status,
    blockers,
    nextAction,
    nextActionDueAt: nextItem?.dueAt ?? null,
    slaStatus: input.cancelled ? 'cancelled' : !openItems.length ? 'satisfied' : overdueItems.length ? 'overdue' : severity === 'warning' ? 'warning' : 'on_track',
    severity,
    finalCheckinDraftAllowed,
    slaItems,
  };
}

async function insertEvent(input: {
  bookingId: string; propertyId: string | null; eventType: string; eventPayload?: Record<string, unknown>;
  actorType?: 'system' | 'operator' | 'test' | 'scheduler'; actorId?: string | null; runId?: string | null; dedupeKey?: string;
}): Promise<boolean> {
  const { error } = await supabase.from('booking_ops_lifecycle_events').insert({
    id: randomUUID(), booking_id: input.bookingId, property_id: input.propertyId,
    event_type: input.eventType, event_payload: input.eventPayload ?? {}, actor_type: input.actorType ?? 'system',
    actor_id: input.actorId ?? null, run_id: input.runId ?? null, dedupe_key: input.dedupeKey ?? null,
  });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw new Error(error.message);
}

async function ensureLifecycleDraft(input: {
  bookingId: string; propertyId: string | null; draftType: string; targetActor: 'guest' | 'operator' | 'cleaner' | 'linen' | 'master';
  stage: string; dueWindow: string; messageText: string; dedupeKey: string;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('booking_ops_lifecycle_drafts').insert({
    id: randomUUID(), booking_id: input.bookingId, property_id: input.propertyId, draft_type: input.draftType,
    target_actor: input.targetActor, stage: input.stage, due_window: input.dueWindow, dedupe_key: input.dedupeKey,
    message_text: input.messageText, status: 'draft', metadata: { draftOnly: true, noExternalSend: true },
    created_at: now, updated_at: now,
  });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw new Error(error.message);
}

async function countEnsuredRows(bookingId: string): Promise<number> {
  const tables = [
    ['booking_ops_guest_intake_sessions', 'booking_ops_record_id'],
    ['booking_guest_documents', 'booking_id'], ['booking_contracts', 'booking_id'],
    ['booking_deposits', 'booking_id'], ['booking_mvd_reports', 'booking_id'],
    ['booking_cleaning_tasks', 'booking_id'], ['booking_linen_tasks', 'booking_id'],
    ['booking_supplies_tasks', 'booking_id'],
  ] as const;
  const counts = await Promise.all(tables.map(async ([table, column]) => {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq(column, bookingId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }));
  return counts.reduce((sum, count) => sum + count, 0);
}

async function persistSlaItems(items: BookingLifecycleSlaItem[]): Promise<void> {
  const { data: existing, error: readError } = await supabase.from('booking_ops_sla_items')
    .select('stage,item_type,status').eq('booking_id', items[0]?.bookingId ?? '');
  if (readError) throw new Error(readError.message);
  const preserved = new Map((existing ?? []).map((row) => [`${row.stage}:${row.item_type}`, row.status]));
  const now = new Date().toISOString();
  for (const item of items) {
    const previous = preserved.get(`${item.stage}:${item.itemType}`);
    const status = previous === 'waived' ? 'waived' : item.status;
    const { error } = await supabase.from('booking_ops_sla_items').upsert({
      booking_id: item.bookingId, property_id: item.propertyId, stage: item.stage,
      item_type: item.itemType, status, due_at: item.dueAt,
      completed_at: status === 'satisfied' ? item.completedAt : null,
      overdue_since: item.overdueSince, severity: item.severity, blocker_reason: item.blockerReason,
      recommended_action: item.recommendedAction,
      metadata: { escalationNeeded: item.escalationNeeded }, updated_at: now,
    }, { onConflict: 'booking_id,stage,item_type' });
    if (error) throw new Error(error.message);
  }
}

function lifecycleDraftText(title: string, bookingId: string, action: string): string {
  return [title, `Бронь: ${bookingId}.`, `Рекомендуемое действие: ${action}`, 'Это черновик. Никакое сообщение или действие автоматически не выполнено.'].join('\n');
}

async function createDueDrafts(input: {
  bookingId: string; propertyId: string | null; plan: BookingLifecyclePlan; runId: string;
}): Promise<{ drafts: number; escalations: number }> {
  let drafts = 0;
  let escalations = 0;
  for (const item of input.plan.slaItems.filter((candidate) => candidate.overdue)) {
    const window = item.dueAt.slice(0, 10);
    const target = item.itemType === 'guest_intake' ? 'guest' : item.itemType === 'cleaning' ? 'cleaner' : item.itemType === 'linen' ? 'linen' : item.itemType === 'maintenance' ? 'master' : 'operator';
    const draftType = item.itemType === 'guest_intake' ? 'guest_intake_reminder' : `${item.itemType}_reminder`;
    let created = false;
    if (item.itemType === 'guest_intake') {
      const { data: existingGuestDraft, error: guestDraftError } = await supabase.from('booking_ops_telegram_drafts').select('id')
        .eq('booking_ops_record_id', input.bookingId).eq('action_id', 'missing_guest_data').in('status', ['draft', 'copied']).limit(1).maybeSingle();
      if (guestDraftError) throw new Error(guestDraftError.message);
      if (!existingGuestDraft) {
        await prepareGuestIntakeDraft(input.bookingId, 'reminder');
        created = true;
      }
    } else {
      created = await ensureLifecycleDraft({
        bookingId: input.bookingId, propertyId: input.propertyId, draftType, targetActor: target,
        stage: item.stage, dueWindow: window, dedupeKey: `${draftType}:${window}`,
        messageText: lifecycleDraftText('Требуется действие по сроку брони.', input.bookingId, item.recommendedAction ?? 'Проверить задачу.'),
      });
    }
    if (created) {
      drafts += 1;
      await insertEvent({ bookingId: input.bookingId, propertyId: input.propertyId, eventType: 'reminder_draft_created', eventPayload: { itemType: item.itemType, sent: false }, runId: input.runId, dedupeKey: `reminder:${item.itemType}:${window}` });
    }
    if (item.escalationNeeded) {
      const escalationCreated = await ensureLifecycleDraft({
        bookingId: input.bookingId, propertyId: input.propertyId, draftType: `${item.itemType}_operator_escalation`, targetActor: 'operator',
        stage: item.stage, dueWindow: window, dedupeKey: `${item.itemType}:operator_escalation:${window}`,
        messageText: lifecycleDraftText('Нужна проверка оператора: срок просрочен.', input.bookingId, item.recommendedAction ?? 'Проверить блокер.'),
      });
      if (escalationCreated) {
        drafts += 1; escalations += 1;
        await supabase.from('booking_ops_sla_items').update({ status: 'escalated', updated_at: new Date().toISOString() })
          .eq('booking_id', input.bookingId).eq('stage', item.stage).eq('item_type', item.itemType).neq('status', 'waived');
        await insertEvent({ bookingId: input.bookingId, propertyId: input.propertyId, eventType: 'operator_escalation_created', eventPayload: { itemType: item.itemType, sent: false }, runId: input.runId, dedupeKey: `escalation:${item.itemType}:${window}` });
      }
    }
  }
  return { drafts, escalations };
}

export async function orchestrateBookingLifecycle(input: {
  bookingId: unknown; now?: string; runType?: BookingLifecycleRunType; actorId?: string | null;
}): Promise<BookingLifecycleOrchestratorSnapshot> {
  const bookingId = requireBookingId(input.bookingId);
  const now = input.now && Number.isFinite(new Date(input.now).getTime()) ? new Date(input.now).toISOString() : new Date().toISOString();
  const runId = randomUUID();
  const runType = input.runType ?? 'single_booking';
  const { error: runError } = await supabase.from('booking_ops_lifecycle_runs').insert({
    id: runId, booking_id: bookingId, run_type: runType, status: 'started', started_at: now,
  });
  if (runError) throw new Error(runError.message);

  try {
    const record = await getBookingOpsRecord(bookingId);
    if (!record) throw new Error('Бронь не найдена.');
    await insertEvent({ bookingId, propertyId: record.propertyId, eventType: 'orchestrator_started', eventPayload: { runType }, runId, actorType: runType === 'batch_due' ? 'scheduler' : 'system' });
    const rowsBefore = await countEnsuredRows(bookingId);
    await ensureGuestIntakeSession(bookingId);
    await initializeGuestLegalExecution(bookingId, { source: 'lifecycle_orchestrator_v1' });
    await ensurePhysicalTasks(bookingId);
    const rowsAfter = await countEnsuredRows(bookingId);
    const createdTasks = Math.max(0, rowsAfter - rowsBefore);

    const snapshot = await getGuestIntakeReleaseSnapshot(bookingId);
    const { data: previousState } = await supabase.from('booking_ops_lifecycle_states')
      .select('current_stage,status').eq('booking_id', bookingId).maybeSingle();
    const cancelled = previousState?.current_stage === 'cancelled';
    const plan = planBookingLifecycle({
      bookingId, propertyId: record.propertyId, createdAt: record.createdAt, checkInAt: record.checkInAt, now, cancelled,
      guestComplete: snapshot.validation.isComplete,
      guestBlockers: snapshot.validation.blockerReasons,
      legalComplete: snapshot.legal.status === 'ready_for_checkin',
      legalBlockers: snapshot.legal.blockers.map((blocker) => blocker.key),
      physicalReady: snapshot.physical.finalReady,
      physicalBlockers: snapshot.physical.blockers.map((blocker) => blocker.key),
      cleaningVerified: snapshot.physical.cleaning?.status === 'verified',
      linenVerified: snapshot.physical.linen?.status === 'verified',
      blockingMaintenanceOpen: snapshot.physical.maintenance.some((ticket) => ticket.isBlocking && ticket.status !== 'verified' && ticket.status !== 'cancelled'),
      finalDraftPrepared: snapshot.release?.status === 'draft_prepared' || snapshot.release?.status === 'released_simulated',
    });
    await persistSlaItems(plan.slaItems);

    let createdDrafts = 0;
    let createdEscalations = 0;
    const { data: initialDraft } = await supabase.from('booking_ops_telegram_drafts').select('id')
      .eq('booking_ops_record_id', bookingId).eq('action_id', 'initial_guest_intake').in('status', ['draft', 'copied']).limit(1).maybeSingle();
    if (!initialDraft && !cancelled) {
      await prepareGuestIntakeDraft(bookingId, 'initial');
      createdDrafts += 1;
      await insertEvent({ bookingId, propertyId: record.propertyId, eventType: 'guest_intake_session_ensured', eventPayload: { initialDraftPrepared: true, sent: false }, runId, dedupeKey: 'initial-guest-intake-prepared' });
    }
    const dueDrafts = await createDueDrafts({ bookingId, propertyId: record.propertyId, plan, runId });
    createdDrafts += dueDrafts.drafts;
    createdEscalations += dueDrafts.escalations;

    let finalDraftId = snapshot.release?.id ?? null;
    const finalDraftAlreadyPrepared = snapshot.release?.status === 'draft_prepared' || snapshot.release?.status === 'released_simulated';
    if (plan.finalCheckinDraftAllowed && !finalDraftAlreadyPrepared) {
      const prepared = await prepareCheckinReleaseDraft(bookingId, input.actorId ?? undefined);
      finalDraftId = prepared.release?.id ?? null;
      createdDrafts += 1;
      plan.currentStage = 'checkin_release_draft_prepared';
      plan.status = 'completed';
      plan.nextAction = null;
      await insertEvent({ bookingId, propertyId: record.propertyId, eventType: 'checkin_release_draft_prepared', eventPayload: { draftId: finalDraftId, sent: false }, runId, dedupeKey: 'final-checkin-draft-prepared' });
    } else if (!plan.finalCheckinDraftAllowed) {
      await insertEvent({ bookingId, propertyId: record.propertyId, eventType: 'checkin_release_blocked', eventPayload: { blockers: plan.blockers }, runId, dedupeKey: `checkin-blocked:${plan.blockers.sort().join('|')}` });
    }

    const { error: stateError } = await supabase.from('booking_ops_lifecycle_states').upsert({
      booking_id: bookingId, property_id: record.propertyId, current_stage: plan.currentStage,
      status: plan.status, blocker_reasons: plan.blockers, next_action: plan.nextAction,
      next_action_due_at: plan.nextActionDueAt, sla_status: plan.slaStatus, severity: plan.severity,
      last_orchestrated_at: now, final_checkin_draft_allowed: plan.finalCheckinDraftAllowed,
      final_checkin_draft_id: finalDraftId, metadata: { draftOnly: true, noExternalSend: true }, updated_at: now,
    }, { onConflict: 'booking_id' });
    if (stateError) throw new Error(stateError.message);
    if (!previousState || previousState.current_stage !== plan.currentStage || previousState.status !== plan.status) {
      await insertEvent({ bookingId, propertyId: record.propertyId, eventType: 'stage_changed', eventPayload: { from: previousState?.current_stage ?? null, to: plan.currentStage, status: plan.status }, runId, dedupeKey: `stage:${plan.currentStage}:${plan.status}` });
    }
    if (!createdTasks && !createdDrafts && previousState?.current_stage === plan.currentStage && previousState?.status === plan.status) {
      await insertEvent({ bookingId, propertyId: record.propertyId, eventType: 'noop_idempotent_run', eventPayload: { noExternalSideEffects: true }, runId });
    }
    await insertEvent({ bookingId, propertyId: record.propertyId, eventType: 'orchestrator_completed', eventPayload: { createdTasks, createdDrafts, createdEscalations, stage: plan.currentStage }, runId });
    const runStatus = createdTasks || createdDrafts || !previousState ? 'completed' : 'noop';
    const { error: finishError } = await supabase.from('booking_ops_lifecycle_runs').update({
      status: runStatus, finished_at: new Date().toISOString(), created_tasks_count: createdTasks,
      created_drafts_count: createdDrafts, created_escalations_count: createdEscalations,
      blocker_reasons: plan.blockers, result_summary: { stage: plan.currentStage, status: plan.status, noExternalSend: true },
    }).eq('id', runId);
    if (finishError) throw new Error(finishError.message);
    return getBookingLifecycleOrchestratorSnapshot(bookingId, false);
  } catch (error) {
    await supabase.from('booking_ops_lifecycle_runs').update({
      status: 'failed', finished_at: new Date().toISOString(), error_message: error instanceof Error ? error.message : 'orchestration_failed',
    }).eq('id', runId);
    throw error;
  }
}

export async function getBookingLifecycleOrchestratorSnapshot(bookingIdValue: unknown, initialize = true): Promise<BookingLifecycleOrchestratorSnapshot> {
  const bookingId = requireBookingId(bookingIdValue);
  const { data: state, error: stateError } = await supabase.from('booking_ops_lifecycle_states').select('*').eq('booking_id', bookingId).maybeSingle();
  if (stateError) throw new Error(stateError.message);
  if (!state && initialize) return orchestrateBookingLifecycle({ bookingId, runType: 'single_booking' });
  if (!state) throw new Error('Состояние оркестратора не найдено.');
  const [slaResult, eventsResult, draftsResult, runResult] = await Promise.all([
    supabase.from('booking_ops_sla_items').select('*').eq('booking_id', bookingId).order('due_at'),
    supabase.from('booking_ops_lifecycle_events').select('*').eq('booking_id', bookingId).order('created_at', { ascending: false }).limit(40),
    supabase.from('booking_ops_lifecycle_drafts').select('*').eq('booking_id', bookingId).order('created_at', { ascending: false }).limit(40),
    supabase.from('booking_ops_lifecycle_runs').select('*').eq('booking_id', bookingId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  for (const result of [slaResult, eventsResult, draftsResult, runResult]) if (result.error) throw new Error(result.error.message);
  return {
    state: {
      bookingId, propertyId: state.property_id, currentStage: state.current_stage, status: state.status,
      blockers: state.blocker_reasons ?? [], nextAction: state.next_action, nextActionDueAt: state.next_action_due_at,
      slaStatus: state.sla_status, severity: state.severity, lastOrchestratedAt: state.last_orchestrated_at,
      finalCheckinDraftAllowed: state.final_checkin_draft_allowed, finalCheckinDraftId: state.final_checkin_draft_id,
      updatedAt: state.updated_at,
    },
    slaItems: (slaResult.data ?? []).map((row) => ({
      id: row.id, bookingId: row.booking_id, propertyId: row.property_id, stage: row.stage, itemType: row.item_type,
      status: row.status, dueAt: row.due_at, completedAt: row.completed_at, overdueSince: row.overdue_since,
      overdue: row.status === 'overdue' || row.status === 'escalated', severity: row.severity,
      blockerReason: row.blocker_reason, recommendedAction: row.recommended_action,
      escalationNeeded: row.metadata?.escalationNeeded === true,
    })),
    events: (eventsResult.data ?? []).map((row) => ({ id: row.id, eventType: row.event_type, eventPayload: row.event_payload ?? {}, actorType: row.actor_type, actorId: row.actor_id, createdAt: row.created_at })),
    drafts: (draftsResult.data ?? []).map((row) => ({ id: row.id, draftType: row.draft_type, targetActor: row.target_actor, status: row.status, createdAt: row.created_at })),
    lastRun: runResult.data ? {
      id: runResult.data.id, runType: runResult.data.run_type, status: runResult.data.status,
      createdTasksCount: runResult.data.created_tasks_count, createdDraftsCount: runResult.data.created_drafts_count,
      createdEscalationsCount: runResult.data.created_escalations_count, startedAt: runResult.data.started_at,
      finishedAt: runResult.data.finished_at,
    } : null,
  };
}

export async function orchestrateDueBookingLifecycles(input: { now?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const { data, error } = await supabase.from('booking_ops_records').select('id').neq('ops_status', 'cancelled').order('updated_at').limit(limit);
  if (error) throw new Error(error.message);
  const results: Array<{ bookingId: string; ok: boolean; error?: string }> = [];
  for (const row of data ?? []) {
    try {
      await orchestrateBookingLifecycle({ bookingId: row.id, now: input.now, runType: 'batch_due' });
      results.push({ bookingId: row.id, ok: true });
    } catch (runError) {
      results.push({ bookingId: row.id, ok: false, error: runError instanceof Error ? runError.message : 'run_failed' });
    }
  }
  return { processed: results.length, succeeded: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results };
}

export async function applyBookingLifecycleManualOverride(input: {
  bookingId: unknown; action: unknown; reason: unknown; actorId?: string | null; slaItemId?: unknown; stage?: unknown;
}): Promise<BookingLifecycleOrchestratorSnapshot> {
  const bookingId = requireBookingId(input.bookingId);
  const action = text(input.action, 80);
  const reason = text(input.reason, 500);
  if (!reason) throw new Error('Укажите причину ручного изменения.');
  const current = await getBookingLifecycleOrchestratorSnapshot(bookingId);
  if (action === 'waive_sla') {
    const itemId = requireBookingId(input.slaItemId);
    const { data, error } = await supabase.from('booking_ops_sla_items').update({ status: 'waived', metadata: { overrideReason: reason }, updated_at: new Date().toISOString() }).eq('id', itemId).eq('booking_id', bookingId).select('id').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('SLA-задача не найдена.');
  } else if (action === 'force_escalation') {
    await ensureLifecycleDraft({ bookingId, propertyId: current.state.propertyId, draftType: 'manual_operator_escalation', targetActor: 'operator', stage: current.state.currentStage, dueWindow: new Date().toISOString().slice(0, 10), dedupeKey: `manual-escalation:${new Date().toISOString().slice(0, 10)}:${reason}`, messageText: lifecycleDraftText('Оператор запросил ручную эскалацию.', bookingId, reason) });
  } else if (action === 'cancel') {
    await supabase.from('booking_ops_lifecycle_states').update({ current_stage: 'cancelled', status: 'cancelled', next_action: null, sla_status: 'cancelled', metadata: { overrideReason: reason }, updated_at: new Date().toISOString() }).eq('booking_id', bookingId);
    await supabase.from('booking_ops_sla_items').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('booking_id', bookingId).neq('status', 'satisfied').neq('status', 'waived');
  } else if (action === 'change_stage') {
    const stage = text(input.stage, 80);
    if (!(BOOKING_LIFECYCLE_ORCHESTRATOR_STAGES as readonly string[]).includes(stage)) throw new Error('Недопустимый этап.');
    if (['checkin_release_ready', 'checkin_release_draft_prepared', 'in_stay', 'completed'].includes(stage) && !current.state.finalCheckinDraftAllowed) {
      throw new Error('Нельзя обойти блокеры гостя, юридической или физической готовности.');
    }
    await supabase.from('booking_ops_lifecycle_states').update({ current_stage: stage, status: 'waiting_operator', metadata: { overrideReason: reason }, updated_at: new Date().toISOString() }).eq('booking_id', bookingId);
  } else {
    throw new Error('Недопустимое ручное изменение.');
  }
  await insertEvent({ bookingId, propertyId: current.state.propertyId, eventType: 'manual_override_applied', eventPayload: { action, reason, stage: input.stage ?? null, slaItemId: input.slaItemId ?? null, gatesBypassed: false }, actorType: 'operator', actorId: input.actorId ?? null });
  return getBookingLifecycleOrchestratorSnapshot(bookingId, false);
}

export async function forceBookingLifecycleEscalation(bookingId: unknown, reason: unknown, actorId?: string | null) {
  return applyBookingLifecycleManualOverride({ bookingId, action: 'force_escalation', reason, actorId });
}
