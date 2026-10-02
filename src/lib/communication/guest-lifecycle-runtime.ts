import { prepareBookingCommunication, bookingKnowledgeMetadata } from './booking-knowledge-boundary';
import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { getBookingOpsByBookingId, getBookingOpsRecord } from '@/lib/booking-ops/repository';

import type { ExecuteAutoSendOptions } from '@/lib/booking-ops/communication-auto-send-executor';
import {
  buildRelevantGuestMemoryContext,
  loadGuestLongTermMemory,
  recordGuestOperationalEvent,
  resolveGuestMemoryAccountId,
} from './guest-long-term-memory';
import { requestOperatorHandoff } from './handoff-lock';
import { listEscalationReviews } from './operator-review';
import {
  executeGuestLifecycleEvent,
  guestLifecycleStage,
  normalizeGuestLifecycleEvent,
  type GuestLifecycleContextResolution,
  type GuestLifecycleDeliveryResult,
  type GuestLifecycleEvent,
  type GuestLifecycleExecutionPort,
  type GuestLifecycleExecutionRecord,
  type GuestLifecycleExecutionResult,
  type GuestLifecyclePlan,
  type GuestLifecycleReservationContext,
  type GuestLifecycleStage,
} from './guest-lifecycle';

type SupabaseLike = { from: (table: string) => any };

type LifecycleRow = {
  id: string;
  idempotency_key: string;
  event_type: GuestLifecycleEvent['eventType'];
  reservation_id: string;
  booking_ops_record_id: string | null;
  property_id: string;
  guest_id: string;
  occurred_at: string;
  scheduled_for: string | null;
  source: string;
  source_event_id: string;
  stage: GuestLifecycleStage;
  status: GuestLifecycleExecutionRecord['status'];
  communication_intent_id: string | null;
  delivery_id: string | null;
  operator_review_id: string | null;
  delivery_status: string | null;
  language: 'ru' | 'en' | null;
  communication_mode: 'text' | 'voice' | null;
  safe_communication_summary: string | null;
  operator_action_required: boolean;
  failure_reason: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type GuestLifecycleRuntimeOptions = {
  db?: SupabaseLike;
  dryRun?: boolean;
  autoSendOptions?: Omit<ExecuteAutoSendOptions, 'dryRun'>;
  now?: Date;
};

export type GuestLifecycleVisibility = {
  reservationId: string;
  guest: string;
  currentStage: GuestLifecycleStage;
  mostRecentEvent: GuestLifecycleEvent['eventType'];
  mostRecentEventAt: string;
  mostRecentCommunication: string | null;
  pendingScheduledCommunication: { eventType: GuestLifecycleEvent['eventType']; scheduledFor: string } | null;
  deliveryStatus: string;
  operatorActionRequired: boolean;
};

function text(value: unknown, max = 200): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function mapRow(row: LifecycleRow): GuestLifecycleExecutionRecord {
  const payload = row.payload ?? {};
  const facts = payload.facts && typeof payload.facts === 'object'
    ? payload.facts as GuestLifecycleEvent['facts']
    : undefined;
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    event: normalizeGuestLifecycleEvent({
      eventType: row.event_type,
      reservationId: row.reservation_id,
      propertyId: row.property_id,
      guestId: row.guest_id,
      occurredAt: row.occurred_at,
      scheduledFor: row.scheduled_for,
      source: row.source,
      sourceEventId: row.source_event_id,
      language: row.language,
      facts,
    }),
    stage: row.stage,
    status: row.status,
    bookingOpsRecordId: row.booking_ops_record_id,
    communicationIntentId: row.communication_intent_id,
    deliveryId: row.delivery_id,
    operatorReviewId: row.operator_review_id,
    deliveryStatus: row.delivery_status,
    safeCommunicationSummary: row.safe_communication_summary,
    operatorActionRequired: row.operator_action_required,
    failureReason: row.failure_reason,
    updatedAt: row.updated_at,
  };
}

