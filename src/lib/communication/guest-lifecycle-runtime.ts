import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { getBookingOpsByBookingId, getBookingOpsRecord } from '@/lib/booking-ops/repository';
import {
  attachAutoSendDecisionMetadata,
  canAutoSendCommunicationIntent,
} from '@/lib/booking-ops/communication-auto-send-policy';
import {
  enqueueAutoSendDelivery,
  executeAutoSendDelivery,
  type ExecuteAutoSendOptions,
} from '@/lib/booking-ops/communication-auto-send-executor';
import {
  buildRelevantGuestMemoryContext,
  loadGuestLongTermMemory,
  recordGuestOperationalEvent,
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
  const row = rows.find((candidate: any) =>
    text(candidate.id, 160) === event.reservationId || text(candidate.booking_id, 160) === event.reservationId,
  );
  if (!row) return null;
  const chatId = text(row.chat_id, 80);
  if (chatId) return { chatId };
  const identity = await maybeOne(
    db.from('tg_guest_identities').select('telegram_chat_id').eq('guest_id', event.guestId).limit(1),
  );
  return { chatId: text(identity?.telegram_chat_id, 80) || null };
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
  let guestMemory = null;
  try {
    guestMemory = buildRelevantGuestMemoryContext(await loadGuestLongTermMemory(event.guestId, db), '');
  } catch {
    guestMemory = null;
  }
  const channel = binding.chatId ? 'telegram' as const : 'email' as const;
  const activeHandoff = listEscalationReviews({ limit: 500 }).some((review) =>
    review.targetId === targetId && review.status !== 'closed',
  );
  return {
    ok: true,
    context: {
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
      .eq('metadata->>lifecycle_idempotency_key', input.idempotencyKey)
      .limit(1),
  );
  if (existing?.id) return { id: String(existing.id) };
  const metadata = intentMetadata(input);
  const decision = await canAutoSendCommunicationIntent({
    actorType: 'guest',
    purpose: input.plan.purpose,
    channel: input.context.channel,
    messageText: input.plan.text ?? '',
    metadata,
    bookingId: input.event.reservationId,
    bookingOpsRecordId: input.context.bookingOpsRecordId,
  }, {
    bookingId: input.event.reservationId,
    propertyId: input.event.propertyId,
    guestRef: input.context.targetId,
  });
  const now = new Date().toISOString();
  const response = await input.db.from('booking_ops_communication_intents').insert({
    id: randomUUID(),
    booking_ops_record_id: input.context.bookingOpsRecordId,
    booking_id: input.event.reservationId,
    related_task_id: null,
    actor_type: 'guest',
    actor_label: input.context.guestName,
    purpose: input.plan.purpose,
    channel: input.context.channel,
    status: 'draft_ready',
    message_text: input.plan.text,
    message_template_key: `guest.lifecycle.${input.event.eventType}.v1`,
    metadata: attachAutoSendDecisionMetadata(metadata, decision),
    created_at: now,
    updated_at: now,
  }).select('id').maybeSingle();
  return response?.error || !response?.data?.id ? null : { id: String(response.data.id) };
}

async function deliverDefault(
  input: {
    event: GuestLifecycleEvent;
    context: GuestLifecycleReservationContext;
    plan: GuestLifecyclePlan;
    idempotencyKey: string;
  },
  db: SupabaseLike,
  options: GuestLifecycleRuntimeOptions,
): Promise<GuestLifecycleDeliveryResult> {
  const intent = await createLifecycleIntent({ ...input, db });
  if (!intent) return { status: 'blocked', reason: 'lifecycle_intent_conflict' };
  const enqueued = await enqueueAutoSendDelivery(intent.id, {
    source: 'guest_lifecycle_v1',
    lifecycle_idempotency_key: input.idempotencyKey,
  });
  if (!enqueued.ok) {
    return { status: 'blocked', communicationIntentId: intent.id, reason: enqueued.error };
  }
  const executed = await executeAutoSendDelivery(enqueued.delivery.id, {
    ...(options.autoSendOptions ?? {}),
    dryRun: options.dryRun === true,
  });
  const deliveryStatus = executed.delivery?.status ?? null;
  if (executed.ok && (deliveryStatus === 'sent' || deliveryStatus === 'dry_run')) {
    if (deliveryStatus === 'dry_run') {
      const completed = await db.from('booking_ops_communication_intents').update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      }).eq('id', intent.id);
      if (completed?.error) {
        return {
          status: 'failed',
          communicationIntentId: intent.id,
          deliveryId: enqueued.delivery.id,
          deliveryStatus,
          reason: 'lifecycle_dry_run_intent_finalize_failed',
        };
      }
    }
    return {
      status: deliveryStatus,
      communicationIntentId: intent.id,
      deliveryId: enqueued.delivery.id,
      deliveryStatus,
    };
  }
  return {
    status: deliveryStatus === 'failed' ? 'failed' : 'blocked',
    communicationIntentId: intent.id,
    deliveryId: enqueued.delivery.id,
    deliveryStatus,
    reason: executed.error ?? 'lifecycle_delivery_blocked',
  };
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
    deliver: (input) => deliverDefault(input, db, options),
    async requestOperator(input) {
      const chatId = Number(input.context.targetId);
      const handoff = requestOperatorHandoff({
        sessionId: `lifecycle:${input.event.reservationId}:${input.event.eventType}`,
        channel: input.context.channel,
        targetId: input.context.targetId,
        actorId: input.event.guestId,
        role: 'guest',
        reservationId: input.event.reservationId,
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
        suggestedReply: input.plan.text ?? undefined,
        detail: input.plan.safeSummary,
        chatId: Number.isFinite(chatId) ? chatId : undefined,
      });
      return { reviewId: handoff.reviewId };
    },
    async recordMemory(input) {
      if (!input.plan.memoryEvent) return;
      await recordGuestOperationalEvent({
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
  options: { limit?: number; db?: SupabaseLike; accountIds?: string[] } = {},
): Promise<{ ok: true; items: GuestLifecycleVisibility[] } | { ok: false; error: string; items: [] }> {
  const db = options.db ?? (supabase as unknown as SupabaseLike);
  const allowedAccountIds = options.accountIds === undefined
    ? null
    : new Set(options.accountIds.map((value) => String(value).trim()).filter(Boolean));
  if (allowedAccountIds?.size === 0) return { ok: true, items: [] };
  const response = await db.from('guest_lifecycle_events')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 500, 1), 1000));
  if (response?.error) return { ok: false, error: response.error.message, items: [] };
  let rows = (response.data ?? []) as LifecycleRow[];
  const recordIds = [...new Set(rows.map((row) => row.booking_ops_record_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  const recordAccounts = new Map<string, string>();
  if (recordIds.length > 0) {
    const records = await db.from('booking_ops_records').select('id,guest_name,account_id').in('id', recordIds);
    if (allowedAccountIds && records?.error) return { ok: false, error: records.error.message, items: [] };
    for (const record of (records?.data ?? []) as Array<{ id: string; guest_name: string | null; account_id?: string | null }>) {
      names.set(record.id, text(record.guest_name, 160));
      if (typeof record.account_id === 'string' && record.account_id.trim()) {
        recordAccounts.set(record.id, record.account_id.trim());
      }
    }
  }
  if (allowedAccountIds) {
    const propertyIds = [...new Set(rows.map((row) => row.property_id).filter(Boolean))];
    const propertyAccounts = new Map<string, string>();
    if (propertyIds.length > 0) {
      const properties = await db.from('properties').select('id,account_id').in('id', propertyIds);
      if (properties?.error) return { ok: false, error: properties.error.message, items: [] };
      for (const property of (properties?.data ?? []) as Array<{ id: string; account_id?: string | null }>) {
        if (typeof property.account_id === 'string' && property.account_id.trim()) {
          propertyAccounts.set(property.id, property.account_id.trim());
        }
      }
    }
    rows = rows.filter((row) => {
      const candidates = new Set<string>();
      const recordAccount = row.booking_ops_record_id
        ? recordAccounts.get(row.booking_ops_record_id)
        : null;
      const propertyAccount = propertyAccounts.get(row.property_id);
      if (recordAccount) candidates.add(recordAccount);
      if (propertyAccount) candidates.add(propertyAccount);
      return candidates.size === 1 && allowedAccountIds.has([...candidates][0]!);
    });
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
