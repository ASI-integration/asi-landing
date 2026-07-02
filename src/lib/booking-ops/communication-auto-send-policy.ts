import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import type {
  BookingOpsCommunicationActorType,
  BookingOpsCommunicationChannel,
  BookingOpsCommunicationIntent,
  BookingOpsCommunicationPurpose,
} from './types';

export const AUTO_SEND_DECISION_CODES = [
  'allowed',
  'review_required',
  'blocked',
  'rate_limited',
  'quiet_hours',
  'missing_metadata',
  'unsafe_content',
  'unknown_message_type',
] as const;

export type AutoSendDecisionCode = (typeof AUTO_SEND_DECISION_CODES)[number];
export type CommunicationPolicyScope = 'global' | 'owner' | 'property' | 'booking';

export type CommunicationAutoSendDecision = {
  decision: AutoSendDecisionCode;
  allowed: boolean;
  reason: string;
  rule_key: string;
  safe_to_display_summary: string;
  actual_send_enabled: boolean;
  policy_decision_id: string | null;
};

export type CommunicationAutoSendPolicy = {
  id?: string;
  scope: CommunicationPolicyScope;
  scopeRef: string | null;
  messageType: string;
  channel: BookingOpsCommunicationChannel | 'web' | 'sms' | 'any';
  autoSendEnabled: boolean;
  actualSendEnabled?: boolean;
  requiresReview: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  maxAutoSendsPerBookingPerDay: number | null;
  maxAutoSendsPerGuestPerDay: number | null;
  allowedRecipientRoles: string[];
  blockedKeywords: string[];
  requiredMetadata: string[];
};

export type CommunicationAutoSendContext = {
  bookingId?: string | null;
  propertyId?: string | null;
  ownerId?: string | null;
  guestRef?: string | null;
  unresolvedComplaint?: boolean;
  bookingAutoSendsToday?: number;
  guestAutoSendsToday?: number;
  now?: Date;
  policy?: CommunicationAutoSendPolicy;
  emergencyAllowedDuringQuietHours?: boolean;
};

type IntentLike = Pick<BookingOpsCommunicationIntent,
  'actorType' | 'purpose' | 'channel' | 'messageText'>
  & { metadata?: Record<string, unknown> }
  & Partial<Pick<BookingOpsCommunicationIntent, 'id' | 'bookingId' | 'bookingOpsRecordId'>>;

type PolicyRow = {
  id: string;
  scope: CommunicationPolicyScope;
  scope_ref: string | null;
  message_type: string;
  channel: CommunicationAutoSendPolicy['channel'];
  auto_send_enabled: boolean;
  actual_send_enabled?: boolean;
  requires_review: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  max_auto_sends_per_booking_per_day: number | null;
  max_auto_sends_per_guest_per_day: number | null;
  allowed_recipient_roles: unknown;
  blocked_keywords: unknown;
  required_metadata: unknown;
};

export const SUPPORTED_ACTUAL_AUTO_SEND_MESSAGE_TYPES = [
  'request_missing_guest_data',
  'request_arrival_time',
  'neutral_booking_acknowledgement',
  'neutral_status_update',
  'cleaner_task_assignment',
  'cleaner_task_reminder',
  'linen_task_assignment',
  'inspection_task_assignment',
  'master_task_assignment',
  'master_task_reminder',
  'internal_status_notice',
  'fallback_created_notice',
  'task_overdue_notice',
] as const;

export type SupportedActualAutoSendMessageType =
  (typeof SUPPORTED_ACTUAL_AUTO_SEND_MESSAGE_TYPES)[number];