async function maybeOne(query: any): Promise<any | null> {
  const response = typeof query?.maybeSingle === 'function' ? await query.maybeSingle() : await query;
  if (response?.error && response.error.code !== 'PGRST116') return null;
  const data = response?.data ?? null;
  return Array.isArray(data) ? data[0] ?? null : data;
}

function safePayload(event: GuestLifecycleEvent): Record<string, unknown> {
  return {
    facts: event.facts ? {
      operatorConfirmed: event.facts.operatorConfirmed === true,
      feedbackAppropriate: event.facts.feedbackAppropriate === true,
      approvedUntil: text(event.facts.approvedUntil, 80) || null,
    } : undefined,
  };
}

async function exactReservationBinding(
  event: GuestLifecycleEvent,
  db: SupabaseLike,
): Promise<{ chatId: string | null } | null> {
  const response = await db
    .from('tg_guest_reservations')
    .select('id,booking_id,property_id,guest_id,chat_id,status')
    .eq('guest_id', event.guestId)
    .eq('property_id', event.propertyId)
    .limit(20);
  const rows = response?.error || !Array.isArray(response?.data) ? [] : response.data;
  const matches = rows.filter((candidate: Record<string, unknown>) =>
    text(candidate.property_id, 160) === event.propertyId
    && text(candidate.guest_id, 160) === event.guestId
    && (text(candidate.id, 160) === event.reservationId || text(candidate.booking_id, 160) === event.reservationId));
  if (matches.length !== 1) return null;
  // A global guest-id identity is not an account/property binding.
  return { chatId: text(matches[0].chat_id, 80) || null };
}

async function reservationWasCancelled(event: GuestLifecycleEvent, db: SupabaseLike): Promise<boolean> {
  const response = await db
    .from('guest_lifecycle_events')
    .select('id')
    .eq('reservation_id', event.reservationId)
    .eq('event_type', 'reservation.cancelled')
    .in('status', ['sent', 'dry_run', 'completed', 'operator_required'])
    .limit(1);
  return !response?.error && Array.isArray(response?.data) && response.data.length > 0;
}

async function resolveDefaultContext(
  event: GuestLifecycleEvent,
  db: SupabaseLike,
): Promise<GuestLifecycleContextResolution> {
  const record = await getBookingOpsByBookingId(event.reservationId) ?? await getBookingOpsRecord(event.reservationId);
  if (!record) return { ok: false, reason: 'reservation_not_found' };
  if (record.propertyId !== event.propertyId) return { ok: false, reason: 'property_mismatch' };
  const binding = await exactReservationBinding(event, db);
  if (!binding) return { ok: false, reason: 'reservation_guest_mismatch' };
  const targetId = binding.chatId || text(record.guestEmail, 240);
  if (!targetId) return { ok: false, reason: 'recipient_missing' };
  const accountId = await resolveGuestMemoryAccountId({
    accountId: record.accountId, propertyId: event.propertyId, reservationId: record.id, db,
  });
  if (!accountId) return { ok: false, reason: 'property_mismatch' };
  let guestMemory = null;
  try {
    guestMemory = buildRelevantGuestMemoryContext(
      await loadGuestLongTermMemory({ accountId, guestId: event.guestId }, db), '');
  } catch { guestMemory = null; }
  const channel = binding.chatId ? 'telegram' as const : 'email' as const;
  const activeHandoff = listEscalationReviews({ limit: 500 }).some((review) =>
    review.targetId === targetId && review.status !== 'closed',
  );
  return {
    ok: true,
    context: {
      accountId,
      bookingOpsRecordId: record.id,
      reservationId: event.reservationId,
      propertyId: event.propertyId,
      guestId: event.guestId,
      guestName: record.guestName,
      channel,
      targetId,
      checkInAt: record.checkInAt,
      checkOutAt: record.checkOutAt,
      propertyLabel: record.propertyLabel,
      propertyKnowledge: record.propertyKnowledge ?? null,
      guestMemory,
      identityVerified: true,
      accessAllowed: record.checkinReadinessStatus === 'ready' && record.unitReadinessStatus === 'ready',
      reservationCancelled: await reservationWasCancelled(event, db),
      operatorHandoffActive: activeHandoff,
    },
  };
}

