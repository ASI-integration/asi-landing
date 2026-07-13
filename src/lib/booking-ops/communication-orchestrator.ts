import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import {
  attachAutoSendDecisionMetadata,
  canAutoSendCommunicationIntent,
  evaluateAndPersistIntentAutoSendDecision,
} from './communication-auto-send-policy';
import { recordBookingOpsEvent } from './events';
import { computeBookingReadiness } from './readiness';
import {
  BOOKING_OPS_COMMUNICATION_ACTOR_TYPES,
  BOOKING_OPS_COMMUNICATION_CHANNELS,
  BOOKING_OPS_COMMUNICATION_PURPOSES,
  BOOKING_OPS_COMMUNICATION_STATUSES,
  type BookingOpsCommunicationActorType,
  type BookingOpsCommunicationChannel,
  type BookingOpsCommunicationIntent,
  type BookingOpsCommunicationPurpose,
  type BookingOpsCommunicationStatus,
  type BookingOpsRecord,
} from './types';
import type { BookingOpsTask, BookingOpsTaskType } from './task-types';

export type PlannedBookingOpsCommunication = {
  actorType: BookingOpsCommunicationActorType;
  actorLabel: string | null;
  purpose: BookingOpsCommunicationPurpose;
  channel: BookingOpsCommunicationChannel;
  status: Extract<BookingOpsCommunicationStatus, 'draft_ready' | 'waiting_for_external_input'>;
  messageText: string;
  messageTemplateKey: string;
  relatedTaskId: string | null;
  metadata?: Record<string, unknown>;
};

export type BookingOpsCommunicationPlan = {
  desired: PlannedBookingOpsCommunication[];
  toCreate: PlannedBookingOpsCommunication[];
  toUpdate: Array<{
    existing: BookingOpsCommunicationIntent;
    desired: PlannedBookingOpsCommunication;
  }>;
  toSupersede: BookingOpsCommunicationIntent[];
  nextAction: string | null;
};

export const OPERATOR_MISSING_DATA_REASONS = [
  'guest_data',
  'guest_documents',
  'legal_confirmation',
  'payment',
  'compliance',
  'arrival',
  'communication',
] as const;

export type OperatorMissingDataReason = (typeof OPERATOR_MISSING_DATA_REASONS)[number];

const OPERATOR_REQUEST_DEFINITION: Record<OperatorMissingDataReason, {
  purpose: BookingOpsCommunicationPurpose;
  message: string;
  template: string;
}> = {
  guest_data: { purpose: 'request_missing_guest_data', message: 'Запросить у гостя недостающие данные.', template: 'operator.missing_guest_data.v1' },
  guest_documents: { purpose: 'request_guest_documents', message: 'Запросить у гостя недостающие документы.', template: 'guest.documents_request.v1' },
  legal_confirmation: { purpose: 'request_contract_confirmation', message: 'Запросить недостающее подтверждение по договору.', template: 'guest.contract_confirmation.v1' },
  payment: { purpose: 'request_deposit_payment', message: 'Запросить недостающие данные об оплате или депозите.', template: 'guest.deposit_request.v1' },
  compliance: { purpose: 'request_mvd_data', message: 'Запросить недостающие данные для обязательной отчётности.', template: 'guest.mvd_data_request.v1' },
  arrival: { purpose: 'request_arrival_time', message: 'Запросить у гостя время прибытия.', template: 'guest.arrival_time_request.v1' },
  communication: { purpose: 'guest_data_missing_notice', message: 'Запросить недостающие данные для связи с гостем.', template: 'operator.missing_communication_data.v1' },
};

const ACTIVE_STATUSES = new Set<BookingOpsCommunicationStatus>([
  'draft_ready',
  'waiting_for_external_input',
]);

const TERMINAL_STATUSES = new Set<BookingOpsCommunicationStatus>([
  'completed',
  'superseded',
  'cancelled',
]);

const PURPOSE_PRIORITY: BookingOpsCommunicationPurpose[] = [
  'issue_escalation_notice',
  'request_guest_documents',
  'request_deposit_payment',
  'request_contract_confirmation',
  'request_mvd_data',
  'cleaning_assignment',
  'linen_pickup_request',
  'maintenance_request',
  'readiness_confirmation_needed',
  'inspection_request',
  'guest_data_missing_notice',
];