const ACTUAL_AUTO_SEND_TYPES = new Set<string>(SUPPORTED_ACTUAL_AUTO_SEND_MESSAGE_TYPES);
const ACTUAL_AUTO_SEND_ALLOWED_ROLES: Record<string, string[]> = {
  request_missing_guest_data: ['guest'],
  request_arrival_time: ['guest'],
  neutral_booking_acknowledgement: ['guest'],
  neutral_status_update: ['guest'],
  cleaner_task_assignment: ['cleaner'],
  cleaner_task_reminder: ['cleaner'],
  linen_task_assignment: ['laundry'],
  inspection_task_assignment: ['admin'],
  master_task_assignment: ['master'],
  master_task_reminder: ['master'],
  internal_status_notice: ['admin', 'owner'],
  fallback_created_notice: ['admin', 'owner'],
  task_overdue_notice: ['admin', 'owner'],
};

const KNOWN_MESSAGE_TYPES = new Set<string>([
  ...SUPPORTED_ACTUAL_AUTO_SEND_MESSAGE_TYPES,
  'request_guest_documents',
  'request_contract_confirmation',
  'request_deposit_payment',
  'request_mvd_data',
  'send_checkin_instructions',
  'remind_guest_before_checkin',
  'checkout_reminder',
  'cleaning_assignment',
  'cleaning_reminder',
  'inspection_request',
  'issue_followup',
  'checkin_instructions',
  'arrival_confirmation_request',
  'access_issue_followup',
  'checkout_instructions',
  'checkout_confirmation_request',
  'guest_issue_acknowledgement',
  'guest_stay_issue_followup',
  'deposit_return_readiness_notice',
  'linen_pickup_request',
  'linen_delivery_request',
  'linen_status_check',
  'maintenance_request',
  'repair_status_check',
  'preparation_blocked_notice',
  'readiness_confirmation_needed',
  'guest_data_missing_notice',
  'unit_ready_notice',
  'issue_escalation_notice',
  'owner_setup_started',
  'request_property_missing_data',
  'request_property_photos',
  'request_channel_manager_access',
  'object_data_received_acknowledgement',
  'object_ready_for_review_notice',
]);

const REVIEW_REQUIRED_TYPES = new Set<string>([
  'request_guest_documents',
  'request_contract_confirmation',
  'request_deposit_payment',
  'request_mvd_data',
  'send_checkin_instructions',
  'checkin_instructions',
  'deposit_return_readiness_notice',
  'request_channel_manager_access',
]);

const CONFLICT_TYPES = new Set<string>([
  'issue_escalation_notice',
  'guest_stay_issue_followup',
  'access_issue_followup',
]);

const URGENT_WORKER_TYPES = new Set<string>([
  'cleaning_assignment',
  'cleaning_reminder',
  'maintenance_request',
  'repair_status_check',
]);

const ACCESS_SECRET_RE = /(?:код|пин|pin|door\s*code|lockbox|keypad).{0,32}\b\d{3,12}\b/iu;
const DOCUMENT_NUMBER_RE = /(?:паспорт|passport|документ).{0,36}(?:\b\d{4}\s*\d{6}\b|\b\d{8,14}\b)/iu;
const PAYMENT_SECRET_RE = /(?:cvv|cvc|секрет|номер\s+карты|card\s+number).{0,32}\d/iu;
const CONFLICT_RE = /(?:возврат\s+денег|refund|претензи|жалоб|конфликт|скандал|угроз)/iu;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function mapPolicy(row: PolicyRow): CommunicationAutoSendPolicy {
  return {
    id: row.id,
    scope: row.scope,
    scopeRef: row.scope_ref,
    messageType: row.message_type,
    channel: row.channel,
    autoSendEnabled: row.auto_send_enabled,
    actualSendEnabled: row.actual_send_enabled === true,
    requiresReview: row.requires_review,
    quietHoursEnabled: row.quiet_hours_enabled,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    maxAutoSendsPerBookingPerDay: row.max_auto_sends_per_booking_per_day,
    maxAutoSendsPerGuestPerDay: row.max_auto_sends_per_guest_per_day,
    allowedRecipientRoles: stringArray(row.allowed_recipient_roles),
    blockedKeywords: stringArray(row.blocked_keywords),
    requiredMetadata: stringArray(row.required_metadata),
  };
}