function sameLifecycleBinding(a: GuestLifecycleReservationContext, b: GuestLifecycleReservationContext): boolean {
  return !!a.accountId && ['accountId', 'bookingOpsRecordId', 'propertyId', 'guestId', 'targetId', 'channel']
    .every((key) => a[key as keyof GuestLifecycleReservationContext] === b[key as keyof GuestLifecycleReservationContext]);
}

function intentMetadata(input: {
  event: GuestLifecycleEvent;
  context: GuestLifecycleReservationContext;
  plan: GuestLifecyclePlan;
  idempotencyKey: string;
}) {
  return {
    lifecycle_event_type: input.event.eventType,
    lifecycle_stage: input.plan.stage,
    lifecycle_idempotency_key: input.idempotencyKey,
    lifecycle_source: input.event.source,
    lifecycle_source_event_id: input.event.sourceEventId,
    identity_verified: true,
    access_allowed: input.context.accessAllowed,
    guest_id: input.event.guestId,
    property_id: input.event.propertyId,
    recipient_ref: input.context.targetId,
    communication_mode: input.plan.communicationMode,
    language: input.plan.language,
    urgent: input.plan.urgent,
    classification_confidence: 1,
  };
}

async function createLifecycleIntent(input: {
  event: GuestLifecycleEvent;
  context: GuestLifecycleReservationContext;
  plan: GuestLifecyclePlan;
  idempotencyKey: string;
  db: SupabaseLike;
}): Promise<{ id: string } | null> {
  const existing = await maybeOne(
    input.db.from('booking_ops_communication_intents')
      .select('id')
      .eq('booking_ops_record_id', input.context.bookingOpsRecordId)
      .eq('metadata->>lifecycle_idempotency_key', input.idempotencyKey)
      .limit(1),
  );

  const metadata = intentMetadata(input);
  const freshContext = await resolveDefaultContext(input.event, input.db);
  if (!freshContext.ok || !sameLifecycleBinding(input.context, freshContext.context)) return null;
  const knowledge = await prepareBookingCommunication({
    recordId: input.context.bookingOpsRecordId, accountId: input.context.accountId, propertyId: input.event.propertyId,
    purpose: input.plan.purpose,
  }, input.db as typeof supabase);
  if (!knowledge.result.scope) return null;
  const now = new Date().toISOString();
  const payload = {
    id: randomUUID(),
    booking_ops_record_id: input.context.bookingOpsRecordId,
    booking_id: input.event.reservationId,
    related_task_id: null,
    actor_type: 'guest',
    actor_label: input.context.guestName,
    purpose: input.plan.purpose,
    channel: input.context.channel,
    status: knowledge.reviewRequired ? 'waiting_for_external_input' : 'draft_ready',
    message_text: knowledge.text,
    message_template_key: `guest.lifecycle.${input.event.eventType}.v1`,
    metadata: { ...metadata, ...bookingKnowledgeMetadata(knowledge) },
    created_at: now,
    updated_at: now,
  };
  const response = existing?.id
    ? await input.db.from('booking_ops_communication_intents').update({
        message_text: knowledge.text, metadata: payload.metadata, status: payload.status, updated_at: now,
      }).eq('id', existing.id).eq('booking_ops_record_id', input.context.bookingOpsRecordId).select('id').maybeSingle()
    : await input.db.from('booking_ops_communication_intents').insert(payload).select('id').maybeSingle();
  if (response?.error || !response?.data?.id) return null;
  requestOperatorHandoff({
    accountId: knowledge.result.scope.accountId, propertyId: knowledge.result.scope.propertyId,
    sessionId: 'lifecycle:' + input.context.bookingOpsRecordId + ':' + input.event.eventType,
    channel: input.context.channel, targetId: input.context.targetId, role: 'guest',
    reservationId: input.context.bookingOpsRecordId, actorId: input.event.guestId,
    escalationReason: 'communication_knowledge_review', detail: knowledge.summary,
    suggestedReply: knowledge.reviewRequired ? undefined : knowledge.text,
    source: { route: 'communication_knowledge', needs_operator: true },
  });
  return { id: String(response.data.id) };
}