const NEXT_ACTION_BY_PURPOSE: Partial<Record<BookingOpsCommunicationPurpose, string>> = {
  request_guest_documents: 'Отправить запрос документов гостю',
  request_contract_confirmation: 'Отправить запрос подтверждения договора',
  request_deposit_payment: 'Отправить запрос депозита гостю',
  request_mvd_data: 'Ожидаем данные МВД от гостя',
  cleaning_assignment: 'Назначить уборку',
  linen_pickup_request: 'Связаться с прачечной',
  maintenance_request: 'Передать задачу мастеру',
  readiness_confirmation_needed: 'Подтвердить готовность объекта',
  inspection_request: 'Назначить осмотр объекта',
  guest_data_missing_notice: 'Ожидаем документы гостя',
};

type CommunicationRow = {
  id: string;
  booking_ops_record_id: string;
  booking_id: string | null;
  related_task_id: string | null;
  actor_type: string;
  actor_label: string | null;
  purpose: string;
  channel: string;
  status: string;
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

function includesValue<T extends string>(values: readonly T[], raw: string): raw is T {
  return (values as readonly string[]).includes(raw);
}

function mapRow(row: CommunicationRow): BookingOpsCommunicationIntent {
  return {
    id: row.id,
    bookingOpsRecordId: row.booking_ops_record_id,
    bookingId: text(row.booking_id) || null,
    relatedTaskId: text(row.related_task_id) || null,
    actorType: includesValue(BOOKING_OPS_COMMUNICATION_ACTOR_TYPES, row.actor_type)
      ? row.actor_type
      : 'admin',
    actorLabel: text(row.actor_label) || null,
    purpose: includesValue(BOOKING_OPS_COMMUNICATION_PURPOSES, row.purpose)
      ? row.purpose
      : 'guest_data_missing_notice',
    channel: includesValue(BOOKING_OPS_COMMUNICATION_CHANNELS, row.channel)
      ? row.channel
      : 'internal',
    status: includesValue(BOOKING_OPS_COMMUNICATION_STATUSES, row.status)
      ? row.status
      : 'draft_ready',
    messageText: row.message_text,
    messageTemplateKey: row.message_template_key,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    supersededAt: row.superseded_at,
  };
}

function communicationKey(
  item: Pick<BookingOpsCommunicationIntent | PlannedBookingOpsCommunication,
    'actorType' | 'purpose' | 'relatedTaskId'>,
): string {
  return [item.actorType, item.purpose, item.relatedTaskId ?? 'none'].join(':');
}

function openTask(tasks: BookingOpsTask[], taskType: BookingOpsTaskType): BookingOpsTask | null {
  return tasks.find((task) =>
    task.taskType === taskType
    && (task.status === 'open' || task.status === 'in_progress' || task.status === 'blocked')
  ) ?? null;
}

function preferredGuestChannel(record: BookingOpsRecord): BookingOpsCommunicationChannel {
  if (record.guestTelegram) return 'telegram';
  if (record.guestEmail) return 'email';
  return 'manual';
}

function guestName(record: BookingOpsRecord): string {
  return record.guestName?.trim() || 'гость';
}

function propertyName(record: BookingOpsRecord): string {
  return record.propertyLabel?.trim() || record.propertyId?.trim() || 'объект';
}

function planGuestCommunications(record: BookingOpsRecord, tasks: BookingOpsTask[]): PlannedBookingOpsCommunication[] {
  const readiness = record.readiness ?? computeBookingReadiness(record);
  const channel = preferredGuestChannel(record);
  const guest = guestName(record);
  const property = propertyName(record);
  const items: PlannedBookingOpsCommunication[] = [];

  if (record.guestIntake?.intakeStatus === 'fallback_required') {
    const task = openTask(tasks, 'guest_intake_operator_fallback');
    items.push({
      actorType: 'admin',
      actorLabel: 'Оператор',
      purpose: 'issue_escalation_notice',
      channel: 'internal',
      status: 'draft_ready',
      relatedTaskId: task?.id ?? null,
      messageTemplateKey: 'operator.guest_intake_fallback.v1',
      messageText: record.guestIntake.fallbackReason ?? 'Требуется ручная помощь гостю',
      metadata: {
        guestIntakeSessionId: record.guestIntake.id,
        guestIntakeStatus: record.guestIntake.intakeStatus,
        fallbackReason: record.guestIntake.fallbackReason,
      },
    });
  }

  if (readiness.status === 'missing_documents') {
    const task = openTask(tasks, 'request_guest_documents');
    items.push({
      actorType: 'guest',
      actorLabel: guest,
      purpose: 'request_guest_documents',
      channel,
      status: 'draft_ready',
      relatedTaskId: task?.id ?? null,
      messageTemplateKey: 'guest.documents_request.v1',
      messageText: `Здравствуйте, ${guest}. Для подготовки заезда по объекту ${property} нужны документы гостя. Пришлите, пожалуйста, данные удобным способом.`,
      metadata: { readinessStatus: readiness.status, taskType: task?.taskType ?? 'request_guest_documents' },
    });
  }

  if (readiness.status === 'missing_contract') {
    const task = openTask(tasks, 'send_contract_manual') ?? openTask(tasks, 'follow_up_contract_signature');
    if (task) {
      items.push({
        actorType: 'guest',
        actorLabel: guest,
        purpose: 'request_contract_confirmation',
        channel,
        status: 'draft_ready',
        relatedTaskId: task.id,
        messageTemplateKey: 'guest.contract_confirmation.v1',
        messageText: `Здравствуйте, ${guest}. Проверьте, пожалуйста, договор по брони ${property} и подтвердите, что всё в порядке.`,
        metadata: { readinessStatus: readiness.status, taskType: task.taskType },
      });
    }
  }

  if (readiness.status === 'missing_deposit') {
    const task = openTask(tasks, 'request_deposit') ?? openTask(tasks, 'confirm_deposit');
    items.push({
      actorType: 'guest',
      actorLabel: guest,
      purpose: 'request_deposit_payment',
      channel,
      status: task?.taskType === 'confirm_deposit' ? 'waiting_for_external_input' : 'draft_ready',
      relatedTaskId: task?.id ?? null,
      messageTemplateKey: 'guest.deposit_request.v1',
      messageText: `Здравствуйте, ${guest}. Для завершения подготовки брони по объекту ${property} нужно внести депозит. Подскажите, пожалуйста, когда будет удобно оплатить.`,
      metadata: { readinessStatus: readiness.status, taskType: task?.taskType ?? 'request_deposit' },
    });
  }

  if (readiness.status === 'missing_mvd_data') {
    const task = openTask(tasks, 'collect_mvd_data');
    items.push({
      actorType: 'guest',
      actorLabel: guest,
      purpose: 'request_mvd_data',
      channel,
      status: 'draft_ready',
      relatedTaskId: task?.id ?? null,
      messageTemplateKey: 'guest.mvd_data_request.v1',
      messageText: `Здравствуйте, ${guest}. Для регистрации МВД нужны данные гостей. Пришлите их, пожалуйста, до заезда.`,
      metadata: { readinessStatus: readiness.status, taskType: task?.taskType ?? 'collect_mvd_data' },
    });
  }

  return items;
}

function taskCommunication(record: BookingOpsRecord, task: BookingOpsTask): PlannedBookingOpsCommunication | null {
  const property = propertyName(record);
  const base = {
    relatedTaskId: task.id,
    metadata: { taskType: task.taskType },
  };

  switch (task.taskType) {
    case 'cleaning_needed':
      return {
        ...base,
        actorType: 'cleaner',
        actorLabel: 'Клининг',
        purpose: 'cleaning_assignment',
        channel: 'manual',
        status: 'draft_ready',
        messageTemplateKey: 'cleaner.cleaning_assignment.v1',
        messageText: `Нужно назначить уборку объекта ${property} после выезда гостя. Подтвердите, пожалуйста, время уборки.`,
      };
    case 'linen_pickup_needed':
      return {
        ...base,
        actorType: 'laundry',
        actorLabel: 'Прачечная',
        purpose: 'linen_pickup_request',
        channel: 'manual',
        status: 'draft_ready',
        messageTemplateKey: 'laundry.linen_pickup.v1',
        messageText: `Нужно забрать и подготовить бельё для объекта ${property}. Подтвердите, пожалуйста, статус.`,
      };
    case 'inspection_needed':
      return {
        ...base,
        actorType: 'admin',
        actorLabel: 'Оператор',
        purpose: 'inspection_request',
        channel: 'internal',
        status: 'draft_ready',
        messageTemplateKey: 'admin.inspection_request.v1',
        messageText: `Нужно провести финальный осмотр объекта ${property} и отметить результат в задачах.`,
      };
    case 'maintenance_needed':
      return {
        ...base,
        actorType: 'master',
        actorLabel: 'Мастер',
        purpose: 'maintenance_request',
        channel: 'manual',
        status: 'draft_ready',
        messageTemplateKey: 'master.maintenance_request.v1',
        messageText: `По объекту ${property} нужна задача мастеру. Проверьте описание проблемы и подтвердите срок ремонта.`,
      };
    case 'unit_ready_confirmation':
      return {
        ...base,
        actorType: 'admin',
        actorLabel: 'Оператор',
        purpose: 'readiness_confirmation_needed',
        channel: 'internal',
        status: 'draft_ready',
        messageTemplateKey: 'admin.unit_ready_confirmation.v1',
        messageText: `Проверьте, что объект ${property} готов к следующему заезду, и подтвердите готовность в Booking Ops.`,
      };
    default:
      return null;
  }
}

function planTaskCommunications(record: BookingOpsRecord, tasks: BookingOpsTask[]): PlannedBookingOpsCommunication[] {
  return tasks.flatMap((task) => {
    if (!(task.status === 'open' || task.status === 'in_progress' || task.status === 'blocked')) {
      return [];
    }
    const planned = taskCommunication(record, task);
    return planned ? [planned] : [];
  });
}

function sortByPriority(items: PlannedBookingOpsCommunication[]): PlannedBookingOpsCommunication[] {
  return [...items].sort((left, right) => {
    const leftIndex = PURPOSE_PRIORITY.indexOf(left.purpose);
    const rightIndex = PURPOSE_PRIORITY.indexOf(right.purpose);
    return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
  });
}

export function planBookingOpsCommunications(input: {
  record: BookingOpsRecord;
  tasks: BookingOpsTask[];
  existingCommunications?: BookingOpsCommunicationIntent[];
}): BookingOpsCommunicationPlan {
  const desired = sortByPriority([
    ...planGuestCommunications(input.record, input.tasks),
    ...planTaskCommunications(input.record, input.tasks),
  ]);
  const desiredKeys = new Set(desired.map(communicationKey));
  const active = (input.existingCommunications ?? []).filter((item) => ACTIVE_STATUSES.has(item.status));
  const terminal = (input.existingCommunications ?? []).filter((item) => TERMINAL_STATUSES.has(item.status));
  const activeByKey = new Map(active.map((item) => [communicationKey(item), item]));
  const terminalCompletedKeys = new Set(
    terminal.filter((item) => item.status === 'completed').map(communicationKey),
  );

  const toCreate: PlannedBookingOpsCommunication[] = [];
  const toUpdate: BookingOpsCommunicationPlan['toUpdate'] = [];

  for (const item of desired) {
    const key = communicationKey(item);
    if (terminalCompletedKeys.has(key)) continue;
    const existing = activeByKey.get(key);
    if (!existing) {
      toCreate.push(item);
      continue;
    }
    if (
      existing.status !== item.status
      || existing.channel !== item.channel
      || existing.messageText !== item.messageText
      || existing.actorLabel !== item.actorLabel
      || existing.messageTemplateKey !== item.messageTemplateKey
    ) {
      toUpdate.push({ existing, desired: item });
    }
  }

  const toSupersede = active.filter((item) => !desiredKeys.has(communicationKey(item)));
  const next = desired.find((item) => NEXT_ACTION_BY_PURPOSE[item.purpose]);
  return {
    desired,
    toCreate,
    toUpdate,
    toSupersede,
    nextAction: next ? NEXT_ACTION_BY_PURPOSE[next.purpose] ?? null : null,
  };
}

export async function listBookingOpsCommunicationsForRecord(
  bookingOpsRecordId: string,
): Promise<{ ok: true; communications: BookingOpsCommunicationIntent[] } | { ok: false; error: string }> {
  const recordId = text(bookingOpsRecordId);
  if (!recordId) return { ok: false, error: 'id_required' };

  const { data, error } = await supabase
    .from('booking_ops_communication_intents')
    .select('*')
    .eq('booking_ops_record_id', recordId)
    .order('updated_at', { ascending: false });

  if (error) return { ok: false, error: error.message };
  const communications = ((data ?? []) as CommunicationRow[]).map(mapRow);
  if (communications.length === 0) return { ok: true, communications };

  const { data: deliveries } = await supabase
    .from('booking_ops_communication_deliveries')
    .select('communication_intent_id,status,attempt_count,last_attempt_at,sent_at,failure_reason,idempotency_key,safe_summary,created_at')
    .in('communication_intent_id', communications.map((item) => item.id))
    .order('created_at', { ascending: false });
  const latestDelivery = new Map<string, Record<string, unknown>>();
  for (const raw of (deliveries ?? []) as Array<Record<string, unknown>>) {
    const intentId = String(raw.communication_intent_id ?? '');
    if (!intentId || latestDelivery.has(intentId)) continue;
    latestDelivery.set(intentId, {
      status: raw.status,
      attemptCount: raw.attempt_count,
      lastAttemptAt: raw.last_attempt_at,
      sentAt: raw.sent_at,
      failureReason: raw.failure_reason,
      idempotencyKey: `${String(raw.idempotency_key ?? '').slice(0, 10)}…`,
      safeSummary: raw.safe_summary,
    });
  }
  return {
    ok: true,
    communications: communications.map((item) => ({
      ...item,
      metadata: {
        ...item.metadata,
        auto_send_delivery: latestDelivery.get(item.id) ?? null,
      },
    })),
  };
}

export async function createOperatorMissingDataRequestDraft(input: {
  bookingOpsRecordId: string;
  bookingId: string | null;
  alertId: string;
  reason: OperatorMissingDataReason;
  actorId: string;
}): Promise<{ communication: BookingOpsCommunicationIntent; created: boolean; actuallySent: false }> {
  if (!OPERATOR_MISSING_DATA_REASONS.includes(input.reason)) throw new Error('missing_data_reason_unsupported');
  const definition = OPERATOR_REQUEST_DEFINITION[input.reason];
  const active = await supabase
    .from('booking_ops_communication_intents')
    .select('*')
    .eq('booking_ops_record_id', input.bookingOpsRecordId)
    .eq('purpose', definition.purpose)
    .in('status', ['draft_ready', 'waiting_for_external_input'])
    .maybeSingle();
  if (active.error) throw new Error(active.error.message);
  if (active.data) return { communication: mapRow(active.data as CommunicationRow), created: false, actuallySent: false };

  const now = new Date().toISOString();
  const inserted = await supabase.from('booking_ops_communication_intents').insert({
    id: randomUUID(),
    booking_ops_record_id: input.bookingOpsRecordId,
    booking_id: input.bookingId,
    related_task_id: null,
    actor_type: 'guest',
    actor_label: 'Гость',
    purpose: definition.purpose,
    channel: 'manual',
    status: 'draft_ready',
    message_text: definition.message,
    message_template_key: definition.template,
    metadata: {
      operatorRequested: true,
      alertId: input.alertId,
      missingDataReason: input.reason,
      requestedBy: input.actorId,
      noExternalSend: true,
      autoSendEligible: false,
    },
    created_at: now,
    updated_at: now,
  }).select('*').single();
  if (inserted.error?.code === '23505') {
    const raced = await supabase.from('booking_ops_communication_intents').select('*')
      .eq('booking_ops_record_id', input.bookingOpsRecordId)
      .eq('purpose', definition.purpose)
      .in('status', ['draft_ready', 'waiting_for_external_input'])
      .maybeSingle();
    if (raced.error) throw new Error(raced.error.message);
    if (!raced.data) throw new Error('missing_data_request_duplicate_race');
    return { communication: mapRow(raced.data as CommunicationRow), created: false, actuallySent: false };
  }
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? 'missing_data_request_create_failed');
  return { communication: mapRow(inserted.data as CommunicationRow), created: true, actuallySent: false };
}