function failClosedPolicy(messageType: string): CommunicationAutoSendPolicy {
  return {
    scope: 'global',
    scopeRef: null,
    messageType,
    channel: 'any',
    autoSendEnabled: false,
    actualSendEnabled: false,
    requiresReview: true,
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
    maxAutoSendsPerBookingPerDay: 3,
    maxAutoSendsPerGuestPerDay: 3,
    allowedRecipientRoles: [],
    blockedKeywords: [],
    requiredMetadata: [],
  };
}

function decision(
  code: AutoSendDecisionCode,
  ruleKey: string,
  reason: string,
  summary: string,
  options: { actualSendEnabled?: boolean; policyId?: string | null } = {},
): CommunicationAutoSendDecision {
  return {
    decision: code,
    allowed: code === 'allowed',
    reason,
    rule_key: ruleKey,
    safe_to_display_summary: summary,
    actual_send_enabled: options.actualSendEnabled === true,
    policy_decision_id: options.policyId ?? null,
  };
}

function policyRank(policy: CommunicationAutoSendPolicy, context: CommunicationAutoSendContext): number {
  if (policy.scope === 'booking' && policy.scopeRef === context.bookingId) return 40;
  if (policy.scope === 'property' && policy.scopeRef === context.propertyId) return 30;
  if (policy.scope === 'owner' && policy.scopeRef === context.ownerId) return 20;
  if (policy.scope === 'global' && !policy.scopeRef) return 10;
  return -1;
}

export async function getCommunicationPolicy(
  intent: IntentLike,
  context: CommunicationAutoSendContext = {},
): Promise<CommunicationAutoSendPolicy> {
  if (context.policy) return context.policy;

  const { data, error } = await supabase
    .from('booking_ops_communication_policies')
    .select('*')
    .in('message_type', [String(intent.purpose), '*'])
    .in('channel', [String(intent.channel), 'any']);

  if (error || !data) return failClosedPolicy(String(intent.purpose));

  const policies = (data as PolicyRow[])
    .map(mapPolicy)
    .filter((policy) => policyRank(policy, context) >= 0)
    .sort((left, right) => {
      const scopeDifference = policyRank(right, context) - policyRank(left, context);
      if (scopeDifference !== 0) return scopeDifference;
      const typeDifference = Number(right.messageType !== '*') - Number(left.messageType !== '*');
      if (typeDifference !== 0) return typeDifference;
      return Number(right.channel !== 'any') - Number(left.channel !== 'any');
    });

  return policies[0] ?? failClosedPolicy(String(intent.purpose));
}

export function classifyMessageForAutoSend(intent: IntentLike): CommunicationAutoSendDecision | null {
  const messageType = String(intent.purpose ?? '');
  const message = String(intent.messageText ?? '');
  const metadata = intent.metadata ?? {};

  if (!KNOWN_MESSAGE_TYPES.has(messageType)) {
    return decision('unknown_message_type', 'message_type.unknown', 'Неизвестный тип сообщения.', 'Нужна ручная проверка типа сообщения.');
  }
  if (ACCESS_SECRET_RE.test(message)) {
    return decision('unsafe_content', 'content.raw_access_code', 'Обнаружены реквизиты доступа.', 'Автоотправка заблокирована: сообщение может содержать код доступа.');
  }
  if (DOCUMENT_NUMBER_RE.test(message)) {
    return decision('unsafe_content', 'content.document_number', 'Обнаружен полный номер документа.', 'Автоотправка заблокирована: сообщение может содержать номер документа.');
  }
  if (PAYMENT_SECRET_RE.test(message)) {
    return decision('unsafe_content', 'content.payment_secret', 'Обнаружены платёжные реквизиты.', 'Автоотправка заблокирована: сообщение может содержать платёжные данные.');
  }
  if (CONFLICT_TYPES.has(messageType) || CONFLICT_RE.test(message)) {
    return decision('blocked', 'content.conflict_or_escalation', 'Конфликтные и эскалационные ответы не отправляются автоматически.', 'Автоотправка заблокирована: требуется оператор.');
  }
  const confidence = Number(metadata.classification_confidence ?? metadata.confidence);
  if (Number.isFinite(confidence) && confidence < 0.7) {
    return decision('blocked', 'classification.low_confidence', 'Недостаточная уверенность классификации.', 'Автоотправка заблокирована из-за низкой уверенности.');
  }
  if (REVIEW_REQUIRED_TYPES.has(messageType)) {
    return decision('review_required', 'message_type.sensitive_flow', 'Сообщение относится к чувствительному сценарию.', 'Нужна проверка оператора перед отправкой.');
  }
  return null;
}