async function deliverDefault(
  input: {
    event: GuestLifecycleEvent;
    context: GuestLifecycleReservationContext;
    plan: GuestLifecyclePlan;
    idempotencyKey: string;
  },
  db: SupabaseLike,
): Promise<GuestLifecycleDeliveryResult> {
  const intent = await createLifecycleIntent({ ...input, db });
  if (!intent) return { status: 'blocked', reason: 'lifecycle_intent_conflict' };
  return { status: 'blocked', communicationIntentId: intent.id, reason: 'knowledge_operator_review_required' };

}

function memorySummary(input: { event: GuestLifecycleEvent; plan: GuestLifecyclePlan }): string {
  if (input.plan.memoryEvent === 'completed_stay') return 'Completed stay recorded from verified lifecycle event.';
  if (input.plan.memoryEvent === 'late_checkout_history') {
    const until = text(input.event.facts?.approvedUntil, 80);
    return until ? `Verified late checkout approved until ${until}.` : 'Verified late checkout approved.';
  }
  return 'Operator-confirmed incident resolution.';
}

export function createGuestLifecycleRuntimePort(options: GuestLifecycleRuntimeOptions = {}): GuestLifecycleExecutionPort {
  const db = options.db ?? (supabase as unknown as SupabaseLike);
  return {
    async findByIdempotencyKey(key) {
      const row = await maybeOne(db.from('guest_lifecycle_events').select('*').eq('idempotency_key', key).limit(1));
      return row ? mapRow(row as LifecycleRow) : null;
    },
    async claim(event, key, stage) {
      const now = (options.now ?? new Date()).toISOString();
      const response = await db.from('guest_lifecycle_events').insert({
        id: randomUUID(),
        idempotency_key: key,
        event_type: event.eventType,
        reservation_id: event.reservationId,
        property_id: event.propertyId,
        guest_id: event.guestId,
        occurred_at: event.occurredAt,
        scheduled_for: event.scheduledFor ?? null,
        source: event.source,
        source_event_id: event.sourceEventId,
        stage,
        status: 'received',
        language: event.language ?? null,
        payload: safePayload(event),
        created_at: now,
        updated_at: now,
      }).select('*').maybeSingle();
      if (!response?.error && response?.data) return mapRow(response.data as LifecycleRow);
      const existing = await maybeOne(db.from('guest_lifecycle_events').select('*').eq('idempotency_key', key).limit(1));
      if (!existing) throw new Error(response?.error?.message ?? 'lifecycle_claim_failed');
      return mapRow(existing as LifecycleRow);
    },
    async update(id, patch) {
      const rowPatch: Record<string, unknown> = {};
      if (patch.status !== undefined) rowPatch.status = patch.status;
      if (patch.bookingOpsRecordId !== undefined) rowPatch.booking_ops_record_id = patch.bookingOpsRecordId;
      if (patch.communicationIntentId !== undefined) rowPatch.communication_intent_id = patch.communicationIntentId;
      if (patch.deliveryId !== undefined) rowPatch.delivery_id = patch.deliveryId;
      if (patch.operatorReviewId !== undefined) rowPatch.operator_review_id = patch.operatorReviewId;
      if (patch.deliveryStatus !== undefined) rowPatch.delivery_status = patch.deliveryStatus;
      if (patch.safeCommunicationSummary !== undefined) rowPatch.safe_communication_summary = patch.safeCommunicationSummary;
      if (patch.operatorActionRequired !== undefined) rowPatch.operator_action_required = patch.operatorActionRequired;
      if (patch.failureReason !== undefined) rowPatch.failure_reason = patch.failureReason;
      rowPatch.updated_at = patch.updatedAt ?? new Date().toISOString();
      const response = await db.from('guest_lifecycle_events').update(rowPatch).eq('id', id).select('*').maybeSingle();
      if (response?.error || !response?.data) throw new Error(response?.error?.message ?? 'lifecycle_update_failed');
      return mapRow(response.data as LifecycleRow);
    },
    resolveContext: (event) => resolveDefaultContext(event, db),
    deliver: (input) => deliverDefault(input, db),
    async requestOperator(input) {
      const chatId = Number(input.context.targetId);
      const fresh = await resolveDefaultContext(input.event, db);
      if (!fresh.ok || !sameLifecycleBinding(input.context, fresh.context)) throw new Error('lifecycle_owner_unavailable');
      const knowledge = await prepareBookingCommunication({
        recordId: input.context.bookingOpsRecordId, accountId: input.context.accountId,
        propertyId: input.event.propertyId, purpose: input.plan.purpose,
      }, db as typeof supabase);
      if (!knowledge.result.scope) throw new Error('lifecycle_owner_unavailable');
      const accountId = knowledge.result.scope.accountId;
      const handoff = requestOperatorHandoff({
        accountId,
        sessionId: `lifecycle:${input.event.reservationId}:${input.event.eventType}`,
        channel: input.context.channel,
        targetId: input.context.targetId,
        actorId: input.event.guestId,
        role: 'guest',
        reservationId: input.context.bookingOpsRecordId,
        propertyId: input.event.propertyId,
        escalationReason: input.plan.operatorReason ?? `lifecycle:${input.event.eventType}`,
        confidence: 1,
        source: {
          source: 'guest_lifecycle_v1',
          lifecycle_event_type: input.event.eventType,
          lifecycle_idempotency_key: input.idempotencyKey,
          guest_id: input.event.guestId,
          urgent: input.plan.urgent,
        },
        suggestedReply: knowledge.reviewRequired ? undefined : knowledge.text,
        detail: knowledge.summary,
        chatId: Number.isFinite(chatId) ? chatId : undefined,
      });
      return { reviewId: handoff.reviewId };
    },
    async recordMemory(input) {
      if (!input.plan.memoryEvent || !input.context.accountId) return;
      const fresh = await resolveDefaultContext(input.event, db);
      if (!fresh.ok || !sameLifecycleBinding(input.context, fresh.context)) return;
      const accountId = await resolveGuestMemoryAccountId({
        accountId: input.context.accountId,
        propertyId: input.event.propertyId,
        reservationId: input.context.bookingOpsRecordId,
        db,
      });
      if (!accountId) return;
      await recordGuestOperationalEvent({
        accountId,
        guestId: input.event.guestId,
        type: input.plan.memoryEvent,
        summary: memorySummary(input),
        bookingReference: input.event.reservationId,
        source: input.plan.memoryEvent === 'operator_confirmed_resolution' ? 'operator_confirmed' : 'deterministic_system',
        sourceRef: input.idempotencyKey,
        confidence: 1,
        occurredAt: input.event.occurredAt,
        db,
      });
    },
  };
}