async function recordCommunicationEvent(input: {
  recordId: string;
  type: 'created' | 'updated' | 'superseded' | 'waiting';
  communication: BookingOpsCommunicationIntent;
}): Promise<void> {
  const eventType =
    input.type === 'superseded'
      ? 'communication_intent_superseded'
      : input.type === 'waiting'
        ? 'communication_waiting_for_external_input'
        : input.type === 'created'
          ? 'communication_intent_created'
          : 'communication_draft_created';
  const title =
    input.type === 'superseded'
      ? 'Коммуникация больше не нужна'
      : input.communication.status === 'waiting_for_external_input'
        ? 'Ожидаем ответ по коммуникации'
        : 'Создан черновик коммуникации';

  await recordBookingOpsEvent({
    bookingOpsRecordId: input.recordId,
    eventType,
    title,
    description: input.communication.messageText,
    actorType: 'system',
    metadata: {
      communicationId: input.communication.id,
      communicationPurpose: input.communication.purpose,
      communicationStatus: input.communication.status,
      actorType: input.communication.actorType,
      relatedTaskId: input.communication.relatedTaskId,
    },
    dedupeKey: `communication:${eventType}:${input.communication.id}:${input.communication.updatedAt}`,
  });
}

export async function syncBookingOpsCommunications(input: {
  record: BookingOpsRecord;
  tasks: BookingOpsTask[];
}): Promise<{
  ok: boolean;
  communications: BookingOpsCommunicationIntent[];
  plan: BookingOpsCommunicationPlan;
  error?: string;
}> {
  const existingResult = await listBookingOpsCommunicationsForRecord(input.record.id);
  if (!existingResult.ok) {
    return {
      ok: false,
      communications: [],
      plan: planBookingOpsCommunications({ ...input, existingCommunications: [] }),
      error: existingResult.error,
    };
  }

  const plan = planBookingOpsCommunications({
    ...input,
    existingCommunications: existingResult.communications,
  });
  const now = new Date().toISOString();

  for (const item of plan.toSupersede) {
    const { data } = await supabase
      .from('booking_ops_communication_intents')
      .update({ status: 'superseded', superseded_at: now, updated_at: now })
      .eq('id', item.id)
      .select('*')
      .maybeSingle();
    if (data) {
      await recordCommunicationEvent({
        recordId: input.record.id,
        type: 'superseded',
        communication: mapRow(data as CommunicationRow),
      });
    }
  }

  for (const item of plan.toUpdate) {
    const autoSendDecision = await canAutoSendCommunicationIntent(item.desired, {
      bookingId: input.record.bookingId,
      propertyId: input.record.propertyId,
      guestRef: input.record.guestTelegram ?? input.record.guestEmail ?? input.record.guestPhone,
      unresolvedComplaint: input.record.guestIntake?.intakeStatus === 'fallback_required',
    });
    const { data } = await supabase
      .from('booking_ops_communication_intents')
      .update({
        actor_label: item.desired.actorLabel,
        channel: item.desired.channel,
        status: item.desired.status,
        message_text: item.desired.messageText,
        message_template_key: item.desired.messageTemplateKey,
        metadata: attachAutoSendDecisionMetadata(item.desired.metadata ?? {}, autoSendDecision),
        updated_at: now,
      })
      .eq('id', item.existing.id)
      .select('*')
      .maybeSingle();
    if (data) {
      const communication = mapRow(data as CommunicationRow);
      await recordCommunicationEvent({
        recordId: input.record.id,
        type: communication.status === 'waiting_for_external_input' ? 'waiting' : 'updated',
        communication,
      });
    }
  }

  for (const item of plan.toCreate) {
    const autoSendDecision = await canAutoSendCommunicationIntent(item, {
      bookingId: input.record.bookingId,
      propertyId: input.record.propertyId,
      guestRef: input.record.guestTelegram ?? input.record.guestEmail ?? input.record.guestPhone,
      unresolvedComplaint: input.record.guestIntake?.intakeStatus === 'fallback_required',
    });
    const { data } = await supabase
      .from('booking_ops_communication_intents')
      .insert({
        id: randomUUID(),
        booking_ops_record_id: input.record.id,
        booking_id: input.record.bookingId,
        related_task_id: item.relatedTaskId,
        actor_type: item.actorType,
        actor_label: item.actorLabel,
        purpose: item.purpose,
        channel: item.channel,
        status: item.status,
        message_text: item.messageText,
        message_template_key: item.messageTemplateKey,
        metadata: attachAutoSendDecisionMetadata(item.metadata ?? {}, autoSendDecision),
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    if (data) {
      const communication = mapRow(data as CommunicationRow);
      await recordCommunicationEvent({
        recordId: input.record.id,
        type: 'created',
        communication,
      });
      if (communication.status === 'draft_ready') {
        await recordCommunicationEvent({
          recordId: input.record.id,
          type: 'updated',
          communication,
        });
      }
    }
  }

  for (const item of existingResult.communications) {
    if (!ACTIVE_STATUSES.has(item.status) || item.metadata.auto_send_decision) continue;
    await evaluateAndPersistIntentAutoSendDecision(item, {
      bookingId: input.record.bookingId,
      propertyId: input.record.propertyId,
      guestRef: input.record.guestTelegram ?? input.record.guestEmail ?? input.record.guestPhone,
      unresolvedComplaint: input.record.guestIntake?.intakeStatus === 'fallback_required',
    });
  }

  const finalResult = await listBookingOpsCommunicationsForRecord(input.record.id);
  return {
    ok: finalResult.ok,
    communications: finalResult.ok ? finalResult.communications : existingResult.communications,
    plan,
    error: finalResult.ok ? undefined : finalResult.error,
  };
}