function isQuietHours(now: Date, start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const current = now.getHours() * 60 + now.getMinutes();
  const from = startHour * 60 + startMinute;
  const to = endHour * 60 + endMinute;
  return from <= to ? current >= from && current < to : current >= from || current < to;
}

async function successfulAttemptsToday(field: 'booking_id' | 'guest_ref', value: string | null | undefined) {
  if (!value) return 0;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('booking_ops_communication_auto_send_attempts')
    .select('id', { count: 'exact', head: true })
    .eq(field, value)
    .eq('result', 'sent')
    .gte('created_at', since.toISOString());
  return error ? 0 : count ?? 0;
}

export async function canAutoSendCommunicationIntent(
  intent: IntentLike,
  context: CommunicationAutoSendContext = {},
): Promise<CommunicationAutoSendDecision> {
  const contentDecision = classifyMessageForAutoSend(intent);
  if (contentDecision) return contentDecision;
  const bookingId = context.bookingId ?? intent.bookingId;
  if (bookingId && intent.actorType === 'guest') {
    const sensitivePurpose = ['send_checkin_instructions', 'checkin_instructions', 'unit_ready_notice'].includes(String(intent.purpose));
    const validBookingId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(bookingId);
    if (!validBookingId && sensitivePurpose) {
      return decision('blocked', 'legal.booking_id_invalid', 'Нет корректного ID брони для проверки.', 'Отправка заблокирована до проверки юридической готовности.');
    }
    if (!validBookingId) return continueAutoSendPolicy(intent, context);
    const { getGuestLegalReadiness, shouldBlockLegalCommunication } = await import('./guest-legal-deposit-mvd-execution');
    const readiness = await getGuestLegalReadiness(bookingId);
    if (!readiness && sensitivePurpose) {
      return decision('blocked', 'legal.readiness_missing', 'Юридическая готовность не рассчитана.', 'Отправка заблокирована до проверки документов, договора, залога и МВД.');
    }
    if (readiness) {
      const legalDecision = shouldBlockLegalCommunication(intent, readiness);
      if (legalDecision.block) {
        return decision('blocked', 'legal.readiness_blocked', legalDecision.reason ?? 'Юридическая готовность не подтверждена.', 'Подтверждение и инструкции заезда заблокированы до снятия ограничений.');
      }
    }
  }
  return continueAutoSendPolicy(intent, context);
}