export async function handleGuestLifecycleEvent(
  event: GuestLifecycleEvent,
  options: GuestLifecycleRuntimeOptions = {},
): Promise<GuestLifecycleExecutionResult> {
  return executeGuestLifecycleEvent(event, createGuestLifecycleRuntimePort(options), { now: options.now });
}

export async function runDueGuestLifecycleEvents(options: GuestLifecycleRuntimeOptions & { limit?: number } = {}) {
  const db = options.db ?? (supabase as unknown as SupabaseLike);
  const now = options.now ?? new Date();
  const response = await db.from('guest_lifecycle_events')
    .select('*')
    .in('status', ['scheduled', 'failed'])
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(Math.min(Math.max(options.limit ?? 20, 1), 100));
  if (response?.error) return { ok: false as const, error: response.error.message, results: [] };
  const rows = ((response?.data ?? []) as LifecycleRow[]).map(mapRow);
  const results = [];
  for (const row of rows) results.push(await handleGuestLifecycleEvent(row.event, options));
  return { ok: true as const, results };
}

export async function listGuestLifecycleVisibility(
  options: { limit?: number; db?: SupabaseLike; accountId?: string } = {},
): Promise<{ ok: true; items: GuestLifecycleVisibility[] } | { ok: false; error: string; items: [] }> {
  const db = options.db ?? (supabase as unknown as SupabaseLike);
  const response = await db.from('guest_lifecycle_events')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 500, 1), 1000));
  if (response?.error) return { ok: false, error: response.error.message, items: [] };
  let rows = (response.data ?? []) as LifecycleRow[];
  if (options.accountId) {
    // Tenant API visibility needs both current property and record ownership.
    const ownedProperties = await db.from('properties').select('id').eq('account_id', options.accountId);
    const ownedRecords = await db.from('booking_ops_records').select('id,property_id').eq('account_id', options.accountId);
    if (ownedProperties.error || ownedRecords.error || !Array.isArray(ownedProperties.data)
      || !Array.isArray(ownedRecords.data)) return { ok: false, error: 'lifecycle_scope_unavailable', items: [] };
    const properties = new Set(ownedProperties.data.map((row: { id: string }) => row.id));
    const records = new Map(ownedRecords.data.map((row: { id: string; property_id: string }) => [row.id, row.property_id]));
    rows = rows.filter((row) => properties.has(row.property_id)
      && !!row.booking_ops_record_id && records.get(row.booking_ops_record_id) === row.property_id);
  }
  const recordIds = [...new Set(rows.map((row) => row.booking_ops_record_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (recordIds.length > 0) {
    const records = await db.from('booking_ops_records').select('id,guest_name').in('id', recordIds);
    for (const record of (records?.data ?? []) as Array<{ id: string; guest_name: string | null }>) {
      names.set(record.id, text(record.guest_name, 160));
    }
  }
  const grouped = new Map<string, LifecycleRow[]>();
  for (const row of rows) grouped.set(row.reservation_id, [...(grouped.get(row.reservation_id) ?? []), row]);
  const items = [...grouped.entries()].map(([reservationId, group]) => {
    const latest = group[0]!;
    const latestCommunication = group.find((row) => text(row.safe_communication_summary, 300));
    const pending = [...group]
      .filter((row) => row.status === 'scheduled' && row.scheduled_for)
      .sort((left, right) => String(left.scheduled_for).localeCompare(String(right.scheduled_for)))[0];
    return {
      reservationId,
      guest: names.get(latest.booking_ops_record_id ?? '') || latest.guest_id,
      currentStage: latest.stage,
      mostRecentEvent: latest.event_type,
      mostRecentEventAt: latest.occurred_at,
      mostRecentCommunication: latestCommunication?.safe_communication_summary ?? null,
      pendingScheduledCommunication: pending?.scheduled_for
        ? { eventType: pending.event_type, scheduledFor: pending.scheduled_for }
        : null,
      deliveryStatus: latest.delivery_status ?? latest.status,
      operatorActionRequired: group.some((row) => row.operator_action_required && !['sent', 'completed', 'skipped'].includes(row.status)),
    } satisfies GuestLifecycleVisibility;
  });
  return { ok: true, items };
}

export function lifecycleStageForEvent(event: GuestLifecycleEvent): GuestLifecycleStage {
  return guestLifecycleStage(event.eventType);
}