async function continueAutoSendPolicy(
  intent: IntentLike,
  context: CommunicationAutoSendContext,
): Promise<CommunicationAutoSendDecision> {
  if (intent.actorType === 'guest' && context.unresolvedComplaint) {
    return decision('blocked', 'guest.unresolved_complaint', 'У гостя есть нерешённое обращение.', 'Автоотправка приостановлена до решения обращения.');
  }

  const policy = await getCommunicationPolicy(intent, context);
  if (!policy.autoSendEnabled || policy.requiresReview) {
    return decision('review_required', 'policy.review_required', 'Политика требует ручной проверки.', 'Нужна проверка оператора перед отправкой.');
  }
  if (policy.allowedRecipientRoles.length > 0 && !policy.allowedRecipientRoles.includes(intent.actorType)) {
    return decision('blocked', 'policy.recipient_role', 'Роль получателя не разрешена политикой.', 'Автоотправка для этого получателя отключена.');
  }

  const intentMetadata = intent.metadata ?? {};
  const normalizedMessage = intent.messageText.toLocaleLowerCase('ru-RU');
  if (policy.blockedKeywords.some((keyword) => normalizedMessage.includes(keyword.toLocaleLowerCase('ru-RU')))) {
    return decision('unsafe_content', 'policy.blocked_keyword', 'Сработало правило запрещённого содержания.', 'Автоотправка заблокирована правилом безопасности.');
  }
  const missing = policy.requiredMetadata.filter((key) => intentMetadata[key] === undefined || intentMetadata[key] === null);
  if (missing.length > 0) {
    return decision('missing_metadata', 'policy.required_metadata', 'Не хватает обязательных данных для безопасной отправки.', 'Нужно заполнить обязательные данные.');
  }

  const urgentWorker = URGENT_WORKER_TYPES.has(String(intent.purpose)) && intentMetadata.urgent === true;
  if (
    policy.quietHoursEnabled
    && isQuietHours(context.now ?? new Date(), policy.quietHoursStart, policy.quietHoursEnd)
    && !(urgentWorker && context.emergencyAllowedDuringQuietHours)
  ) {
    return decision('quiet_hours', 'policy.quiet_hours', 'Сейчас действуют тихие часы.', 'Отправка отложена до окончания тихих часов.');
  }
  const [bookingAutoSendsToday, guestAutoSendsToday] = await Promise.all([
    context.bookingAutoSendsToday === undefined
      ? successfulAttemptsToday('booking_id', context.bookingId ?? intent.bookingId)
      : context.bookingAutoSendsToday,
    context.guestAutoSendsToday === undefined
      ? successfulAttemptsToday('guest_ref', context.guestRef)
      : context.guestAutoSendsToday,
  ]);
  if (
    policy.maxAutoSendsPerBookingPerDay !== null
    && bookingAutoSendsToday >= policy.maxAutoSendsPerBookingPerDay
  ) {
    return decision('rate_limited', 'rate.booking_daily', 'Достигнут дневной лимит по брони.', 'Дневной лимит автоматических сообщений по брони исчерпан.');
  }
  if (
    policy.maxAutoSendsPerGuestPerDay !== null
    && guestAutoSendsToday >= policy.maxAutoSendsPerGuestPerDay
  ) {
    return decision('rate_limited', 'rate.guest_daily', 'Достигнут дневной лимит по гостю.', 'Дневной лимит автоматических сообщений гостю исчерпан.');
  }
  return decision(
    'allowed',
    'policy.allowed',
    'Сообщение прошло правила безопасной автоотправки.',
    policy.actualSendEnabled
      ? 'Можно выполнить безопасную отправку.'
      : 'Можно поставить в очередь, но фактическая отправка для этого уровня выключена.',
    { actualSendEnabled: policy.actualSendEnabled, policyId: policy.id },
  );
}

export async function explainAutoSendDecision(
  intent: IntentLike,
  context: CommunicationAutoSendContext = {},
): Promise<CommunicationAutoSendDecision> {
  return canAutoSendCommunicationIntent(intent, context);
}

function decisionMetadata(decisionResult: CommunicationAutoSendDecision, metadata: Record<string, unknown> = {}) {
  return {
    ...metadata,
    auto_send_decision: decisionResult,
    auto_send_eligible: decisionResult.allowed,
    auto_send_evaluated_at: new Date().toISOString(),
    actual_send_enabled: decisionResult.actual_send_enabled,
  };
}

async function updateIntentDecision(
  intentId: string,
  decisionResult: CommunicationAutoSendDecision,
  metadata: Record<string, unknown> = {},
) {
  const { data: current, error: readError } = await supabase
    .from('booking_ops_communication_intents')
    .select('metadata')
    .eq('id', intentId)
    .maybeSingle();
  if (readError || !current) return { ok: false, error: readError?.message ?? 'intent_not_found' };
  const nextMetadata = decisionMetadata(decisionResult, {
    ...((current as { metadata?: Record<string, unknown> }).metadata ?? {}),
    ...metadata,
  });
  const { error } = await supabase
    .from('booking_ops_communication_intents')
    .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
    .eq('id', intentId);
  return error ? { ok: false, error: error.message } : { ok: true, metadata: nextMetadata };
}

export function attachAutoSendDecisionMetadata(
  metadata: Record<string, unknown>,
  decisionResult: CommunicationAutoSendDecision,
): Record<string, unknown> {
  return decisionMetadata(decisionResult, metadata);
}

export async function buildAutoSendDecisionMetadata(
  intent: IntentLike,
  context: CommunicationAutoSendContext = {},
): Promise<Record<string, unknown>> {
  const result = await canAutoSendCommunicationIntent(intent, context);
  return attachAutoSendDecisionMetadata(intent.metadata ?? {}, result);
}

export async function markIntentAutoSendEligible(intentId: string, reason: string, metadata: Record<string, unknown> = {}) {
  const { data: row, error } = await supabase
    .from('booking_ops_communication_intents')
    .select('actor_type,purpose,channel,message_text,metadata')
    .eq('id', intentId)
    .maybeSingle();
  if (error || !row) return { ok: false, error: error?.message ?? 'intent_not_found' };
  const raw = row as {
    actor_type: BookingOpsCommunicationActorType;
    purpose: BookingOpsCommunicationPurpose;
    channel: BookingOpsCommunicationChannel;
    message_text: string;
    metadata: Record<string, unknown> | null;
  };
  const safetyDecision = classifyMessageForAutoSend({
    actorType: raw.actor_type,
    purpose: raw.purpose,
    channel: raw.channel,
    messageText: raw.message_text,
    metadata: raw.metadata ?? {},
  });
  const unresolvedDecision = raw.metadata?.guestIntakeStatus === 'fallback_required'
    || raw.metadata?.unresolved_complaint === true
    ? decision('blocked', 'guest.unresolved_complaint', 'У гостя есть нерешённое обращение.', 'Автоотправка приостановлена до решения обращения.')
    : null;
  if (safetyDecision || unresolvedDecision) {
    const deniedDecision = safetyDecision ?? unresolvedDecision!;
    await updateIntentDecision(intentId, deniedDecision, metadata);
    return { ok: false, error: 'unsafe_override_denied', decision: deniedDecision };
  }
  return updateIntentDecision(intentId, decision(
    'allowed',
    'operator.approved',
    reason,
    metadata.actual_send_enabled === true
      ? 'Оператор разрешил безопасную фактическую отправку для этой брони.'
      : 'Оператор разрешил постановку в очередь.',
    { actualSendEnabled: metadata.actual_send_enabled === true },
  ), metadata);
}

export async function evaluateAndPersistIntentAutoSendDecision(
  intent: BookingOpsCommunicationIntent,
  context: CommunicationAutoSendContext = {},
) {
  const result = await canAutoSendCommunicationIntent(intent, context);
  return updateIntentDecision(intent.id, result);
}

export async function markIntentReviewRequired(intentId: string, reason: string, metadata: Record<string, unknown> = {}) {
  return updateIntentDecision(intentId, decision('review_required', 'operator.review_required', reason, 'Оператор назначил ручную проверку.'), metadata);
}

export async function blockIntentAutoSend(intentId: string, reason: string, metadata: Record<string, unknown> = {}) {
  return updateIntentDecision(intentId, decision('blocked', 'operator.blocked', reason, 'Оператор заблокировал автоотправку.'), metadata);
}

export async function recordAutoSendAttempt(
  intentId: string,
  result: AutoSendDecisionCode | 'sent' | 'failed' | 'dry_run',
  metadata: Record<string, unknown> = {},
) {
  const safeMetadata = {
    dry_run: metadata.dry_run === true,
    provider: typeof metadata.provider === 'string' ? metadata.provider : null,
    error_code: typeof metadata.error_code === 'string' ? metadata.error_code : null,
  };
  const { error } = await supabase.from('booking_ops_communication_auto_send_attempts').insert({
    id: randomUUID(),
    communication_intent_id: intentId,
    result,
    booking_id: typeof metadata.booking_id === 'string' ? metadata.booking_id : null,
    guest_ref: typeof metadata.guest_ref === 'string' ? metadata.guest_ref : null,
    metadata: safeMetadata,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function getAutoSendQueue(filters: {
  bookingOpsRecordId?: string;
  channel?: BookingOpsCommunicationChannel;
  limit?: number;
} = {}) {
  let query = supabase
    .from('booking_ops_communication_intents')
    .select('*')
    .eq('metadata->>auto_send_eligible', 'true')
    .in('status', ['draft_ready', 'waiting_for_external_input'])
    .order('updated_at', { ascending: true })
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 100));
  if (filters.bookingOpsRecordId) query = query.eq('booking_ops_record_id', filters.bookingOpsRecordId);
  if (filters.channel) query = query.eq('channel', filters.channel);
  const { data, error } = await query;
  return error ? { ok: false, error: error.message, intents: [] } : { ok: true, intents: data ?? [] };
}

async function saveBookingPolicy(input: {
  bookingId: string;
  messageType: string;
  channel?: CommunicationAutoSendPolicy['channel'];
  enabled: boolean;
  actualSendEnabled: boolean;
  requiresReview: boolean;
  allowedRecipientRoles?: string[];
}) {
  const channel = input.channel ?? 'any';
  const { data: existing, error: readError } = await supabase
    .from('booking_ops_communication_policies')
    .select('id')
    .eq('scope', 'booking')
    .eq('scope_ref', input.bookingId)
    .eq('message_type', input.messageType)
    .eq('channel', channel)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  const values = {
    scope: 'booking',
    scope_ref: input.bookingId,
    message_type: input.messageType,
    channel,
    auto_send_enabled: input.enabled,
    actual_send_enabled: input.actualSendEnabled,
    requires_review: input.requiresReview,
    quiet_hours_enabled: true,
    quiet_hours_start: '22:00',
    quiet_hours_end: '08:00',
    max_auto_sends_per_booking_per_day: 3,
    max_auto_sends_per_guest_per_day: 3,
    allowed_recipient_roles: input.allowedRecipientRoles ?? [],
    blocked_keywords: [],
    required_metadata: [],
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    const { error } = await supabase
      .from('booking_ops_communication_policies')
      .update(values)
      .eq('id', String((existing as { id: string }).id));
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const { error } = await supabase.from('booking_ops_communication_policies').insert({
    id: randomUUID(),
    ...values,
    created_at: new Date().toISOString(),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function markBookingMessageTypeSafe(bookingId: string, messageType: string) {
  if (!ACTUAL_AUTO_SEND_TYPES.has(messageType)) {
    return { ok: false, error: 'message_type_cannot_be_marked_safe' };
  }
  return saveBookingPolicy({
    bookingId,
    messageType,
    enabled: true,
    actualSendEnabled: true,
    requiresReview: false,
    allowedRecipientRoles: ACTUAL_AUTO_SEND_ALLOWED_ROLES[messageType] ?? [],
  });
}

export async function disableAutoSendForBooking(bookingId: string) {
  return saveBookingPolicy({
    bookingId,
    messageType: '*',
    enabled: false,
    actualSendEnabled: false,
    requiresReview: true,
  });
}

export type AutoSendPolicyIntent = IntentLike & {
  actorType: BookingOpsCommunicationActorType;
  purpose: BookingOpsCommunicationPurpose;
};
